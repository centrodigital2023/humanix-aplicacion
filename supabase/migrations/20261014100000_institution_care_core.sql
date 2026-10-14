-- ═══════════════════════════════════════════════════════════════════════════════
-- PACIENTES Y MONITOREO CLÍNICO DE LA INSTITUCIÓN (2026-10-14)
--
-- Pedido: ampliar «Pacientes y coordinación de cuidado» y «Monitoreo clínico · Live» del panel EPS/IPS con lo mejor del mundo, ajustado
-- a los planes y probado de punta a punta.
--
-- Qué había (revisado el 2026-10-14)
--   • «Pacientes» guardaba los casos en `institution_patient_cases`, una tabla que NUNCA existió en producción (su migración de junio
--     no se aplicó): «Agregar paciente» fallaba. Las notas eran un único texto que se sobrescribía y el «★ Promedio» era un 4,8 escrito
--     en el código.
--   • «Monitoreo» guardaba la lista de pacientes en el NAVEGADOR (localStorage) y leía `vital_signs_readings`, que por seguridad solo
--     lee su dueño: la institución nunca podía ver signos vitales. El «triage» contaba umbrales fijos; las alertas «OK» no se guardaban.
--   • `wearable_ingest_by_pairing_code` (la que usan los relojes) se puede llamar sin sesión y el código de emparejamiento sale de un hash
--     de 32 bits: se puede adivinar (ver 20261014110000, que le pone freno).
--
-- Qué hace (todo en el servidor, donde no se puede saltar)
--   1. PACIENTES (`inst_patients`), CASOS (`inst_cases`), NOTAS (`inst_notes`), TAREAS (`inst_tasks`) y BITÁCORA (`inst_events`).
--      Las notas son INALTERABLES: cada una lleva el hash de la anterior (cadena por paciente), no se edita ni se borra; se corrige con
--      una nota nueva, y `inst_verify_notes` comprueba que la cadena esté íntegra. Toda alta de paciente exige confirmar que la
--      institución cuenta con la autorización del paciente o su acudiente (Ley 1581 de 2012: datos sensibles).
--   2. SIGNOS VITALES (`inst_obs`) con NEWS2 (Royal College of Physicians) calculado AQUÍ (`hx_news2`), con arrastre de los últimos
--      valores conocidos de lo que no se midió en esa ronda, y ALERTAS (`inst_alerts`) que se abren solas, se deduplican, se
--      resuelven solas cuando el puntaje se normaliza y tienen plazo para atenderse (crítica 10 min, urgente 30 min, atención 2 h).
--   3. DISPOSITIVOS (`inst_devices`): código de emparejamiento de 122 bits que solo se muestra al crearlo (se guarda su hash); la
--      ingesta (`inst_device_ingest`) se puede llamar sin sesión pero frena a quien falla muchas veces.
--   4. PLANES: Free hasta 5 pacientes y 3 en monitoreo, sin dispositivos ni escalamiento; IPS Mejorado, hasta 1000 / 300 / 300 con
--      escalamiento, seguimientos automáticos y relevo de turno. Los límites los aplica la base de datos (`hx_inst_care_limits`).
--      Con pg_cron (producción lo tiene) cada minuto se escalan las alertas urgentes o críticas que nadie atendió a tiempo y cada noche se
--      limpia lo viejo; sin pg_cron se revisa al entrar un control o un dato de dispositivo y cuando la pantalla lo pide.
--   5. PERSONAL: los módulos `pacientes` y `monitoreo` se suman a los que el dueño puede dar a su equipo (`hx_staff_modules`).
--   6. Nadie escribe directo desde la API: toda escritura pasa por funciones `inst_*` que comprueban quién es y de qué institución.
--      Ni siquiera el superadmin lee pacientes por la API.
--
-- NEWS2 es apoyo a la decisión clínica, no un diagnóstico; no aplica a menores de 16 años ni al embarazo (la función lo indica).
-- Espejo en pantalla: src/lib/news2.ts (se comparan con los mismos vectores: supabase/e2e/institution_care/news2_vectors.json).
--
-- Idempotente. Depende de: institution_members (20261013120000) y sus ayudantes, professional_opportunity_hub (plan_key_for),
-- institution_hub_smart_contracts (hx_notify, hx_sha256), offer_alerts_and_plans (hx_pro_label).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 0) Módulos que se pueden dar al personal ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_staff_modules()
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT ARRAY['ofertas', 'talento', 'pacientes', 'monitoreo']::text[]
$fn$;

-- ── 1) Ayudas de validación y de alcance ─────────────────────────────────────────

-- Texto libre: sin caracteres de control (el salto de línea y la tabulación sí). Los signos < y > son válidos: se escriben «PAS < 90».
CREATE OR REPLACE FUNCTION public.hx_text_ok(p text, p_max integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT p IS NULL OR (char_length(p) <= p_max AND p !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
$fn$;

-- Nombres y etiquetas: de una sola línea, sin caracteres de control ni signos de etiqueta.
CREATE OR REPLACE FUNCTION public.hx_name_ok(p text, p_min integer, p_max integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT p IS NOT NULL AND char_length(btrim(p)) BETWEEN p_min AND p_max AND p !~ '[\x01-\x1f\x7f<>]'
$fn$;

CREATE OR REPLACE FUNCTION public.hx_text_array_ok(p text[], p_items integer, p_len integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT p IS NOT NULL
     AND cardinality(p) <= p_items
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p) AS e
        WHERE e IS NULL OR char_length(btrim(e)) = 0 OR char_length(e) > p_len OR e ~ '[\x01-\x1f\x7f<>]')
$fn$;

-- La institución para la que actúa quien llama en un módulo: la suya (si tiene el rol «institution») o la de la que es personal
-- activo con ese módulo y el plan vigente. NULL si no corresponde. (SELECT …) en las políticas: se evalúa una vez por consulta.
CREATE OR REPLACE FUNCTION public.hx_care_inst(p_module text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT s.i
    FROM (SELECT public.hx_acting_institution(auth.uid(), p_module) AS i) s
   WHERE s.i IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = s.i AND ur.role = 'institution'::public.app_role)
$fn$;

CREATE OR REPLACE FUNCTION public.hx_care_need(p_module text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v uuid := public.hx_care_inst(p_module);
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'No tienes acceso a este módulo de la institución' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.hx_care_need_any(p_a text, p_b text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v uuid := COALESCE(public.hx_care_inst(p_a), public.hx_care_inst(p_b));
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'No tienes acceso a este módulo de la institución' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
  RETURN v;
END
$fn$;

-- Quién actúa, para dejarlo escrito en notas, alertas y bitácora (una foto del nombre: si la persona se retira, el registro queda).
CREATE OR REPLACE FUNCTION public.hx_care_actor_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT m.display_name FROM public.institution_members m WHERE m.member_user_id = auth.uid()),
    (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.user_id = auth.uid()),
    (SELECT NULLIF(btrim(i.institution_name), '') FROM public.institution_profiles i WHERE i.user_id = auth.uid()),
    'Equipo')
$fn$;

-- Límites por plan. Free: probar con un grupo pequeño; IPS Mejorado: operar de verdad.
CREATE OR REPLACE FUNCTION public.hx_inst_care_limits(p_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_plan = 'institution_monthly'
    THEN '{"patients":1000,"monitored":300,"devices":300,"escalation":true,"followups":true,"handoff":true,"export":true}'::jsonb
    ELSE '{"patients":5,"monitored":3,"devices":0,"escalation":false,"followups":false,"handoff":false,"export":false}'::jsonb
  END
$fn$;

-- ── 2) NEWS2 (Royal College of Physicians, 2017) ─────────────────────────────────
-- Devuelve {score, max_single, measured, parts}. Lo que no se midió suma 0 y no cuenta como medido. Los enteros y la temperatura se
-- redondean (la tabla es de enteros y de un decimal); todo es numeric: el empate x,5 se redondea siempre hacia arriba.

CREATE OR REPLACE FUNCTION public.hx_news2(
  p_rr numeric, p_spo2 numeric, p_on_o2 boolean, p_sbp numeric, p_hr numeric, p_avpu text, p_temp numeric, p_scale integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  v_rr integer; v_spo2 integer; v_sbp integer; v_hr integer; v_t numeric;
  s_rr integer := 0; s_spo2 integer := 0; s_o2 integer := 0; s_sbp integer := 0; s_hr integer := 0; s_av integer := 0; s_t integer := 0;
  m integer := 0;
  v_on boolean := COALESCE(p_on_o2, false);
BEGIN
  IF p_rr IS NOT NULL THEN
    v_rr := round(p_rr)::integer; m := m + 1;
    s_rr := CASE WHEN v_rr <= 8 THEN 3 WHEN v_rr <= 11 THEN 1 WHEN v_rr <= 20 THEN 0 WHEN v_rr <= 24 THEN 2 ELSE 3 END;
  END IF;
  IF p_spo2 IS NOT NULL THEN
    v_spo2 := round(p_spo2)::integer; m := m + 1;
    IF p_scale = 2 THEN
      s_spo2 := CASE WHEN v_spo2 <= 83 THEN 3 WHEN v_spo2 <= 85 THEN 2 WHEN v_spo2 <= 87 THEN 1 WHEN v_spo2 <= 92 THEN 0
                     WHEN NOT v_on THEN 0 WHEN v_spo2 <= 94 THEN 1 WHEN v_spo2 <= 96 THEN 2 ELSE 3 END;
    ELSE
      s_spo2 := CASE WHEN v_spo2 <= 91 THEN 3 WHEN v_spo2 <= 93 THEN 2 WHEN v_spo2 <= 95 THEN 1 ELSE 0 END;
    END IF;
  END IF;
  IF p_on_o2 IS NOT NULL THEN
    m := m + 1; s_o2 := CASE WHEN p_on_o2 THEN 2 ELSE 0 END;
  END IF;
  IF p_sbp IS NOT NULL THEN
    v_sbp := round(p_sbp)::integer; m := m + 1;
    s_sbp := CASE WHEN v_sbp <= 90 THEN 3 WHEN v_sbp <= 100 THEN 2 WHEN v_sbp <= 110 THEN 1 WHEN v_sbp <= 219 THEN 0 ELSE 3 END;
  END IF;
  IF p_hr IS NOT NULL THEN
    v_hr := round(p_hr)::integer; m := m + 1;
    s_hr := CASE WHEN v_hr <= 40 THEN 3 WHEN v_hr <= 50 THEN 1 WHEN v_hr <= 90 THEN 0 WHEN v_hr <= 110 THEN 1 WHEN v_hr <= 130 THEN 2 ELSE 3 END;
  END IF;
  IF p_avpu IN ('A', 'C', 'V', 'P', 'U') THEN
    m := m + 1; s_av := CASE WHEN p_avpu = 'A' THEN 0 ELSE 3 END;
  END IF;
  IF p_temp IS NOT NULL THEN
    v_t := round(p_temp, 1); m := m + 1;
    s_t := CASE WHEN v_t <= 35.0 THEN 3 WHEN v_t <= 36.0 THEN 1 WHEN v_t <= 38.0 THEN 0 WHEN v_t <= 39.0 THEN 1 ELSE 2 END;
  END IF;
  RETURN jsonb_build_object(
    'score', s_rr + s_spo2 + s_o2 + s_sbp + s_hr + s_av + s_t,
    'max_single', GREATEST(s_rr, s_spo2, s_o2, s_sbp, s_hr, s_av, s_t),
    'measured', m,
    'parts', jsonb_build_object('rr', s_rr, 'spo2', s_spo2, 'o2', s_o2, 'sbp', s_sbp, 'hr', s_hr, 'avpu', s_av, 'temp', s_t));
END
$fn$;

-- low · low_medium (un solo parámetro con 3) · medium (5–6) · high (7 o más)
CREATE OR REPLACE FUNCTION public.hx_news2_band(p_score integer, p_max_single integer)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_score >= 7 THEN 'high' WHEN p_score >= 5 THEN 'medium' WHEN p_max_single >= 3 THEN 'low_medium' ELSE 'low' END
$fn$;

-- Cada cuántos minutos, como máximo, debe repetirse el control (frecuencia mínima de la guía NEWS2).
CREATE OR REPLACE FUNCTION public.hx_news2_interval_min(p_score integer, p_max_single integer)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_score >= 7 THEN 15 WHEN p_score >= 5 THEN 60 WHEN p_max_single >= 3 THEN 60 WHEN p_score >= 1 THEN 360 ELSE 720 END
$fn$;

-- ── 3) Tablas ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inst_patients (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name            text        NOT NULL CHECK (public.hx_name_ok(full_name, 2, 120)),
  document_type        text        CHECK (document_type IS NULL OR document_type IN ('CC', 'TI', 'RC', 'CE', 'PA', 'PEP', 'PPT', 'OTRO')),
  document_number      text        CHECK (document_number IS NULL OR (char_length(document_number) BETWEEN 4 AND 20 AND document_number ~ '^[A-Za-z0-9.-]+$')),
  birth_date           date        CHECK (birth_date IS NULL OR (birth_date >= DATE '1900-01-01' AND birth_date <= DATE '2100-01-01')),
  sex                  text        CHECK (sex IS NULL OR sex IN ('F', 'M', 'O')),
  eps_name             text        CHECK (public.hx_text_ok(eps_name, 80)),
  city                 text        CHECK (public.hx_text_ok(city, 80)),
  address              text        CHECK (public.hx_text_ok(address, 200)),
  modality             text        NOT NULL DEFAULT 'remote' CHECK (modality IN ('hospital', 'remote', 'postop', 'chronic', 'elder')),
  room                 text        CHECK (public.hx_text_ok(room, 40)),
  conditions           text[]      NOT NULL DEFAULT '{}' CHECK (public.hx_text_array_ok(conditions, 20, 80)),
  allergies            text[]      NOT NULL DEFAULT '{}' CHECK (public.hx_text_array_ok(allergies, 20, 80)),
  emergency_name       text        CHECK (public.hx_text_ok(emergency_name, 80)),
  emergency_phone      text        CHECK (emergency_phone IS NULL OR emergency_phone ~ '^[0-9+() -]{7,20}$'),
  status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'paused', 'discharged')),
  -- Escala 2 de SpO₂ (meta 88–92 %): solo por indicación médica; el cambio queda en la bitácora con su motivo.
  spo2_scale           smallint    NOT NULL DEFAULT 1 CHECK (spo2_scale IN (1, 2)),
  monitoring           boolean     NOT NULL DEFAULT false,
  monitoring_since     timestamptz,
  family_updates_ok    boolean     NOT NULL DEFAULT false,
  consent_confirmed_at timestamptz NOT NULL DEFAULT now(),
  consent_confirmed_by uuid        NOT NULL,
  external_ref         text        CHECK (public.hx_text_ok(external_ref, 40)),
  created_by           uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  discharged_at        timestamptz,
  CHECK (document_number IS NULL OR document_type IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS inst_patients_inst_status_idx ON public.inst_patients (institution_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS inst_patients_document_uq
  ON public.inst_patients (institution_id, document_type, document_number) WHERE document_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inst_cases (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id        uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  title             text        NOT NULL CHECK (public.hx_name_ok(title, 3, 140)),
  care_type         text        NOT NULL DEFAULT 'domiciliary'
                                CHECK (care_type IN ('domiciliary', 'nursing', 'postop', 'elder', 'palliative', 'chronic', 'rehab', 'other')),
  priority          text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  target_end_at     timestamptz,
  closed_at         timestamptz,
  outcome           text        CHECK (outcome IS NULL OR outcome IN ('recovered', 'stable', 'referred', 'withdrawn', 'deceased', 'other')),
  satisfaction      smallint    CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
  satisfaction_by   text        CHECK (satisfaction_by IS NULL OR satisfaction_by IN ('patient', 'family', 'coordinator')),
  satisfaction_note text        CHECK (public.hx_text_ok(satisfaction_note, 500)),
  application_id    uuid        REFERENCES public.applications (id) ON DELETE SET NULL,
  professional_id   uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Foto del nombre del profesional al abrir el caso (la institución no siempre puede leer su perfil).
  professional_label text       CHECK (public.hx_text_ok(professional_label, 120)),
  summary           text        CHECK (public.hx_text_ok(summary, 2000)),
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('completed', 'cancelled')) = (closed_at IS NOT NULL)),
  CHECK (satisfaction IS NULL OR status = 'completed')
);

CREATE INDEX IF NOT EXISTS inst_cases_patient_idx ON public.inst_cases (patient_id, status);
CREATE INDEX IF NOT EXISTS inst_cases_inst_idx ON public.inst_cases (institution_id, status, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inst_cases_application_uq ON public.inst_cases (application_id) WHERE application_id IS NOT NULL;

-- Notas: inalterables y encadenadas (cada una lleva el hash de la anterior del mismo paciente).
CREATE TABLE IF NOT EXISTS public.inst_notes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id       uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  case_id          uuid        REFERENCES public.inst_cases (id) ON DELETE SET NULL,
  seq              integer     NOT NULL CHECK (seq >= 1),
  kind             text        NOT NULL CHECK (kind IN ('evolution', 'nursing', 'coordination', 'family', 'incident', 'handoff', 'correction')),
  body             text        NOT NULL CHECK (char_length(btrim(body)) >= 2 AND public.hx_text_ok(body, 4000)),
  vitals           jsonb,
  corrects_note_id uuid        REFERENCES public.inst_notes (id) ON DELETE SET NULL,
  author_id        uuid        NOT NULL,
  author_name      text        NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 120),
  author_role      text        NOT NULL CHECK (author_role IN ('owner', 'member')),
  prev_hash        text        NOT NULL,
  hash             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, seq)
);

