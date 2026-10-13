-- ═══════════════════════════════════════════════════════════════════════════════
-- SOS Familiar de punta a punta (decisión pedida el 2026-10-12)
--
-- Qué pasaba en la base real (revisado el 2026-10-12). El botón «SOS Familiar» inserta una fila en `clinical_alerts` con
-- `alert_type = 'sos_manual'` y la ubicación (`lat`, `lng`). Nada de eso podía funcionar:
--   1. `clinical_alerts` no tiene las columnas `lat` y `lng` → la inserción fallaba con «column does not exist»;
--   2. el CHECK de `alert_type` no admite `sos_manual`;
--   3. no existe política de INSERT para usuarios autenticados → RLS rechaza cualquier alta;
--   4. el aviso por WhatsApp depende de un Database Webhook (pg_net + un secreto de Vault) que no existe en la base real.
-- Hoy el botón solo manda a llamar al 123.
--
-- Qué hace.
--   • Columnas: lat, lng, accuracy_m, triggered_by (quién pulsó el botón), inapp_notified (a cuántas personas se avisó dentro de
--     la app) y un CHECK de coordenadas válidas; `actual_value` vale 0 por defecto (un SOS no mide nada).
--   • `alert_type` admite 'sos_manual'.
--   • Política de INSERT acotada: solo un SOS crítico y activo, sin avisos ni atención falsificados, a nombre de uno mismo, de
--     quien atiende con una reserva vigente o de quien comparte su círculo de cuidado.
--   • Guarda anti-abuso (BEFORE INSERT): un SOS por paciente cada 2 minutos y 5 por hora.
--   • Lectura y atención del SOS también para su círculo de cuidado y para el profesional con servicio vigente
--     (`hx_can_access_alert`, una sola función: la ampliación a más actores se hace aquí y no en cada política).
--   • Disparador de avisos: crea el incidente (`emergency_incidents`, que el superadmin ve en tiempo real) y avisa DENTRO de la app
--     (`notifications`) al círculo de cuidado, al profesional con servicio vigente y a quien contrató. Nunca bloquea el SOS:
--     si algo falla, el aviso se registra como advertencia y la alerta queda guardada.
--   • El botón de pánico de un servicio (`emergency_incidents`) también avisa en la app a la otra parte de la reserva y a su círculo.
--     Su política de INSERT exige además que la reserva citada sea del usuario (antes cualquiera podía citar la de otro).
--   • Los incidentes y los avisos (`notifications`) llevan ahora ubicación y datos de salud: con `is_staff()` los leían RR. HH. y
--     los evaluadores. Pasan a lectura propia + superadmin (misma regla que 20261012150000 para los datos de salud).
--   • WhatsApp automático: deja listo el Database Webhook hacia la función `clinical-alert-notify` SOLO para el SOS. No hace nada
--     hasta que existan (a) la extensión pg_net, (b) el secreto 'internal_webhook_secret' en Vault y (c) los secretos de la función
--     (INTERNAL_WEBHOOK_SECRET con el mismo valor, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID). Nada de eso se activa solo.
--
-- Idempotente. Si faltan las tablas (base nueva sin la cadena de drizzle), no hace nada.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_sos$
BEGIN
  IF to_regclass('public.clinical_alerts') IS NULL
     OR to_regclass('public.service_bookings') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regprocedure('public.care_watchers(uuid)') IS NULL
     OR to_regprocedure('public.party_display_name(uuid)') IS NULL THEN
    RAISE NOTICE 'SOS Familiar: faltan clinical_alerts, service_bookings, notifications, care_watchers o party_display_name; no se hace nada';
    RETURN;
  END IF;

  -- ── 1) Columnas y restricciones ───────────────────────────────────────────
  ALTER TABLE public.clinical_alerts
    ADD COLUMN IF NOT EXISTS lat            double precision,
    ADD COLUMN IF NOT EXISTS lng            double precision,
    ADD COLUMN IF NOT EXISTS accuracy_m     real,
    ADD COLUMN IF NOT EXISTS triggered_by   uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS inapp_notified integer NOT NULL DEFAULT 0;
  ALTER TABLE public.clinical_alerts ALTER COLUMN actual_value SET DEFAULT 0;

  ALTER TABLE public.clinical_alerts DROP CONSTRAINT IF EXISTS clinical_alerts_geo_chk;
  ALTER TABLE public.clinical_alerts ADD CONSTRAINT clinical_alerts_geo_chk CHECK (
    (lat IS NULL) = (lng IS NULL)
    AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))
    AND (accuracy_m IS NULL OR accuracy_m >= 0)
  );

  ALTER TABLE public.clinical_alerts DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;
  ALTER TABLE public.clinical_alerts ADD CONSTRAINT clinical_alerts_alert_type_check CHECK (alert_type = ANY (ARRAY[
    'high_heart_rate', 'low_heart_rate', 'low_spo2', 'high_temperature', 'low_temperature', 'high_blood_pressure',
    'low_blood_pressure', 'fall_detected', 'inactivity', 'high_respiration', 'abnormal_glucose', 'sos_manual'
  ]));

  -- ── 2) A quién se avisa y quién puede ver o atender ─────────────────────────
  -- Audiencia de un SOS: el círculo de cuidado (care_watchers: quien contrató + miembros aceptados que pueden ver los servicios),
  -- el profesional con un servicio en curso o inminente de ese paciente, y las dos partes de la reserva citada. Interna: nadie
  -- la llama desde la API.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_sos_audience(p_patient uuid, p_booking uuid, p_exclude uuid)
    RETURNS TABLE (user_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT DISTINCT t.u
        FROM (
          SELECT w.watcher_id AS u FROM public.care_watchers(p_patient) w
          UNION
          SELECT sb.professional_id
            FROM public.service_bookings sb
           WHERE sb.client_id = p_patient
             AND sb.status IN ('confirmed', 'in_route', 'in_progress')
             AND sb.scheduled_at <= now() + interval '12 hours'
             AND sb.scheduled_at + (sb.duration_hours * interval '1 hour') >= now() - interval '3 hours'
          UNION
          SELECT sb.professional_id FROM public.service_bookings sb WHERE p_booking IS NOT NULL AND sb.id = p_booking
          UNION
          SELECT sb.client_id FROM public.service_bookings sb WHERE p_booking IS NOT NULL AND sb.id = p_booking
        ) t
       WHERE t.u IS NOT NULL AND t.u IS DISTINCT FROM p_exclude
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_sos_audience(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated';

  -- Quién puede ver y atender una alerta clínica. Es la única función que las políticas consultan; para añadir otros actores
  -- (por ejemplo el personal de una institución) se reemplaza ESTA función, no las políticas. Responde solo por quien llama.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_can_access_alert(p_patient uuid, p_booking uuid, p_type text)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT auth.uid() IS NOT NULL AND (
           p_patient = auth.uid()
        OR (p_booking IS NOT NULL AND EXISTS (SELECT 1 FROM public.service_bookings sb
                                               WHERE sb.id = p_booking AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid())))
        OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
        OR (p_type = 'sos_manual' AND auth.uid() IN (SELECT a.user_id FROM public.hx_sos_audience(p_patient, p_booking, NULL) a))
      )
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_can_access_alert(uuid, uuid, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.hx_can_access_alert(uuid, uuid, text) TO authenticated';

  -- Quién puede pulsar el SOS de alguien: él mismo, su profesional con una reserva vigente o su círculo de cuidado. Si cita una
  -- reserva, tiene que ser una reserva DE ese paciente (si no, se podría avisar a los participantes de la reserva de otra persona).
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_can_trigger_sos(p_patient uuid, p_booking uuid)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT auth.uid() IS NOT NULL AND p_patient IS NOT NULL AND (
        CASE WHEN p_booking IS NULL THEN
               p_patient = auth.uid()
               OR EXISTS (SELECT 1 FROM public.care_watchers(p_patient) w WHERE w.watcher_id = auth.uid())
             ELSE
               EXISTS (SELECT 1 FROM public.service_bookings sb
                        WHERE sb.id = p_booking AND sb.client_id = p_patient
                          AND (p_patient = auth.uid()
                               OR (sb.professional_id = auth.uid() AND sb.status IN ('confirmed', 'in_route', 'in_progress'))
                               OR EXISTS (SELECT 1 FROM public.care_watchers(p_patient) w WHERE w.watcher_id = auth.uid())))
        END
      )
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_can_trigger_sos(uuid, uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.hx_can_trigger_sos(uuid, uuid) TO authenticated';

  -- ── 3) Políticas ──────────────────────────────────────────────────────────
  EXECUTE 'DROP POLICY IF EXISTS clinical_alerts_read ON public.clinical_alerts';
  EXECUTE 'CREATE POLICY clinical_alerts_read ON public.clinical_alerts FOR SELECT TO authenticated
           USING (public.hx_can_access_alert(patient_id, booking_id, alert_type))';
  EXECUTE 'DROP POLICY IF EXISTS clinical_alerts_ack ON public.clinical_alerts';
  EXECUTE 'CREATE POLICY clinical_alerts_ack ON public.clinical_alerts FOR UPDATE TO authenticated
           USING (public.hx_can_access_alert(patient_id, booking_id, alert_type))
           WITH CHECK (public.hx_can_access_alert(patient_id, booking_id, alert_type))';

  -- Solo el SOS lo crea un usuario: crítico, activo, a su nombre y sin avisos ni atención falsificados. Las alertas de signos
  -- vitales siguen naciendo solo del servidor (service_role).
  EXECUTE 'DROP POLICY IF EXISTS clinical_alerts_sos_insert ON public.clinical_alerts';
  EXECUTE 'CREATE POLICY clinical_alerts_sos_insert ON public.clinical_alerts FOR INSERT TO authenticated
           WITH CHECK (
                 alert_type = ''sos_manual'' AND severity = ''critical'' AND status = ''active''
             AND triggered_by = auth.uid()
             AND inapp_notified = 0
             AND NOT notified_whatsapp AND NOT notified_push AND NOT notified_email AND notified_at IS NULL
             AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND resolved_at IS NULL
             AND vital_sign_id IS NULL AND tenant_id IS NULL AND threshold_value IS NULL
             AND public.hx_can_trigger_sos(patient_id, booking_id))';

  -- ── 4) Guarda anti-abuso (BEFORE INSERT) ───────────────────────────────────
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.clinical_alerts_sos_guard()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    BEGIN
      IF NEW.alert_type <> 'sos_manual' OR auth.uid() IS NULL THEN
        RETURN NEW;  -- las alertas de signos vitales y el servidor no pasan por aquí
      END IF;
      -- Quien no puede pulsar este SOS recibe el rechazo de la política, no un mensaje que delate si otra persona envió uno.
      IF NOT public.hx_can_trigger_sos(NEW.patient_id, NEW.booking_id) THEN
        RETURN NEW;
      END IF;
      -- Dos toques casi simultáneos no deben colarse los dos.
      PERFORM pg_advisory_xact_lock(hashtextextended('hx_sos:' || NEW.patient_id::text, 0));
      IF EXISTS (SELECT 1 FROM public.clinical_alerts a
                  WHERE a.patient_id = NEW.patient_id AND a.alert_type = 'sos_manual' AND a.created_at > now() - interval '2 minutes') THEN
        RAISE EXCEPTION 'Ya se envió un SOS hace un momento. Si sigues en peligro, llama al 123.'
          USING ERRCODE = '23514', HINT = 'sos_recent';
      END IF;
      IF (SELECT count(*) FROM public.clinical_alerts a
           WHERE a.patient_id = NEW.patient_id AND a.alert_type = 'sos_manual' AND a.created_at > now() - interval '1 hour') >= 5
         OR (SELECT count(*) FROM public.clinical_alerts a
              WHERE a.triggered_by = NEW.triggered_by AND a.alert_type = 'sos_manual' AND a.created_at > now() - interval '1 hour') >= 5 THEN
        RAISE EXCEPTION 'Demasiados SOS en la última hora. Llama al 123 o a tu contacto de emergencia.'
          USING ERRCODE = '23514', HINT = 'sos_limit';
      END IF;
      RETURN NEW;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.clinical_alerts_sos_guard() FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_clinical_alerts_sos_guard ON public.clinical_alerts';
  EXECUTE 'CREATE TRIGGER trg_clinical_alerts_sos_guard BEFORE INSERT ON public.clinical_alerts
           FOR EACH ROW EXECUTE FUNCTION public.clinical_alerts_sos_guard()';

  -- ── 5) Avisos del SOS: incidente + avisos en la app ────────────────────────
  -- Aviso en la app que devuelve si de verdad se guardó (hx_notify se traga los errores y no lo dice). Interna.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_notify_ex(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_meta jsonb)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    BEGIN
      IF p_user IS NULL THEN
        RETURN false;
      END IF;
      INSERT INTO public.notifications (user_id, type, title, body, link, meta)
      VALUES (p_user, p_type, p_title, p_body, p_link, p_meta);
      RETURN true;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'hx_notify_ex(%): %', p_type, SQLERRM;
      RETURN false;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_notify_ex(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated';

  -- Panel al que se manda a cada persona según su rol.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.hx_dashboard_link(p_user uuid)
    RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT CASE WHEN public.has_role(p_user, 'professional'::public.app_role) THEN '/dashboard/profesional'
                  WHEN public.has_role(p_user, 'institution'::public.app_role) THEN '/dashboard/institucion'
                  ELSE '/dashboard/familia' END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.hx_dashboard_link(uuid) FROM PUBLIC, anon, authenticated';

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.clinical_alerts_sos_fanout()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_by      uuid := COALESCE(NEW.triggered_by, NEW.patient_id);
      v_patient text;
      v_byname  text;
      v_title   text;
      v_body    text;
      v_n       integer := 0;
      r         record;
    BEGIN
      -- Cada paso va aislado: un fallo al avisar nunca impide que el SOS quede guardado ni que se avise a los demás.
      BEGIN
        v_patient := public.party_display_name(NEW.patient_id);
        v_byname := public.party_display_name(v_by);
        v_title := 'SOS: ' || v_patient || ' pidió ayuda';
        v_body := CASE WHEN v_by IS DISTINCT FROM NEW.patient_id THEN v_byname || ' activó el SOS. ' ELSE '' END ||
                  CASE WHEN NEW.lat IS NOT NULL
                       THEN 'Ubicación: https://www.google.com/maps?q=' || round(NEW.lat::numeric, 6)::text || ',' || round(NEW.lng::numeric, 6)::text
                       ELSE 'No se pudo compartir la ubicación: contáctalo de inmediato.' END ||
                  ' · Si es una emergencia, llama al 123.';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'clinical_alerts_sos_fanout (texto): %', SQLERRM;
        v_title := 'SOS: una persona pidió ayuda';
        v_body := 'Contáctala de inmediato. Si es una emergencia, llama al 123.';
      END;

      BEGIN
        IF to_regclass('public.emergency_incidents') IS NOT NULL THEN
          INSERT INTO public.emergency_incidents (triggered_by, booking_id, incident_type, lat, lng, notes)
          VALUES (v_by, NEW.booking_id, 'sos_familiar', NEW.lat, NEW.lng, 'SOS Familiar · alerta ' || NEW.id::text);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'clinical_alerts_sos_fanout (incidente): %', SQLERRM;
      END;

      BEGIN
        FOR r IN SELECT a.user_id FROM public.hx_sos_audience(NEW.patient_id, NEW.booking_id, v_by) a
        LOOP
          IF public.hx_notify_ex(r.user_id, 'sos_alert', v_title, v_body, public.hx_dashboard_link(r.user_id),
                                 jsonb_build_object('alert_id', NEW.id, 'patient_id', NEW.patient_id)) THEN
            v_n := v_n + 1;
          END IF;
        END LOOP;
        UPDATE public.clinical_alerts SET inapp_notified = v_n WHERE id = NEW.id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'clinical_alerts_sos_fanout (avisos): %', SQLERRM;
      END;
      RETURN NULL;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.clinical_alerts_sos_fanout() FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_clinical_alerts_sos_fanout ON public.clinical_alerts';
  EXECUTE 'CREATE TRIGGER trg_clinical_alerts_sos_fanout AFTER INSERT ON public.clinical_alerts
           FOR EACH ROW WHEN (NEW.alert_type = ''sos_manual'') EXECUTE FUNCTION public.clinical_alerts_sos_fanout()';

  -- ── 6) Botón de pánico de un servicio (emergency_incidents) ────────────────
  IF to_regclass('public.emergency_incidents') IS NOT NULL THEN
    -- La reserva citada tiene que ser del usuario: antes cualquiera podía citar la de otro y ensuciar su historial.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emergency_incidents' AND policyname = 'emergency_insert_self') THEN
      EXECUTE 'ALTER POLICY emergency_insert_self ON public.emergency_incidents
               WITH CHECK (auth.uid() = triggered_by AND (booking_id IS NULL OR EXISTS (
                 SELECT 1 FROM public.service_bookings b
                  WHERE b.id = emergency_incidents.booking_id AND (b.client_id = auth.uid() OR b.professional_id = auth.uid()))))';
    END IF;
    -- Un incidente lleva la ubicación y la identidad de quien pidió ayuda: RR. HH. y evaluadores (is_staff) no lo leen; el superadmin sí.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emergency_incidents' AND policyname = 'emergency_select_involved') THEN
      EXECUTE 'ALTER POLICY emergency_select_involved ON public.emergency_incidents
               USING (auth.uid() = triggered_by OR public.has_role(auth.uid(), ''superadmin''::public.app_role) OR (booking_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.service_bookings b
                  WHERE b.id = emergency_incidents.booking_id AND (b.client_id = auth.uid() OR b.professional_id = auth.uid()))))';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emergency_incidents' AND policyname = 'emergency_staff_all') THEN
      EXECUTE 'ALTER POLICY emergency_staff_all ON public.emergency_incidents USING (public.has_role(auth.uid(), ''superadmin''::public.app_role))';
    END IF;

    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.emergency_incidents_fanout()
      RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE
        b      public.service_bookings%ROWTYPE;
        v_by   text;
        v_body text;
        r      record;
      BEGIN
        BEGIN
          IF NEW.booking_id IS NULL THEN
            RETURN NULL;
          END IF;
          SELECT * INTO b FROM public.service_bookings WHERE id = NEW.booking_id;
          IF NOT FOUND OR NEW.triggered_by NOT IN (b.client_id, b.professional_id) THEN
            RETURN NULL;  -- solo las partes de la reserva avisan a la otra parte
          END IF;
          v_by := public.party_display_name(NEW.triggered_by);
          v_body := v_by || ' activó el botón de emergencia en un servicio. ' ||
                    CASE WHEN NEW.lat IS NOT NULL
                         THEN 'Ubicación: https://www.google.com/maps?q=' || round(NEW.lat::numeric, 6)::text || ',' || round(NEW.lng::numeric, 6)::text || ' · '
                         ELSE '' END ||
                    'Si es una emergencia, llama al 123.';
          FOR r IN SELECT a.user_id FROM public.hx_sos_audience(b.client_id, NEW.booking_id, NEW.triggered_by) a
          LOOP
            PERFORM public.hx_notify_ex(r.user_id, 'emergency_alert', 'Emergencia en un servicio', v_body, public.hx_dashboard_link(r.user_id),
                                        jsonb_build_object('incident_id', NEW.id, 'booking_id', NEW.booking_id));
          END LOOP;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'emergency_incidents_fanout: %', SQLERRM;
        END;
        RETURN NULL;
      END
      $fn$
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.emergency_incidents_fanout() FROM PUBLIC, anon, authenticated';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_emergency_incidents_fanout ON public.emergency_incidents';
    -- El incidente que crea el propio SOS ya avisó a su audiencia: no se avisa dos veces.
    EXECUTE 'CREATE TRIGGER trg_emergency_incidents_fanout AFTER INSERT ON public.emergency_incidents
             FOR EACH ROW WHEN (NEW.incident_type <> ''sos_familiar'') EXECUTE FUNCTION public.emergency_incidents_fanout()';
  END IF;

  -- ── 6b) Los avisos (notifications) ya llevan ubicación y datos de salud ────────────────────────────────────
  -- Con is_staff(), RR. HH. y los evaluadores podían leer los avisos de TODAS las cuentas (incluidos los del SOS y los partes de
  -- turno). Cada persona lee los suyos; de los de otros, solo el superadmin.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notif_select_self_or_staff') THEN
    EXECUTE 'ALTER POLICY notif_select_self_or_staff ON public.notifications
             USING (auth.uid() = user_id OR public.has_role(auth.uid(), ''superadmin''::public.app_role))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notif_staff_all') THEN
    EXECUTE 'ALTER POLICY notif_staff_all ON public.notifications USING (public.has_role(auth.uid(), ''superadmin''::public.app_role))';
  END IF;

  -- ── 7) WhatsApp automático (inerte hasta que existan sus requisitos) ────────
  -- Misma función que 20261007170000, con una salida silenciosa si faltan pg_net o el secreto de Vault.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.notify_edge_function(fn_name text, payload jsonb)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
    DECLARE
      v_secret text;
    BEGIN
      IF to_regnamespace('net') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RETURN;
      END IF;
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1' INTO v_secret USING 'internal_webhook_secret';
      IF v_secret IS NULL THEN
        RETURN;
      END IF;
      EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3)'
        USING 'https://ncyzoswhszhttdoxhqdh.supabase.co/functions/v1/' || fn_name,
              jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
              payload;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_edge_function(%) failed: %', fn_name, SQLERRM;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.notify_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated';

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.trg_clinical_alerts_notify()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    BEGIN
      PERFORM public.notify_edge_function('clinical-alert-notify', jsonb_build_object('record', to_jsonb(NEW)));
      RETURN NULL;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.trg_clinical_alerts_notify() FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP TRIGGER IF EXISTS clinical_alerts_notify_webhook ON public.clinical_alerts';
  -- Solo el SOS: las alertas automáticas de signos vitales pasarán por el mismo gancho cuando se decida (quitar el WHEN).
  EXECUTE 'CREATE TRIGGER clinical_alerts_notify_webhook AFTER INSERT ON public.clinical_alerts
           FOR EACH ROW WHEN (NEW.alert_type = ''sos_manual'') EXECUTE FUNCTION public.trg_clinical_alerts_notify()';
END
$hx_sos$;
