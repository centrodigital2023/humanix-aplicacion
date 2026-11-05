DO $$ BEGIN
  IF to_regclass('public.firux_charges') IS NOT NULL AND to_regclass('public.payment_charges') IS NULL THEN
    ALTER TABLE public.firux_charges RENAME TO payment_charges;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'payment_charges' AND column_name = 'firux_id') THEN
    ALTER TABLE public.payment_charges RENAME COLUMN firux_id TO provider_tx_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'payment_charges' AND column_name = 'payment_url') THEN
    ALTER TABLE public.payment_charges RENAME COLUMN payment_url TO checkout_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'service_bookings' AND column_name = 'firux_charge_id') THEN
    ALTER TABLE public.service_bookings RENAME COLUMN firux_charge_id TO charge_id;
  END IF;
  IF to_regclass('public.ix_firux_charges_booking') IS NOT NULL THEN
    ALTER INDEX public.ix_firux_charges_booking RENAME TO ix_payment_charges_booking;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payment_charges' AND policyname = 'firux_charges_read') THEN
    ALTER POLICY firux_charges_read ON public.payment_charges RENAME TO payment_charges_read;
  END IF;
END $$;

ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS charge_id uuid;
ALTER TABLE public.payment_charges ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'firux';
ALTER TABLE public.payment_charges ALTER COLUMN provider SET DEFAULT 'wompi';
ALTER TABLE public.payment_charges ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE public.payment_charges ADD COLUMN IF NOT EXISTS provider_tx_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payment_charges'::regclass AND conname = 'payment_charges_provider_check') THEN
    ALTER TABLE public.payment_charges ADD CONSTRAINT payment_charges_provider_check CHECK (provider IN ('firux', 'wompi'));
  END IF;
END $$;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.payment_charges'::regclass AND conname LIKE 'firux\_charges\_%' LOOP
    EXECUTE format('ALTER TABLE public.payment_charges RENAME CONSTRAINT %I TO %I', r.conname,
                   replace(replace(r.conname, 'firux_charges_firux_id_key', 'payment_charges_provider_tx_id_key'),
                           'firux_charges_', 'payment_charges_'));
  END LOOP;
END $$;
UPDATE public.payment_charges SET status = 'expired' WHERE provider = 'firux' AND status = 'pending';

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
  NEW.charge_id             := OLD.charge_id;
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

