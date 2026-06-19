-- ──────────────────────────────────────────────────────────────────────────
-- Módulo Billetera Humanix: saldo de profesionales/instituciones, ledger de
-- movimientos y solicitudes de retiro (Nequi / PSE / Bancolombia / RappiPay).
-- Sienta las bases de datos para "Cobros inmediatos" (hoy marcado "próximamente"
-- en /auth) sin acoplarse todavía a un proveedor de pagos específico — los
-- edge functions de liquidación se conectan sobre estas tablas cuando se
-- contraten las credenciales reales del PSP.
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Cuenta de billetera (1:1 con el usuario que recibe pagos: profesional / institución)
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents   BIGINT      NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  pending_cents   BIGINT      NOT NULL DEFAULT 0 CHECK (pending_cents >= 0),
  currency        TEXT        NOT NULL DEFAULT 'COP',
  payout_method   TEXT        CHECK (payout_method IN ('nequi','pse','bancolombia','daviplata','rappipay','bank_transfer')),
  payout_details  JSONB,      -- ej: { "phone": "3xx...", "bank": "...", "account_last4": "1234" } — nunca el número completo
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user ON public.wallet_accounts (user_id);

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_select_self_or_staff ON public.wallet_accounts
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY wallet_update_self_payout_method ON public.wallet_accounts
  FOR UPDATE USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY wallet_staff_all ON public.wallet_accounts
  FOR ALL USING (public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_wallet_accounts_updated_at ON public.wallet_accounts;
CREATE TRIGGER trg_wallet_accounts_updated_at
  BEFORE UPDATE ON public.wallet_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Solicitudes de retiro (Nequi / PSE / Bancolombia / Daviplata / RappiPay / transferencia)
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id           UUID        NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE CASCADE,
  amount_cents        BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency            TEXT        NOT NULL DEFAULT 'COP',
  method              TEXT        NOT NULL CHECK (method IN ('nequi','pse','bancolombia','daviplata','rappipay','bank_transfer')),
  destination         JSONB       NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  provider_reference  TEXT,
  failure_reason      TEXT,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,
  processed_by        UUID        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_user   ON public.payout_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests (status) WHERE status IN ('pending', 'processing');

ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_select_self_or_staff ON public.payout_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY payout_insert_self ON public.payout_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY payout_staff_manage ON public.payout_requests
  FOR UPDATE USING (public.is_staff(auth.uid()));

-- 3. Ledger de movimientos (auditoría inmutable de cada crédito/débito)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           UUID        NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                TEXT        NOT NULL
                                  CHECK (type IN ('service_earning', 'platform_commission', 'referral_bonus', 'payout', 'refund', 'adjustment')),
  amount_cents        BIGINT      NOT NULL,           -- positivo = crédito, negativo = débito
  currency            TEXT        NOT NULL DEFAULT 'COP',
  booking_id          UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  payout_request_id   UUID        REFERENCES public.payout_requests(id) ON DELETE SET NULL,
  description         TEXT,
  balance_after_cents BIGINT      NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet  ON public.wallet_transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user    ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_booking ON public.wallet_transactions (booking_id);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- El ledger es de solo lectura para el usuario; las escrituras pasan siempre
-- por record_wallet_transaction() (SECURITY DEFINER) para mantener la
-- consistencia del saldo.
CREATE POLICY wallet_tx_select_self_or_staff ON public.wallet_transactions
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY wallet_tx_staff_all ON public.wallet_transactions
  FOR ALL USING (public.is_staff(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payout_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;

-- ──────────────────────────────────────────────────────────────────────────
-- Funciones helper (SECURITY DEFINER) — toda escritura de saldo pasa por aquí
-- para que el ledger y el balance nunca queden desincronizados.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_or_create_wallet(p_user_id UUID)
RETURNS public.wallet_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.wallet_accounts;
BEGIN
  SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id) VALUES (p_user_id)
    RETURNING * INTO v_wallet;
  END IF;
  RETURN v_wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_wallet_transaction(
  p_user_id    UUID,
  p_type       TEXT,
  p_amount_cents BIGINT,
  p_booking_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet public.wallet_accounts;
  v_tx     public.wallet_transactions;
BEGIN
  v_wallet := public.get_or_create_wallet(p_user_id);

  UPDATE public.wallet_accounts
     SET balance_cents = balance_cents + p_amount_cents,
         updated_at = now()
   WHERE id = v_wallet.id
   RETURNING * INTO v_wallet;

  IF v_wallet.balance_cents < 0 THEN
    RAISE EXCEPTION 'Saldo insuficiente para esta operación (wallet %)', v_wallet.id;
  END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, user_id, type, amount_cents, booking_id, description, balance_after_cents
  ) VALUES (
    v_wallet.id, p_user_id, p_type, p_amount_cents, p_booking_id, p_description, v_wallet.balance_cents
  )
  RETURNING * INTO v_tx;

  RETURN v_tx;
END;
$$;

-- RPC pública: el usuario solicita un retiro; descuenta del saldo disponible
-- y mueve el monto a "pendiente" hasta que el operador lo procese.
CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount_cents BIGINT,
  p_method       TEXT,
  p_destination  JSONB
)
RETURNS public.payout_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet  public.wallet_accounts;
  v_request public.payout_requests;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero';
  END IF;

  v_wallet := public.get_or_create_wallet(auth.uid());

  IF v_wallet.balance_cents < p_amount_cents THEN
    RAISE EXCEPTION 'Saldo disponible insuficiente';
  END IF;

  UPDATE public.wallet_accounts
     SET balance_cents = balance_cents - p_amount_cents,
         pending_cents = pending_cents + p_amount_cents,
         updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.payout_requests (user_id, wallet_id, amount_cents, method, destination)
  VALUES (auth.uid(), v_wallet.id, p_amount_cents, p_method, p_destination)
  RETURNING * INTO v_request;

  INSERT INTO public.wallet_transactions (
    wallet_id, user_id, type, amount_cents, payout_request_id, description, balance_after_cents
  ) VALUES (
    v_wallet.id, auth.uid(), 'payout', -p_amount_cents, v_request.id,
    'Solicitud de retiro vía ' || p_method, v_wallet.balance_cents - p_amount_cents
  );

  RETURN v_request;
END;
$$;

COMMENT ON FUNCTION public.record_wallet_transaction IS
  'Único punto de escritura de saldo: actualiza wallet_accounts.balance_cents y registra el movimiento en wallet_transactions de forma atómica.';
COMMENT ON FUNCTION public.request_payout IS
  'RPC de usuario: mueve fondos de balance_cents a pending_cents y crea la solicitud de retiro. El operador la completa actualizando payout_requests.status.';
