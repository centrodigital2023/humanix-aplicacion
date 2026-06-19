
-- Storage bucket for family documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('family-docs', 'family-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Family doc type enum
DO $$ BEGIN
  CREATE TYPE public.family_doc_type AS ENUM (
    'id_document',
    'utility_bill',
    'patient_id',
    'medical_history',
    'authorization',
    'insurance',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Family documents table
CREATE TABLE IF NOT EXISTS public.family_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  doc_type public.family_doc_type NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  status public.doc_status NOT NULL DEFAULT 'pending',
  ai_verified BOOLEAN DEFAULT false,
  ai_score NUMERIC,
  ai_notes TEXT,
  ai_extracted JSONB,
  reviewer_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_documents_user_idx ON public.family_documents(user_id);

ALTER TABLE public.family_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fdocs_select_owner_or_staff ON public.family_documents;
CREATE POLICY fdocs_select_owner_or_staff ON public.family_documents
  FOR SELECT USING (auth.uid() = user_id OR is_staff(auth.uid()));

DROP POLICY IF EXISTS fdocs_insert_owner ON public.family_documents;
CREATE POLICY fdocs_insert_owner ON public.family_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS fdocs_update_owner_or_staff ON public.family_documents;
CREATE POLICY fdocs_update_owner_or_staff ON public.family_documents
  FOR UPDATE USING (auth.uid() = user_id OR is_staff(auth.uid()));

DROP POLICY IF EXISTS fdocs_delete_owner_or_staff ON public.family_documents;
CREATE POLICY fdocs_delete_owner_or_staff ON public.family_documents
  FOR DELETE USING (auth.uid() = user_id OR is_staff(auth.uid()));

-- updated_at trigger
DROP TRIGGER IF EXISTS family_documents_set_updated_at ON public.family_documents;
CREATE TRIGGER family_documents_set_updated_at
  BEFORE UPDATE ON public.family_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for family-docs bucket (folder = user id)
DROP POLICY IF EXISTS family_docs_select_own ON storage.objects;
CREATE POLICY family_docs_select_own ON storage.objects
  FOR SELECT USING (
    bucket_id = 'family-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

DROP POLICY IF EXISTS family_docs_insert_own ON storage.objects;
CREATE POLICY family_docs_insert_own ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'family-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS family_docs_update_own ON storage.objects;
CREATE POLICY family_docs_update_own ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'family-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

DROP POLICY IF EXISTS family_docs_delete_own ON storage.objects;
CREATE POLICY family_docs_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'family-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

-- Realtime: enable replica identity full + add to publication for live updates
ALTER TABLE public.family_documents REPLICA IDENTITY FULL;
ALTER TABLE public.applications REPLICA IDENTITY FULL;
ALTER TABLE public.job_offers REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.family_documents;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.job_offers;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN null; END $$;
