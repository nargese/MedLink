BEGIN;

-- Seul Patient A est suivi par le praticien connecte.
INSERT INTO public.rendez_vous(
  patient_id, praticien_id, clinique_id, debut
) VALUES (
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  now() + interval '40 days'
);

INSERT INTO public.documents(
  id, patient_id, praticien_id, type, titre, contenu
) VALUES
(
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'compte_rendu',
  'Patient suivi',
  'Donnees fictives A'
),
(
  '50000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  'a0000000-0000-0000-0000-000000000002',
  'compte_rendu',
  'Patient non suivi',
  'Donnees fictives B'
);

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000004","aal":"aal1"}';

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'FAIL: incorrect database role';
  END IF;

  IF EXISTS (SELECT 1 FROM public.documents)
    OR EXISTS (SELECT 1 FROM public.rendez_vous)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id <> '20000000-0000-4000-8000-000000000004'
    )
  THEN
    RAISE EXCEPTION 'FAIL: patient data accessible without MFA';
  END IF;

  RAISE NOTICE 'PASS: patient data blocked at aal1';
END;
$$;

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000004","aal":"aal2"}';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.rendez_vous) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.rendez_vous
      WHERE patient_id = '20000000-0000-4000-8000-000000000002'
        AND praticien_id = 'a0000000-0000-0000-0000-000000000001'
    )
  THEN
    RAISE EXCEPTION 'FAIL: practitioner appointment access';
  END IF;

  RAISE NOTICE 'PASS: practitioner appointment accessible at aal2';

  IF (SELECT count(*) FROM public.documents) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.documents
      WHERE id = '50000000-0000-4000-8000-000000000001'
    )
  THEN
    RAISE EXCEPTION 'FAIL: patient document isolation';
  END IF;

  RAISE NOTICE 'PASS: only followed patient document accessible';

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '20000000-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id NOT IN (
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000004'
    )
  ) THEN
    RAISE EXCEPTION 'FAIL: patient profile isolation';
  END IF;

  RAISE NOTICE 'PASS: unrelated patient profiles inaccessible';
END;
$$;

RESET ROLE;
ROLLBACK;
