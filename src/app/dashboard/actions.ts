"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, activityLog } from "@/db/schema";
import { publishEvent } from "@/lib/events";
import { requireTenant } from "@/lib/tenant";

const statusValues = ["cancelled", "no_show", "completed"] as const;
export type TransitionStatus = (typeof statusValues)[number];

export async function updateAppointmentStatus(
  appointmentId: string,
  status: TransitionStatus,
): Promise<{ error?: string }> {
  const { tenantId, role } = await requireTenant();

  if (role !== "owner" && role !== "staff") {
    return { error: "Not authorized." };
  }

  if (!appointmentId || !statusValues.includes(status)) {
    return { error: "Invalid transition." };
  }

  const [appt] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.tenantId, tenantId),
      ),
    );

  if (!appt) {
    return { error: "Appointment not found." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(appointments)
      .set({ status })
      .where(eq(appointments.id, appt.id));

    await tx.insert(activityLog).values({
      tenantId,
      appointmentId: appt.id,
      action: status,
    });
  });

  try {
    await publishEvent(tenantId, { id: appt.id, event: status });
  } catch (e) {
    console.error("Failed to publish appointment event", e);
  }

  revalidatePath("/dashboard");

  return {};
}
