-- ═══════════════════════════════════════════════════════════════════════════════
-- «Lazo de cuidado»: familia ↔ profesional ↔ EPS/IPS en un mismo hilo, con cariño y con evidencia.
--
--   1) Parte del turno (care_logs) de punta a punta. Hasta hoy la familia tenía una línea de tiempo
--      sin ningún productor, y cualquier usuario autenticado podía insertar registros en una reserva
--      ajena. Ahora: solo el profesional del servicio escribe, solo mientras está en curso; la llegada y
--      la salida se registran solas al cambiar el estado; las alertas avisan de inmediato a la familia y
--      a su círculo de cuidado; el círculo y la institución cliente ven el parte; el resumen exige
--      autorización (get_care_summary era legible por cualquiera).
--   2) «Gracias» (care_kudos): reconocimiento cálido entre las partes de un servicio completado. No es una
--      calificación: es lo que hace que el profesional quiera volver y la familia quiera agradecer.
--   3) Trayectoria del profesional (horas, familias que vuelven, racha, gracias): privada y pública.
--   4) Equipo de confianza + plan B: si el profesional cancela, la familia sabe cuántos de su equipo están
--      libres y la institución invita sola a su equipo al turno que se reabrió.
--   5) Historia de cuidado exportable (plan de pago): el plan se lee de mp_subscriptions en el servidor.
--
-- Reglas del proyecto: tablas nuevas con GRANT + RLS en esta misma migración; roles solo en
-- public.user_roles (has_role / is_staff); plan solo desde mp_subscriptions; los pagos ocurren únicamente en
-- la página web (los textos libres que traen datos de contacto o de pago se rechazan).
-- Depende de: 20260606000003 (care_logs), 20261007190000 (care_favorites), 20261007200000 (círculo de
-- cuidado), 20261008200000 (short_display_name, message_has_forbidden_content, plan_key_for) y
-- 20261009100000 (hx_notify, job_offers/offer_team_invites). Espejos en TypeScript: src/lib/{careLog,
-- kudos,careerStats,careLoop,careExport}.ts
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 0) Utilidades internas ────────────────────────────────────────────────────

-- «2 h 15 min» / «45 min» / «3 h»
CREATE OR REPLACE FUNCTION public.hx_duration_label(p_minutes integer)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_minutes IS NULL OR p_minutes < 0 THEN NULL
    WHEN p_minutes < 60 THEN p_minutes || ' min'
    WHEN p_minutes % 60 = 0 THEN (p_minutes / 60) || ' h'
    ELSE (p_minutes / 60) || ' h ' || (p_minutes % 60) || ' min'
  END
$$;

-- Nombre para mostrar a la otra parte: la institución por su razón social; una persona como «María G.».
CREATE OR REPLACE FUNCTION public.party_display_name(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(ip.institution_name), '') FROM public.institution_profiles ip WHERE ip.user_id = p_user),
    (SELECT public.short_display_name(pr.full_name) FROM public.profiles pr WHERE pr.user_id = p_user),
    'Alguien de Humanix'
  )
$$;

