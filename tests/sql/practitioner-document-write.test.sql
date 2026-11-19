BEGIN;

-- Patient A est suivi par le praticien connecte.
INSERT INTO public.rendez_vous(
  patient_id, praticien_id, clinique_id, debut
) VALUES (
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  now() + interval '60 days'
);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  scenario record;
  rejected boolean;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'FAIL: incorrect database role';
  END IF;

  FOR scenario IN
    SELECT * FROM (VALUES
      (
        'document without MFA',
        'aal1',
        '20000000-0000-4000-8000-000000000002'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid
      ),
      (
        'document for unrelated patient',
        'aal2',
        '20000000-0000-4000-8000-000000000003'::uuid,
        'a0000000-0000-0000-0000-000000000001'::uuid
      ),
      (
        'document impersonating another practitioner',
        'aal2',
        '20000000-0000-4000-8000-000000000002'::uuid,
        'a0000000-0000-0000-0000-000000000002'::uuid
      )
    ) AS cases(label, aal, patient_id, practitioner_id)
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', '20000000-0000-4000-8000-000000000004',
        'aal', scenario.aal
      )::text,
      true
    );

    rejected := false;

    BEGIN
      INSERT INTO public.documents(
        patient_id, praticien_id, type, titre, contenu
      ) VALUES (
        scenario.patient_id,
        scenario.practitioner_id,
        'compte_rendu',
        'Forbidden document',
        'Fictitious content'
      );
    EXCEPTION WHEN insufficient_privilege THEN
      rejected := true;
    END;

    IF NOT rejected THEN
      RAISE EXCEPTION 'FAIL: % accepted', scenario.label;
    END IF;

    RAISE NOTICE 'PASS: % blocked', scenario.label;
  END LOOP;
END;
$$;

SET LOCAL request.jwt.claims =
  '{"sub":"20000000-0000-4000-8000-000000000004","aal":"aal2"}';

-- Controle positif : praticien avec MFA et patient suivi.
INSERT INTO public.documents(
  id, patient_id, praticien_id, type, titre, contenu
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'compte_rendu',
  'Authorized document',
  'Fictitious authorized content'
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.documents
      WHERE id = '60000000-0000-4000-8000-000000000001'
        AND patient_id = '20000000-0000-4000-8000-000000000002'
        AND praticien_id = 'a0000000-0000-0000-0000-000000000001'
        AND contenu = 'Fictitious authorized content'
    )
  THEN
    RAISE EXCEPTION 'FAIL: authorized document or unexpected documents';
  END IF;

  RAISE NOTICE 'PASS: authorized document created';

  IF (
    SELECT count(*) FROM public.audit_logs
    WHERE action = 'document_cree'
      AND actor_id = '20000000-0000-4000-8000-000000000004'
      AND cible = '20000000-0000-4000-8000-000000000002'
      AND details->>'document' =
        '60000000-0000-4000-8000-000000000001'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: document audit';
  END IF;

  RAISE NOTICE 'PASS: document audit recorded';

  IF (
    SELECT count(*) FROM public.notifications
    WHERE user_id = '20000000-0000-4000-8000-000000000002'
      AND message LIKE '%Authorized document'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: patient notification';
  END IF;

  RAISE NOTICE 'PASS: patient notified';
END;
$$;

ROLLBACK;
