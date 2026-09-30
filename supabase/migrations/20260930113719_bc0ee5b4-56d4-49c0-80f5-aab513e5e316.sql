
CREATE TYPE public.app_role AS ENUM ('MEDECIN_TRAVAIL','IDEST','PDP_COORDINATOR','SPSTI_ADMIN','EMPLOYER_HR','WORKER');
CREATE TYPE public.stoppage_origin AS ENUM ('MALADIE','AT','MP');
CREATE TYPE public.stoppage_kind AS ENUM ('INITIAL','PROLONGATION');
CREATE TYPE public.case_status AS ENUM ('OPEN','CLOSED');

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text,
  role public.app_role NOT NULL DEFAULT 'PDP_COORDINATOR',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()
$$;

CREATE POLICY "own tenant read" ON public.tenants FOR SELECT TO authenticated USING (id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  INSERT INTO public.tenants (name) VALUES ('Mon SPSTI') RETURNING id INTO t;
  INSERT INTO public.profiles (user_id, tenant_id, full_name)
  VALUES (NEW.id, t, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  siret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_tenant_siret_key ON public.companies (tenant_id, siret) WHERE siret IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant companies" ON public.companies FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  last_name text NOT NULL,
  first_name text NOT NULL,
  birth_date date,
  email text,
  phone text,
  job_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workers_dedupe_key ON public.workers (tenant_id, company_id, lower(last_name), lower(first_name), COALESCE(birth_date, '1900-01-01'::date));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workers TO authenticated;
GRANT ALL ON public.workers TO service_role;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant workers" ON public.workers FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER workers_updated BEFORE UPDATE ON public.workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference text,
  status public.case_status NOT NULL DEFAULT 'OPEN',
  origin public.stoppage_origin,
  opened_at date NOT NULL DEFAULT CURRENT_DATE,
  closed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_worker_status_idx ON public.cases (worker_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant cases" ON public.cases FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER cases_updated BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_stoppages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date,
  origin public.stoppage_origin NOT NULL DEFAULT 'MALADIE',
  kind public.stoppage_kind NOT NULL DEFAULT 'INITIAL',
  row_hash text NOT NULL,
  import_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX work_stoppages_row_hash_key ON public.work_stoppages (tenant_id, row_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_stoppages TO authenticated;
GRANT ALL ON public.work_stoppages TO service_role;
ALTER TABLE public.work_stoppages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant stoppages" ON public.work_stoppages FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_profiles_tenant_name_key ON public.import_profiles (tenant_id, lower(name));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_profiles TO authenticated;
GRANT ALL ON public.import_profiles TO service_role;
ALTER TABLE public.import_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant import profiles" ON public.import_profiles FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER import_profiles_updated BEFORE UPDATE ON public.import_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  import_profile_id uuid REFERENCES public.import_profiles(id) ON DELETE SET NULL,
  filename text NOT NULL,
  file_hash text,
  source text NOT NULL DEFAULT 'FILE',
  status text NOT NULL DEFAULT 'DONE',
  rows_total int NOT NULL DEFAULT 0,
  rows_imported int NOT NULL DEFAULT 0,
  rows_skipped int NOT NULL DEFAULT 0,
  rows_failed int NOT NULL DEFAULT 0,
  workers_created int NOT NULL DEFAULT 0,
  cases_created int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_runs TO authenticated;
GRANT ALL ON public.import_runs TO service_role;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant import runs" ON public.import_runs FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.import_row_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  import_run_id uuid NOT NULL REFERENCES public.import_runs(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_row_errors TO authenticated;
GRANT ALL ON public.import_row_errors TO service_role;
ALTER TABLE public.import_row_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant import errors" ON public.import_row_errors FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant api keys" ON public.api_keys FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
