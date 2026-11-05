-- Reparto por transacción + dispersión automática por Bre-B + libro contable y conciliación.
--
-- Va después de 20261104180000_breb_escrow.sql (aplicada en producción). No depende de 20261104140000 (Conectar) ni de
-- 20261104160000 (operación de la cola): trae aquí su propia versión de hx_mark_payout y del cambio de llave.
--
-- 1. payment_splits: al confirmarse el pago de un turno se fija el reparto de ESA transacción (comisión de Humanix según
--    la matriz, ya calculada en service_bookings, y la parte del profesional). El reparto se ejecuta al liberarse.
-- 2. ledger_entries: libro de partida doble (cada fila mueve dinero de una cuenta a otra, así siempre cuadra). Lo
--    escriben solo triggers. Cuentas: external (bancos/pagadores), escrow (retenido por turno), professional (saldo por
--    dispersar de cada profesional), in_transit (dispersión enviada, sin confirmar), platform (comisión Humanix) y
--    wallet (billetera del profesional para el efectivo).
-- 3. Dispersión automática: payouts pasa por queued → sending → sent → paid (o failed / reintento). El servidor reclama
--    lotes con hx_claim_payouts, los envía a Firux y anota el resultado con hx_payout_result. El aviso de Firux
--    (`payout.paid` / `payout.failed`) cierra cada pago. Apagada por defecto: hx_dispersion_config.enabled = false.
-- 4. Saldos: get_my_earnings (profesional) y hx_reconciliation (equipo, solo service_role).
--
-- Idempotente.

