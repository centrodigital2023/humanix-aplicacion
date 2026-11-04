-- «Acciones del servicio» (4 nov 2026): reprogramar, reportar un problema y no cancelar a mitad del turno.
-- Va después de 20261104180000_breb_escrow.sql y usa lo suyo (devolución automática al cancelar, reclamo del pago retenido).
-- Idempotente. Espejo de pantalla en src/lib/serviceActions.ts.
--
--  1. Reprogramar: una parte (familia, EPS/IPS o profesional) propone otra fecha y hora; la otra la acepta o la rechaza.
--     Solo en «Pedido» o «Aceptado». Al aceptar se mueve `scheduled_at`; la duración, el valor, la comisión y el pago
--     (retenido o en efectivo) no cambian. El choque de horario lo sigue impidiendo guard_booking_integrity. A lo sumo una
--     propuesta abierta por turno; una nueva reemplaza a la anterior y vencen solas si el turno avanza o se cancela.
--  2. Reportar un problema durante el turno (o hasta 72 h después de terminado), por cualquiera de las dos partes y con
--     cualquier medio de pago: abre un radicado PQRS ligado al turno y avisa al equipo. El reclamo del pago retenido
--     (hx_report_booking_problem, familia, turno terminado) sigue siendo del hilo de pago retenido.
--  3. Ya «Cuidando» no se cancela desde la app: si el turno empezó, lo que procede es reportar un problema y el equipo
--     decide (liberar o devolver con hx_escrow_resolve). Evita devolver el 100 % de un turno que sí se prestó.
--
-- Cancelar sigue siendo UPDATE status = 'cancelled' (lo hace la pantalla). Lo que pasa con el dinero ya lo resuelven los
-- disparadores existentes: Bre-B retenido → 'refunding' + booking_refunds (trg_sb_escrow / trg_sb_escrow_after); efectivo →
-- la comisión deja de estar apartada porque hx_wallet_reserved solo cuenta turnos abiertos.

-- ─── 1) Reprogramar ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_reschedule_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  previous_at  timestamptz NOT NULL,
  proposed_at  timestamptz NOT NULL,
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reschedule_one_open
  ON public.booking_reschedule_requests (booking_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_reschedule_booking ON public.booking_reschedule_requests (booking_id, created_at DESC);

ALTER TABLE public.booking_reschedule_requests ENABLE ROW LEVEL SECURITY;

-- Lectura: las partes del servicio y el equipo. Escritura: solo por las funciones de abajo.
DROP POLICY IF EXISTS reschedule_select_parties ON public.booking_reschedule_requests;
CREATE POLICY reschedule_select_parties ON public.booking_reschedule_requests
  FOR SELECT TO authenticated USING (
    public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.service_bookings b
       WHERE b.id = booking_id AND auth.uid() IN (b.client_id, b.professional_id)
    )
  );

REVOKE ALL ON public.booking_reschedule_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_reschedule_requests TO authenticated;
GRANT ALL ON public.booking_reschedule_requests TO service_role;

