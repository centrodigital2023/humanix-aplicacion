-- ──────────────────────────────────────────────────────────────────────────
-- Paquetes de créditos IA comprables con MercadoPago.
-- Complementan el cupo mensual por plan: el usuario puede comprar créditos
-- extra que se suman al saldo disponible hasta su fecha de vencimiento.
-- ──────────────────────────────────────────────────────────────────────────

-- Catálogo de paquetes disponibles (gestionado por superadmin)
CREATE TABLE IF NOT EXISTS public.ai_credit_packs_catalog (
  id            TEXT PRIMARY KEY,                        -- ej: "pack_100", "pack_500"
  name          TEXT NOT NULL,
  description   TEXT,
  credits       INTEGER NOT NULL CHECK (credits > 0),
  price_cop     INTEGER NOT NULL CHECK (price_cop > 0),
  bonus_pct     INTEGER NOT NULL DEFAULT 0,              -- % de créditos extra (ej: 10 = +10%)
  validity_days INTEGER NOT NULL DEFAULT 90,             -- días de vigencia desde la compra
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_credit_packs_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read active packs"
  ON public.ai_credit_packs_catalog FOR SELECT
  USING (active = true);

CREATE POLICY "superadmin manage packs"
  ON public.ai_credit_packs_catalog FOR ALL
  USING (public.is_staff(auth.uid()));

-- Insertar catálogo inicial
INSERT INTO public.ai_credit_packs_catalog (id, name, description, credits, price_cop, bonus_pct, validity_days, sort_order)
VALUES
  ('pack_100',  'Paquete Inicio',      '100 créditos IA para comenzar',       100,   4900, 0,  90, 1),
  ('pack_300',  'Paquete Esencial',    '300 créditos con 10 % de bono',       300,  12900, 10, 90, 2),
  ('pack_600',  'Paquete Pro',         '600 créditos con 15 % de bono',       600,  24900, 15, 90, 3),
  ('pack_1500', 'Paquete Institucional','1500 créditos con 20 % de bono',    1500,  59900, 20, 180, 4)
ON CONFLICT (id) DO NOTHING;

-- Registro de créditos comprados (top-ups)
CREATE TABLE IF NOT EXISTS public.ai_credit_topups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id        TEXT REFERENCES public.ai_credit_packs_catalog(id),
  credits        INTEGER NOT NULL CHECK (credits > 0),   -- créditos reales acreditados (con bonus incluido)
  credits_used   INTEGER NOT NULL DEFAULT 0,             -- créditos consumidos de este top-up
  price_cop      INTEGER NOT NULL,
  mp_payment_id  TEXT,
  mp_preference_id TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  source         TEXT NOT NULL DEFAULT 'purchase',       -- 'purchase' | 'admin_grant' | 'referral'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_credit_topups_user_expires
  ON public.ai_credit_topups (user_id, expires_at);

ALTER TABLE public.ai_credit_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own topups"
  ON public.ai_credit_topups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service role inserts topups"
  ON public.ai_credit_topups FOR INSERT
  WITH CHECK (true);  -- inserts via service role from edge functions

CREATE POLICY "service role updates topups"
  ON public.ai_credit_topups FOR UPDATE
  USING (true);

-- Vista del saldo total de créditos IA (plan mensual + top-ups activos)
CREATE OR REPLACE VIEW public.ai_credits_balance_view AS
SELECT
  u.id AS user_id,
  public.get_ai_credits_balance(u.id) AS monthly,
  COALESCE((
    SELECT SUM(t.credits - t.credits_used)
    FROM public.ai_credit_topups t
    WHERE t.user_id = u.id AND t.expires_at > now() AND (t.credits - t.credits_used) > 0
  ), 0) AS extra_remaining,
  COALESCE((
    SELECT SUM(t.credits)
    FROM public.ai_credit_topups t
    WHERE t.user_id = u.id AND t.expires_at > now()
  ), 0) AS extra_total
FROM auth.users u;

-- Función para acreditar créditos comprados (llamada por mp-webhook)
CREATE OR REPLACE FUNCTION public.grant_ai_credits(
  p_user_id        UUID,
  p_pack_id        TEXT,
  p_credits        INTEGER,
  p_price_cop      INTEGER,
  p_mp_payment_id  TEXT DEFAULT NULL,
  p_mp_preference_id TEXT DEFAULT NULL,
  p_validity_days  INTEGER DEFAULT 90
)
RETURNS public.ai_credit_topups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.ai_credit_topups;
BEGIN
  INSERT INTO public.ai_credit_topups (
    user_id, pack_id, credits, price_cop,
    mp_payment_id, mp_preference_id,
    expires_at, source
  )
  VALUES (
    p_user_id, p_pack_id, p_credits, p_price_cop,
    p_mp_payment_id, p_mp_preference_id,
    now() + (p_validity_days || ' days')::interval,
    CASE WHEN p_mp_payment_id IS NOT NULL THEN 'purchase' ELSE 'admin_grant' END
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.grant_ai_credits IS
  'Acredita créditos IA comprados o concedidos. Llamada desde mp-webhook tras pago aprobado.';

-- Función para obtener saldo consolidado (plan + top-ups)
CREATE OR REPLACE FUNCTION public.get_total_ai_credits_balance(p_user_id UUID)
RETURNS TABLE (
  monthly_allowance   INTEGER,
  monthly_used        INTEGER,
  monthly_remaining   INTEGER,
  extra_total         INTEGER,
  extra_used          INTEGER,
  extra_remaining     INTEGER,
  grand_total         INTEGER,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monthly      RECORD;
  v_extra_total  INTEGER;
  v_extra_used   INTEGER;
BEGIN
  SELECT * INTO v_monthly FROM public.get_ai_credits_balance(p_user_id);

  SELECT
    COALESCE(SUM(t.credits), 0)::INTEGER,
    COALESCE(SUM(t.credits_used), 0)::INTEGER
  INTO v_extra_total, v_extra_used
  FROM public.ai_credit_topups t
  WHERE t.user_id = p_user_id AND t.expires_at > now();

  RETURN QUERY SELECT
    v_monthly.allowance,
    v_monthly.used,
    v_monthly.remaining,
    v_extra_total,
    v_extra_used,
    GREATEST(v_extra_total - v_extra_used, 0),
    v_monthly.remaining + GREATEST(v_extra_total - v_extra_used, 0),
    v_monthly.period_start,
    v_monthly.period_end;
END;
$$;

COMMENT ON FUNCTION public.get_total_ai_credits_balance IS
  'Saldo consolidado: créditos del plan mensual + top-ups comprados activos.';
