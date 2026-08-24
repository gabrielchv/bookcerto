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
    const first = await createBooking({ tenantId, staffId, serviceId, clientName: "A", clientPhone: "1", startAt: start, durationMinutes: 30 });
    const second = await createBooking({ tenantId, staffId, serviceId, clientName: "B", clientPhone: "2", startAt: start, durationMinutes: 30 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("unavailable");
  });
});