-- Proponer una nueva hora. Devuelve el id de la propuesta.
CREATE OR REPLACE FUNCTION public.hx_request_reschedule(p_booking uuid, p_new_at timestamptz, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  b      public.service_bookings%ROWTYPE;
  v_peer uuid;
  v_id   uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;

  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR v_uid NOT IN (b.client_id, b.professional_id) THEN
    RAISE EXCEPTION 'Solo las partes del servicio pueden reprogramarlo' USING ERRCODE = '42501';
  END IF;
  IF b.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Solo se puede reprogramar antes de que el profesional salga' USING ERRCODE = '23514';
  END IF;
  IF p_new_at IS NULL OR p_new_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'Elige una hora con al menos una hora de anticipación' USING ERRCODE = '22023';
  END IF;
  IF p_new_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Elige una fecha dentro de los próximos 90 días' USING ERRCODE = '22023';
  END IF;
  IF p_new_at = b.scheduled_at THEN
    RAISE EXCEPTION 'Esa ya es la hora del turno' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'La nota puede tener hasta 300 caracteres' USING ERRCODE = '22023';
  END IF;

  -- Una propuesta nueva reemplaza la abierta (de cualquiera de las dos partes).
  UPDATE public.booking_reschedule_requests
     SET status = 'withdrawn', decided_at = now()
   WHERE booking_id = b.id AND status = 'pending';

  INSERT INTO public.booking_reschedule_requests (booking_id, requested_by, previous_at, proposed_at, note)
  VALUES (b.id, v_uid, b.scheduled_at, p_new_at, v_note)
  RETURNING id INTO v_id;

  v_peer := CASE WHEN v_uid = b.client_id THEN b.professional_id ELSE b.client_id END;
  INSERT INTO public.notifications (user_id, type, title, body, link, meta)
  VALUES (v_peer, 'booking_reschedule_requested', '🗓️ Te proponen otra hora para el turno',
          format('Nueva hora propuesta: %s. Acéptala o recházala desde el servicio.',
                 to_char(p_new_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI')),
          '/servicio/' || b.id, jsonb_build_object('booking_id', b.id, 'request_id', v_id));

  RETURN v_id;
END $$;

-- Aceptar o rechazar (la otra parte) o retirar (quien la propuso).
CREATE OR REPLACE FUNCTION public.hx_answer_reschedule(p_request uuid, p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  r     public.booking_reschedule_requests%ROWTYPE;
  b     public.service_bookings%ROWTYPE;
  v_new text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF p_action NOT IN ('accept', 'decline', 'withdraw') THEN
    RAISE EXCEPTION 'Acción no válida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.booking_reschedule_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Propuesta no encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = r.booking_id FOR UPDATE;
  IF v_uid NOT IN (b.client_id, b.professional_id) THEN
    RAISE EXCEPTION 'Solo las partes del servicio pueden responder' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta propuesta ya no está abierta' USING ERRCODE = '23514';
  END IF;

  IF p_action = 'withdraw' THEN
    IF v_uid <> r.requested_by THEN
      RAISE EXCEPTION 'Solo quien propuso la hora puede retirarla' USING ERRCODE = '42501';
    END IF;
    UPDATE public.booking_reschedule_requests SET status = 'withdrawn', decided_at = now() WHERE id = r.id;
    RETURN 'withdrawn';
  END IF;

  IF v_uid = r.requested_by THEN
    RAISE EXCEPTION 'La otra parte es quien acepta o rechaza la nueva hora' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'accept' THEN
    IF b.status NOT IN ('pending', 'confirmed') OR r.proposed_at < now() + interval '15 minutes' THEN
      UPDATE public.booking_reschedule_requests SET status = 'expired', decided_at = now() WHERE id = r.id;
      RETURN 'expired';
    END IF;
    -- guard_booking_integrity rechaza la nueva hora si el profesional ya tiene otro turno en ese horario.
    UPDATE public.service_bookings SET scheduled_at = r.proposed_at WHERE id = b.id;
    UPDATE public.booking_reschedule_requests SET status = 'accepted', decided_at = now() WHERE id = r.id;
    v_new := 'accepted';
  ELSE
    UPDATE public.booking_reschedule_requests SET status = 'declined', decided_at = now() WHERE id = r.id;
    v_new := 'declined';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link, meta)
  VALUES (r.requested_by,
          'booking_reschedule_' || v_new,
          CASE WHEN v_new = 'accepted' THEN '✅ Aceptaron la nueva hora' ELSE 'La nueva hora no fue aceptada' END,
          CASE WHEN v_new = 'accepted'
               THEN format('El turno quedó para el %s.', to_char(r.proposed_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'))
               ELSE 'El turno sigue en la hora original. Puedes proponer otra o cancelarlo.' END,
          '/servicio/' || b.id, jsonb_build_object('booking_id', b.id, 'request_id', r.id));
  RETURN v_new;
END $$;

-- Si el turno deja de estar en «Pedido»/«Aceptado», las propuestas abiertas vencen solas.
CREATE OR REPLACE FUNCTION public.hx_reschedule_expire_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    UPDATE public.booking_reschedule_requests
       SET status = 'expired', decided_at = now()
     WHERE booking_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reschedule_expire ON public.service_bookings;
CREATE TRIGGER trg_reschedule_expire AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION public.hx_reschedule_expire_on_status();

REVOKE EXECUTE ON FUNCTION public.hx_request_reschedule(uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hx_answer_reschedule(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hx_reschedule_expire_on_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_request_reschedule(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hx_answer_reschedule(uuid, text) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_reschedule_requests;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- ─── 2) Reportar un problema ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_issue_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL,
  side        text NOT NULL CHECK (side IN ('client', 'professional')),
  kind        text NOT NULL CHECK (kind IN ('no_show', 'late', 'safety', 'care_quality', 'payment', 'other')),
  detail      text NOT NULL CHECK (char_length(detail) BETWEEN 5 AND 500),
  ticket_id   uuid REFERENCES public.pqrs_tickets(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_issue_reports_booking ON public.booking_issue_reports (booking_id, created_at DESC);

ALTER TABLE public.booking_issue_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS issue_reports_select_own ON public.booking_issue_reports;
CREATE POLICY issue_reports_select_own ON public.booking_issue_reports
  FOR SELECT TO authenticated USING (reporter_id = auth.uid() OR public.is_staff(auth.uid()));
REVOKE ALL ON public.booking_issue_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_issue_reports TO authenticated;
GRANT ALL ON public.booking_issue_reports TO service_role;

-- Devuelve {result, radicado}. result: reported | already_reported | forbidden | not_reportable | detail_required | invalid_kind.
CREATE OR REPLACE FUNCTION public.hx_report_service_issue(p_booking uuid, p_kind text, p_detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  b         public.service_bookings%ROWTYPE;
  v_side    text;
  v_detail  text := left(btrim(COALESCE(p_detail, '')), 500);
  v_ticket  uuid;
  v_rad     text;
  v_label   text;
  v_peer    uuid;
  s         record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR v_uid NOT IN (b.client_id, b.professional_id) THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;
  v_side := CASE WHEN v_uid = b.client_id THEN 'client' ELSE 'professional' END;

  v_label := CASE p_kind
    WHEN 'no_show'      THEN CASE WHEN v_side = 'client' THEN 'El profesional no llegó' ELSE 'No me recibieron en el domicilio' END
    WHEN 'late'         THEN 'Retraso importante'
    WHEN 'safety'       THEN 'Me siento inseguro o hubo maltrato'
    WHEN 'care_quality' THEN 'Calidad del cuidado'
    WHEN 'payment'      THEN 'Problema con el pago'
    WHEN 'other'        THEN 'Otro problema'
  END;
  IF v_label IS NULL THEN RETURN jsonb_build_object('result', 'invalid_kind'); END IF;
  IF char_length(v_detail) < 5 THEN RETURN jsonb_build_object('result', 'detail_required'); END IF;

  IF NOT (
       b.status IN ('confirmed', 'in_route', 'in_progress')
    OR (b.status = 'completed' AND COALESCE(b.completed_at, b.updated_at, now()) > now() - interval '72 hours')
  ) THEN
    RETURN jsonb_build_object('result', 'not_reportable');
  END IF;

  -- Un reporte del mismo tipo por persona y turno cada 30 minutos (evita duplicados por doble toque).
  IF EXISTS (
    SELECT 1 FROM public.booking_issue_reports r
     WHERE r.booking_id = b.id AND r.reporter_id = v_uid AND r.kind = p_kind
       AND r.created_at > now() - interval '30 minutes'
  ) THEN
    SELECT t.radicado INTO v_rad FROM public.booking_issue_reports r
      LEFT JOIN public.pqrs_tickets t ON t.id = r.ticket_id
     WHERE r.booking_id = b.id AND r.reporter_id = v_uid AND r.kind = p_kind
     ORDER BY r.created_at DESC LIMIT 1;
    RETURN jsonb_build_object('result', 'already_reported', 'radicado', v_rad);
  END IF;

  INSERT INTO public.pqrs_tickets (user_id, type, subject, description, channel, safety_level, ai_category, ai_priority)
  VALUES (
    v_uid, 'queja',
    left('Turno: ' || v_label, 200),
    format(E'%s\n\nTurno %s (%s, %s, %s). Reporta: %s.',
           v_detail, b.id, b.status, COALESCE(b.payment_method, 'DIGITAL_BREB'),
           to_char(b.scheduled_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
           CASE WHEN v_side = 'client' THEN 'quien contrató' ELSE 'el profesional' END),
    'app',
    CASE WHEN p_kind = 'safety' THEN 'critical' ELSE 'review' END,
    CASE WHEN p_kind = 'payment' THEN 'facturacion' ELSE 'servicio' END,
    CASE WHEN p_kind IN ('safety', 'no_show') THEN 'high' ELSE 'medium' END
  ) RETURNING id, radicado INTO v_ticket, v_rad;

  INSERT INTO public.booking_issue_reports (booking_id, reporter_id, side, kind, detail, ticket_id)
  VALUES (b.id, v_uid, v_side, p_kind, v_detail, v_ticket);

  PERFORM public.hx_notify(v_uid, 'service_issue_received', 'Recibimos tu reporte',
    format('Radicado %s. El equipo de Humanix lo revisa y te escribe pronto.', COALESCE(v_rad, '')), '/servicio/' || b.id::text);
  -- La otra parte solo se entera de lo que necesita para actuar (llegada); un reporte de seguridad nunca se le avisa.
  IF p_kind IN ('no_show', 'late') THEN
    v_peer := CASE WHEN v_side = 'client' THEN b.professional_id ELSE b.client_id END;
    PERFORM public.hx_notify(v_peer, 'service_issue_peer', 'Hay un aviso sobre la llegada al turno',
      'Escríbele por el chat del servicio para ponerse de acuerdo. El equipo de Humanix está pendiente.', '/servicio/' || b.id::text);
  END IF;
  FOR s IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'superadmin' LOOP
    PERFORM public.hx_notify(s.user_id, 'service_issue_staff',
      CASE WHEN p_kind = 'safety' THEN '🚨 Reporte de seguridad en un turno' ELSE 'Reporte en un turno' END,
      format('%s · %s: «%s»', COALESCE(v_rad, ''), v_label, left(v_detail, 120)), '/superadmin');
  END LOOP;

  RETURN jsonb_build_object('result', 'reported', 'radicado', v_rad);
END $$;

REVOKE ALL ON FUNCTION public.hx_report_service_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_report_service_issue(uuid, text, text) TO authenticated;

-- ─── 3) No cancelar a mitad del turno ────────────────────────────────────────
-- Corre después de trg_guard_booking_integrity y antes de trg_sb_escrow (orden alfabético de disparadores BEFORE).

CREATE OR REPLACE FUNCTION public.hx_guard_cancel_in_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'in_progress' AND NEW.status = 'cancelled'
     AND auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'El turno ya empezó: en lugar de cancelarlo, reporta un problema y el equipo de Humanix decide.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.hx_guard_cancel_in_progress() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_cancel_in_progress ON public.service_bookings;
CREATE TRIGGER trg_guard_cancel_in_progress BEFORE UPDATE OF status ON public.service_bookings
  FOR EACH ROW WHEN (OLD.status = 'in_progress' AND NEW.status = 'cancelled')
  EXECUTE FUNCTION public.hx_guard_cancel_in_progress();
