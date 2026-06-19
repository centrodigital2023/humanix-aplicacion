
-- 1) Nuevos tipos de documento
ALTER TYPE public.doc_type ADD VALUE IF NOT EXISTS 'utility_bill';
ALTER TYPE public.doc_type ADD VALUE IF NOT EXISTS 'work_reference';
ALTER TYPE public.doc_type ADD VALUE IF NOT EXISTS 'family_reference';

-- 2) Campos de verificación IA en professional_documents
ALTER TABLE public.professional_documents
  ADD COLUMN IF NOT EXISTS ai_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_score NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_notes TEXT,
  ADD COLUMN IF NOT EXISTS ai_extracted JSONB;

-- 3) Tabla de referencias del profesional (laborales / familiares)
CREATE TABLE IF NOT EXISTS public.professional_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('work','family')),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT,
  notes TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.professional_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY refs_select_owner_or_staff ON public.professional_references
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY refs_insert_self ON public.professional_references
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY refs_update_owner_or_staff ON public.professional_references
  FOR UPDATE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY refs_delete_owner_or_staff ON public.professional_references
  FOR DELETE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE TRIGGER refs_updated_at
  BEFORE UPDATE ON public.professional_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Geolocalización del profesional ya existe (lat/lng en professional_profiles), confirmamos que esté disponible.
