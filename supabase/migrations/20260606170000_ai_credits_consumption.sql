-- ──────────────────────────────────────────────────────────────────────────
-- Sistema de créditos IA — lógica de consumo (el ledger ya existía pero no
-- tenía cupo mensual ni función de consumo atómica; solo se insertaba sin
-- validar saldo, ver supabase/functions/chat-copilot).
--
-- Cupo mensual por plan (créditos = 1 invocación de una función IA):
--   free                → 30   (probar la IA sin costo)
--   essential_monthly   → 150
--   pro_monthly         → 400
--   institution_monthly → 2000 (feature `ai_credits`: "Bolsa de créditos IA mensual")
--
-- El período de consumo es el mes calendario (date_trunc('month', now())).
-- ──────────────────────────────────────────────────────────────────────────

-- Cupo mensual de créditos IA según el plan activo del usuario (mp_subscriptions)
CREATE OR REPLACE FUNCTION public.ai_credits_monthly_allowance(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan       TEXT;
  v_status     TEXT;
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT plan, status, current_period_end
    INTO v_plan, v_status, v_period_end
  FROM public.mp_subscriptions
  WHERE user_id = p_user_id;

  IF v_plan IS NULL
     OR v_status NOT IN ('active', 'approved')
     OR (v_period_end IS NOT NULL AND v_period_end <= now())
  THEN
    RETURN 30; -- Free
  END IF;

  RETURN CASE v_plan
    WHEN 'institution_monthly' THEN 2000
    WHEN 'pro_monthly'         THEN 400
    WHEN 'essential_monthly'   THEN 150
    ELSE 30
  END;
END;
$$;

COMMENT ON FUNCTION public.ai_credits_monthly_allowance IS
  'Cupo mensual de créditos IA según el plan activo: free=30, essential=150, pro=400, institution=2000.';

-- Saldo actual del período (mes calendario en curso)
CREATE OR REPLACE FUNCTION public.get_ai_credits_balance(p_user_id UUID)
RETURNS TABLE (
  allowance    INTEGER,
  used         INTEGER,
  remaining    INTEGER,
  period_start TIMESTAMPTZ,
  period_end   TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_allowance    INTEGER;
  v_used         INTEGER;
  v_period_start TIMESTAMPTZ := date_trunc('month', now());
  v_period_end   TIMESTAMPTZ := date_trunc('month', now()) + interval '1 month';
BEGIN
  v_allowance := public.ai_credits_monthly_allowance(p_user_id);

  SELECT COALESCE(SUM(credits_used), 0)::INTEGER INTO v_used
  FROM public.ai_credits_ledger
  WHERE user_id = p_user_id
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  RETURN QUERY SELECT
    v_allowance,
    v_used,
    GREATEST(v_allowance - v_used, 0),
    v_period_start,
    v_period_end;
END;
$$;

COMMENT ON FUNCTION public.get_ai_credits_balance IS
  'Saldo de créditos IA del usuario para el mes calendario en curso: cupo, usados y restantes.';

-- Punto único de consumo: valida cupo y registra el gasto de forma atómica.
-- Lanza excepción 'ai_credits_exhausted' si no hay saldo suficiente, para que
-- las edge functions devuelvan 402 igual que hoy hacen con el proveedor IA.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(
  p_user_id UUID,
  p_feature TEXT,
  p_amount  INTEGER DEFAULT 1,
  p_meta    JSONB DEFAULT NULL
)
RETURNS public.ai_credits_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_allowance    INTEGER;
  v_used         INTEGER;
  v_period_start TIMESTAMPTZ := date_trunc('month', now());
  v_period_end   TIMESTAMPTZ := date_trunc('month', now()) + interval '1 month';
  v_row          public.ai_credits_ledger;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount debe ser positivo';
  END IF;

  -- Solo el propio usuario, staff, o llamadas con service role (auth.uid() NULL)
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Serializa el consumo por usuario dentro de la transacción para evitar
  -- condiciones de carrera entre llamadas concurrentes (no se puede usar
  -- FOR UPDATE sobre una agregación).
  PERFORM pg_advisory_xact_lock(hashtext('ai_credits:' || p_user_id::text));

  v_allowance := public.ai_credits_monthly_allowance(p_user_id);

  SELECT COALESCE(SUM(credits_used), 0)::INTEGER INTO v_used
  FROM public.ai_credits_ledger
  WHERE user_id = p_user_id
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_used + p_amount > v_allowance THEN
    RAISE EXCEPTION 'ai_credits_exhausted: % / % créditos usados este período', v_used, v_allowance
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ai_credits_ledger (user_id, feature, credits_used, meta)
  VALUES (p_user_id, p_feature, p_amount, p_meta)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.consume_ai_credits IS
  'Único punto de escritura del ledger IA: valida cupo mensual por plan y registra el consumo de forma atómica. Lanza ai_credits_exhausted si no hay saldo.';
