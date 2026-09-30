ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'EXPERT';
CREATE TYPE public.confidentiality AS ENUM ('MEDICAL','PDP_SHARED','ADMINISTRATIVE','EMPLOYER_VISIBLE','WORKER_VISIBLE');
CREATE TYPE public.review_status AS ENUM ('DRAFT','APPROVED','REJECTED');

-- Roles in a dedicated table (removes self-editable role on profiles)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
INSERT INTO public.user_roles (user_id, tenant_id, role) SELECT user_id, tenant_id, 'SPSTI_ADMIN' FROM public.profiles;
INSERT INTO public.user_roles (user_id, tenant_id, role) SELECT user_id, tenant_id, 'PDP_COORDINATOR' FROM public.profiles ON CONFLICT DO NOTHING;
ALTER TABLE public.profiles DROP COLUMN role;

CREATE OR REPLACE FUNCTION public.has_role_text(_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = _role)
$$;

CREATE OR REPLACE FUNCTION public.can_read_level(_level public.confidentiality)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND (
      r.role::text IN ('MEDECIN_TRAVAIL','IDEST')
      OR (r.role::text IN ('PDP_COORDINATOR','EXPERT') AND _level <> 'MEDICAL')
      OR (r.role::text = 'SPSTI_ADMIN' AND _level IN ('ADMINISTRATIVE','EMPLOYER_VISIBLE','WORKER_VISIBLE'))
      OR (r.role::text = 'EMPLOYER_HR' AND _level = 'EMPLOYER_VISIBLE')
      OR (r.role::text = 'WORKER' AND _level = 'WORKER_VISIBLE')
    )
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_role_text(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_level(public.confidentiality) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role_text(text), public.can_read_level(public.confidentiality) TO authenticated, service_role;

CREATE POLICY "roles read tenant" ON public.user_roles FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "admin grants roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND has_role_text('SPSTI_ADMIN'));
CREATE POLICY "admin revokes roles" ON public.user_roles FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND has_role_text('SPSTI_ADMIN'));

-- Tenant members visible to each other (names only)
CREATE POLICY "tenant profiles read" ON public.profiles FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  INSERT INTO public.tenants (name) VALUES ('Mon SPSTI') RETURNING id INTO t;
  INSERT INTO public.profiles (user_id, tenant_id, full_name)
  VALUES (NEW.id, t, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (NEW.id, t, 'SPSTI_ADMIN'), (NEW.id, t, 'PDP_COORDINATOR');
  RETURN NEW;
END; $$;

-- Documents
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  doc_type text NOT NULL DEFAULT 'AUTRE',
  confidentiality public.confidentiality NOT NULL DEFAULT 'MEDICAL',
  page_count integer,
  extracted_text text,
  analysis_status text NOT NULL DEFAULT 'PENDING',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents read by level" ON public.documents FOR SELECT TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level(confidentiality));
CREATE POLICY "documents write by level" ON public.documents FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND can_read_level(confidentiality));
CREATE POLICY "documents update by level" ON public.documents FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level(confidentiality)) WITH CHECK (tenant_id = current_tenant_id() AND can_read_level(confidentiality));
CREATE POLICY "documents delete by level" ON public.documents FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level(confidentiality));

-- Sourced chronology
CREATE TABLE public.case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  event_date date,
  label text NOT NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  source_page integer,
  confidentiality public.confidentiality NOT NULL DEFAULT 'MEDICAL',
  status public.review_status NOT NULL DEFAULT 'DRAFT',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_events TO authenticated;
GRANT ALL ON public.case_events TO service_role;
ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events by level" ON public.case_events FOR ALL TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level(confidentiality)) WITH CHECK (tenant_id = current_tenant_id() AND can_read_level(confidentiality));

-- AI drafts with approval trail
CREATE TABLE public.ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  confidentiality public.confidentiality NOT NULL,
  draft_text text NOT NULL,
  approved_text text,
  status public.review_status NOT NULL DEFAULT 'DRAFT',
  required_role text NOT NULL DEFAULT 'MEDECIN_TRAVAIL',
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_drafts TO authenticated;
GRANT ALL ON public.ai_drafts TO service_role;
ALTER TABLE public.ai_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drafts by level" ON public.ai_drafts FOR ALL TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level(confidentiality)) WITH CHECK (tenant_id = current_tenant_id() AND can_read_level(confidentiality));

-- Coordination tasks
CREATE TABLE public.coordination_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL',
  purpose text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  due_at date,
  sent_at timestamptz,
  escalated_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coordination_tasks TO authenticated;
GRANT ALL ON public.coordination_tasks TO service_role;
ALTER TABLE public.coordination_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks tenant pdp" ON public.coordination_tasks FOR ALL TO authenticated USING (tenant_id = current_tenant_id() AND can_read_level('PDP_SHARED')) WITH CHECK (tenant_id = current_tenant_id() AND can_read_level('PDP_SHARED'));

-- Append-only audit log
CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT USAGE ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit insert self" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND user_id = auth.uid());
CREATE POLICY "audit read admin or medical" ON public.audit_log FOR SELECT TO authenticated USING (tenant_id = current_tenant_id() AND (has_role_text('SPSTI_ADMIN') OR has_role_text('MEDECIN_TRAVAIL')));

-- Storage policies for private documents bucket: path = tenant_id/case_id/file
CREATE POLICY "docs storage read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'case-documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);
CREATE POLICY "docs storage insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'case-documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);
CREATE POLICY "docs storage delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'case-documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);