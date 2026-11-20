CREATE OR REPLACE FUNCTION public.admin_finalize_account_atomic(
  _actor_id uuid,
  _user_id uuid,
  _role public.app_role,
  _praticien_id uuid,
  _specialite text,
  _cliniques uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _full_name text;
  _linked_user uuid;
  _created_praticien_id uuid;
BEGIN
  IF _actor_id IS NULL OR _user_id IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'Paramètres manquants';
  END IF;

  IF _actor_id = _user_id THEN
    RAISE EXCEPTION 'Vous ne pouvez pas finaliser votre propre compte.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(782341);

  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor_id
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  IF _role = 'super_admin' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission super administrateur requise';
  END IF;

  PERFORM id FROM auth.users
  WHERE id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  -- Cette fonction initialise un nouveau compte.
  -- Elle ne doit pas remplacer les roles d'un compte deja privilegie.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'patient'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role <> 'patient'
  ) THEN
    RAISE EXCEPTION 'Compte non eligible a la finalisation';
  END IF;

  -- Une seconde finalisation ne doit pas modifier le compte.
  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'compte_cree_admin'
      AND cible = _user_id::text
  ) THEN
    RAISE EXCEPTION 'Compte déjà finalisé';
  END IF;

  SELECT full_name INTO _full_name
  FROM public.profiles
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable';
  END IF;

  IF _role = 'praticien' THEN
    IF _praticien_id IS NOT NULL THEN
      SELECT user_id INTO _linked_user
      FROM public.praticiens
      WHERE id = _praticien_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Praticien introuvable';
      END IF;

      IF _linked_user IS NOT NULL THEN
        RAISE EXCEPTION 'Praticien déjà rattaché à un compte';
      END IF;

      -- Conserver les cliniques et la spécialité de la fiche existante.
      UPDATE public.praticiens
      SET user_id = _user_id
      WHERE id = _praticien_id;
    ELSE
      IF coalesce(cardinality(_cliniques), 0) > 3 THEN
        RAISE EXCEPTION 'Trois cliniques maximum';
      END IF;

      IF length(btrim(coalesce(_specialite, ''))) > 60 THEN
        RAISE EXCEPTION 'Spécialité trop longue';
      END IF;

      INSERT INTO public.praticiens(user_id, nom, specialite)
      VALUES (
        _user_id,
        _full_name,
        coalesce(
          nullif(btrim(_specialite), ''),
          'Médecine générale'
        )
      )
      RETURNING id INTO _created_praticien_id;

      INSERT INTO public.praticien_cliniques(
        praticien_id, clinique_id
      )
      SELECT _created_praticien_id, clinique_id
      FROM (
        SELECT DISTINCT unnest(_cliniques) AS clinique_id
      ) AS selected_cliniques;
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (_user_id, _role);

  INSERT INTO public.audit_logs(actor_id, action, cible, details)
  VALUES (
    _actor_id,
    'compte_cree_admin',
    _user_id::text,
    jsonb_build_object('role', _role)
  );
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_finalize_account_atomic(
  uuid, uuid, public.app_role, uuid, text, uuid[]
) FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_finalize_account_atomic(
  uuid, uuid, public.app_role, uuid, text, uuid[]
) TO service_role;