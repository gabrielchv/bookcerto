import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "@/lib/availability";

describe("computeAvailableSlots", () => {
  it("returns 30-min slots inside a 9-10 window", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-25",
      timezone: "America/Sao_Paulo",
      durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }],
      overrides: [],
      existing: [],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].startAt.toISOString()).toMatch(/T12:00:00/); // 09:00 -03
  });

  it("excludes a slot overlapping an existing appointment", () => {
    const existing = [{ startAt: new Date("2026-08-25T12:00:00Z"), endAt: new Date("2026-08-25T12:30:00Z") }];
    const slots = computeAvailableSlots({
      date: "2026-08-25", timezone: "America/Sao_Paulo", durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }], overrides: [], existing,
    });
    expect(slots).toHaveLength(1);
  });

  it("honors a closed override", () => {
    const slots = computeAvailableSlots({
      date: "2026-08-25", timezone: "America/Sao_Paulo", durationMinutes: 30,
      schedule: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00" }],
      overrides: [{ date: "2026-08-25", closed: true }], existing: [],
    });
    expect(slots).toHaveLength(0);
  });
});
