CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('RDV_LIAISON','PRE_REPRISE','VISITE_REPRISE')),
  practitioner_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PLANIFIEE' CHECK (status IN ('PLANIFIEE','REALISEE','ANNULEE')),
  questions_draft_id uuid,
  avis_draft_id uuid,
  letter_draft_id uuid,
  avis_type text CHECK (avis_type IS NULL OR avis_type IN ('APTITUDE','APTITUDE_AMENAGEMENTS','INAPTITUDE')),
  restrictions text,
  outcome_at timestamptz,
  outcome_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visits_case_idx ON public.visits(case_id);
GRANT SELECT ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff of the tenant read visits" ON public.visits FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff());
CREATE TRIGGER visits_updated BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();