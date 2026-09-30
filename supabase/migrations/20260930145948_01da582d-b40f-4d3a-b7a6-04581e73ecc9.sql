CREATE OR REPLACE FUNCTION public.add_plan_event(_actor uuid, _case uuid, _label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM public.cases WHERE id = _case;
  IF t IS NULL THEN RAISE EXCEPTION 'case not found'; END IF;
  -- _actor is NULL only for worker portal actions (workers have no account); callers are service-role only.
  IF _actor IS NOT NULL AND t IS DISTINCT FROM private.actor_tenant(_actor) THEN RAISE EXCEPTION 'access denied'; END IF;
  PERFORM set_config('reprise.review', 'on', true);
  INSERT INTO public.case_events(tenant_id, case_id, event_date, label, confidentiality, status, reviewed_by, reviewed_at)
    VALUES (t, _case, (now() AT TIME ZONE 'Europe/Paris')::date, _label, 'PDP_SHARED', 'APPROVED', _actor, now());
  PERFORM set_config('reprise.review', '', true);
END $$;
REVOKE ALL ON FUNCTION public.add_plan_event(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_plan_event(uuid, uuid, text) TO service_role;