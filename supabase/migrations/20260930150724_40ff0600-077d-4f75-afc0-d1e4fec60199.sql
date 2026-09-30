ALTER TABLE public.plan_tasks
  ADD COLUMN alert_ack_at timestamptz,
  ADD COLUMN alert_ack_by uuid,
  ADD COLUMN alert_ack_note text;

-- Demo facts: marks seeded facts as approved (service-only, used by the demo loader).
CREATE OR REPLACE FUNCTION public.demo_approve_events(_actor uuid, _ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.actor_has_role(_actor, private.actor_tenant(_actor), 'SPSTI_ADMIN') THEN RAISE EXCEPTION 'required role missing'; END IF;
  PERFORM set_config('reprise.review', 'on', true);
  UPDATE public.case_events SET status = 'APPROVED', reviewed_by = _actor, reviewed_at = now()
    WHERE id = ANY(_ids) AND tenant_id = private.actor_tenant(_actor);
  PERFORM set_config('reprise.review', '', true);
END $$;
REVOKE ALL ON FUNCTION public.demo_approve_events(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_approve_events(uuid, uuid[]) TO service_role;

-- Deletes all business data of the actor's SPSTI. Never users, profiles, roles, settings or other SPSTIs.
CREATE OR REPLACE FUNCTION public.reset_demo(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := private.actor_tenant(_actor); n_cases int; n_workers int; n_companies int;
BEGIN
  IF t IS NULL OR NOT private.actor_has_role(_actor, t, 'SPSTI_ADMIN') THEN RAISE EXCEPTION 'required role missing'; END IF;
  SELECT count(*) INTO n_cases FROM public.cases WHERE tenant_id = t;
  SELECT count(*) INTO n_workers FROM public.workers WHERE tenant_id = t;
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
  -- Companies linked to an employer account (profile or accepted invitation) are kept: users are never touched.
  DELETE FROM public.companies c WHERE c.tenant_id = t
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.employer_invitations i WHERE i.company_id = c.id);
  GET DIAGNOSTICS n_companies = ROW_COUNT;
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity) VALUES (t, _actor, 'DEMO_RESET', 'tenants');
  RETURN jsonb_build_object('cases', n_cases, 'workers', n_workers, 'companies', n_companies);
END $$;
REVOKE ALL ON FUNCTION public.reset_demo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_demo(uuid) TO service_role;