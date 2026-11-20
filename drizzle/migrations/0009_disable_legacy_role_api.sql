-- Ancienne API de remplacement des roles.
-- Les changements passent maintenant par change_user_role,
-- qui verifie le JWT, la MFA et les droits dans la transaction.

REVOKE ALL ON FUNCTION public.admin_set_role_atomic(
  uuid, uuid, public.app_role
) FROM PUBLIC, anon, authenticated, service_role;