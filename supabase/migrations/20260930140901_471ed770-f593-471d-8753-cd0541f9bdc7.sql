ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS medecin_bootstrapped_at timestamptz;
UPDATE public.tenants t SET medecin_bootstrapped_at = now()
  WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.tenant_id = t.id AND r.role = 'MEDECIN_TRAVAIL');

CREATE OR REPLACE FUNCTION private.has_role_text(_role text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = _role
    AND tenant_id = private.current_tenant_id())
$$;

CREATE OR REPLACE FUNCTION private.can_read_level(_level confidentiality)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.tenant_id = private.current_tenant_id() AND (
      r.role::text IN ('MEDECIN_TRAVAIL','IDEST')
      OR (r.role::text IN ('PDP_COORDINATOR','EXPERT') AND _level <> 'MEDICAL')
      OR (r.role::text = 'SPSTI_ADMIN' AND _level IN ('ADMINISTRATIVE','EMPLOYER_VISIBLE','WORKER_VISIBLE'))
      OR (r.role::text = 'EMPLOYER_HR' AND _level = 'EMPLOYER_VISIBLE')
      OR (r.role::text = 'WORKER' AND _level = 'WORKER_VISIBLE')
    ))
$$;

CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = private.current_tenant_id()
    AND role::text IN ('MEDECIN_TRAVAIL','IDEST','PDP_COORDINATOR','SPSTI_ADMIN','EXPERT'))
$$;

-- who may grant/revoke a given role for a given target user in the caller's tenant
CREATE OR REPLACE FUNCTION private.can_manage_role(_target uuid, _tenant uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _tenant = private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _target AND p.tenant_id = _tenant)
    AND CASE WHEN _role IN ('MEDECIN_TRAVAIL','IDEST') THEN private.has_role_text('MEDECIN_TRAVAIL')
             ELSE private.has_role_text('SPSTI_ADMIN') END
$$;
GRANT EXECUTE ON FUNCTION private.can_manage_role(uuid, uuid, app_role) TO authenticated;

DROP POLICY IF EXISTS "admin grants roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin revokes roles" ON public.user_roles;
CREATE POLICY "authorized grants roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_role(user_id, tenant_id, role));
CREATE POLICY "authorized revokes roles" ON public.user_roles FOR DELETE TO authenticated
  USING (private.can_manage_role(user_id, tenant_id, role));