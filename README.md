# bookcerto

Multi-tenant appointment-scheduling SaaS for clinics and barbershops. Owners and
staff manage services, availability, and a live dashboard; clients book on a
public per-tenant page with no login.

Built as a single Next.js full-stack monolith, where the point is the backend
depth: multi-tenancy, a database-level overlap guarantee, background jobs, and a
real deploy story.

## Architecture

```
                          ┌──────────────────────────────────────────┐
                          │                 Next.js 15                │
                          │            (App Router, one codebase)     │
                          │                                          │
  Client ──────────────►  │  /booking/[slug]   public booking page    │
  (no login)              │  /dashboard        owner/staff live view  │
                          │  /login /register  Auth.js credentials    │
                          │  /api/availability slot computation       │
                          │  /api/events       SSE realtime           │
                          └──────┬──────────────┬──────────────┬──────┘
                                 │              │              │
                         drizzle │         BullMQ/ioredis   SSE (redis pub/sub)
                                 ▼              ▼              ▼
                    ┌────────────────┐   ┌─────────────┐  ┌─────────────┐
                    │ Neon Postgres  │   │  Upstash    │  │  Upstash    │
                    │ (serverless,   │   │  Redis      │  │  Redis      │
                    │  WebSocket drv)│   │  queues     │  │  pub/sub    │
                    └────────────────┘   └──────┬──────┘  └─────────────┘
                                                 │ BullMQ consumer
                                                 ▼
                                        ┌──────────────┐
                                        │  worker.ts   │
                                        │ (reminders)  │
                                        └──────────────┘
```

- **Two entrypoints, one image.** The same Docker image runs as `web` (pages +
  API) and `worker` (BullMQ consumer) on Cloud Run.
- **Postgres is the source of truth.** Overlap prevention is a real DB constraint
  (see below). Redis only carries queues and pub/sub, never the canonical state.
- **SSE, not websockets.** Realtime is one-way server push to dashboards.

## The headline feature: overlap is a database constraint

Two appointments for the same staff member can never overlap — enforced by
Postgres, not application logic:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at) WITH &&);
```

Even if application code forgets to check, the database rejects the insert with
`23P01`. The booking path (`src/lib/booking.ts`) catches that violation and
returns a "slot no longer available" response to the client.

## Data model

Shared schema, `tenant_id` on every row. See `src/db/schema.ts`.

| Table | Purpose |
|---|---|
| `tenants` | name, slug (public URL), timezone |
| `users` | email, password hash, name |
| `memberships` | user ↔ tenant with a role (`owner`/`staff`/`client`) |
| `clients` | walk-in friendly: name, phone, optional user_id |
| `staff` | display name, color, active |
| `services` | name, duration, price, color |
| `service_staff` | which staff provides which service |
| `schedules` | weekly availability per staff (day_of_week + local time) |
| `schedule_overrides` | per-date block or custom window |
| `appointments` | staff, service, client, `start_at`/`end_at` (timestamptz), status |
| `reminders` | appointment, channel, due_at, status |
| `activity_log` | every appointment change (audit + realtime source) |

Tenant isolation is enforced at the application layer (`requireTenant()` in
`src/lib/tenant.ts`). Postgres RLS policies are **written but deliberately
disabled** (`drizzle/0002_rls.sql`) — no code path sets the `app.tenant_id` GUC
yet, so enabling them would break every query. That wiring is a known follow-up.

## Local setup

Requirements: Node 24, a Neon Postgres database, and an Upstash Redis instance.

1. Install dependencies.

   ```bash
   npm ci
   ```

2. Create `.env` from the example.

   ```bash
   cp .env.example .env
   ```

   ```env
   DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
   REDIS_URL=redis://default:pass@host:6379
   AUTH_SECRET=change-me-to-a-long-random-string
   ```

   `src/env.ts` zod-validates all three at startup — the app boots with none of
   them missing.

3. Apply migrations.

   ```bash
   npm run db:migrate
   ```

   `npm run db:generate` re-generates migrations from `src/db/schema.ts` when the
   schema changes.

4. Run the app.

   ```bash
   npm run dev          # http://localhost:3000
   ```

5. (Optional) run the reminder worker. It consumes the `reminders` BullMQ queue.

   ```bash
   npm run worker
   ```

## Testing

Unit + integration tests hit a live Neon database (they seed real rows), so
`.env` must point at a disposable database.

```bash
npm test              # Vitest: availability engine + booking overlap rejection
npm run e2e           # Playwright: full public booking flow
```

The e2e suite (`e2e/booking.spec.ts`) seeds a unique tenant/staff/service, drives
the public page in Chromium, books a slot, and asserts both that the slot
disappears from `/api/availability` and that a matching appointment row was
committed. It boots its own dev server on port `3100`.

## Deploy

Infrastructure is Terraform; delivery is GitHub Actions.

- **Terraform** (`terraform/`): Neon Postgres, Upstash Redis, Artifact Registry,
  Secret Manager, and two Cloud Run services (`bookcerto-web`, `bookcerto-worker`).
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit/integration tests on
  a disposable Neon branch.
- **CD** (`.github/workflows/deploy.yml`): build + push the image, run
  `drizzle-kit migrate`, deploy web and worker with Workload Identity Federation
  (no long-lived keys) and Secret Manager-mounted env vars.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + integration) |
| `npm run e2e` | Playwright booking flow |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run worker` | BullMQ reminder consumer |