CREATE OR REPLACE FUNCTION public.hx_queue_refund(p_booking uuid, p_charge uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; c record; k record; v_id uuid; v_amount bigint;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.payment_charges WHERE id = COALESCE(p_charge, b.charge_id);
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

CREATE OR REPLACE FUNCTION public.hx_queue_payout(p_booking uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; k record; v_id uuid;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.payment_method <> 'DIGITAL_BREB' OR b.paid_at IS NULL OR b.status <> 'completed'
     OR b.escrow_status IS DISTINCT FROM 'released' OR COALESCE(b.professional_payout, 0) <= 0 THEN
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

CREATE OR REPLACE FUNCTION public.hx_charge_paid(p_charge uuid, p_provider_tx text, p_amount_paid bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; b record; v_end timestamptz; v_state text; v_pro text;
BEGIN
  SELECT * INTO c FROM public.payment_charges WHERE id = p_charge FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown_charge'; END IF;
  IF c.status = 'paid' THEN RETURN 'already_applied'; END IF;
  IF COALESCE(p_amount_paid, 0) < c.amount_cop THEN
    UPDATE public.payment_charges SET status = 'underpaid', amount_paid_cop = p_amount_paid,
           provider_tx_id = COALESCE(NULLIF(p_provider_tx, ''), provider_tx_id) WHERE id = c.id;
    RETURN 'underpaid';
  END IF;
  UPDATE public.payment_charges SET status = 'paid', amount_paid_cop = p_amount_paid, paid_at = now(),
         provider_tx_id = COALESCE(NULLIF(p_provider_tx, ''), provider_tx_id) WHERE id = c.id;

  IF c.kind = 'booking' THEN
    SELECT * INTO b FROM public.service_bookings WHERE id = c.booking_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'applied';
    END IF;
    IF b.paid_at IS NOT NULL AND b.charge_id IS DISTINCT FROM c.id THEN
      PERFORM public.hx_queue_refund(b.id, c.id, 'duplicate');
      RETURN 'duplicate_refund';
    END IF;
    v_state := CASE
      WHEN b.status = 'cancelled' THEN 'refunding'
      WHEN b.status = 'completed' AND b.client_confirmed_at IS NOT NULL THEN 'released'
      ELSE 'held' END;
    UPDATE public.service_bookings
       SET paid_at = now(), charge_id = c.id, escrow_status = v_state,
           released_at = CASE WHEN v_state = 'released' THEN now() END,
           release_reason = CASE WHEN v_state = 'released' THEN 'client_confirmed' END,
           release_due_at = CASE WHEN v_state = 'held' AND b.status = 'completed' THEN now() + public.hx_escrow_window() END
     WHERE id = b.id;

    IF v_state = 'refunding' THEN
      PERFORM public.hx_queue_refund(b.id, c.id, 'cancelled');
    ELSE
      PERFORM public.hx_queue_payout(b.id);
      v_pro := split_part(COALESCE(public.party_display_name(b.professional_id), 'el profesional'), ' ', 1);
      PERFORM public.hx_notify(b.professional_id, 'booking_paid', '🔒 Pago asegurado',
        CASE WHEN b.status = 'pending' THEN format('La familia ya pagó %s. Acepta el turno: Humanix guarda el dinero y te lo libera al terminar.', public.hx_cop(b.total_amount))
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
    PERFORM public.hx_wallet_apply(c.user_id, 'topup', c.amount_cop, NULL, c.id, 'Recarga en línea (Wompi)');
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

CREATE OR REPLACE FUNCTION public.hx_charge_attempt(p_charge uuid, p_provider_tx text, p_status text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF p_status NOT IN ('pending', 'failed') THEN RETURN 'invalid_status'; END IF;
  UPDATE public.payment_charges
     SET provider_tx_id = COALESCE(provider_tx_id, NULLIF(p_provider_tx, '')),
         status = CASE WHEN p_status = 'failed' THEN 'failed' ELSE status END
   WHERE id = p_charge AND status IN ('pending', 'expired', 'failed');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 0 THEN 'unchanged' ELSE p_status END;
END $$;

REVOKE ALL ON FUNCTION public.guard_service_bookings_financials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_queue_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_queue_payout(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_charge_paid(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_charge_attempt(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_queue_refund(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_queue_payout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_charge_paid(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_charge_attempt(uuid, text, text) TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_splits (
  booking_id       uuid PRIMARY KEY REFERENCES public.service_bookings (id) ON DELETE CASCADE,
  charge_id        uuid REFERENCES public.payment_charges (id) ON DELETE SET NULL,
  professional_id  uuid NOT NULL,
  payer_id         uuid NOT NULL,
  gross_cop        bigint NOT NULL CHECK (gross_cop > 0),
  commission_pct   numeric NOT NULL,
  exempt_cop       bigint NOT NULL DEFAULT 0,
  platform_fee_cop bigint NOT NULL CHECK (platform_fee_cop >= 0),
  professional_cop bigint NOT NULL CHECK (professional_cop >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_splits_sum CHECK (platform_fee_cop + professional_cop = gross_cop)
);
CREATE INDEX IF NOT EXISTS ix_payment_splits_pro ON public.payment_splits (professional_id, created_at DESC);
REVOKE ALL ON public.payment_splits FROM anon, authenticated;
GRANT SELECT ON public.payment_splits TO authenticated;
GRANT ALL ON public.payment_splits TO service_role;
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_splits_read ON public.payment_splits;
CREATE POLICY payment_splits_read ON public.payment_splits FOR SELECT TO authenticated
  USING (auth.uid() = professional_id OR auth.uid() = payer_id OR public.is_staff(auth.uid()));

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
REVOKE ALL ON public.ledger_entries FROM anon, authenticated;
GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;
GRANT USAGE ON SEQUENCE public.ledger_entries_id_seq TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_entries_read ON public.ledger_entries;
CREATE POLICY ledger_entries_read ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR auth.uid() = from_pro OR auth.uid() = to_pro);

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

CREATE OR REPLACE FUNCTION public.hx_ledger_balance(p_account text, p_pro uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(CASE WHEN to_account = p_account AND (p_pro IS NULL OR to_pro = p_pro) THEN amount_cop ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN from_account = p_account AND (p_pro IS NULL OR from_pro = p_pro) THEN amount_cop ELSE 0 END), 0)
    FROM public.ledger_entries
   WHERE (to_account = p_account AND (p_pro IS NULL OR to_pro = p_pro))
      OR (from_account = p_account AND (p_pro IS NULL OR from_pro = p_pro));
$$;

CREATE OR REPLACE FUNCTION public.hx_ledger_charge_paid(p_charge uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_memo text;
BEGIN
  SELECT * INTO c FROM public.payment_charges WHERE id = p_charge;
  IF NOT FOUND OR c.status <> 'paid' THEN RETURN; END IF;
  v_memo := CASE c.provider WHEN 'firux' THEN 'Firux' ELSE 'Wompi' END;
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

CREATE OR REPLACE FUNCTION public.hx_split_booking(p_booking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.paid_at IS NULL OR b.payment_method <> 'DIGITAL_BREB' OR COALESCE(b.total_amount, 0) <= 0 THEN RETURN; END IF;
  INSERT INTO public.payment_splits (booking_id, charge_id, professional_id, payer_id,
                                     gross_cop, commission_pct, exempt_cop, platform_fee_cop, professional_cop)
  VALUES (b.id, b.charge_id, b.professional_id, b.client_id,
          b.total_amount, COALESCE(b.platform_fee_pct, 0), COALESCE(b.commission_exempt_cop, 0),
          COALESCE(b.platform_fee_amount, 0), b.total_amount - COALESCE(b.platform_fee_amount, 0))
  ON CONFLICT (booking_id) DO NOTHING;
END $$;

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
END $$;

CREATE OR REPLACE FUNCTION public.hx_ledger_charge_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.hx_ledger_charge_paid(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ledger_charge ON public.payment_charges;
CREATE TRIGGER trg_ledger_charge AFTER UPDATE OF status ON public.payment_charges
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

CREATE OR REPLACE FUNCTION public.hx_ledger_wallet_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'topup' THEN RETURN NEW; END IF;
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