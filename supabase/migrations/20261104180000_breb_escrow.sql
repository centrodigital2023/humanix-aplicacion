-- Pago retenido tipo InDrive para turnos por Bre-B (4 nov 2026). Ver docs/PAGOS_BREB.md y la lógica espejo en
-- src/lib/escrow.ts (probada).
--
--  · La familia paga por Bre-B desde que pide el turno. El dinero queda en la cuenta Firux de Humanix, «retenido».
--  · El profesional termina el turno (status = 'completed'). El dinero sigue retenido hasta que la familia confirma
--    («Todo bien, liberar pago»). Si la familia misma marca el turno como terminado, eso ya es su confirmación.
--  · Si la familia no dice nada, se libera solo 24 h después de terminado (pg_cron cada 10 min), con un recordatorio
--    3 h antes. Si reporta un problema dentro de esas 24 h, queda «en revisión» y lo decide el equipo de Humanix.
--  · Liberado → fila en `payouts` (la dispersión al profesional, como hoy). Cancelado con el pago adentro → fila en
--    `booking_refunds` y devolución completa a la llave Bre-B de la familia (el equipo la envía desde Firux).
--  · Efectivo no cambia: la comisión se descuenta de la billetera cuando el turno pasa a 'completed' (hx_booking_settle).
--
-- Estados de `service_bookings.escrow_status` (NULL = no aplica: efectivo o aún sin pagar):
--   held → released                (familia confirmó, liberación automática o equipo)
--   held → disputed → released | refunding
--   held → refunding → refunded    (cancelado después de pagar)
--
-- Depende de 20261103160000 (en producción). No depende de 20261104140000 (Conectar): lee `route` con to_jsonb.
-- Idempotente.

