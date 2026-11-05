ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS provider_payout_id text,
  ADD COLUMN IF NOT EXISTS idem_gen integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS via text;
CREATE INDEX IF NOT EXISTS ix_payouts_provider_id ON public.payouts (provider_payout_id) WHERE provider_payout_id IS NOT NULL;
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
REVOKE ALL ON public.payout_batches FROM anon, authenticated;
GRANT SELECT ON public.payout_batches TO authenticated;
GRANT ALL ON public.payout_batches TO service_role;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_batches_read ON public.payout_batches;
CREATE POLICY payout_batches_read ON public.payout_batches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.hx_dispersion_config (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled      boolean NOT NULL DEFAULT false,
  dispatch_url text,
  secret       text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.hx_dispersion_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON public.hx_dispersion_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hx_dispersion_config TO service_role;
ALTER TABLE public.hx_dispersion_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net no disponible';
END $$;

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

DROP FUNCTION IF EXISTS public.hx_claim_payouts(integer, text, uuid);
CREATE OR REPLACE FUNCTION public.hx_claim_payouts(p_limit integer, p_trigger text, p_by uuid)
RETURNS TABLE (id uuid, professional_id uuid, booking_id uuid, amount_cop bigint, key_type text, key_value text,
               attempts integer, batch_id uuid, idem_gen integer, payee_name text, payee_email text)
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
  RETURNING p.id, p.professional_id, p.booking_id, p.amount_cop, p.key_type, p.key_value, p.attempts, p.batch_id,
            p.idem_gen,
            (SELECT pr.full_name::text FROM public.profiles pr WHERE pr.user_id = p.professional_id LIMIT 1),
            (SELECT u.email::text FROM auth.users u WHERE u.id = p.professional_id);

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

DROP FUNCTION IF EXISTS public.hx_payout_result(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.hx_payout_result(p_payout uuid, p_status text, p_provider_id text, p_error text,
                                                   p_definitive boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_next text := p_status; v_wait interval;
BEGIN
  IF p_status NOT IN ('sent', 'paid', 'retry', 'failed') THEN RETURN 'invalid_status'; END IF;
  SELECT * INTO p FROM public.payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p_status = 'paid' THEN
    IF p.status = 'needs_key' THEN RETURN 'not_in_flight'; END IF;
  ELSIF p.status NOT IN ('sending', 'sent') THEN
    RETURN 'not_in_flight';
  END IF;
  IF p_status = 'sent' AND p.status = 'sent' THEN RETURN 'sent'; END IF;
  IF p_status = 'retry' AND p.attempts + 1 >= 5 THEN v_next := 'failed'; END IF;
  v_wait := (ARRAY[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours'])[LEAST(p.attempts + 1, 4)];

  UPDATE public.payouts SET
    status = CASE v_next WHEN 'retry' THEN 'queued' ELSE v_next END,
    provider_payout_id = CASE WHEN p_definitive AND v_next IN ('retry', 'failed') THEN NULL
                              ELSE COALESCE(NULLIF(p_provider_id, ''), provider_payout_id) END,
    provider_ref = CASE WHEN v_next = 'paid' THEN COALESCE(NULLIF(p_provider_id, ''), provider_payout_id, provider_ref) ELSE provider_ref END,
    error_code = CASE WHEN v_next IN ('retry', 'failed') THEN left(COALESCE(NULLIF(trim(p_error), ''), 'failed'), 120)
                      WHEN v_next = 'paid' THEN NULL ELSE error_code END,
    attempts = CASE WHEN v_next IN ('retry', 'failed') THEN attempts + 1 ELSE attempts END,
    idem_gen = CASE WHEN p_definitive AND v_next IN ('retry', 'failed') THEN idem_gen + 1 ELSE idem_gen END,
    next_attempt_at = CASE WHEN v_next = 'retry' THEN now() + v_wait ELSE NULL END,
    sent_at = CASE WHEN v_next = 'sent' THEN now() ELSE sent_at END,
    paid_at = CASE WHEN v_next = 'paid' THEN now() ELSE paid_at END,
    via = 'auto',
    updated_at = now()
  WHERE id = p.id;

  IF v_next IN ('paid', 'failed') THEN PERFORM public.hx_payout_notify(p.professional_id, p.amount_cop, v_next); END IF;
  RETURN v_next;
END $$;

DROP FUNCTION IF EXISTS public.hx_payout_webhook(text, text, text, text);
CREATE OR REPLACE FUNCTION public.hx_payout_webhook(p_provider_id text, p_reference text, p_status text, p_error text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NULLIF(p_provider_id, '') IS NOT NULL THEN
    SELECT id INTO v_id FROM public.payouts WHERE provider_payout_id = p_provider_id ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_id IS NULL AND left(COALESCE(p_reference, ''), 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_id FROM public.payouts WHERE id = left(p_reference, 36)::uuid;
  END IF;
  IF v_id IS NULL THEN RETURN 'unknown_payout'; END IF;
  RETURN public.hx_payout_result(v_id, p_status, p_provider_id, p_error, true);
END $$;

CREATE OR REPLACE FUNCTION public.hx_finish_batch(p_batch uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.payout_batches b SET
    sent = (SELECT count(*) FROM public.payouts p WHERE p.batch_id = b.id AND p.status IN ('sent', 'paid')),
    failed = (SELECT count(*) FROM public.payouts p WHERE p.batch_id = b.id AND p.status IN ('failed', 'queued')),
    finished_at = now()
  WHERE b.id = p_batch;
$$;

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
        CASE WHEN NEW.via = 'manual' THEN 'Pago manual desde Wompi' ELSE 'Dispersión confirmada' END);
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
    SELECT 'charge_not_in_ledger' AS code, c.id::text AS ref, c.amount_cop AS amount_cop, NULL::uuid AS pro
      FROM public.payment_charges c WHERE c.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.ref = 'charge:' || c.id)
    UNION ALL
    SELECT 'amount_mismatch', c.id::text, COALESCE(c.amount_paid_cop, 0) - c.amount_cop, NULL
      FROM public.payment_charges c WHERE c.status = 'paid' AND c.amount_paid_cop IS NOT NULL AND c.amount_paid_cop <> c.amount_cop
    UNION ALL
    SELECT 'escrow_leftover', b.id::text, e.bal, b.professional_id
      FROM public.service_bookings b
      JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN l.to_account = 'escrow' THEN l.amount_cop ELSE -l.amount_cop END), 0) AS bal
                      FROM public.ledger_entries l
                     WHERE l.booking_id = b.id AND 'escrow' IN (l.to_account, l.from_account)) e ON true
     WHERE b.escrow_status IN ('released', 'refunded') AND e.bal <> 0
       AND NOT EXISTS (SELECT 1 FROM public.booking_refunds r WHERE r.booking_id = b.id AND r.status <> 'paid')
    UNION ALL
    SELECT 'payout_queue_mismatch', pp.pro::text, pp.available - pp.open_amt, pp.pro
      FROM per_pro pp WHERE pp.available <> pp.open_amt
    UNION ALL
    SELECT 'in_transit_mismatch', pp.pro::text, pp.in_transit - pp.sent_amt, pp.pro
      FROM per_pro pp WHERE pp.in_transit <> pp.sent_amt
    UNION ALL
    SELECT 'wallet_mismatch', pp.pro::text, pp.wallet - pp.wallet_table, pp.pro
      FROM per_pro pp WHERE pp.wallet <> pp.wallet_table
    UNION ALL
    SELECT 'payout_stuck', p.id::text, p.amount_cop, p.professional_id
      FROM public.payouts p WHERE (p.status = 'sent' AND p.sent_at < now() - interval '1 hour')
                               OR (p.status = 'sending' AND p.updated_at < now() - interval '10 minutes')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'accounts', (SELECT jsonb_object_agg(account, balance) FROM acc),
    'collected_30d', (SELECT COALESCE(sum(amount_cop), 0) FROM public.payment_charges WHERE status = 'paid' AND kind = 'booking' AND paid_at > now() - interval '30 days'),
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

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.payment_charges WHERE status = 'paid' ORDER BY paid_at NULLS FIRST LOOP
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
      PERFORM public.hx_ledger_move('payout_paid:' || r.id, 'professional', r.professional_id, 'external', NULL, r.amount_cop, r.booking_id, NULL, r.id, NULL, 'Pago manual (antes del libro)');
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
    'public.hx_payout_result(uuid, text, text, text, boolean)', 'public.hx_payout_webhook(text, text, text, text)',
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