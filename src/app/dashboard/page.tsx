import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, clients, staff, services } from "@/db/schema";
import { requireTenant } from "@/lib/tenant";
import { DashboardList } from "./dashboard-list";

export default async function DashboardPage() {
  const { tenantId } = await requireTenant();

  const rows = await db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      clientName: clients.name,
      clientPhone: clients.phone,
      staffName: staff.displayName,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(staff, eq(appointments.staffId, staff.id))
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .where(
      and(eq(appointments.tenantId, tenantId), gte(appointments.startAt, new Date())),
    )
    .orderBy(asc(appointments.startAt));

  const items = rows.map((r) => ({
    id: r.id,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    status: r.status,
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    staffName: r.staffName,
    serviceName: r.serviceName,
  }));

  return <DashboardList tenantId={tenantId} appointments={items} />;
}
