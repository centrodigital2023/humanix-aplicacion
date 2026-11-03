-- Bre-B con Firux, billetera del profesional y matriz de comisiones nueva (aprobado el 3 nov 2026). Reemplaza a Mercado Pago.
-- Ver docs/PAGOS_BREB.md y la lógica espejo en src/lib/commissionMatrix.ts (probada). Pesos colombianos enteros. Idempotente.
--
--  · Comisión (la paga el profesional; la familia nunca): familia → 15 / 12 / 10 % según turnos completados del profesional en los
--    últimos 30 días; institución con plan → 12 % (sede de 1 a 9) o 10 % (10 o más). Primer turno de cada pareja: exonerado hasta
--    $30.000 si quien contrata se registró hace 90 días o menos.
--  · Turno mínimo $45.000. Pago `DIGITAL_BREB` (Firux) o `CASH` (efectivo al profesional).
--  · Efectivo: para aceptar, saldo + cupo (−$30.000) cubre la comisión; al terminar se descuenta. Por debajo de −$30.000 no hay turnos
--    nuevos.
--  · Digital: la familia paga por Firux; al terminar el turno (y estar pagado) se crea la orden de pago del neto a la llave Bre-B.
--  · Planes: familias y profesionales gratis con todas las funciones (familia = nivel Premium Familiar, profesional = nivel Pro);
--    institución con plan anual = nivel Institucional.

-- ─── 0) Planes ───────────────────────────────────────────────────────────────

-- Los montos se escriben con `public.hx_cop(numeric)`, que ya existe en producción («$45.000»).

CREATE OR REPLACE FUNCTION public.hx_paid_plans()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['institution_small_annual', 'institution_large_annual', 'institution_monthly'];
$$;

-- Nivel de funciones de cada cuenta. El estado del plan institucional sigue en `mp_subscriptions` (nombre heredado: hoy lo escribe el
-- pago confirmado por Firux, nunca el navegador).
CREATE OR REPLACE FUNCTION public.plan_key_for(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.mp_subscriptions s
       WHERE s.user_id = p_user AND s.status IN ('active', 'approved')
         AND (s.current_period_end IS NULL OR s.current_period_end > now())
         AND s.plan = ANY (public.hx_paid_plans())
    ) THEN 'institution_monthly'
    WHEN public.has_role(p_user, 'professional'::public.app_role) THEN 'pro_monthly'
    WHEN public.has_role(p_user, 'family'::public.app_role) THEN 'family_premium_monthly'
    ELSE 'free'
  END;
$$;

-- Tamaño de la sede según el plan institucional vigente: 'large' (10 o más profesionales), 'small' o NULL sin plan.
CREATE OR REPLACE FUNCTION public.hx_institution_size(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE s.plan WHEN 'institution_large_annual' THEN 'large' ELSE 'small' END
    FROM public.mp_subscriptions s
   WHERE s.user_id = p_user AND s.status IN ('active', 'approved')
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.plan = ANY (public.hx_paid_plans())
   LIMIT 1;
$$;

-- ─── 1) Comisión ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_free_commission_pct()
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 15::numeric; $$;

