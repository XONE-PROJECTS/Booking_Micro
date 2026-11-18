-- Database-level guarantees that application code cannot bypass:
-- no double booking of exclusive resources, tenant isolation through row-level security,
-- and a restricted role used by API requests.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Exclusive resources can never have two held/active allocations whose blocked periods overlap.
-- Ranges are half-open [start, end), so a check-out and the next check-in may share an instant.
ALTER TABLE "booking_allocations"
  ADD CONSTRAINT "booking_allocations_no_overlap"
  EXCLUDE USING gist ("resource_id" WITH =, "blocked_period" WITH &&)
  WHERE ("exclusive" AND "status" IN ('held', 'active') AND "resource_id" IS NOT NULL);
--> statement-breakpoint

ALTER TABLE "booking_allocations"
  ADD CONSTRAINT "booking_allocations_period_valid" CHECK (NOT isempty("period") AND "period" <@ "blocked_period");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_allocations_resource_gist"
  ON "booking_allocations" USING gist ("resource_id", "blocked_period")
  WHERE "status" IN ('held', 'active');
--> statement-breakpoint

-- Applies the tenant isolation policy to every table with a tenant_id column.
-- Later migrations that add tenant tables call this function again.
CREATE OR REPLACE FUNCTION app_apply_tenant_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
      r.table_name,
      $p$current_setting('app.bypass_rls', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$p$,
      $p$current_setting('app.bypass_rls', true) = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$p$
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

SELECT app_apply_tenant_rls();
--> statement-breakpoint

-- Restricted role used inside tenant transactions (SET LOCAL ROLE booking_app).
-- Creation is skipped when the migrating user cannot create roles; RLS still applies to non-owner logins.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'booking_app role not created: insufficient privilege';
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_app') THEN
    EXECUTE format('GRANT booking_app TO %I', current_user);
    GRANT USAGE ON SCHEMA public TO booking_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO booking_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO booking_app;
    -- The audit trail is append-only for request traffic; retention runs outside tenant transactions.
    REVOKE UPDATE, DELETE ON "audit_logs" FROM booking_app;
    REVOKE UPDATE, DELETE ON "booking_status_history" FROM booking_app;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'booking_app grants skipped: insufficient privilege';
END;
$$;
