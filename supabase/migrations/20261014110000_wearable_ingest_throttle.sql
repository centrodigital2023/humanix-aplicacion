-- ═══════════════════════════════════════════════════════════════════════════════
-- FRENO A LA INGESTA PÚBLICA DE RELOJES (2026-10-14)
--
-- Hallazgo (revisión del módulo de monitoreo, 2026-10-14)
--   `wearable_ingest_by_pairing_code` (20260618230123) la pueden llamar los visitantes sin sesión (es lo que usan los relojes y Tasker) y
--   escribe lecturas en la historia de salud de la persona dueña del código de emparejamiento. El generador de códigos de la pantalla
--   (SamsungHealthCard.genCode) sacaba el código de un hash de 32 bits sembrado con datos conocidos, y la función contestaba distinto
--   si el código no existía o si la conexión estaba inactiva: quien probara códigos sin freno podía descubrirlos e inyectar lecturas falsas.
--   En producción hoy hay 0 conexiones y 0 lecturas (verificado el 2026-10-14): no hay códigos viejos que rotar.
--
-- Qué hace
--   1. La lógica de la función original pasa, con el mismo cuerpo, a una función interna (`wearable_ingest_by_pairing_code_core`) que ya
--      no se puede llamar desde la API. (No se renombra la original: su cuerpo se califica a sí mismo por nombre y se rompería.)
--   2. La función con el nombre de siempre y los mismos parámetros (los relojes y los atajos siguen funcionando igual) pasa a ser la puerta:
--        · si quien llama ya falló 20 veces en 10 minutos (huella de su procedencia, nunca la IP), responde que espere;
--        · si el código no existe, la conexión no está activa o es de otro proveedor, responde lo MISMO en los tres casos (sin pistas)
--          y anota el intento fallido;
--        · si el código es válido, llama a la función interna tal cual (su comportamiento no cambia).
--      Los intentos se anotan en `inst_ingest_failures` (20261014100000), con su propio alcance («wearable»): lo que falle un dispositivo
--      de la institución no frena a un reloj de familia, y al revés.
--   3. La pantalla genera códigos de 96 bits con el generador criptográfico del navegador (SamsungHealthCard.tsx); la columna ya trae un
--      valor por defecto igual de fuerte en la base.
--
-- Idempotente. Depende de: wearable_connections y vital_signs_readings (ya existen en producción) y de 20261014100000
-- (inst_ingest_failures, hx_ingest_ip_hash, hx_inst_purge_failures).
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_w$
BEGIN
  IF to_regclass('public.inst_ingest_failures') IS NULL OR to_regprocedure('public.hx_ingest_ip_hash()') IS NULL THEN
    RAISE EXCEPTION 'Falta 20261014100000_institution_care_core.sql (inst_ingest_failures / hx_ingest_ip_hash): aplícala antes';
  END IF;
  IF to_regclass('public.wearable_connections') IS NULL OR to_regclass('public.vital_signs_readings') IS NULL THEN
    RAISE EXCEPTION 'Faltan wearable_connections / vital_signs_readings: no hay nada que proteger';
  END IF;
END
$hx_w$;

-- La lógica de siempre (mismo cuerpo que 20260618230123), ahora interna.
CREATE OR REPLACE FUNCTION public.wearable_ingest_by_pairing_code_core(
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
      device_name = COALESCE(wearable_ingest_by_pairing_code_core.device_name, wearable_connections.device_name),
      updated_at = now()
  WHERE id = conn.id;

  RETURN jsonb_build_object('ok', true, 'inserted', inserted_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)
  TO service_role;

-- La puerta: mismo nombre y parámetros que la función original (PostgREST resuelve las llamadas por nombre de parámetro).
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
AS $fn$
DECLARE
  v_ip text := public.hx_ingest_ip_hash();
  v_ok boolean;
BEGIN
  IF (SELECT count(*) FROM public.inst_ingest_failures f
       WHERE f.scope = 'wearable' AND f.ip_hash = v_ip AND f.at > now() - interval '10 minutes') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Demasiados intentos. Espera unos minutos.');
  END IF;

  SELECT true INTO v_ok
    FROM public.wearable_connections c
   WHERE c.external_user_id = pairing_code AND c.provider = p_provider AND c.status = 'active'
   LIMIT 1;
  IF v_ok IS NOT TRUE THEN
    INSERT INTO public.inst_ingest_failures (scope, ip_hash) VALUES ('wearable', v_ip);
    IF random() < 0.02 THEN
      PERFORM public.hx_inst_purge_failures();
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Código de emparejamiento no válido o conexión inactiva');
  END IF;

  RETURN public.wearable_ingest_by_pairing_code_core(
    pairing_code, p_provider, heart_rate, steps, spo2, temperature, blood_pressure_sys, blood_pressure_dia, measured_at, source, device_name);
END
$fn$;

REVOKE ALL ON FUNCTION public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
