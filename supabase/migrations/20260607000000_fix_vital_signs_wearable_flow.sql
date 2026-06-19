-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: vital_signs_readings constraints + wearable flow
--
-- Problemas corregidos:
-- 1. reading_type no incluía steps, fall_detected, respiration_rate
-- 2. source no incluía apple_healthkit ni google_health_connect
-- 3. Estos errores causaban que inserciones del edge function wearable-ingest
--    fallaran silenciosamente o provocaran error de CHECK constraint.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ampliar reading_type para incluir todos los tipos reales ─────────────
ALTER TABLE public.vital_signs_readings
  DROP CONSTRAINT IF EXISTS vital_signs_readings_reading_type_check;

ALTER TABLE public.vital_signs_readings
  ADD CONSTRAINT vital_signs_readings_reading_type_check
  CHECK (reading_type IN (
    'heart_rate',
    'blood_pressure_sys',
    'blood_pressure_dia',
    'spo2',
    'temperature',
    'glucose',
    'respiratory_rate',
    'respiration_rate',   -- alias usado por el código JS
    'weight',
    'pain_scale',
    'steps',
    'fall_detected',
    'custom'
  ));

-- ── 2. Ampliar source para incluir fuentes nativas de salud ────────────────
ALTER TABLE public.vital_signs_readings
  DROP CONSTRAINT IF EXISTS vital_signs_readings_source_check;

ALTER TABLE public.vital_signs_readings
  ADD CONSTRAINT vital_signs_readings_source_check
  CHECK (source IN (
    'manual',
    'wearable',
    'iot',
    'professional',
    'ai_estimate',
    'apple_healthkit',
    'google_health_connect'
  ));

-- ── 3. Asegurar que wearable_connections tenga Realtime activo ─────────────
-- (ya se habilita en la migración 20260606180000, esta línea es idempotente)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wearable_connections;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
