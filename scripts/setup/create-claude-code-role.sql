-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ create-claude-code-role.sql                                              ║
-- ║                                                                          ║
-- ║ One-time setup script that creates the read-only `claude_code` Postgres  ║
-- ║ role used by Claude Code sessions for database queries and read-only     ║
-- ║ Prisma diagnostics.                                                      ║
-- ║                                                                          ║
-- ║ Stage:   Stage 1 of the Claude Code infrastructure rollout.              ║
-- ║ See:     docs/CLAUDE_OPERATIONS.md (especially §5 capability matrix and  ║
-- ║          §7 Layer 1 kill-switch).                                        ║
-- ║                                                                          ║
-- ║ Run as:  the master Postgres role on the `wgu-staging-db` Render         ║
-- ║          instance. Code does NOT run this script. The Operator does.     ║
-- ║                                                                          ║
-- ║ Idempotent: re-running this script against a database where the role    ║
-- ║          already exists does NOT error and does NOT alter the password.  ║
-- ║          Grants are re-applied (no-op if already present).               ║
-- ║                                                                          ║
-- ║ Forbidden: this script never grants INSERT, UPDATE, DELETE, TRUNCATE,    ║
-- ║          ALTER, DROP, CREATE, GRANT, REVOKE, or any DDL privilege.       ║
-- ║          The role has no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION,   ║
-- ║          BYPASSRLS, or INHERIT flags. If you find yourself reaching for  ║
-- ║          any of those, stop and reconsider — Code is not authorized to  ║
-- ║          mutate.                                                         ║
-- ║                                                                          ║
-- ║ Operator setup steps:                                                    ║
-- ║   1. Generate a strong password:                                         ║
-- ║        openssl rand -base64 32                                           ║
-- ║   2. Replace the <REPLACE_WITH_GENERATED_PASSWORD> placeholder below     ║
-- ║      with the generated value. Do NOT commit the populated script.       ║
-- ║   3. Connect as master:                                                  ║
-- ║        psql "$MASTER_DATABASE_URL" -f create-claude-code-role.sql        ║
-- ║   4. Build the claude_code connection string:                            ║
-- ║        postgres://claude_code:<password>@<host>:<port>/<database>?sslmode=require
-- ║   5. Add that connection string as DATABASE_URL in Claude Code project   ║
-- ║      secrets (see CLAUDE_OPERATIONS.md §6.2).                            ║
-- ║   6. Discard the populated script. The password lives in two places      ║
-- ║      only: the database, and Claude Code project secrets.                ║
-- ║                                                                          ║
-- ║ Rotation: see CLAUDE_OPERATIONS.md §6.2 for the rotation procedure.      ║
-- ║ Kill-switch: see CLAUDE_OPERATIONS.md §7 Layer 1 for revocation steps.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

\set ON_ERROR_STOP on

BEGIN;

-- ─── 1. Create the role (idempotent) ────────────────────────────────────────
-- Uses a DO block so a pre-existing role doesn't abort the transaction. Note
-- this preserves the existing password if the role is already present —
-- password rotation goes through the procedure in CLAUDE_OPERATIONS.md §6.2,
-- not through this script.
-- password_encryption is set to scram-sha-256 for the duration of the CREATE
-- ROLE so the server hashes the supplied password with SCRAM rather than the
-- deprecated MD5 scheme. SET LOCAL scopes the change to this transaction.
SET LOCAL password_encryption = 'scram-sha-256';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_code') THEN
    CREATE ROLE claude_code
      WITH LOGIN
           NOSUPERUSER
           NOCREATEDB
           NOCREATEROLE
           NOREPLICATION
           NOBYPASSRLS
           NOINHERIT
           PASSWORD '<REPLACE_WITH_GENERATED_PASSWORD>';
  END IF;
END
$$;

-- ─── 2. Database-level grants ───────────────────────────────────────────────
-- CONNECT lets the role open a session against this database. Without this,
-- everything else is moot. The database name is hardcoded because GRANT
-- requires a literal identifier (CURRENT_DATABASE() is a function and is not
-- accepted in this position). If this script is ever re-used against a
-- different database, update the name here.
GRANT CONNECT ON DATABASE wgu_staging TO claude_code;

-- ─── 3. Schema-level grants ─────────────────────────────────────────────────
-- USAGE on the public schema lets the role see and reference objects in it.
-- This grants visibility, not modification.
GRANT USAGE ON SCHEMA public TO claude_code;

-- ─── 4. Read access to existing tables and sequences ────────────────────────
-- SELECT on every existing table covers application data reads.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_code;

-- SELECT on sequences is required for `prisma migrate status` and any other
-- read-only Prisma diagnostic that touches the migration history.
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO claude_code;

-- The Prisma migration history table lives in `public` by default and is
-- already covered by the GRANT above. We re-state it explicitly here as a
-- defensive marker: if Prisma changes its history-table location in a future
-- release, this script needs an update.
GRANT SELECT ON TABLE public."_prisma_migrations" TO claude_code;

-- ─── 5. Default privileges for future tables ────────────────────────────────
-- ALTER DEFAULT PRIVILEGES governs grants applied to objects created AFTER
-- this statement runs. Without this, every new table created by a future
-- migration would be invisible to claude_code until manually granted.
--
-- The FOR ROLE clause names the role whose newly-created objects this rule
-- applies to. Since migrations are applied by the Operator using master
-- credentials, the master role is the "creator" we care about. Render's
-- default master role name varies by database; we apply the rule for the
-- role currently executing this script, which by definition is master.
DO $$
DECLARE
  current_role_name text := current_user;
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO claude_code',
    current_role_name
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO claude_code',
    current_role_name
  );
END
$$;

COMMIT;

-- ─── 6. Verification ────────────────────────────────────────────────────────
-- After running this script, the Operator should sanity-check the result by
-- running these queries (not part of the transaction; they are diagnostic):
--
--   -- Role exists with the expected attributes:
--   SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
--          rolreplication, rolbypassrls, rolinherit
--   FROM pg_roles WHERE rolname = 'claude_code';
--
--   -- Table-level grants:
--   SELECT table_schema, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'claude_code'
--   ORDER BY table_schema, table_name, privilege_type;
--
-- The expected output: claude_code can LOGIN; every other rol* flag (including
-- rolinherit) is false; privilege_type is exclusively SELECT for every
-- table_name in `public`.
