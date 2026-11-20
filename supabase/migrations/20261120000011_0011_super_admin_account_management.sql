-- Gestion des comptes reservee aux super administrateurs.
-- Conserver is_staff_admin pour les autres fonctions du personnel.

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
  IF NOT public.has_role(v_actor, 'super_admin') THEN
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
      AND role = 'super_admin'
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
