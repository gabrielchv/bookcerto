# bookcerto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build bookcerto, a multi-tenant appointment-scheduling SaaS (Next.js full-stack monolith + BullMQ worker + Terraform/GitHub Actions), with overlap prevention enforced at the database.

**Architecture:** One Next.js App Router codebase, two Cloud Run services from the same image (`web` entrypoint + `worker` entrypoint). Postgres (Neon) is the source of truth; Redis (Upstash) runs BullMQ queues and pub/sub for cross-instance SSE. Multi-tenancy is a shared schema with `tenant_id` on every row, application-layer scoping + RLS defense-in-depth. Realtime is one-way SSE.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind, Drizzle ORM, Neon serverless Postgres, Upstash Redis, BullMQ, Auth.js v5 (credentials), Vitest, Playwright, Terraform, GitHub Actions.

## Global Constraints

- Node `>=24.16.0`, package manager npm (lockfile committed).
- Drizzle ORM; overlap prevention is a raw-SQL migration (`btree_gist` + `EXCLUDE`), never ORM-level.
- `appointments.start_at`/`end_at` are `timestamptz`; availability rules are local time converted with `date-fns-tz`.
- Every data-access path that touches tenant data goes through `requireTenant()` (application layer) — no free-form queries in route handlers.
- Env vars referenced only via `process.env` inside a single `src/env.ts`; `.env` git-ignored, `.env.example` committed.
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`).
- No AI features in MVP. Reminder channel is swappable via provider interface (`EmailProvider`, `LogProvider`).

---

### Task 1: Scaffold Next.js app + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `vitest.config.ts`

**Interfaces:**
- Produces: a runnable `npm run dev` app; `npm test` runs Vitest; `npm run lint` runs ESLint.

- [ ] **Step 1: Scaffold the app**

Run from `~/Documents/bookcerto`:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

- [ ] **Step 2: Add dependencies**

```bash
npm i drizzle-orm @neondatabase/serverless ioredis bullmq next-auth@beta bcryptjs date-fns date-fns-tz zod
npm i -D drizzle-kit vitest @vitest/coverage-v8 playwright @types/ioredis
```

- [ ] **Step 3: Add Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

- [ ] **Step 4: Add test script**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify + commit**

Run: `npm run dev` (loads localhost), `npm test` (passes trivially), `npm run lint`.

```bash
git add -A && git commit -m "chore: scaffold next.js app with tailwind, vitest"
```

---

### Task 2: Env validation + Neon/Redis connection helpers

**Files:**
- Create: `src/env.ts`, `src/db/index.ts`, `src/lib/redis.ts`, `src/lib/queue.ts`, `src/db/client.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `env` object (typed) with `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`; `db` (Drizzle instance); `redis` (ioredis); `queue(name)` returns `{ add, worker }`.

- [ ] **Step 1: Write env module**

`src/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
});
```

`.env.example`:

```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
REDIS_URL=redis://default:pass@host:6379
AUTH_SECRET=change-me-to-a-long-random-string
```

- [ ] **Step 2: Write DB client**

`src/db/client.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/env";

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql);
```

- [ ] **Step 3: Write Redis + queue helpers**

`src/lib/redis.ts`:

```ts
import { Redis } from "ioredis";
import { env } from "@/env";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
```

`src/lib/queue.ts`:

```ts
import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis";

export function queue(name: string) {
  return new Queue(name, { connection: redis });
}
export function worker(name: string, handler: (job: any) => Promise<void>) {
  return new Worker(name, handler, { connection: redis });
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add env validation and neon/redis connection helpers"
```

---

### Task 3: Drizzle schema + migrations (the data model)

**Files:**
- Create: `src/db/schema.ts`, `drizzle.config.ts`, `drizzle/0000_init.sql`
- Modify: `package.json` (migration scripts)

**Interfaces:**
- Produces: exported table definitions (`tenants`, `users`, `memberships`, `clients`, `staff`, `services`, `serviceStaff`, `schedules`, `scheduleOverrides`, `appointments`, `reminders`, `activityLog`), enums (`roleEnum`, `appointmentStatusEnum`, `reminderStatusEnum`), and a runnable migration.

- [ ] **Step 1: Write the schema**

`src/db/schema.ts`:

