BEGIN;

INSERT INTO auth.users(id, raw_user_meta_data) VALUES
  (
    '20000000-0000-4000-8000-000000000005',
    '{"full_name":"Super Admin Test"}'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '{"full_name":"Nouveau Compte Test"}'
  );

INSERT INTO public.user_roles(user_id, role)
VALUES ('20000000-0000-4000-8000-000000000005', 'super_admin');

DO $$
BEGIN
  IF has_function_privilege(
    'service_role',
    'public.admin_set_role_atomic(uuid,uuid,public.app_role)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: ancienne API encore accessible';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.admin_finalize_account_atomic(uuid,uuid,public.app_role,uuid,text,uuid[])',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.admin_finalize_account_atomic(uuid,uuid,public.app_role,uuid,text,uuid[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: finalisation accessible au client';
  END IF;

  RAISE NOTICE 'PASS: ancienne API bloquee et finalisation reservee au serveur';
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_finalize_account_atomic(
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000006',
      'super_admin', NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Permission super administrateur requise' THEN
      RAISE;
    END IF;
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: admin autorise a creer un super_admin';
  END IF;

  RAISE NOTICE 'PASS: creation super_admin refusee pour admin';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000006'
      AND role = 'patient'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000006'
      AND role <> 'patient'
  ) OR EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE cible = '20000000-0000-4000-8000-000000000006'
      AND action = 'compte_cree_admin'
  ) THEN
    RAISE EXCEPTION 'FAIL: compte modifie apres refus';
  END IF;

  RAISE NOTICE 'PASS: compte patient et audit de finalisation inchanges apres refus';
END;
$$;

SET LOCAL ROLE service_role;

SELECT public.admin_finalize_account_atomic(
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000006',
  'super_admin', NULL, NULL, NULL
);

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000006'
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000006'
      AND role = 'super_admin'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = '20000000-0000-4000-8000-000000000005'
      AND cible = '20000000-0000-4000-8000-000000000006'
      AND action = 'compte_cree_admin'
      AND details->>'role' = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'FAIL: finalisation ou audit incorrect';
  END IF;

  RAISE NOTICE 'PASS: finalisation super_admin autorisee et auditee';
END;
$$;

ROLLBACK;