-- ─── 1) Reparto por transacción ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_splits (
  booking_id       uuid PRIMARY KEY REFERENCES public.service_bookings (id) ON DELETE CASCADE,
  charge_id        uuid REFERENCES public.firux_charges (id) ON DELETE SET NULL,
  professional_id  uuid NOT NULL,
  payer_id         uuid NOT NULL,
  route            text NOT NULL DEFAULT 'platform' CHECK (route IN ('platform', 'connected')),
  gross_cop        bigint NOT NULL CHECK (gross_cop > 0),
  commission_pct   numeric NOT NULL,
  exempt_cop       bigint NOT NULL DEFAULT 0,
  platform_fee_cop bigint NOT NULL CHECK (platform_fee_cop >= 0),
  professional_cop bigint NOT NULL CHECK (professional_cop >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_splits_sum CHECK (platform_fee_cop + professional_cop = gross_cop)
);
CREATE INDEX IF NOT EXISTS ix_payment_splits_pro ON public.payment_splits (professional_id, created_at DESC);
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_splits_read ON public.payment_splits;
CREATE POLICY payment_splits_read ON public.payment_splits FOR SELECT TO authenticated
  USING (auth.uid() = professional_id OR auth.uid() = payer_id OR public.is_staff(auth.uid()));
REVOKE ALL ON public.payment_splits FROM anon, authenticated;
GRANT SELECT ON public.payment_splits TO authenticated;
GRANT ALL ON public.payment_splits TO service_role;

-- ─── 2) Libro contable ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id            bigserial PRIMARY KEY,
  ref           text NOT NULL UNIQUE,
  from_account  text NOT NULL CHECK (from_account IN ('external', 'escrow', 'professional', 'in_transit', 'platform', 'wallet')),
  from_pro      uuid,
  to_account    text NOT NULL CHECK (to_account IN ('external', 'escrow', 'professional', 'in_transit', 'platform', 'wallet')),
  to_pro        uuid,
  amount_cop    bigint NOT NULL CHECK (amount_cop > 0),
  booking_id    uuid,
  charge_id     uuid,
  payout_id     uuid,
  refund_id     uuid,
  memo          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_pro_accounts CHECK (
    (from_account IN ('professional', 'in_transit', 'wallet')) = (from_pro IS NOT NULL)
    AND (to_account IN ('professional', 'in_transit', 'wallet')) = (to_pro IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ledger_from_pro ON public.ledger_entries (from_pro) WHERE from_pro IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_to_pro ON public.ledger_entries (to_pro) WHERE to_pro IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_booking ON public.ledger_entries (booking_id) WHERE booking_id IS NOT NULL;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_entries_read ON public.ledger_entries;
CREATE POLICY ledger_entries_read ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR auth.uid() = from_pro OR auth.uid() = to_pro);
REVOKE ALL ON public.ledger_entries FROM anon, authenticated;
GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
GRANT USAGE ON SEQUENCE public.ledger_entries_id_seq TO service_role;

-- Un movimiento. La misma `ref` nunca se anota dos veces (avisos repetidos, reintentos, el relleno inicial).
CREATE OR REPLACE FUNCTION public.hx_ledger_move(
  p_ref text, p_from text, p_from_pro uuid, p_to text, p_to_pro uuid, p_amount bigint,
  p_booking uuid, p_charge uuid, p_payout uuid, p_refund uuid, p_memo text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN false; END IF;
  INSERT INTO public.ledger_entries (ref, from_account, from_pro, to_account, to_pro, amount_cop, booking_id, charge_id, payout_id, refund_id, memo)
  VALUES (p_ref, p_from, CASE WHEN p_from IN ('professional', 'in_transit', 'wallet') THEN p_from_pro END,
          p_to, CASE WHEN p_to IN ('professional', 'in_transit', 'wallet') THEN p_to_pro END,
          p_amount, p_booking, p_charge, p_payout, p_refund, left(p_memo, 200))
  ON CONFLICT (ref) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;

-- Saldo de una cuenta (de un profesional si se da).
CREATE OR REPLACE FUNCTION public.hx_ledger_balance(p_account text, p_pro uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(CASE WHEN to_account = p_account AND (p_pro IS NULL OR to_pro = p_pro) THEN amount_cop ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN from_account = p_account AND (p_pro IS NULL OR from_pro = p_pro) THEN amount_cop ELSE 0 END), 0)
    FROM public.ledger_entries
   WHERE (to_account = p_account AND (p_pro IS NULL OR to_pro = p_pro))
      OR (from_account = p_account AND (p_pro IS NULL OR from_pro = p_pro));
$$;

-- 2a) Entra un pago (cualquier cobro Firux pagado). Turno → retenido; recarga → billetera; plan → comisión Humanix.
CREATE OR REPLACE FUNCTION public.hx_ledger_charge_paid(p_charge uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_memo text := 'Bre-B';
BEGIN
  SELECT * INTO c FROM public.firux_charges WHERE id = p_charge;
  IF NOT FOUND OR c.status <> 'paid' THEN RETURN; END IF;
  IF c.kind = 'booking' THEN
    PERFORM public.hx_ledger_move('charge:' || c.id, 'external', NULL, 'escrow', NULL, c.amount_cop,
      c.booking_id, c.id, NULL, NULL, 'Pago del turno por ' || v_memo);
  ELSIF c.kind = 'topup' THEN
    PERFORM public.hx_ledger_move('charge:' || c.id, 'external', NULL, 'wallet', c.user_id, c.amount_cop,
      NULL, c.id, NULL, NULL, 'Recarga de billetera por ' || v_memo);
  ELSIF c.kind = 'plan' THEN
    PERFORM public.hx_ledger_move('charge:' || c.id, 'external', NULL, 'platform', NULL, c.amount_cop,
      NULL, c.id, NULL, NULL, 'Plan institucional por ' || v_memo);
  END IF;
END $$;

-- 2b) Se fija el reparto del turno pagado (comisión según la matriz, con la exención del primer turno ya descontada).
CREATE OR REPLACE FUNCTION public.hx_split_booking(p_booking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; c record;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.paid_at IS NULL OR b.payment_method <> 'DIGITAL_BREB' OR COALESCE(b.total_amount, 0) <= 0 THEN RETURN; END IF;
  SELECT * INTO c FROM public.firux_charges WHERE id = b.firux_charge_id;
  INSERT INTO public.payment_splits (booking_id, charge_id, professional_id, payer_id, route,
                                     gross_cop, commission_pct, exempt_cop, platform_fee_cop, professional_cop)
  VALUES (b.id, b.firux_charge_id, b.professional_id, b.client_id,
          CASE WHEN to_jsonb(c) ->> 'route' = 'connected' THEN 'connected' ELSE 'platform' END,
          b.total_amount, COALESCE(b.platform_fee_pct, 0), COALESCE(b.commission_exempt_cop, 0),
          COALESCE(b.platform_fee_amount, 0), b.total_amount - COALESCE(b.platform_fee_amount, 0))
  ON CONFLICT (booking_id) DO NOTHING;
END $$;

-- 2c) Se libera el pago retenido: la comisión pasa a Humanix y el neto al saldo por dispersar del profesional.
--     Cobro conectado (Firux Pay): el neto ya le llegó directo, así que sale de una vez.
CREATE OR REPLACE FUNCTION public.hx_ledger_release(p_booking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  PERFORM public.hx_split_booking(p_booking);
  SELECT * INTO s FROM public.payment_splits WHERE booking_id = p_booking;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.hx_ledger_move('release_fee:' || p_booking, 'escrow', NULL, 'platform', NULL, s.platform_fee_cop,
    p_booking, s.charge_id, NULL, NULL, format('Comisión Humanix %s%%', s.commission_pct));
  PERFORM public.hx_ledger_move('release_net:' || p_booking, 'escrow', NULL, 'professional', s.professional_id, s.professional_cop,
    p_booking, s.charge_id, NULL, NULL, 'Pago liberado al profesional');
  IF s.route = 'connected' THEN
    PERFORM public.hx_ledger_move('direct:' || p_booking, 'professional', s.professional_id, 'external', NULL, s.professional_cop,
      p_booking, s.charge_id, NULL, NULL, 'Llegó directo a su cuenta Firux');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hx_ledger_charge_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.hx_ledger_charge_paid(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_charge ON public.firux_charges;
CREATE TRIGGER trg_ledger_charge AFTER UPDATE OF status ON public.firux_charges
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.hx_ledger_charge_trg();

CREATE OR REPLACE FUNCTION public.hx_ledger_booking_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
    PERFORM public.hx_split_booking(NEW.id);
  END IF;
  IF NEW.escrow_status = 'released' AND OLD.escrow_status IS DISTINCT FROM 'released' AND NEW.payment_method = 'DIGITAL_BREB' THEN
    PERFORM public.hx_ledger_release(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_booking ON public.service_bookings;
CREATE TRIGGER trg_ledger_booking AFTER UPDATE OF paid_at, escrow_status ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_ledger_booking_trg();

-- 2d) Devoluciones enviadas: salen del retenido.
CREATE OR REPLACE FUNCTION public.hx_ledger_refund_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.hx_ledger_move('refund:' || NEW.id, 'escrow', NULL, 'external', NULL, NEW.amount_cop,
    NEW.booking_id, NEW.charge_id, NULL, NEW.id, 'Devolución al pagador');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_refund ON public.booking_refunds;
CREATE TRIGGER trg_ledger_refund AFTER UPDATE OF status ON public.booking_refunds
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.hx_ledger_refund_trg();

-- 2e) Efectivo: la comisión que se descuenta de la billetera es ingreso de Humanix. Ajustes del equipo, igual.
CREATE OR REPLACE FUNCTION public.hx_ledger_wallet_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'topup' THEN RETURN NEW; END IF; -- ya anotada al confirmarse el cobro (3a)
  IF NEW.amount_cop < 0 THEN
    PERFORM public.hx_ledger_move('wallet:' || NEW.id, 'wallet', NEW.professional_id, 'platform', NULL, -NEW.amount_cop,
      NEW.booking_id, NEW.charge_id, NULL, NULL,
      CASE NEW.kind WHEN 'commission_debit' THEN 'Comisión de turno en efectivo' ELSE COALESCE(NEW.note, 'Ajuste') END);
  ELSE
    PERFORM public.hx_ledger_move('wallet:' || NEW.id, 'platform', NULL, 'wallet', NEW.professional_id, NEW.amount_cop,
      NEW.booking_id, NEW.charge_id, NULL, NULL, COALESCE(NEW.note, 'Ajuste'));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_wallet ON public.wallet_movements;
CREATE TRIGGER trg_ledger_wallet AFTER INSERT ON public.wallet_movements
  FOR EACH ROW EXECUTE FUNCTION public.hx_ledger_wallet_trg();

-- ─── 3) Dispersión automática ────────────────────────────────────────────────

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS firux_payout_id text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS via text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payouts_firux_id ON public.payouts (firux_payout_id) WHERE firux_payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payouts_due ON public.payouts (created_at) WHERE status = 'queued';
ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('needs_key', 'queued', 'sending', 'sent', 'paid', 'failed'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_via_check') THEN
    ALTER TABLE public.payouts ADD CONSTRAINT payouts_via_check CHECK (via IS NULL OR via IN ('auto', 'manual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payout_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger     text NOT NULL CHECK (trigger IN ('auto', 'staff', 'cron')),
  requested_by uuid,
  count       integer NOT NULL DEFAULT 0,
  total_cop   bigint NOT NULL DEFAULT 0,
  sent        integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_batches_read ON public.payout_batches;
CREATE POLICY payout_batches_read ON public.payout_batches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.payout_batches FROM anon, authenticated;
GRANT SELECT ON public.payout_batches TO authenticated;
GRANT ALL ON public.payout_batches TO service_role;

-- Interruptor y destino del «despertador». Una sola fila; solo service_role la lee (guarda el secreto del despachador).
CREATE TABLE IF NOT EXISTS public.hx_dispersion_config (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled      boolean NOT NULL DEFAULT false,
  dispatch_url text,
  secret       text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.hx_dispersion_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.hx_dispersion_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hx_dispersion_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hx_dispersion_config TO service_role;

-- pg_net permite avisar al despachador en el mismo segundo en que se libera un pago. Sin pg_net queda el reloj (1 min).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net no disponible: la dispersión corre con el reloj de cada minuto';
END $$;

-- Despierta al despachador (`POST /api/public/firux/dispatch`). Nunca falla: si no hay pg_net o está apagado, no hace nada.
CREATE OR REPLACE FUNCTION public.hx_kick_dispersion()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg record;
BEGIN
  SELECT * INTO cfg FROM public.hx_dispersion_config WHERE id;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.dispatch_url IS NULL OR cfg.secret IS NULL THEN RETURN false; END IF;
  IF to_regproc('net.http_post') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3)'
    USING cfg.dispatch_url, '{"trigger":"auto"}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg.secret);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hx_kick_dispersion: %', SQLERRM;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.hx_payout_kick_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'queued' AND NEW.key_value IS NOT NULL AND COALESCE(NEW.next_attempt_at, now()) <= now() THEN
    PERFORM public.hx_kick_dispersion();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payout_kick ON public.payouts;
CREATE TRIGGER trg_payout_kick AFTER INSERT OR UPDATE OF status ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.hx_payout_kick_trg();

-- Reclama un lote de pagos listos (más viejos primero). Varios despachadores a la vez nunca toman el mismo pago.
-- Los que quedaron «sending» más de 10 min (el servidor se cayó a mitad) vuelven a la cola: Firux recibe la misma
-- Idempotency-Key (id del pago + llave de destino) y no paga dos veces.
CREATE OR REPLACE FUNCTION public.hx_claim_payouts(p_limit integer, p_trigger text, p_by uuid)
RETURNS TABLE (id uuid, professional_id uuid, booking_id uuid, amount_cop bigint, key_type text, key_value text,
               attempts integer, batch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid := gen_random_uuid(); v_n integer; v_total bigint;
BEGIN
  IF p_trigger NOT IN ('auto', 'staff', 'cron') THEN RAISE EXCEPTION 'trigger inválido'; END IF;
  UPDATE public.payouts p SET status = 'queued', updated_at = now()
   WHERE p.status = 'sending' AND p.updated_at < now() - interval '10 minutes';

  INSERT INTO public.payout_batches (id, trigger, requested_by) VALUES (v_batch, p_trigger, p_by);
  RETURN QUERY
  WITH due AS (
    SELECT p.id FROM public.payouts p
     WHERE p.status = 'queued' AND p.key_value IS NOT NULL AND COALESCE(p.next_attempt_at, '-infinity') <= now()
     ORDER BY p.created_at
     LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.payouts p SET status = 'sending', batch_id = v_batch, updated_at = now()
    FROM due WHERE p.id = due.id
  RETURNING p.id, p.professional_id, p.booking_id, p.amount_cop, p.key_type, p.key_value, p.attempts, p.batch_id;

  SELECT count(*), COALESCE(sum(p.amount_cop), 0) INTO v_n, v_total FROM public.payouts p WHERE p.batch_id = v_batch;
  IF v_n = 0 THEN
    DELETE FROM public.payout_batches WHERE payout_batches.id = v_batch;
  ELSE
    UPDATE public.payout_batches SET count = v_n, total_cop = v_total WHERE payout_batches.id = v_batch;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hx_payout_notify(p_pro uuid, p_amount bigint, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status = 'paid' THEN
    PERFORM public.hx_notify(p_pro, 'payout_paid', '💸 Te llegó tu pago',
      format('Enviamos %s a tu llave Bre-B.', public.hx_cop(p_amount)), '/dashboard/profesional');
  ELSIF p_status = 'failed' THEN
    PERFORM public.hx_notify(p_pro, 'payout_failed', 'No pudimos enviarte tu pago',
      'Revisa que tu llave Bre-B esté bien escrita. Cuando la corrijas, te lo enviamos de nuevo.', '/dashboard/profesional');
  END IF;
END $$;

-- Resultado de enviar un pago a Firux (despachador) o del aviso de Firux (webhook).
--   sent   → Firux lo aceptó y lo está enviando (falta el aviso).
--   paid   → llegó a la llave.
--   retry  → error pasajero (red, 5xx, límite): vuelve a la cola con espera creciente; al 5.º intento queda failed.
--   failed → Firux lo rechazó (llave inválida, cuenta cerrada): espera a que el profesional corrija su llave.
CREATE OR REPLACE FUNCTION public.hx_payout_result(p_payout uuid, p_status text, p_firux_id text, p_error text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_next text := p_status; v_wait interval;
BEGIN
  IF p_status NOT IN ('sent', 'paid', 'retry', 'failed') THEN RETURN 'invalid_status'; END IF;
  SELECT * INTO p FROM public.payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p.status NOT IN ('sending', 'sent') THEN RETURN 'not_in_flight'; END IF;
  IF p_status = 'sent' AND p.status = 'sent' THEN RETURN 'sent'; END IF;
  IF p_status = 'retry' AND p.attempts + 1 >= 5 THEN v_next := 'failed'; END IF;
  v_wait := (ARRAY[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours'])[LEAST(p.attempts + 1, 4)];

  UPDATE public.payouts SET
    status = CASE v_next WHEN 'retry' THEN 'queued' ELSE v_next END,
    firux_payout_id = COALESCE(NULLIF(p_firux_id, ''), firux_payout_id),
    provider_ref = CASE WHEN v_next = 'paid' THEN COALESCE(NULLIF(p_firux_id, ''), firux_payout_id, provider_ref) ELSE provider_ref END,
    error_code = CASE WHEN v_next IN ('retry', 'failed') THEN left(COALESCE(NULLIF(trim(p_error), ''), 'failed'), 120)
                      WHEN v_next = 'paid' THEN NULL ELSE error_code END,
    attempts = CASE WHEN v_next IN ('retry', 'failed') THEN attempts + 1 ELSE attempts END,
    next_attempt_at = CASE WHEN v_next = 'retry' THEN now() + v_wait ELSE NULL END,
    sent_at = CASE WHEN v_next = 'sent' THEN now() ELSE sent_at END,
    paid_at = CASE WHEN v_next = 'paid' THEN now() ELSE paid_at END,
    via = 'auto',
    updated_at = now()
  WHERE id = p.id;

  IF v_next IN ('paid', 'failed') THEN PERFORM public.hx_payout_notify(p.professional_id, p.amount_cop, v_next); END IF;
  RETURN v_next;
END $$;

-- Aviso de Firux por id de dispersión (o por nuestra referencia).
CREATE OR REPLACE FUNCTION public.hx_payout_webhook(p_firux_id text, p_reference text, p_status text, p_error text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.payouts WHERE firux_payout_id = p_firux_id;
  IF v_id IS NULL AND p_reference ~ '^[0-9a-f-]{36}$' THEN
    SELECT id INTO v_id FROM public.payouts WHERE id = p_reference::uuid;
  END IF;
  IF v_id IS NULL THEN RETURN 'unknown_payout'; END IF;
  RETURN public.hx_payout_result(v_id, p_status, p_firux_id, p_error);
END $$;

CREATE OR REPLACE FUNCTION public.hx_finish_batch(p_batch uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.payout_batches b SET
    sent = (SELECT count(*) FROM public.payouts p WHERE p.batch_id = b.id AND p.status IN ('sent', 'paid')),
    failed = (SELECT count(*) FROM public.payouts p WHERE p.batch_id = b.id AND p.status IN ('failed', 'queued')),
    finished_at = now()
  WHERE b.id = p_batch;
$$;

-- Pago manual desde /superadmin/pagos (sigue disponible con la dispersión automática apagada o como respaldo).
CREATE OR REPLACE FUNCTION public.hx_mark_payout(p_payout uuid, p_status text, p_ref text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN RETURN 'invalid_status'; END IF;
  SELECT * INTO p FROM public.payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p.status = 'sending' THEN RETURN 'in_flight'; END IF;
  IF p_status = 'paid' AND (p.status = 'needs_key' OR p.key_value IS NULL) THEN RETURN 'needs_key'; END IF;
  UPDATE public.payouts
     SET status = p_status,
         provider_ref = CASE WHEN p_status = 'paid' THEN left(NULLIF(trim(p_ref), ''), 120) ELSE provider_ref END,
         error_code = CASE WHEN p_status = 'failed' THEN left(COALESCE(NULLIF(trim(p_ref), ''), 'failed'), 120) ELSE NULL END,
         paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE paid_at END,
         via = CASE WHEN p_status = 'paid' THEN 'manual' ELSE via END,
         updated_at = now()
   WHERE id = p.id;
  PERFORM public.hx_payout_notify(p.professional_id, p.amount_cop, p_status);
  RETURN p_status;
END $$;

-- El profesional guarda o corrige su llave: sus pagos en espera o fallidos vuelven a la cola con la llave nueva.
CREATE OR REPLACE FUNCTION public.hx_payout_key_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payouts
     SET key_type = NEW.key_type, key_value = NEW.key_value, status = 'queued', next_attempt_at = NULL, updated_at = now()
   WHERE professional_id = NEW.user_id AND status IN ('needs_key', 'queued', 'failed');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payout_key_sync ON public.professional_payout_keys;
CREATE TRIGGER trg_payout_key_sync AFTER INSERT OR UPDATE OF key_type, key_value ON public.professional_payout_keys
  FOR EACH ROW EXECUTE FUNCTION public.hx_payout_key_sync();

-- 3b) Libro: lo que sale hacia el profesional.
--   → sent: saldo por dispersar → en camino. sent → paid: en camino → afuera. Pago manual: saldo → afuera.
--   sent → failed / reintento: en camino → vuelve a su saldo.
CREATE OR REPLACE FUNCTION public.hx_ledger_payout_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
    PERFORM public.hx_ledger_move(format('payout_sent:%s:%s', NEW.id, NEW.attempts), 'professional', NEW.professional_id,
      'in_transit', NEW.professional_id, NEW.amount_cop, NEW.booking_id, NULL, NEW.id, NULL, 'Dispersión enviada por Bre-B');
  ELSIF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF OLD.status = 'sent' THEN
      PERFORM public.hx_ledger_move('payout_paid:' || NEW.id, 'in_transit', NEW.professional_id, 'external', NULL,
        NEW.amount_cop, NEW.booking_id, NULL, NEW.id, NULL, 'Dispersión confirmada');
    ELSE
      PERFORM public.hx_ledger_move('payout_paid:' || NEW.id, 'professional', NEW.professional_id, 'external', NULL,
        NEW.amount_cop, NEW.booking_id, NULL, NEW.id, NULL,
        CASE WHEN NEW.via = 'manual' THEN 'Pago manual desde Firux' ELSE 'Dispersión confirmada' END);
    END IF;
  ELSIF OLD.status = 'sent' AND NEW.status IN ('failed', 'queued') THEN
    PERFORM public.hx_ledger_move(format('payout_back:%s:%s', NEW.id, OLD.attempts), 'in_transit', NEW.professional_id,
      'professional', NEW.professional_id, NEW.amount_cop, NEW.booking_id, NULL, NEW.id, NULL, 'Dispersión rechazada: vuelve al saldo');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_payout ON public.payouts;
CREATE TRIGGER trg_ledger_payout AFTER UPDATE OF status ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.hx_ledger_payout_trg();

-- Reloj de respaldo: cada minuto, si hay pagos listos y la dispersión está encendida, despierta al despachador.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hx-dispersion-tick';
    PERFORM cron.schedule('hx-dispersion-tick', '* * * * *',
      $cron$SELECT public.hx_kick_dispersion() WHERE EXISTS (SELECT 1 FROM public.payouts WHERE status = 'queued' AND key_value IS NOT NULL AND COALESCE(next_attempt_at, now()) <= now()) OR EXISTS (SELECT 1 FROM public.payouts WHERE status = 'sending' AND updated_at < now() - interval '10 minutes')$cron$);
  END IF;
END $$;

-- ─── 4) Saldos y conciliación ────────────────────────────────────────────────

-- Lo que ve el profesional: retenido (turnos pagados sin liberar), por dispersar, en camino y recibido.
CREATE OR REPLACE FUNCTION public.get_my_earnings()
RETURNS TABLE (held_cop bigint, available_cop bigint, in_transit_cop bigint, paid_30d_cop bigint, paid_total_cop bigint,
               fees_30d_cop bigint, needs_key boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((SELECT sum(s.professional_cop) FROM public.payment_splits s JOIN public.service_bookings b ON b.id = s.booking_id
               WHERE s.professional_id = auth.uid() AND b.escrow_status IN ('held', 'disputed')), 0)::bigint,
    public.hx_ledger_balance('professional', auth.uid()),
    public.hx_ledger_balance('in_transit', auth.uid()),
    COALESCE((SELECT sum(amount_cop) FROM public.ledger_entries
               WHERE from_pro = auth.uid() AND to_account = 'external' AND created_at > now() - interval '30 days'), 0)::bigint,
    COALESCE((SELECT sum(amount_cop) FROM public.ledger_entries WHERE from_pro = auth.uid() AND to_account = 'external'), 0)::bigint,
    COALESCE((SELECT sum(s.platform_fee_cop) FROM public.payment_splits s JOIN public.service_bookings b ON b.id = s.booking_id
               WHERE s.professional_id = auth.uid() AND b.escrow_status = 'released' AND b.released_at > now() - interval '30 days'), 0)::bigint,
    EXISTS (SELECT 1 FROM public.payouts WHERE professional_id = auth.uid() AND status = 'needs_key');
$$;

-- Conciliación (equipo). Devuelve totales por cuenta, saldos por profesional y diferencias encontradas.
CREATE OR REPLACE FUNCTION public.hx_reconciliation()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  WITH acc AS (
    SELECT a AS account, public.hx_ledger_balance(a, NULL) AS balance
      FROM unnest(ARRAY['escrow', 'professional', 'in_transit', 'platform', 'wallet', 'external']) a
  ),
  pros AS (
    SELECT pro, sum(CASE WHEN account = 'professional' THEN amt ELSE 0 END) AS available,
                sum(CASE WHEN account = 'in_transit' THEN amt ELSE 0 END) AS in_transit,
                sum(CASE WHEN account = 'wallet' THEN amt ELSE 0 END) AS wallet,
                sum(CASE WHEN account = 'paid' THEN amt ELSE 0 END) AS paid
      FROM (
        SELECT to_pro AS pro, to_account AS account, amount_cop AS amt FROM public.ledger_entries WHERE to_pro IS NOT NULL
        UNION ALL
        SELECT from_pro, from_account, -amount_cop FROM public.ledger_entries WHERE from_pro IS NOT NULL
        UNION ALL
        SELECT from_pro, 'paid', amount_cop FROM public.ledger_entries WHERE from_pro IS NOT NULL AND to_account = 'external'
      ) x GROUP BY pro
  ),
  held AS (
    SELECT s.professional_id AS pro, sum(s.professional_cop) AS held
      FROM public.payment_splits s JOIN public.service_bookings b ON b.id = s.booking_id
     WHERE b.escrow_status IN ('held', 'disputed') GROUP BY 1
  ),
  open_payouts AS (
    SELECT professional_id AS pro,
           sum(CASE WHEN status IN ('needs_key', 'queued', 'sending', 'failed') THEN amount_cop ELSE 0 END) AS open_amt,
           sum(CASE WHEN status = 'sent' THEN amount_cop ELSE 0 END) AS sent_amt
      FROM public.payouts GROUP BY 1
  ),
  per_pro AS (
    SELECT COALESCE(p.pro, h.pro, o.pro) AS pro, COALESCE(h.held, 0) AS held, COALESCE(p.available, 0) AS available,
           COALESCE(p.in_transit, 0) AS in_transit, COALESCE(p.paid, 0) AS paid, COALESCE(p.wallet, 0) AS wallet,
           COALESCE(o.open_amt, 0) AS open_amt, COALESCE(o.sent_amt, 0) AS sent_amt,
           COALESCE(w.balance_cop, 0) AS wallet_table
      FROM pros p FULL JOIN held h ON h.pro = p.pro FULL JOIN open_payouts o ON o.pro = COALESCE(p.pro, h.pro)
      LEFT JOIN public.wallets w ON w.professional_id = COALESCE(p.pro, h.pro, o.pro)
  ),
  issues AS (
    -- Cobros pagados que no entraron al libro.
    SELECT 'charge_not_in_ledger' AS code, c.id::text AS ref, c.amount_cop AS amount_cop, NULL::uuid AS pro
      FROM public.firux_charges c WHERE c.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.ref = 'charge:' || c.id)
    UNION ALL
    -- Cobro pagado por más o por menos de lo pedido.
    SELECT 'amount_mismatch', c.id::text, COALESCE(c.amount_paid_cop, 0) - c.amount_cop, NULL
      FROM public.firux_charges c WHERE c.status = 'paid' AND c.amount_paid_cop IS NOT NULL AND c.amount_paid_cop <> c.amount_cop
    UNION ALL
    -- Turno cerrado (liberado o devuelto) con dinero aún retenido, sin devoluciones abiertas.
    SELECT 'escrow_leftover', b.id::text, e.bal, b.professional_id
      FROM public.service_bookings b
      JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN l.to_account = 'escrow' THEN l.amount_cop ELSE -l.amount_cop END), 0) AS bal
                      FROM public.ledger_entries l
                     WHERE l.booking_id = b.id AND 'escrow' IN (l.to_account, l.from_account)) e ON true
     WHERE b.escrow_status IN ('released', 'refunded') AND e.bal <> 0
       AND NOT EXISTS (SELECT 1 FROM public.booking_refunds r WHERE r.booking_id = b.id AND r.status <> 'paid')
    UNION ALL
    -- Saldo por dispersar del libro distinto de los pagos abiertos de la cola.
    SELECT 'payout_queue_mismatch', pp.pro::text, pp.available - pp.open_amt, pp.pro
      FROM per_pro pp WHERE pp.available <> pp.open_amt
    UNION ALL
    SELECT 'in_transit_mismatch', pp.pro::text, pp.in_transit - pp.sent_amt, pp.pro
      FROM per_pro pp WHERE pp.in_transit <> pp.sent_amt
    UNION ALL
    -- La billetera del libro no coincide con la tabla de billeteras (movimientos anteriores al libro).
    SELECT 'wallet_mismatch', pp.pro::text, pp.wallet - pp.wallet_table, pp.pro
      FROM per_pro pp WHERE pp.wallet <> pp.wallet_table
    UNION ALL
    -- En camino hace más de 1 h sin aviso de Firux.
    SELECT 'payout_stuck', p.id::text, p.amount_cop, p.professional_id
      FROM public.payouts p WHERE (p.status = 'sent' AND p.sent_at < now() - interval '1 hour')
                               OR (p.status = 'sending' AND p.updated_at < now() - interval '10 minutes')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'accounts', (SELECT jsonb_object_agg(account, balance) FROM acc),
    'collected_30d', (SELECT COALESCE(sum(amount_cop), 0) FROM public.firux_charges WHERE status = 'paid' AND kind = 'booking' AND paid_at > now() - interval '30 days'),
    'platform_fees_30d', (SELECT COALESCE(sum(amount_cop), 0) FROM public.ledger_entries WHERE to_account = 'platform' AND created_at > now() - interval '30 days'),
    'professionals', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'professional_id', pp.pro, 'name', pr.full_name, 'held', pp.held, 'available', pp.available,
        'in_transit', pp.in_transit, 'paid', pp.paid, 'wallet', pp.wallet) ORDER BY pp.available DESC, pp.held DESC), '[]'::jsonb)
        FROM per_pro pp LEFT JOIN public.profiles pr ON pr.user_id = pp.pro
       WHERE pp.held <> 0 OR pp.available <> 0 OR pp.in_transit <> 0 OR pp.paid <> 0 OR pp.wallet <> 0),
    'issues', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'ref', ref, 'amount_cop', amount_cop, 'professional_id', pro)), '[]'::jsonb) FROM issues)
  ) INTO v;
  RETURN v;
