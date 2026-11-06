import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration test: it exercises the real Postgres exclusion constraint, so it
 * needs a disposable database plus the two other variables env.ts validates.
 *
 * A clean checkout has none of them (CI without the Neon branch secrets), and
 * importing booking.ts would kill the whole suite inside env parsing before a
 * single test runs. Skipping is the honest outcome there: the unit suite still
 * runs, and this test runs wherever a database is actually configured.
 */
const hasDatabase = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL && process.env.AUTH_SECRET,
);

if (!hasDatabase) {
  console.warn(
    "skipping createBooking integration test: set DATABASE_URL, REDIS_URL and AUTH_SECRET to run it",
  );
}

describe.skipIf(!hasDatabase)("createBooking", () => {
  let createBooking: typeof import("@/lib/booking").createBooking;
  let db: typeof import("@/db/client").db;
  let schema: typeof import("@/db/schema");
  let tenantId: string, staffId: string, serviceId: string;

  beforeAll(async () => {
    // Imported here, not at module scope: these modules validate process.env.
    ({ createBooking } = await import("@/lib/booking"));
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");

    const [t] = await db
      .insert(schema.tenants)
      .values({ name: "Test", slug: "test-" + Date.now() })
      .returning();
    tenantId = t.id;
    const [st] = await db
      .insert(schema.staff)
      .values({ tenantId, displayName: "Ana" })
      .returning();
    staffId = st.id;
    const [sv] = await db
      .insert(schema.services)
      .values({ tenantId, name: "Corte", durationMinutes: 30 })
      .returning();
    serviceId = sv.id;
  });

  it("rejects an overlapping booking with reason unavailable", async () => {
    const start = new Date("2026-09-01T12:00:00Z");
    const first = await createBooking({
      tenantId,
      staffId,
      serviceId,
      clientName: "A",
      clientPhone: "1",
      startAt: start,
      durationMinutes: 30,
    });
    const second = await createBooking({
      tenantId,
      staffId,
      serviceId,
      clientName: "B",
      clientPhone: "2",
      startAt: start,
      durationMinutes: 30,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("unavailable");
  });
});
