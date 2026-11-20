CREATE OR REPLACE FUNCTION public.rdv_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() = OLD.patient_id
    AND NOT public.is_staff_admin()
  THEN
    IF NEW.statut IS DISTINCT FROM 'annule'::public.rdv_statut
      OR (to_jsonb(NEW) - 'statut')
        IS DISTINCT FROM (to_jsonb(OLD) - 'statut')
    THEN
      RAISE EXCEPTION 'Modification non autorisee';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
