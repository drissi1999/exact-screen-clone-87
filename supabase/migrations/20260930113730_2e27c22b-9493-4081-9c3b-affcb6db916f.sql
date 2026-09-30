
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;
