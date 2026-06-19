
-- 1. Add new columns to professional_profiles
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS work_experience JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_preapproved BOOLEAN DEFAULT false;

-- 2. Create professional_documents table
CREATE TYPE public.doc_type AS ENUM ('cv','rethus','diploma','id_document','other');
CREATE TYPE public.doc_status AS ENUM ('pending','approved','rejected');

CREATE TABLE public.professional_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  doc_type public.doc_type NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  status public.doc_status NOT NULL DEFAULT 'pending',
  reviewer_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.professional_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_select_owner_or_authenticated"
  ON public.professional_documents FOR SELECT
  USING (auth.uid() = user_id OR auth.role() = 'authenticated' OR public.is_staff(auth.uid()));

CREATE POLICY "docs_insert_owner"
  ON public.professional_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "docs_update_owner_or_staff"
  ON public.professional_documents FOR UPDATE
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "docs_delete_owner_or_staff"
  ON public.professional_documents FOR DELETE
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE TRIGGER trg_docs_updated_at
  BEFORE UPDATE ON public.professional_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('professional-docs','professional-docs', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars','avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for professional-docs
CREATE POLICY "pdocs_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'professional-docs');

CREATE POLICY "pdocs_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'professional-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "pdocs_update_own"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'professional-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "pdocs_delete_own"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'professional-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for avatars
CREATE POLICY "avatars_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "avatars_update_own"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "avatars_delete_own"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
