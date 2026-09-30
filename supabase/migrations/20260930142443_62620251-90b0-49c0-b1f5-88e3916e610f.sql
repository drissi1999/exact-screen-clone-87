
CREATE OR REPLACE FUNCTION private.conf_rank(_l confidentiality) RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _l WHEN 'MEDICAL' THEN 4 WHEN 'PDP_SHARED' THEN 3 WHEN 'ADMINISTRATIVE' THEN 2 ELSE 1 END $$;

-- Any change that is not a strict raise counts as lowering and needs the médecin-only function.
CREATE OR REPLACE FUNCTION private.is_lowering(_old confidentiality, _new confidentiality) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT _old IS DISTINCT FROM _new AND private.conf_rank(_new) <= private.conf_rank(_old) $$;

CREATE OR REPLACE FUNCTION private.guard_document_conf() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.doc_type IN ('CERTIFICAT_MEDICAL','COMPTE_RENDU','ARRET_TRAVAIL')
     AND (TG_OP = 'INSERT' OR NEW.doc_type IS DISTINCT FROM OLD.doc_type) THEN
    NEW.confidentiality := 'MEDICAL';
  END IF;
  IF TG_OP = 'UPDATE' AND private.is_lowering(OLD.confidentiality, NEW.confidentiality)
     AND coalesce(current_setting('reprise.lower', true), '') <> 'on' THEN
    RAISE EXCEPTION 'lowering confidentiality requires MEDECIN_TRAVAIL';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.propagate_document_conf() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.confidentiality = 'MEDICAL' AND OLD.confidentiality IS DISTINCT FROM 'MEDICAL' THEN
    UPDATE public.case_events SET confidentiality = 'MEDICAL' WHERE source_document_id = NEW.id AND confidentiality <> 'MEDICAL';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.guard_event_conf() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.source_document_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.documents WHERE id = NEW.source_document_id AND confidentiality = 'MEDICAL') THEN
    NEW.confidentiality := 'MEDICAL';
  END IF;
  IF TG_OP = 'UPDATE' AND private.is_lowering(OLD.confidentiality, NEW.confidentiality)
     AND coalesce(current_setting('reprise.lower', true), '') <> 'on' THEN
    RAISE EXCEPTION 'lowering confidentiality requires MEDECIN_TRAVAIL';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_document_conf BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.guard_document_conf();
CREATE TRIGGER propagate_document_conf AFTER UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.propagate_document_conf();
CREATE TRIGGER guard_event_conf BEFORE INSERT OR UPDATE ON public.case_events FOR EACH ROW EXECUTE FUNCTION private.guard_event_conf();

-- Existing clinical documents and their events are raised now.
UPDATE public.documents SET confidentiality = 'MEDICAL' WHERE doc_type IN ('CERTIFICAT_MEDICAL','COMPTE_RENDU','ARRET_TRAVAIL') AND confidentiality <> 'MEDICAL';
UPDATE public.case_events e SET confidentiality = 'MEDICAL' FROM public.documents d WHERE d.id = e.source_document_id AND d.confidentiality = 'MEDICAL' AND e.confidentiality <> 'MEDICAL';

CREATE OR REPLACE FUNCTION public.lower_document_confidentiality(_actor uuid, _doc uuid, _level confidentiality)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.documents WHERE id = _doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;
  IF NOT private.actor_has_role(_actor, d.tenant_id, 'MEDECIN_TRAVAIL') THEN RAISE EXCEPTION 'required role missing'; END IF;
  IF NOT private.is_lowering(d.confidentiality, _level) THEN RAISE EXCEPTION 'not a lowering'; END IF;
  PERFORM set_config('reprise.lower', 'on', true);
  UPDATE public.documents SET confidentiality = _level WHERE id = _doc;
  PERFORM set_config('reprise.lower', '', true);
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
    VALUES (d.tenant_id, _actor, 'CONF_LOWER_' || d.confidentiality || '_TO_' || _level, 'documents', d.id, d.case_id);
END $$;
REVOKE ALL ON FUNCTION public.lower_document_confidentiality(uuid, uuid, confidentiality) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lower_document_confidentiality(uuid, uuid, confidentiality) TO service_role;

-- Coordination tasks: server-only writes, templated external messages are immutable.
ALTER TABLE public.coordination_tasks ADD COLUMN IF NOT EXISTS template_code text;
REVOKE INSERT, UPDATE, DELETE ON public.coordination_tasks FROM authenticated, anon;

CREATE OR REPLACE FUNCTION private.guard_task_message() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.recipient IN ('EMPLOYER_HR','WORKER') AND NEW.template_code IS NULL THEN
      RAISE EXCEPTION 'external messages must come from a template'; END IF;
    RETURN NEW;
  END IF;
  IF (OLD.recipient IN ('EMPLOYER_HR','WORKER') OR NEW.recipient IN ('EMPLOYER_HR','WORKER'))
     AND (NEW.message IS DISTINCT FROM OLD.message OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.template_code IS DISTINCT FROM OLD.template_code) THEN
    RAISE EXCEPTION 'templated message cannot be edited';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_task_message BEFORE INSERT OR UPDATE ON public.coordination_tasks FOR EACH ROW EXECUTE FUNCTION private.guard_task_message();
