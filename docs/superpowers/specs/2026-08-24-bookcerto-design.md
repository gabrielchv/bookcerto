# bookcerto — Appointment Scheduling SaaS

## Goal

A multi-tenant appointment-scheduling SaaS for Brazilian clinics and barbershops:
business owners manage staff, services and availability; clients book via a public
per-tenant page; owners/staff see a live dashboard. Built as a Next.js full-stack
monolith to demonstrate real multi-user backend depth and a serious devops story.

## Positioning

This is a **web-dev-first** project. The data model, multi-tenancy, RBAC, background
jobs and IaC are the point. No AI in the MVP — if any is added later it is a garnish
(natural-language booking), never the product.

## Architecture

- Single Next.js App Router app, one codebase, **two Cloud Run services from the same
  image, two entrypoints**: `web` (pages + API) and `worker` (BullMQ consumer).
- **Postgres (Neon, serverless)** — single source of truth. **Redis (Upstash)** — BullMQ
  queues + pub/sub for cross-instance SSE broadcast.
- **SSE** (server-sent events) for one-way realtime: appointment created/cancelled
  pushes to owner/staff dashboards. No websocket server.
- Multi-tenancy: **shared schema, `tenant_id` on every row**, enforced at the
  application layer (`requireTenant()` on every data-access path) with Postgres **RLS**
  as defense-in-depth, proven by an integration test on a non-pooled connection.
- Auth: Auth.js credentials login, bcrypt password hash, RBAC via `memberships`
  (roles: `owner`, `staff`, `client`), workspace switcher when a user belongs to
  several tenants.

## Data Model

| Table | Purpose / key columns |
|---|---|
| `tenants` | name, slug (public URL), timezone |
| `users` | email (unique), password_hash, name |
| `memberships` | user_id, tenant_id, role — composite unique |
| `clients` | walk-in friendly: name, phone, optional user_id |
| `staff` | membership_id, display_name, color, active |
| `services` | name, duration_minutes, price_cents, color, active |
| `service_staff` | which staff provides which service |
| `schedules` | staff weekly availability: day_of_week, start/end time |
| `schedule_overrides` | per-date exception: block or custom window |
| `appointments` | staff, service, client, start_at, end_at, status |
| `reminders` | appointment, channel, due_at, status |
| `activity_log` | every appointment change — audit + realtime source |

## Core invariant

Overlap prevention is a **database constraint**, not application logic:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at) WITH &&);
```

Two appointments for the same staff member cannot overlap, even if application code
forgets to check. The booking path catches the `23P01` violation and returns a
"slot no longer available" response.

## Time handling

- `appointments.start_at`/`end_at` are `timestamptz` (absolute instants).
- Availability rules are local: `day_of_week` + local `time`, converted to UTC using
  the tenant timezone (`date-fns-tz`). Brazil has no DST since 2019, but the code
  stays correct for any tz.

## Booking flow

1. Client opens `/booking/<slug>` (no login).
2. Picks staff + service → sees available slots computed from schedule − existing
   appointments − overrides, in the tenant timezone.
3. Chooses slot, enters name/phone → booking inserted in a transaction; exclusion
   constraint rejects overlaps with `23P01`; failure returns "no longer available".
4. On commit: reminder jobs enqueued, activity logged, SSE event published.

## Reminders

On booking, enqueue a BullMQ delayed job per reminder (`due_at = start − lead`).
A provider interface (`EmailProvider`, `LogProvider`) sends; channel is swappable so
WhatsApp can replace email later. Default `LogProvider` in dev, SMTP via env in prod.

## DevOps

- **Terraform**: Cloud Run services (web + worker), Artifact Registry, Neon Postgres,
  Upstash Redis, Secret Manager. Providers: `google`, `neon`, `upstash`.
- **GitHub Actions**: CI (lint, typecheck, unit + integration tests on a Neon branch)
  → CD (build image, push, `drizzle-kit migrate`, deploy web + worker).
- **Migrations**: Drizzle; `EXCLUDE` constraint delivered as a custom SQL migration.

## Testing

- Unit (Vitest): availability engine, timezone conversion, slot computation.
- Integration: RLS isolation proof, booking overlap rejection (`23P01`), reminders.
- E2E (Playwright): public booking completes; dashboard shows it live.

## Success criteria

1. A client books an appointment on the public page; it appears on the owner's
   dashboard in real time without refresh.
2. A second booking attempt for the same staff/time slot is rejected at the DB.
3. Everything deploys via `terraform apply` + GitHub Actions, migrations included.
