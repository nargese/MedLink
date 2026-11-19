BEGIN;

INSERT INTO public.rendez_vous(
  id, patient_id, praticien_id, clinique_id, debut, motif
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  now() + interval '70 days',
  'Original reason'
);

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000002","aal":"aal1"}';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.rendez_vous
    SET statut = 'annule',
        motif = 'Unauthorized reason change'
    WHERE id = '70000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION
      'FAIL: patient can change appointment reason while cancelling';
  END IF;

  RAISE NOTICE 'PASS: appointment reason change blocked';
END;
$$;

RESET ROLE;
ROLLBACK;
