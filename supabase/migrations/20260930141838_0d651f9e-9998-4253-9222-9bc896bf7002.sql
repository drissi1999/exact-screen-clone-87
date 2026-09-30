-- 1. Row access: staff only SELECT non-medical rows directly; no direct writes.
DROP POLICY IF EXISTS "staff documents by level" ON public.documents;
DROP POLICY IF EXISTS "staff events by level" ON public.case_events;
DROP POLICY IF EXISTS "staff drafts by level" ON public.ai_drafts;
DROP POLICY IF EXISTS "audit insert self" ON public.audit_log;

CREATE POLICY "staff read non-medical documents" ON public.documents FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND confidentiality <> 'MEDICAL' AND private.can_read_level(confidentiality));
CREATE POLICY "staff read non-medical events" ON public.case_events FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND confidentiality <> 'MEDICAL' AND private.can_read_level(confidentiality));
CREATE POLICY "staff read non-medical drafts" ON public.ai_drafts FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND confidentiality <> 'MEDICAL' AND private.can_read_level(confidentiality));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.documents, public.case_events, public.ai_drafts, public.audit_log FROM authenticated, anon;
REVOKE SELECT ON public.documents, public.case_events, public.ai_drafts, public.audit_log FROM anon;
GRANT SELECT ON public.documents, public.case_events, public.ai_drafts, public.audit_log TO authenticated;
GRANT ALL ON public.documents, public.case_events, public.ai_drafts, public.audit_log TO service_role;

