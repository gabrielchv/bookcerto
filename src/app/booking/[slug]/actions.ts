"use server";

import { createBooking } from "@/lib/booking";

export type BookingState = { ok?: boolean; error?: string };

export async function bookAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const tenantId = formData.get("tenantId") as string;
  const staffId = formData.get("staffId") as string;
  const serviceId = formData.get("serviceId") as string;
  const clientName = ((formData.get("clientName") as string) ?? "").trim();
  const clientPhone = ((formData.get("clientPhone") as string) ?? "").trim();
  const startAtRaw = (formData.get("startAt") as string) ?? "";
  const durationMinutes = Number(formData.get("durationMinutes") ?? 0);

  if (!clientName || !clientPhone || !startAtRaw || !durationMinutes) {
    return { error: "Name, phone, and a time slot are required." };
  }

  const result = await createBooking({
    tenantId,
    staffId,
    serviceId,
    clientName,
    clientPhone,
    startAt: new Date(startAtRaw),
    durationMinutes,
  });

  if (result.ok) return { ok: true };
  return {
    error:
      result.reason === "unavailable"
        ? "That time slot is no longer available."
        : "Booking failed. Please try again.",
  };
}
