-- ═══════════════════════════════════════════════════════════════════════════════
-- Flujo del servicio en vivo (tipo InDrive): Pedido → Aceptado → En camino → Cuidando → Terminado.
--
-- Diagnóstico (lectura en producción, 2026-10-24): `service_bookings` y `notifications` ya están en la
-- publicación `supabase_realtime` y el aviso `booking_requested` se crea al insertar la reserva. Lo que
-- faltaba:
--   1. `service_bookings`, `care_logs` y `job_offer_shifts` con REPLICA IDENTITY por defecto: los UPDATE
--      llegan sin la fila anterior (`old`), así que la pantalla no puede saber de qué estado venía.
--   2. El aviso al profesional decía solo «Una familia solicita tu servicio»: sin horas, valor ni forma de
--      pago, y también para las solicitudes de una EPS/IPS.
--   3. La familia o la EPS/IPS no recibía ningún aviso cuando el profesional ACEPTABA ni cuando salía
--      EN CAMINO (sí al empezar y al terminar el turno, por `booking_care_events`).
--
-- Es idempotente. No crea tablas ni cambia permisos ni reglas de transición (las sigue imponiendo
-- `guard_booking_integrity`). Realtime respeta RLS: cada suscriptor solo recibe las filas que puede leer.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1) Realtime: fila completa en UPDATE/DELETE y tablas publicadas ─────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_bookings', 'care_logs', 'job_offer_shifts', 'notifications'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que publicar';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['service_bookings', 'notifications', 'care_logs', 'job_offers', 'job_offer_shifts', 'messages'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL
       OR EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo publicar public.%: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- ─── 2) Aviso al profesional con los detalles del pedido ─────────────────────────
-- Reemplaza la versión de `drizzle/migrations/0020_notify_direct_booking_request.sql` (mismo nombre y
-- disparador). Dice quién pide (familia o EPS/IPS), horas, valor y forma de pago; nunca la dirección ni
-- el teléfono (el profesional ve la dirección en la página del servicio). `meta` lleva lo que la alerta
-- flotante necesita para mostrarse sin otra consulta.
CREATE OR REPLACE FUNCTION public.notify_direct_booking_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_origin text;
  v_who    text;
  v_pay    text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  v_origin := CASE WHEN EXISTS (SELECT 1 FROM public.user_roles r
                                 WHERE r.user_id = NEW.client_id AND r.role::text = 'institution')
                   THEN 'institution' ELSE 'family' END;
  v_who := CASE v_origin WHEN 'institution' THEN 'Una EPS/IPS' ELSE 'Una familia' END;
  v_pay := CASE WHEN NEW.payment_mode = 'direct_to_professional' THEN 'pago directo al terminar'
                ELSE 'pago por la plataforma' END;

  INSERT INTO public.notifications (user_id, type, title, body, link, meta)
  VALUES (
    NEW.professional_id,
    'booking_requested',
    'Nueva solicitud de servicio',
    v_who || ' te pide un turno de ' || NEW.duration_hours || ' h por ' || public.hx_cop(NEW.total_amount)
      || ' (' || v_pay || '). Acéptalo para abrir el chat y la llamada.',
    '/servicio/' || NEW.id::text,
    jsonb_build_object(
      'booking_id',     NEW.id,
      'origin',         v_origin,
      'duration_hours', NEW.duration_hours,
      'total_amount',   NEW.total_amount,
      'payment_mode',   NEW.payment_mode,
      'scheduled_at',   NEW.scheduled_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso fallido nunca debe impedir crear la reserva.
  RAISE WARNING 'notify_direct_booking_request: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_direct_booking_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_direct_booking_request() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_direct_booking_request ON public.service_bookings;
CREATE TRIGGER trg_notify_direct_booking_request
  AFTER INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_direct_booking_request();

-- ─── 3) Avisos a quien contrató: Aceptado y En camino ────────────────────────────
-- «Cuidando» y «Terminado» ya los avisa `booking_care_events`. Llega a quien contrató (familia o EPS/IPS)
-- y a su círculo de cuidado (`care_watchers`). Solo cuando el estado CAMBIA, así un reintento no duplica.
CREATE OR REPLACE FUNCTION public.booking_flow_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pro text := public.party_display_name(NEW.professional_id);
  w     record;
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    FOR w IN SELECT watcher_id, is_owner FROM public.care_watchers(NEW.client_id) LOOP
      PERFORM public.hx_notify(w.watcher_id, 'booking_accepted', v_pro || ' aceptó el servicio',
        CASE WHEN w.is_owner
          THEN 'Ya puedes escribirle y llamarle desde la página del servicio.'
          ELSE 'El servicio de tu familiar quedó confirmado.' END,
        '/servicio/' || NEW.id::text);
    END LOOP;
  ELSIF NEW.status = 'in_route' AND OLD.status IS DISTINCT FROM 'in_route' THEN
    FOR w IN SELECT watcher_id FROM public.care_watchers(NEW.client_id) LOOP
      PERFORM public.hx_notify(w.watcher_id, 'professional_on_the_way', v_pro || ' va en camino',
        'Sigue el trayecto en el mapa del servicio.', '/servicio/' || NEW.id::text);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'booking_flow_events: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.booking_flow_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_flow_events ON public.service_bookings;
CREATE TRIGGER trg_booking_flow_events
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW
  WHEN (NEW.status IN ('confirmed', 'in_route') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.booking_flow_events();
