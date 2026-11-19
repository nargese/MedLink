BEGIN;

-- Donnees fictives creees avant d'activer le role patient.
INSERT INTO public.rendez_vous(
  id, patient_id, praticien_id, clinique_id, debut, motif
) VALUES
(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  now() + interval '30 days',
  'Consultation Patient A'
),
(
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  now() + interval '31 days',
  'Consultation Patient B'
);

INSERT INTO public.documents(
  id, patient_id, praticien_id, type, titre, contenu
) VALUES
(
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'compte_rendu',
  'Document Patient A',
  'Donnees fictives A'
),
(
  '40000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'compte_rendu',
  'Document Patient B',
  'Donnees fictives B'
);

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000002","aal":"aal1"}';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  affected_rows integer;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'FAIL: incorrect database role';
  END IF;

  IF (SELECT count(*) FROM public.rendez_vous) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.rendez_vous
      WHERE id = '30000000-0000-4000-8000-000000000001'
    )
  THEN
    RAISE EXCEPTION 'FAIL: appointment read isolation';
  END IF;

  RAISE NOTICE 'PASS: only own appointment visible';

  IF (SELECT count(*) FROM public.documents) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.documents
      WHERE id = '40000000-0000-4000-8000-000000000001'
    )
  THEN
    RAISE EXCEPTION 'FAIL: document read isolation';
  END IF;

  RAISE NOTICE 'PASS: only own document visible';

  UPDATE public.rendez_vous
  SET statut = 'annule'
  WHERE id = '30000000-0000-4000-8000-000000000002';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: another appointment was modified';
  END IF;

  RAISE NOTICE 'PASS: another appointment cannot be cancelled';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rendez_vous
    WHERE id = '30000000-0000-4000-8000-000000000002'
      AND patient_id = '20000000-0000-4000-8000-000000000003'
      AND statut = 'confirme'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.documents
    WHERE id = '40000000-0000-4000-8000-000000000002'
      AND patient_id = '20000000-0000-4000-8000-000000000003'
      AND contenu = 'Donnees fictives B'
  ) THEN
    RAISE EXCEPTION 'FAIL: Patient B data changed';
  END IF;

  RAISE NOTICE 'PASS: Patient B data unchanged';
END;
$$;

ROLLBACK;
