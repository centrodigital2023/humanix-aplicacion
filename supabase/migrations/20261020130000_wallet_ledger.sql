-- Billetera y retiros: habilita `WalletPanel` en producción. Reemplaza 20260606140000_wallet_payouts.sql y
-- 20260606160000_booking_completion_earnings.sql, que nunca se aplicaron y permitían crear dinero:
--   1. `wallet_update_self_payout_method` dejaba al dueño hacer UPDATE de toda su fila, saldo incluido.
--   2. `record_wallet_transaction` y `get_or_create_wallet` eran SECURITY DEFINER y, con los privilegios por defecto de
--      Supabase, cualquiera (hasta anon) podía acreditarle cualquier monto a cualquier cuenta.
--   3. `payout_insert_self` dejaba crear solicitudes de retiro directo en la tabla, sin descontar saldo.
--   4. `request_payout` no bloqueaba la fila: dos solicitudes a la vez gastaban el mismo saldo.
--   5. Un retiro fallido o cancelado no devolvía el dinero, y uno completado nunca salía de «pendiente».
--   6. Al completar CUALQUIER servicio se acreditaba el total en la billetera del profesional, aunque hoy la familia le
--      paga directo (`payment_mode = 'direct_to_professional'`) y Humanix no recibe ese dinero: se habría podido retirar
--      plata que la plataforma nunca cobró. Además, `payment_mode` se podía fijar al crear la reserva.
--
-- Cómo queda:
--   · Las tres tablas son de solo lectura para su dueño (y el personal). Nadie las escribe desde el navegador.
--   · El saldo solo cambia por `record_wallet_transaction` (solo el servidor) y por `request_payout` / `resolve_payout`,
--     siempre con la fila bloqueada y un movimiento en el libro por cada cambio.
--   · Solo se acredita un servicio completado cuyo `payment_mode` es 'platform' (pago intermediado por Humanix). Ese valor
--     ya no lo fija quien crea la reserva: nace 'direct_to_professional' salvo que lo escriba el servidor. Hoy, entonces, la
--     billetera de todos queda en cero hasta que exista el cobro intermediado.
--   · `resolve_payout` (solo personal): completa un retiro o lo devuelve al saldo si falló o se canceló.
-- Idempotente.

-- ─── 1. Tablas ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents  bigint      NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  pending_cents  bigint      NOT NULL DEFAULT 0 CHECK (pending_cents >= 0),
  currency       text        NOT NULL DEFAULT 'COP',
  payout_method  text        CHECK (payout_method IN ('nequi','pse','bancolombia','daviplata','rappipay','bank_transfer')),
  payout_details jsonb,
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payout_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id          uuid        NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE CASCADE,
  amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
  currency           text        NOT NULL DEFAULT 'COP',
  method             text        NOT NULL CHECK (method IN ('nequi','pse','bancolombia','daviplata','rappipay','bank_transfer')),
  destination        jsonb       NOT NULL,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  provider_reference text,
  failure_reason     text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  processed_by       uuid        REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_payout_requests_user   ON public.payout_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests (status) WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           uuid        NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                text        NOT NULL
                                  CHECK (type IN ('service_earning', 'platform_commission', 'referral_bonus', 'payout', 'refund', 'adjustment')),
  amount_cents        bigint      NOT NULL,
  currency            text        NOT NULL DEFAULT 'COP',
  booking_id          uuid        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  payout_request_id   uuid        REFERENCES public.payout_requests(id) ON DELETE SET NULL,
  description         text,
  balance_after_cents bigint      NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet  ON public.wallet_transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user    ON public.wallet_transactions (user_id, created_at DESC);
-- Un servicio se acredita una sola vez, aunque dos avisos lleguen a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_service_earning ON public.wallet_transactions (booking_id) WHERE type = 'service_earning';

-- ─── 2. Privilegios y RLS: solo lectura del dueño y del personal ───────────────────────────────────────────────────
ALTER TABLE public.wallet_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_accounts, public.payout_requests, public.wallet_transactions FROM anon, authenticated;
GRANT SELECT ON public.wallet_accounts, public.payout_requests, public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_accounts, public.payout_requests, public.wallet_transactions TO service_role;