-- 2. Approval guard: APPROVED / approval fields only settable inside review_draft / review_event.
CREATE OR REPLACE FUNCTION private.guard_approval() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('reprise.review', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'approval only through review'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'approval only through review'; END IF;
  IF TG_TABLE_NAME = 'ai_drafts' AND (NEW.approved_text IS DISTINCT FROM OLD.approved_text OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'approval only through review';
  END IF;
  IF TG_TABLE_NAME = 'case_events' AND (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at) THEN
    RAISE EXCEPTION 'approval only through review';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_approval ON public.ai_drafts;
DROP TRIGGER IF EXISTS guard_approval ON public.case_events;
CREATE TRIGGER guard_approval BEFORE INSERT OR UPDATE ON public.ai_drafts FOR EACH ROW EXECUTE FUNCTION private.guard_approval();
CREATE TRIGGER guard_approval BEFORE INSERT OR UPDATE ON public.case_events FOR EACH ROW EXECUTE FUNCTION private.guard_approval();

CREATE OR REPLACE FUNCTION private.actor_has_role(_actor uuid, _tenant uuid, _role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id AND p.tenant_id = r.tenant_id
                 WHERE r.user_id = _actor AND r.tenant_id = _tenant AND r.role::text = _role)
$$;

CREATE OR REPLACE FUNCTION public.review_draft(_draft uuid, _actor uuid, _status review_status, _text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.ai_drafts%ROWTYPE;
BEGIN
  IF _status NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO d FROM public.ai_drafts WHERE id = _draft;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not found'; END IF;
  IF NOT private.actor_has_role(_actor, d.tenant_id, d.required_role) THEN RAISE EXCEPTION 'required role missing'; END IF;
  PERFORM set_config('reprise.review', 'on', true);
  UPDATE public.ai_drafts SET status = _status,
    approved_text = CASE WHEN _status = 'APPROVED' THEN coalesce(_text, d.draft_text) END,
    approved_by = _actor, approved_at = now() WHERE id = _draft;
  PERFORM set_config('reprise.review', '', true);
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
    VALUES (d.tenant_id, _actor, 'DRAFT_' || _status, 'ai_drafts', d.id, d.case_id);
END $$;

CREATE OR REPLACE FUNCTION public.review_event(_event uuid, _actor uuid, _status review_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.case_events%ROWTYPE;
BEGIN
  IF _status NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO e FROM public.case_events WHERE id = _event;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  IF e.confidentiality = 'MEDICAL' THEN
    IF NOT (private.actor_has_role(_actor, e.tenant_id, 'MEDECIN_TRAVAIL') OR private.actor_has_role(_actor, e.tenant_id, 'IDEST')) THEN
      RAISE EXCEPTION 'required role missing'; END IF;
  ELSIF NOT (private.actor_has_role(_actor, e.tenant_id, 'MEDECIN_TRAVAIL') OR private.actor_has_role(_actor, e.tenant_id, 'IDEST')
          OR private.actor_has_role(_actor, e.tenant_id, 'PDP_COORDINATOR')
          OR (e.confidentiality <> 'PDP_SHARED' AND private.actor_has_role(_actor, e.tenant_id, 'SPSTI_ADMIN'))) THEN
    RAISE EXCEPTION 'required role missing';
  END IF;
  PERFORM set_config('reprise.review', 'on', true);
  UPDATE public.case_events SET status = _status, reviewed_by = _actor, reviewed_at = now() WHERE id = _event;
  PERFORM set_config('reprise.review', '', true);
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
    VALUES (e.tenant_id, _actor, 'EVENT_' || _status, 'case_events', e.id, e.case_id);
END $$;
REVOKE ALL ON FUNCTION public.review_draft(uuid, uuid, review_status, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_event(uuid, uuid, review_status) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_draft(uuid, uuid, review_status, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_event(uuid, uuid, review_status) TO service_role;

-- 3. Audited reads (all levels the caller may read; MEDICAL rows are logged).
CREATE OR REPLACE FUNCTION public.staff_case_items(_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := private.current_tenant_id(); res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_staff() OR NOT EXISTS (SELECT 1 FROM public.cases WHERE id = _case AND tenant_id = t) THEN
    RAISE EXCEPTION 'access denied'; END IF;
  SELECT jsonb_build_object(
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'filename',filename,'doc_type',doc_type,'confidentiality',confidentiality,'page_count',page_count,'analysis_status',analysis_status,'created_at',created_at) ORDER BY created_at DESC)
                  FROM public.documents WHERE case_id = _case AND tenant_id = t AND private.can_read_level(confidentiality)), '[]'),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'event_date',event_date,'label',label,'source_document_id',source_document_id,'source_page',source_page,'confidentiality',confidentiality,'status',status) ORDER BY event_date NULLS LAST, created_at)
                  FROM public.case_events WHERE case_id = _case AND tenant_id = t AND private.can_read_level(confidentiality)), '[]'),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'confidentiality',confidentiality,'draft_text',draft_text,'approved_text',approved_text,'status',status,'required_role',required_role,'approved_at',approved_at,'created_at',created_at) ORDER BY created_at DESC)
                  FROM public.ai_drafts WHERE case_id = _case AND tenant_id = t AND private.can_read_level(confidentiality)), '[]')
  ) INTO res;
  IF private.can_read_level('MEDICAL') THEN
    INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
      SELECT t, auth.uid(), 'READ', 'documents', id, _case FROM public.documents WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL'
      UNION ALL SELECT t, auth.uid(), 'READ', 'ai_drafts', id, _case FROM public.ai_drafts WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL';
    IF EXISTS (SELECT 1 FROM public.case_events WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL') THEN
      INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id) VALUES (t, auth.uid(), 'READ', 'case_events', NULL, _case);
    END IF;
  END IF;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.staff_document(_doc uuid, _purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
  IF _purpose NOT IN ('READ','DOWNLOAD','AI_ANALYZE') THEN RAISE EXCEPTION 'invalid purpose'; END IF;
  SELECT * INTO d FROM public.documents WHERE id = _doc AND tenant_id = private.current_tenant_id();
  IF NOT FOUND OR NOT private.is_staff() OR NOT private.can_read_level(d.confidentiality) THEN RAISE EXCEPTION 'access denied'; END IF;
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id) VALUES (d.tenant_id, auth.uid(), _purpose, 'documents', d.id, d.case_id);
  RETURN jsonb_build_object('id',d.id,'case_id',d.case_id,'filename',d.filename,'storage_path',d.storage_path,'mime_type',d.mime_type,'doc_type',d.doc_type,
    'confidentiality',d.confidentiality,'extracted_text',d.extracted_text,'analysis_status',d.analysis_status);
END $$;

CREATE OR REPLACE FUNCTION public.can_write_case(_case uuid, _level confidentiality) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND private.is_staff() AND private.can_read_level(_level)
    AND EXISTS (SELECT 1 FROM public.cases WHERE id = _case AND tenant_id = private.current_tenant_id())
$$;

REVOKE ALL ON FUNCTION public.staff_case_items(uuid), public.staff_document(uuid, text), public.can_write_case(uuid, confidentiality) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_case_items(uuid), public.staff_document(uuid, text), public.can_write_case(uuid, confidentiality) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_approval(), private.actor_has_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated;