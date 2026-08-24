"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { useRealtime } from "@/lib/useRealtime";
import { updateAppointmentStatus } from "./actions";

export type DashboardAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  clientName: string;
  clientPhone: string | null;
  staffName: string;
  serviceName: string;
};

const transitions = [
  { value: "cancelled", label: "Cancel" },
  { value: "no_show", label: "No-show" },
  { value: "completed", label: "Complete" },
] as const;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export function DashboardList({
  tenantId,
  appointments,
}: {
  tenantId: string;
  appointments: DashboardAppointment[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useRealtime(tenantId, () => {
    router.refresh();
  });

  function apply(id: string, status: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateAppointmentStatus(
        id,
        status as "cancelled" | "no_show" | "completed",
      );
      if (result?.error) setError(result.error);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {appointments.length === 0 ? (
        <p className="text-sm text-gray-500">No upcoming appointments.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appointments.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded-md border p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.clientName}</span>
                <span className="text-sm text-gray-500">{a.status}</span>
              </div>
              <p className="text-sm text-gray-600">
                {a.serviceName} with {a.staffName}
              </p>
              <p className="text-sm text-gray-600">
                {fmtTime(a.startAt)} — {fmtTime(a.endAt)}
              </p>
              {a.status === "booked" && (
                <div className="flex gap-2">
                  {transitions.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      disabled={isPending}
                      onClick={() => apply(a.id, t.value)}
                      className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
