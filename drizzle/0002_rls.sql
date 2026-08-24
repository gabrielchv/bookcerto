-- Row-level security policies for tenant isolation.
--
-- NOTE: RLS is deliberately left DISABLED on these tables. No code path yet
-- sets the `app.tenant_id` GUC (the `withTenant()` SET LOCAL wiring is a future
-- task), and the Neon HTTP driver is stateless per request, so enabling RLS
-- would make every tenant query return zero rows and block inserts.
--
-- Enforcement is app-layer today via `requireTenant()` in src/lib/tenant.ts.
-- These policies are written ahead so RLS can be enabled once `withTenant()`
-- is wired up.

CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON staff
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON services
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON schedules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON schedule_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON reminders
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON activity_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