END $$;

-- ─── 5) Relleno: lo que ya existía entra al libro una vez ────────────────────

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.firux_charges WHERE status = 'paid' ORDER BY paid_at NULLS FIRST LOOP
    PERFORM public.hx_ledger_charge_paid(r.id);
  END LOOP;
  FOR r IN SELECT id, escrow_status FROM public.service_bookings WHERE paid_at IS NOT NULL AND payment_method = 'DIGITAL_BREB' LOOP
    PERFORM public.hx_split_booking(r.id);
    IF r.escrow_status = 'released' THEN PERFORM public.hx_ledger_release(r.id); END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.booking_refunds WHERE status = 'paid' LOOP
    PERFORM public.hx_ledger_move('refund:' || r.id, 'escrow', NULL, 'external', NULL, r.amount_cop, r.booking_id, r.charge_id, NULL, r.id, 'Devolución al pagador');
  END LOOP;
  FOR r IN SELECT * FROM public.payouts WHERE status IN ('sent', 'paid') LOOP
    IF r.status = 'sent' THEN
      PERFORM public.hx_ledger_move(format('payout_sent:%s:%s', r.id, r.attempts), 'professional', r.professional_id, 'in_transit', r.professional_id, r.amount_cop, r.booking_id, NULL, r.id, NULL, 'Dispersión enviada por Bre-B');
    ELSE
      PERFORM public.hx_ledger_move('payout_paid:' || r.id, 'professional', r.professional_id, 'external', NULL, r.amount_cop, r.booking_id, NULL, r.id, NULL, 'Pago manual desde Firux');
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.wallet_movements WHERE kind <> 'topup' ORDER BY created_at LOOP
    IF r.amount_cop < 0 THEN
      PERFORM public.hx_ledger_move('wallet:' || r.id, 'wallet', r.professional_id, 'platform', NULL, -r.amount_cop, r.booking_id, r.charge_id, NULL, NULL, 'Comisión de turno en efectivo');
    ELSE
      PERFORM public.hx_ledger_move('wallet:' || r.id, 'platform', NULL, 'wallet', r.professional_id, r.amount_cop, r.booking_id, r.charge_id, NULL, NULL, COALESCE(r.note, 'Ajuste'));
    END IF;
  END LOOP;
END $$;

-- ─── 6) Permisos ─────────────────────────────────────────────────────────────

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.hx_ledger_move(text, text, uuid, text, uuid, bigint, uuid, uuid, uuid, uuid, text)',
    'public.hx_ledger_balance(text, uuid)',
    'public.hx_ledger_charge_paid(uuid)', 'public.hx_split_booking(uuid)', 'public.hx_ledger_release(uuid)',
    'public.hx_ledger_charge_trg()', 'public.hx_ledger_booking_trg()', 'public.hx_ledger_refund_trg()',
    'public.hx_ledger_wallet_trg()', 'public.hx_ledger_payout_trg()', 'public.hx_payout_kick_trg()',
    'public.hx_kick_dispersion()', 'public.hx_claim_payouts(integer, text, uuid)',
    'public.hx_payout_notify(uuid, bigint, text)',
    'public.hx_payout_result(uuid, text, text, text)', 'public.hx_payout_webhook(text, text, text, text)',
    'public.hx_finish_batch(uuid)', 'public.hx_mark_payout(uuid, text, text)', 'public.hx_payout_key_sync()',
    'public.hx_reconciliation()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.get_my_earnings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_earnings() TO authenticated, service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payouts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
  END IF;
END $$;
