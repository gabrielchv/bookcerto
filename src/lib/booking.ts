import { db } from "@/db/client";
import { appointments, clients, activityLog } from "@/db/schema";
import { publishEvent } from "@/lib/events";
import { scheduleReminder } from "@/lib/reminders";

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
    const result = await db.transaction(async (tx) => {
      const [client] = await tx
        .insert(clients)
        .values({
          tenantId: input.tenantId,
          name: input.clientName,
          phone: input.clientPhone,
        })
        .returning();

      const [appt] = await tx
        .insert(appointments)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          serviceId: input.serviceId,
          clientId: client.id,
          startAt: input.startAt,
          endAt,
        })
        .returning();

      await tx.insert(activityLog).values({
        tenantId: input.tenantId,
        appointmentId: appt.id,
        action: "created",
      });

      return appt;
    });

    try {
      await publishEvent(input.tenantId, { id: result.id, event: "created" });
    } catch (e) {
      console.error("Failed to publish appointment event", e);
    }

    const leadMs = 24 * 60 * 60 * 1000;
    const dueAt = new Date(input.startAt.getTime() - leadMs);
    if (dueAt.getTime() > Date.now()) {
      try {
        await scheduleReminder(result.id, input.tenantId, dueAt);
      } catch (e) {
        console.error("Failed to schedule appointment reminder", e);
      }
    }

    return { ok: true as const, appointmentId: result.id };
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "23P01" || err.cause?.code === "23P01") {
      return { ok: false as const, reason: "unavailable" as const };
    }
    throw e;
  }
}
