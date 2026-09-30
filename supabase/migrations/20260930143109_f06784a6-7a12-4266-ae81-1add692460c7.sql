CREATE OR REPLACE FUNCTION public.staff_case_items(_actor uuid, _case uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t uuid := private.actor_tenant(_actor); res jsonb;
BEGIN
  IF t IS NULL OR NOT private.actor_is_staff(_actor) OR NOT EXISTS (SELECT 1 FROM public.cases WHERE id = _case AND tenant_id = t) THEN
    RAISE EXCEPTION 'access denied'; END IF;
  SELECT jsonb_build_object(
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'filename',filename,'doc_type',doc_type,'confidentiality',confidentiality,'page_count',page_count,'analysis_status',analysis_status,'created_at',created_at,'source',source,'released_at',released_at) ORDER BY created_at DESC)
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
END $function$;