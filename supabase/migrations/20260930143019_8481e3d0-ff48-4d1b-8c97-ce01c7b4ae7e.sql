ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS released_at timestamptz, ADD COLUMN IF NOT EXISTS released_by uuid;

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
  -- Release to employer/worker only through release_document.
  IF coalesce(current_setting('reprise.release', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.released_at := NULL; NEW.released_by := NULL;
    ELSIF NEW.released_at IS DISTINCT FROM OLD.released_at OR NEW.released_by IS DISTINCT FROM OLD.released_by THEN
      RAISE EXCEPTION 'release only through release_document';
    END IF;
    -- Any reclassification or level change withdraws a previous release.
    IF TG_OP = 'UPDATE' AND (NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.confidentiality IS DISTINCT FROM OLD.confidentiality OR NEW.analysis_status IS DISTINCT FROM OLD.analysis_status) THEN
      NEW.released_at := NULL; NEW.released_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.release_document(_actor uuid, _doc uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.documents WHERE id = _doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;
  IF NOT (private.actor_has_role(_actor, d.tenant_id, 'MEDECIN_TRAVAIL') OR private.actor_has_role(_actor, d.tenant_id, 'IDEST')) THEN
    RAISE EXCEPTION 'required role missing'; END IF;
  IF d.analysis_status <> 'DONE' THEN RAISE EXCEPTION 'analysis not done'; END IF;
  IF d.doc_type IN ('CERTIFICAT_MEDICAL','COMPTE_RENDU','ARRET_TRAVAIL') OR d.confidentiality NOT IN ('EMPLOYER_VISIBLE','WORKER_VISIBLE') THEN
    RAISE EXCEPTION 'document cannot be released'; END IF;
  PERFORM set_config('reprise.release', 'on', true);
  UPDATE public.documents SET released_at = now(), released_by = _actor WHERE id = _doc;
  PERFORM set_config('reprise.release', '', true);
  INSERT INTO public.audit_log(tenant_id, user_id, action, entity, entity_id, case_id)
    VALUES (d.tenant_id, _actor, 'RELEASE_' || d.confidentiality, 'documents', d.id, d.case_id);
END $$;
REVOKE ALL ON FUNCTION public.release_document(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_document(uuid, uuid) TO service_role;