-- Quién debe enterarse de lo que pasa en un servicio: el cliente (familia o institución) y su círculo de cuidado
-- (miembros aceptados que pueden ver los servicios).
CREATE OR REPLACE FUNCTION public.care_watchers(p_client uuid)
RETURNS TABLE (watcher_id uuid, is_owner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_client, true
  UNION
  SELECT m.member_id, false
    FROM public.care_circle_members m
   WHERE m.owner_id = p_client
     AND m.status = 'accepted'
     AND m.can_view_services
     AND m.member_id IS NOT NULL
     AND m.member_id <> p_client
$$;

REVOKE ALL ON FUNCTION public.hx_duration_label(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.party_display_name(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_watchers(uuid)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_duration_label(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.party_display_name(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.care_watchers(uuid)        TO service_role;

-- ─── 1) Parte del turno (care_logs) ────────────────────────────────────────────

ALTER TABLE public.care_logs
  ADD COLUMN IF NOT EXISTS mood text,
  ADD COLUMN IF NOT EXISTS system_generated boolean NOT NULL DEFAULT false;

ALTER TABLE public.care_logs DROP CONSTRAINT IF EXISTS care_logs_mood_check;
ALTER TABLE public.care_logs ADD CONSTRAINT care_logs_mood_check
  CHECK (mood IS NULL OR mood IN ('happy', 'calm', 'tired', 'sad', 'pain', 'agitated'));

CREATE INDEX IF NOT EXISTS idx_care_logs_booking_type ON public.care_logs (booking_id, event_type);

-- Bitácora de solo-agregar: nadie edita ni borra un registro clínico desde la API. En producción las tablas
-- heredan privilegios amplios por defecto (ALL para anon y authenticated); se cierran aquí de forma explícita.
REVOKE ALL ON public.care_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.care_logs TO authenticated;
GRANT ALL ON public.care_logs TO service_role;

-- Escribe el profesional del servicio, solo mientras está en curso. La llegada y la salida las genera el
-- sistema (disparador de abajo), no el cliente: una hora de llegada falsificada invalida todo el parte.
DROP POLICY IF EXISTS "care_logs_professional_insert" ON public.care_logs;
CREATE POLICY "care_logs_professional_insert" ON public.care_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    professional_id = auth.uid()
    AND event_type NOT IN ('arrival', 'departure')
    AND EXISTS (
      SELECT 1 FROM public.service_bookings b
       WHERE b.id = care_logs.booking_id
         AND b.professional_id = auth.uid()
         AND b.status = 'in_progress'
    )
  );

-- Los miembros aceptados del círculo de cuidado ven el parte (no lo modifican).
DROP POLICY IF EXISTS "care_logs_circle_read" ON public.care_logs;
CREATE POLICY "care_logs_circle_read" ON public.care_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.service_bookings b
        JOIN public.care_circle_members m ON m.owner_id = b.client_id
       WHERE b.id = care_logs.booking_id
         AND m.member_id = auth.uid()
         AND m.status = 'accepted'
         AND m.can_view_services
    )
  );

-- Guardia: coherencia del registro (profesional correcto, estado correcto, sin contacto ni pagos en el texto).
CREATE OR REPLACE FUNCTION public.care_logs_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sys  boolean := COALESCE(current_setting('app.care_rpc', true), '') = 'on';
  v_uid  uuid := auth.uid();
  -- Rol efectivo de la API (PostgREST hace SET LOCAL ROLE): 'anon', 'authenticated', 'service_role' o 'none'.
  v_role text := COALESCE(NULLIF(current_setting('role', true), ''), 'none');
  b      public.service_bookings%ROWTYPE;
  v_n    integer;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio no encontrado' USING ERRCODE = '23503';
  END IF;

  -- Eventos del sistema (llegada / salida) y código de servidor sin usuario final.
  IF v_sys THEN
    NEW.system_generated := true;
    NEW.professional_id := b.professional_id;
    RETURN NEW;
  END IF;
  IF v_uid IS NULL AND v_role NOT IN ('anon', 'authenticated') THEN
    NEW.professional_id := b.professional_id;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL OR v_uid <> b.professional_id THEN
    RAISE EXCEPTION 'Solo el profesional del servicio puede escribir en el parte del turno' USING ERRCODE = '42501';
  END IF;
  IF NEW.event_type IN ('arrival', 'departure') THEN
    RAISE EXCEPTION 'La llegada y la salida se registran solas al iniciar y finalizar el servicio' USING ERRCODE = '23514';
  END IF;
  IF b.status <> 'in_progress' THEN
    RAISE EXCEPTION 'El parte solo se escribe mientras el servicio está en curso' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_n FROM public.care_logs WHERE booking_id = NEW.booking_id AND NOT system_generated;
  IF v_n >= 200 THEN
    RAISE EXCEPTION 'Este turno ya tiene demasiados registros: agrupa la información en una sola nota' USING ERRCODE = '23514';
  END IF;

  NEW.professional_id    := v_uid;
  NEW.system_generated   := false;
  NEW.notified_at        := NULL;
  NEW.description        := btrim(NEW.description);
  NEW.patient_name       := NULLIF(left(btrim(COALESCE(NEW.patient_name, '')), 80), '');
  NEW.photo_url          := NULL; -- las fotos de pacientes requieren un flujo de consentimiento propio

  IF NEW.event_type = 'incident' THEN
    NEW.is_alert := true;
  END IF;
  IF NEW.is_alert THEN
    NEW.alert_reason := NULLIF(left(btrim(COALESCE(NULLIF(btrim(NEW.alert_reason), ''), NEW.description)), 200), '');
    NEW.notified_at := now();
  ELSE
    NEW.alert_reason := NULL;
    -- Una alerta nunca se bloquea por su contenido: la seguridad del paciente va primero.
    IF public.message_has_forbidden_content(NEW.description) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni instrucciones de pago en el parte. Los pagos se hacen solo en la página web.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.care_logs_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_care_logs_guard ON public.care_logs;
CREATE TRIGGER trg_care_logs_guard
  BEFORE INSERT ON public.care_logs
  FOR EACH ROW EXECUTE FUNCTION public.care_logs_guard();

-- Una alerta avisa de inmediato a la familia (o institución) y a su círculo de cuidado.
CREATE OR REPLACE FUNCTION public.care_logs_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  b      public.service_bookings%ROWTYPE;
  v_pro  text;
  w      record;
BEGIN
  IF NOT NEW.is_alert OR NEW.system_generated THEN
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_pro := public.party_display_name(b.professional_id);
  FOR w IN SELECT watcher_id FROM public.care_watchers(b.client_id) LOOP
    PERFORM public.hx_notify(w.watcher_id, 'care_alert', 'Alerta en el turno de ' || v_pro,
      left(COALESCE(NEW.alert_reason, NEW.description), 140), '/servicio/' || b.id::text);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'care_logs_after_insert: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.care_logs_after_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_care_logs_after_insert ON public.care_logs;
CREATE TRIGGER trg_care_logs_after_insert
  AFTER INSERT ON public.care_logs
  FOR EACH ROW EXECUTE FUNCTION public.care_logs_after_insert();

-- Llegada y salida automáticas + avisos. Todo es idempotente: si el personal corrige el estado de una reserva y
-- la vuelve a cerrar, no se duplican ni los registros ni los avisos. El profesional recibe un festejo en los hitos
-- de servicios completados.
CREATE OR REPLACE FUNCTION public.booking_care_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev  text := COALESCE(current_setting('app.care_rpc', true), '');
  v_pro   text := public.party_display_name(NEW.professional_id);
  v_start timestamptz;
  v_min   integer;
  v_done  integer;
  v_label text;
  w       record;
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    IF EXISTS (SELECT 1 FROM public.care_logs WHERE booking_id = NEW.id AND event_type = 'arrival') THEN
      RETURN NEW;
    END IF;
    PERFORM set_config('app.care_rpc', 'on', true);
    INSERT INTO public.care_logs (booking_id, professional_id, event_type, description)
    VALUES (NEW.id, NEW.professional_id, 'arrival', 'Comenzó el turno');
    PERFORM set_config('app.care_rpc', v_prev, true);

    FOR w IN SELECT watcher_id FROM public.care_watchers(NEW.client_id) LOOP
      PERFORM public.hx_notify(w.watcher_id, 'care_started', v_pro || ' ya está con el paciente',
        'Comenzó el turno. Puedes seguir el parte en vivo: medicamentos, comidas, signos vitales y novedades.',
        '/servicio/' || NEW.id::text);
    END LOOP;

  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF EXISTS (SELECT 1 FROM public.care_logs WHERE booking_id = NEW.id AND event_type = 'departure') THEN
      RETURN NEW;
    END IF;
    SELECT min(created_at) INTO v_start
      FROM public.care_logs WHERE booking_id = NEW.id AND event_type = 'arrival';
    v_start := COALESCE(v_start, NEW.arrived_at, NEW.started_at);
    v_min := CASE WHEN v_start IS NULL THEN NULL
                  ELSE GREATEST(0, round(extract(epoch FROM (now() - v_start)) / 60))::integer END;
    v_label := public.hx_duration_label(v_min);

    PERFORM set_config('app.care_rpc', 'on', true);
    INSERT INTO public.care_logs (booking_id, professional_id, event_type, description)
    VALUES (NEW.id, NEW.professional_id, 'departure',
            'Terminó el turno' || COALESCE(' · duración ' || v_label, ''));
    PERFORM set_config('app.care_rpc', v_prev, true);

    FOR w IN SELECT watcher_id, is_owner FROM public.care_watchers(NEW.client_id) LOOP
      PERFORM public.hx_notify(w.watcher_id, 'care_finished', 'Terminó el turno de ' || v_pro,
        CASE WHEN w.is_owner
          THEN COALESCE('Duración: ' || v_label || '. ', '') || 'Revisa el parte final, dale las gracias y califica el servicio.'
          ELSE COALESCE('Duración: ' || v_label || '. ', '') || 'Revisa el parte final del turno.' END,
        '/servicio/' || NEW.id::text);
    END LOOP;

    SELECT count(*) INTO v_done FROM public.service_bookings
     WHERE professional_id = NEW.professional_id AND status = 'completed';
    IF v_done IN (1, 5, 10, 25, 50, 100, 250, 500) THEN
      PERFORM public.hx_notify(NEW.professional_id, 'career_milestone',
        CASE WHEN v_done = 1 THEN '¡Completaste tu primer servicio en Humanix!'
             ELSE '¡Ya son ' || v_done || ' servicios completados!' END,
        'Tu trayectoria crece con cada turno. Mira tus sellos y comparte tu perfil verificado.',
        '/dashboard/profesional');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El parte automático nunca debe impedir cambiar el estado de una reserva.
  RAISE WARNING 'booking_care_events: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.booking_care_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_care_events ON public.service_bookings;
CREATE TRIGGER trg_booking_care_events
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW
  WHEN (NEW.status IN ('in_progress', 'completed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.booking_care_events();

-- Resumen del turno. Antes lo podía consultar cualquiera con un id de reserva; ahora exige ser parte,
-- miembro del círculo o personal autorizado.
CREATE OR REPLACE FUNCTION public.care_can_view(p_booking_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.id = p_booking_id
       AND (
         p_user IN (b.client_id, b.professional_id)
         OR public.is_staff(p_user)
         OR EXISTS (
           SELECT 1 FROM public.care_circle_members m
            WHERE m.owner_id = b.client_id AND m.member_id = p_user
              AND m.status = 'accepted' AND m.can_view_services
         )
       )
  )
$$;
REVOKE ALL ON FUNCTION public.care_can_view(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.care_can_view(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_care_summary(p_booking_id uuid)
RETURNS TABLE (
  event_count   integer,
  has_vitals    boolean,
  has_incident  boolean,
  last_event_at timestamptz,
  arrival_at    timestamptz,
  departure_at  timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.care_can_view(p_booking_id, auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT count(*)::integer,
         COALESCE(bool_or(l.event_type = 'vital_signs'), false),
         COALESCE(bool_or(l.event_type = 'incident'), false),
         max(l.created_at),
         min(l.created_at) FILTER (WHERE l.event_type = 'arrival'),
         max(l.created_at) FILTER (WHERE l.event_type = 'departure')
    FROM public.care_logs l
   WHERE l.booking_id = p_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_care_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_care_summary(uuid) TO authenticated, service_role;

-- Parte final del turno (una sola llamada para la pantalla y la impresión).
CREATE OR REPLACE FUNCTION public.care_report(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  b          public.service_bookings%ROWTYPE;
  v_start    timestamptz;
  v_end      timestamptz;
  v_min      integer;
  v_by_type  jsonb;
  v_vitals   jsonb;
  v_moods    jsonb;
  v_events   integer;
  v_vcount   integer;
  v_alerts   integer;
  v_inc      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.care_can_view(p_booking_id, auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id;

  SELECT min(created_at) FILTER (WHERE event_type = 'arrival'),
         max(created_at) FILTER (WHERE event_type = 'departure'),
         count(*) FILTER (WHERE NOT system_generated),
         count(*) FILTER (WHERE vital_systolic IS NOT NULL OR vital_diastolic IS NOT NULL OR vital_heart_rate IS NOT NULL
                             OR vital_temperature IS NOT NULL OR vital_oxygen IS NOT NULL),
         count(*) FILTER (WHERE is_alert AND NOT system_generated),
         count(*) FILTER (WHERE event_type = 'incident')
    INTO v_start, v_end, v_events, v_vcount, v_alerts, v_inc
    FROM public.care_logs WHERE booking_id = p_booking_id;

  v_start := COALESCE(v_start, b.arrived_at, b.started_at);
  v_min := CASE WHEN v_start IS NULL THEN NULL
                ELSE GREATEST(0, round(extract(epoch FROM (COALESCE(v_end, now()) - v_start)) / 60))::integer END;

  SELECT COALESCE(jsonb_object_agg(t.event_type, t.n), '{}'::jsonb) INTO v_by_type
    FROM (SELECT event_type, count(*) AS n FROM public.care_logs
           WHERE booking_id = p_booking_id AND NOT system_generated GROUP BY event_type) t;

  SELECT jsonb_build_object('at', l.created_at, 'systolic', l.vital_systolic, 'diastolic', l.vital_diastolic,
                            'heart_rate', l.vital_heart_rate, 'temperature', l.vital_temperature,
                            'oxygen', l.vital_oxygen)
    INTO v_vitals
    FROM public.care_logs l
   WHERE l.booking_id = p_booking_id
     AND (l.vital_systolic IS NOT NULL OR l.vital_diastolic IS NOT NULL OR l.vital_heart_rate IS NOT NULL
          OR l.vital_temperature IS NOT NULL OR l.vital_oxygen IS NOT NULL)
   ORDER BY l.created_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', m.created_at, 'mood', m.mood) ORDER BY m.created_at), '[]'::jsonb)
    INTO v_moods
    FROM public.care_logs m WHERE m.booking_id = p_booking_id AND m.mood IS NOT NULL;

  RETURN jsonb_build_object(
    'booking_id', b.id,
    'status', b.status,
    'scheduled_at', b.scheduled_at,
    'planned_hours', b.duration_hours,
    'professional', public.party_display_name(b.professional_id),
    'started_at', v_start,
    'ended_at', v_end,
    'duration_minutes', v_min,
    'events', v_events,
    'by_type', v_by_type,
    'vitals_count', v_vcount,
    'last_vitals', v_vitals,
    'alerts', v_alerts,
    'incidents', v_inc,
    'moods', v_moods
  );
END;
$$;
REVOKE ALL ON FUNCTION public.care_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_report(uuid) TO authenticated, service_role;

-- ─── 2) «Gracias» (care_kudos) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.care_kudos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  from_user   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_role   text NOT NULL CHECK (from_role IN ('client', 'professional')),
  kinds       text[] NOT NULL CHECK (cardinality(kinds) BETWEEN 1 AND 3),
  message     text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 280),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_kudos_distinct_parties CHECK (from_user <> to_user),
  CONSTRAINT care_kudos_one_per_booking UNIQUE (booking_id, from_user)
);
CREATE INDEX IF NOT EXISTS idx_care_kudos_to ON public.care_kudos (to_user, created_at DESC);
ALTER TABLE public.care_kudos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS care_kudos_select_parties ON public.care_kudos;
CREATE POLICY care_kudos_select_parties ON public.care_kudos
  FOR SELECT TO authenticated
  USING (auth.uid() IN (from_user, to_user) OR public.is_staff(auth.uid()));

-- Solo send_kudos() escribe: sin INSERT/UPDATE/DELETE desde el cliente.
REVOKE ALL ON public.care_kudos FROM anon, authenticated;
GRANT SELECT ON public.care_kudos TO authenticated;
GRANT ALL ON public.care_kudos TO service_role;

-- Reconocimientos permitidos por quien los da. Espejo de KUDOS_KINDS en src/lib/kudos.ts.
CREATE OR REPLACE FUNCTION public.kudos_allowed_kinds(p_from_role text)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_from_role
    WHEN 'client'       THEN ARRAY['punctual', 'caring', 'patient', 'peace_of_mind', 'communicative', 'professional']
    WHEN 'professional' THEN ARRAY['respectful', 'clear_instructions', 'welcoming', 'well_prepared']
    ELSE ARRAY[]::text[]
  END
$$;
REVOKE ALL ON FUNCTION public.kudos_allowed_kinds(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kudos_allowed_kinds(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_kudos(p_booking_id uuid, p_kinds text[], p_message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  b       public.service_bookings%ROWTYPE;
  v_role  text;
  v_to    uuid;
  v_kinds text[];
  v_msg   text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio no encontrado' USING ERRCODE = '23503';
  END IF;
  IF v_uid = b.client_id THEN
    v_role := 'client';       v_to := b.professional_id;
  ELSIF v_uid = b.professional_id THEN
    v_role := 'professional'; v_to := b.client_id;
  ELSE
    RAISE EXCEPTION 'No participaste en este servicio' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'completed' THEN
    RAISE EXCEPTION 'Puedes dar las gracias cuando el servicio haya terminado' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), ARRAY[]::text[]) INTO v_kinds
    FROM unnest(COALESCE(p_kinds, ARRAY[]::text[])) AS k;
  IF cardinality(v_kinds) NOT BETWEEN 1 AND 3 OR NOT (v_kinds <@ public.kudos_allowed_kinds(v_role)) THEN
    RAISE EXCEPTION 'Elige entre 1 y 3 reconocimientos de la lista' USING ERRCODE = '22023';
  END IF;
  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 280 THEN
      RAISE EXCEPTION 'El mensaje puede tener hasta 280 caracteres' USING ERRCODE = '22001';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni instrucciones de pago en el mensaje' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.care_kudos (booking_id, from_user, to_user, from_role, kinds, message)
  VALUES (b.id, v_uid, v_to, v_role, v_kinds, v_msg)
  ON CONFLICT (booking_id, from_user) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Ya enviaste tus gracias por este servicio' USING ERRCODE = '23505';
  END IF;

  PERFORM public.hx_notify(v_to, 'kudos_received',
    public.party_display_name(v_uid) || ' te dio las gracias',
    COALESCE('«' || left(v_msg, 120) || '»', 'Un reconocimiento por tu trabajo en el servicio.'),
    CASE WHEN v_role = 'client' THEN '/dashboard/profesional' ELSE '/servicio/' || b.id::text END);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_kudos(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_kudos(uuid, text[], text) TO authenticated;

-- Los «gracias» que recibí, con quién los dio (nombre corto).
CREATE OR REPLACE FUNCTION public.my_received_kudos(p_limit integer DEFAULT 30)
RETURNS TABLE (id uuid, booking_id uuid, from_name text, from_role text, kinds text[], message text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT k.id, k.booking_id, public.party_display_name(k.from_user), k.from_role, k.kinds, k.message, k.created_at
    FROM public.care_kudos k
   WHERE k.to_user = auth.uid()
   ORDER BY k.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.my_received_kudos(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_received_kudos(integer) TO authenticated;

-- Cuántas personas distintas dieron cada reconocimiento a un profesional (sin mensajes ni identidades).
CREATE OR REPLACE FUNCTION public.professional_kudos_summary(p_user uuid)
RETURNS TABLE (kind text, givers integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT x.kind, count(DISTINCT x.from_user)::integer
    FROM (SELECT c.from_user, k AS kind
            FROM public.care_kudos c, LATERAL unnest(c.kinds) AS k
           WHERE c.to_user = p_user AND c.from_role = 'client') x
   GROUP BY x.kind
   ORDER BY 2 DESC, 1
$$;
REVOKE ALL ON FUNCTION public.professional_kudos_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.professional_kudos_summary(uuid) TO anon, authenticated, service_role;

-- ─── 3) Trayectoria del profesional ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.career_stats_core(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH done AS (
    SELECT b.id, b.client_id, b.scheduled_at, b.duration_hours
      FROM public.service_bookings b
     WHERE b.professional_id = p_user AND b.status = 'completed'
  ), repeat_clients AS (
    SELECT client_id FROM done GROUP BY client_id HAVING count(*) >= 2
  ), kinds AS (
    SELECT x.kind, count(DISTINCT x.from_user)::integer AS n
      FROM (SELECT c.from_user, k AS kind
              FROM public.care_kudos c, LATERAL unnest(c.kinds) AS k
             WHERE c.to_user = p_user AND c.from_role = 'client') x
     GROUP BY x.kind
  )
  SELECT jsonb_build_object(
    'completed_services', (SELECT count(*) FROM done),
    'hours_total',        (SELECT COALESCE(round(sum(duration_hours)::numeric, 1), 0) FROM done),
    'clients_total',      (SELECT count(DISTINCT client_id) FROM done),
    'repeat_clients',     (SELECT count(*) FROM repeat_clients),
    'first_service_at',   (SELECT min(scheduled_at) FROM done),
    'last_service_at',    (SELECT max(scheduled_at) FROM done),
    'week_starts',        (SELECT COALESCE(jsonb_agg(s.w ORDER BY s.w), '[]'::jsonb)
                             FROM (SELECT DISTINCT date_trunc('week', d.scheduled_at AT TIME ZONE 'America/Bogota')::date AS w
                                     FROM done d
                                    WHERE d.scheduled_at > now() - interval '104 weeks') s),
    'rated_services',     (SELECT count(*) FROM public.service_ratings r WHERE r.rated_id = p_user),
    'avg_stars',          (SELECT COALESCE(round(avg(r.stars)::numeric, 2), 0) FROM public.service_ratings r WHERE r.rated_id = p_user),
    'kudos_total',        (SELECT count(*) FROM public.care_kudos c WHERE c.to_user = p_user AND c.from_role = 'client'),
    'kudos_by_kind',      (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM kinds),
    'logged_services',    (SELECT count(DISTINCT l.booking_id) FROM public.care_logs l
                            JOIN done d ON d.id = l.booking_id WHERE NOT l.system_generated),
    'alerts_reported',    (SELECT count(*) FROM public.care_logs l
                            WHERE l.professional_id = p_user AND l.is_alert AND NOT l.system_generated)
  )
$$;
REVOKE ALL ON FUNCTION public.career_stats_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_stats_core(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.my_career_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  RETURN public.career_stats_core(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.my_career_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_career_stats() TO authenticated;

-- Versión pública: solo agregados, sin identidades. NULL si la persona no es un profesional visible.
CREATE OR REPLACE FUNCTION public.professional_public_stats(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.career_stats_core(p_user) - 'clients_total' - 'alerts_reported' - 'last_service_at'
   WHERE EXISTS (SELECT 1 FROM public.professional_profiles pp
                  WHERE pp.user_id = p_user AND NOT COALESCE(pp.blocked, false))
$$;
REVOKE ALL ON FUNCTION public.professional_public_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.professional_public_stats(uuid) TO anon, authenticated, service_role;

-- ─── 4) Equipo de confianza y plan B ───────────────────────────────────────────

-- Mi equipo: los profesionales que guardé como favoritos, con lo que hemos vivido juntos.
CREATE OR REPLACE FUNCTION public.my_trusted_team()
RETURNS TABLE (
  professional_id uuid, display_name text, specialty text, avatar_url text, avg_rating numeric,
  services_together integer, last_service_at timestamptz, favorite_since timestamptz, available boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT f.professional_id,
         public.party_display_name(f.professional_id),
         pp.specialty,
         COALESCE(pp.avatar_url, pr.avatar_url),
         pp.avg_rating,
         (SELECT count(*)::integer FROM public.service_bookings b
           WHERE b.client_id = auth.uid() AND b.professional_id = f.professional_id AND b.status = 'completed'),
         (SELECT max(b.scheduled_at) FROM public.service_bookings b
           WHERE b.client_id = auth.uid() AND b.professional_id = f.professional_id AND b.status = 'completed'),
         f.created_at,
         (COALESCE(pp.available, false) AND COALESCE(pp.published, false) AND NOT COALESCE(pp.blocked, false))
    FROM public.care_favorites f
    LEFT JOIN public.professional_profiles pp ON pp.user_id = f.professional_id
    LEFT JOIN public.profiles pr ON pr.user_id = f.professional_id
   WHERE f.client_id = auth.uid()
   ORDER BY 6 DESC NULLS LAST, f.created_at DESC
   LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.my_trusted_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_trusted_team() TO authenticated;

-- Cuántos del equipo de confianza están libres en una franja (excluye a quien canceló).
CREATE OR REPLACE FUNCTION public.trusted_team_free_count(
  p_client uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM public.care_favorites f
    JOIN public.professional_profiles pp ON pp.user_id = f.professional_id
   WHERE f.client_id = p_client
     AND f.professional_id IS DISTINCT FROM p_exclude
     AND pp.published AND pp.active AND pp.available AND NOT COALESCE(pp.blocked, false)
     AND NOT EXISTS (
       SELECT 1 FROM public.service_bookings o
        WHERE o.professional_id = f.professional_id
          AND o.status IN ('confirmed', 'in_route', 'in_progress')
          AND o.scheduled_at < p_end
          AND o.scheduled_at + (o.duration_hours * interval '1 hour') > p_start
     )
$$;
REVOKE ALL ON FUNCTION public.trusted_team_free_count(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trusted_team_free_count(uuid, timestamptz, timestamptz, uuid) TO service_role;

-- Núcleo de la invitación al equipo: lo usan la persona que publica (manual) y el plan B (automático).
CREATE OR REPLACE FUNCTION public.invite_team_core(
  p_offer uuid, p_inviter uuid, p_exclude uuid DEFAULT NULL, p_auto boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  o      public.job_offers%ROWTYPE;
  v_name text;
  v_n    integer := 0;
  r      record;
BEGIN
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer;
  IF NOT FOUND OR o.posted_by <> p_inviter OR o.blocked OR o.status::text <> 'open' THEN
    RETURN 0;
  END IF;
  v_name := public.party_display_name(p_inviter);

  FOR r IN
    SELECT f.professional_id
      FROM public.care_favorites f
      JOIN public.professional_profiles pp ON pp.user_id = f.professional_id
     WHERE f.client_id = p_inviter
       AND f.professional_id IS DISTINCT FROM p_exclude
       AND NOT COALESCE(pp.blocked, false)
       AND NOT EXISTS (SELECT 1 FROM public.applications a
                        WHERE a.job_offer_id = o.id AND a.professional_id = f.professional_id)
       AND NOT EXISTS (SELECT 1 FROM public.offer_team_invites i
                        WHERE i.job_offer_id = o.id AND i.professional_id = f.professional_id)
     ORDER BY f.created_at
     LIMIT 25
  LOOP
    INSERT INTO public.offer_team_invites (job_offer_id, professional_id, invited_by)
    VALUES (o.id, r.professional_id, p_inviter)
    ON CONFLICT DO NOTHING;
    IF p_auto THEN
      PERFORM public.hx_notify(r.professional_id, 'team_invite_urgent',
        v_name || ' confía en ti: se liberó un turno',
        'Eres de su equipo de confianza. «' || left(o.title, 60) || '» (' || COALESCE(o.city, 'tu ciudad') ||
          ') quedó disponible: postúlate antes que nadie.',
        '/dashboard/profesional');
    ELSE
      PERFORM public.hx_notify(r.professional_id, 'team_invite',
        v_name || ' te invita a postularte',
        'Ya trabajaron juntos y quieren contar contigo en «' || left(o.title, 60) || '» (' || COALESCE(o.city, 'tu ciudad') ||
          '). Revisa el turno y postúlate desde tu agenda.',
        '/dashboard/profesional');
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.invite_team_core(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_team_core(uuid, uuid, uuid, boolean) TO service_role;

-- Misma firma y mismo contrato que antes (solo quien publicó la oferta, solo a su equipo, una vez por oferta).
CREATE OR REPLACE FUNCTION public.invite_team_to_offer(p_offer_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  o     public.job_offers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer_id;
  IF NOT FOUND OR o.posted_by <> v_uid THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;
  RETURN public.invite_team_core(o.id, v_uid, NULL, false);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_team_to_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_team_to_offer(uuid) TO authenticated;

-- Plan B: si el PROFESIONAL cancela un turno ligado a una oferta que se reabrió, se invita sola al equipo de
-- confianza de quien publicó (institución o familia). Corre después de bookings_sync_offer_and_contract (orden
-- alfabético de disparadores), que es quien reabre el cupo.
CREATE OR REPLACE FUNCTION public.plan_b_after_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  o     record;
  v_n   integer;
BEGIN
  IF NEW.job_offer_id IS NULL OR auth.uid() IS DISTINCT FROM NEW.professional_id THEN
    RETURN NEW;
  END IF;
  SELECT id, posted_by, status::text AS status, blocked, poster_type::text AS poster_type
    INTO o FROM public.job_offers WHERE id = NEW.job_offer_id;
  IF NOT FOUND OR o.posted_by <> NEW.client_id OR o.status <> 'open' OR o.blocked THEN
    RETURN NEW;
  END IF;
  v_n := public.invite_team_core(o.id, o.posted_by, NEW.professional_id, true);
  IF v_n > 0 THEN
    PERFORM public.hx_notify(NEW.client_id, 'plan_b_started', 'Activamos tu plan B',
      'Avisamos a ' || v_n || CASE WHEN v_n = 1 THEN ' profesional' ELSE ' profesionales' END ||
        ' de tu equipo de confianza sobre el turno que quedó libre. Te contamos apenas alguien se postule.',
      CASE WHEN o.poster_type = 'institution' THEN '/dashboard/institucion' ELSE '/dashboard/familia' END);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'plan_b_after_cancel: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plan_b_after_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_plan_b_after_cancel ON public.service_bookings;
CREATE TRIGGER trg_plan_b_after_cancel
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.plan_b_after_cancel();

-- Aviso de cancelación con inteligencia: dice cuántos del equipo de confianza están libres en esa franja.
-- Las reservas ligadas a un turno de oferta ya reciben su aviso desde bookings_sync_offer_and_contract.
CREATE OR REPLACE FUNCTION public.notify_booking_cancelled()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_target uuid;
  v_by_pro boolean;
  v_free   integer;
  v_body   text;
BEGIN
  IF (to_jsonb(NEW) ->> 'job_offer_shift_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_by_pro := (v_actor IS NOT NULL AND v_actor = NEW.professional_id);
  v_target := CASE WHEN v_by_pro THEN NEW.client_id ELSE NEW.professional_id END;

  IF v_by_pro THEN
    v_free := public.trusted_team_free_count(
      NEW.client_id, NEW.scheduled_at, NEW.scheduled_at + (NEW.duration_hours * interval '1 hour'), NEW.professional_id);
    v_body := CASE
      WHEN COALESCE(v_free, 0) > 0 THEN
        v_free || CASE WHEN v_free = 1 THEN ' profesional de tu equipo de confianza está libre' ELSE ' profesionales de tu equipo de confianza están libres' END ||
          ' en ese horario. Pídeles que te cubran desde el detalle del servicio.'
      ELSE 'Puedes buscar un reemplazo disponible para el mismo horario desde el detalle del servicio.'
    END;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_target,
    'booking_cancelled',
    CASE WHEN v_by_pro THEN 'Tu profesional canceló el servicio' ELSE 'Se canceló un servicio' END,
    CASE WHEN v_by_pro THEN v_body ELSE 'El servicio programado fue cancelado.' END,
    '/servicio/' || NEW.id::text
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_booking_cancelled() FROM PUBLIC, anon, authenticated;

-- ─── 5) Historia de cuidado exportable (plan de pago) ──────────────────────────
-- El plan se lee de mp_subscriptions con plan_key_for() (solo escribe el webhook de pagos). Cualquier plan de
-- pago la incluye; el personal de soporte puede consultarla para atender reclamos.

CREATE OR REPLACE FUNCTION public.care_history_report(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  booking_id uuid, scheduled_at timestamptz, planned_hours numeric, status text, professional text,
  specialty text, offer_title text, started_at timestamptz, ended_at timestamptz, events integer,
  vitals integer, alerts integer, incidents integer, last_mood text, kudos_sent boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF public.plan_key_for(v_uid) = 'free' AND NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'plan_required: la historia de cuidado exportable requiere un plan de pago' USING ERRCODE = '42501';
  END IF;
  v_from := COALESCE(p_from::timestamp AT TIME ZONE 'America/Bogota', now() - interval '12 months');
  v_to   := COALESCE((p_to + 1)::timestamp AT TIME ZONE 'America/Bogota', now() + interval '1 day');

  RETURN QUERY
  SELECT b.id, b.scheduled_at, b.duration_hours, b.status,
         public.party_display_name(b.professional_id),
         pp.specialty,
         (SELECT o.title FROM public.job_offers o WHERE o.id = b.job_offer_id),
         a.started, a.ended,
         COALESCE(a.events, 0)::integer, COALESCE(a.vitals, 0)::integer, COALESCE(a.alerts, 0)::integer, COALESCE(a.incidents, 0)::integer,
         (SELECT l.mood FROM public.care_logs l WHERE l.booking_id = b.id AND l.mood IS NOT NULL
           ORDER BY l.created_at DESC LIMIT 1),
         EXISTS (SELECT 1 FROM public.care_kudos k WHERE k.booking_id = b.id AND k.from_user = v_uid)
    FROM public.service_bookings b
    LEFT JOIN public.professional_profiles pp ON pp.user_id = b.professional_id
    LEFT JOIN LATERAL (
      SELECT min(l.created_at) FILTER (WHERE l.event_type = 'arrival')   AS started,
             max(l.created_at) FILTER (WHERE l.event_type = 'departure') AS ended,
             count(*) FILTER (WHERE NOT l.system_generated)               AS events,
             count(*) FILTER (WHERE l.vital_systolic IS NOT NULL OR l.vital_diastolic IS NOT NULL OR l.vital_heart_rate IS NOT NULL
                                 OR l.vital_temperature IS NOT NULL OR l.vital_oxygen IS NOT NULL) AS vitals,
             count(*) FILTER (WHERE l.is_alert AND NOT l.system_generated) AS alerts,
             count(*) FILTER (WHERE l.event_type = 'incident')             AS incidents
        FROM public.care_logs l WHERE l.booking_id = b.id
    ) a ON true
   WHERE b.client_id = v_uid
     AND b.scheduled_at >= v_from AND b.scheduled_at < v_to
   ORDER BY b.scheduled_at DESC
   LIMIT 1000;
END;
$$;
REVOKE ALL ON FUNCTION public.care_history_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_history_report(date, date) TO authenticated;
