\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, raw_user_meta_data) VALUES
  ('20000000-0000-4000-8000-000000000091', '{"full_name":"Super Admin statut"}'),
  ('20000000-0000-4000-8000-000000000092', '{"full_name":"Cible statut"}');

INSERT INTO public.user_roles(user_id, role)
VALUES ('20000000-0000-4000-8000-000000000091', 'super_admin');

-- Conserver les audits legitimes produits par la creation du compte.
CREATE TEMP TABLE audit_before_status_tests AS
SELECT *
FROM public.audit_logs
WHERE cible = '20000000-0000-4000-8000-000000000092';

-- Un administrateur simple ne peut plus attribuer des roles.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000001","aal":"aal2"}';

DO $$
BEGIN
  BEGIN
    PERFORM public.change_user_role(
      '20000000-0000-4000-8000-000000000092', 'praticien', 'add'
    );
    RAISE EXCEPTION 'FAIL: admin simple autorise';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Acces refuse' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: gestion des roles refusee a admin';
END;
$$;

RESET ROLE;

-- Suspendre Patient A tout en conservant son ancien JWT simule.
UPDATE auth.users
SET banned_until = now() + interval '15 minutes'
WHERE id = '20000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000002","aal":"aal1"}';

DO $$
DECLARE
  affected integer;
BEGIN
  IF public.account_is_active() THEN
    RAISE EXCEPTION 'FAIL: compte suspendu considere actif';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'FAIL: profils accessibles apres suspension';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles) THEN
    RAISE EXCEPTION 'FAIL: roles accessibles apres suspension';
  END IF;

  UPDATE public.profiles
  SET full_name = 'Modification interdite'
  WHERE id = auth.uid();

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL: profil modifie apres suspension';
  END IF;

  RAISE NOTICE 'PASS: ancien JWT bloque en lecture et modification';
END;
$$;

RESET ROLE;

UPDATE auth.users
SET banned_until = NULL
WHERE id = '20000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000002","aal":"aal1"}';

DO $$
BEGIN
  IF NOT public.account_is_active() OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'FAIL: acces non retabli apres reactivation';
  END IF;
  RAISE NOTICE 'PASS: acces retabli apres reactivation';
END;
$$;

RESET ROLE;

-- Le Super Admin suspendu conserve ses roles mais perd ses autorisations.
UPDATE auth.users
SET banned_until = now() + interval '15 minutes'
WHERE id = '20000000-0000-4000-8000-000000000091';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000091","aal":"aal2"}';

DO $$
BEGIN
  BEGIN
    PERFORM public.change_user_role(
      '20000000-0000-4000-8000-000000000092', 'praticien', 'add'
    );
    RAISE EXCEPTION 'FAIL: Super Admin suspendu autorise';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Compte suspendu ou indisponible' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: changement de role bloque pour Super Admin suspendu';
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $$
BEGIN
  BEGIN
    PERFORM public.admin_finalize_account_atomic(
      '20000000-0000-4000-8000-000000000091',
      '20000000-0000-4000-8000-000000000092',
      'patient', NULL, NULL, ARRAY[]::uuid[]
    );
    RAISE EXCEPTION 'FAIL: finalisation avec acteur suspendu autorisee';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Compte suspendu ou indisponible' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: finalisation bloquee pour acteur suspendu';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000092'
      AND role <> 'patient'
  ) OR EXISTS (
    SELECT * FROM public.audit_logs
    WHERE cible = '20000000-0000-4000-8000-000000000092'
    EXCEPT
    SELECT * FROM audit_before_status_tests
  ) THEN
    RAISE EXCEPTION 'FAIL: changements persistants apres refus';
  END IF;
  RAISE NOTICE 'PASS: aucun role ni audit de succes ajoute apres refus';
END;
$$;

ROLLBACK;
