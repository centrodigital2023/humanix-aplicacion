-- «Conectar con Firux Pay» (preparación, detrás de FIRUX_CONNECT_ENABLED en el servidor).
--
-- 1. professional_firux_connections: la cuenta Firux de cada profesional y su aceptación de la comisión. Solo la
--    escribe el servidor (service_role); el profesional y el staff la leen.
-- 2. firux_charges.route / firux_account_id / application_fee_cop: con qué credencial se creó el cobro.
-- 3. hx_queue_payout: un turno cobrado por la cuenta conectada del profesional NO entra a la cola payouts (el dinero
--    ya le llegó directo). Todo lo demás sigue igual: la cola es el respaldo.
-- 4. hx_firux_charge_paid: mismo cuerpo que en producción (20261103160000); solo cambia el texto del aviso al
--    profesional cuando el cobro fue conectado.
--
-- Idempotente: se puede aplicar dos veces.

CREATE TABLE IF NOT EXISTS public.professional_firux_connections (
  professional_id uuid PRIMARY KEY,
  firux_account_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  commission_terms_version text,
  commission_accepted_at timestamptz,
  -- Hash SHA-256 del `state` de un solo uso del flujo de conexión (nunca el valor en claro).
  connect_state_hash text,
  connect_state_expires_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.professional_firux_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.professional_firux_connections FROM anon, authenticated;
GRANT SELECT ON public.professional_firux_connections TO authenticated;
GRANT ALL ON public.professional_firux_connections TO service_role;

DROP POLICY IF EXISTS pfc_read ON public.professional_firux_connections;
CREATE POLICY pfc_read ON public.professional_firux_connections
  FOR SELECT TO authenticated
  USING (auth.uid() = professional_id OR public.is_staff(auth.uid()));

ALTER TABLE public.firux_charges
  ADD COLUMN IF NOT EXISTS route text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS firux_account_id text,
  ADD COLUMN IF NOT EXISTS application_fee_cop bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firux_charges_route_check') THEN
    ALTER TABLE public.firux_charges
      ADD CONSTRAINT firux_charges_route_check CHECK (
        (route = 'platform' AND firux_account_id IS NULL)
        OR (route = 'connected' AND firux_account_id IS NOT NULL AND kind = 'booking'
            AND application_fee_cop IS NOT NULL AND application_fee_cop BETWEEN 0 AND amount_cop)
      );
  END IF;
END $$;

-- La cola payouts no aplica a turnos que el profesional ya cobró en su propia cuenta.
CREATE OR REPLACE FUNCTION public.hx_queue_payout(p_booking uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b record; k record; v_id uuid;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.payment_method <> 'DIGITAL_BREB' OR b.paid_at IS NULL OR b.status <> 'completed' OR COALESCE(b.professional_payout, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.firux_charges c
     WHERE c.id = b.firux_charge_id AND c.status = 'paid' AND c.route = 'connected'
  ) THEN
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
            CASE WHEN k.user_id IS NULL THEN 'Agrega tu llave Bre-B para recibir tu pago' ELSE 'Tu pago va en camino' END,
            CASE WHEN k.user_id IS NULL
              THEN format('Tienes %s esperando. Agrega tu llave Bre-B y te lo enviamos en segundos.', public.hx_cop(b.professional_payout))
              ELSE format('Te enviamos %s a tu llave Bre-B por el turno terminado.', public.hx_cop(b.professional_payout)) END,
            '/dashboard/profesional');
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.hx_firux_charge_paid(p_firux_id text, p_amount_paid bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; v_end timestamptz;
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
    UPDATE public.service_bookings SET paid_at = now(), firux_charge_id = c.id WHERE id = c.booking_id AND paid_at IS NULL;
    PERFORM public.hx_queue_payout(c.booking_id);
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT b.professional_id, 'booking_paid', '💚 La familia ya pagó el turno',
           CASE WHEN c.route = 'connected'
             THEN 'El pago llegó a tu cuenta Firux, ya sin la comisión de Humanix.'
             ELSE 'Al terminarlo te enviamos tu pago a tu llave Bre-B.' END,
           '/servicio/' || b.id
      FROM public.service_bookings b WHERE b.id = c.booking_id;
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
          CASE c.kind WHEN 'topup' THEN '✅ Recarga lista' WHEN 'plan' THEN '✨ Tu plan institucional está activo' ELSE '✅ Pago recibido' END,
          CASE c.kind WHEN 'topup' THEN format('Sumamos %s a tu billetera Humanix.', public.hx_cop(c.amount_cop))
                      WHEN 'plan' THEN 'Gracias por confiar en Humanix. Tu plan queda activo por un año.'
                      ELSE 'Gracias. El profesional ya sabe que el turno está pago.' END,
          CASE c.kind WHEN 'booking' THEN '/servicio/' || c.booking_id ELSE '/dashboard' END);
  RETURN 'applied';
END $function$;

REVOKE ALL ON FUNCTION public.hx_firux_charge_paid(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_firux_charge_paid(text, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.hx_queue_payout(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_queue_payout(uuid) TO service_role;