-- ─── 1) Columnas ─────────────────────────────────────────────────────────────

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS escrow_status text,
  ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_bookings'::regclass AND conname = 'service_bookings_escrow_status_check') THEN
    ALTER TABLE public.service_bookings ADD CONSTRAINT service_bookings_escrow_status_check
      CHECK (escrow_status IS NULL OR escrow_status IN ('held', 'released', 'disputed', 'refunding', 'refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_bookings'::regclass AND conname = 'service_bookings_release_reason_check') THEN
    ALTER TABLE public.service_bookings ADD CONSTRAINT service_bookings_release_reason_check
      CHECK (release_reason IS NULL OR release_reason IN ('client_confirmed', 'auto', 'staff', 'direct', 'legacy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_sb_escrow_due ON public.service_bookings (release_due_at)
  WHERE escrow_status = 'held' AND status = 'completed';

-- Turnos ya pagados antes de esta migración: los terminados se consideran liberados (ya tenían su orden de pago) y los
-- abiertos quedan retenidos.
UPDATE public.service_bookings
   SET escrow_status = CASE WHEN status = 'completed' THEN 'released'
                            WHEN status = 'cancelled' THEN 'refunding' ELSE 'held' END,
       released_at = CASE WHEN status = 'completed' THEN COALESCE(completed_at, now()) END,
       release_reason = CASE WHEN status = 'completed' THEN 'legacy' END
 WHERE payment_method = 'DIGITAL_BREB' AND paid_at IS NOT NULL AND escrow_status IS NULL;

-- Ventana de confirmación de la familia y recordatorio previo.
CREATE OR REPLACE FUNCTION public.hx_escrow_window()
RETURNS interval LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT interval '24 hours'; $$;
CREATE OR REPLACE FUNCTION public.hx_escrow_reminder_lead()
RETURNS interval LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT interval '3 hours'; $$;

-- ─── 2) Lo financiero lo cambia solo el servidor ─────────────────────────────
-- Igual que en 20261103160000, más las columnas de retención. Las funciones de esta migración que escriben la
-- retención con la sesión de la familia encienden `hx.escrow` solo dentro de su transacción.

CREATE OR REPLACE FUNCTION public.guard_service_bookings_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) OR current_setting('hx.escrow', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.total_amount          := OLD.total_amount;
  NEW.hourly_rate           := OLD.hourly_rate;
  NEW.platform_fee_amount   := OLD.platform_fee_amount;
  NEW.platform_fee_pct      := OLD.platform_fee_pct;
  NEW.professional_payout   := OLD.professional_payout;
  NEW.payment_mode          := OLD.payment_mode;
  NEW.payment_method        := OLD.payment_method;
  NEW.commission_exempt_cop := OLD.commission_exempt_cop;
  NEW.paid_at               := OLD.paid_at;
  NEW.firux_charge_id       := OLD.firux_charge_id;
  NEW.client_id             := OLD.client_id;
  NEW.professional_id       := OLD.professional_id;
  NEW.escrow_status         := OLD.escrow_status;
  NEW.client_confirmed_at   := OLD.client_confirmed_at;
  NEW.release_due_at        := OLD.release_due_at;
  NEW.release_reminded_at   := OLD.release_reminded_at;
  NEW.released_at           := OLD.released_at;
  NEW.release_reason        := OLD.release_reason;
  NEW.disputed_at           := OLD.disputed_at;
  NEW.dispute_reason        := OLD.dispute_reason;
  RETURN NEW;
END $$;

-- En un INSERT nadie trae la retención puesta (la escribe solo el pago confirmado).
CREATE OR REPLACE FUNCTION public.hx_booking_escrow_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    NEW.escrow_status := NULL; NEW.client_confirmed_at := NULL; NEW.release_due_at := NULL;
    NEW.release_reminded_at := NULL; NEW.released_at := NULL; NEW.release_reason := NULL;
    NEW.disputed_at := NULL; NEW.dispute_reason := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_escrow_insert ON public.service_bookings;
CREATE TRIGGER trg_sb_escrow_insert BEFORE INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_booking_escrow_insert();

-- ─── 3) Llave Bre-B de la familia para devoluciones ──────────────────────────

CREATE TABLE IF NOT EXISTS public.client_refund_keys (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  key_type    text NOT NULL CHECK (key_type IN ('phone', 'document', 'email', 'alias')),
  key_value   text NOT NULL,
  holder_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_refund_keys_format CHECK (
    (key_type = 'phone'    AND key_value ~ '^3[0-9]{9}$') OR
    (key_type = 'document' AND key_value ~ '^[0-9]{5,10}$') OR
    (key_type = 'email'    AND key_value ~* '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' AND length(key_value) <= 120) OR
    (key_type = 'alias'    AND key_value ~ '^@[a-z0-9._-]{3,20}$')
  )
);
ALTER TABLE public.client_refund_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crk_own ON public.client_refund_keys;
CREATE POLICY crk_own ON public.client_refund_keys FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS crk_staff_read ON public.client_refund_keys;
CREATE POLICY crk_staff_read ON public.client_refund_keys FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.client_refund_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_refund_keys TO authenticated;
GRANT ALL ON public.client_refund_keys TO service_role;

-- ─── 4) Devoluciones ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid REFERENCES public.service_bookings (id) ON DELETE SET NULL,
  charge_id    uuid UNIQUE REFERENCES public.firux_charges (id) ON DELETE SET NULL,
  client_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  amount_cop   bigint NOT NULL CHECK (amount_cop > 0),
  reason       text NOT NULL CHECK (reason IN ('cancelled', 'dispute', 'duplicate')),
  key_type     text,
  key_value    text,
  status       text NOT NULL DEFAULT 'needs_key' CHECK (status IN ('needs_key', 'queued', 'paid', 'failed')),
  provider_ref text,
  error_code   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_booking_refunds_booking ON public.booking_refunds (booking_id);