```ts
import { pgTable, uuid, text, integer, boolean, timestamp, time, date, jsonb, pgEnum, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "staff", "client"]);
export const appointmentStatusEnum = pgEnum("appointment_status", ["booked", "cancelled", "no_show", "completed"]);
export const reminderStatusEnum = pgEnum("reminder_status", ["queued", "sent", "failed"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
}, (t) => ({ uniq: uniqueIndex("membership_user_tenant").on(t.userId, t.tenantId) }));

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  priceCents: integer("price_cents"),
  color: text("color").notNull().default("#22c55e"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceStaff = pgTable("service_staff", {
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.serviceId, t.staffId] }) }));

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun..6=Sat
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
});

export const scheduleOverrides = pgTable("schedule_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  closed: boolean("closed").notNull().default(false),
  startTime: time("start_time"),
  endTime: time("end_time"),
});

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: appointmentStatusEnum("status").notNull().default("booked"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("email"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: reminderStatusEnum("status").notNull().default("queued"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add drizzle config**

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
import { env } from "@/env";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },
});
```

- [ ] **Step 3: Generate migration**

```bash
npx drizzle-kit generate
```

- [ ] **Step 4: Add the exclusion constraint migration**

Append to the generated SQL (or create `drizzle/0001_exclusion.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(start_at, end_at) WITH &&);
```

- [ ] **Step 5: Add migration scripts to package.json**

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: drizzle schema and migrations including overlap exclusion constraint"
```

---

### Task 4: Auth (register/login) + membership RBAC

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`, `src/lib/session.ts`

**Interfaces:**
- Produces: `auth()` returns session with `user.id`, `user.email`, `user.name`; `requireUser()` (throws/redirects if unauthenticated); `requireTenant()` returns `{ tenantId, role }` for the active workspace; `getMemberships(userId)`.

- [ ] **Step 1: Write Auth.js config**

`src/auth.ts`:

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = creds?.email as string;
        const password = creds?.password as string;
        const [u] = await db.select().from(users).where(eq(users.email, email));
        if (!u) return null;
        if (!(await compare(password, u.passwordHash))) return null;
        return { id: u.id, email: u.email, name: u.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
```

- [ ] **Step 2: Route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 3: Session helpers**

`src/lib/session.ts`:

```ts
import "server-only";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}
```

- [ ] **Step 4: Register + login pages** (client forms POSTing to a server action that hashes with `bcryptjs.hash` and inserts a `users` row, then `signIn("credentials", ...)`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: auth.js credentials login and registration"
```

---

### Task 5: Tenant resolution + RLS

**Files:**
- Create: `src/lib/tenant.ts`, `drizzle/0002_rls.sql`

**Interfaces:**
- Produces: `resolveTenantBySlug(slug)` → `{ id, name, timezone }`; `requireTenant()` → `{ tenantId, role }` (reads active workspace from session token); `scope(tenantId)` helper returning a `where` fragment.

- [ ] **Step 1: Tenant helpers**

`src/lib/tenant.ts`:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { tenants, memberships } from "@/db/schema";
import { redirect } from "next/navigation";

export async function resolveTenantBySlug(slug: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return t ?? null;
}

export async function requireTenant() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, session.user.id));
  if (!m) redirect("/register");
  return { tenantId: m.tenantId, role: m.role };
}
```

- [ ] **Step 2: RLS migration**

`drizzle/0002_rls.sql`:

```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- (repeat pattern for staff, services, appointments, activity_log)
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: tenant resolution and row-level security policies"
```

---

### Task 6: Availability engine (slot computation)

**Files:**
- Create: `src/lib/availability.ts`, `src/lib/availability.test.ts`

**Interfaces:**
- Produces: `computeAvailableSlots(input)` where `input = { date, timezone, durationMinutes, schedule: [{dayOfWeek,startTime,endTime}], overrides: [...], existing: [{startAt,endAt}] }` and output is `Array<{ startAt: Date; endAt: Date }>`.

- [ ] **Step 1: Write the failing test**

`src/lib/availability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "@/lib/availability";

