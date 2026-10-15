-- Comisión decidida por el servidor y créditos IA completos (verificado contra producción el 15 oct 2026).
-- Ver docs/VERIFICACION_PAGOS.md. Idempotente.
--
-- 1) Comisión. service_bookings.platform_fee_pct tenía 0 por defecto y el navegador no lo envía: ningún servicio creado
--    desde la reserva directa registraba comisión. Las funciones del servidor (accept_application, accept_slot_proposal,
--    create_contract_for_application) ya usan platform_commission_pct(profesional); este trigger aplica la misma regla
--    a TODA inserción (12 % si el profesional está en Free, 0 % con plan de pago). Corre antes de trg_sb_compute_fee
--    (orden alfabético de los BEFORE), que calcula el monto y el neto con este porcentaje.
--
-- 2) Créditos IA. En producción faltaban consume_ai_credits y los saldos: los créditos comprados no se podían gastar
--    y chat-copilot fallaba para todos. Cambios frente al diseño del repositorio (20260606170000 / 20261007000000):
--    - el consumo usa primero el cupo mensual del plan y luego los paquetes comprados (antes los ignoraba);
--    - nadie puede leer el saldo de otra persona;
--    - el libro de consumo no se escribe desde el navegador (todas las escrituras son del servidor) y no admite
--      consumos de cero o negativos (un consumo negativo «fabricaba» créditos);
--    - el mes se cuenta en hora de Colombia.

-- ─── 1) Comisión ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_booking_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.platform_fee_pct := public.platform_commission_pct(NEW.professional_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hx_booking_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sb_a_commission ON public.service_bookings;
CREATE TRIGGER trg_sb_a_commission
  BEFORE INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_booking_commission();

-- ─── 2) Créditos IA ───────────────────────────────────────────────────────────

-- El libro de consumo solo lo escribe el servidor.
DROP POLICY IF EXISTS "aic_insert_self" ON public.ai_credits_ledger;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_credits_ledger'::regclass AND conname = 'ai_credits_ledger_positive'
  ) THEN
    ALTER TABLE public.ai_credits_ledger
      ADD CONSTRAINT ai_credits_ledger_positive CHECK (credits_used > 0);
  END IF;
END $$;

