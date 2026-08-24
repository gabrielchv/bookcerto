import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { staff, services } from "@/db/schema";
import { resolveTenantBySlug } from "@/lib/tenant";
import { BookingPage } from "./booking-page";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) notFound();

  const [staffList, serviceList] = await Promise.all([
    db.select().from(staff).where(and(eq(staff.tenantId, tenant.id), eq(staff.active, true))),
    db.select().from(services).where(and(eq(services.tenantId, tenant.id), eq(services.active, true))),
  ]);

  return (
    <BookingPage
      slug={slug}
      staff={staffList.map((s) => ({ id: s.id, displayName: s.displayName, color: s.color }))}
      services={serviceList.map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents,
        color: s.color,
      }))}
    />
  );
}
