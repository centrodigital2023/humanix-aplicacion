-- Create document_ai_analyses table for AI-powered document verification
CREATE TABLE document_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_owner_id UUID NOT NULL,
  document_type TEXT NOT NULL, -- 'professional_documents', 'family_documents', 'institution_documents'
  analyzed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- AI Model Info
  model TEXT NOT NULL DEFAULT 'vision-ai-v1',
  model_version TEXT NOT NULL DEFAULT '1.0',
  
  -- Analysis Results
  verdict TEXT NOT NULL, -- 'approved', 'rejected', 'needs_review', 'expired'
  findings JSONB DEFAULT '{}', -- Structured findings from the model
  confidence NUMERIC(3,2), -- 0.00 to 1.00 confidence score
  raw_response JSONB, -- Full raw response from AI model
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Indexes for performance
  FOREIGN KEY (document_owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_ai_analyses_document_id ON document_ai_analyses(document_id);
CREATE INDEX idx_document_ai_analyses_document_owner_id ON document_ai_analyses(document_owner_id);
CREATE INDEX idx_document_ai_analyses_document_type ON document_ai_analyses(document_type);
CREATE INDEX idx_document_ai_analyses_verdict ON document_ai_analyses(verdict);
CREATE INDEX idx_document_ai_analyses_created_at ON document_ai_analyses(created_at DESC);

-- Enable RLS
ALTER TABLE document_ai_analyses ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own document analyses"
  ON document_ai_analyses FOR SELECT
  USING (auth.uid() = document_owner_id);

CREATE POLICY "Superadmin and staff can view all analyses"
  ON document_ai_analyses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('superadmin', 'hr_staff')
    )
  );

CREATE POLICY "System can create analyses"
  ON document_ai_analyses FOR INSERT
  WITH CHECK (
    auth.uid() = analyzed_by
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('superadmin', 'hr_staff')
    )
  );

CREATE POLICY "Admins can update analyses"
  ON document_ai_analyses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('superadmin', 'hr_staff')
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_document_ai_analyses_updated_at
  BEFORE UPDATE ON document_ai_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