CREATE INDEX IF NOT EXISTS inst_notes_inst_idx ON public.inst_notes (institution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inst_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id      uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  case_id         uuid        REFERENCES public.inst_cases (id) ON DELETE SET NULL,
  title           text        NOT NULL CHECK (public.hx_name_ok(title, 3, 160)),
  kind            text        NOT NULL DEFAULT 'other'
                              CHECK (kind IN ('call', 'visit', 'medication', 'lab', 'education', 'followup', 'obs_round', 'other')),
  due_at          timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  source          text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_followup')),
  completed_at    timestamptz,
  completed_by    uuid,
  completed_name  text,
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS inst_tasks_inst_idx ON public.inst_tasks (institution_id, status, due_at);
CREATE INDEX IF NOT EXISTS inst_tasks_patient_idx ON public.inst_tasks (patient_id, status, due_at);

CREATE TABLE IF NOT EXISTS public.inst_devices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id     uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  label          text        NOT NULL CHECK (public.hx_name_ok(label, 2, 60)),
  kind           text        NOT NULL DEFAULT 'smartwatch' CHECK (kind IN ('smartwatch', 'smartphone', 'sensor', 'monitor')),
  code_hash      text        NOT NULL UNIQUE,
  code_hint      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_ingest_at timestamptz,
  created_by     uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

CREATE INDEX IF NOT EXISTS inst_devices_patient_idx ON public.inst_devices (patient_id, status);

-- Una «ronda» de signos vitales (a mano, del dispositivo o de la app). Lo que no se midió queda en NULL; el NEWS2 usa el último
-- valor conocido de los últimos 12 h para completar lo que falta (ver hx_obs_before).
CREATE TABLE IF NOT EXISTS public.inst_obs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id       uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  source           text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'device', 'app')),
  hr               smallint    CHECK (hr BETWEEN 20 AND 300),
  rr               smallint    CHECK (rr BETWEEN 4 AND 70),
  spo2             numeric(4,1) CHECK (spo2 BETWEEN 50 AND 100),
  on_o2            boolean,
  sbp              smallint    CHECK (sbp BETWEEN 40 AND 300),
  dbp              smallint    CHECK (dbp BETWEEN 20 AND 200),
  temp_c           numeric(3,1) CHECK (temp_c BETWEEN 25 AND 45),
  avpu             text        CHECK (avpu IN ('A', 'C', 'V', 'P', 'U')),
  pain             smallint    CHECK (pain BETWEEN 0 AND 10),
  fall             boolean     NOT NULL DEFAULT false,
  note             text        CHECK (public.hx_text_ok(note, 300)),
  news2            smallint,
  news2_max_single smallint,
  news2_measured   smallint,
  -- Valores con los que se calculó el puntaje (los de esta ronda más los arrastrados de las 12 h anteriores) y cuáles fueron arrastrados.
  news2_input      jsonb,
  band             text        CHECK (band IN ('low', 'low_medium', 'medium', 'high')),
  applicable       boolean     NOT NULL DEFAULT true,
  recorded_by      uuid,
  recorded_by_name text,
  device_id        uuid        REFERENCES public.inst_devices (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (hr IS NOT NULL OR rr IS NOT NULL OR spo2 IS NOT NULL OR sbp IS NOT NULL OR dbp IS NOT NULL OR temp_c IS NOT NULL
         OR avpu IS NOT NULL OR pain IS NOT NULL OR fall)
);

