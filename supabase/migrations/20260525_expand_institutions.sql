-- ============= EXPAND INSTITUTION PROFILES =============
-- Agregar campos para cámara de comercio y compliance

ALTER TABLE public.institution_profiles ADD COLUMN IF NOT EXISTS
  chamber_of_commerce_number TEXT,
  chamber_of_commerce_date DATE,
  legal_representative_name TEXT,
  legal_representative_email TEXT,
  legal_representative_phone TEXT,
  compliance_fuid BOOLEAN DEFAULT false,
  compliance_notes TEXT,
  seo_meta_keywords TEXT[] DEFAULT '{}',
  seo_meta_description TEXT;

CREATE INDEX IF NOT EXISTS idx_institution_profiles_verified 
  ON institution_profiles(verified, updated_at DESC);

-- ============= INSTITUTION DOCUMENTS TABLE =============
-- Para almacenar certificaciones, registros, compliance docs

CREATE TYPE public.institution_doc_type AS ENUM (
  'nit_certificate',
  'chamber_of_commerce',
  'legal_verification',
  'insurance',
  'quality_certification',
  'compliance_report',
  'other'
);

CREATE TYPE public.institution_doc_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'expired',
  'under_review'
);

CREATE TABLE IF NOT EXISTS public.institution_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type public.institution_doc_type NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  status public.institution_doc_status DEFAULT 'pending',
  expires_at DATE,
  reviewer_id UUID REFERENCES auth.users(id),
  reviewer_note TEXT,
  reviewed_at TIMESTAMPTZ,
  ai_verified BOOLEAN DEFAULT false,
  ai_score DECIMAL(5,2),
  ai_notes TEXT,
  ai_extracted JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.institution_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_own_docs" ON institution_documents 
  FOR SELECT USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('superadmin', 'evaluator')
  ));

CREATE POLICY "user_insert_own_docs" ON institution_documents 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "evaluator_update_docs" ON institution_documents 
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('superadmin', 'evaluator')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('superadmin', 'evaluator')
  ));

CREATE TRIGGER trg_inst_docs_updated_at 
  BEFORE UPDATE ON institution_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_institution_documents_user_id 
  ON institution_documents(user_id);
CREATE INDEX idx_institution_documents_status 
  ON institution_documents(status);
CREATE INDEX idx_institution_documents_expires_at 
  ON institution_documents(expires_at) WHERE expires_at IS NOT NULL;

-- ============= REQUISITOS AVANZADOS PARA OFERTAS =============
-- Ampliar requirements para incluir antecedentes, policía, procuraduría

CREATE TYPE public.requirement_type AS ENUM (
  'certification',
  'experience_years',
  'language',
  'background_check',
  'police_check',
  'prosecutor_check',
  'public_defender_check',
  'medical_exam',
  'psychological_evaluation',
  'reference',
  'other'
);

CREATE TABLE IF NOT EXISTS public.job_offer_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_offer_id UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
  requirement_type public.requirement_type NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_offer_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_requirements_public" ON job_offer_requirements 
  FOR SELECT USING (true);

CREATE INDEX idx_job_offer_requirements_offer_id 
  ON job_offer_requirements(job_offer_id);

-- ============= APPLICATION DOCUMENTS =============
-- Documentos adjuntos en aplicaciones (para cumplir FUID)

CREATE TABLE IF NOT EXISTS public.application_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  upload_date TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(20) DEFAULT 'submitted',
  verification_status VARCHAR(20),
  retention_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_docs_visible" ON application_documents 
  FOR SELECT USING (TRUE);

CREATE INDEX idx_application_documents_application_id 
  ON application_documents(application_id);
CREATE INDEX idx_application_documents_retention_until 
  ON application_documents(retention_until);

-- ============= CRM CONTACTS TABLE =============
-- Para integración CRM

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES auth.users(id),
  contact_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  contact_type VARCHAR(50),
  company_name TEXT,
  segment VARCHAR(50),
  status VARCHAR(50) DEFAULT 'active',
  last_interaction TIMESTAMPTZ,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_contacts_owned" ON crm_contacts 
  FOR SELECT USING (auth.uid() = organization_id);

CREATE POLICY "crm_contacts_insert_own" ON crm_contacts 
  FOR INSERT WITH CHECK (auth.uid() = organization_id);

CREATE POLICY "crm_contacts_update_own" ON crm_contacts 
  FOR UPDATE USING (auth.uid() = organization_id)
  WITH CHECK (auth.uid() = organization_id);

CREATE INDEX idx_crm_contacts_org_id 
  ON crm_contacts(organization_id);
CREATE INDEX idx_crm_contacts_status 
  ON crm_contacts(status);

-- ============= CRM CAMPAIGNS TABLE =============

CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES auth.users(id),
  campaign_name TEXT NOT NULL,
  campaign_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'draft',
  segment TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  total_recipients INTEGER,
  open_rate DECIMAL(5,2),
  click_rate DECIMAL(5,2),
  conversion_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaigns_owned" ON crm_campaigns 
  FOR SELECT USING (auth.uid() = organization_id);

CREATE INDEX idx_crm_campaigns_org_id 
  ON crm_campaigns(organization_id);

-- ============= EVALUATOR ROLE TABLE ENHANCEMENT =============
-- Agregar evaluator como rol completo

INSERT INTO public.user_roles (user_id, role) 
SELECT DISTINCT reviewed_by, 'evaluator' 
FROM professional_documents 
WHERE reviewed_by IS NOT NULL 
  AND NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = professional_documents.reviewed_by 
    AND user_roles.role = 'evaluator'
  )
ON CONFLICT DO NOTHING;
