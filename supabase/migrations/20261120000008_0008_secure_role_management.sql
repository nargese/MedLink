-- Migration 0004 : securisation de la gestion des roles

-- Compatibilite admin et super_admin
CREATE OR REPLACE FUNCTION public.is_staff_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_aal2()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    );
$$;

-- Ajout ou retrait securise d'un role
CREATE OR REPLACE FUNCTION public.change_user_role(
  _target_user uuid,
  _role public.app_role,
  _action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_super_admin boolean;
  v_target_is_super_admin boolean;
  v_super_admin_count integer;
BEGIN
  -- Eviter les modifications concurrentes
  PERFORM pg_catalog.pg_advisory_xact_lock(782341);

  -- Validation des parametres obligatoires
  IF _target_user IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'Utilisateur ou role invalide';
  END IF;

  -- Authentification et MFA
  IF v_actor IS NULL OR NOT public.is_aal2() THEN
    RAISE EXCEPTION 'Authentification MFA requise';
  END IF;

  -- Autorisation administrateur
  IF NOT (
    public.has_role(v_actor, 'admin')
    OR public.has_role(v_actor, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Acces refuse';
  END IF;

  -- Validation de l'operation
  IF _action IS NULL OR _action NOT IN ('add', 'remove') THEN
    RAISE EXCEPTION 'Operation invalide';
  END IF;

  -- Interdire la modification de son propre compte
  IF _target_user = v_actor THEN
    RAISE EXCEPTION 'Modification de votre propre role interdite';
  END IF;

  -- Verifier l'existence de l'utilisateur
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = _target_user
  ) THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  v_is_super_admin :=
    public.has_role(v_actor, 'super_admin');

  v_target_is_super_admin :=
    public.has_role(_target_user, 'super_admin');

  -- Proteger les super administrateurs
  IF (v_target_is_super_admin OR _role = 'super_admin')
     AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Permission super administrateur requise';
  END IF;

  -- Ajouter un role sans supprimer les autres
  IF _action = 'add' THEN

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user, _role)
    ON CONFLICT (user_id, role) DO NOTHING;

  -- Retirer uniquement le role demande
  ELSIF _action = 'remove' THEN
        -- Interdire le retrait du dernier role d'un utilisateur.
    IF EXISTS (
  SELECT 1
  FROM public.user_roles
  WHERE user_id = _target_user
    AND role = _role
)
AND (
  SELECT count(*)
  FROM public.user_roles
  WHERE user_id = _target_user
) <= 1 THEN
      RAISE EXCEPTION
        'Impossible de retirer le dernier role de cet utilisateur';
    END IF;
    -- Proteger le dernier super administrateur
    IF _role = 'super_admin' AND v_target_is_super_admin THEN

      SELECT count(*)
      INTO v_super_admin_count
      FROM public.user_roles
      WHERE role = 'super_admin';

      IF v_super_admin_count <= 1 THEN
        RAISE EXCEPTION 'Impossible de retirer le dernier super administrateur';
      END IF;

    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = _target_user
      AND role = _role;

  END IF;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.change_user_role(
  uuid, public.app_role, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.change_user_role(
  uuid, public.app_role, text
) TO authenticated;
-- Audit fiable des modifications de roles
CREATE OR REPLACE FUNCTION public.role_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_role public.app_role;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_role := OLD.role;
  ELSE
    v_user_id := NEW.user_id;
    v_role := NEW.role;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    cible,
    details
  )
  VALUES (
    auth.uid(),
    'role_modifie',
    v_user_id::text,
    jsonb_build_object(
      'operation', TG_OP,
      'role', v_role
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
-- Restreindre les acces directs a la table des roles
REVOKE ALL PRIVILEGES ON TABLE public.user_roles
FROM PUBLIC, anon, authenticated;

-- Conserver la lecture soumise aux politiques RLS
GRANT SELECT ON TABLE public.user_roles
TO authenticated;
