CREATE OR REPLACE FUNCTION private.guard_approval()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('reprise.review', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'approval only through review'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'approval only through review'; END IF;
  -- Nested IFs: plpgsql does not short-circuit, so table-specific columns are only touched on their table.
  IF TG_TABLE_NAME = 'ai_drafts' THEN
    IF NEW.approved_text IS DISTINCT FROM OLD.approved_text OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'approval only through review'; END IF;
  ELSIF TG_TABLE_NAME = 'case_events' THEN
    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'approval only through review'; END IF;
  END IF;
  RETURN NEW;
END $function$;