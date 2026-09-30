ALTER TABLE public.ai_drafts ADD COLUMN IF NOT EXISTS source_fact_ids uuid[] NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS model text;
REVOKE ALL ON public.worker_links, public.worker_sessions FROM anon, authenticated;
GRANT ALL ON public.worker_links, public.worker_sessions TO service_role;
CREATE POLICY "No client access" ON public.worker_links AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client access" ON public.worker_sessions AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);