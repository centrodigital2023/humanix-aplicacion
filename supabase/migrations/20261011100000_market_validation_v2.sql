-- ═══════════════════════════════════════════════════════════════════════════════
-- Formulario inteligente de validación de mercado (/validacion): registro, beneficio y tabulación.
--
-- Qué ya existía (20261007130000 y 20261007140000) y qué fallaba al contrastarlo con la base real:
--   · `validation_responses` aceptaba INSERT de cualquier visitante sin límite de columnas: se podían
--     enviar filas con `premium_activated = true` y un `promo_code` a gusto, y el beneficio no tenía
--     ninguna barrera real.
--   · La única política de lectura era «auth.role() = service_role», así que el panel de superadmin
--     (que consulta con la sesión del usuario) nunca veía una sola fila.
--   · El código «MLP-…» se asignaba a TODA fila al insertar (verificada o no) y ninguna pantalla lo canjeaba.
--   · `validation_otps` guardaba el código en claro y, como toda tabla nueva de Supabase, nacía con ALL
--     para `anon` y `authenticated` (solo RLS la protegía).
--
-- Qué hace esta migración (idempotente y sin perder datos):
--   1. Columnas del formulario nuevo: 3.1 (¿paga hoy?), alternativas y canales como listas, ciudad,
--      consentimiento (Ley 1581), verificación del contacto, señal de demanda y estado del beneficio.
--   2. El navegador ya no escribe: el servidor (service role) registra respuestas, códigos y canjes.
--      Solo el superadmin puede LEER (política por rol) y la tabla entra en Realtime (RLS aplica), de modo
--      que el panel se tabula solo.
--   3. El código del beneficio nace al verificar el contacto (no al insertar), uno por contacto verificado
--      y uno por cuenta (índices únicos parciales), con vigencia.
--   4. `redeem_validation_benefit`: único camino para que el código active 1 mes del plan Esencial
--      (el plan básico de pago). Solo la ejecuta el service role, tras identificar a la persona en el
--      servidor. El estado del plan sigue leyéndose de `mp_subscriptions`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Columnas nuevas ───────────────────────────────────────────────────────────
ALTER TABLE public.validation_responses
  ADD COLUMN IF NOT EXISTS user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city                text,
  ADD COLUMN IF NOT EXISTS pays_currently      text,
  ADD COLUMN IF NOT EXISTS alternatives        text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS search_channels     text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS consent_at          timestamptz,
  ADD COLUMN IF NOT EXISTS consent_version     text,
  ADD COLUMN IF NOT EXISTS contact_key         text,
  ADD COLUMN IF NOT EXISTS contact_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_channel    text,
  ADD COLUMN IF NOT EXISTS signal_score        smallint,
  ADD COLUMN IF NOT EXISTS quality_flags       text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ip_hash             text,
  ADD COLUMN IF NOT EXISTS source              text,
  ADD COLUMN IF NOT EXISTS benefit_status      text        NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS benefit_plan        text        NOT NULL DEFAULT 'essential_monthly',
  ADD COLUMN IF NOT EXISTS benefit_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_at         timestamptz;

-- Sin valores por defecto engañosos: «50 %» y un código para cualquiera ya no se inventan al insertar.
ALTER TABLE public.validation_responses ALTER COLUMN willingness_pct DROP DEFAULT;
ALTER TABLE public.validation_responses ALTER COLUMN promo_code DROP DEFAULT;

