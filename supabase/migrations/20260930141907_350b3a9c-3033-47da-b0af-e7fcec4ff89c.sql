CREATE OR REPLACE FUNCTION private.actor_tenant(_actor uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _actor $$;
CREATE OR REPLACE FUNCTION private.actor_is_staff(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND tenant_id = private.actor_tenant(_actor)
    AND role::text IN ('MEDECIN_TRAVAIL','IDEST','PDP_COORDINATOR','SPSTI_ADMIN','EXPERT')) $$;
CREATE OR REPLACE FUNCTION private.actor_can_read(_actor uuid, _level confidentiality) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _actor AND r.tenant_id = private.actor_tenant(_actor) AND (
      r.role::text IN ('MEDECIN_TRAVAIL','IDEST')
      OR (r.role::text IN ('PDP_COORDINATOR','EXPERT') AND _level <> 'MEDICAL')
      OR (r.role::text = 'SPSTI_ADMIN' AND _level IN ('ADMINISTRATIVE','EMPLOYER_VISIBLE','WORKER_VISIBLE')))) $$;
REVOKE ALL ON FUNCTION private.actor_tenant(uuid), private.actor_is_staff(uuid), private.actor_can_read(uuid, confidentiality) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.staff_case_items(uuid);
DROP FUNCTION public.staff_document(uuid, text);
DROP FUNCTION public.can_write_case(uuid, confidentiality);

CREATE FUNCTION public.staff_case_items(_actor uuid, _case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := private.actor_tenant(_actor); res jsonb;
BEGIN
  IF t IS NULL OR NOT private.actor_is_staff(_actor) OR NOT EXISTS (SELECT 1 FROM public.cases WHERE id = _case AND tenant_id = t) THEN
    RAISE EXCEPTION 'access denied'; END IF;
  SELECT jsonb_build_object(
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'filename',filename,'doc_type',doc_type,'confidentiality',confidentiality,'page_count',page_count,'analysis_status',analysis_status,'created_at',created_at) ORDER BY created_at DESC)
                  FROM public.documents WHERE case_id = _case AND tenant_id = t AND private.actor_can_read(_actor, confidentiality)), '[]'),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'event_date',e.event_date,'label',e.label,'source_document_id',e.source_document_id,'source_page',e.source_page,'confidentiality',e.confidentiality,'status',e.status,'source_filename',d.filename) ORDER BY e.event_date NULLS LAST, e.created_at)
                  FROM public.case_events e LEFT JOIN public.documents d ON d.id = e.source_document_id
                  WHERE e.case_id = _case AND e.tenant_id = t AND private.actor_can_read(_actor, e.confidentiality)), '[]'),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',kind,'confidentiality',confidentiality,'draft_text',draft_text,'approved_text',approved_text,'status',status,'required_role',required_role,'approved_at',approved_at,'created_at',created_at) ORDER BY created_at DESC)
                  FROM public.ai_drafts WHERE case_id = _case AND tenant_id = t AND private.actor_can_read(_actor, confidentiality)), '[]')
  ) INTO res;
  IF private.actor_can_read(_actor, 'MEDICAL') THEN
    INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
      SELECT t, _actor, 'READ', 'documents', id, _case FROM public.documents WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL'
      UNION ALL SELECT t, _actor, 'READ', 'ai_drafts', id, _case FROM public.ai_drafts WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL';
    IF EXISTS (SELECT 1 FROM public.case_events WHERE case_id = _case AND tenant_id = t AND confidentiality = 'MEDICAL') THEN
      INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id) VALUES (t, _actor, 'READ', 'case_events', NULL, _case);
    END IF;
  END IF;
  RETURN res;
END $$;

CREATE FUNCTION public.staff_document(_actor uuid, _doc uuid, _purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
  IF _purpose NOT IN ('READ','DOWNLOAD','AI_ANALYZE') THEN RAISE EXCEPTION 'invalid purpose'; END IF;
  SELECT * INTO d FROM public.documents WHERE id = _doc AND tenant_id = private.actor_tenant(_actor);
  IF NOT FOUND OR NOT private.actor_is_staff(_actor) OR NOT private.actor_can_read(_actor, d.confidentiality) THEN RAISE EXCEPTION 'access denied'; END IF;
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id) VALUES (d.tenant_id, _actor, _purpose, 'documents', d.id, d.case_id);
  RETURN jsonb_build_object('id',d.id,'case_id',d.case_id,'tenant_id',d.tenant_id,'filename',d.filename,'storage_path',d.storage_path,'mime_type',d.mime_type,'doc_type',d.doc_type,
    'confidentiality',d.confidentiality,'extracted_text',d.extracted_text,'analysis_status',d.analysis_status);
END $$;

CREATE FUNCTION public.can_write_case(_actor uuid, _case uuid, _level confidentiality) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.actor_is_staff(_actor) AND private.actor_can_read(_actor, _level)
    AND EXISTS (SELECT 1 FROM public.cases WHERE id = _case AND tenant_id = private.actor_tenant(_actor)) $$;

REVOKE ALL ON FUNCTION public.staff_case_items(uuid, uuid), public.staff_document(uuid, uuid, text), public.can_write_case(uuid, uuid, confidentiality) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_case_items(uuid, uuid), public.staff_document(uuid, uuid, text), public.can_write_case(uuid, uuid, confidentiality) TO service_role;