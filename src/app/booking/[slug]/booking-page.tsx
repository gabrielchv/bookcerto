"use client";

import { useActionState, useEffect, useState } from "react";
import { bookAction, type BookingState } from "./actions";

type StaffItem = { id: string; displayName: string; color: string };
type ServiceItem = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
  color: string;
};
type Slot = { startAt: string; endAt: string };

const initialState: BookingState = {};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export function BookingPage({
  slug,
  tenantId,
  staff,
  services,
}: {
  slug: string;
  tenantId: string;
  staff: StaffItem[];
  services: ServiceItem[];
}) {
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [state, formAction, pending] = useActionState(bookAction, initialState);
  const [refresh, setRefresh] = useState(0);

  const service = services.find((s) => s.id === serviceId);

  useEffect(() => {
    if (!staffId || !serviceId || !date) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ slug, staffId, serviceId, date });
    fetch(`/api/availability?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { slots?: Slot[] }) => {
        if (!cancelled) setSlots(d.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, staffId, serviceId, date, refresh]);

  useEffect(() => {
    if (state.ok) {
      setSelected(null);
      setRefresh((n) => n + 1);
    }
  }, [state.ok]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Book an appointment</h1>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Staff
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Service
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.priceCents != null
                  ? ` — $${(s.priceCents / 100).toFixed(2)}`
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading available times…</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-500">No available times for this day.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {slots.map((slot) => (
            <button
              key={slot.startAt}
              type="button"
              onClick={() => setSelected(slot)}
              className={`rounded-md border px-3 py-2 text-sm ${
                selected?.startAt === slot.startAt
                  ? "border-black bg-black text-white"
                  : "border-gray-300"
              }`}
            >
              {fmtTime(slot.startAt)}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
          <p className="text-sm font-medium">
            Selected: {fmtTime(selected.startAt)} — {fmtTime(selected.endAt)}
          </p>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="staffId" value={staffId} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="startAt" value={selected.startAt} />
          <input type="hidden" name="durationMinutes" value={service?.durationMinutes ?? 0} />
          <input
            name="clientName"
            placeholder="Your name"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="clientPhone"
            placeholder="Phone"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Booking…" : "Confirm booking"}
          </button>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.ok && <p className="text-sm text-green-600">Booked! Choose another slot if needed.</p>}
        </form>
      )}
    </main>
  );
}
