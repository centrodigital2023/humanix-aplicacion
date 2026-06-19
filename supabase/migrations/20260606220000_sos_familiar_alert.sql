-- ──────────────────────────────────────────────────────────────────────────
-- SOS Familiar: botón de pánico con ubicación en tiempo real
--
-- Extiende clinical_alerts (ya usado por el motor de monitoreo automático)
-- con un nuevo tipo de alerta `sos_manual`, disparado intencionalmente por
-- el propio paciente/usuario desde su panel. Reusa toda la tubería existente
-- (Database Webhook → clinical-alert-notify → WhatsApp) para avisar de
-- inmediato a sus contactos (booking client/professional) y al equipo.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);

ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
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
    'abnormal_glucose',
    'sos_manual'
  ));

-- El propio paciente puede insertar su SOS (botón de pánico). Acotado
-- estrictamente a alert_type = 'sos_manual' y severity = 'critical' para
-- que esta puerta de auto-inserción no sirva para falsificar otro tipo
-- de alerta clínica (esas siguen siendo generadas solo por el trigger
-- evaluate_vital_alert(), que es SECURITY DEFINER).
CREATE POLICY "clinical_alerts_sos_self_insert"
  ON public.clinical_alerts FOR INSERT
  WITH CHECK (
    patient_id = auth.uid()
    AND alert_type = 'sos_manual'
    AND severity = 'critical'
  );
