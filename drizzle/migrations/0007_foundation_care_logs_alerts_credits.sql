-- Tablas base que necesitan los pasos 1.3 y 1.4 (versión segura de las migraciones originales).
CREATE TABLE IF NOT EXISTS public.care_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  patient_name TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('arrival','medication','vital_signs','meal','activity','note','incident','departure')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 800),
  vital_systolic INTEGER CHECK (vital_systolic BETWEEN 50 AND 250),
  vital_diastolic INTEGER CHECK (vital_diastolic BETWEEN 30 AND 150),
  vital_heart_rate INTEGER CHECK (vital_heart_rate BETWEEN 20 AND 300),
  vital_temperature NUMERIC(4,1) CHECK (vital_temperature BETWEEN 30 AND 45),
  vital_oxygen INTEGER CHECK (vital_oxygen BETWEEN 50 AND 100),
  photo_url TEXT,
  is_alert BOOLEAN NOT NULL DEFAULT false,
  alert_reason TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_care_logs_booking ON public.care_logs (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_logs_pro ON public.care_logs (professional_id);
GRANT SELECT, INSERT ON public.care_logs TO authenticated;
GRANT ALL ON public.care_logs TO service_role;
ALTER TABLE public.care_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY care_logs_professional_insert ON public.care_logs FOR INSERT TO authenticated
  WITH CHECK (professional_id = auth.uid() AND EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = booking_id AND sb.professional_id = auth.uid()));
CREATE POLICY care_logs_read ON public.care_logs FOR SELECT TO authenticated
  USING (professional_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = booking_id AND sb.client_id = auth.uid())
    OR public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.clinical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  vital_sign_id UUID,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('high_heart_rate','low_heart_rate','low_spo2','high_temperature','low_temperature','high_blood_pressure','low_blood_pressure','fall_detected','inactivity','high_respiration','abnormal_glucose')),
  threshold_value NUMERIC(10,2),
  actual_value NUMERIC(10,2) NOT NULL,
  unit TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved','false_positive')),
  notified_whatsapp BOOLEAN NOT NULL DEFAULT false,
  notified_push BOOLEAN NOT NULL DEFAULT false,
  notified_email BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  tenant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_patient ON public.clinical_alerts (patient_id, created_at DESC);
GRANT SELECT, UPDATE ON public.clinical_alerts TO authenticated;
GRANT ALL ON public.clinical_alerts TO service_role;
ALTER TABLE public.clinical_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinical_alerts_read ON public.clinical_alerts FOR SELECT TO authenticated
  USING (patient_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = booking_id AND sb.professional_id = auth.uid())
    OR public.is_staff(auth.uid()));
CREATE POLICY clinical_alerts_ack ON public.clinical_alerts FOR UPDATE TO authenticated
  USING (patient_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (patient_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_credit_packs_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  credits INTEGER NOT NULL CHECK (credits > 0),
  price_cop INTEGER NOT NULL CHECK (price_cop > 0),
  bonus_pct INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 90,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_credit_packs_catalog TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ai_credit_packs_catalog TO authenticated;
GRANT ALL ON public.ai_credit_packs_catalog TO service_role;
ALTER TABLE public.ai_credit_packs_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY packs_public_read ON public.ai_credit_packs_catalog FOR SELECT USING (active = true);
CREATE POLICY packs_superadmin_manage ON public.ai_credit_packs_catalog FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin')) WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE TABLE IF NOT EXISTS public.ai_credit_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pack_id TEXT REFERENCES public.ai_credit_packs_catalog(id),
  credits INTEGER NOT NULL CHECK (credits > 0),
  credits_used INTEGER NOT NULL DEFAULT 0,
  price_cop INTEGER NOT NULL,
  mp_payment_id TEXT,
  mp_preference_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'purchase',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_credit_topups_user_expires ON public.ai_credit_topups (user_id, expires_at);
GRANT SELECT ON public.ai_credit_topups TO authenticated;
GRANT ALL ON public.ai_credit_topups TO service_role;
ALTER TABLE public.ai_credit_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY topups_read_own ON public.ai_credit_topups FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'superadmin'));

CREATE OR REPLACE FUNCTION public.grant_ai_credits(
  p_user_id UUID, p_pack_id TEXT, p_credits INTEGER, p_price_cop INTEGER,
  p_mp_payment_id TEXT DEFAULT NULL, p_mp_preference_id TEXT DEFAULT NULL, p_validity_days INTEGER DEFAULT 90)
RETURNS public.ai_credit_topups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ai_credit_topups;
BEGIN
  INSERT INTO public.ai_credit_topups (user_id, pack_id, credits, price_cop, mp_payment_id, mp_preference_id, expires_at, source)
  VALUES (p_user_id, p_pack_id, p_credits, p_price_cop, p_mp_payment_id, p_mp_preference_id,
          now() + (p_validity_days || ' days')::interval,
          CASE WHEN p_mp_payment_id IS NOT NULL THEN 'purchase' ELSE 'admin_grant' END)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.grant_ai_credits(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan TEXT; v_status TEXT; v_period_end TIMESTAMPTZ;
BEGIN
  SELECT plan, status, current_period_end INTO v_plan, v_status, v_period_end
  FROM public.mp_subscriptions WHERE user_id = p_user_id;
  IF v_plan IS NOT NULL AND v_status IN ('active','approved')
     AND (v_period_end IS NULL OR v_period_end > now())
     AND v_plan IN ('essential_monthly','pro_monthly','institution_monthly') THEN
    RETURN 0;
  END IF;
  RETURN 12;
END $$;
REVOKE ALL ON FUNCTION public.platform_commission_pct(UUID) FROM PUBLIC, anon;