CREATE INDEX IF NOT EXISTS inst_obs_patient_idx ON public.inst_obs (patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS inst_obs_inst_idx ON public.inst_obs (institution_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.inst_alerts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id       uuid        NOT NULL REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  obs_id           uuid        REFERENCES public.inst_obs (id) ON DELETE SET NULL,
  severity         text        NOT NULL CHECK (severity IN ('warn', 'urgent', 'critical')),
  reason           text        NOT NULL CHECK (reason IN ('news2_single', 'news2_medium', 'news2_high', 'deterioration', 'fall')),
  news2            smallint,
  message          text        NOT NULL,
  status           text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrences      integer     NOT NULL DEFAULT 1,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  due_ack_at       timestamptz NOT NULL,
  acked_at         timestamptz,
  acked_by         uuid,
  acked_by_name    text,
  ack_note         text        CHECK (public.hx_text_ok(ack_note, 300)),
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolved_by_name text,
  resolution       text        CHECK (resolution IS NULL OR resolution IN ('treated', 'false_alarm', 'transferred', 'auto', 'other')),
  resolve_note     text        CHECK (public.hx_text_ok(resolve_note, 300)),
  escalated_at     timestamptz,
  escalation_level smallint    NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Una sola alerta abierta por paciente y motivo: si vuelve a pasar, se suma una ocurrencia a la misma.
CREATE UNIQUE INDEX IF NOT EXISTS inst_alerts_open_uq ON public.inst_alerts (patient_id, reason) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS inst_alerts_inst_idx ON public.inst_alerts (institution_id, status, opened_at DESC);
-- Para la revisión periódica de plazos vencidos (solo las urgentes y críticas que nadie ha visto ni escalado).
CREATE INDEX IF NOT EXISTS inst_alerts_due_idx ON public.inst_alerts (due_ack_at)
  WHERE status = 'open' AND escalated_at IS NULL AND severity IN ('urgent', 'critical');

-- Lo último que se sabe de cada paciente en monitoreo: una fila por paciente que cambia con cada ronda. Es lo que escucha el tablero en
-- tiempo real (así las lecturas de los dispositivos, que son muchas, no se reparten una por una a cada pantalla).
CREATE TABLE IF NOT EXISTS public.inst_live (
  patient_id      uuid        PRIMARY KEY REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  institution_id  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_obs_at     timestamptz,
  last_obs_source text        CHECK (last_obs_source IS NULL OR last_obs_source IN ('manual', 'device', 'app')),
  last_news2      smallint,
  last_band       text        CHECK (last_band IS NULL OR last_band IN ('low', 'low_medium', 'medium', 'high')),
  last_vitals     jsonb,
  next_obs_due_at timestamptz,
  last_device_at  timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inst_live_inst_idx ON public.inst_live (institution_id);

-- Bitácora: quién hizo qué y cuándo (no lleva datos de salud: solo tipos, números y estados).
CREATE TABLE IF NOT EXISTS public.inst_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  patient_id     uuid        REFERENCES public.inst_patients (id) ON DELETE CASCADE,
  case_id        uuid        REFERENCES public.inst_cases (id) ON DELETE SET NULL,
  kind           text        NOT NULL CHECK (char_length(kind) BETWEEN 3 AND 40),
  actor_id       uuid,
  actor_name     text,
  data           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inst_events_inst_idx ON public.inst_events (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inst_events_patient_idx ON public.inst_events (patient_id, created_at DESC);

-- Frenos de la ingesta pública: fallos por huella de IP (nunca la IP). Nadie la lee desde la API.
CREATE TABLE IF NOT EXISTS public.inst_ingest_failures (
  id      bigserial   PRIMARY KEY,
  scope   text        NOT NULL,
  ip_hash text        NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inst_ingest_failures_idx ON public.inst_ingest_failures (scope, ip_hash, at DESC);

-- ── 4) Bitácora, avisos y guardas de integridad ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_care_log(p_inst uuid, p_patient uuid, p_case uuid, p_kind text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO public.inst_events (institution_id, patient_id, case_id, kind, actor_id, actor_name, data)
  VALUES (p_inst, p_patient, p_case, p_kind, auth.uid(),
          CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE public.hx_care_actor_name() END,
          COALESCE(p_data, '{}'::jsonb))
$fn$;

-- Avisa a la institución y a su equipo con el módulo (el equipo solo existe con el plan IPS Mejorado). hx_notify no frena nada si falla.
CREATE OR REPLACE FUNCTION public.hx_care_notify_team(p_inst uuid, p_module text, p_type text, p_title text, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  m record;
BEGIN
  PERFORM public.hx_notify(p_inst, p_type, p_title, p_body, '/dashboard/institucion?tab=' || p_module);
  IF public.plan_key_for(p_inst) = 'institution_monthly' THEN
    FOR m IN SELECT im.member_user_id FROM public.institution_members im
              WHERE im.institution_id = p_inst AND im.status = 'active' AND p_module = ANY (im.modules) LOOP
      PERFORM public.hx_notify(m.member_user_id, p_type, p_title, p_body, '/dashboard/equipo?tab=' || p_module);
    END LOOP;
  END IF;
END
$fn$;

-- Plan vigente de la institución y sus límites (solo lo leen las funciones de abajo).
CREATE OR REPLACE FUNCTION public.hx_care_plan(p_inst uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.hx_inst_care_limits(public.plan_key_for(p_inst)) || jsonb_build_object('plan', public.plan_key_for(p_inst))
$fn$;

-- Gravedad relativa de las alertas de NEWS2 de un mismo paciente (la caída va aparte).
CREATE OR REPLACE FUNCTION public.hx_alert_rank(p_reason text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE p_reason WHEN 'deterioration' THEN 1 WHEN 'news2_single' THEN 2 WHEN 'news2_medium' THEN 3 WHEN 'news2_high' THEN 4 ELSE 0 END
$fn$;

-- Carga un paciente de ESTA institución (o falla). Con p_lock, lo bloquea para cambiarlo.
CREATE OR REPLACE FUNCTION public.hx_care_patient(p_id uuid, p_inst uuid, p_lock boolean DEFAULT false)
RETURNS public.inst_patients
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.inst_patients;
BEGIN
  IF p_lock THEN
    SELECT * INTO r FROM public.inst_patients WHERE id = p_id AND institution_id = p_inst FOR UPDATE;
  ELSE
    SELECT * INTO r FROM public.inst_patients WHERE id = p_id AND institution_id = p_inst;
  END IF;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos ese paciente en tu institución' USING ERRCODE = 'P0002', HINT = 'not_found';
  END IF;
  RETURN r;
END
$fn$;

-- Número de un JSON: solo si ES un número (los textos se ignoran: un aparato que manda basura no rompe nada).
CREATE OR REPLACE FUNCTION public.hx_json_num(p jsonb, p_key text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN jsonb_typeof(p -> p_key) = 'number' THEN (p ->> p_key)::numeric END
$fn$;

-- Lista de textos de un JSON (vacía si falta); falla si no es una lista.
CREATE OR REPLACE FUNCTION public.hx_json_texts(p jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN
    RETURN '{}'::text[];
  END IF;
  IF jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba una lista' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  RETURN COALESCE(ARRAY(SELECT DISTINCT btrim(e.v) FROM jsonb_array_elements_text(p) AS e(v) WHERE btrim(e.v) <> ''), '{}'::text[]);
END
$fn$;

-- Paciente
CREATE OR REPLACE FUNCTION public.hx_inst_patient_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.birth_date IS NOT NULL AND NEW.birth_date > current_date THEN
    RAISE EXCEPTION 'La fecha de nacimiento no puede ser futura' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = 'inst_patients_birth_date_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.institution_id AND ur.role = 'institution'::public.app_role) THEN
      RAISE EXCEPTION 'Solo una institución puede registrar pacientes' USING ERRCODE = '23514', HINT = 'not_institution';
    END IF;
    NEW.created_at       := now();
    NEW.updated_at       := now();
    NEW.monitoring       := NEW.monitoring AND NEW.status = 'active';
    NEW.monitoring_since := CASE WHEN NEW.monitoring THEN now() END;
    NEW.discharged_at    := CASE WHEN NEW.status = 'discharged' THEN now() END;
    RETURN NEW;
  END IF;
  -- Quién es, de quién es, quién lo registró y su consentimiento no se cambian.
  NEW.institution_id        := OLD.institution_id;
  NEW.created_by            := OLD.created_by;
  NEW.created_at            := OLD.created_at;
  NEW.consent_confirmed_at  := OLD.consent_confirmed_at;
  NEW.consent_confirmed_by  := OLD.consent_confirmed_by;
  NEW.updated_at            := now();
  NEW.monitoring            := NEW.monitoring AND NEW.status = 'active';
  NEW.monitoring_since      := CASE WHEN NOT NEW.monitoring THEN NULL WHEN OLD.monitoring THEN OLD.monitoring_since ELSE now() END;
  NEW.discharged_at         := CASE WHEN NEW.status <> 'discharged' THEN NULL WHEN OLD.status = 'discharged' THEN OLD.discharged_at ELSE now() END;
  RETURN NEW;
END
$fn$;

-- Caso
CREATE OR REPLACE FUNCTION public.hx_inst_case_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.inst_patients p WHERE p.id = NEW.patient_id AND p.institution_id = NEW.institution_id) THEN
      RAISE EXCEPTION 'El paciente no es de esta institución' USING ERRCODE = '23514', HINT = 'patient_mismatch';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.opened_at  := COALESCE(NEW.opened_at, now());
    NEW.closed_at  := CASE WHEN NEW.status IN ('completed', 'cancelled') THEN now() END;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('completed', 'cancelled') AND NEW.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Un caso cerrado no se reabre: abre uno nuevo' USING ERRCODE = '23514', HINT = 'case_closed';
  END IF;
  NEW.institution_id := OLD.institution_id;
  NEW.patient_id     := OLD.patient_id;
  NEW.created_by     := OLD.created_by;
  NEW.created_at     := OLD.created_at;
  NEW.opened_at      := OLD.opened_at;
  NEW.updated_at     := now();
  NEW.closed_at      := CASE WHEN NEW.status NOT IN ('completed', 'cancelled') THEN NULL
                             WHEN OLD.status IN ('completed', 'cancelled') THEN OLD.closed_at ELSE now() END;
  RETURN NEW;
END
$fn$;

-- Tarea
CREATE OR REPLACE FUNCTION public.hx_inst_task_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.inst_patients p WHERE p.id = NEW.patient_id AND p.institution_id = NEW.institution_id) THEN
      RAISE EXCEPTION 'El paciente no es de esta institución' USING ERRCODE = '23514', HINT = 'patient_mismatch';
    END IF;
    IF NEW.case_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.inst_cases c WHERE c.id = NEW.case_id AND c.patient_id = NEW.patient_id) THEN
      RAISE EXCEPTION 'El caso no es de este paciente' USING ERRCODE = '23514', HINT = 'case_mismatch';
    END IF;
    NEW.created_at   := now();
    NEW.updated_at   := now();
    NEW.completed_at := CASE WHEN NEW.status <> 'open' THEN now() END;
    RETURN NEW;
  END IF;
  NEW.institution_id := OLD.institution_id;
  NEW.patient_id     := OLD.patient_id;
  NEW.created_by     := OLD.created_by;
  NEW.created_at     := OLD.created_at;
  NEW.source         := OLD.source;
  NEW.updated_at     := now();
  NEW.completed_at   := CASE WHEN NEW.status = 'open' THEN NULL WHEN OLD.status <> 'open' THEN OLD.completed_at ELSE now() END;
  RETURN NEW;
END
$fn$;

-- Dispositivo
CREATE OR REPLACE FUNCTION public.hx_inst_device_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.inst_patients p WHERE p.id = NEW.patient_id AND p.institution_id = NEW.institution_id) THEN
      RAISE EXCEPTION 'El paciente no es de esta institución' USING ERRCODE = '23514', HINT = 'patient_mismatch';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  -- Solo cambian el nombre, el estado y la última lectura; un dispositivo revocado no vuelve a activarse.
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'Un dispositivo revocado no se reactiva: empareja uno nuevo' USING ERRCODE = '23514', HINT = 'device_revoked';
  END IF;
  NEW.institution_id := OLD.institution_id;
  NEW.patient_id     := OLD.patient_id;
  NEW.code_hash      := OLD.code_hash;
  NEW.code_hint      := OLD.code_hint;
  NEW.created_by     := OLD.created_by;
  NEW.created_at     := OLD.created_at;
  NEW.revoked_at     := CASE WHEN NEW.status = 'revoked' THEN COALESCE(OLD.revoked_at, now()) END;
  RETURN NEW;
END
$fn$;

-- Notas: texto que se firma con el de la anterior (cadena por paciente). Una nota no se edita ni se borra: se corrige con otra.
CREATE OR REPLACE FUNCTION public.hx_inst_note_payload(
  p_prev text, p_seq integer, p_patient uuid, p_author uuid, p_kind text, p_at timestamptz, p_body text, p_vitals jsonb
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT p_prev || '|' || p_seq::text || '|' || p_patient::text || '|' || p_author::text || '|' || p_kind || '|'
         || to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || p_body || '|' || COALESCE(p_vitals::text, '')
$fn$;

CREATE OR REPLACE FUNCTION public.hx_inst_note_chain()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_seq  integer;
  v_prev text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inst_patients p WHERE p.id = NEW.patient_id AND p.institution_id = NEW.institution_id) THEN
    RAISE EXCEPTION 'El paciente no es de esta institución' USING ERRCODE = '23514', HINT = 'patient_mismatch';
  END IF;
  IF NEW.case_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inst_cases c WHERE c.id = NEW.case_id AND c.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'El caso no es de este paciente' USING ERRCODE = '23514', HINT = 'case_mismatch';
  END IF;
  IF (NEW.kind = 'correction') <> (NEW.corrects_note_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Una corrección debe indicar la nota que corrige (y solo las correcciones lo hacen)' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF NEW.corrects_note_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inst_notes n WHERE n.id = NEW.corrects_note_id AND n.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'La nota que se corrige no es de este paciente' USING ERRCODE = '23514', HINT = 'note_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('inst_notes:' || NEW.patient_id::text, 0));
  SELECT n.seq, n.hash INTO v_seq, v_prev FROM public.inst_notes n WHERE n.patient_id = NEW.patient_id ORDER BY n.seq DESC LIMIT 1;
  NEW.seq        := COALESCE(v_seq, 0) + 1;
  NEW.prev_hash  := COALESCE(v_prev, repeat('0', 64));
  NEW.created_at := now();
  NEW.hash       := public.hx_sha256(public.hx_inst_note_payload(NEW.prev_hash, NEW.seq, NEW.patient_id, NEW.author_id, NEW.kind,
                                                                   NEW.created_at, NEW.body, NEW.vitals));
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.hx_inst_note_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Solo en cascada, cuando ya no existe el paciente ni la cuenta de la institución. Una nota suelta no se borra.
    IF EXISTS (SELECT 1 FROM public.inst_patients p WHERE p.id = OLD.patient_id)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.institution_id) THEN
      RAISE EXCEPTION 'Las notas clínicas no se borran: agrega una corrección' USING ERRCODE = '42501', HINT = 'note_immutable';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: solo se permite que se anulen solas las referencias al caso o a la nota corregida cuando esos registros desaparecen.
  IF (NEW.id, NEW.institution_id, NEW.patient_id, NEW.seq, NEW.kind, NEW.body, NEW.vitals, NEW.author_id, NEW.author_name,
      NEW.author_role, NEW.prev_hash, NEW.hash, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.institution_id, OLD.patient_id, OLD.seq, OLD.kind, OLD.body, OLD.vitals, OLD.author_id, OLD.author_name,
      OLD.author_role, OLD.prev_hash, OLD.hash, OLD.created_at)
     OR (NEW.case_id IS DISTINCT FROM OLD.case_id AND NEW.case_id IS NOT NULL)
     OR (NEW.corrects_note_id IS DISTINCT FROM OLD.corrects_note_id AND NEW.corrects_note_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Las notas clínicas no se editan: agrega una corrección' USING ERRCODE = '42501', HINT = 'note_immutable';
  END IF;
  RETURN NEW;
END
$fn$;

-- Controles: antes de guardar, calcula el NEWS2 con lo medido ahora más lo último conocido de las 12 h anteriores.
CREATE OR REPLACE FUNCTION public.hx_inst_obs_before()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  pt        record;
  c         record;
  r         jsonb;
  v_age     integer;
  v_rr      numeric;
  v_spo2    numeric;
  v_o2      boolean;
  v_sbp     numeric;
  v_hr      numeric;
  v_avpu    text;
  v_temp    numeric;
  v_carried text[] := '{}';
BEGIN
  SELECT p.institution_id, p.spo2_scale, p.birth_date INTO pt FROM public.inst_patients p WHERE p.id = NEW.patient_id;
  IF NOT FOUND OR pt.institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'El paciente no es de esta institución' USING ERRCODE = '23514', HINT = 'patient_mismatch';
  END IF;

  NEW.created_at  := now();
  NEW.recorded_at := COALESCE(NEW.recorded_at, now());
  IF NEW.recorded_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'La hora del control está en el futuro' USING ERRCODE = '23514', HINT = 'future_time';
  END IF;
  IF NEW.recorded_at < now() - interval '48 hours' THEN
    RAISE EXCEPTION 'No se registran controles de hace más de 48 horas' USING ERRCODE = '23514', HINT = 'too_old';
  END IF;

  SELECT (array_agg(o.rr     ORDER BY o.recorded_at DESC) FILTER (WHERE o.rr     IS NOT NULL))[1] AS rr,
         (array_agg(o.spo2   ORDER BY o.recorded_at DESC) FILTER (WHERE o.spo2   IS NOT NULL))[1] AS spo2,
         (array_agg(o.on_o2  ORDER BY o.recorded_at DESC) FILTER (WHERE o.on_o2  IS NOT NULL))[1] AS on_o2,
         (array_agg(o.sbp    ORDER BY o.recorded_at DESC) FILTER (WHERE o.sbp    IS NOT NULL))[1] AS sbp,
         (array_agg(o.hr     ORDER BY o.recorded_at DESC) FILTER (WHERE o.hr     IS NOT NULL))[1] AS hr,
         (array_agg(o.avpu   ORDER BY o.recorded_at DESC) FILTER (WHERE o.avpu   IS NOT NULL))[1] AS avpu,
         (array_agg(o.temp_c ORDER BY o.recorded_at DESC) FILTER (WHERE o.temp_c IS NOT NULL))[1] AS temp_c
    INTO c
    FROM public.inst_obs o
   WHERE o.patient_id = NEW.patient_id
     AND o.recorded_at <= NEW.recorded_at
     AND o.recorded_at >  NEW.recorded_at - interval '12 hours';

  v_rr   := COALESCE(NEW.rr, c.rr);        IF NEW.rr     IS NULL AND c.rr     IS NOT NULL THEN v_carried := array_append(v_carried, 'rr');     END IF;
  v_spo2 := COALESCE(NEW.spo2, c.spo2);    IF NEW.spo2   IS NULL AND c.spo2   IS NOT NULL THEN v_carried := array_append(v_carried, 'spo2');   END IF;
  v_o2   := COALESCE(NEW.on_o2, c.on_o2);  IF NEW.on_o2  IS NULL AND c.on_o2  IS NOT NULL THEN v_carried := array_append(v_carried, 'on_o2');  END IF;
  v_sbp  := COALESCE(NEW.sbp, c.sbp);      IF NEW.sbp    IS NULL AND c.sbp    IS NOT NULL THEN v_carried := array_append(v_carried, 'sbp');    END IF;
  v_hr   := COALESCE(NEW.hr, c.hr);        IF NEW.hr     IS NULL AND c.hr     IS NOT NULL THEN v_carried := array_append(v_carried, 'hr');     END IF;
  v_avpu := COALESCE(NEW.avpu, c.avpu);    IF NEW.avpu   IS NULL AND c.avpu   IS NOT NULL THEN v_carried := array_append(v_carried, 'avpu');   END IF;
  v_temp := COALESCE(NEW.temp_c, c.temp_c); IF NEW.temp_c IS NULL AND c.temp_c IS NOT NULL THEN v_carried := array_append(v_carried, 'temp_c'); END IF;

  v_age := CASE WHEN pt.birth_date IS NULL THEN NULL ELSE date_part('year', age(NEW.recorded_at::date, pt.birth_date))::integer END;
  NEW.applicable := v_age IS NULL OR v_age >= 16;

  IF NEW.applicable THEN
    r := public.hx_news2(v_rr, v_spo2, v_o2, v_sbp, v_hr, v_avpu, v_temp, pt.spo2_scale::integer);
    NEW.news2            := (r ->> 'score')::smallint;
    NEW.news2_max_single := (r ->> 'max_single')::smallint;
    NEW.news2_measured   := (r ->> 'measured')::smallint;
    NEW.band             := public.hx_news2_band(NEW.news2, NEW.news2_max_single);
    NEW.news2_input      := jsonb_strip_nulls(jsonb_build_object(
      'rr', v_rr, 'spo2', v_spo2, 'on_o2', v_o2, 'sbp', v_sbp, 'hr', v_hr, 'avpu', v_avpu, 'temp_c', v_temp,
      'scale', pt.spo2_scale, 'carried', to_jsonb(v_carried), 'parts', r -> 'parts'));
  ELSE
    NEW.news2 := NULL; NEW.news2_max_single := NULL; NEW.news2_measured := NULL; NEW.band := NULL; NEW.news2_input := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

-- Abre o refresca la alerta de un paciente. Una sola abierta por motivo; si ya hay una de mayor gravedad, esa sigue siendo la que se atiende.
CREATE OR REPLACE FUNCTION public.hx_inst_alert_raise(
  p_inst uuid, p_patient uuid, p_obs uuid, p_sev text, p_reason text, p_news2 integer, p_msg text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rank integer := public.hx_alert_rank(p_reason);
  v_id   uuid;
  v_name text;
BEGIN
  IF p_reason <> 'fall'
     AND EXISTS (SELECT 1 FROM public.inst_alerts a
                  WHERE a.patient_id = p_patient AND a.status <> 'resolved' AND a.reason <> 'fall' AND public.hx_alert_rank(a.reason) > v_rank) THEN
    RETURN;
  END IF;

  UPDATE public.inst_alerts a
     SET occurrences = a.occurrences + 1, last_seen_at = now(), news2 = p_news2, obs_id = p_obs, message = p_msg
   WHERE a.patient_id = p_patient AND a.reason = p_reason AND a.status <> 'resolved';
  IF FOUND THEN
    RETURN;
  END IF;

  BEGIN
    IF p_reason <> 'fall' THEN
      UPDATE public.inst_alerts a
         SET status = 'resolved', resolved_at = now(), resolution = 'auto', resolved_by_name = 'Sistema',
             resolve_note = 'Reemplazada por una alerta de mayor gravedad'
       WHERE a.patient_id = p_patient AND a.status <> 'resolved' AND a.reason <> 'fall' AND public.hx_alert_rank(a.reason) < v_rank;
    END IF;
    INSERT INTO public.inst_alerts (institution_id, patient_id, obs_id, severity, reason, news2, message, due_ack_at)
    VALUES (p_inst, p_patient, p_obs, p_sev, p_reason, p_news2, p_msg,
            now() + CASE p_sev WHEN 'critical' THEN interval '10 minutes' WHEN 'urgent' THEN interval '30 minutes' ELSE interval '2 hours' END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Otra lectura abrió la misma alerta al mismo tiempo: esta solo suma una ocurrencia.
    UPDATE public.inst_alerts a
       SET occurrences = a.occurrences + 1, last_seen_at = now(), news2 = p_news2, obs_id = p_obs, message = p_msg
     WHERE a.patient_id = p_patient AND a.reason = p_reason AND a.status <> 'resolved';
    RETURN;
  END;

  IF p_sev IN ('urgent', 'critical') THEN
    SELECT public.short_display_name(pt.full_name) INTO v_name FROM public.inst_patients pt WHERE pt.id = p_patient;
    PERFORM public.hx_care_notify_team(
      p_inst, 'monitoreo', 'inst_alert',
      CASE p_sev WHEN 'critical' THEN 'Alerta crítica' ELSE 'Alerta urgente' END || COALESCE(' · NEWS2 ' || p_news2::text, ''),
      COALESCE(v_name, 'Paciente') || ' · ' || p_msg);
  END IF;
END
$fn$;

-- Cierra solas las alertas de NEWS2 cuando el puntaje lleva dos controles seguidos en «estable» (con 10 min o más entre ellos). Las
-- urgentes y críticas que nadie atendió NO se cierran solas: alguien tiene que verlas y dejar constancia.
CREATE OR REPLACE FUNCTION public.hx_inst_alert_autoresolve(p_patient uuid, p_at timestamptz, p_obs uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inst_obs o
              WHERE o.patient_id = p_patient AND o.id <> p_obs AND o.applicable AND o.band <> 'low'
                AND o.recorded_at > p_at - interval '10 minutes' AND o.recorded_at <= p_at) THEN
    RETURN;
  END IF;
  IF COALESCE((SELECT o.band FROM public.inst_obs o
                WHERE o.patient_id = p_patient AND o.id <> p_obs AND o.applicable AND o.recorded_at <= p_at - interval '10 minutes'
                ORDER BY o.recorded_at DESC LIMIT 1), '') <> 'low' THEN
    RETURN;
  END IF;
  UPDATE public.inst_alerts a
     SET status = 'resolved', resolved_at = now(), resolution = 'auto', resolved_by_name = 'Sistema',
         resolve_note = 'El puntaje volvió a la normalidad en dos controles seguidos'
   WHERE a.patient_id = p_patient AND a.status <> 'resolved'
     AND a.reason IN ('news2_single', 'news2_medium', 'news2_high', 'deterioration')
     AND (a.status = 'acknowledged' OR a.severity = 'warn');
END
$fn$;

-- Después de guardar un control: actualiza lo último que se sabe del paciente y decide las alertas.
CREATE OR REPLACE FUNCTION public.hx_inst_obs_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_interval integer := 720;
  v_min6     smallint;
  v_reason   text;
  v_sev      text;
  v_msg      text;
BEGIN
  IF NEW.news2 IS NOT NULL THEN
    v_interval := public.hx_news2_interval_min(NEW.news2, NEW.news2_max_single);
  END IF;

  INSERT INTO public.inst_live AS l
         (patient_id, institution_id, last_obs_at, last_obs_source, last_news2, last_band, last_vitals, next_obs_due_at, last_device_at, updated_at)
  VALUES (NEW.patient_id, NEW.institution_id, NEW.recorded_at, NEW.source, NEW.news2, NEW.band,
          COALESCE(jsonb_strip_nulls(jsonb_build_object(
            'hr', COALESCE(NEW.news2_input -> 'hr', to_jsonb(NEW.hr)), 'rr', COALESCE(NEW.news2_input -> 'rr', to_jsonb(NEW.rr)),
            'spo2', COALESCE(NEW.news2_input -> 'spo2', to_jsonb(NEW.spo2)), 'on_o2', COALESCE(NEW.news2_input -> 'on_o2', to_jsonb(NEW.on_o2)),
            'sbp', COALESCE(NEW.news2_input -> 'sbp', to_jsonb(NEW.sbp)), 'dbp', to_jsonb(NEW.dbp),
            'temp_c', COALESCE(NEW.news2_input -> 'temp_c', to_jsonb(NEW.temp_c)), 'avpu', COALESCE(NEW.news2_input -> 'avpu', to_jsonb(NEW.avpu)),
            'pain', to_jsonb(NEW.pain))), '{}'::jsonb),
          NEW.recorded_at + make_interval(mins => v_interval),
          CASE WHEN NEW.source = 'device' THEN NEW.recorded_at END, now())
  ON CONFLICT (patient_id) DO UPDATE
     SET last_obs_at = EXCLUDED.last_obs_at, last_obs_source = EXCLUDED.last_obs_source, last_news2 = EXCLUDED.last_news2,
         last_band = EXCLUDED.last_band, last_vitals = EXCLUDED.last_vitals, next_obs_due_at = EXCLUDED.next_obs_due_at,
         last_device_at = GREATEST(l.last_device_at, EXCLUDED.last_device_at), updated_at = now()
   WHERE l.last_obs_at IS NULL OR l.last_obs_at <= EXCLUDED.last_obs_at;

  IF NEW.fall THEN
    PERFORM public.hx_inst_alert_raise(NEW.institution_id, NEW.patient_id, NEW.id, 'urgent', 'fall', NEW.news2, 'Posible caída reportada');
  END IF;

  IF NEW.applicable AND NEW.news2 IS NOT NULL THEN
    SELECT min(o.news2) INTO v_min6
      FROM public.inst_obs o
     WHERE o.patient_id = NEW.patient_id AND o.id <> NEW.id AND o.applicable AND o.news2 IS NOT NULL
       AND o.recorded_at > NEW.recorded_at - interval '6 hours' AND o.recorded_at <= NEW.recorded_at;

    IF NEW.band = 'high' THEN
      v_reason := 'news2_high';   v_sev := 'critical';
      v_msg := 'Riesgo clínico alto (NEWS2 ' || NEW.news2 || '). Valoración de emergencia.';
    ELSIF NEW.band = 'medium' THEN
      v_reason := 'news2_medium'; v_sev := 'urgent';
      v_msg := 'Riesgo clínico medio (NEWS2 ' || NEW.news2 || '). Revisión clínica urgente.';
    ELSIF NEW.band = 'low_medium' THEN
      v_reason := 'news2_single'; v_sev := 'warn';
      v_msg := 'Un parámetro suma 3 puntos (NEWS2 ' || NEW.news2 || '). Pide revisión clínica.';
    ELSIF v_min6 IS NOT NULL AND NEW.news2 >= 3 AND NEW.news2 - v_min6 >= 3 THEN
      v_reason := 'deterioration'; v_sev := 'warn';
      v_msg := 'El NEWS2 subió ' || (NEW.news2 - v_min6) || ' puntos en menos de 6 h (de ' || v_min6 || ' a ' || NEW.news2 || ').';
    END IF;

    -- Un aparato mide a cada rato y se mueve: una alerta de nivel «atención» exige dos lecturas seguidas del dispositivo (30 min).
    IF v_reason IN ('news2_single', 'deterioration') AND NEW.source = 'device'
       AND NOT EXISTS (SELECT 1 FROM public.inst_obs o
                        WHERE o.patient_id = NEW.patient_id AND o.id <> NEW.id AND o.source = 'device' AND o.news2 >= 3
                          AND o.recorded_at <= NEW.recorded_at AND o.recorded_at > NEW.recorded_at - interval '30 minutes') THEN
      v_reason := NULL;
    END IF;

    IF v_reason IS NOT NULL THEN
      PERFORM public.hx_inst_alert_raise(NEW.institution_id, NEW.patient_id, NEW.id, v_sev, v_reason, NEW.news2, v_msg);
    ELSIF NEW.band = 'low' THEN
      PERFORM public.hx_inst_alert_autoresolve(NEW.patient_id, NEW.recorded_at, NEW.id);
    END IF;
  END IF;

  IF NEW.source <> 'device' THEN
    PERFORM public.hx_care_log(NEW.institution_id, NEW.patient_id, NULL, 'obs_recorded',
                               jsonb_build_object('news2', NEW.news2, 'band', NEW.band, 'source', NEW.source, 'fall', NEW.fall));
  END IF;
  RETURN NULL;
END
$fn$;

-- Alertas urgentes y críticas que nadie atendió a tiempo: se avisa de nuevo (solo con el plan que incluye escalamiento).
-- No hay tarea programada: se revisa cuando entra un control o un dato de un dispositivo, y la pantalla de monitoreo lo pide a la hora
-- exacta del vencimiento (inst_escalate_due).
CREATE OR REPLACE FUNCTION public.hx_inst_escalate(p_inst uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  a      record;
  n      integer := 0;
  v_name text;
BEGIN
  IF NOT COALESCE((public.hx_care_plan(p_inst) ->> 'escalation')::boolean, false) THEN
    RETURN 0;
  END IF;
  FOR a IN SELECT x.id, x.patient_id, x.severity, x.opened_at
             FROM public.inst_alerts x
            WHERE x.institution_id = p_inst AND x.status = 'open' AND x.escalated_at IS NULL
              AND x.severity IN ('urgent', 'critical') AND x.due_ack_at <= now()
            ORDER BY x.due_ack_at
            LIMIT 50
              FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.inst_alerts SET escalated_at = now(), escalation_level = 1 WHERE id = a.id;
    SELECT public.short_display_name(pt.full_name) INTO v_name FROM public.inst_patients pt WHERE pt.id = a.patient_id;
    PERFORM public.hx_care_notify_team(
      p_inst, 'monitoreo', 'inst_alert_escalated', 'Alerta sin atender',
      COALESCE(v_name, 'Paciente') || ' · pasó el plazo de atención (' || GREATEST(1, round(extract(epoch FROM now() - a.opened_at) / 60))::integer || ' min).');
    PERFORM public.hx_care_log(p_inst, a.patient_id, NULL, 'alert_escalated', jsonb_build_object('alert', a.id, 'severity', a.severity));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$fn$;

-- Lo que corre cada minuto (pg_cron): escala las alertas vencidas de TODAS las instituciones, haya o no una pantalla abierta.
CREATE OR REPLACE FUNCTION public.hx_inst_escalate_all()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT a.institution_id
             FROM public.inst_alerts a
            WHERE a.status = 'open' AND a.escalated_at IS NULL AND a.severity IN ('urgent', 'critical') AND a.due_ack_at <= now()
            LIMIT 200
  LOOP
    n := n + public.hx_inst_escalate(r.institution_id);
  END LOOP;
  RETURN n;
END
$fn$;

-- Disparadores
DROP TRIGGER IF EXISTS trg_inst_patient_guard ON public.inst_patients;
CREATE TRIGGER trg_inst_patient_guard BEFORE INSERT OR UPDATE ON public.inst_patients
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_patient_guard();

DROP TRIGGER IF EXISTS trg_inst_case_guard ON public.inst_cases;
CREATE TRIGGER trg_inst_case_guard BEFORE INSERT OR UPDATE ON public.inst_cases
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_case_guard();

DROP TRIGGER IF EXISTS trg_inst_task_guard ON public.inst_tasks;
CREATE TRIGGER trg_inst_task_guard BEFORE INSERT OR UPDATE ON public.inst_tasks
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_task_guard();

DROP TRIGGER IF EXISTS trg_inst_device_guard ON public.inst_devices;
CREATE TRIGGER trg_inst_device_guard BEFORE INSERT OR UPDATE ON public.inst_devices
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_device_guard();

DROP TRIGGER IF EXISTS trg_inst_note_chain ON public.inst_notes;
CREATE TRIGGER trg_inst_note_chain BEFORE INSERT ON public.inst_notes
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_note_chain();

DROP TRIGGER IF EXISTS trg_inst_note_lock ON public.inst_notes;
CREATE TRIGGER trg_inst_note_lock BEFORE UPDATE OR DELETE ON public.inst_notes
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_note_lock();

DROP TRIGGER IF EXISTS trg_inst_obs_before ON public.inst_obs;
CREATE TRIGGER trg_inst_obs_before BEFORE INSERT ON public.inst_obs
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_obs_before();

DROP TRIGGER IF EXISTS trg_inst_obs_after ON public.inst_obs;
CREATE TRIGGER trg_inst_obs_after AFTER INSERT ON public.inst_obs
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_obs_after();

-- ── 5) Funciones de pacientes, casos y notas ─────────────────────────────────────
-- Toda escritura entra por aquí (ningún permiso de INSERT/UPDATE/DELETE a la API). Cada función: (1) comprueba quién llama y para qué
-- institución actúa, (2) aplica los límites del plan, (3) valida, (4) escribe y deja constancia. Los errores llevan en HINT un código
-- estable (forbidden, not_found, patient_limit, …) que la pantalla traduce.

-- Una nota en la cadena del paciente, firmada por quien actúa.
CREATE OR REPLACE FUNCTION public.hx_care_note(
  p_inst uuid, p_patient uuid, p_case uuid, p_kind text, p_body text, p_vitals jsonb DEFAULT NULL, p_corrects uuid DEFAULT NULL
)
RETURNS public.inst_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.inst_notes;
BEGIN
  INSERT INTO public.inst_notes (institution_id, patient_id, case_id, seq, kind, body, vitals, corrects_note_id,
                                 author_id, author_name, author_role, prev_hash, hash)
  VALUES (p_inst, p_patient, p_case, 1, p_kind, p_body, p_vitals, p_corrects,
          auth.uid(), public.hx_care_actor_name(), CASE WHEN auth.uid() = p_inst THEN 'owner' ELSE 'member' END, '', '')
  RETURNING * INTO r;
  RETURN r;
END
$fn$;

-- Crea un caso (lo usan inst_patient_create e inst_case_open). Con plan de seguimientos, agenda las llamadas y revisiones de rutina.
CREATE OR REPLACE FUNCTION public.hx_care_case_insert(p_inst uuid, p_patient uuid, p_data jsonb, p_plan jsonb)
RETURNS public.inst_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_case   public.inst_cases;
  v_app    uuid        := NULLIF(p_data ->> 'application_id', '')::uuid;
  v_pro    uuid;
  v_label  text        := NULLIF(btrim(p_data ->> 'professional_label'), '');
  v_title  text        := NULLIF(btrim(p_data ->> 'title'), '');
  v_status text        := COALESCE(NULLIF(p_data ->> 'status', ''), 'active');
  v_target timestamptz := NULLIF(p_data ->> 'target_end_at', '')::timestamptz;
  v_otitle text;
BEGIN
  IF v_status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'Un caso nuevo empieza pendiente o activo' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF v_target IS NOT NULL AND v_target < now() - interval '1 day' THEN
    RAISE EXCEPTION 'La fecha estimada de cierre ya pasó' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = 'target_end_at';
  END IF;

  IF v_app IS NOT NULL THEN
    SELECT a.professional_id, public.hx_pro_label(pr.full_name, (p_plan ->> 'plan') = 'free'), o.title
      INTO v_pro, v_label, v_otitle
      FROM public.applications a
      JOIN public.job_offers o ON o.id = a.job_offer_id
      LEFT JOIN public.profiles pr ON pr.user_id = a.professional_id
     WHERE a.id = v_app AND o.posted_by = p_inst AND a.status = 'accepted';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa postulación no está aceptada o no es de tu institución' USING ERRCODE = '23514', HINT = 'application_invalid';
    END IF;
  END IF;

  INSERT INTO public.inst_cases (institution_id, patient_id, title, care_type, priority, status, target_end_at,
                                 application_id, professional_id, professional_label, summary, created_by)
  VALUES (p_inst, p_patient, COALESCE(v_title, v_otitle, 'Coordinación de cuidado'),
          COALESCE(NULLIF(p_data ->> 'care_type', ''), 'domiciliary'), COALESCE(NULLIF(p_data ->> 'priority', ''), 'medium'),
          v_status, v_target, v_app, v_pro, v_label, NULLIF(btrim(p_data ->> 'summary'), ''), auth.uid())
  RETURNING * INTO v_case;

  IF COALESCE((p_plan ->> 'followups')::boolean, false) THEN
    INSERT INTO public.inst_tasks (institution_id, patient_id, case_id, title, kind, due_at, source, created_by) VALUES
      (p_inst, p_patient, v_case.id, 'Llamar para confirmar que el servicio empezó bien', 'call', now() + interval '1 day', 'auto_followup', auth.uid()),
      (p_inst, p_patient, v_case.id, 'Revisar la evolución del caso', 'followup', now() + interval '7 days', 'auto_followup', auth.uid());
    IF v_target IS NOT NULL AND v_target > now() + interval '8 days' THEN
      INSERT INTO public.inst_tasks (institution_id, patient_id, case_id, title, kind, due_at, source, created_by)
      VALUES (p_inst, p_patient, v_case.id, 'Preguntar cómo fue la experiencia del servicio', 'followup', v_target, 'auto_followup', auth.uid());
    END IF;
  END IF;

  PERFORM public.hx_care_log(p_inst, p_patient, v_case.id, 'case_opened',
                             jsonb_build_object('care_type', v_case.care_type, 'priority', v_case.priority, 'from_application', v_app IS NOT NULL));
  RETURN v_case;
END
$fn$;

-- Registra un paciente (con la confirmación de que la institución tiene su autorización). Opcional: lo deja en monitoreo y abre su primer caso.
CREATE OR REPLACE FUNCTION public.inst_patient_create(p_data jsonb, p_consent boolean, p_monitor boolean DEFAULT false, p_case jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst   uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_plan   jsonb;
  v_status text;
  v_pt     public.inst_patients;
  v_case   public.inst_cases;
  v_con    text;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los datos del paciente' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF p_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirma que la institución cuenta con la autorización del paciente o de su acudiente' USING ERRCODE = '23514', HINT = 'consent_required';
  END IF;
  IF COALESCE(p_monitor, false) AND public.hx_care_inst('monitoreo') IS NULL THEN
    RAISE EXCEPTION 'No tienes acceso al módulo de monitoreo' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
  IF p_case IS NOT NULL AND public.hx_care_inst('pacientes') IS NULL THEN
    RAISE EXCEPTION 'No tienes acceso al módulo de pacientes' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
  v_status := COALESCE(NULLIF(p_data ->> 'status', ''), 'active');
  IF v_status NOT IN ('pending', 'active') OR (COALESCE(p_monitor, false) AND v_status <> 'active') THEN
    RAISE EXCEPTION 'Un paciente nuevo empieza activo o pendiente (y solo uno activo se monitorea)' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('inst_care:' || v_inst::text, 0));
  v_plan := public.hx_care_plan(v_inst);
  IF (SELECT count(*) FROM public.inst_patients WHERE institution_id = v_inst AND status <> 'discharged') >= (v_plan ->> 'patients')::integer THEN
    RAISE EXCEPTION 'Tu plan permite hasta % pacientes a la vez. Da de alta a alguno o mejora tu plan.', (v_plan ->> 'patients')::integer
      USING ERRCODE = '53400', HINT = 'patient_limit';
  END IF;
  IF COALESCE(p_monitor, false)
     AND (SELECT count(*) FROM public.inst_patients WHERE institution_id = v_inst AND monitoring) >= (v_plan ->> 'monitored')::integer THEN
    RAISE EXCEPTION 'Tu plan permite monitorear hasta % pacientes a la vez.', (v_plan ->> 'monitored')::integer
      USING ERRCODE = '53400', HINT = 'monitor_limit';
  END IF;

  BEGIN
    INSERT INTO public.inst_patients (
      institution_id, full_name, document_type, document_number, birth_date, sex, eps_name, city, address, modality, room,
      conditions, allergies, emergency_name, emergency_phone, status, monitoring, family_updates_ok, external_ref,
      consent_confirmed_by, created_by)
    VALUES (
      v_inst, btrim(p_data ->> 'full_name'), NULLIF(p_data ->> 'document_type', ''), NULLIF(btrim(p_data ->> 'document_number'), ''),
      NULLIF(p_data ->> 'birth_date', '')::date, NULLIF(p_data ->> 'sex', ''), NULLIF(btrim(p_data ->> 'eps_name'), ''),
      NULLIF(btrim(p_data ->> 'city'), ''), NULLIF(btrim(p_data ->> 'address'), ''), COALESCE(NULLIF(p_data ->> 'modality', ''), 'remote'),
      NULLIF(btrim(p_data ->> 'room'), ''), public.hx_json_texts(p_data -> 'conditions'), public.hx_json_texts(p_data -> 'allergies'),
      NULLIF(btrim(p_data ->> 'emergency_name'), ''), NULLIF(btrim(p_data ->> 'emergency_phone'), ''), v_status,
      COALESCE(p_monitor, false), COALESCE((p_data ->> 'family_updates_ok')::boolean, false), NULLIF(btrim(p_data ->> 'external_ref'), ''),
      auth.uid(), auth.uid())
    RETURNING * INTO v_pt;

    IF v_pt.monitoring THEN
      INSERT INTO public.inst_live (patient_id, institution_id, next_obs_due_at) VALUES (v_pt.id, v_inst, now()) ON CONFLICT (patient_id) DO NOTHING;
    END IF;
    IF p_case IS NOT NULL THEN
      v_case := public.hx_care_case_insert(v_inst, v_pt.id, p_case, v_plan);
    END IF;
    PERFORM public.hx_care_note(v_inst, v_pt.id, NULL, 'coordination',
      'Paciente registrado en la institución. Quien lo registró confirmó que la institución cuenta con la autorización del paciente o de su acudiente para tratar sus datos (Ley 1581 de 2012).');
    PERFORM public.hx_care_log(v_inst, v_pt.id, v_case.id, 'patient_created',
                               jsonb_build_object('modality', v_pt.modality, 'monitoring', v_pt.monitoring, 'with_case', p_case IS NOT NULL));
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'inst_patients_document_uq' THEN
        RAISE EXCEPTION 'Ya existe un paciente con ese documento en tu institución' USING ERRCODE = '23505', HINT = 'duplicate_document';
      END IF;
      RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los datos del formulario' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Revisa los datos del formulario' USING ERRCODE = '23514', HINT = 'invalid_data';
  END;
  RETURN jsonb_build_object('patient', to_jsonb(v_pt), 'case', CASE WHEN v_case.id IS NULL THEN NULL ELSE to_jsonb(v_case) END);
END
$fn$;

-- Cambia los datos de un paciente (solo las claves que vienen en p_data).
CREATE OR REPLACE FUNCTION public.inst_patient_update(p_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_pt   public.inst_patients;
  v_new  public.inst_patients;
  v_con  text;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los datos del paciente' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  v_pt := public.hx_care_patient(p_id, v_inst, true);
  IF v_pt.status = 'discharged' THEN
    RAISE EXCEPTION 'El paciente ya tiene el alta: reactívalo para cambiar sus datos' USING ERRCODE = '23514', HINT = 'patient_discharged';
  END IF;
  BEGIN
    UPDATE public.inst_patients SET
      full_name         = CASE WHEN p_data ? 'full_name'       THEN btrim(p_data ->> 'full_name') ELSE full_name END,
      document_type     = CASE WHEN p_data ? 'document_type'   THEN NULLIF(p_data ->> 'document_type', '') ELSE document_type END,
      document_number   = CASE WHEN p_data ? 'document_number' THEN NULLIF(btrim(p_data ->> 'document_number'), '') ELSE document_number END,
      birth_date        = CASE WHEN p_data ? 'birth_date'      THEN NULLIF(p_data ->> 'birth_date', '')::date ELSE birth_date END,
      sex               = CASE WHEN p_data ? 'sex'             THEN NULLIF(p_data ->> 'sex', '') ELSE sex END,
      eps_name          = CASE WHEN p_data ? 'eps_name'        THEN NULLIF(btrim(p_data ->> 'eps_name'), '') ELSE eps_name END,
      city              = CASE WHEN p_data ? 'city'            THEN NULLIF(btrim(p_data ->> 'city'), '') ELSE city END,
      address           = CASE WHEN p_data ? 'address'         THEN NULLIF(btrim(p_data ->> 'address'), '') ELSE address END,
      modality          = CASE WHEN p_data ? 'modality'        THEN COALESCE(NULLIF(p_data ->> 'modality', ''), modality) ELSE modality END,
      room              = CASE WHEN p_data ? 'room'            THEN NULLIF(btrim(p_data ->> 'room'), '') ELSE room END,
      conditions        = CASE WHEN p_data ? 'conditions'      THEN public.hx_json_texts(p_data -> 'conditions') ELSE conditions END,
      allergies         = CASE WHEN p_data ? 'allergies'       THEN public.hx_json_texts(p_data -> 'allergies') ELSE allergies END,
      emergency_name    = CASE WHEN p_data ? 'emergency_name'  THEN NULLIF(btrim(p_data ->> 'emergency_name'), '') ELSE emergency_name END,
      emergency_phone   = CASE WHEN p_data ? 'emergency_phone' THEN NULLIF(btrim(p_data ->> 'emergency_phone'), '') ELSE emergency_phone END,
      family_updates_ok = CASE WHEN p_data ? 'family_updates_ok' THEN COALESCE((p_data ->> 'family_updates_ok')::boolean, false) ELSE family_updates_ok END,
      external_ref      = CASE WHEN p_data ? 'external_ref'    THEN NULLIF(btrim(p_data ->> 'external_ref'), '') ELSE external_ref END
    WHERE id = v_pt.id
    RETURNING * INTO v_new;
    PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'patient_updated',
                               jsonb_build_object('fields', COALESCE((SELECT jsonb_agg(k) FROM jsonb_object_keys(p_data) AS k), '[]'::jsonb)));
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'inst_patients_document_uq' THEN
        RAISE EXCEPTION 'Ya existe un paciente con ese documento en tu institución' USING ERRCODE = '23505', HINT = 'duplicate_document';
      END IF;
      RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los datos del formulario' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Revisa los datos del formulario' USING ERRCODE = '23514', HINT = 'invalid_data';
  END;
  RETURN to_jsonb(v_new);
END
$fn$;

-- Pendiente · activo · en pausa (el alta tiene su propia función). Pasar a pausa o pendiente saca al paciente del monitoreo.
CREATE OR REPLACE FUNCTION public.inst_patient_set_status(p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_pt   public.inst_patients;
  v_plan jsonb;
  v_new  public.inst_patients;
BEGIN
  IF p_status = 'discharged' THEN
    RAISE EXCEPTION 'Para dar el alta usa la acción «Dar de alta»' USING ERRCODE = '23514', HINT = 'use_discharge';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'active', 'paused') THEN
    RAISE EXCEPTION 'Estado no válido' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inst_care:' || v_inst::text, 0));
  v_pt := public.hx_care_patient(p_id, v_inst, true);
  IF v_pt.status = p_status THEN
    RETURN to_jsonb(v_pt);
  END IF;
  IF v_pt.status = 'discharged' THEN
    v_plan := public.hx_care_plan(v_inst);
    IF (SELECT count(*) FROM public.inst_patients WHERE institution_id = v_inst AND status <> 'discharged') >= (v_plan ->> 'patients')::integer THEN
      RAISE EXCEPTION 'Tu plan permite hasta % pacientes a la vez. Da de alta a alguno o mejora tu plan.', (v_plan ->> 'patients')::integer
        USING ERRCODE = '53400', HINT = 'patient_limit';
    END IF;
  END IF;
  UPDATE public.inst_patients SET status = p_status WHERE id = v_pt.id RETURNING * INTO v_new;
  PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'patient_status', jsonb_build_object('from', v_pt.status, 'to', p_status));
  RETURN to_jsonb(v_new);
END
$fn$;

-- Alta: cierra los casos abiertos con el desenlace indicado, da por omitidas las tareas, resuelve las alertas, revoca los dispositivos y
-- deja una nota en la historia. Todo o nada.
CREATE OR REPLACE FUNCTION public.inst_patient_discharge(p_id uuid, p_outcome text DEFAULT 'stable', p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst  uuid := public.hx_care_need('pacientes');
  v_pt    public.inst_patients;
  v_new   public.inst_patients;
  v_label text;
  v_n_c   integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('recovered', 'stable', 'referred', 'withdrawn', 'deceased', 'other') THEN
    RAISE EXCEPTION 'Indica el desenlace del alta' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF NOT public.hx_text_ok(p_note, 500) THEN
    RAISE EXCEPTION 'La nota del alta es demasiado larga' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  v_pt := public.hx_care_patient(p_id, v_inst, true);
  IF v_pt.status = 'discharged' THEN
    RETURN to_jsonb(v_pt);
  END IF;

  UPDATE public.inst_cases
     SET status = CASE WHEN p_outcome = 'withdrawn' THEN 'cancelled' ELSE 'completed' END, outcome = p_outcome
   WHERE patient_id = v_pt.id AND status IN ('pending', 'active');
  GET DIAGNOSTICS v_n_c = ROW_COUNT;
  UPDATE public.inst_tasks SET status = 'skipped' WHERE patient_id = v_pt.id AND status = 'open';
  UPDATE public.inst_alerts
     SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = public.hx_care_actor_name(),
         resolution = 'other', resolve_note = 'Alta del paciente'
   WHERE patient_id = v_pt.id AND status <> 'resolved';
  UPDATE public.inst_devices SET status = 'revoked' WHERE patient_id = v_pt.id AND status = 'active';
  UPDATE public.inst_patients SET status = 'discharged' WHERE id = v_pt.id RETURNING * INTO v_new;

  v_label := CASE p_outcome WHEN 'recovered' THEN 'recuperado' WHEN 'stable' THEN 'estable' WHEN 'referred' THEN 'remitido a otro servicio'
                            WHEN 'withdrawn' THEN 'retiro del servicio' WHEN 'deceased' THEN 'fallecimiento' ELSE 'otro motivo' END;
  PERFORM public.hx_care_note(v_inst, v_pt.id, NULL, 'coordination',
                              'Alta del paciente (' || v_label || ').' || COALESCE(' ' || NULLIF(btrim(p_note), ''), ''));
  PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'patient_discharged', jsonb_build_object('outcome', p_outcome, 'cases_closed', v_n_c));
  RETURN to_jsonb(v_new);
END
$fn$;

-- Escala 2 de SpO₂ (meta 88–92 %): solo por indicación médica, con constancia del motivo en la historia.
CREATE OR REPLACE FUNCTION public.inst_patient_set_scale(p_id uuid, p_scale integer, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_pt   public.inst_patients;
  v_new  public.inst_patients;
BEGIN
  IF p_scale IS NULL OR p_scale NOT IN (1, 2) THEN
    RAISE EXCEPTION 'La escala de SpO₂ es 1 o 2' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF p_scale = 2 AND char_length(btrim(COALESCE(p_reason, ''))) < 8 THEN
    RAISE EXCEPTION 'La escala 2 se usa solo por indicación médica: escribe la indicación' USING ERRCODE = '23514', HINT = 'reason_required';
  END IF;
  IF NOT public.hx_text_ok(p_reason, 300) THEN
    RAISE EXCEPTION 'El motivo es demasiado largo' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  v_pt := public.hx_care_patient(p_id, v_inst, true);
  IF v_pt.spo2_scale = p_scale THEN
    RETURN to_jsonb(v_pt);
  END IF;
  UPDATE public.inst_patients SET spo2_scale = p_scale WHERE id = v_pt.id RETURNING * INTO v_new;
  PERFORM public.hx_care_note(v_inst, v_pt.id, NULL, 'evolution',
    'Escala de saturación (SpO₂) cambiada a la ' || p_scale || '.' || COALESCE(' Indicación: ' || NULLIF(btrim(p_reason), ''), ''));
  PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'scale_changed', jsonb_build_object('from', v_pt.spo2_scale, 'to', p_scale));
  RETURN to_jsonb(v_new);
END
$fn$;

-- Postulaciones aceptadas que todavía no tienen caso («acepta una postulación para iniciar coordinación»).
CREATE OR REPLACE FUNCTION public.inst_accepted_applications()
RETURNS TABLE (
  application_id uuid, offer_id uuid, offer_title text, professional_id uuid, professional_label text, proposed_amount integer, accepted_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_free boolean := public.plan_key_for(v_inst) = 'free';
BEGIN
  RETURN QUERY
  SELECT a.id, o.id, o.title, a.professional_id, public.hx_pro_label(pr.full_name, v_free), a.proposed_amount, a.updated_at
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    LEFT JOIN public.profiles pr ON pr.user_id = a.professional_id
   WHERE o.posted_by = v_inst AND a.status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM public.inst_cases c WHERE c.application_id = a.id)
   ORDER BY a.updated_at DESC
   LIMIT 50;
END
$fn$;

-- Casos ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inst_case_open(p_patient uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_pt   public.inst_patients;
  v_case public.inst_cases;
  v_con  text;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  v_pt := public.hx_care_patient(p_patient, v_inst, true);
  IF v_pt.status = 'discharged' THEN
    RAISE EXCEPTION 'El paciente ya tiene el alta: reactívalo para abrir un caso' USING ERRCODE = '23514', HINT = 'patient_discharged';
  END IF;
  BEGIN
    v_case := public.hx_care_case_insert(v_inst, v_pt.id, p_data, public.hx_care_plan(v_inst));
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'inst_cases_application_uq' THEN
        RAISE EXCEPTION 'Esa postulación ya tiene un caso' USING ERRCODE = '23505', HINT = 'application_used';
      END IF;
      RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Revisa los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data';
  END;
  RETURN to_jsonb(v_case);
END
$fn$;

CREATE OR REPLACE FUNCTION public.inst_case_update(p_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_case public.inst_cases;
  v_new  public.inst_cases;
  v_con  text;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  SELECT * INTO v_case FROM public.inst_cases WHERE id = p_id AND institution_id = v_inst FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos ese caso' USING ERRCODE = 'P0002', HINT = 'not_found';
  END IF;
  IF v_case.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Un caso cerrado no se modifica: abre uno nuevo' USING ERRCODE = '23514', HINT = 'case_closed';
  END IF;
  IF p_data ? 'status' AND COALESCE(p_data ->> 'status', '') NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'Para cerrar un caso usa la acción «Cerrar caso»' USING ERRCODE = '23514', HINT = 'use_close';
  END IF;
  BEGIN
    UPDATE public.inst_cases SET
      title              = CASE WHEN p_data ? 'title'              THEN btrim(p_data ->> 'title') ELSE title END,
      care_type          = CASE WHEN p_data ? 'care_type'          THEN COALESCE(NULLIF(p_data ->> 'care_type', ''), care_type) ELSE care_type END,
      priority           = CASE WHEN p_data ? 'priority'           THEN COALESCE(NULLIF(p_data ->> 'priority', ''), priority) ELSE priority END,
      status             = CASE WHEN p_data ? 'status'             THEN p_data ->> 'status' ELSE status END,
      target_end_at      = CASE WHEN p_data ? 'target_end_at'      THEN NULLIF(p_data ->> 'target_end_at', '')::timestamptz ELSE target_end_at END,
      summary            = CASE WHEN p_data ? 'summary'            THEN NULLIF(btrim(p_data ->> 'summary'), '') ELSE summary END,
      professional_label = CASE WHEN p_data ? 'professional_label' AND application_id IS NULL
                                THEN NULLIF(btrim(p_data ->> 'professional_label'), '') ELSE professional_label END
    WHERE id = v_case.id
    RETURNING * INTO v_new;
    PERFORM public.hx_care_log(v_inst, v_case.patient_id, v_case.id, 'case_updated',
                               jsonb_build_object('fields', COALESCE((SELECT jsonb_agg(k) FROM jsonb_object_keys(p_data) AS k), '[]'::jsonb)));
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Revisa los datos del caso' USING ERRCODE = '23514', HINT = 'invalid_data';
  END;
  RETURN to_jsonb(v_new);
END
$fn$;

-- Cierra un caso: completado (con desenlace y, si hay, la valoración del servicio) o cancelado.
CREATE OR REPLACE FUNCTION public.inst_case_close(
  p_id uuid, p_status text, p_outcome text DEFAULT NULL, p_satisfaction integer DEFAULT NULL, p_by text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst    uuid := public.hx_care_need('pacientes');
  v_case    public.inst_cases;
  v_new     public.inst_cases;
  v_pt      public.inst_patients;
  v_outcome text;
  v_con     text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Un caso se cierra como completado o cancelado' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF p_satisfaction IS NOT NULL AND p_status <> 'completed' THEN
    RAISE EXCEPTION 'Solo un caso completado puede valorarse' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  SELECT * INTO v_case FROM public.inst_cases WHERE id = p_id AND institution_id = v_inst FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos ese caso' USING ERRCODE = 'P0002', HINT = 'not_found';
  END IF;
  IF v_case.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Ese caso ya estaba cerrado' USING ERRCODE = '23514', HINT = 'case_closed';
  END IF;
  v_outcome := COALESCE(NULLIF(p_outcome, ''), CASE WHEN p_status = 'completed' THEN 'stable' ELSE 'withdrawn' END);
  BEGIN
    UPDATE public.inst_cases
       SET status = p_status, outcome = v_outcome, satisfaction = p_satisfaction,
           satisfaction_by = CASE WHEN p_satisfaction IS NULL THEN NULL ELSE COALESCE(NULLIF(p_by, ''), 'coordinator') END,
           satisfaction_note = CASE WHEN p_satisfaction IS NULL THEN NULL ELSE NULLIF(btrim(p_note), '') END
     WHERE id = v_case.id
     RETURNING * INTO v_new;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los datos del cierre' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
  END;
  UPDATE public.inst_tasks SET status = 'skipped' WHERE case_id = v_case.id AND status = 'open';

  SELECT * INTO v_pt FROM public.inst_patients WHERE id = v_case.patient_id;
  IF p_status = 'completed' AND v_pt.status = 'active' AND COALESCE((public.hx_care_plan(v_inst) ->> 'followups')::boolean, false) THEN
    INSERT INTO public.inst_tasks (institution_id, patient_id, case_id, title, kind, due_at, source, created_by)
    VALUES (v_inst, v_case.patient_id, v_case.id, 'Llamada de seguimiento a los 7 días del cierre', 'call', now() + interval '7 days', 'auto_followup', auth.uid());
  END IF;

  PERFORM public.hx_care_note(v_inst, v_case.patient_id, v_case.id, 'coordination',
                              'Caso «' || v_case.title || '» cerrado como ' || CASE WHEN p_status = 'completed' THEN 'completado' ELSE 'cancelado' END || '.');
  PERFORM public.hx_care_log(v_inst, v_case.patient_id, v_case.id, 'case_closed',
                             jsonb_build_object('status', p_status, 'outcome', v_outcome, 'rated', p_satisfaction IS NOT NULL));
  RETURN to_jsonb(v_new);
END
$fn$;

-- Valoración del servicio de un caso completado (de la persona atendida, de la familia o de quien coordina).
CREATE OR REPLACE FUNCTION public.inst_case_rate(p_id uuid, p_satisfaction integer, p_by text DEFAULT 'coordinator', p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('pacientes');
  v_case public.inst_cases;
  v_new  public.inst_cases;
  v_con  text;
BEGIN
  SELECT * INTO v_case FROM public.inst_cases WHERE id = p_id AND institution_id = v_inst FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos ese caso' USING ERRCODE = 'P0002', HINT = 'not_found';
  END IF;
  IF v_case.status <> 'completed' THEN
    RAISE EXCEPTION 'Solo un caso completado puede valorarse' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  BEGIN
    UPDATE public.inst_cases
       SET satisfaction = p_satisfaction, satisfaction_by = COALESCE(NULLIF(p_by, ''), 'coordinator'), satisfaction_note = NULLIF(btrim(p_note), '')
     WHERE id = v_case.id
     RETURNING * INTO v_new;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'La valoración es de 1 a 5 estrellas' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
  END;
  PERFORM public.hx_care_log(v_inst, v_case.patient_id, v_case.id, 'case_rated', jsonb_build_object('by', v_new.satisfaction_by));
  RETURN to_jsonb(v_new);
END
$fn$;

-- Notas ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inst_note_add(
  p_patient uuid, p_kind text, p_body text, p_case uuid DEFAULT NULL, p_vitals jsonb DEFAULT NULL, p_corrects uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst   uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_pt     public.inst_patients;
  v_note   public.inst_notes;
  v_body   text := btrim(COALESCE(p_body, ''));
  v_vitals jsonb;
  v_con    text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('evolution', 'nursing', 'coordination', 'family', 'incident', 'correction') THEN
    RAISE EXCEPTION 'Tipo de nota no válido' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF char_length(v_body) < 2 THEN
    RAISE EXCEPTION 'Escribe la nota' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = 'body';
  END IF;
  v_pt := public.hx_care_patient(p_patient, v_inst, false);
  IF p_vitals IS NOT NULL THEN
    IF jsonb_typeof(p_vitals) <> 'object' THEN
      RAISE EXCEPTION 'Los signos de la nota no son válidos' USING ERRCODE = '23514', HINT = 'invalid_data';
    END IF;
    SELECT jsonb_object_agg(k, p_vitals -> k) INTO v_vitals
      FROM unnest(ARRAY['hr', 'rr', 'spo2', 'sbp', 'dbp', 'temp_c', 'news2']) AS k
     WHERE jsonb_typeof(p_vitals -> k) = 'number';
  END IF;
  BEGIN
    v_note := public.hx_care_note(v_inst, v_pt.id, p_case, p_kind, v_body, v_vitals, p_corrects);
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa la nota (hasta 4.000 caracteres, sin caracteres de control)' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
  END;
  PERFORM public.hx_care_log(v_inst, v_pt.id, p_case, 'note_added', jsonb_build_object('kind', p_kind, 'seq', v_note.seq));
  RETURN to_jsonb(v_note);
END
$fn$;

-- ¿La cadena de notas está íntegra? Recalcula la firma de cada una y las enlaces.
CREATE OR REPLACE FUNCTION public.inst_verify_notes(p_patient uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_pt   public.inst_patients := public.hx_care_patient(p_patient, v_inst, false);
  n      record;
  v_prev text := repeat('0', 64);
  v_seq  integer := 1;
  v_n    integer := 0;
  v_bad  integer;
BEGIN
  FOR n IN SELECT * FROM public.inst_notes WHERE patient_id = v_pt.id ORDER BY seq LOOP
    v_n := v_n + 1;
    IF n.seq <> v_seq OR n.prev_hash <> v_prev
       OR n.hash <> public.hx_sha256(public.hx_inst_note_payload(n.prev_hash, n.seq, n.patient_id, n.author_id, n.kind, n.created_at, n.body, n.vitals)) THEN
      v_bad := n.seq;
      EXIT;
    END IF;
    v_prev := n.hash;
    v_seq := v_seq + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', v_bad IS NULL, 'checked', v_n, 'first_bad_seq', v_bad);
END
$fn$;

-- Tareas ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inst_task_add(
  p_patient uuid, p_title text, p_kind text DEFAULT 'other', p_due_at timestamptz DEFAULT NULL, p_case uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_pt   public.inst_patients := public.hx_care_patient(p_patient, v_inst, false);
  v_task public.inst_tasks;
  v_con  text;
BEGIN
  IF v_pt.status = 'discharged' THEN
    RAISE EXCEPTION 'El paciente ya tiene el alta' USING ERRCODE = '23514', HINT = 'patient_discharged';
  END IF;
  BEGIN
    INSERT INTO public.inst_tasks (institution_id, patient_id, case_id, title, kind, due_at, created_by)
    VALUES (v_inst, v_pt.id, p_case, btrim(COALESCE(p_title, '')), COALESCE(NULLIF(p_kind, ''), 'other'),
            COALESCE(p_due_at, now() + interval '1 day'), auth.uid())
    RETURNING * INTO v_task;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa la tarea' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
  END;
  PERFORM public.hx_care_log(v_inst, v_pt.id, p_case, 'task_added', jsonb_build_object('kind', v_task.kind));
  RETURN to_jsonb(v_task);
END
$fn$;

CREATE OR REPLACE FUNCTION public.inst_task_done(p_id uuid, p_status text DEFAULT 'done')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_task public.inst_tasks;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('done', 'skipped') THEN
    RAISE EXCEPTION 'Estado no válido' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  UPDATE public.inst_tasks
     SET status = p_status, completed_by = auth.uid(), completed_name = public.hx_care_actor_name()
   WHERE id = p_id AND institution_id = v_inst AND status = 'open'
   RETURNING * INTO v_task;
  IF v_task.id IS NULL THEN
    SELECT * INTO v_task FROM public.inst_tasks WHERE id = p_id AND institution_id = v_inst;
    IF v_task.id IS NULL THEN
      RAISE EXCEPTION 'No encontramos esa tarea' USING ERRCODE = 'P0002', HINT = 'not_found';
    END IF;
    RETURN to_jsonb(v_task);   -- ya estaba hecha (dos personas la marcaron a la vez)
  END IF;
  PERFORM public.hx_care_log(v_inst, v_task.patient_id, v_task.case_id, 'task_done',
                             jsonb_build_object('kind', v_task.kind, 'status', p_status, 'on_time', now() <= v_task.due_at));
  RETURN to_jsonb(v_task);
END
$fn$;

-- ── 6) Monitoreo: controles, alertas y dispositivos ──────────────────────────────

-- Pone o saca a un paciente del monitoreo (con el límite del plan). El primer control queda pendiente desde ya.
CREATE OR REPLACE FUNCTION public.inst_monitoring_set(p_patient uuid, p_on boolean, p_modality text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  v_pt   public.inst_patients;
  v_new  public.inst_patients;
  v_plan jsonb;
BEGIN
  IF p_modality IS NOT NULL AND p_modality NOT IN ('hospital', 'remote', 'postop', 'chronic', 'elder') THEN
    RAISE EXCEPTION 'Modalidad no válida' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inst_care:' || v_inst::text, 0));
  v_pt := public.hx_care_patient(p_patient, v_inst, true);
  IF COALESCE(p_on, false) THEN
    IF v_pt.status <> 'active' THEN
      RAISE EXCEPTION 'El paciente debe estar activo para monitorearlo' USING ERRCODE = '23514', HINT = 'patient_not_active';
    END IF;
    IF NOT v_pt.monitoring THEN
      v_plan := public.hx_care_plan(v_inst);
      IF (SELECT count(*) FROM public.inst_patients WHERE institution_id = v_inst AND monitoring) >= (v_plan ->> 'monitored')::integer THEN
        RAISE EXCEPTION 'Tu plan permite monitorear hasta % pacientes a la vez.', (v_plan ->> 'monitored')::integer
          USING ERRCODE = '53400', HINT = 'monitor_limit';
      END IF;
    END IF;
  END IF;
  UPDATE public.inst_patients SET monitoring = COALESCE(p_on, false), modality = COALESCE(p_modality, modality)
   WHERE id = v_pt.id RETURNING * INTO v_new;
  IF v_new.monitoring THEN
    INSERT INTO public.inst_live (patient_id, institution_id, next_obs_due_at) VALUES (v_new.id, v_inst, now()) ON CONFLICT (patient_id) DO NOTHING;
  END IF;
  IF v_new.monitoring IS DISTINCT FROM v_pt.monitoring THEN
    PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, CASE WHEN v_new.monitoring THEN 'monitoring_on' ELSE 'monitoring_off' END,
                               jsonb_build_object('modality', v_new.modality));
  END IF;
  RETURN to_jsonb(v_new);
END
$fn$;

-- Registra un control de signos vitales (a mano). El NEWS2 y las alertas salen solos de la base de datos.
CREATE OR REPLACE FUNCTION public.inst_vitals_record(p_patient uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  v_pt   public.inst_patients;
  o      public.inst_obs;
  v_con  text;
  v_hr   numeric := public.hx_json_num(p_data, 'hr');
  v_rr   numeric := public.hx_json_num(p_data, 'rr');
  v_spo2 numeric := public.hx_json_num(p_data, 'spo2');
  v_sbp  numeric := public.hx_json_num(p_data, 'sbp');
  v_dbp  numeric := public.hx_json_num(p_data, 'dbp');
  v_temp numeric := public.hx_json_num(p_data, 'temp_c');
  v_pain numeric := public.hx_json_num(p_data, 'pain');
  v_avpu text;
  v_o2   boolean;
  v_fall boolean;
  v_at   timestamptz;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los signos vitales' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  v_pt := public.hx_care_patient(p_patient, v_inst, false);
  IF NOT v_pt.monitoring THEN
    RAISE EXCEPTION 'El paciente no está en monitoreo' USING ERRCODE = '23514', HINT = 'not_monitored';
  END IF;
  v_avpu := NULLIF(p_data ->> 'avpu', '');
  v_o2   := CASE WHEN jsonb_typeof(p_data -> 'on_o2') = 'boolean' THEN (p_data ->> 'on_o2')::boolean END;
  v_fall := COALESCE(CASE WHEN jsonb_typeof(p_data -> 'fall') = 'boolean' THEN (p_data ->> 'fall')::boolean END, false);
  IF v_hr IS NULL AND v_rr IS NULL AND v_spo2 IS NULL AND v_sbp IS NULL AND v_dbp IS NULL AND v_temp IS NULL
     AND v_pain IS NULL AND v_avpu IS NULL AND NOT v_fall THEN
    RAISE EXCEPTION 'Escribe al menos un valor' USING ERRCODE = '23514', HINT = 'empty_vitals';
  END IF;
  BEGIN
    v_at := CASE WHEN NULLIF(p_data ->> 'recorded_at', '') IS NULL THEN now() ELSE (p_data ->> 'recorded_at')::timestamptz END;
    INSERT INTO public.inst_obs (institution_id, patient_id, recorded_at, source, hr, rr, spo2, on_o2, sbp, dbp, temp_c, avpu, pain, fall,
                                 note, recorded_by, recorded_by_name)
    VALUES (v_inst, v_pt.id, v_at, 'manual', round(v_hr)::smallint, round(v_rr)::smallint, round(v_spo2, 1), v_o2, round(v_sbp)::smallint,
            round(v_dbp)::smallint, round(v_temp, 1), v_avpu, round(v_pain)::smallint, v_fall, NULLIF(btrim(p_data ->> 'note'), ''),
            auth.uid(), public.hx_care_actor_name())
    RETURNING * INTO o;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa los valores (alguno está fuera del rango posible)' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
    WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Revisa los valores del control' USING ERRCODE = '23514', HINT = 'invalid_data';
  END;
  PERFORM public.hx_inst_escalate(v_inst);
  RETURN jsonb_build_object(
    'obs', to_jsonb(o) - 'institution_id',
    'alert', (SELECT to_jsonb(a) FROM public.inst_alerts a
               WHERE a.patient_id = v_pt.id AND a.status <> 'resolved'
               ORDER BY CASE a.severity WHEN 'critical' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END DESC, a.opened_at DESC LIMIT 1));
END
$fn$;

-- «Ya lo vi» (quedan constancia de quién y cuándo, y el plazo deja de correr).
CREATE OR REPLACE FUNCTION public.inst_alert_ack(p_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  a      public.inst_alerts;
BEGIN
  IF NOT public.hx_text_ok(p_note, 300) THEN
    RAISE EXCEPTION 'La nota es demasiado larga' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  UPDATE public.inst_alerts
     SET status = 'acknowledged', acked_at = now(), acked_by = auth.uid(), acked_by_name = public.hx_care_actor_name(), ack_note = NULLIF(btrim(p_note), '')
   WHERE id = p_id AND institution_id = v_inst AND status = 'open'
   RETURNING * INTO a;
  IF a.id IS NULL THEN
    SELECT * INTO a FROM public.inst_alerts WHERE id = p_id AND institution_id = v_inst;
    IF a.id IS NULL THEN
      RAISE EXCEPTION 'No encontramos esa alerta' USING ERRCODE = 'P0002', HINT = 'not_found';
    END IF;
    RETURN to_jsonb(a);   -- otra persona ya la había visto
  END IF;
  PERFORM public.hx_care_log(v_inst, a.patient_id, NULL, 'alert_ack',
                             jsonb_build_object('alert', a.id, 'severity', a.severity, 'on_time', a.acked_at <= a.due_ack_at,
                                                'seconds', round(extract(epoch FROM a.acked_at - a.opened_at))));
  RETURN to_jsonb(a);
END
$fn$;

CREATE OR REPLACE FUNCTION public.inst_alert_resolve(p_id uuid, p_resolution text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  a      public.inst_alerts;
BEGIN
  IF p_resolution IS NULL OR p_resolution NOT IN ('treated', 'false_alarm', 'transferred', 'other') THEN
    RAISE EXCEPTION 'Indica cómo se resolvió' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  IF NOT public.hx_text_ok(p_note, 300) THEN
    RAISE EXCEPTION 'La nota es demasiado larga' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  UPDATE public.inst_alerts
     SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = public.hx_care_actor_name(),
         resolution = p_resolution, resolve_note = NULLIF(btrim(p_note), ''),
         acked_at = COALESCE(acked_at, now()), acked_by = COALESCE(acked_by, auth.uid()),
         acked_by_name = COALESCE(acked_by_name, public.hx_care_actor_name())
   WHERE id = p_id AND institution_id = v_inst AND status <> 'resolved'
   RETURNING * INTO a;
  IF a.id IS NULL THEN
    SELECT * INTO a FROM public.inst_alerts WHERE id = p_id AND institution_id = v_inst;
    IF a.id IS NULL THEN
      RAISE EXCEPTION 'No encontramos esa alerta' USING ERRCODE = 'P0002', HINT = 'not_found';
    END IF;
    RETURN to_jsonb(a);
  END IF;
  PERFORM public.hx_care_log(v_inst, a.patient_id, NULL, 'alert_resolved', jsonb_build_object('alert', a.id, 'resolution', p_resolution));
  RETURN to_jsonb(a);
END
$fn$;

-- La pantalla de monitoreo la pide a la hora exacta en que vence el plazo de una alerta sin atender.
CREATE OR REPLACE FUNCTION public.inst_escalate_due()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN public.hx_inst_escalate(public.hx_care_need('monitoreo'));
END
$fn$;

-- Dispositivos ────────────────────────────────────────────────────────────────

-- Empareja un dispositivo con un paciente. El código (122 bits) se muestra UNA vez: aquí solo queda su huella.
CREATE OR REPLACE FUNCTION public.inst_device_create(p_patient uuid, p_label text, p_kind text DEFAULT 'smartwatch')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  v_pt   public.inst_patients;
  v_plan jsonb;
  v_code text;
  d      public.inst_devices;
  v_con  text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inst_care:' || v_inst::text, 0));
  v_plan := public.hx_care_plan(v_inst);
  IF (v_plan ->> 'devices')::integer <= 0 THEN
    RAISE EXCEPTION 'Conectar dispositivos es parte del plan IPS Mejorado' USING ERRCODE = '53400', HINT = 'devices_plan';
  END IF;
  IF (SELECT count(*) FROM public.inst_devices WHERE institution_id = v_inst AND status = 'active') >= (v_plan ->> 'devices')::integer THEN
    RAISE EXCEPTION 'Llegaste al máximo de % dispositivos activos.', (v_plan ->> 'devices')::integer USING ERRCODE = '53400', HINT = 'device_limit';
  END IF;
  v_pt := public.hx_care_patient(p_patient, v_inst, false);
  IF v_pt.status <> 'active' OR NOT v_pt.monitoring THEN
    RAISE EXCEPTION 'Pon al paciente en monitoreo antes de emparejar un dispositivo' USING ERRCODE = '23514', HINT = 'not_monitored';
  END IF;
  v_code := 'hx_' || replace(gen_random_uuid()::text, '-', '');
  BEGIN
    INSERT INTO public.inst_devices (institution_id, patient_id, label, kind, code_hash, code_hint, created_by)
    VALUES (v_inst, v_pt.id, btrim(COALESCE(p_label, '')), COALESCE(NULLIF(p_kind, ''), 'smartwatch'), public.hx_sha256(v_code), right(v_code, 4), auth.uid())
    RETURNING * INTO d;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF COALESCE(v_con, '') = '' THEN RAISE; END IF;   -- sin restricción de por medio: es un error propio, se deja como está
      RAISE EXCEPTION 'Revisa el nombre del dispositivo' USING ERRCODE = '23514', HINT = 'invalid_data', DETAIL = v_con;
  END;
  PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'device_created', jsonb_build_object('kind', d.kind));
  RETURN jsonb_build_object('device', to_jsonb(d) - 'code_hash', 'code', v_code);
END
$fn$;

CREATE OR REPLACE FUNCTION public.inst_device_revoke(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need('monitoreo');
  d      public.inst_devices;
BEGIN
  UPDATE public.inst_devices SET status = 'revoked' WHERE id = p_id AND institution_id = v_inst AND status = 'active' RETURNING * INTO d;
  IF d.id IS NULL THEN
    SELECT * INTO d FROM public.inst_devices WHERE id = p_id AND institution_id = v_inst;
    IF d.id IS NULL THEN
      RAISE EXCEPTION 'No encontramos ese dispositivo' USING ERRCODE = 'P0002', HINT = 'not_found';
    END IF;
  ELSE
    PERFORM public.hx_care_log(v_inst, d.patient_id, NULL, 'device_revoked', '{}'::jsonb);
  END IF;
  RETURN to_jsonb(d) - 'code_hash';
END
$fn$;

-- Huella de la IP de quien llama (nunca la IP). Cloudflare la pone en cf-connecting-ip y no se puede falsear desde fuera; si falta se usa
-- el último valor de x-forwarded-for (el que agrega el proxy más cercano). Sin ninguno, un solo grupo («sin-ip»).
CREATE OR REPLACE FUNCTION public.hx_ingest_ip_hash()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  h   jsonb;
  ip  text;
  xff text[];
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    h := NULL;
  END;
  ip := NULLIF(btrim(COALESCE(h ->> 'cf-connecting-ip', '')), '');
  IF ip IS NULL THEN
    xff := string_to_array(COALESCE(h ->> 'x-forwarded-for', ''), ',');
    IF array_length(xff, 1) IS NOT NULL THEN
      ip := NULLIF(btrim(xff[array_length(xff, 1)]), '');
    END IF;
  END IF;
  RETURN public.hx_sha256('hx-ingest|' || COALESCE(ip, 'sin-ip'));
END
$fn$;

-- Limpieza: las lecturas crudas de dispositivos se conservan 30 días (los controles manuales y las alertas, siempre) y los intentos fallidos,
-- un día. Se llaman de vez en cuando desde la ingesta (no hay tarea programada) y se pueden llamar a mano con la llave de servicio.
CREATE OR REPLACE FUNCTION public.hx_inst_purge_device_obs(p_inst uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.inst_obs
   WHERE id IN (SELECT x.id FROM public.inst_obs x
                 WHERE x.institution_id = p_inst AND x.source = 'device' AND x.recorded_at < now() - interval '30 days' LIMIT 500);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

CREATE OR REPLACE FUNCTION public.hx_inst_purge_failures()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.inst_ingest_failures WHERE at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

-- Lo que corre cada noche (pg_cron): intentos fallidos viejos y lecturas crudas de dispositivos de más de 30 días de todas las instituciones.
CREATE OR REPLACE FUNCTION public.hx_inst_purge_all()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r record;
  n integer := public.hx_inst_purge_failures();
BEGIN
  FOR r IN SELECT DISTINCT o.institution_id FROM public.inst_obs o WHERE o.source = 'device' AND o.recorded_at < now() - interval '30 days' LIMIT 100 LOOP
    n := n + public.hx_inst_purge_device_obs(r.institution_id);
  END LOOP;
  RETURN n;
END
$fn$;

-- Lo que llama el dispositivo (sin sesión). Frena a quien falla muchas veces; guarda como mucho una lectura por minuto (las caídas siempre
-- pasan); descarta valores imposibles en vez de rechazar toda la lectura. Devuelve poco: quien tiene el código solo envía.
CREATE OR REPLACE FUNCTION public.inst_device_ingest(p_code text, p_reading jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ip   text := public.hx_ingest_ip_hash();
  d      public.inst_devices;
  pt     public.inst_patients;
  v_plan jsonb;
  v_at   timestamptz := now();
  n_hr   numeric := public.hx_json_num(p_reading, 'hr');
  n_rr   numeric := public.hx_json_num(p_reading, 'rr');
  n_sp   numeric := public.hx_json_num(p_reading, 'spo2');
  n_sbp  numeric := public.hx_json_num(p_reading, 'sbp');
  n_dbp  numeric := public.hx_json_num(p_reading, 'dbp');
  n_t    numeric := public.hx_json_num(p_reading, 'temp_c');
  v_fall boolean := COALESCE(CASE WHEN jsonb_typeof(p_reading -> 'fall') = 'boolean' THEN (p_reading ->> 'fall')::boolean END, false);
  o_id   uuid;
BEGIN
  IF (SELECT count(*) FROM public.inst_ingest_failures f WHERE f.scope = 'device' AND f.ip_hash = v_ip AND f.at > now() - interval '10 minutes') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF p_code IS NOT NULL AND p_code ~ '^hx_[0-9a-f]{32}$' THEN
    SELECT * INTO d FROM public.inst_devices WHERE code_hash = public.hx_sha256(p_code);
  END IF;
  IF d.id IS NULL OR d.status <> 'active' THEN
    INSERT INTO public.inst_ingest_failures (scope, ip_hash) VALUES ('device', v_ip);
    IF random() < 0.02 THEN
      PERFORM public.hx_inst_purge_failures();
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF p_reading IS NULL OR jsonb_typeof(p_reading) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reading');
  END IF;

  SELECT * INTO pt FROM public.inst_patients WHERE id = d.patient_id;
  IF pt.id IS NULL OR pt.status <> 'active' OR NOT pt.monitoring THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_monitored');
  END IF;
  v_plan := public.hx_care_plan(d.institution_id);
  IF (v_plan ->> 'devices')::integer <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan');
  END IF;
  IF NOT v_fall AND d.last_ingest_at IS NOT NULL AND d.last_ingest_at > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  IF jsonb_typeof(p_reading -> 'recorded_at') = 'string' THEN
    BEGIN
      v_at := (p_reading ->> 'recorded_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_at := now();
    END;
    IF v_at > now() + interval '5 minutes' OR v_at < now() - interval '1 hour' THEN
      v_at := now();
    END IF;
  END IF;
  -- Un valor imposible (reloj mal puesto, sensor suelto) se descarta; los demás de la lectura se conservan.
  n_hr  := CASE WHEN n_hr  BETWEEN 20 AND 300 THEN round(n_hr)  END;
  n_rr  := CASE WHEN n_rr  BETWEEN 4 AND 70   THEN round(n_rr)  END;
  n_sp  := CASE WHEN n_sp  BETWEEN 50 AND 100 THEN round(n_sp, 1) END;
  n_sbp := CASE WHEN n_sbp BETWEEN 40 AND 300 THEN round(n_sbp) END;
  n_dbp := CASE WHEN n_dbp BETWEEN 20 AND 200 THEN round(n_dbp) END;
  n_t   := CASE WHEN n_t   BETWEEN 25 AND 45  THEN round(n_t, 1) END;
  IF n_hr IS NULL AND n_rr IS NULL AND n_sp IS NULL AND n_sbp IS NULL AND n_dbp IS NULL AND n_t IS NULL AND NOT v_fall THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_reading');
  END IF;

  INSERT INTO public.inst_obs (institution_id, patient_id, recorded_at, source, hr, rr, spo2, sbp, dbp, temp_c, fall, recorded_by_name, device_id)
  VALUES (d.institution_id, d.patient_id, v_at, 'device', n_hr::smallint, n_rr::smallint, n_sp, n_sbp::smallint, n_dbp::smallint, n_t, v_fall,
          d.label, d.id)
  RETURNING id INTO o_id;
  UPDATE public.inst_devices SET last_ingest_at = now() WHERE id = d.id;

  PERFORM public.hx_inst_escalate(d.institution_id);
  IF random() < 0.005 THEN
    PERFORM public.hx_inst_purge_device_obs(d.institution_id);
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$fn$;

-- ── 7) Relevo de turno, exportación y resumen ────────────────────────────────────

-- Guarda en la historia de cada paciente el relevo de turno (I-PASS: gravedad, resumen, acciones, qué hacer si cambia). Plan IPS Mejorado.
CREATE OR REPLACE FUNCTION public.inst_handoff_commit(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst   uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_plan   jsonb := public.hx_care_plan(v_inst);
  it       jsonb;
  v_pt     public.inst_patients;
  v_ill    text;
  v_label  text;
  v_sum    text;
  v_act    text;
  v_con    text;
  v_n      integer := 0;
BEGIN
  IF NOT COALESCE((v_plan ->> 'handoff')::boolean, false) THEN
    RAISE EXCEPTION 'Guardar el relevo de turno en la historia es parte del plan IPS Mejorado' USING ERRCODE = '53400', HINT = 'handoff_plan';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'El relevo debe incluir entre 1 y 150 pacientes' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  FOR it IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    v_pt := public.hx_care_patient(NULLIF(it ->> 'patient_id', '')::uuid, v_inst, false);
    IF v_pt.status = 'discharged' THEN
      CONTINUE;
    END IF;
    v_ill := it ->> 'illness';
    IF v_ill IS NULL OR v_ill NOT IN ('stable', 'watcher', 'unstable') THEN
      RAISE EXCEPTION 'Indica la gravedad de cada paciente' USING ERRCODE = '23514', HINT = 'invalid_data';
    END IF;
    v_sum := COALESCE(NULLIF(btrim(it ->> 'summary'), ''), '—');
    v_act := COALESCE(NULLIF(btrim(it ->> 'actions'), ''), '—');
    v_con := COALESCE(NULLIF(btrim(it ->> 'contingency'), ''), '—');
    IF NOT (public.hx_text_ok(v_sum, 600) AND public.hx_text_ok(v_act, 600) AND public.hx_text_ok(v_con, 600)) THEN
      RAISE EXCEPTION 'Alguno de los textos del relevo es demasiado largo' USING ERRCODE = '23514', HINT = 'invalid_data';
    END IF;
    v_label := CASE v_ill WHEN 'stable' THEN 'Estable' WHEN 'watcher' THEN 'En observación' ELSE 'Inestable' END;
    PERFORM public.hx_care_note(v_inst, v_pt.id, NULL, 'handoff',
      'Relevo de turno (I-PASS) · ' || v_label || E'\nResumen: ' || v_sum || E'\nAcciones: ' || v_act || E'\nSi cambia: ' || v_con);
    v_n := v_n + 1;
  END LOOP;
  PERFORM public.hx_care_log(v_inst, NULL, NULL, 'handoff_committed', jsonb_build_object('patients', v_n));
  RETURN jsonb_build_object('ok', true, 'saved', v_n);
END
$fn$;

-- Constancia de que alguien exportó la historia de un paciente (Ley 1581: trazabilidad). Plan IPS Mejorado.
CREATE OR REPLACE FUNCTION public.inst_export_log(p_patient uuid, p_format text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_pt   public.inst_patients := public.hx_care_patient(p_patient, v_inst, false);
BEGIN
  IF NOT COALESCE((public.hx_care_plan(v_inst) ->> 'export')::boolean, false) THEN
    RAISE EXCEPTION 'Exportar la historia es parte del plan IPS Mejorado' USING ERRCODE = '53400', HINT = 'export_plan';
  END IF;
  IF p_format IS NULL OR p_format NOT IN ('fhir', 'csv', 'print') THEN
    RAISE EXCEPTION 'Formato no válido' USING ERRCODE = '23514', HINT = 'invalid_data';
  END IF;
  PERFORM public.hx_care_log(v_inst, v_pt.id, NULL, 'export', jsonb_build_object('format', p_format));
END
$fn$;

-- Cifras del tablero de pacientes y de monitoreo, calculadas en la base (correctas aunque la lista sea larga) y el plan con su uso.
CREATE OR REPLACE FUNCTION public.inst_care_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_inst   uuid := public.hx_care_need_any('pacientes', 'monitoreo');
  v_plan   jsonb := public.hx_care_plan(v_inst);
  v_now    timestamptz := now();
  v_week   timestamptz := now() - interval '7 days';
  v_pat    jsonb;
  v_cases  jsonb;
  v_tasks  jsonb;
  v_mon    jsonb;
  v_alerts jsonb;
  v_imp    jsonb;
  v_streak integer;
  v_dev    integer;
BEGIN
  SELECT jsonb_build_object(
           'total', count(*), 'open', count(*) FILTER (WHERE p.status <> 'discharged'),
           'pending', count(*) FILTER (WHERE p.status = 'pending'), 'active', count(*) FILTER (WHERE p.status = 'active'),
           'paused', count(*) FILTER (WHERE p.status = 'paused'), 'discharged', count(*) FILTER (WHERE p.status = 'discharged'),
           'monitored', count(*) FILTER (WHERE p.monitoring))
    INTO v_pat FROM public.inst_patients p WHERE p.institution_id = v_inst;

  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE c.status = 'active'), 'pending', count(*) FILTER (WHERE c.status = 'pending'),
           'completed', count(*) FILTER (WHERE c.status = 'completed'), 'cancelled', count(*) FILTER (WHERE c.status = 'cancelled'),
           'rated', count(*) FILTER (WHERE c.status = 'completed' AND c.satisfaction IS NOT NULL),
           'avg_satisfaction', round(avg(c.satisfaction) FILTER (WHERE c.status = 'completed' AND c.satisfaction IS NOT NULL), 1))
    INTO v_cases FROM public.inst_cases c WHERE c.institution_id = v_inst;

  SELECT jsonb_build_object('open', count(*) FILTER (WHERE t.status = 'open'),
                            'overdue', count(*) FILTER (WHERE t.status = 'open' AND t.due_at < v_now))
    INTO v_tasks FROM public.inst_tasks t WHERE t.institution_id = v_inst;

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE p.monitoring),
           'online', count(*) FILTER (WHERE p.monitoring AND l.last_device_at > v_now - interval '10 minutes'),
           'overdue', count(*) FILTER (WHERE p.monitoring AND (l.next_obs_due_at IS NULL OR l.next_obs_due_at < v_now)),
           'high_risk', count(*) FILTER (WHERE p.monitoring AND l.last_band IN ('high', 'medium')))
    INTO v_mon FROM public.inst_patients p LEFT JOIN public.inst_live l ON l.patient_id = p.id WHERE p.institution_id = v_inst;

  SELECT jsonb_build_object(
           'open', count(*) FILTER (WHERE a.status <> 'resolved'), 'unacked', count(*) FILTER (WHERE a.status = 'open'),
           'critical', count(*) FILTER (WHERE a.status <> 'resolved' AND a.severity = 'critical'),
           'overdue', count(*) FILTER (WHERE a.status = 'open' AND a.due_ack_at < v_now),
           'false_alarm_30d', count(*) FILTER (WHERE a.resolution = 'false_alarm' AND a.resolved_at >= v_now - interval '30 days'))
    INTO v_alerts FROM public.inst_alerts a WHERE a.institution_id = v_inst;

  SELECT count(*) INTO v_dev FROM public.inst_devices d WHERE d.institution_id = v_inst AND d.status = 'active';

  -- Alertas urgentes/críticas atendidas a tiempo, de la más reciente hacia atrás, hasta la primera que se pasó del plazo.
  WITH recent AS (
    SELECT a.opened_at, (a.acked_at IS NOT NULL AND a.acked_at <= a.due_ack_at) AS ok
      FROM public.inst_alerts a
     WHERE a.institution_id = v_inst AND a.severity IN ('urgent', 'critical')
       AND (a.acked_at IS NOT NULL OR (a.status <> 'resolved' AND a.due_ack_at < v_now))
     ORDER BY a.opened_at DESC LIMIT 200
  ), walk AS (
    SELECT ok, sum((NOT ok)::integer) OVER (ORDER BY opened_at DESC ROWS UNBOUNDED PRECEDING) AS misses FROM recent
  )
  SELECT count(*) INTO v_streak FROM walk WHERE misses = 0;

  SELECT jsonb_build_object(
           'since', v_week,
           'manual_controls', (SELECT count(*) FROM public.inst_obs o WHERE o.institution_id = v_inst AND o.source <> 'device' AND o.recorded_at >= v_week),
           'device_readings', (SELECT count(*) FROM public.inst_obs o WHERE o.institution_id = v_inst AND o.source = 'device' AND o.recorded_at >= v_week),
           'alerts', (SELECT count(*) FROM public.inst_alerts a WHERE a.institution_id = v_inst AND a.opened_at >= v_week),
           'alerts_on_time', (SELECT count(*) FROM public.inst_alerts a WHERE a.institution_id = v_inst AND a.opened_at >= v_week
                                AND a.acked_at IS NOT NULL AND a.acked_at <= a.due_ack_at),
           'median_ack_seconds', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM a.acked_at - a.opened_at)))
                                    FROM public.inst_alerts a WHERE a.institution_id = v_inst AND a.opened_at >= v_week AND a.acked_at IS NOT NULL),
           'tasks_done', (SELECT count(*) FROM public.inst_tasks t WHERE t.institution_id = v_inst AND t.status = 'done' AND t.completed_at >= v_week),
           'notes', (SELECT count(*) FROM public.inst_notes n WHERE n.institution_id = v_inst AND n.created_at >= v_week),
           'cases_completed', (SELECT count(*) FROM public.inst_cases c WHERE c.institution_id = v_inst AND c.status = 'completed' AND c.closed_at >= v_week))
    INTO v_imp;

  RETURN jsonb_build_object(
    'plan', v_plan ->> 'plan', 'limits', v_plan - 'plan',
    'usage', jsonb_build_object('patients', (v_pat ->> 'open')::integer, 'monitored', (v_pat ->> 'monitored')::integer, 'devices', v_dev),
    'patients', v_pat, 'cases', v_cases, 'tasks', v_tasks, 'monitoring', v_mon, 'alerts', v_alerts,
    'impact', v_imp, 'ontime_streak', v_streak, 'generated_at', v_now);
END
$fn$;

-- ── 8) Lectura (RLS), permisos y tiempo real ─────────────────────────────────────
-- Leer: la institución y su personal con el módulo de pacientes o el de monitoreo. Escribir: nadie por la API (solo las funciones de arriba).
-- (SELECT …) hace que el alcance se calcule UNA vez por consulta. El superadmin no lee pacientes: no hay política para él.

CREATE INDEX IF NOT EXISTS inst_devices_inst_idx ON public.inst_devices (institution_id, status);

DO $hx_rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inst_patients', 'inst_cases', 'inst_notes', 'inst_tasks', 'inst_obs', 'inst_alerts', 'inst_devices', 'inst_live', 'inst_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (institution_id = (SELECT public.hx_care_inst(''pacientes'')) OR institution_id = (SELECT public.hx_care_inst(''monitoreo'')))',
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$hx_rls$;

-- La huella del código de un dispositivo no sale por la API: lectura por columnas (la pantalla pide las columnas, no «*»).
REVOKE SELECT ON public.inst_devices FROM authenticated;
GRANT SELECT (id, institution_id, patient_id, label, kind, code_hint, status, last_ingest_at, created_by, created_at, revoked_at)
  ON public.inst_devices TO authenticated;

ALTER TABLE public.inst_ingest_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inst_ingest_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inst_ingest_failures TO service_role;
REVOKE ALL ON SEQUENCE public.inst_ingest_failures_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.inst_ingest_failures_id_seq TO service_role;

-- Funciones: todas cerradas por defecto; se abren solo las que la pantalla (o el dispositivo) llama.
DO $hx_fn$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'inst\_%' ESCAPE '\' OR p.proname LIKE 'hx\_care\_%' ESCAPE '\' OR p.proname LIKE 'hx\_inst\_%' ESCAPE '\'
                   OR p.proname IN ('hx_news2', 'hx_news2_band', 'hx_news2_interval_min', 'hx_text_ok', 'hx_name_ok', 'hx_text_array_ok',
                                    'hx_alert_rank', 'hx_json_num', 'hx_json_texts', 'hx_ingest_ip_hash'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname IN ('hx_care_inst',
                     'inst_patient_create', 'inst_patient_update', 'inst_patient_set_status', 'inst_patient_discharge', 'inst_patient_set_scale',
                     'inst_accepted_applications', 'inst_case_open', 'inst_case_update', 'inst_case_close', 'inst_case_rate',
                     'inst_note_add', 'inst_verify_notes', 'inst_task_add', 'inst_task_done',
                     'inst_monitoring_set', 'inst_vitals_record', 'inst_alert_ack', 'inst_alert_resolve', 'inst_escalate_due',
                     'inst_device_create', 'inst_device_revoke', 'inst_handoff_commit', 'inst_export_log', 'inst_care_overview',
                     'inst_device_ingest') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    IF r.proname = 'inst_device_ingest' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);   -- lo llama el dispositivo, sin sesión: el código es la credencial
    END IF;
  END LOOP;
END
$hx_fn$;

-- Tiempo real: el tablero escucha cambios de pacientes, casos, tareas, alertas, lo último de cada paciente y la bitácora (sin datos de
-- salud). Las notas y las lecturas no se transmiten: se piden cuando la pantalla se entera de que algo cambió.
DO $hx_rt$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que publicar';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['inst_patients', 'inst_cases', 'inst_tasks', 'inst_alerts', 'inst_live', 'inst_events'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo publicar public.%: %', t, SQLERRM;
    END;
  END LOOP;
END
$hx_rt$;

-- Revisión periódica: no depende de que alguien tenga la pantalla abierta. Cada minuto se escalan las alertas vencidas; cada noche se
-- limpia lo viejo. Si pg_cron no está disponible (otro entorno), el escalamiento se revisa cuando entra un control o un dato de un
-- dispositivo y cuando la pantalla de monitoreo lo pide a la hora exacta del vencimiento.
DO $hx_cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL AND to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule('inst-escalate-alerts');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('inst-purge-telemetry');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('inst-escalate-alerts', '* * * * *', 'SELECT public.hx_inst_escalate_all()');
    PERFORM cron.schedule('inst-purge-telemetry', '17 3 * * *', 'SELECT public.hx_inst_purge_all()');
  ELSE
    RAISE NOTICE 'pg_cron no está disponible: el escalamiento de alertas se revisa cuando entra un control y cuando la pantalla de monitoreo lo pide';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo programar la revisión periódica: %', SQLERRM;
END
$hx_cron$;

NOTIFY pgrst, 'reload schema';
