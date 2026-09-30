ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS employer_known_at date,
  ADD COLUMN IF NOT EXISTS cpam_investigation boolean NOT NULL DEFAULT false;

CREATE TABLE public.case_avis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  avis_type text NOT NULL CHECK (avis_type IN ('APTITUDE','APTITUDE_AMENAGEMENTS','INAPTITUDE')),
  avis_date date NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.case_avis TO authenticated;
GRANT ALL ON public.case_avis TO service_role;
ALTER TABLE public.case_avis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff of the tenant can read avis" ON public.case_avis FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff());
CREATE INDEX case_avis_case_idx ON public.case_avis(case_id, avis_date DESC);