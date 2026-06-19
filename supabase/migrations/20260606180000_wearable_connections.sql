-- ═══════════════════════════════════════════════════════════════════════════
-- WEARABLE CONNECTIONS + MOTOR DE EVALUACIÓN DE ALERTAS
-- Vincula dispositivos (Garmin/Fitbit/Oura/Apple Health/Google Health/...) al
-- paciente y cierra el ciclo vital_signs -> clinical_alerts -> WhatsApp que
-- hoy no existía (clinical-alert-notify esperaba filas que nadie creaba).
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. WEARABLE CONNECTIONS (estado de vinculación por proveedor)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wearable_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT        NOT NULL
                                CHECK (provider IN (
                                  'apple_healthkit',
                                  'google_health_connect',
                                  'garmin',
                                  'fitbit',
                                  'oura',
                                  'whoop',
                                  'polar',
                                  'samsung_health'
                                )),
  -- Código de emparejamiento que la app/dispositivo usa para autenticar el
  -- envío de datos a la función wearable-ingest (no son tokens OAuth: el
  -- proveedor real se integra desde el dispositivo/app móvil, no desde aquí)
  external_user_id  TEXT        NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  device_name       TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'disconnected', 'error')),
  last_synced_at    TIMESTAMPTZ,
  last_error        TEXT,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, provider),
  UNIQUE (provider, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_wearable_connections_patient ON public.wearable_connections (patient_id);
CREATE INDEX IF NOT EXISTS idx_wearable_connections_lookup  ON public.wearable_connections (provider, external_user_id);

ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wearable_connections_owner"
  ON public.wearable_connections FOR ALL
  USING (
    patient_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  )
  WITH CHECK (patient_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER: evaluar umbrales al insertar un signo vital y crear la alerta
--    clínica correspondiente (lo que clinical-alert-notify espera para
--    notificar por WhatsApp). Cubre tanto entradas manuales/profesionales
--    como las que llegan normalizadas desde wearable-ingest.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_vital_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold       RECORD;
  v_breach          TEXT;
  v_alert_type      TEXT;
  v_severity        TEXT;
  v_threshold_value NUMERIC;
  v_deviation       NUMERIC;
BEGIN
  -- Caída detectada: siempre crítica, no depende de umbrales del paciente
  IF NEW.type = 'fall_detected' AND NEW.value > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clinical_alerts
      WHERE patient_id = NEW.patient_id AND alert_type = 'fall_detected'
        AND status = 'active' AND created_at > NOW() - INTERVAL '10 minutes'
    ) THEN
      INSERT INTO public.clinical_alerts (
        patient_id, vital_sign_id, booking_id, alert_type, actual_value, unit, severity, tenant_id
      ) VALUES (
        NEW.patient_id, NEW.id, NEW.booking_id, 'fall_detected', NEW.value, NEW.unit, 'critical', NEW.tenant_id
      );
      NEW.alert_sent := true;
    END IF;
    RETURN NEW;
  END IF;

  -- Buscar umbral habilitado configurado por el paciente para este tipo
  SELECT * INTO v_threshold
  FROM public.alert_thresholds
  WHERE patient_id = NEW.patient_id AND vital_type = NEW.type AND enabled = true;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_threshold.min_value IS NOT NULL AND NEW.value < v_threshold.min_value THEN
    v_breach := 'low';
    v_threshold_value := v_threshold.min_value;
  ELSIF v_threshold.max_value IS NOT NULL AND NEW.value > v_threshold.max_value THEN
    v_breach := 'high';
    v_threshold_value := v_threshold.max_value;
  ELSE
    RETURN NEW;
  END IF;

  -- Mapear (tipo de signo, dirección de la ruptura) -> alert_type soportado
  v_alert_type := CASE
    WHEN NEW.type = 'heart_rate'        AND v_breach = 'low'  THEN 'low_heart_rate'
    WHEN NEW.type = 'heart_rate'        AND v_breach = 'high' THEN 'high_heart_rate'
    WHEN NEW.type = 'spo2'              AND v_breach = 'low'  THEN 'low_spo2'
    WHEN NEW.type = 'temperature'       AND v_breach = 'low'  THEN 'low_temperature'
    WHEN NEW.type = 'temperature'       AND v_breach = 'high' THEN 'high_temperature'
    WHEN NEW.type IN ('blood_pressure_sys', 'blood_pressure_dia') AND v_breach = 'low'  THEN 'low_blood_pressure'
    WHEN NEW.type IN ('blood_pressure_sys', 'blood_pressure_dia') AND v_breach = 'high' THEN 'high_blood_pressure'
    WHEN NEW.type = 'respiration_rate'  AND v_breach = 'high' THEN 'high_respiration'
    WHEN NEW.type = 'glucose'                                  THEN 'abnormal_glucose'
    ELSE NULL
  END;

  IF v_alert_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Severidad según qué tan lejos está el valor del umbral roto
  v_deviation := ABS(NEW.value - v_threshold_value) / NULLIF(v_threshold_value, 0);
  v_severity := CASE
    WHEN v_deviation > 0.30 THEN 'critical'
    WHEN v_deviation > 0.15 THEN 'high'
    ELSE 'medium'
  END;

  -- Anti-spam: no crear otra alerta activa del mismo tipo dentro de 30 min
  IF EXISTS (
    SELECT 1 FROM public.clinical_alerts
    WHERE patient_id = NEW.patient_id AND alert_type = v_alert_type
      AND status = 'active' AND created_at > NOW() - INTERVAL '30 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.clinical_alerts (
    patient_id, vital_sign_id, booking_id, alert_type,
    threshold_value, actual_value, unit, severity, tenant_id
  ) VALUES (
    NEW.patient_id, NEW.id, NEW.booking_id, v_alert_type,
    v_threshold_value, NEW.value, NEW.unit, v_severity, NEW.tenant_id
  );

  NEW.alert_sent := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evaluate_vital_alert ON public.vital_signs;
CREATE TRIGGER trg_evaluate_vital_alert
  BEFORE INSERT ON public.vital_signs
  FOR EACH ROW
  EXECUTE FUNCTION public.evaluate_vital_alert();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. REALTIME para que la UI vea las nuevas conexiones al instante
-- ──────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.wearable_connections;