describe("computeAvailableSlots", () => {
  it("returns 30-min slots inside a 9-10 window", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-25",
      timezone: "America/Sao_Paulo",
      durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }],
      overrides: [],
      existing: [],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].startAt.toISOString()).toMatch(/T12:00:00/); // 09:00 -03
  });

  it("excludes a slot overlapping an existing appointment", () => {
    const existing = [{ startAt: new Date("2026-08-25T12:00:00Z"), endAt: new Date("2026-08-25T12:30:00Z") }];
    const slots = computeAvailableSlots({
      date: "2026-08-25", timezone: "America/Sao_Paulo", durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }], overrides: [], existing,
    });
    expect(slots).toHaveLength(1);
  });

  it("honors a closed override", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-25", timezone: "America/Sao_Paulo", durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }],
      overrides: [{ date: "2026-08-25", closed: true }], existing: [],
    });
    expect(slots).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/availability.test.ts`
Expected: FAIL, `computeAvailableSlots` not defined.

- [ ] **Step 3: Implement**

`src/lib/availability.ts`:

```ts
import { fromZonedTime, toZonedTime } from "date-fns-tz";

type Slot = { startAt: Date; endAt: Date };

export function computeAvailableSlots(input: {
  date: string;
  timezone: string;
  durationMinutes: number;
  schedule: { dayOfWeek: number; startTime: string; endTime: string }[];
  overrides: { date: string; closed?: boolean; startTime?: string | null; endTime?: string | null }[];
  existing: { startAt: Date; endAt: Date }[];
}): Slot[] {
  const { date, timezone, durationMinutes, schedule, overrides, existing } = input;
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const ms = durationMinutes * 60_000;

  const windows: { start: Date; end: Date }[] = [];
  const closedDates = new Set(overrides.filter((o) => o.closed).map((o) => o.date));

  if (closedDates.has(date)) return [];

  for (const rule of schedule) {
    if (rule.dayOfWeek !== dayOfWeek) continue;
    const start = fromZonedTime(`${date} ${rule.startTime}:00`, timezone);
    const end = fromZonedTime(`${date} ${rule.endTime}:00`, timezone);
    windows.push({ start, end });
  }

  const slots: Slot[] = [];
  for (const w of windows) {
    let cursor = w.start.getTime();
    while (cursor + ms <= w.end.getTime()) {
      const s = new Date(cursor);
      const e = new Date(cursor + ms);
      const overlaps = existing.some((x) => s < x.endAt && e > x.startAt);
      if (!overlaps) slots.push({ startAt: s, endAt: e });
      cursor += ms;
    }
  }
  return slots;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/availability.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: availability engine with slot computation"
```

---

### Task 7: Booking server action (transaction + overlap rejection)

**Files:**
- Create: `src/app/booking/[slug]/actions.ts`, `src/lib/booking.ts`, `src/lib/booking.test.ts`

**Interfaces:**
- Produces: `createBooking(input)` where `input = { slug, staffId, serviceId, clientName, clientPhone, startAt }`, returns `{ ok: true, appointmentId }` or `{ ok: false, reason: "unavailable" | "invalid" }`. Catches Postgres `23P01` and maps to `unavailable`.

- [ ] **Step 1: Write the integration test**

`src/lib/booking.test.ts` (integration — needs `DATABASE_URL` to a real Neon branch):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createBooking } from "@/lib/booking";
import { db } from "@/db/client";
import { tenants, staff, services } from "@/db/schema";

describe("createBooking", () => {
  let tenantId: string, staffId: string, serviceId: string;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: "Test", slug: "test-" + Date.now() }).returning();
    tenantId = t.id;
    const [st] = await db.insert(staff).values({ tenantId, displayName: "Ana" }).returning();
    staffId = st.id;
    const [sv] = await db.insert(services).values({ tenantId, name: "Corte", durationMinutes: 30 }).returning();
    serviceId = sv.id;
  });

  it("rejects an overlapping booking with reason unavailable", async () => {
    const start = new Date("2026-09-01T12:00:00Z");
    const first = await createBooking({ slug: "unused", staffId, serviceId, clientName: "A", clientPhone: "1", startAt: start, tenantId });
    const second = await createBooking({ slug: "unused", staffId, serviceId, clientName: "B", clientPhone: "2", startAt: start, tenantId });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Implement `createBooking`**

`src/lib/booking.ts`:

```ts
import "server-only";
import { db } from "@/db/client";
import { appointments, clients, activityLog } from "@/db/schema";
import { queue } from "@/lib/queue";
import { redis } from "@/lib/redis";

export async function createBooking(input: {
  tenantId: string; staffId: string; serviceId: string;
  clientName: string; clientPhone: string; startAt: Date; durationMinutes: number;
}) {
  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * 60_000);
  try {
    const [client] = await db.insert(clients).values({
      tenantId: input.tenantId, name: input.clientName, phone: input.clientPhone,
    }).returning();

    const [appt] = await db.insert(appointments).values({
      tenantId: input.tenantId, staffId: input.staffId, serviceId: input.serviceId,
      clientId: client.id, startAt: input.startAt, endAt,
    }).returning();

    await db.insert(activityLog).values({ tenantId: input.tenantId, appointmentId: appt.id, action: "created" });
    await redis.publish(`tenant:${input.tenantId}:appointments`, JSON.stringify({ id: appt.id, event: "created" }));
    return { ok: true as const, appointmentId: appt.id };
  } catch (e: any) {
    if (e?.code === "23P01") return { ok: false as const, reason: "unavailable" as const };
    throw e;
  }
}
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/lib/booking.test.ts`
Then `git add -A && git commit -m "feat: booking transaction with db-level overlap rejection"`.

---

### Task 8: Public booking page + availability API

**Files:**
- Create: `src/app/booking/[slug]/page.tsx`, `src/app/api/availability/route.ts`

**Interfaces:**
- Produces: `/booking/<slug>` renders staff/service pickers + slot grid; `GET /api/availability?staffId=&serviceId=&date=` returns `{ slots: [{startAt,endAt}] }`.

- [ ] **Step 1: Availability API route**

`src/app/api/availability/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { resolveTenantBySlug } from "@/lib/tenant";
import { schedules, appointments, services } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { computeAvailableSlots } from "@/lib/availability";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug")!;
  const staffId = req.nextUrl.searchParams.get("staffId")!;
  const serviceId = req.nextUrl.searchParams.get("serviceId")!;
  const date = req.nextUrl.searchParams.get("date")!;
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [service] = await db.select().from(services).where(eq(services.id, serviceId));
  const rules = await db.select().from(schedules).where(and(eq(schedules.staffId, staffId), eq(schedules.tenantId, tenant.id)));
  const busy = await db.select().from(appointments).where(and(eq(appointments.staffId, staffId), eq(appointments.tenantId, tenant.id)));

  const slots = computeAvailableSlots({
    date, timezone: tenant.timezone, durationMinutes: service.durationMinutes,
    schedule: rules.map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime })),
    overrides: [], existing: busy.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
  });
  return NextResponse.json({ slots });
}
```

- [ ] **Step 2: Booking page** — client component fetches `/api/availability`, renders a slot grid, POSTs to `createBooking` via server action.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: public booking page and availability api"
```