CREATE OR REPLACE FUNCTION public.hx_pro_completed_30d(p_professional uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.service_bookings b
   WHERE b.professional_id = p_professional AND b.status = 'completed'
     AND COALESCE(b.completed_at, b.updated_at) >= now() - interval '30 days';
$$;

CREATE OR REPLACE FUNCTION public.booking_commission_pct(p_professional uuid, p_client uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.hx_institution_size(p_client)
    WHEN 'large' THEN 10::numeric
    WHEN 'small' THEN 12::numeric
    ELSE CASE
      WHEN public.hx_pro_completed_30d(p_professional) >= 60 THEN 10::numeric
      WHEN public.hx_pro_completed_30d(p_professional) >= 20 THEN 12::numeric
      ELSE 15::numeric
    END
  END;
$$;

-- El profesional ve su porcentaje como familia (sin institución).
CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.booking_commission_pct(p_user_id, NULL);
$$;

-- Exoneración del primer turno de la pareja: hasta $30.000, si quien contrata tiene 90 días o menos.
CREATE OR REPLACE FUNCTION public.hx_first_shift_exempt(p_professional uuid, p_client uuid, p_fee integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_client IS NULL OR p_fee IS NULL OR p_fee <= 0 THEN 0
    WHEN EXISTS (SELECT 1 FROM public.service_bookings b
                  WHERE b.professional_id = p_professional AND b.client_id = p_client AND b.status = 'completed') THEN 0
    WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_client AND u.created_at >= now() - interval '90 days') THEN 0
    ELSE LEAST(p_fee, 30000)
  END;
$$;

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'DIGITAL_BREB',
  ADD COLUMN IF NOT EXISTS commission_exempt_cop integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS firux_charge_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_bookings'::regclass AND conname = 'service_bookings_payment_method_check') THEN
    -- Lo anterior era pago directo al profesional: efectivo.
    UPDATE public.service_bookings SET payment_method = 'CASH' WHERE payment_mode = 'direct_to_professional' AND payment_method = 'DIGITAL_BREB';
    ALTER TABLE public.service_bookings ADD CONSTRAINT service_bookings_payment_method_check
      CHECK (payment_method IN ('DIGITAL_BREB', 'CASH'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hx_booking_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gross integer;
BEGIN
  IF COALESCE(NEW.total_amount, 0) < 45000 THEN
    RAISE EXCEPTION 'El valor mínimo de un turno es $45.000.' USING ERRCODE = '23514';
  END IF;
  NEW.platform_fee_pct := public.booking_commission_pct(NEW.professional_id, NEW.client_id);
  v_gross := ROUND(NEW.total_amount * NEW.platform_fee_pct / 100.0)::integer;
  NEW.commission_exempt_cop := public.hx_first_shift_exempt(NEW.professional_id, NEW.client_id, v_gross);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.compute_platform_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.platform_fee_amount := GREATEST(ROUND(NEW.total_amount * NEW.platform_fee_pct / 100.0)::integer - COALESCE(NEW.commission_exempt_cop, 0), 0);
  NEW.professional_payout := NEW.total_amount - NEW.platform_fee_amount;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sb_compute_fee ON public.service_bookings;
CREATE TRIGGER trg_sb_compute_fee
  BEFORE INSERT OR UPDATE OF total_amount, platform_fee_pct, commission_exempt_cop ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.compute_platform_fee();

-- Lo financiero solo lo cambia el personal o el servidor (sin sesión de usuario: pagos confirmados por Firux).
CREATE OR REPLACE FUNCTION public.guard_service_bookings_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
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
  RETURN NEW;
END $$;

-- ─── 2) Llave Bre-B del profesional ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.professional_payout_keys (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  key_type    text NOT NULL CHECK (key_type IN ('phone', 'document', 'email', 'alias')),
  key_value   text NOT NULL,
  holder_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_payout_keys_format CHECK (
    (key_type = 'phone'    AND key_value ~ '^3[0-9]{9}$') OR
    (key_type = 'document' AND key_value ~ '^[0-9]{5,10}$') OR
    (key_type = 'email'    AND key_value ~* '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' AND length(key_value) <= 120) OR
    (key_type = 'alias'    AND key_value ~ '^@[a-z0-9._-]{3,20}$')
  )
);
ALTER TABLE public.professional_payout_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppk_own ON public.professional_payout_keys;
CREATE POLICY ppk_own ON public.professional_payout_keys FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'professional'::public.app_role));
DROP POLICY IF EXISTS ppk_staff_read ON public.professional_payout_keys;
CREATE POLICY ppk_staff_read ON public.professional_payout_keys FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.professional_payout_keys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_payout_keys TO authenticated;
GRANT ALL ON public.professional_payout_keys TO service_role;

-- ─── 3) Billetera ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallets (
  professional_id  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  balance_cop      bigint NOT NULL DEFAULT 0,
  credit_limit_cop bigint NOT NULL DEFAULT -30000 CHECK (credit_limit_cop <= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.wallet_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('topup', 'commission_debit', 'adjustment')),
  amount_cop      bigint NOT NULL CHECK (amount_cop <> 0),
  balance_after   bigint NOT NULL,
  booking_id      uuid,
  charge_id       uuid,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_commission_per_booking ON public.wallet_movements (booking_id) WHERE kind = 'commission_debit';
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_per_charge ON public.wallet_movements (charge_id) WHERE kind = 'topup';
CREATE INDEX IF NOT EXISTS ix_wallet_movements_pro ON public.wallet_movements (professional_id, created_at DESC);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallets_read ON public.wallets;
CREATE POLICY wallets_read ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = professional_id OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS wallet_movements_read ON public.wallet_movements;
CREATE POLICY wallet_movements_read ON public.wallet_movements FOR SELECT TO authenticated USING (auth.uid() = professional_id OR public.is_staff(auth.uid()));
REVOKE ALL ON public.wallets, public.wallet_movements FROM anon, authenticated;
GRANT SELECT ON public.wallets, public.wallet_movements TO authenticated;
GRANT ALL ON public.wallets, public.wallet_movements TO service_role;

-- Único punto que mueve el saldo (atómico: bloquea la fila de la billetera).
CREATE OR REPLACE FUNCTION public.hx_wallet_apply(p_professional uuid, p_kind text, p_amount bigint, p_booking uuid, p_charge uuid, p_note text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance bigint;
BEGIN
  INSERT INTO public.wallets (professional_id) VALUES (p_professional) ON CONFLICT (professional_id) DO NOTHING;
  SELECT balance_cop INTO v_balance FROM public.wallets WHERE professional_id = p_professional FOR UPDATE;
  v_balance := v_balance + p_amount;
  INSERT INTO public.wallet_movements (professional_id, kind, amount_cop, balance_after, booking_id, charge_id, note)
  VALUES (p_professional, p_kind, p_amount, v_balance, p_booking, p_charge, p_note);
  UPDATE public.wallets SET balance_cop = v_balance, updated_at = now() WHERE professional_id = p_professional;
  RETURN v_balance;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_wallet()
RETURNS TABLE (balance_cop bigint, credit_limit_cop bigint, available_cop bigint, blocked boolean, completed_30d integer, commission_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(w.balance_cop, 0), COALESCE(w.credit_limit_cop, -30000),
         COALESCE(w.balance_cop, 0) - COALESCE(w.credit_limit_cop, -30000),
         COALESCE(w.balance_cop, 0) < COALESCE(w.credit_limit_cop, -30000),
         public.hx_pro_completed_30d(auth.uid()), public.booking_commission_pct(auth.uid(), NULL)
    FROM (SELECT auth.uid() AS uid) me
    LEFT JOIN public.wallets w ON w.professional_id = me.uid
   WHERE me.uid IS NOT NULL;
$$;

-- Al aceptar (pasar a «confirmado»): bloqueo por saldo menor al cupo y, en efectivo, saldo + cupo debe cubrir la comisión.
CREATE OR REPLACE FUNCTION public.hx_booking_wallet_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance bigint; v_limit bigint; v_self boolean;
BEGIN
  IF NEW.status <> 'confirmed' OR (TG_OP = 'UPDATE' AND OLD.status = 'confirmed') THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND public.is_staff(auth.uid()) THEN RETURN NEW; END IF;
  SELECT COALESCE(w.balance_cop, 0), COALESCE(w.credit_limit_cop, -30000) INTO v_balance, v_limit
    FROM (SELECT 1) x LEFT JOIN public.wallets w ON w.professional_id = NEW.professional_id;
  v_self := auth.uid() = NEW.professional_id;
  IF v_balance < v_limit THEN
    RAISE EXCEPTION '%', CASE WHEN v_self
      THEN 'Tu billetera está por debajo del cupo de $30.000. Recárgala para volver a recibir turnos.'
      ELSE 'Este profesional no puede recibir turnos nuevos por ahora. Elige a otra persona o inténtalo más tarde.' END
      USING ERRCODE = 'P0001', HINT = 'wallet_blocked';
  END IF;
  IF NEW.payment_method = 'CASH' AND (v_balance - v_limit) < COALESCE(NEW.platform_fee_amount, 0) THEN
    RAISE EXCEPTION '%', CASE WHEN v_self
      THEN format('Para aceptar este turno en efectivo necesitas %s más en tu billetera Humanix. Recárgala en segundos con Bre-B.',
                  public.hx_cop(COALESCE(NEW.platform_fee_amount, 0) - (v_balance - v_limit)))
      ELSE 'Este profesional necesita recargar su billetera para aceptar un turno en efectivo. Puedes pagar por Bre-B o elegir a otra persona.' END
      USING ERRCODE = 'P0001', HINT = 'wallet_insufficient';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_wallet_gate ON public.service_bookings;
CREATE TRIGGER trg_sb_wallet_gate BEFORE INSERT OR UPDATE OF status ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_booking_wallet_gate();

-- ─── 4) Cobros Firux y pagos al profesional ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.firux_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firux_id        text UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('booking', 'topup', 'plan')),
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  booking_id      uuid REFERENCES public.service_bookings (id) ON DELETE SET NULL,
  plan_key        text,
  amount_cop      bigint NOT NULL CHECK (amount_cop BETWEEN 2000 AND 12000000),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'underpaid', 'expired', 'failed')),
  qr_emv          text,
  payment_url     text,
  expires_at      timestamptz,
  amount_paid_cop bigint,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_firux_charges_booking ON public.firux_charges (booking_id) WHERE booking_id IS NOT NULL;
