-- ═══════════════════════════════════════════════════════════════════════════
-- HUMANIX CLINICAL MONITORING ENGINE
-- Monitoreo clínico en tiempo real: signos vitales, alertas, checkins, riesgo
-- Módulos: 4-Vitales · 5-Alertas · 3-CheckIn/Out · 6-HumanixAI · 7-EPS
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. VITAL SIGNS  (Apple HealthKit / Google Health Connect / Manual)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vital_signs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id       UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  type             TEXT        NOT NULL
                               CHECK (type IN (
                                 'heart_rate',
                                 'spo2',
                                 'temperature',
                                 'blood_pressure_sys',
                                 'blood_pressure_dia',
                                 'respiration_rate',
                                 'steps',
                                 'fall_detected',
                                 'glucose',
                                 'weight'
                               )),
  value            NUMERIC(10,2) NOT NULL,
  unit             TEXT        NOT NULL,  -- 'bpm', '%', '°C', 'mmHg', 'breaths/min', 'steps', 'boolean', 'mg/dL', 'kg'
  device_source    TEXT        DEFAULT 'manual'
                               CHECK (device_source IN (
                                 'apple_healthkit',
                                 'google_health_connect',
                                 'manual',
                                 'iot_sensor',
                                 'wearable'
                               )),
  device_id        TEXT,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_sent       BOOLEAN     NOT NULL DEFAULT false,
  tenant_id        UUID,       -- EPS/IPS tenant for multi-tenant queries
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vital_signs_patient     ON public.vital_signs (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vital_signs_type        ON public.vital_signs (type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vital_signs_booking     ON public.vital_signs (booking_id);
CREATE INDEX IF NOT EXISTS idx_vital_signs_tenant      ON public.vital_signs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vital_signs_alert_sent  ON public.vital_signs (alert_sent) WHERE alert_sent = false;

ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;

-- Profesional registra vitales del paciente asignado
CREATE POLICY "vital_signs_professional_insert"
  ON public.vital_signs FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      patient_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.service_bookings sb
        WHERE sb.id = booking_id AND sb.professional_id = auth.uid()
      )
    )
  );

-- Paciente/familia ve sus propios vitales
CREATE POLICY "vital_signs_patient_select"
  ON public.vital_signs FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.service_bookings sb
      WHERE sb.id = booking_id
        AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. ALERT THRESHOLDS (configuración personalizada por paciente)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_thresholds (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_type        TEXT        NOT NULL,
  min_value         NUMERIC(10,2),
  max_value         NUMERIC(10,2),
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  notify_whatsapp   BOOLEAN     NOT NULL DEFAULT true,
  notify_push       BOOLEAN     NOT NULL DEFAULT true,
  notify_email      BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, vital_type)
);

CREATE INDEX IF NOT EXISTS idx_alert_thresholds_patient ON public.alert_thresholds (patient_id);

ALTER TABLE public.alert_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_thresholds_owner"
  ON public.alert_thresholds FOR ALL
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. CLINICAL ALERTS (alertas automáticas generadas por el motor)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_alerts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_sign_id     UUID        REFERENCES public.vital_signs(id) ON DELETE SET NULL,
  booking_id        UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  alert_type        TEXT        NOT NULL
                                CHECK (alert_type IN (
                                  'high_heart_rate',
                                  'low_heart_rate',
                                  'low_spo2',
                                  'high_temperature',
                                  'low_temperature',
                                  'high_blood_pressure',
                                  'low_blood_pressure',
                                  'fall_detected',
                                  'inactivity',
                                  'high_respiration',
                                  'abnormal_glucose'
                                )),
  threshold_value   NUMERIC(10,2),
  actual_value      NUMERIC(10,2) NOT NULL,
  unit              TEXT,
  severity          TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'acknowledged', 'resolved', 'false_positive')),
  notified_whatsapp BOOLEAN     NOT NULL DEFAULT false,
  notified_push     BOOLEAN     NOT NULL DEFAULT false,
  notified_email    BOOLEAN     NOT NULL DEFAULT false,
  notified_at       TIMESTAMPTZ,
  acknowledged_by   UUID        REFERENCES auth.users(id),
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  notes             TEXT,
  tenant_id         UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_alerts_patient  ON public.clinical_alerts (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_status   ON public.clinical_alerts (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_severity ON public.clinical_alerts (severity);
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_tenant   ON public.clinical_alerts (tenant_id);

ALTER TABLE public.clinical_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinical_alerts_read"
  ON public.clinical_alerts FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.service_bookings sb
      WHERE sb.id = booking_id
        AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution')
    )
  );

