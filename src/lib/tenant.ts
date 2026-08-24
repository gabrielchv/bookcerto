import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { tenants, memberships } from "@/db/schema";
import { redirect } from "next/navigation";

export async function resolveTenantBySlug(slug: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return t ?? null;
}

export async function requireTenant() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [m] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, session.user.id));
  if (!m) redirect("/register");
  return { tenantId: m.tenantId, role: m.role };
}