DROP POLICY IF EXISTS wallet_select_self_or_staff ON public.wallet_accounts;
DROP POLICY IF EXISTS wallet_update_self_payout_method ON public.wallet_accounts;
DROP POLICY IF EXISTS wallet_staff_all ON public.wallet_accounts;
DROP POLICY IF EXISTS payout_select_self_or_staff ON public.payout_requests;
DROP POLICY IF EXISTS payout_insert_self ON public.payout_requests;
DROP POLICY IF EXISTS payout_staff_manage ON public.payout_requests;
DROP POLICY IF EXISTS wallet_tx_select_self_or_staff ON public.wallet_transactions;
DROP POLICY IF EXISTS wallet_tx_staff_all ON public.wallet_transactions;
CREATE POLICY wallet_select_self_or_staff ON public.wallet_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY payout_select_self_or_staff ON public.payout_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY wallet_tx_select_self_or_staff ON public.wallet_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_wallet_accounts_updated_at ON public.wallet_accounts;
CREATE TRIGGER trg_wallet_accounts_updated_at
  BEFORE UPDATE ON public.wallet_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 3. Funciones ──────────────────────────────────────────────────────────────────────────────────────────────────
-- La billetera propia (la crea la primera vez). El personal y el servidor pueden pedir la de otra cuenta.
CREATE OR REPLACE FUNCTION public.get_or_create_wallet(p_user_id uuid DEFAULT NULL)
RETURNS public.wallet_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_target uuid := COALESCE(p_user_id, auth.uid());
  v_wallet public.wallet_accounts;
BEGIN
  IF v_target IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF v_uid IS NOT NULL AND v_target <> v_uid AND NOT public.is_staff(v_uid)
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo puedes ver tu propia billetera' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.wallet_accounts (user_id) VALUES (v_target) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = v_target;
  RETURN v_wallet;
END $$;

-- Único punto de escritura de saldo desde el servidor. Bloquea la fila: el libro y el saldo nunca se desincronizan.
CREATE OR REPLACE FUNCTION public.record_wallet_transaction(
  p_user_id      uuid,
  p_type         text,
  p_amount_cents bigint,
  p_booking_id   uuid DEFAULT NULL,
  p_description  text DEFAULT NULL
) RETURNS public.wallet_transactions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.wallet_accounts;
  v_tx     public.wallet_transactions;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents = 0 THEN RAISE EXCEPTION 'Monto inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.wallet_accounts (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = p_user_id FOR UPDATE;
  IF v_wallet.balance_cents + p_amount_cents < 0 THEN
    RAISE EXCEPTION 'Saldo insuficiente para esta operación' USING ERRCODE = '23514';
  END IF;
  UPDATE public.wallet_accounts SET balance_cents = balance_cents + p_amount_cents
   WHERE id = v_wallet.id RETURNING * INTO v_wallet;
  INSERT INTO public.wallet_transactions (wallet_id, user_id, type, amount_cents, booking_id, description, balance_after_cents)
  VALUES (v_wallet.id, p_user_id, p_type, p_amount_cents, p_booking_id, left(p_description, 300), v_wallet.balance_cents)
  RETURNING * INTO v_tx;
  RETURN v_tx;
END $$;

-- La persona pide un retiro: el monto pasa de disponible a pendiente, con la fila bloqueada.
CREATE OR REPLACE FUNCTION public.request_payout(p_amount_cents bigint, p_method text, p_destination jsonb)
RETURNS public.payout_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_wallet  public.wallet_accounts;
  v_request public.payout_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero' USING ERRCODE = '22023'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('nequi','pse','bancolombia','daviplata','rappipay','bank_transfer') THEN
    RAISE EXCEPTION 'Método de retiro no válido' USING ERRCODE = '22023';
  END IF;
  IF p_destination IS NULL OR jsonb_typeof(p_destination) <> 'object' OR length(p_destination::text) > 500 THEN
    RAISE EXCEPTION 'Destino del retiro no válido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.wallet_accounts (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = v_uid FOR UPDATE;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Tu billetera no está activa' USING ERRCODE = '42501'; END IF;
  IF v_wallet.balance_cents < p_amount_cents THEN RAISE EXCEPTION 'Saldo disponible insuficiente' USING ERRCODE = '23514'; END IF;

  UPDATE public.wallet_accounts
     SET balance_cents = balance_cents - p_amount_cents, pending_cents = pending_cents + p_amount_cents
   WHERE id = v_wallet.id RETURNING * INTO v_wallet;
  INSERT INTO public.payout_requests (user_id, wallet_id, amount_cents, method, destination)
  VALUES (v_uid, v_wallet.id, p_amount_cents, p_method, p_destination) RETURNING * INTO v_request;
  INSERT INTO public.wallet_transactions (wallet_id, user_id, type, amount_cents, payout_request_id, description, balance_after_cents)
  VALUES (v_wallet.id, v_uid, 'payout', -p_amount_cents, v_request.id, 'Solicitud de retiro vía ' || p_method, v_wallet.balance_cents);
  RETURN v_request;
