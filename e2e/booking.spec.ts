import { test, expect } from "playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  tenants,
  staff,
  services,
  schedules,
  appointments,
} from "@/db/schema";

let slug: string;
let tenantId: string;
let staffId: string;
let serviceId: string;

test.beforeAll(async () => {
  slug = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [t] = await db
    .insert(tenants)
    .values({ name: "E2E Test", slug })
    .returning();
  tenantId = t.id;

  const [st] = await db
    .insert(staff)
    .values({ tenantId, displayName: "Alice" })
    .returning();
  staffId = st.id;

  const [sv] = await db
    .insert(services)
    .values({ tenantId, name: "Consulta", durationMinutes: 30 })
    .returning();
  serviceId = sv.id;

  // Seed every day of the week so "today" always has slots regardless of the
  // timezone the browser (and the tenant default) happen to be in.
  for (let d = 0; d <= 6; d++) {
    await db.insert(schedules).values({
      tenantId,
      staffId,
      dayOfWeek: d,
      startTime: "08:00:00",
      endTime: "20:00:00",
    });
  }
});

test.afterAll(async () => {
  if (tenantId) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function pickFirstSlot(page: import("playwright/test").Page) {
  const slotButtons = page.locator("button[type=button]");
  await expect(slotButtons.first()).toBeVisible({ timeout: 15_000 });
  await slotButtons.first().click();
  return {
    startAt: await page.locator('input[name="startAt"]').inputValue(),
    date: await page.locator('input[type="date"]').inputValue(),
  };
}

test("public booking completes and the slot disappears from availability", async ({
  page,
  request,
}) => {
  await page.goto(`/booking/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Book an appointment" }),
  ).toBeVisible();

  const { startAt, date } = await pickFirstSlot(page);

  await page.getByPlaceholder("Your name").fill("João Teste");
  await page.getByPlaceholder("Phone").fill("+55 11 99999-0000");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  // On success the app clears the selection, unmounting the booking form.
  await expect(page.locator('input[name="clientName"]')).toBeHidden({
    timeout: 15_000,
  });

  // The same slot must now be absent from the availability API.
  const query = new URLSearchParams({ slug, staffId, serviceId, date });
  const res = await request.get(`/api/availability?${query.toString()}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { slots: { startAt: string }[] };
  expect(body.slots.map((s) => s.startAt)).not.toContain(startAt);
});

test("a committed appointment row matches the chosen slot", async ({ page }) => {
  await page.goto(`/booking/${slug}`);

  const { startAt } = await pickFirstSlot(page);

  await page.getByPlaceholder("Your name").fill("Maria Teste");
  await page.getByPlaceholder("Phone").fill("+55 11 98888-0000");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.locator('input[name="clientName"]')).toBeHidden({
    timeout: 15_000,
  });

  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.staffId, staffId),
      ),
    );

  expect(rows.map((r) => r.startAt.toISOString())).toContain(startAt);
});
