BEGIN;

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

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'FAIL: test role bypasses RLS';
  END IF;

  IF (
    SELECT count(*) FROM public.profiles
    WHERE id = '20000000-0000-4000-8000-000000000002'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: own profile inaccessible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id <> '20000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'FAIL: another profile is visible';
  END IF;

  RAISE NOTICE 'PASS: profile read isolation';

  UPDATE public.profiles
  SET full_name = 'Unauthorized change'
  WHERE id = '20000000-0000-4000-8000-000000000003';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: another profile was modified';
  END IF;

  UPDATE public.profiles
  SET full_name = 'Patient A Updated'
  WHERE id = '20000000-0000-4000-8000-000000000002';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '20000000-0000-4000-8000-000000000002'
      AND full_name = 'Patient A Updated'
  ) THEN
    RAISE EXCEPTION 'FAIL: own profile update';
  END IF;

  RAISE NOTICE 'PASS: profile update isolation';

  IF (
    SELECT count(*) FROM public.user_roles
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '20000000-0000-4000-8000-000000000002'
      AND role = 'patient'
  ) THEN
    RAISE EXCEPTION 'FAIL: role read isolation';
  END IF;

  RAISE NOTICE 'PASS: role read isolation';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '20000000-0000-4000-8000-000000000003'
      AND full_name = 'Patient B'
  ) THEN
    RAISE EXCEPTION 'FAIL: Patient B profile changed';
  END IF;

  RAISE NOTICE 'PASS: Patient B profile unchanged';
END;
$$;

ROLLBACK;
