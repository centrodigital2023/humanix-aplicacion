ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS data_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS rethus_checked_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_professional_trust_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role' OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.verification_status := OLD.verification_status;
  NEW.rethus_checked_at   := OLD.rethus_checked_at;
  NEW.rethus_verified     := OLD.rethus_verified;
  NEW.verified            := OLD.verified;
  NEW.trust_score         := OLD.trust_score;
  NEW.avg_rating          := OLD.avg_rating;
  NEW.total_jobs          := OLD.total_jobs;
  NEW.user_id             := OLD.user_id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_professional_trust_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_professional_trust_fields ON public.professional_profiles;
CREATE TRIGGER trg_guard_professional_trust_fields
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_trust_fields();

DROP POLICY IF EXISTS pro_update_self ON public.professional_profiles;
CREATE POLICY pro_update_self ON public.professional_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.professional_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'verifik',
  check_type text NOT NULL DEFAULT 'rethus',
  document_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('verified','not_found','name_mismatch','error')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_verif_user_time ON public.professional_verifications (user_id, created_at DESC);
GRANT SELECT ON public.professional_verifications TO authenticated;
GRANT ALL ON public.professional_verifications TO service_role;
ALTER TABLE public.professional_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY prof_verif_read ON public.professional_verifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS mpp_insert_self ON public.mp_payments;