END $$;

-- El personal resuelve un retiro: completado (sale de pendiente) o fallido/cancelado (vuelve al saldo).
CREATE OR REPLACE FUNCTION public.resolve_payout(p_request_id uuid, p_status text, p_reference text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS public.payout_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_request public.payout_requests;
  v_wallet  public.wallet_accounts;
BEGIN
  IF NOT (public.is_staff(v_uid) OR coalesce(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Solo el personal resuelve retiros' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('processing', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Estado no válido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.payout_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retiro no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_request.status NOT IN ('pending', 'processing') OR (p_status = 'processing' AND v_request.status <> 'pending') THEN
    RAISE EXCEPTION 'Este retiro ya está %', v_request.status USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_wallet FROM public.wallet_accounts WHERE id = v_request.wallet_id FOR UPDATE;
  IF p_status = 'completed' THEN
    UPDATE public.wallet_accounts SET pending_cents = pending_cents - v_request.amount_cents WHERE id = v_wallet.id;
  ELSIF p_status IN ('failed', 'cancelled') THEN
    UPDATE public.wallet_accounts
       SET pending_cents = pending_cents - v_request.amount_cents, balance_cents = balance_cents + v_request.amount_cents
     WHERE id = v_wallet.id RETURNING * INTO v_wallet;
    INSERT INTO public.wallet_transactions (wallet_id, user_id, type, amount_cents, payout_request_id, description, balance_after_cents)
    VALUES (v_wallet.id, v_request.user_id, 'refund', v_request.amount_cents, v_request.id,
            'Retiro devuelto al saldo (' || p_status || ')', v_wallet.balance_cents);
  END IF;

  UPDATE public.payout_requests
     SET status = p_status,
         provider_reference = COALESCE(left(p_reference, 120), provider_reference),
         failure_reason = CASE WHEN p_status IN ('failed', 'cancelled') THEN left(p_reason, 300) ELSE failure_reason END,
         processed_at = CASE WHEN p_status = 'processing' THEN processed_at ELSE now() END,
         processed_by = v_uid
   WHERE id = v_request.id RETURNING * INTO v_request;
  RETURN v_request;
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_wallet(uuid), public.record_wallet_transaction(uuid, text, bigint, uuid, text),
  public.request_payout(bigint, text, jsonb), public.resolve_payout(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_wallet(uuid), public.request_payout(bigint, text, jsonb),
  public.resolve_payout(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_wallet(uuid), public.record_wallet_transaction(uuid, text, bigint, uuid, text),
  public.request_payout(bigint, text, jsonb), public.resolve_payout(uuid, text, text, text) TO service_role;

-- ─── 4. Ganancias de servicios intermediados por Humanix ───────────────────────────────────────────────────────────
-- Quien crea una reserva desde el navegador no elige el modo de pago (la actualización ya lo protegía).
CREATE OR REPLACE FUNCTION public.guard_service_bookings_payment_mode_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' AND NOT public.is_staff(auth.uid()) THEN
    NEW.payment_mode := 'direct_to_professional';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_service_bookings_payment_mode_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_service_bookings_payment_mode_insert ON public.service_bookings;
CREATE TRIGGER trg_guard_service_bookings_payment_mode_insert
  BEFORE INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_bookings_payment_mode_insert();

CREATE OR REPLACE FUNCTION public.credit_booking_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gross bigint;
  v_pct   numeric;
  v_net   bigint;
BEGIN
  -- Con pago directo al profesional, Humanix no tiene ese dinero: no hay nada que acreditar.
  IF NEW.payment_mode IS DISTINCT FROM 'platform' THEN RETURN NEW; END IF;
  v_gross := COALESCE(NEW.total_amount, 0)::bigint * 100;
  IF v_gross <= 0 THEN RETURN NEW; END IF;
  v_pct := public.platform_commission_pct(NEW.professional_id);
  v_net := v_gross - round(v_gross * v_pct / 100.0)::bigint;
  IF v_net <= 0 THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.record_wallet_transaction(NEW.professional_id, 'service_earning', v_net, NEW.id,
      CASE WHEN v_pct > 0 THEN format('Servicio completado · comisión Humanix %s%%', v_pct)
           ELSE 'Servicio completado · sin comisión' END);
  EXCEPTION WHEN unique_violation THEN
    NULL; -- ya acreditado
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.credit_booking_completion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sb_credit_completion ON public.service_bookings;
CREATE TRIGGER trg_sb_credit_completion
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.credit_booking_completion();

-- ─── 5. Realtime (el panel escucha sus propias filas) ──────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallet_accounts', 'payout_requests', 'wallet_transactions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
