CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Move RLS helper functions out of the exposed API schema (policies follow by OID)
ALTER FUNCTION public.current_tenant_id() SET SCHEMA private;
ALTER FUNCTION public.has_role_text(text) SET SCHEMA private;
ALTER FUNCTION public.can_read_level(public.confidentiality) SET SCHEMA private;

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role::text IN ('MEDECIN_TRAVAIL','IDEST','PDP_COORDINATOR','SPSTI_ADMIN','EXPERT'))
$$;
REVOKE EXECUTE ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated, service_role;

-- Staff-only access to tenant-wide tables (employers go through company-scoped server functions)
DROP POLICY "tenant companies" ON public.companies;
CREATE POLICY "staff companies" ON public.companies FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant workers" ON public.workers;
CREATE POLICY "staff workers" ON public.workers FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant cases" ON public.cases;
CREATE POLICY "staff cases" ON public.cases FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant stoppages" ON public.work_stoppages;
CREATE POLICY "staff stoppages" ON public.work_stoppages FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant import profiles" ON public.import_profiles;
CREATE POLICY "staff import profiles" ON public.import_profiles FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant import runs" ON public.import_runs;
CREATE POLICY "staff import runs" ON public.import_runs FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant import errors" ON public.import_row_errors;
CREATE POLICY "staff import errors" ON public.import_row_errors FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());
DROP POLICY "tenant api keys" ON public.api_keys;
CREATE POLICY "staff api keys" ON public.api_keys FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff()) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());

DROP POLICY "documents read by level" ON public.documents;
DROP POLICY "documents write by level" ON public.documents;
DROP POLICY "documents update by level" ON public.documents;
DROP POLICY "documents delete by level" ON public.documents;
CREATE POLICY "staff documents by level" ON public.documents FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality)) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality));
DROP POLICY "events by level" ON public.case_events;
CREATE POLICY "staff events by level" ON public.case_events FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality)) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality));
DROP POLICY "drafts by level" ON public.ai_drafts;
CREATE POLICY "staff drafts by level" ON public.ai_drafts FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality)) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level(confidentiality));
DROP POLICY "tasks tenant pdp" ON public.coordination_tasks;
CREATE POLICY "staff tasks" ON public.coordination_tasks FOR ALL TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level('PDP_SHARED')) WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff() AND private.can_read_level('PDP_SHARED'));

DROP POLICY "docs storage read" ON storage.objects;
DROP POLICY "docs storage insert" ON storage.objects;
DROP POLICY "docs storage delete" ON storage.objects;
CREATE POLICY "staff docs storage read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'case-documents' AND private.is_staff() AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = name));
CREATE POLICY "staff docs storage insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'case-documents' AND private.is_staff() AND (storage.foldername(name))[1] = private.current_tenant_id()::text);
CREATE POLICY "staff docs storage delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'case-documents' AND private.is_staff() AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = name));

-- Employer link to one company
ALTER TABLE public.profiles ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN source text NOT NULL DEFAULT 'STAFF';

-- Employer invitations
CREATE TABLE public.employer_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.employer_invitations TO authenticated;
GRANT ALL ON public.employer_invitations TO service_role;
ALTER TABLE public.employer_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin reads invitations" ON public.employer_invitations FOR SELECT TO authenticated USING (tenant_id = private.current_tenant_id() AND private.has_role_text('SPSTI_ADMIN'));

-- Worker magic links and short sessions (server-only)
CREATE TABLE public.worker_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.worker_links TO service_role;
ALTER TABLE public.worker_links ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.worker_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.worker_sessions TO service_role;
ALTER TABLE public.worker_sessions ENABLE ROW LEVEL SECURITY;

-- Simulated outbound messages (no real SMS/email provider)
CREATE TABLE public.simulated_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE,
  recipient_label text NOT NULL,
  to_address text,
  channel text NOT NULL,
  subject text,
  body text NOT NULL,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.simulated_messages TO authenticated;
GRANT ALL ON public.simulated_messages TO service_role;
ALTER TABLE public.simulated_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read messages" ON public.simulated_messages FOR SELECT TO authenticated USING (tenant_id = private.current_tenant_id() AND private.is_staff());
CREATE POLICY "staff write messages" ON public.simulated_messages FOR INSERT TO authenticated WITH CHECK (tenant_id = private.current_tenant_id() AND private.is_staff());

-- Invited employers join the inviting tenant (app_metadata is server-set only)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; inv public.employer_invitations%ROWTYPE;
BEGIN
  IF NEW.raw_app_meta_data ? 'invite_id' THEN
    SELECT * INTO inv FROM public.employer_invitations
      WHERE id = (NEW.raw_app_meta_data->>'invite_id')::uuid AND accepted_at IS NULL AND expires_at > now()
        AND lower(email) = lower(NEW.email);
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid invitation'; END IF;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, company_id) VALUES (NEW.id, inv.tenant_id, COALESCE(inv.full_name, NEW.email), inv.company_id);
    INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (NEW.id, inv.tenant_id, 'EMPLOYER_HR');
    UPDATE public.employer_invitations SET accepted_at = now() WHERE id = inv.id;
    RETURN NEW;
  END IF;
  INSERT INTO public.tenants (name) VALUES ('Mon SPSTI') RETURNING id INTO t;
  INSERT INTO public.profiles (user_id, tenant_id, full_name)
  VALUES (NEW.id, t, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (NEW.id, t, 'SPSTI_ADMIN'), (NEW.id, t, 'PDP_COORDINATOR');
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Profiles: users may only change their name (company link is server-managed)
DROP POLICY "own profile update" ON public.profiles;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());