CREATE INDEX IF NOT EXISTS ix_booking_refunds_client ON public.booking_refunds (client_id, created_at DESC);
ALTER TABLE public.booking_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_refunds_read ON public.booking_refunds;
CREATE POLICY booking_refunds_read ON public.booking_refunds FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR public.is_staff(auth.uid()));
REVOKE ALL ON public.booking_refunds FROM anon, authenticated;
GRANT SELECT ON public.booking_refunds TO authenticated;
GRANT ALL ON public.booking_refunds TO service_role;

-- Devolución completa de un cobro pagado del turno (una por cobro). Sin llave queda `needs_key` y se le pide.
CREATE OR REPLACE FUNCTION public.hx_queue_refund(p_booking uuid, p_charge uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; c record; k record; v_id uuid; v_amount bigint;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.firux_charges WHERE id = COALESCE(p_charge, b.firux_charge_id);
  IF NOT FOUND OR c.status <> 'paid' THEN RETURN NULL; END IF;
  v_amount := COALESCE(c.amount_paid_cop, c.amount_cop);
  SELECT * INTO k FROM public.client_refund_keys WHERE user_id = c.user_id;
  INSERT INTO public.booking_refunds (booking_id, charge_id, client_id, amount_cop, reason, key_type, key_value, status)
  VALUES (b.id, c.id, c.user_id, v_amount, p_reason, k.key_type, k.key_value,
          CASE WHEN k.user_id IS NULL THEN 'needs_key' ELSE 'queued' END)
  ON CONFLICT (charge_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.hx_notify(c.user_id, 'refund_queued',
      CASE WHEN k.user_id IS NULL THEN '↩️ Te devolvemos tu pago: dinos a dónde' ELSE '↩️ Te devolvemos tu pago' END,
      CASE WHEN k.user_id IS NULL
        THEN format('Tienes %s por devolver. Escribe tu llave Bre-B en la página del servicio y te lo enviamos.', public.hx_cop(v_amount))
        ELSE format('Te devolvemos %s completo a tu llave Bre-B. Suele tardar menos de un día hábil.', public.hx_cop(v_amount)) END,
      '/servicio/' || b.id::text);
  END IF;
  RETURN v_id;
END $$;

-- La familia guarda o corrige su llave: sus devoluciones en espera toman la llave nueva.
CREATE OR REPLACE FUNCTION public.hx_refund_key_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.booking_refunds
     SET key_type = NEW.key_type, key_value = NEW.key_value, status = 'queued', updated_at = now()
   WHERE client_id = NEW.user_id AND status IN ('needs_key', 'queued', 'failed');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refund_key_sync ON public.client_refund_keys;
CREATE TRIGGER trg_refund_key_sync AFTER INSERT OR UPDATE OF key_type, key_value ON public.client_refund_keys
  FOR EACH ROW EXECUTE FUNCTION public.hx_refund_key_sync();

-- El equipo marca una devolución como enviada (con la referencia de Firux) o fallida. Solo service_role.
CREATE OR REPLACE FUNCTION public.hx_mark_refund(p_refund uuid, p_status text, p_ref text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN RETURN 'invalid_status'; END IF;
  SELECT * INTO r FROM public.booking_refunds WHERE id = p_refund FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p_status = 'paid' AND (r.status = 'needs_key' OR r.key_value IS NULL) THEN RETURN 'needs_key'; END IF;
  UPDATE public.booking_refunds
     SET status = p_status,
         provider_ref = CASE WHEN p_status = 'paid' THEN left(NULLIF(trim(p_ref), ''), 120) ELSE provider_ref END,
         error_code = CASE WHEN p_status = 'failed' THEN left(COALESCE(NULLIF(trim(p_ref), ''), 'failed'), 120) ELSE NULL END,
         updated_at = now()
   WHERE id = r.id;
  IF p_status = 'paid' AND r.reason <> 'duplicate' THEN
    UPDATE public.service_bookings SET escrow_status = 'refunded' WHERE id = r.booking_id AND escrow_status = 'refunding';
  END IF;
  PERFORM public.hx_notify(r.client_id,
    CASE WHEN p_status = 'paid' THEN 'refund_paid' ELSE 'refund_failed' END,
    CASE WHEN p_status = 'paid' THEN '💸 Te devolvimos tu pago' ELSE 'No pudimos devolverte el pago' END,
    CASE WHEN p_status = 'paid'
      THEN format('Enviamos %s a tu llave Bre-B.', public.hx_cop(r.amount_cop))
      ELSE 'Revisa que tu llave Bre-B esté bien escrita. Cuando la corrijas, te lo enviamos de nuevo.' END,
    CASE WHEN r.booking_id IS NULL THEN '/dashboard' ELSE '/servicio/' || r.booking_id::text END);
  RETURN p_status;
END $$;

-- ─── 5) Liberación ───────────────────────────────────────────────────────────

-- La dispersión al profesional solo sale de un turno digital pagado, terminado y LIBERADO.
CREATE OR REPLACE FUNCTION public.hx_queue_payout(p_booking uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; k record; v_id uuid;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.payment_method <> 'DIGITAL_BREB' OR b.paid_at IS NULL OR b.status <> 'completed'
     OR b.escrow_status IS DISTINCT FROM 'released' OR COALESCE(b.professional_payout, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  -- Cobrado directo en la cuenta Firux del profesional («Conectar», 20261104140000): no hay nada que dispersar.
  IF EXISTS (SELECT 1 FROM public.firux_charges c
              WHERE c.id = b.firux_charge_id AND c.status = 'paid' AND to_jsonb(c) ->> 'route' = 'connected') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO k FROM public.professional_payout_keys WHERE user_id = b.professional_id;
  INSERT INTO public.payouts (professional_id, booking_id, amount_cop, key_type, key_value, status)
  VALUES (b.professional_id, b.id, b.professional_payout, k.key_type, k.key_value, CASE WHEN k.user_id IS NULL THEN 'needs_key' ELSE 'queued' END)
  ON CONFLICT (booking_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (b.professional_id, 'payout_queued',
            CASE WHEN k.user_id IS NULL THEN 'Agrega tu llave Bre-B para recibir tu pago' ELSE '💸 Pago liberado: va en camino' END,
            CASE WHEN k.user_id IS NULL
              THEN format('Tienes %s liberados esperando. Agrega tu llave Bre-B y te los enviamos.', public.hx_cop(b.professional_payout))
              ELSE format('Liberamos %s por el turno terminado. Te los enviamos a tu llave Bre-B.', public.hx_cop(b.professional_payout)) END,
            '/dashboard/profesional');
  END IF;
  RETURN v_id;
END $$;

-- Libera el pago retenido de un turno terminado. Única puerta hacia `payouts` para turnos digitales.
CREATE OR REPLACE FUNCTION public.hx_escrow_release(p_booking uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; v_pro text;
BEGIN
  IF p_reason NOT IN ('client_confirmed', 'auto', 'staff') THEN RETURN 'invalid_reason'; END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF b.escrow_status = 'released' THEN RETURN 'already_released'; END IF;
  IF b.status <> 'completed' OR b.escrow_status NOT IN ('held', 'disputed') THEN RETURN 'not_releasable'; END IF;
  -- Una liberación automática nunca pasa por encima de un reclamo.
  IF p_reason = 'auto' AND b.escrow_status = 'disputed' THEN RETURN 'disputed'; END IF;

  PERFORM set_config('hx.escrow', 'on', true);
  UPDATE public.service_bookings
     SET escrow_status = 'released', released_at = now(), release_reason = p_reason,
         client_confirmed_at = CASE WHEN p_reason = 'client_confirmed' THEN COALESCE(client_confirmed_at, now()) ELSE client_confirmed_at END
   WHERE id = b.id;
  PERFORM set_config('hx.escrow', 'off', true);

  PERFORM public.hx_queue_payout(b.id);
  v_pro := split_part(COALESCE(public.party_display_name(b.professional_id), 'el profesional'), ' ', 1);
  IF p_reason = 'auto' THEN
    PERFORM public.hx_notify(b.client_id, 'escrow_released', '✅ Liberamos el pago del turno',
      format('Pasaron 24 h sin reportes, así que le entregamos su pago a %s. ¡Gracias por cuidar con Humanix!', v_pro),
      '/servicio/' || b.id::text);
  ELSIF p_reason = 'staff' THEN
    PERFORM public.hx_notify(b.client_id, 'escrow_released', 'Revisamos tu reporte',
      format('El equipo de Humanix revisó el turno y liberó el pago a %s. Si tienes dudas, escríbenos.', v_pro),
      '/servicio/' || b.id::text);
  END IF;
  RETURN 'released';
END $$;

-- ─── 6) Lo que hace la familia ───────────────────────────────────────────────

-- «Todo bien, liberar pago». Solo quien contrató, con el turno terminado. En efectivo solo deja la constancia.
CREATE OR REPLACE FUNCTION public.hx_confirm_booking_done(p_booking uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); b record;
BEGIN
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.client_id <> v_uid THEN RETURN 'forbidden'; END IF;
  IF b.status <> 'completed' THEN RETURN 'not_completed'; END IF;
  IF b.escrow_status IN ('held', 'disputed') THEN
    RETURN public.hx_escrow_release(b.id, 'client_confirmed');
  END IF;
  IF b.client_confirmed_at IS NULL THEN
    PERFORM set_config('hx.escrow', 'on', true);
    UPDATE public.service_bookings SET client_confirmed_at = now() WHERE id = b.id;
    PERFORM set_config('hx.escrow', 'off', true);
  END IF;
  RETURN CASE WHEN b.escrow_status = 'released' THEN 'already_released' ELSE 'confirmed' END;
END $$;

-- «Hubo un problema». Pausa la liberación automática y avisa al equipo y al profesional.
CREATE OR REPLACE FUNCTION public.hx_report_booking_problem(p_booking uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); b record; v_reason text := left(trim(COALESCE(p_reason, '')), 500); s record;
BEGIN
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.client_id <> v_uid THEN RETURN 'forbidden'; END IF;
  IF length(v_reason) < 5 THEN RETURN 'reason_required'; END IF;
  IF b.escrow_status = 'disputed' THEN RETURN 'already_disputed'; END IF;
  IF b.status <> 'completed' OR b.escrow_status IS DISTINCT FROM 'held' THEN RETURN 'not_disputable'; END IF;
  IF b.release_due_at IS NOT NULL AND b.release_due_at <= now() THEN RETURN 'window_closed'; END IF;

  PERFORM set_config('hx.escrow', 'on', true);
  UPDATE public.service_bookings
     SET escrow_status = 'disputed', disputed_at = now(), dispute_reason = v_reason
   WHERE id = b.id;
  PERFORM set_config('hx.escrow', 'off', true);

  PERFORM public.hx_notify(b.professional_id, 'escrow_disputed', 'La familia reportó un problema con el turno',
    'Tu pago queda en pausa mientras el equipo de Humanix lo revisa. Te escribimos pronto.', '/servicio/' || b.id::text);
  PERFORM public.hx_notify(b.client_id, 'escrow_dispute_received', 'Recibimos tu reporte',
    'El pago queda retenido mientras lo revisamos. Te escribimos en menos de un día hábil.', '/servicio/' || b.id::text);
  FOR s IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'superadmin' LOOP
    PERFORM public.hx_notify(s.user_id, 'escrow_disputed_staff', 'Reclamo en un turno pagado',
      format('Turno de %s con pago retenido: «%s».', public.hx_cop(b.total_amount), left(v_reason, 120)), '/superadmin/pagos');
  END LOOP;
  RETURN 'disputed';
END $$;

-- El equipo decide un reclamo (o un turno retenido): liberar al profesional o devolver todo a la familia. Solo
-- service_role (el servidor verifica antes que quien decide sea staff).
CREATE OR REPLACE FUNCTION public.hx_escrow_resolve(p_booking uuid, p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  IF p_action NOT IN ('release', 'refund') THEN RETURN 'invalid_action'; END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF b.escrow_status NOT IN ('held', 'disputed') THEN RETURN 'not_open'; END IF;
  IF p_action = 'release' THEN
    RETURN public.hx_escrow_release(b.id, 'staff');
  END IF;
  UPDATE public.service_bookings SET escrow_status = 'refunding' WHERE id = b.id;
  PERFORM public.hx_queue_refund(b.id, NULL, 'dispute');
  PERFORM public.hx_notify(b.professional_id, 'escrow_refunded', 'Revisamos el reporte del turno',
    'El equipo de Humanix decidió devolver el pago a la familia. Si no estás de acuerdo, escríbenos.', '/servicio/' || b.id::text);
  RETURN 'refunding';
END $$;

-- ─── 7) Cambios de estado del turno ──────────────────────────────────────────

-- ANTES del cambio (corre después de trg_guard_*, por orden alfabético): fija la ventana o libera de una vez.
CREATE OR REPLACE FUNCTION public.hx_booking_escrow_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'completed' THEN
    -- La familia marcó el turno como terminado: eso ya es su confirmación.
    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.client_id AND NEW.client_confirmed_at IS NULL THEN
      NEW.client_confirmed_at := now();
    END IF;
    IF NEW.escrow_status = 'held' THEN
      IF NEW.client_confirmed_at IS NOT NULL THEN
        NEW.escrow_status := 'released'; NEW.released_at := now(); NEW.release_reason := 'client_confirmed';
      ELSE
        NEW.release_due_at := now() + public.hx_escrow_window();
      END IF;
    END IF;
  ELSIF NEW.status = 'cancelled' AND NEW.escrow_status IN ('held', 'disputed') THEN
    NEW.escrow_status := 'refunding';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_escrow ON public.service_bookings;
CREATE TRIGGER trg_sb_escrow BEFORE UPDATE OF status ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_booking_escrow_before();

-- DESPUÉS del cambio: avisos y devolución. La orden de pago la crea trg_sb_settle → hx_queue_payout (solo si liberado).
CREATE OR REPLACE FUNCTION public.hx_booking_escrow_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro text := split_part(COALESCE(public.party_display_name(NEW.professional_id), 'el profesional'), ' ', 1);
BEGIN
  IF NEW.status = 'completed' AND NEW.escrow_status = 'held' THEN
    PERFORM public.hx_notify(NEW.client_id, 'escrow_confirm_needed', format('¿Todo bien con el turno de %s?', v_pro),
      format('Confirma que terminó para liberarle su pago. Si algo salió mal, cuéntanos: tienes 24 h. Si no nos dices nada, lo liberamos solo.'),
      '/servicio/' || NEW.id::text);
    PERFORM public.hx_notify(NEW.professional_id, 'escrow_awaiting_client', '⏳ Turno terminado: pago por liberar',
      format('La familia tiene 24 h para confirmar. Apenas lo haga (o al cumplirse el plazo) liberamos tus %s.',
             public.hx_cop(COALESCE(NEW.professional_payout, 0))),
      '/servicio/' || NEW.id::text);
  ELSIF NEW.status = 'cancelled' AND NEW.escrow_status = 'refunding' THEN
    PERFORM public.hx_queue_refund(NEW.id, NULL, 'cancelled');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso o una devolución fallida nunca deben impedir terminar o cancelar el turno; queda en el registro.
  RAISE WARNING 'hx_booking_escrow_after: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_escrow_after ON public.service_bookings;
CREATE TRIGGER trg_sb_escrow_after AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.hx_booking_escrow_after();

-- ─── 8) Pago confirmado por Firux ────────────────────────────────────────────
-- Mismo cuerpo que 20261104140000 para recargas y planes. En turnos: el pago queda retenido; si el turno ya se
-- canceló, o ya estaba pago con otro cobro, se devuelve.

CREATE OR REPLACE FUNCTION public.hx_firux_charge_paid(p_firux_id text, p_amount_paid bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; b record; v_end timestamptz; v_state text; v_direct boolean; v_pro text;
BEGIN
  SELECT * INTO c FROM public.firux_charges WHERE firux_id = p_firux_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown_charge'; END IF;
  IF c.status = 'paid' THEN RETURN 'already_applied'; END IF;
  IF COALESCE(p_amount_paid, 0) < c.amount_cop THEN
    UPDATE public.firux_charges SET status = 'underpaid', amount_paid_cop = p_amount_paid WHERE id = c.id;
    RETURN 'underpaid';
  END IF;
  UPDATE public.firux_charges SET status = 'paid', amount_paid_cop = p_amount_paid, paid_at = now() WHERE id = c.id;

  IF c.kind = 'booking' THEN
    SELECT * INTO b FROM public.service_bookings WHERE id = c.booking_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'applied';
    END IF;
    IF b.paid_at IS NOT NULL AND b.firux_charge_id IS DISTINCT FROM c.id THEN
      -- Dos QR pagados para el mismo turno: el segundo se devuelve completo.
      PERFORM public.hx_queue_refund(b.id, c.id, 'duplicate');
      RETURN 'duplicate_refund';
    END IF;
    v_direct := to_jsonb(c) ->> 'route' = 'connected';
    v_state := CASE
      WHEN v_direct THEN 'released'
      WHEN b.status = 'cancelled' THEN 'refunding'
      WHEN b.status = 'completed' AND b.client_confirmed_at IS NOT NULL THEN 'released'
      ELSE 'held' END;
    UPDATE public.service_bookings
       SET paid_at = now(), firux_charge_id = c.id, escrow_status = v_state,
           released_at = CASE WHEN v_state = 'released' THEN now() END,
           release_reason = CASE WHEN v_direct THEN 'direct' WHEN v_state = 'released' THEN 'client_confirmed' END,
           release_due_at = CASE WHEN v_state = 'held' AND b.status = 'completed' THEN now() + public.hx_escrow_window() END
     WHERE id = b.id;

    IF v_state = 'refunding' THEN
      PERFORM public.hx_queue_refund(b.id, c.id, 'cancelled');
    ELSE
      PERFORM public.hx_queue_payout(b.id);
      v_pro := split_part(COALESCE(public.party_display_name(b.professional_id), 'el profesional'), ' ', 1);
      PERFORM public.hx_notify(b.professional_id, 'booking_paid',
        CASE WHEN v_direct THEN '💚 La familia ya pagó el turno' ELSE '🔒 Pago asegurado' END,
        CASE WHEN v_direct THEN 'El pago llegó a tu cuenta Firux, ya sin la comisión de Humanix.'
             WHEN b.status = 'pending' THEN format('La familia ya pagó %s. Acepta el turno: Humanix guarda el dinero y te lo libera al terminar.', public.hx_cop(b.total_amount))
             ELSE format('La familia ya pagó %s. Humanix lo guarda y te lo libera cuando la familia confirme que terminaste (máximo 24 h después).', public.hx_cop(b.total_amount)) END,
        '/servicio/' || b.id::text);
      PERFORM public.hx_notify(c.user_id, 'payment_approved', '🔒 Pago recibido y protegido',
        CASE WHEN b.status = 'pending'
          THEN format('Humanix guarda tu pago. %s lo recibe solo cuando confirmes que el turno terminó. Si no acepta, te devolvemos todo.', v_pro)
          ELSE format('Humanix guarda tu pago. %s lo recibe solo cuando confirmes que el turno terminó.', v_pro) END,
        '/servicio/' || b.id::text);
    END IF;
    RETURN 'applied';
  ELSIF c.kind = 'topup' THEN
    PERFORM public.hx_wallet_apply(c.user_id, 'topup', c.amount_cop, NULL, c.id, 'Recarga por Bre-B');
  ELSIF c.kind = 'plan' THEN
    SELECT GREATEST(COALESCE(s.current_period_end, now()), now()) + interval '1 year' INTO v_end
      FROM (SELECT 1) x LEFT JOIN public.mp_subscriptions s ON s.user_id = c.user_id AND s.status IN ('active', 'approved');
    INSERT INTO public.mp_subscriptions AS s (user_id, plan, amount, currency, status, current_period_end, next_payment_at)
    VALUES (c.user_id, c.plan_key, c.amount_cop, 'COP', 'active', v_end, v_end)
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, amount = EXCLUDED.amount, currency = 'COP', status = 'active',
      current_period_end = EXCLUDED.current_period_end, next_payment_at = EXCLUDED.next_payment_at, updated_at = now();
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (c.user_id, 'payment_approved',
          CASE c.kind WHEN 'topup' THEN '✅ Recarga lista' ELSE '✨ Tu plan institucional está activo' END,
          CASE c.kind WHEN 'topup' THEN format('Sumamos %s a tu billetera Humanix.', public.hx_cop(c.amount_cop))
                      ELSE 'Gracias por confiar en Humanix. Tu plan queda activo por un año.' END,
          '/dashboard');
  RETURN 'applied';
END $$;

-- ─── 9) Reloj: recordatorio y liberación automática ──────────────────────────

CREATE OR REPLACE FUNCTION public.hx_escrow_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n integer := 0; v_pro text;
BEGIN
  FOR r IN SELECT id, client_id, professional_id FROM public.service_bookings
            WHERE escrow_status = 'held' AND status = 'completed' AND release_reminded_at IS NULL
              AND release_due_at > now() AND release_due_at - public.hx_escrow_reminder_lead() <= now()
  LOOP
    UPDATE public.service_bookings SET release_reminded_at = now() WHERE id = r.id;
    v_pro := split_part(COALESCE(public.party_display_name(r.professional_id), 'el profesional'), ' ', 1);
    PERFORM public.hx_notify(r.client_id, 'escrow_confirm_needed', '⏰ Quedan 3 h para revisar el turno',
      format('Si todo salió bien, confirma y le liberamos su pago a %s. Si no nos dices nada, lo liberamos solo.', v_pro),
      '/servicio/' || r.id::text);
  END LOOP;

  FOR r IN SELECT id FROM public.service_bookings
            WHERE escrow_status = 'held' AND status = 'completed' AND release_due_at <= now()
            ORDER BY release_due_at LIMIT 500
  LOOP
    IF public.hx_escrow_release(r.id, 'auto') = 'released' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hx-escrow-tick';
    PERFORM cron.schedule('hx-escrow-tick', '*/10 * * * *', 'SELECT public.hx_escrow_tick()');
  END IF;
END $$;

-- ─── 10) Permisos ────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.hx_escrow_window() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_escrow_reminder_lead() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_escrow_window(), public.hx_escrow_reminder_lead() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_service_bookings_financials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_escrow_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_escrow_before() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_escrow_after() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_refund_key_sync() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.hx_queue_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_mark_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_queue_payout(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_escrow_release(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_escrow_resolve(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_escrow_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_firux_charge_paid(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_queue_refund(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_mark_refund(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_queue_payout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_escrow_release(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_escrow_resolve(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_escrow_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_firux_charge_paid(text, bigint) TO service_role;

-- La familia (con sesión) confirma o reporta.
REVOKE ALL ON FUNCTION public.hx_confirm_booking_done(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_report_booking_problem(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_confirm_booking_done(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_report_booking_problem(uuid, text) TO authenticated, service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'booking_refunds') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_refunds;
  END IF;
END $$;
