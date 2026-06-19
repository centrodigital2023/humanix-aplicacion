CREATE TABLE IF NOT EXISTS public.institution_patient_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_age INTEGER,
  patient_relation TEXT,
  city TEXT,
  service_address TEXT,
  care_type TEXT,
  acuity_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  case_notes TEXT,
  health_conditions TEXT[] NOT NULL DEFAULT '{}',
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  coordinator_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.institution_patient_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "institution_patient_cases_select_own"
  ON public.institution_patient_cases
  FOR SELECT
  USING (
    auth.uid() = institution_user_id
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('superadmin', 'hr_staff', 'evaluator')
    )
  );

CREATE POLICY "institution_patient_cases_insert_own"
  ON public.institution_patient_cases
  FOR INSERT
  WITH CHECK (auth.uid() = institution_user_id);

CREATE POLICY "institution_patient_cases_update_own"
  ON public.institution_patient_cases
  FOR UPDATE
  USING (
    auth.uid() = institution_user_id
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('superadmin', 'hr_staff')
    )
  )
  WITH CHECK (
    auth.uid() = institution_user_id
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('superadmin', 'hr_staff')
    )
  );

CREATE INDEX IF NOT EXISTS idx_institution_patient_cases_institution
  ON public.institution_patient_cases(institution_user_id, status, created_at DESC);

CREATE TRIGGER trg_institution_patient_cases_updated_at
  BEFORE UPDATE ON public.institution_patient_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime
  ADD TABLE public.institution_patient_cases;
