REVOKE EXECUTE ON FUNCTION public.record_login(text, boolean)
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_login(text, boolean)
TO service_role;