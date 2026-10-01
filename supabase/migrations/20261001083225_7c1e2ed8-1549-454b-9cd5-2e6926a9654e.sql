CREATE TABLE public.case_deadline_done (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  code text NOT NULL,
  done_on date NOT NULL,
  done_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, code)
);
GRANT SELECT ON public.case_deadline_done TO authenticated;
GRANT ALL ON public.case_deadline_done TO service_role;
ALTER TABLE public.case_deadline_done ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read own tenant deadline completions" ON public.case_deadline_done
  FOR SELECT TO authenticated USING (private.is_staff() AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE TABLE public.demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  organisation text NOT NULL,
  email text NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.demo_requests TO authenticated;
GRANT ALL ON public.demo_requests TO service_role;
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.is_any_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'SPSTI_ADMIN')
$$;
GRANT EXECUTE ON FUNCTION private.is_any_admin() TO authenticated;
CREATE POLICY "Admins read demo requests" ON public.demo_requests FOR SELECT TO authenticated USING (private.is_any_admin());

CREATE OR REPLACE FUNCTION public.reset_demo(_actor uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t uuid := private.actor_tenant(_actor); n_cases int; n_workers int; n_companies int;
BEGIN
  IF t IS NULL OR NOT private.actor_has_role(_actor, t, 'SPSTI_ADMIN') THEN RAISE EXCEPTION 'required role missing'; END IF;
  SELECT count(*) INTO n_cases FROM public.cases WHERE tenant_id = t;
  SELECT count(*) INTO n_workers FROM public.workers WHERE tenant_id = t;
  DELETE FROM public.case_deadline_done WHERE tenant_id = t;
  DELETE FROM public.plan_tasks WHERE tenant_id = t;
  DELETE FROM public.return_plans WHERE tenant_id = t;
  DELETE FROM public.case_risk_scores WHERE tenant_id = t;
  DELETE FROM public.case_avis WHERE tenant_id = t;
  DELETE FROM public.ai_drafts WHERE tenant_id = t;
  DELETE FROM public.case_events WHERE tenant_id = t;
  DELETE FROM public.coordination_tasks WHERE tenant_id = t;
  DELETE FROM public.simulated_messages WHERE tenant_id = t;
  DELETE FROM public.worker_sessions WHERE tenant_id = t;
  DELETE FROM public.worker_links WHERE tenant_id = t;
  DELETE FROM public.documents WHERE tenant_id = t;
  DELETE FROM public.work_stoppages WHERE tenant_id = t;
  DELETE FROM public.import_row_errors WHERE tenant_id = t;
  DELETE FROM public.import_runs WHERE tenant_id = t;
  DELETE FROM public.audit_log WHERE tenant_id = t AND case_id IS NOT NULL;
  DELETE FROM public.cases WHERE tenant_id = t;
  DELETE FROM public.workers WHERE tenant_id = t;
  DELETE FROM public.employer_invitations WHERE tenant_id = t AND accepted_at IS NULL;
  DELETE FROM public.companies c WHERE c.tenant_id = t
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.employer_invitations i WHERE i.company_id = c.id);
  GET DIAGNOSTICS n_companies = ROW_COUNT;
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity) VALUES (t, _actor, 'DEMO_RESET', 'tenants');
  RETURN jsonb_build_object('cases', n_cases, 'workers', n_workers, 'companies', n_companies);
END $function$;