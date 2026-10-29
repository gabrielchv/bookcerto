// Seeds one demo tenant so the deployed app is demonstrable.
//
// Registration only creates a `users` row; nothing in the UI provisions a tenant,
// staff or services. Without this seed `/booking/<slug>` has nothing to render and
// `/api/availability` answers 404 for every slug. That is why the deployment could
// return HTTP 200 while being useless to a visitor.
//
// Idempotent: deletes the demo tenant by slug (cascade) and recreates it.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/seed-demo.ts
//
// Never run against a database with real tenants: the slug is fixed.

import { neonConfig, Pool } from "@neondatabase/serverless";
import { hash } from "bcryptjs";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const SLUG = "aurora";
const OWNER_EMAIL = "owner@bookcerto.demo";
const OWNER_PASSWORD = "bookcerto-demo";

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cascade removes staff, services, schedules and appointments for this tenant.
    await client.query("DELETE FROM tenants WHERE slug = $1", [SLUG]);

    const { rows: t } = await client.query(
      "INSERT INTO tenants (name, slug, timezone) VALUES ($1, $2, $3) RETURNING id",
      ["Aurora Studio", SLUG, "America/Sao_Paulo"],
    );
    const tenantId = t[0].id as string;

    const passwordHash = await hash(OWNER_PASSWORD, 10);
    await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [OWNER_EMAIL, "Aurora Owner", passwordHash],
    );
    const { rows: u } = await client.query("SELECT id FROM users WHERE email = $1", [OWNER_EMAIL]);
    const userId = u[0].id as string;

    const { rows: m } = await client.query(
      "INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner') RETURNING id",
      [userId, tenantId],
    );
    const membershipId = m[0].id as string;

    const { rows: s } = await client.query(
      "INSERT INTO staff (tenant_id, membership_id, display_name, color) VALUES ($1, $2, $3, $4) RETURNING id",
      [tenantId, membershipId, "Gabriel", "#3b82f6"],
    );
    const staffId = s[0].id as string;

    const services: [string, number, number][] = [
      ["Corte masculino", 30, 7000],
      ["Corte + barba", 60, 11000],
      ["Consultoria de imagem", 45, 15000],
    ];
    for (const [name, duration, price] of services) {
      const { rows: sv } = await client.query(
        "INSERT INTO services (tenant_id, name, duration_minutes, price_cents) VALUES ($1, $2, $3, $4) RETURNING id",
        [tenantId, name, duration, price],
      );
      await client.query("INSERT INTO service_staff (service_id, staff_id) VALUES ($1, $2)", [
        sv[0].id,
        staffId,
      ]);
    }

    // Monday through Friday, 09:00-18:00. day_of_week: 0 = Sunday.
    for (let day = 1; day <= 5; day++) {
      await client.query(
        "INSERT INTO schedules (tenant_id, staff_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)",
        [tenantId, staffId, day, "09:00", "18:00"],
      );
    }

    await client.query("COMMIT");
    console.log(`seeded tenant "${SLUG}" (${tenantId})`);
    console.log(`  owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
    console.log(`  booking url: /booking/${SLUG}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
