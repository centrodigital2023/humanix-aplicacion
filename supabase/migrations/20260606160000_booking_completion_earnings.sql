-- ──────────────────────────────────────────────────────────────────────────
-- Auto-acreditación de ganancias al completar un service_booking.
--
-- Modelo de comisión (alineado con el catálogo de planes en src/lib/plans.ts):
--   · Profesionales en plan Free            → comisión estándar del 12%
--   · Profesionales Esencial/Pro/IPS        → 0% (feature `no_commission`,
--                                              ya incluida desde essential_monthly)
-- La comisión incentiva la suscripción: con ~2-3 servicios al mes el ahorro
-- en comisión supera el costo de la membresía Esencial (COP 9.000/mes).
--
-- El neto (total_amount − comisión) se acredita automáticamente en la
-- billetera del profesional (wallet_transactions) cuando el booking pasa a
-- 'completed'. Reutiliza las columnas contables que ya existían en
-- service_bookings (platform_fee_pct, platform_fee_amount, professional_payout)
-- para dejar trazabilidad por reserva.
-- ──────────────────────────────────────────────────────────────────────────

-- Determina el % de comisión de plataforma para un usuario según su plan activo
-- en mp_subscriptions (misma fuente que usePlan/normalizePlan en el frontend).
CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan   TEXT;
  v_status TEXT;
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT plan, status, current_period_end
    INTO v_plan, v_status, v_period_end
  FROM public.mp_subscriptions
  WHERE user_id = p_user_id;

  IF v_plan IS NOT NULL
     AND v_status IN ('active', 'approved')
     AND (v_period_end IS NULL OR v_period_end > now())
     AND v_plan IN ('essential_monthly', 'pro_monthly', 'institution_monthly')
  THEN
    RETURN 0; -- no_commission: incluido desde el plan Esencial
  END IF;

  RETURN 12; -- comisión estándar para profesionales en plan Free
END;
$$;

COMMENT ON FUNCTION public.platform_commission_pct IS
  'Comisión de plataforma según plan activo: 0% desde essential_monthly (feature no_commission), 12% en plan Free.';

-- Acredita automáticamente la ganancia neta del profesional cuando su booking
-- pasa a 'completed'. Idempotente: nunca acredita dos veces el mismo booking.
CREATE OR REPLACE FUNCTION public.credit_booking_completion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pct          NUMERIC;
  v_gross_cents  BIGINT;
  v_fee_cents    BIGINT;
  v_payout_cents BIGINT;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE booking_id = NEW.id AND type = 'service_earning'
  ) THEN
    RETURN NEW;
  END IF;

  v_gross_cents := COALESCE(NEW.total_amount, 0)::BIGINT * 100;
  IF v_gross_cents <= 0 THEN
    RETURN NEW;
  END IF;

  v_pct := public.platform_commission_pct(NEW.professional_id);
  v_fee_cents := ROUND(v_gross_cents * v_pct / 100.0);
  v_payout_cents := v_gross_cents - v_fee_cents;

  PERFORM public.record_wallet_transaction(
    NEW.professional_id,
    'service_earning',
    v_payout_cents,
    NEW.id,
    CASE
      WHEN v_pct > 0 THEN format('Servicio completado · comisión Humanix %s%%', v_pct)
      ELSE 'Servicio completado · sin comisión (plan Esencial+)'
    END
  );

  -- Trazabilidad contable por reserva (no dispara recursión: no toca `status`)
  UPDATE public.service_bookings
     SET platform_fee_pct    = v_pct,
         platform_fee_amount = (v_fee_cents / 100)::INTEGER,
         professional_payout = (v_payout_cents / 100)::INTEGER
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.credit_booking_completion IS
  'Trigger: al completar un service_booking, acredita el neto (total − comisión por plan) en la billetera del profesional vía record_wallet_transaction.';

DROP TRIGGER IF EXISTS trg_sb_credit_completion ON public.service_bookings;
CREATE TRIGGER trg_sb_credit_completion
AFTER UPDATE OF status ON public.service_bookings
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION public.credit_booking_completion();
