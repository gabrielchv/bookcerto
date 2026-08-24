import { db } from "@/db/client";
import { appointments, clients, activityLog } from "@/db/schema";
import { publishEvent } from "@/lib/events";

export async function createBooking(input: {
  tenantId: string;
  staffId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startAt: Date;
  durationMinutes: number;
}) {
  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * 60_000);
  try {
    const [client] = await db.insert(clients).values({
      tenantId: input.tenantId,
      name: input.clientName,
      phone: input.clientPhone,
    }).returning();

    const [appt] = await db.insert(appointments).values({
      tenantId: input.tenantId,
      staffId: input.staffId,
      serviceId: input.serviceId,
      clientId: client.id,
      startAt: input.startAt,
      endAt,
    }).returning();

    await db.insert(activityLog).values({ tenantId: input.tenantId, appointmentId: appt.id, action: "created" });
    await publishEvent(input.tenantId, { id: appt.id, event: "created" });
    return { ok: true as const, appointmentId: appt.id };
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "23P01" || err.cause?.code === "23P01") {
      return { ok: false as const, reason: "unavailable" as const };
    }
    throw e;
  }
}
