CREATE FUNCTION public.admin_set_role_atomic(
  _actor_id uuid,
  _user_id uuid,
  _role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _previous_roles jsonb;
BEGIN
  IF _actor_id IS NULL OR _user_id IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'Paramètres manquants';
  END IF;

  IF _actor_id = _user_id THEN
    RAISE EXCEPTION 'Vous ne pouvez pas modifier votre propre rôle.';
  END IF;

  -- Sérialiser les modifications de rôles pendant cette opération.
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- Vérifier et verrouiller le compte cible.
  PERFORM id
  FROM auth.users
  WHERE id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  SELECT coalesce(jsonb_agg(role ORDER BY role), '[]'::jsonb)
  INTO _previous_roles
  FROM public.user_roles
  WHERE user_id = _user_id;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (_user_id, _role);

  INSERT INTO public.audit_logs(actor_id, action, cible, details)
  VALUES (
    _actor_id,
    'role_modifie',
    _user_id::text,
    jsonb_build_object(
      'anciens_roles', _previous_roles,
      'role', _role
    )
  );
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_set_role_atomic(
  uuid, uuid, public.app_role
) FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_set_role_atomic(
  uuid, uuid, public.app_role
) TO service_role;