-- Inicio del mes en curso, en hora de Colombia.
CREATE OR REPLACE FUNCTION public.hx_ai_month_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (date_trunc('month', now() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'America/Bogota';
$$;

-- Solo la propia persona, el personal autorizado o el servidor (sin auth.uid()).
CREATE OR REPLACE FUNCTION public.hx_ai_credits_assert_self(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Cupo mensual según el plan vigente (misma regla de plan vigente que plan_key_for).
CREATE OR REPLACE FUNCTION public.ai_credits_monthly_allowance(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.plan_key_for(p_user_id)
    WHEN 'institution_monthly' THEN 2000
    WHEN 'pro_monthly'         THEN 400
    WHEN 'essential_monthly'   THEN 150
    ELSE 30
  END;
$$;

-- Lo usado del cupo mensual este mes (lo pagado con paquetes no cuenta aquí).
CREATE OR REPLACE FUNCTION public.hx_ai_monthly_used(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(credits_used), 0)::integer
    FROM public.ai_credits_ledger
   WHERE user_id = p_user_id
     AND created_at >= public.hx_ai_month_start()
     AND COALESCE(meta->>'source', 'monthly') <> 'topup';
$$;

CREATE OR REPLACE FUNCTION public.get_ai_credits_balance(p_user_id uuid)
RETURNS TABLE (
  allowance    integer,
  used         integer,
  remaining    integer,
  period_start timestamptz,
  period_end   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowance integer;
  v_used      integer;
  v_start     timestamptz := public.hx_ai_month_start();
BEGIN
  PERFORM public.hx_ai_credits_assert_self(p_user_id);
  v_allowance := public.ai_credits_monthly_allowance(p_user_id);
  v_used := public.hx_ai_monthly_used(p_user_id);
  RETURN QUERY SELECT
    v_allowance,
    v_used,
    GREATEST(v_allowance - v_used, 0),
    v_start,
    ((date_trunc('month', now() AT TIME ZONE 'America/Bogota') + interval '1 month') AT TIME ZONE 'America/Bogota');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_total_ai_credits_balance(p_user_id uuid)
RETURNS TABLE (
  monthly_allowance integer,
  monthly_used      integer,
  monthly_remaining integer,
  extra_total       integer,
  extra_used        integer,
  extra_remaining   integer,
  grand_total       integer,
  period_start      timestamptz,
  period_end        timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m           record;
  v_extra     integer;
  v_extra_use integer;
BEGIN
  PERFORM public.hx_ai_credits_assert_self(p_user_id);
  SELECT * INTO m FROM public.get_ai_credits_balance(p_user_id);
  SELECT COALESCE(SUM(t.credits), 0)::integer,
         COALESCE(SUM(LEAST(t.credits_used, t.credits)), 0)::integer
    INTO v_extra, v_extra_use
    FROM public.ai_credit_topups t
   WHERE t.user_id = p_user_id AND t.expires_at > now();
  RETURN QUERY SELECT
    m.allowance,
    m.used,
    m.remaining,
    v_extra,
    v_extra_use,
    GREATEST(v_extra - v_extra_use, 0),
    m.remaining + GREATEST(v_extra - v_extra_use, 0),
    m.period_start,
    m.period_end;
END;
$$;

-- Único punto de consumo: primero el cupo del mes, luego los paquetes comprados (el que vence antes primero).
-- Atómico por persona (advisory lock + FOR UPDATE). Si no alcanza, no se cobra nada y se lanza ai_credits_exhausted.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(
  p_user_id uuid,
  p_feature text,
  p_amount  integer DEFAULT 1,
  p_meta    jsonb DEFAULT NULL
)
RETURNS public.ai_credits_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_need    integer;
  v_month   integer;
  v_take    integer;
  v_from_tp integer := 0;
  t         record;
  v_row     public.ai_credits_ledger;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100 THEN
    RAISE EXCEPTION 'p_amount debe estar entre 1 y 100';
  END IF;
  PERFORM public.hx_ai_credits_assert_self(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtext('ai_credits:' || p_user_id::text));

  v_need := p_amount;
  v_month := LEAST(v_need, GREATEST(public.ai_credits_monthly_allowance(p_user_id) - public.hx_ai_monthly_used(p_user_id), 0));
  v_need := v_need - v_month;

  IF v_need > 0 THEN
    FOR t IN
      SELECT id, credits, credits_used
        FROM public.ai_credit_topups
       WHERE user_id = p_user_id AND expires_at > now() AND credits_used < credits
       ORDER BY expires_at, created_at
       FOR UPDATE
    LOOP
      EXIT WHEN v_need = 0;
      v_take := LEAST(v_need, t.credits - t.credits_used);
      UPDATE public.ai_credit_topups SET credits_used = credits_used + v_take WHERE id = t.id;
      v_need := v_need - v_take;
      v_from_tp := v_from_tp + v_take;
    END LOOP;
  END IF;

  IF v_need > 0 THEN
    RAISE EXCEPTION 'ai_credits_exhausted: sin créditos disponibles' USING ERRCODE = 'P0001';
  END IF;

  IF v_month > 0 THEN
    INSERT INTO public.ai_credits_ledger (user_id, feature, credits_used, meta)
    VALUES (p_user_id, p_feature, v_month, COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('source', 'monthly'))
    RETURNING * INTO v_row;
  END IF;
  IF v_from_tp > 0 THEN
    INSERT INTO public.ai_credits_ledger (user_id, feature, credits_used, meta)
    VALUES (p_user_id, p_feature, v_from_tp, COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('source', 'topup'))
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.hx_ai_month_start() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_ai_credits_assert_self(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_ai_monthly_used(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credits_monthly_allowance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_credits_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_total_ai_credits_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_ai_credits(uuid, text, integer, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hx_ai_month_start() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_ai_credits_assert_self(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hx_ai_monthly_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_monthly_allowance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_credits_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_total_ai_credits_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_credits(uuid, text, integer, jsonb) TO service_role;
