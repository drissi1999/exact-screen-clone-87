CREATE TABLE public.return_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  target_date date NOT NULL,
  actual_return_date date,
  scenario text NOT NULL CHECK (scenario IN ('MEME_POSTE','POSTE_AMENAGE','MI_TEMPS_THERAPEUTIQUE','ESSAI_ENCADRE','RECLASSEMENT_INTERNE','FORMATION_RECONVERSION')),
  status text NOT NULL DEFAULT 'BROUILLON' CHECK (status IN ('BROUILLON','EN_COURS','TERMINE')),
  notes text,
  partners jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.return_plans TO authenticated;
GRANT ALL ON public.return_plans TO service_role;
ALTER TABLE public.return_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read tenant plans" ON public.return_plans FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff());
CREATE TRIGGER return_plans_updated BEFORE UPDATE ON public.return_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.return_plans(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL DEFAULT 'MILESTONE' CHECK (kind IN ('MILESTONE','FOLLOWUP')),
  title text NOT NULL,
  owner_role text NOT NULL CHECK (owner_role IN ('MEDECIN_TRAVAIL','IDEST','PDP_COORDINATOR','EMPLOYER_HR','WORKER','PARTNER')),
  partner_label text,
  offset_days integer NOT NULL DEFAULT 0,
  offset_end_days integer,
  due_date date NOT NULL,
  due_end date,
  requires_document boolean NOT NULL DEFAULT false,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','DONE')),
  outcome text CHECK (outcome IN ('MAINTENU','DIFFICULTES','RECHUTE')),
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_tasks_case_idx ON public.plan_tasks(case_id);
GRANT SELECT ON public.plan_tasks TO authenticated;
GRANT ALL ON public.plan_tasks TO service_role;
ALTER TABLE public.plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read tenant plan tasks" ON public.plan_tasks FOR SELECT TO authenticated
  USING (tenant_id = private.current_tenant_id() AND private.is_staff());

-- Plan facts in the chronology: PDP_SHARED, recorded (APPROVED) by the server only.
CREATE OR REPLACE FUNCTION public.add_plan_event(_actor uuid, _case uuid, _label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM public.cases WHERE id = _case;
  IF t IS NULL OR t <> private.actor_tenant(_actor) THEN RAISE EXCEPTION 'access denied'; END IF;
  PERFORM set_config('reprise.review', 'on', true);
  INSERT INTO public.case_events(tenant_id, case_id, event_date, label, confidentiality, status, reviewed_by, reviewed_at)
    VALUES (t, _case, (now() AT TIME ZONE 'Europe/Paris')::date, _label, 'PDP_SHARED', 'APPROVED', _actor, now());
  PERFORM set_config('reprise.review', '', true);
END $$;
REVOKE ALL ON FUNCTION public.add_plan_event(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_plan_event(uuid, uuid, text) TO service_role;