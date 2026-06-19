-- ═══════════════════════════════════════════════════════════════
-- PALANCA 2: Sistema de referidos viral
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.referrals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_email   TEXT        NOT NULL,
  referred_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  code             TEXT        UNIQUE NOT NULL
                               DEFAULT UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8)),
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','registered','subscribed','rewarded')),
  reward_type      TEXT        NOT NULL DEFAULT '1_month_free',
  reward_applied_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_code       ON public.referrals (code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer   ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred   ON public.referrals (referred_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status     ON public.referrals (status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- El referidor puede ver todos sus referidos
CREATE POLICY "referrals_read_own"
  ON public.referrals FOR SELECT
  USING (referrer_id = auth.uid() OR referred_id = auth.uid());

-- Cualquier autenticado puede crear un referido (pero solo con su propio referrer_id)
CREATE POLICY "referrals_insert_own"
  ON public.referrals FOR INSERT
  WITH CHECK (referrer_id = auth.uid());

-- Solo superadmin o sistema puede actualizar estado
CREATE POLICY "referrals_update_system"
  ON public.referrals FOR UPDATE
  USING (
    referrer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
  );

-- RPC: lookup referral code (usada al registrarse con ?ref=)
CREATE OR REPLACE FUNCTION public.apply_referral_code(
  p_code      TEXT,
  p_new_user_id UUID
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.referrals
  SET    referred_id = p_new_user_id,
         status      = 'registered'
  WHERE  code        = p_code
    AND  referred_id IS NULL
    AND  status      = 'pending';
END;
$$;

-- RPC: obtener o generar código de referido para un usuario
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(
  p_user_id UUID
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- Buscar código existente del usuario
  SELECT code INTO v_code
  FROM public.referrals
  WHERE referrer_id = p_user_id
  LIMIT 1;

  -- Si no existe, crear uno
  IF v_code IS NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_email, code)
    VALUES (p_user_id, '', UPPER(SUBSTRING(MD5(p_user_id::TEXT), 1, 8)))
    RETURNING code INTO v_code;
  END IF;

  RETURN v_code;
END;
$$;