CREATE POLICY "clinical_alerts_update"
  ON public.clinical_alerts FOR UPDATE
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution', 'professional')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4. SERVICE CHECK-INS (Check-in/out geolocalizado del profesional)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_checkins (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            TEXT        NOT NULL,
  professional_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Check-in
  checkin_at            TIMESTAMPTZ,
  checkin_lat           NUMERIC(10,7),
  checkin_lng           NUMERIC(10,7),
  checkin_accuracy_m    NUMERIC(6,1),
  checkin_address       TEXT,
  -- Check-out
  checkout_at           TIMESTAMPTZ,
  checkout_lat          NUMERIC(10,7),
  checkout_lng          NUMERIC(10,7),
  checkout_accuracy_m   NUMERIC(6,1),
  checkout_address      TEXT,
  -- Evidencias
  evidence_urls         TEXT[],
  notes                 TEXT,
  -- Firma digital
  digital_signature_url TEXT,
  signature_hash        TEXT,           -- SHA-256 de la firma para validez legal
  -- SOS
  sos_triggered         BOOLEAN     NOT NULL DEFAULT false,
  sos_at                TIMESTAMPTZ,
  sos_lat               NUMERIC(10,7),
  sos_lng               NUMERIC(10,7),
  -- Métricas
  duration_minutes      INTEGER,        -- calculado al hacer checkout
  distance_from_patient_m INTEGER,      -- distancia al domicilio del paciente
  status                TEXT        NOT NULL DEFAULT 'not_started'
                                    CHECK (status IN ('not_started', 'checked_in', 'completed', 'cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkins_booking       ON public.service_checkins (booking_id);
CREATE INDEX IF NOT EXISTS idx_checkins_professional  ON public.service_checkins (professional_id);
CREATE INDEX IF NOT EXISTS idx_checkins_patient       ON public.service_checkins (patient_id);
CREATE INDEX IF NOT EXISTS idx_checkins_status        ON public.service_checkins (status);
CREATE INDEX IF NOT EXISTS idx_checkins_sos           ON public.service_checkins (sos_triggered) WHERE sos_triggered = true;

ALTER TABLE public.service_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkins_professional_all"
  ON public.service_checkins FOR ALL
  USING (professional_id = auth.uid());

CREATE POLICY "checkins_patient_read"
  ON public.service_checkins FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution', 'family')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 5. PATIENT RISK SCORES (motor de IA clínico)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_risk_scores (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id       UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  score            NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  level            TEXT        NOT NULL
                               CHECK (level IN ('low', 'medium', 'high', 'critical')),
  factors          JSONB,      -- [{ name, weight, value, description }]
  ai_summary       TEXT,       -- resumen clínico en español generado por GPT-4
  recommendations  JSONB,      -- [{ priority, action, rationale }]
  trend            TEXT        DEFAULT 'stable'
                               CHECK (trend IN ('improving', 'stable', 'worsening')),
  previous_score   NUMERIC(5,2),
  tenant_id        UUID,
  calculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_patient  ON public.patient_risk_scores (patient_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scores_level    ON public.patient_risk_scores (level);
CREATE INDEX IF NOT EXISTS idx_risk_scores_tenant   ON public.patient_risk_scores (tenant_id);

ALTER TABLE public.patient_risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_scores_read"
  ON public.patient_risk_scores FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution', 'professional')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 6. CLINICAL REPORTS (reportes automáticos IA)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id       UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  period           TEXT        NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  report_text      TEXT        NOT NULL,
  summary          TEXT,
  pdf_url          TEXT,
  vitals_summary   JSONB,
  alerts_count     INTEGER     DEFAULT 0,
  risk_score       NUMERIC(5,2),
  generated_by     TEXT        DEFAULT 'humanix_ai',
  tenant_id        UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_reports_patient ON public.clinical_reports (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_reports_tenant  ON public.clinical_reports (tenant_id);

ALTER TABLE public.clinical_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinical_reports_read"
  ON public.clinical_reports FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution', 'professional')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 7. RPC: Compute patient risk level from score
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.risk_level_from_score(p_score NUMERIC)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_score < 25 THEN RETURN 'low';
  ELSIF p_score < 50 THEN RETURN 'medium';
  ELSIF p_score < 75 THEN RETURN 'high';
  ELSE RETURN 'critical';
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. REALTIME: habilitar para tablas clave
-- ──────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.vital_signs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clinical_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_checkins;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. VIEW: EPS dashboard metrics (multi-tenant)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.eps_dashboard_metrics AS
SELECT
  prs.tenant_id,
  COUNT(DISTINCT prs.patient_id)                                    AS total_patients,
  COUNT(DISTINCT CASE WHEN prs.level = 'critical' THEN prs.patient_id END) AS critical_patients,
  COUNT(DISTINCT CASE WHEN prs.level = 'high'     THEN prs.patient_id END) AS high_risk_patients,
  COUNT(DISTINCT CASE WHEN prs.level = 'medium'   THEN prs.patient_id END) AS medium_risk_patients,
  COUNT(DISTINCT CASE WHEN prs.level = 'low'      THEN prs.patient_id END) AS low_risk_patients,
  ROUND(AVG(prs.score), 1)                                          AS avg_risk_score,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.status = 'active')        AS active_alerts,
  COUNT(DISTINCT ca.id) FILTER (
    WHERE ca.severity = 'critical' AND ca.status = 'active'
  )                                                                 AS critical_alerts
FROM public.patient_risk_scores prs
LEFT JOIN public.clinical_alerts ca ON ca.patient_id = prs.patient_id
WHERE prs.calculated_at > NOW() - INTERVAL '24 hours'
GROUP BY prs.tenant_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 10. Default thresholds INSERT function (used by edge function on patient creation)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_default_thresholds(p_patient_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_thresholds (patient_id, vital_type, min_value, max_value)
  VALUES
    (p_patient_id, 'heart_rate',         50,    110),
    (p_patient_id, 'spo2',               92,    null),
    (p_patient_id, 'temperature',        35.5,  37.5),
    (p_patient_id, 'blood_pressure_sys', 90,    140),
    (p_patient_id, 'blood_pressure_dia', 60,    90),
    (p_patient_id, 'respiration_rate',   10,    25)
  ON CONFLICT (patient_id, vital_type) DO NOTHING;
END;
$$;
