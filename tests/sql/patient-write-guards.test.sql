BEGIN;

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000002","aal":"aal1"}';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  rejected boolean;
  appointment_id uuid;
  affected_rows integer;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'FAIL: incorrect database role';
  END IF;

  rejected := false;

  BEGIN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (
      '20000000-0000-4000-8000-000000000002',
      'admin'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: patient granted own admin role';
  END IF;

  RAISE NOTICE 'PASS: self promotion blocked';

  rejected := false;

  BEGIN
    INSERT INTO public.rendez_vous(
      patient_id, praticien_id, clinique_id, debut
    ) VALUES (
      '20000000-0000-4000-8000-000000000003',
      'a0000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      now() + interval '50 days'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: appointment created for another patient';
  END IF;

  RAISE NOTICE 'PASS: forged patient appointment blocked';

  rejected := false;

  BEGIN
    INSERT INTO public.documents(
      patient_id, praticien_id, type, titre, contenu
    ) VALUES (
      '20000000-0000-4000-8000-000000000002',
      'a0000000-0000-0000-0000-000000000001',
      'ordonnance',
      'Forbidden document',
      'Fictitious content'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: patient created a medical document';
  END IF;

  RAISE NOTICE 'PASS: patient medical document creation blocked';

  -- Controle positif : une operation legitime doit fonctionner.
  INSERT INTO public.rendez_vous(
    patient_id, praticien_id, clinique_id, debut
  ) VALUES (
    '20000000-0000-4000-8000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    now() + interval '51 days'
  )
  RETURNING id INTO appointment_id;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: own appointment creation';
  END IF;

  RAISE NOTICE 'PASS: own appointment creation allowed';

  UPDATE public.rendez_vous
  SET statut = 'annule'
  WHERE id = appointment_id;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.rendez_vous
    WHERE id = appointment_id AND statut = 'annule'
  ) THEN
    RAISE EXCEPTION 'FAIL: own appointment cancellation';
  END IF;

  RAISE NOTICE 'PASS: own appointment cancellation allowed';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000002'
      AND role <> 'patient'
  ) OR EXISTS (
    SELECT 1 FROM public.rendez_vous
    WHERE patient_id = '20000000-0000-4000-8000-000000000003'
  ) OR EXISTS (
    SELECT 1 FROM public.documents
  ) THEN
    RAISE EXCEPTION 'FAIL: unauthorized changes persisted';
  END IF;

  RAISE NOTICE 'PASS: no unauthorized changes';
END;
$$;

ROLLBACK;
