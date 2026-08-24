import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { resolveTenantBySlug } from "@/lib/tenant";
import { schedules, scheduleOverrides, appointments, services } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { computeAvailableSlots } from "@/lib/availability";

const toHHMM = (t: string) => t.slice(0, 5);

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const slug = params.get("slug");
  const staffId = params.get("staffId");
  const serviceId = params.get("serviceId");
  const date = params.get("date");

  if (!slug || !staffId || !serviceId || !date) {
    return NextResponse.json({ error: "missing query params" }, { status: 400 });
  }

  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenant.id)));
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 404 });

  const rules = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.staffId, staffId), eq(schedules.tenantId, tenant.id)));

  const overrides = await db
    .select()
    .from(scheduleOverrides)
    .where(and(eq(scheduleOverrides.staffId, staffId), eq(scheduleOverrides.tenantId, tenant.id)));

  const busy = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.staffId, staffId),
        eq(appointments.tenantId, tenant.id),
        eq(appointments.status, "booked"),
      ),
    );

  const slots = computeAvailableSlots({
    date,
    timezone: tenant.timezone,
    durationMinutes: service.durationMinutes,
    schedule: rules.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startTime: toHHMM(r.startTime),
      endTime: toHHMM(r.endTime),
    })),
    overrides: overrides.map((o) => ({
      date: o.date,
      closed: o.closed,
      startTime: o.startTime ? toHHMM(o.startTime) : null,
      endTime: o.endTime ? toHHMM(o.endTime) : null,
    })),
    existing: busy.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
  });

  return NextResponse.json({ slots });
}
