-- Verifier le statut actuel dans Auth, sans se fier a un ancien JWT.
CREATE FUNCTION public.account_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = auth.uid()
      AND (
        u.banned_until IS NULL
        OR u.banned_until <= pg_catalog.now()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.account_is_active()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.account_is_active()
TO authenticated;

-- Ajouter une condition restrictive aux tables publiques deja sous RLS.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT n.nspname, c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY medlink_active_account ON %I.%I
       AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT public.account_is_active()))
       WITH CHECK ((SELECT public.account_is_active()))',
      target.nspname,
      target.relname
    );
  END LOOP;
END;
$$;