-- Restricciones (NOT VALID donde puede haber filas antiguas: se exigen a toda fila nueva).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_profile_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_profile_chk
      CHECK (profile_type IN ('familia', 'ips_eps', 'profesional')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_wtp_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_wtp_chk
      CHECK (willingness_pct IS NULL OR willingness_pct BETWEEN 0 AND 100) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_pays_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_pays_chk
      CHECK (pays_currently IS NULL OR pays_currently IN ('yes', 'no', 'not_researched'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_alternatives_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_alternatives_chk
      CHECK (cardinality(alternatives) <= 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_channels_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_channels_chk
      CHECK (cardinality(search_channels) <= 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_benefit_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_benefit_chk
      CHECK (benefit_status IN ('none', 'available', 'duplicate_contact', 'redeemed', 'expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_benefit_plan_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_benefit_plan_chk
      CHECK (benefit_plan = 'essential_monthly');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_verified_channel_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_verified_channel_chk
      CHECK (verified_channel IS NULL OR verified_channel IN ('whatsapp', 'email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_signal_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_signal_chk
      CHECK (signal_score IS NULL OR signal_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_responses'::regclass AND conname = 'validation_responses_len_chk') THEN
    ALTER TABLE public.validation_responses ADD CONSTRAINT validation_responses_len_chk
      CHECK (
        char_length(COALESCE(full_name, ''))          <= 120
        AND char_length(COALESCE(city, ''))           <= 80
        AND char_length(COALESCE(service_offer, ''))  <= 400
        AND char_length(COALESCE(pain_point, ''))     <= 1500
        AND char_length(COALESCE(target_customer, '')) <= 1000
        AND char_length(COALESCE(key_benefit, ''))    <= 1500
        AND char_length(COALESCE(retention_channels, '')) <= 600
        AND char_length(COALESCE(comments, ''))       <= 2000
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_validation_responses_created ON public.validation_responses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_responses_ip      ON public.validation_responses (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_validation_responses_contact ON public.validation_responses (contact_key, created_at) WHERE contact_key IS NOT NULL;

-- Un solo beneficio por contacto verificado y por cuenta (varias respuestas del mismo contacto cuentan como
-- datos de mercado, pero el mes gratis se entrega una vez).
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_benefit_contact ON public.validation_responses (contact_key)
  WHERE promo_code IS NOT NULL AND contact_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_benefit_user ON public.validation_responses (redeemed_by)
  WHERE redeemed_by IS NOT NULL;

-- ── 2) Códigos de verificación: sin texto en claro y con huella de IP para los límites ─────────
ALTER TABLE public.validation_otps
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS ip_hash   text;
ALTER TABLE public.validation_otps ALTER COLUMN code DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.validation_otps'::regclass AND conname = 'validation_otps_code_present_chk') THEN
    ALTER TABLE public.validation_otps ADD CONSTRAINT validation_otps_code_present_chk
      CHECK (code IS NOT NULL OR code_hash IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_validation_otps_ip ON public.validation_otps (ip_hash, created_at) WHERE ip_hash IS NOT NULL;

-- ── 3) Permisos: el navegador no escribe; solo el superadmin lee ───────────────────────────
ALTER TABLE public.validation_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_otps      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert" ON public.validation_responses;
DROP POLICY IF EXISTS "service_full"  ON public.validation_responses;
DROP POLICY IF EXISTS validation_responses_superadmin_select ON public.validation_responses;
CREATE POLICY validation_responses_superadmin_select ON public.validation_responses
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role));

DROP POLICY IF EXISTS "service_full" ON public.validation_otps;

REVOKE ALL ON public.validation_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.validation_responses TO authenticated;
GRANT ALL    ON public.validation_responses TO service_role;

REVOKE ALL ON public.validation_otps FROM PUBLIC, anon, authenticated;
GRANT ALL    ON public.validation_otps TO service_role;

COMMENT ON TABLE public.validation_responses IS
  'Formulario de validación de mercado (/validacion). Lo escribe solo el servidor; lo lee solo el superadmin.';
COMMENT ON TABLE public.validation_otps IS
  'Códigos de un solo uso (solo su huella) para verificar el contacto del formulario. Solo service role.';

-- ── 4) Canje del beneficio: 1 mes del plan Esencial ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_validation_benefit(p_user uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_code text := upper(btrim(COALESCE(p_code, '')));
  r      public.validation_responses%ROWTYPE;
  v_end  timestamptz := now() + interval '1 month';
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF v_code !~ '^MLP-[A-Z0-9-]{8,16}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  SELECT * INTO r FROM public.validation_responses WHERE promo_code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF r.contact_verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_verified');
  END IF;
  IF r.redeemed_by IS NOT NULL OR r.premium_activated IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;
  IF r.benefit_expires_at IS NOT NULL AND r.benefit_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF EXISTS (SELECT 1 FROM public.validation_responses x WHERE x.redeemed_by = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_already_rewarded');
  END IF;
  -- Quien ya paga un plan no pierde el código: lo canjea cuando su plan termine.
  IF public.plan_key_for(p_user) <> 'free' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_active');
  END IF;

  INSERT INTO public.mp_subscriptions
    (user_id, plan, amount, currency, status, current_period_end, next_payment_at, mp_preapproval_id, mp_payer_email)
  VALUES
    (p_user, r.benefit_plan, 0, 'COP', 'active', v_end, NULL, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
     SET plan = EXCLUDED.plan,
         amount = 0,
         currency = 'COP',
         status = 'active',
         current_period_end = EXCLUDED.current_period_end,
         next_payment_at = NULL,
         mp_preapproval_id = NULL,
         updated_at = now();

  UPDATE public.validation_responses
     SET redeemed_by = p_user,
         redeemed_at = now(),
         premium_activated = true,
         benefit_status = 'redeemed',
         user_id = COALESCE(user_id, p_user)
   WHERE id = r.id;

  PERFORM public.hx_notify(p_user, 'benefit_redeemed', 'Tu mes del plan Esencial está activo',
    'Gracias por contarnos qué necesitas. Disfruta tu plan hasta el ' ||
      to_char(v_end AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') || '.',
    '/planes');

  RETURN jsonb_build_object('ok', true, 'plan', r.benefit_plan, 'ends_at', v_end);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_validation_benefit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_validation_benefit(uuid, text) TO service_role;

-- ── 5) Tabulación en vivo: el panel de superadmin escucha esta tabla ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que publicar';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'validation_responses') THEN
    RETURN;
  END IF;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.validation_responses;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo publicar public.validation_responses: %', SQLERRM;
  END;
END $$;
