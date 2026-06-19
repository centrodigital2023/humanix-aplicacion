CREATE OR REPLACE FUNCTION public.wearable_ingest_by_pairing_code(
  pairing_code text,
  p_provider text DEFAULT 'samsung_health',
  heart_rate integer DEFAULT NULL,
  steps integer DEFAULT NULL,
  spo2 integer DEFAULT NULL,
  temperature numeric DEFAULT NULL,
  blood_pressure_sys integer DEFAULT NULL,
  blood_pressure_dia integer DEFAULT NULL,
  measured_at timestamptz DEFAULT now(),
  source text DEFAULT 'Samsung Health',
  device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conn wearable_connections%ROWTYPE;
  inserted_count int := 0;
  reading_recorded_at timestamptz;
BEGIN
  -- Buscar conexión activa por código de emparejamiento (external_user_id)
  SELECT * INTO conn
  FROM wearable_connections
  WHERE external_user_id = pairing_code
    AND wearable_connections.provider = p_provider
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Código de emparejamiento no encontrado');
  END IF;

  IF conn.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conexión no está activa');
  END IF;

  reading_recorded_at := COALESCE(measured_at, now());

  -- Insertar frecuencia cardíaca
  IF heart_rate IS NOT NULL THEN
    INSERT INTO vital_signs_readings (family_user_id, reading_type, value, unit, source, severity, recorded_at)
    VALUES (conn.patient_id, 'heart_rate', heart_rate, 'bpm', source, 'normal', reading_recorded_at);
    inserted_count := inserted_count + 1;
  END IF;

  -- Insertar pasos
  IF steps IS NOT NULL THEN
    INSERT INTO vital_signs_readings (family_user_id, reading_type, value, unit, source, severity, recorded_at)
    VALUES (conn.patient_id, 'steps', steps, 'steps', source, 'normal', reading_recorded_at);
    inserted_count := inserted_count + 1;
  END IF;

  -- Insertar SpO2
  IF spo2 IS NOT NULL THEN
    INSERT INTO vital_signs_readings (family_user_id, reading_type, value, unit, source, severity, recorded_at)
    VALUES (conn.patient_id, 'spo2', spo2, '%', source, 'normal', reading_recorded_at);
    inserted_count := inserted_count + 1;
  END IF;

  -- Insertar temperatura corporal
  IF temperature IS NOT NULL THEN
    INSERT INTO vital_signs_readings (family_user_id, reading_type, value, unit, source, severity, recorded_at)
    VALUES (conn.patient_id, 'temperature', temperature, '°C', source, 'normal', reading_recorded_at);
    inserted_count := inserted_count + 1;
  END IF;

  -- Insertar presión arterial sistólica (con diastólica secundaria si existe)
  IF blood_pressure_sys IS NOT NULL THEN
    INSERT INTO vital_signs_readings (family_user_id, reading_type, value, value_secondary, unit, source, severity, recorded_at)
    VALUES (conn.patient_id, 'blood_pressure_sys', blood_pressure_sys, blood_pressure_dia, 'mmHg', source, 'normal', reading_recorded_at);
    inserted_count := inserted_count + 1;
  END IF;

  -- Actualizar última sincronización y nombre del dispositivo
  UPDATE wearable_connections
  SET last_synced_at = now(),
      device_name = COALESCE(wearable_ingest_by_pairing_code.device_name, wearable_connections.device_name),
      updated_at = now()
  WHERE id = conn.id;

  RETURN jsonb_build_object('ok', true, 'inserted', inserted_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Permiso para que dispositivos/Tasker anon o usuarios autenticados puedan invocar la función
GRANT EXECUTE ON FUNCTION public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text) TO anon, authenticated;
