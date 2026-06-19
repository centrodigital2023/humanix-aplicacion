
-- ============ interview_schedules ============
CREATE TABLE public.interview_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL,
  scheduled_by UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  location TEXT,
  channel TEXT NOT NULL DEFAULT 'video' CHECK (channel IN ('video','phone','whatsapp','in_person','email')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','no_show','cancelled','rescheduled')),
  message TEXT,
  sent_via TEXT[] DEFAULT '{}'::text[],
  outcome TEXT,
  outcome_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_schedules TO authenticated;
GRANT ALL ON public.interview_schedules TO service_role;

ALTER TABLE public.interview_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "is_select_involved" ON public.interview_schedules FOR SELECT TO authenticated
  USING (auth.uid() = professional_id OR auth.uid() = scheduled_by OR public.is_staff(auth.uid()));

CREATE POLICY "is_insert_staff" ON public.interview_schedules FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND auth.uid() = scheduled_by);

CREATE POLICY "is_update_staff_or_pro_confirm" ON public.interview_schedules FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()) OR auth.uid() = professional_id);

CREATE POLICY "is_delete_staff" ON public.interview_schedules FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE INDEX idx_is_pro ON public.interview_schedules(professional_id, scheduled_at DESC);
CREATE INDEX idx_is_status ON public.interview_schedules(status, scheduled_at);

CREATE TRIGGER trg_is_updated_at BEFORE UPDATE ON public.interview_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.interview_schedules;
ALTER TABLE public.interview_schedules REPLICA IDENTITY FULL;

-- ============ vital_signs_readings ============
CREATE TABLE public.vital_signs_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id UUID NOT NULL,
  patient_label TEXT,
  reading_type TEXT NOT NULL CHECK (reading_type IN ('heart_rate','blood_pressure_sys','blood_pressure_dia','spo2','temperature','glucose','respiratory_rate','weight','pain_scale','custom')),
  value NUMERIC NOT NULL,
  value_secondary NUMERIC,
  unit TEXT,
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal','watch','warning','critical')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','wearable','iot','professional','ai_estimate')),
  recorded_by UUID,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vital_signs_readings TO authenticated;
GRANT ALL ON public.vital_signs_readings TO service_role;

ALTER TABLE public.vital_signs_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vs_select_owner_or_recorder_or_staff" ON public.vital_signs_readings FOR SELECT TO authenticated
  USING (auth.uid() = family_user_id OR auth.uid() = recorded_by OR public.is_staff(auth.uid()));

CREATE POLICY "vs_insert_owner_or_pro" ON public.vital_signs_readings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = family_user_id OR auth.uid() = recorded_by OR public.is_staff(auth.uid()));

CREATE POLICY "vs_update_owner_or_staff" ON public.vital_signs_readings FOR UPDATE TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

CREATE POLICY "vs_delete_owner_or_staff" ON public.vital_signs_readings FOR DELETE TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

CREATE INDEX idx_vs_family_time ON public.vital_signs_readings(family_user_id, recorded_at DESC);
CREATE INDEX idx_vs_severity ON public.vital_signs_readings(severity, recorded_at DESC) WHERE severity IN ('warning','critical');

ALTER PUBLICATION supabase_realtime ADD TABLE public.vital_signs_readings;
ALTER TABLE public.vital_signs_readings REPLICA IDENTITY FULL;

-- ============ professional_deletion_log ============
CREATE TABLE public.professional_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id UUID NOT NULL,
  deleted_email TEXT,
  deleted_full_name TEXT,
  reason TEXT,
  deleted_by UUID NOT NULL,
  deleted_by_email TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.professional_deletion_log TO authenticated;
GRANT ALL ON public.professional_deletion_log TO service_role;

ALTER TABLE public.professional_deletion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdl_staff_select" ON public.professional_deletion_log FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "pdl_staff_insert" ON public.professional_deletion_log FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND auth.uid() = deleted_by);

CREATE INDEX idx_pdl_created ON public.professional_deletion_log(created_at DESC);

-- ============ document_ai_analyses ============
CREATE TABLE public.document_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_table TEXT NOT NULL CHECK (document_table IN ('professional_documents','family_documents','institution_documents','application_documents')),
  document_owner_id UUID NOT NULL,
  analyzed_by UUID,
  model TEXT,
  model_version TEXT,
  score NUMERIC,
  verdict TEXT CHECK (verdict IN ('approved','review','rejected','inconclusive')),
  summary TEXT,
  findings JSONB,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_ai_analyses TO authenticated;
GRANT ALL ON public.document_ai_analyses TO service_role;

ALTER TABLE public.document_ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daa_select_owner_or_staff" ON public.document_ai_analyses FOR SELECT TO authenticated
  USING (auth.uid() = document_owner_id OR public.is_staff(auth.uid()));

CREATE POLICY "daa_insert_staff" ON public.document_ai_analyses FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND auth.uid() = analyzed_by);

CREATE INDEX idx_daa_doc ON public.document_ai_analyses(document_table, document_id, created_at DESC);
CREATE INDEX idx_daa_owner ON public.document_ai_analyses(document_owner_id, created_at DESC);