---

### Task 9: SSE realtime endpoint + Redis subscription

**Files:**
- Create: `src/app/api/events/route.ts`, `src/lib/events.ts`

**Interfaces:**
- Produces: `GET /api/events` streams SSE for the active tenant; `publishEvent(tenantId, event)` is already used by booking.

- [ ] **Step 1: SSE route**

`src/app/api/events/route.ts`:

```ts
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId")!;
  const sub = redis.duplicate();
  await sub.subscribe(`tenant:${tenantId}:appointments`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      sub.on("message", (_ch, message) => send(message));
      req.signal.addEventListener("abort", () => sub.disconnect());
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 2: Dashboard subscribes** — a client hook opens `EventSource("/api/events?tenantId=...")` and refreshes the appointment list on each event.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: sse realtime endpoint with redis pubsub"
```

---

### Task 10: Reminder queue (BullMQ worker + providers)

**Files:**
- Create: `src/lib/reminders.ts`, `src/worker.ts`

**Interfaces:**
- Produces: `scheduleReminder(appointmentId, tenantId, dueAt)` enqueues a delayed job; `worker` entrypoint processes `reminders` queue; provider interface `ReminderProvider` with `LogProvider` (default) and `EmailProvider` (SMTP).

- [ ] **Step 1: Provider interface + schedule helper**

`src/lib/reminders.ts`:

