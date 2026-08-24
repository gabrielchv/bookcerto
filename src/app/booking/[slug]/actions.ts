"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { staff, services } from "@/db/schema";
import { createBooking } from "@/lib/booking";
import { resolveTenantBySlug } from "@/lib/tenant";

export type BookingState = { ok?: boolean; error?: string };

export async function bookAction(
  slug: string,
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) {
    return { error: "Tenant not found." };
  }

  const staffId = formData.get("staffId") as string;
  const serviceId = formData.get("serviceId") as string;
  const clientName = ((formData.get("clientName") as string) ?? "").trim();
  const clientPhone = ((formData.get("clientPhone") as string) ?? "").trim();
  const startAtRaw = (formData.get("startAt") as string) ?? "";

  if (!staffId || !serviceId || !clientName || !clientPhone || !startAtRaw) {
    return { error: "Name, phone, and a time slot are required." };
  }

  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenant.id)));
  if (!service) {
    return { error: "Service not found." };
  }

  const [staffMember] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.tenantId, tenant.id)));
  if (!staffMember) {
    return { error: "Staff member not found." };
  }

  const result = await createBooking({
    tenantId: tenant.id,
    staffId,
    serviceId,
    clientName,
    clientPhone,
    startAt: new Date(startAtRaw),
    durationMinutes: service.durationMinutes,
  });

  if (result.ok) return { ok: true };
  return {
    error:
      result.reason === "unavailable"
        ? "That time slot is no longer available."
        : "Booking failed. Please try again.",
  };
}
