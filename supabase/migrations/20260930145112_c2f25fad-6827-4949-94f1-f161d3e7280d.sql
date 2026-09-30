ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS headcount integer;

CREATE TABLE public.case_risk_scores (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  factors jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.case_risk_scores TO authenticated;
GRANT ALL ON public.case_risk_scores TO service_role;
ALTER TABLE public.case_risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read tenant risk scores" ON public.case_risk_scores FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff());

-- Per case: draft facts and publishable documents the actor may read (counts only, no content).
CREATE OR REPLACE FUNCTION public.my_day_documents(_actor uuid)
RETURNS TABLE (case_id uuid, draft_facts integer, publishable integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT private.actor_tenant(_actor) AS id)
  SELECT c.id,
    (SELECT count(*)::int FROM public.case_events e JOIN public.documents d ON d.id = e.source_document_id
      WHERE e.case_id = c.id AND e.status = 'DRAFT' AND d.analysis_status = 'DONE' AND private.actor_can_read(_actor, e.confidentiality)),
    (SELECT count(*)::int FROM public.documents d WHERE d.case_id = c.id AND d.analysis_status = 'DONE' AND d.released_at IS NULL
      AND d.source = 'STAFF' AND d.confidentiality IN ('EMPLOYER_VISIBLE','WORKER_VISIBLE')
      AND d.doc_type NOT IN ('CERTIFICAT_MEDICAL','COMPTE_RENDU','ARRET_TRAVAIL'))
  FROM public.cases c, t
  WHERE c.tenant_id = t.id AND c.status = 'OPEN' AND private.actor_is_staff(_actor)
$$;
REVOKE ALL ON FUNCTION public.my_day_documents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_day_documents(uuid) TO service_role;