ALTER TABLE public.firux_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firux_charges_read ON public.firux_charges;
CREATE POLICY firux_charges_read ON public.firux_charges FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
REVOKE ALL ON public.firux_charges FROM anon, authenticated;
GRANT SELECT ON public.firux_charges TO authenticated;
GRANT ALL ON public.firux_charges TO service_role;

CREATE TABLE IF NOT EXISTS public.payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  booking_id      uuid UNIQUE REFERENCES public.service_bookings (id) ON DELETE SET NULL,
  amount_cop      bigint NOT NULL CHECK (amount_cop > 0),
  key_type        text,
  key_value       text,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('needs_key', 'queued', 'sent', 'paid', 'failed')),
  provider_ref    text,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payouts_read ON public.payouts;
CREATE POLICY payouts_read ON public.payouts FOR SELECT TO authenticated USING (auth.uid() = professional_id OR public.is_staff(auth.uid()));
REVOKE ALL ON public.payouts FROM anon, authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;

-- Orden de pago del neto de un turno digital pagado y terminado (una por turno). Sin llave queda «needs_key» y se le avisa.
CREATE OR REPLACE FUNCTION public.hx_queue_payout(p_booking uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; k record; v_id uuid;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.payment_method <> 'DIGITAL_BREB' OR b.paid_at IS NULL OR b.status <> 'completed' OR COALESCE(b.professional_payout, 0) <= 0 THEN
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
END $$;

-- Al terminar: efectivo → se descuenta la comisión de la billetera; digital pagado → orden de pago del neto.
CREATE OR REPLACE FUNCTION public.hx_booking_settle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_method = 'CASH' AND COALESCE(NEW.platform_fee_amount, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.wallet_movements m WHERE m.booking_id = NEW.id AND m.kind = 'commission_debit') THEN
    PERFORM public.hx_wallet_apply(NEW.professional_id, 'commission_debit', -NEW.platform_fee_amount, NEW.id, NULL, 'Comisión Humanix del turno en efectivo');
  ELSIF NEW.payment_method = 'DIGITAL_BREB' THEN
    PERFORM public.hx_queue_payout(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_settle ON public.service_bookings;
CREATE TRIGGER trg_sb_settle AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.hx_booking_settle();

-- Aplica un cobro confirmado por Firux (firma verificada en el servidor). Una sola vez, aunque el aviso llegue repetido o a la vez.
CREATE OR REPLACE FUNCTION public.hx_firux_charge_paid(p_firux_id text, p_amount_paid bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
           'Al terminarlo te enviamos tu pago a tu llave Bre-B.', '/servicio/' || b.id
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
END $$;

-- ─── 5) Permisos de funciones y tiempo real ──────────────────────────────────

REVOKE ALL ON FUNCTION public.hx_wallet_apply(uuid, text, bigint, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_queue_payout(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_firux_charge_paid(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_wallet_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_settle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_wallet_apply(uuid, text, bigint, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_queue_payout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_firux_charge_paid(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_wallet() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) TO authenticated, service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'firux_charges') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.firux_charges;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'wallets') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
    END IF;
  END IF;
END $$;
