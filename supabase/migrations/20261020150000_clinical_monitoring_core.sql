-- Monitoreo clínico: habilita el riesgo del paciente (`PatientRiskCard`), el check-in/out del profesional (`CheckInOut`)
-- con sus evidencias y los umbrales de alerta (`clinical-alert-notify`). Reemplaza, para estas piezas,
-- 20260606100000_clinical_monitoring.sql, 20260606120000_evidence_bucket.sql y 20260606130000_fix_checkins_rls.sql, que nunca
-- se aplicaron. Sus fallas (AUDIT_REPORT.md #97) ya estaban descritas en 20261012100000_clinical_data_scope.sql: acceso «por
-- rol» a los datos clínicos de toda la plataforma. Aquí las tablas nacen con reglas «por servicio» desde el principio, más:
--   · `patient_risk_scores` era de solo lectura y el panel la escribía: el cálculo fallaba siempre. Ahora la escriben el
--     paciente y su profesional (reserva vigente); nadie la edita ni la borra, y queda quién la calculó.
--   · `service_checkins.booking_id` era texto sin referencia y `patient_id` lo elegía el profesional: podía mostrarle su
--     ubicación a cualquier cuenta. Ahora es la reserva real y el paciente sale de ella.
--   · El depósito `evidence` era PÚBLICO (fotos del domicilio y firmas del paciente, con enlace adivinable). Ahora es privado
--     y solo lo leen las partes del servicio.
--   · `create_default_thresholds` era SECURITY DEFINER sin search_path y la podía llamar cualquiera.
-- No se crean `vital_signs` ni `clinical_reports`: los signos vitales ya viven en `vital_signs_readings` (producción, con sus
-- reglas de 20261012150000) y el panel pasa a leer de ahí; ningún código usa `clinical_reports`. `clinical_alerts` ya existe.
-- Idempotente.

-- ─── 0. Quién puede ver los datos clínicos de una persona ──────────────────────────────────────────────────────────
-- La propia persona, su profesional con una reserva vigente con ella, o el superadmin (mismo criterio que
-- `vs_insert_owner_or_pro` en vital_signs_readings). RR. HH. y evaluadores no: es un dato de salud.
CREATE OR REPLACE FUNCTION public.hx_is_care_professional_of(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.professional_id = auth.uid() AND b.client_id = p_patient
       AND b.status::text IN ('confirmed', 'in_route', 'in_progress', 'completed'))
$$;
REVOKE ALL ON FUNCTION public.hx_is_care_professional_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_is_care_professional_of(uuid) TO authenticated, service_role;

-- ─── 1. Riesgo del paciente ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_risk_scores (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id      uuid         REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  score           numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  level           text         NOT NULL CHECK (level IN ('low', 'medium', 'high', 'critical')),
  factors         jsonb        CHECK (factors IS NULL OR length(factors::text) <= 20000),
  ai_summary      text         CHECK (ai_summary IS NULL OR length(ai_summary) <= 4000),
  recommendations jsonb        CHECK (recommendations IS NULL OR length(recommendations::text) <= 20000),
  trend           text         DEFAULT 'stable' CHECK (trend IN ('improving', 'stable', 'worsening')),
  previous_score  numeric(5,2) CHECK (previous_score IS NULL OR previous_score BETWEEN 0 AND 100),
  tenant_id       uuid,
  calculated_by   uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  calculated_at   timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_risk_scores ADD COLUMN IF NOT EXISTS calculated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_risk_scores_patient ON public.patient_risk_scores (patient_id, calculated_at DESC);

ALTER TABLE public.patient_risk_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_risk_scores FROM anon, authenticated;
GRANT SELECT, INSERT ON public.patient_risk_scores TO authenticated;
GRANT ALL ON public.patient_risk_scores TO service_role;

DROP POLICY IF EXISTS risk_scores_read ON public.patient_risk_scores;
CREATE POLICY risk_scores_read ON public.patient_risk_scores FOR SELECT TO authenticated
  USING (patient_id = auth.uid() OR public.hx_is_care_professional_of(patient_id)
         OR public.has_role(auth.uid(), 'superadmin'::public.app_role));
DROP POLICY IF EXISTS risk_scores_insert ON public.patient_risk_scores;
CREATE POLICY risk_scores_insert ON public.patient_risk_scores FOR INSERT TO authenticated
  WITH CHECK (patient_id = auth.uid() OR public.hx_is_care_professional_of(patient_id)
              OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

CREATE OR REPLACE FUNCTION public.stamp_patient_risk_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.calculated_by := auth.uid();
    NEW.calculated_at := now();
    NEW.created_at    := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_patient_risk_score() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_stamp_patient_risk_score ON public.patient_risk_scores;
CREATE TRIGGER trg_stamp_patient_risk_score BEFORE INSERT ON public.patient_risk_scores
  FOR EACH ROW EXECUTE FUNCTION public.stamp_patient_risk_score();

-- ─── 2. Umbrales de alerta (los usa clinical-alert-notify con la clave de servicio) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_thresholds (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vital_type      text          NOT NULL CHECK (vital_type IN ('heart_rate', 'spo2', 'temperature', 'blood_pressure_sys',
                                  'blood_pressure_dia', 'respiration_rate', 'respiratory_rate', 'glucose', 'weight', 'steps')),
  min_value       numeric(10,2),
  max_value       numeric(10,2),
  enabled         boolean       NOT NULL DEFAULT true,
  notify_whatsapp boolean       NOT NULL DEFAULT true,
  notify_push     boolean       NOT NULL DEFAULT true,
  notify_email    boolean       NOT NULL DEFAULT false,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (patient_id, vital_type),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value < max_value)
);
ALTER TABLE public.alert_thresholds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_thresholds FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_thresholds TO authenticated;
GRANT ALL ON public.alert_thresholds TO service_role;

DROP POLICY IF EXISTS alert_thresholds_owner ON public.alert_thresholds;
CREATE POLICY alert_thresholds_owner ON public.alert_thresholds FOR ALL TO authenticated
  USING (patient_id = auth.uid() OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (patient_id = auth.uid() OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

DROP TRIGGER IF EXISTS trg_alert_thresholds_updated_at ON public.alert_thresholds;
CREATE TRIGGER trg_alert_thresholds_updated_at BEFORE UPDATE ON public.alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.create_default_thresholds(p_patient_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.alert_thresholds (patient_id, vital_type, min_value, max_value) VALUES
    (p_patient_id, 'heart_rate', 50, 110), (p_patient_id, 'spo2', 92, NULL), (p_patient_id, 'temperature', 35.5, 37.5),
    (p_patient_id, 'blood_pressure_sys', 90, 140), (p_patient_id, 'blood_pressure_dia', 60, 90),
    (p_patient_id, 'respiration_rate', 10, 25)
  ON CONFLICT (patient_id, vital_type) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.create_default_thresholds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_default_thresholds(uuid) TO service_role;

-- ─── 3. Check-in / check-out del profesional ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_checkins (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid          NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  professional_id         uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id              uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  checkin_at              timestamptz,
  checkin_lat             numeric(10,7) CHECK (checkin_lat IS NULL OR checkin_lat BETWEEN -90 AND 90),
  checkin_lng             numeric(10,7) CHECK (checkin_lng IS NULL OR checkin_lng BETWEEN -180 AND 180),
  checkin_accuracy_m      numeric(8,1),
  checkin_address         text          CHECK (checkin_address IS NULL OR length(checkin_address) <= 300),
  checkout_at             timestamptz,
  checkout_lat            numeric(10,7) CHECK (checkout_lat IS NULL OR checkout_lat BETWEEN -90 AND 90),
  checkout_lng            numeric(10,7) CHECK (checkout_lng IS NULL OR checkout_lng BETWEEN -180 AND 180),
  checkout_accuracy_m     numeric(8,1),
  checkout_address        text          CHECK (checkout_address IS NULL OR length(checkout_address) <= 300),
  evidence_urls           text[]        CHECK (evidence_urls IS NULL OR cardinality(evidence_urls) <= 20),
  notes                   text          CHECK (notes IS NULL OR length(notes) <= 4000),
  digital_signature_url   text,
  signature_hash          text,
  sos_triggered           boolean       NOT NULL DEFAULT false,
  sos_at                  timestamptz,
  sos_lat                 numeric(10,7),
  sos_lng                 numeric(10,7),
  duration_minutes        integer       CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 10080),
  distance_from_patient_m integer,
  status                  text          NOT NULL DEFAULT 'not_started'
                                        CHECK (status IN ('not_started', 'checked_in', 'completed', 'cancelled')),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (booking_id, professional_id)
);
CREATE INDEX IF NOT EXISTS idx_checkins_professional ON public.service_checkins (professional_id);
CREATE INDEX IF NOT EXISTS idx_checkins_patient ON public.service_checkins (patient_id);

ALTER TABLE public.service_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_checkins FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_checkins TO authenticated;
GRANT ALL ON public.service_checkins TO service_role;

DROP POLICY IF EXISTS checkins_professional_all ON public.service_checkins;
DROP POLICY IF EXISTS checkins_patient_read ON public.service_checkins;
DROP POLICY IF EXISTS checkins_read ON public.service_checkins;
CREATE POLICY checkins_read ON public.service_checkins FOR SELECT TO authenticated
  USING (professional_id = auth.uid() OR patient_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = service_checkins.booking_id AND sb.client_id = auth.uid())
         OR public.has_role(auth.uid(), 'superadmin'::public.app_role));
DROP POLICY IF EXISTS checkins_professional_insert ON public.service_checkins;
CREATE POLICY checkins_professional_insert ON public.service_checkins FOR INSERT TO authenticated
  WITH CHECK (professional_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = service_checkins.booking_id AND sb.professional_id = auth.uid()));
DROP POLICY IF EXISTS checkins_professional_update ON public.service_checkins;
CREATE POLICY checkins_professional_update ON public.service_checkins FOR UPDATE TO authenticated
  USING (professional_id = auth.uid()) WITH CHECK (professional_id = auth.uid());

-- El paciente sale de la reserva (no lo elige el profesional) y la reserva, el profesional y la fecha de creación no cambian.
CREATE OR REPLACE FUNCTION public.guard_service_checkins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.booking_id      := OLD.booking_id;
    NEW.professional_id := OLD.professional_id;
    NEW.created_at      := OLD.created_at;
  END IF;
  SELECT sb.client_id INTO NEW.patient_id FROM public.service_bookings sb WHERE sb.id = NEW.booking_id;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_service_checkins() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_service_checkins ON public.service_checkins;
CREATE TRIGGER trg_guard_service_checkins BEFORE INSERT OR UPDATE ON public.service_checkins
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_checkins();

-- ─── 4. Evidencias del check-out: depósito PRIVADO ─────────────────────────────────────────────────────────────────
-- Ruta: checkins/{booking_id}/{professional_id}/{archivo}. Sube el profesional del servicio; leen las partes y el superadmin.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('evidence', 'evidence', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.hx_evidence_booking(p_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[] := string_to_array(p_name, '/');
BEGIN
  IF array_length(parts, 1) <> 4 OR parts[1] <> 'checkins' THEN RETURN NULL; END IF;
  RETURN parts[2]::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hx_evidence_booking(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_evidence_booking(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "evidence_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "evidence_read_public" ON storage.objects;
DROP POLICY IF EXISTS evidence_insert_professional ON storage.objects;
CREATE POLICY evidence_insert_professional ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence'
              AND split_part(name, '/', 3) = auth.uid()::text
              AND EXISTS (SELECT 1 FROM public.service_bookings sb
                           WHERE sb.id = public.hx_evidence_booking(name) AND sb.professional_id = auth.uid()));
DROP POLICY IF EXISTS evidence_read_parties ON storage.objects;
CREATE POLICY evidence_read_parties ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'evidence'
         AND (EXISTS (SELECT 1 FROM public.service_bookings sb
                       WHERE sb.id = public.hx_evidence_booking(name)
                         AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid()))
              OR public.has_role(auth.uid(), 'superadmin'::public.app_role)));

-- ─── 5. Realtime ───────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_risk_scores', 'service_checkins'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
