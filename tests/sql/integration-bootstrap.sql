\set ON_ERROR_STOP on

-- Schema initial et donnees des tests RLS existants.
\ir rls-bootstrap.sql

-- Evolutions de la branche d'integration.
-- Ne pas executer ce fichier avec -1 :
-- l'ajout de la valeur enum doit etre valide avant son utilisation.
\ir ../../drizzle/migrations/0005_add_super_admin_role.sql
\ir ../../drizzle/migrations/0006_security_reminders_calls.sql
\ir ../../drizzle/migrations/0007_super_admin_clinics.sql
\ir ../../drizzle/migrations/0008_secure_role_management.sql
\ir ../../drizzle/migrations/0009_disable_legacy_role_api.sql
\ir ../../drizzle/migrations/0010_secure_account_finalization.sql
\ir ../../drizzle/migrations/0011_super_admin_account_management.sql
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS banned_until timestamptz;

\ir ../../drizzle/migrations/0012_block_suspended_account_access.sql
\ir ../../drizzle/migrations/0013_guard_suspended_account_management.sql
