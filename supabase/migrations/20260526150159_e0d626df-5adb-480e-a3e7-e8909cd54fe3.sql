
-- 1) Add missing columns to institution_profiles
ALTER TABLE public.institution_profiles
  ADD COLUMN IF NOT EXISTS chamber_of_commerce_number text,
  ADD COLUMN IF NOT EXISTS chamber_of_commerce_date date,
  ADD COLUMN IF NOT EXISTS legal_representative_name text,
  ADD COLUMN IF NOT EXISTS legal_representative_email text,
  ADD COLUMN IF NOT EXISTS legal_representative_phone text,
  ADD COLUMN IF NOT EXISTS compliance_notes text,
  ADD COLUMN IF NOT EXISTS compliance_fuid boolean NOT NULL DEFAULT false;

-- 2) Add application_id to service_bookings to link bookings to applications
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS application_id uuid;
CREATE INDEX IF NOT EXISTS idx_service_bookings_application_id
  ON public.service_bookings(application_id);

-- 3) institution_documents (mirror family_documents)
CREATE TABLE IF NOT EXISTS public.institution_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  doc_type text NOT NULL,
  file_name text,
  file_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  ai_verified boolean DEFAULT false,
  ai_score numeric,
  ai_notes text,
  ai_extracted jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_documents TO authenticated;
GRANT ALL ON public.institution_documents TO service_role;
ALTER TABLE public.institution_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inst_docs_select_owner_or_staff" ON public.institution_documents
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "inst_docs_insert_owner" ON public.institution_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inst_docs_update_owner_or_staff" ON public.institution_documents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "inst_docs_delete_owner_or_staff" ON public.institution_documents
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE TRIGGER trg_institution_documents_updated_at
  BEFORE UPDATE ON public.institution_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_institution_documents_user_id ON public.institution_documents(user_id);

-- 4) application_documents (documents attached to an application)
CREATE TABLE IF NOT EXISTS public.application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  user_id uuid NOT NULL,
  doc_type text NOT NULL,
  file_name text,
  file_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  ai_verified boolean DEFAULT false,
  ai_score numeric,
  ai_notes text,
  retention_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_documents TO authenticated;
GRANT ALL ON public.application_documents TO service_role;
ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;
-- Owner (professional) or the institution that posted the offer can see
CREATE POLICY "app_docs_select_involved" ON public.application_documents
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id
    OR public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.applications a
      JOIN public.job_offers o ON o.id = a.job_offer_id
      WHERE a.id = application_documents.application_id
        AND o.posted_by = auth.uid()
    )
  );
CREATE POLICY "app_docs_insert_owner" ON public.application_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "app_docs_update_owner_or_staff" ON public.application_documents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "app_docs_delete_owner_or_staff" ON public.application_documents
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE TRIGGER trg_application_documents_updated_at
  BEFORE UPDATE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_app_docs_application_id ON public.application_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_app_docs_user_id ON public.application_documents(user_id);

-- 5) job_offer_requirements
CREATE TABLE IF NOT EXISTS public.job_offer_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_offer_id uuid NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  requirement_type text NOT NULL,
  description text,
  is_mandatory boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_offer_requirements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.job_offer_requirements TO authenticated;
GRANT ALL ON public.job_offer_requirements TO service_role;
ALTER TABLE public.job_offer_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jor_select_visible" ON public.job_offer_requirements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.job_offers o
      WHERE o.id = job_offer_requirements.job_offer_id
        AND (o.status = 'open' OR o.posted_by = auth.uid() OR public.is_staff(auth.uid()))
    )
  );
CREATE POLICY "jor_modify_owner_or_staff" ON public.job_offer_requirements
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.job_offers o
      WHERE o.id = job_offer_requirements.job_offer_id
        AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_offers o
      WHERE o.id = job_offer_requirements.job_offer_id
        AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))
    )
  );
CREATE INDEX IF NOT EXISTS idx_jor_offer ON public.job_offer_requirements(job_offer_id);

-- 6) dynamic_forms (reusable form definitions linked to a target like a job_offer)
CREATE TABLE IF NOT EXISTS public.dynamic_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  name text NOT NULL,
  description text,
  target_type text NOT NULL DEFAULT 'job_offer',
  target_id uuid,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dynamic_forms TO authenticated;
GRANT ALL ON public.dynamic_forms TO service_role;
ALTER TABLE public.dynamic_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "df_select_owner_or_target_owner_or_staff" ON public.dynamic_forms
  FOR SELECT TO authenticated USING (
    auth.uid() = created_by
    OR public.is_staff(auth.uid())
    OR (target_type = 'job_offer' AND EXISTS (
      SELECT 1 FROM public.job_offers o
      WHERE o.id = dynamic_forms.target_id
        AND (o.posted_by = auth.uid() OR o.status = 'open')
    ))
  );
CREATE POLICY "df_insert_self" ON public.dynamic_forms
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "df_update_owner_or_staff" ON public.dynamic_forms
  FOR UPDATE TO authenticated USING (auth.uid() = created_by OR public.is_staff(auth.uid()));
CREATE POLICY "df_delete_owner_or_staff" ON public.dynamic_forms
  FOR DELETE TO authenticated USING (auth.uid() = created_by OR public.is_staff(auth.uid()));
CREATE TRIGGER trg_dynamic_forms_updated_at
  BEFORE UPDATE ON public.dynamic_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_dynamic_forms_target ON public.dynamic_forms(target_type, target_id);

-- 7) form_responses (submissions to a dynamic_form)
CREATE TABLE IF NOT EXISTS public.form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.dynamic_forms(id) ON DELETE CASCADE,
  respondent_id uuid NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.form_responses TO authenticated;
GRANT ALL ON public.form_responses TO service_role;
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fr_select_owner_or_form_owner_or_staff" ON public.form_responses
  FOR SELECT TO authenticated USING (
    auth.uid() = respondent_id
    OR public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.dynamic_forms df
      WHERE df.id = form_responses.form_id AND df.created_by = auth.uid()
    )
  );
CREATE POLICY "fr_insert_self" ON public.form_responses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = respondent_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_form ON public.form_responses(form_id);
