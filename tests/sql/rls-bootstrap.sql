-- Les roles anon, authenticated et service_role existent deja
-- dans le conteneur medlink-ci-sql-tests.

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT (auth.jwt()->>'sub')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

-- Charger les vrais schemas, politiques et declencheurs.
\ir ../../drizzle/migrations/0000_migration.sql
\ir ../../drizzle/migrations/0001_restrict_record_login.sql
\ir ../../drizzle/migrations/0002_admin_set_role_atomic.sql
\ir ../../drizzle/migrations/0003_admin_finalize_account_atomic.sql

-- Le premier compte devient administrateur via le vrai trigger.
INSERT INTO auth.users(id, raw_user_meta_data)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '{"full_name":"Admin RLS"}'
);

INSERT INTO auth.users(id, raw_user_meta_data) VALUES
  (
    '20000000-0000-4000-8000-000000000002',
    '{"full_name":"Patient A"}'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '{"full_name":"Patient B"}'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '{"full_name":"Praticien RLS"}'
  );

UPDATE public.user_roles
SET role = 'praticien'
WHERE user_id = '20000000-0000-4000-8000-000000000004';

UPDATE public.praticiens
SET user_id = '20000000-0000-4000-8000-000000000004'
WHERE id = 'a0000000-0000-0000-0000-000000000001';