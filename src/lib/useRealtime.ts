"use client";

import { useEffect, useRef } from "react";
import type { AppointmentEvent } from "@/lib/events";

export function useRealtime(
  tenantId: string | undefined,
  onEvent: (event: AppointmentEvent) => void,
) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!tenantId) return;

    const source = new EventSource(
      `/api/events?tenantId=${encodeURIComponent(tenantId)}`,
    );

    source.onmessage = (e) => {
      try {
        callbackRef.current(JSON.parse(e.data) as AppointmentEvent);
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, [tenantId]);
}
