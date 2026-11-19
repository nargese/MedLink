-- Appliquer les vraies migrations dans une transaction.
BEGIN;

\ir ../../drizzle/migrations/0002_admin_set_role_atomic.sql
\ir ../../drizzle/migrations/0003_admin_finalize_account_atomic.sql

COMMIT;

-- Verifier les permissions des deux fonctions.
DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.admin_set_role_atomic(uuid,uuid,public.app_role)',
    'public.admin_finalize_account_atomic(uuid,uuid,public.app_role,uuid,text,uuid[])'
  ]
  LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
      OR has_function_privilege('authenticated', signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'FAIL: permissions for %', signature;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: permissions';
END;
$$;

-- Tester un changement de role reussi.
BEGIN;

SET LOCAL ROLE service_role;

SELECT public.admin_set_role_atomic(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'praticien'
);

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT array_agg(role::text ORDER BY role)
    FROM public.user_roles
    WHERE user_id = '10000000-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM ARRAY['praticien']::text[]
  OR (
    SELECT count(*)
    FROM public.audit_logs
    WHERE action = 'role_modifie'
      AND actor_id = '10000000-0000-4000-8000-000000000001'
      AND cible = '10000000-0000-4000-8000-000000000002'
      AND details->>'role' = 'praticien'
      AND details->'anciens_roles' = '["patient"]'::jsonb
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: role change or audit';
  END IF;

  RAISE NOTICE 'PASS: role change and audit';
END;
$$;

ROLLBACK;

-- Tester une finalisation de compte reussie.
BEGIN;

SET LOCAL ROLE service_role;

SELECT public.admin_finalize_account_atomic(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'praticien',
  NULL,
  'Cardiologie',
  ARRAY['11111111-1111-1111-1111-111111111111']::uuid[]
);

RESET ROLE;

DO $$
DECLARE
  practitioner_id uuid;
BEGIN
  SELECT id INTO STRICT practitioner_id
  FROM public.praticiens
  WHERE user_id = '10000000-0000-4000-8000-000000000002'
    AND nom = 'Compte Test'
    AND specialite = 'Cardiologie';

  IF NOT EXISTS (
    SELECT 1
    FROM public.praticien_cliniques
    WHERE praticien_id = practitioner_id
      AND clinique_id = '11111111-1111-1111-1111-111111111111'
  ) OR (
    SELECT array_agg(role::text ORDER BY role)
    FROM public.user_roles
    WHERE user_id = '10000000-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM ARRAY['praticien']::text[]
  OR (
    SELECT count(*)
    FROM public.audit_logs
    WHERE action = 'compte_cree_admin'
      AND actor_id = '10000000-0000-4000-8000-000000000001'
      AND cible = '10000000-0000-4000-8000-000000000002'
      AND details->>'role' = 'praticien'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: account finalization';
  END IF;

  RAISE NOTICE 'PASS: account finalization';
END;
$$;

ROLLBACK;

-- Provoquer un echec d'audit pour tester les rollbacks.
BEGIN;

CREATE FUNCTION public.test_reject_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TEST_AUDIT_FAILURE';
END;
$$;

CREATE TRIGGER test_reject_audit
BEFORE INSERT ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.test_reject_audit();

SET LOCAL ROLE service_role;

DO $$
DECLARE
  operation text;
  rejected boolean;
BEGIN
  FOREACH operation IN ARRAY ARRAY['role', 'account']
  LOOP
    rejected := false;

    BEGIN
      IF operation = 'role' THEN
        PERFORM public.admin_set_role_atomic(
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000002',
          'praticien'
        );
      ELSE
        PERFORM public.admin_finalize_account_atomic(
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000002',
          'praticien',
          NULL,
          'Cardiologie',
          ARRAY['11111111-1111-1111-1111-111111111111']::uuid[]
        );
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'TEST_AUDIT_FAILURE' THEN
        RAISE;
      END IF;

      rejected := true;
    END;

    IF NOT rejected THEN
      RAISE EXCEPTION
        'FAIL: audit failure not triggered for %',
        operation;
    END IF;
  END LOOP;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.praticiens)
    OR EXISTS (SELECT 1 FROM public.praticien_cliniques)
    OR EXISTS (SELECT 1 FROM public.audit_logs)
    OR (
      SELECT array_agg(role::text ORDER BY role)
      FROM public.user_roles
      WHERE user_id = '10000000-0000-4000-8000-000000000002'
    ) IS DISTINCT FROM ARRAY['patient']::text[]
  THEN
    RAISE EXCEPTION 'FAIL: partial changes after audit failure';
  END IF;

  RAISE NOTICE 'PASS: rollback after audit failure';
END;
$$;

ROLLBACK;