```ts
import { queue } from "@/lib/queue";

export interface ReminderProvider { send(due: { to: string; subject: string; body: string }): Promise<void>; }

export class LogProvider implements ReminderProvider {
  async send(due: { to: string; subject: string; body: string }) {
    console.log(`[reminder] to=${due.to} subject=${due.subject}`);
  }
}

export async function scheduleReminder(appointmentId: string, tenantId: string, dueAt: Date) {
  const q = queue("reminders");
  const delay = dueAt.getTime() - Date.now();
  await q.add("send", { appointmentId, tenantId }, { delay: Math.max(delay, 0) });
}
```

- [ ] **Step 2: Worker entrypoint**

`src/worker.ts`:

```ts
import { worker } from "@/lib/queue";
import { LogProvider } from "@/lib/reminders";

const provider = new LogProvider();

worker("reminders", async (job) => {
  await provider.send({ to: "client@example.com", subject: "Lembrete", body: `Appointment ${job.data.appointmentId}` });
});

console.log("worker started");
```

- [ ] **Step 3: Enqueue on booking** — call `scheduleReminder(...)` in `createBooking` after insert.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: bullmq reminder worker with provider interface"
```

---

### Task 11: Owner/staff dashboard (list + status transitions)

**Files:**
- Create: `src/app/dashboard/page.tsx`, `src/app/dashboard/actions.ts`

**Interfaces:**
- Produces: dashboard lists today's/upcoming appointments for the tenant (SSE-live), with `cancel`, `no_show`, `complete` transitions writing to `activity_log`.

- [ ] **Step 1: Dashboard page** — `requireTenant()` gates it; renders appointment list; each action is a server action that updates `appointments.status` and logs to `activityLog`, then `publishEvent`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: dashboard with live list and status transitions"
```

---

### Task 12: Terraform (Neon + Upstash + Cloud Run + Secrets)

**Files:**
- Create: `terraform/main.tf`, `terraform/variables.tf`, `terraform/versions.tf`

**Interfaces:**
- Produces: `terraform apply` provisions Neon DB, Upstash Redis, Artifact Registry, Cloud Run `web` + `worker`, secrets in Secret Manager.

- [ ] **Step 1: `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    neon = { source = "neondatabase/neon", version = "~> 0.5" }
    upstash = { source = "upstash/upstash", version = "~> 1.0" }
  }
}
```

- [ ] **Step 2: `main.tf`** — Neon project/branch, Upstash database, Cloud Run services (web image, worker image same digest, `--command` split), Secret Manager for `DATABASE_URL`/`REDIS_URL`/`AUTH_SECRET`, IAM bindings.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: terraform for neon, upstash, cloud run, secrets"
```

---

### Task 13: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: CI runs lint/typecheck/unit+integration tests on a Neon branch; CD builds + pushes image, runs `drizzle-kit migrate`, deploys web + worker.

- [ ] **Step 1: `ci.yml`** — checkout, setup-node, `npm ci`, `npm run lint`, `tsc --noEmit`, `npm test` with `DATABASE_URL` from a Neon branch secret.

- [ ] **Step 2: `deploy.yml`** — `docker build`, push to Artifact Registry, `gcloud run deploy` for `web` and `worker`, `npx drizzle-kit migrate` against prod DB.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: github actions for test and deploy"
```

---

### Task 14: E2E tests + README

**Files:**
- Create: `e2e/booking.spec.ts`, `playwright.config.ts`, `README.md`

**Interfaces:**
- Produces: `npm run e2e` runs Playwright booking flow against a seeded tenant.

- [ ] **Step 1: Playwright config + booking spec** — seed a tenant/staff/service, visit `/booking/<slug>`, pick a slot, submit, assert success; assert the same slot is now unavailable.

- [ ] **Step 2: README** — setup, local run, migration, deploy, architecture diagram in text.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: readme and e2e booking flow"
```

---

## Self-review notes

- Spec coverage: every success criterion maps to a task — booking (7/8), overlap rejection (7), realtime (9), deploy (12/13).
- `requireTenant` in Task 5 returns only the first membership; workspace switcher (multi-membership) is a known follow-up, out of MVP scope per spec.
- Type consistency: `createBooking` signature in Task 7 matches the action call in Task 8; `computeAvailableSlots` input shape in Task 6 matches the API route in Task 8.
