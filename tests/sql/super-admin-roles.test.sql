BEGIN;

-- Compte fictif cree uniquement pour ce test.
INSERT INTO auth.users(id, raw_user_meta_data)
VALUES (
  '20000000-0000-4000-8000-000000000005',
  '{"full_name":"Super Admin Test"}'
);

INSERT INTO public.user_roles(user_id, role)
VALUES ('20000000-0000-4000-8000-000000000005', 'super_admin');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  scenario record;
  rejected boolean;
BEGIN
  FOR scenario IN
    SELECT * FROM (VALUES
      (
        'patient non autorise',
        '20000000-0000-4000-8000-000000000002',
        'aal2',
        '20000000-0000-4000-8000-000000000003',
        'admin',
        'Acces refuse'
      ),
      (
        'admin sans MFA',
        '20000000-0000-4000-8000-000000000001',
        'aal1',
        '20000000-0000-4000-8000-000000000003',
        'praticien',
        'Authentification MFA requise'
      ),
      (
        'promotion super_admin par admin',
        '20000000-0000-4000-8000-000000000001',
        'aal2',
        '20000000-0000-4000-8000-000000000003',
        'super_admin',
        'Permission super administrateur requise'
      ),
      (
        'modification du super_admin par admin',
        '20000000-0000-4000-8000-000000000001',
        'aal2',
        '20000000-0000-4000-8000-000000000005',
        'admin',
        'Permission super administrateur requise'
      ),
      (
        'modification de son propre compte',
        '20000000-0000-4000-8000-000000000005',
        'aal2',
        '20000000-0000-4000-8000-000000000005',
        'admin',
        'Modification de votre propre role interdite'
      )
    ) AS cases(label, actor, aal, target, role_name, expected_error)
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', scenario.actor,
        'aal', scenario.aal
      )::text,
      true
    );

    rejected := false;

    BEGIN
      PERFORM public.change_user_role(
        scenario.target::uuid,
        scenario.role_name::public.app_role,
        'add'
      );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> scenario.expected_error THEN
        RAISE EXCEPTION 'FAIL: erreur inattendue pour % : %',
          scenario.label, SQLERRM;
      END IF;
      rejected := true;
    END;

    IF NOT rejected THEN
      RAISE EXCEPTION 'FAIL: operation autorisee pour %',
        scenario.label;
    END IF;

    RAISE NOTICE 'PASS: %', scenario.label;
  END LOOP;
END;
$$;

-- Ajout autorise par un super administrateur avec MFA.
SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000005","aal":"aal2"}';

SELECT public.change_user_role(
  '20000000-0000-4000-8000-000000000003',
  'praticien',
  'add'
);

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000003'
      AND role = 'patient'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000003'
      AND role = 'praticien'
  ) THEN
    RAISE EXCEPTION 'FAIL: ajout du role ou conservation du role patient';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = '20000000-0000-4000-8000-000000000005'
      AND cible = '20000000-0000-4000-8000-000000000003'
      AND action = 'role_modifie'
      AND details->>'operation' = 'INSERT'
      AND details->>'role' = 'praticien'
  ) THEN
    RAISE EXCEPTION 'FAIL: audit du changement de role absent';
  END IF;

  RAISE NOTICE 'PASS: role ajoute, role patient conserve et acteur audite';
END;
$$;

SET LOCAL ROLE authenticated;

SELECT public.change_user_role(
  '20000000-0000-4000-8000-000000000003',
  'praticien',
  'remove'
);

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000003'
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000003'
      AND role = 'patient'
  ) THEN
    RAISE EXCEPTION 'FAIL: retrait incorrect des roles';
  END IF;

  RAISE NOTICE 'PASS: retrait du role praticien et conservation du role patient';
END;
$$;

ROLLBACK;