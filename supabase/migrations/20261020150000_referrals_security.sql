-- Referidos: rediseño de seguridad antes de activarlos. Idempotente.
--
-- Problemas del diseño original (20260606000001_referrals.sql):
--   - apply_referral_code(p_code, p_new_user_id) aceptaba cualquier usuario: se podía «referir» a otra persona.
--   - get_or_create_referral_code(p_user_id) creaba y devolvía el código de cualquier usuario.
--   - La política referrals_update_system dejaba que quien refiere editara sus propias filas (status = 'rewarded').
--   - Cada código vivía en una sola fila de referrals: el primer registro la «consumía» y el enlace dejaba de servir.
--   - La recompensa extendía public.subscriptions; el plan vigente vive en mp_subscriptions.
--
-- Diseño nuevo:
--   - referral_codes: un código por usuario, solo lo crea get_or_create_referral_code para auth.uid().
--   - referrals: una fila por persona referida (referred_id único), la crea apply_referral_code con auth.uid().
--     Los clientes solo leen; nadie escribe desde el navegador. El correo del referido no se expone (Ley 1581).
--   - grant_referral_reward(p_referred_id): solo service_role. Exige que el referido tenga plan de pago vigente en
--     mp_subscriptions (lo escribe solo el webhook) y da a quien refiere el mes prometido en la interfaz («1 mes del
--     Plan Esencial gratis»): si ya tiene un plan de pago vigente, suma 1 mes a su current_period_end; si no, le activa
--     essential_monthly por 1 mes. Idempotente (una recompensa por persona referida).
--
-- En producción referrals no existe todavía (docs/VERIFICACION_PAGOS.md): esta migración la crea con la forma nueva.
-- Donde ya se aplicó 20260606000001, la convierte (conserva los códigos ya compartidos).

-- ─── 1) Códigos: uno por usuario ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.referral_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;

DROP POLICY IF EXISTS referral_codes_select_own ON public.referral_codes;
CREATE POLICY referral_codes_select_own
  ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- ─── 2) referrals: una fila por persona referida ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.referrals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_email    text,
  referred_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  code              text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','registered','subscribed','rewarded')),
  reward_type       text        NOT NULL DEFAULT '1_month_free',
  reward_applied_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON public.referrals (status);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Conserva el primer código que ya tenía cada usuario (los enlaces compartidos siguen sirviendo).
INSERT INTO public.referral_codes (user_id, code, created_at)
SELECT DISTINCT ON (r.referrer_id) r.referrer_id, r.code, r.created_at
  FROM public.referrals r
 WHERE r.code ~ '^[A-Z0-9]{6,12}$'
 ORDER BY r.referrer_id, r.created_at
ON CONFLICT DO NOTHING;

-- Las filas sin referido eran solo portadoras del código (ya copiado arriba).
DELETE FROM public.referrals WHERE referred_id IS NULL AND status = 'pending';

-- Con el diseño anterior una misma persona podía quedar en varias filas: se conserva la más antigua.
DELETE FROM public.referrals r
 USING public.referrals older
 WHERE r.referred_id IS NOT NULL
   AND older.referred_id = r.referred_id
   AND (older.created_at, older.id) < (r.created_at, r.id);

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_code_key;
ALTER TABLE public.referrals ALTER COLUMN code DROP DEFAULT;
ALTER TABLE public.referrals ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.referrals ALTER COLUMN referred_email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_once
  ON public.referrals (referred_id) WHERE referred_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_not_self') THEN
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_not_self CHECK (referred_id IS NULL OR referred_id <> referrer_id) NOT VALID;
  END IF;
END $$;

-- Solo lectura para clientes: sin INSERT/UPDATE/DELETE (antes quien refiere podía marcarse 'rewarded').
DROP POLICY IF EXISTS "referrals_read_own"      ON public.referrals;
DROP POLICY IF EXISTS "referrals_insert_own"    ON public.referrals;
DROP POLICY IF EXISTS "referrals_update_system" ON public.referrals;
DROP POLICY IF EXISTS referrals_select_own      ON public.referrals;

CREATE POLICY referrals_select_own
  ON public.referrals FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referred_id = auth.uid() OR public.is_staff(auth.uid()));

REVOKE ALL ON public.referrals FROM PUBLIC, anon, authenticated;
-- Sin referred_email: quien refiere no ve el correo de la persona referida.
GRANT SELECT (id, referrer_id, referred_id, code, status, reward_type, reward_applied_at, created_at)
  ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

-- ─── 3) Código propio ─────────────────────────────────────────────────────────

-- Misma firma que antes (el frontend envía p_user_id), pero solo para auth.uid().
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
  v_try  int  := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    BEGIN
      INSERT INTO public.referral_codes (user_id, code) VALUES (v_uid, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Otra pestaña lo creó a la vez, o el código chocó con el de otra persona.
      SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
      IF v_code IS NOT NULL THEN
        RETURN v_code;
      END IF;
      v_try := v_try + 1;
      IF v_try >= 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_referral_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code(uuid) TO authenticated;

-- ─── 4) Usar un código: siempre para auth.uid() ───────────────────────────────

DROP FUNCTION IF EXISTS public.apply_referral_code(text, uuid);

-- Resultados: applied | invalid_code | self_referral | already_referred | not_eligible.
-- Elegible: cuenta creada hace 30 días o menos, sin plan de pago activo y que no haya referido a quien la refiere.
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
  v_created  timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_code !~ '^[A-Z0-9]{6,12}$' THEN
    RETURN 'invalid_code';
  END IF;

  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = v_code;
  IF v_referrer IS NULL THEN
    RETURN 'invalid_code';
  END IF;
  IF v_referrer = v_uid THEN
    RETURN 'self_referral';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN
    RETURN 'already_referred';
  END IF;

  SELECT created_at INTO v_created FROM auth.users WHERE id = v_uid;
  IF v_created IS NULL OR v_created < now() - interval '30 days' THEN
    RETURN 'not_eligible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mp_subscriptions
     WHERE user_id = v_uid AND status IN ('active', 'approved')
  ) THEN
    RETURN 'not_eligible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referrals WHERE referrer_id = v_uid AND referred_id = v_referrer
  ) THEN
    RETURN 'not_eligible';
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, code, status)
  VALUES (v_referrer, v_uid, v_code, 'registered')
  ON CONFLICT (referred_id) WHERE referred_id IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'already_referred';
  END IF;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;

-- ─── 5) Recompensa: solo el servidor, con el plan de mp_subscriptions ─────────

-- Resultados: rewarded | already_rewarded | no_referral | not_subscribed.
CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_referred_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref public.referrals%ROWTYPE;
  v_end timestamptz;
BEGIN
  SELECT * INTO v_ref FROM public.referrals WHERE referred_id = p_referred_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_referral';
  END IF;
  IF v_ref.status = 'rewarded' THEN
    RETURN 'already_rewarded';
  END IF;

  -- El referido debe tener un plan de pago vigente (solo el webhook de pagos escribe mp_subscriptions).
  IF public.plan_key_for(p_referred_id) = 'free' THEN
    RETURN 'not_subscribed';
  END IF;

  -- Bloquea la fila del plan de quien refiere (si existe) para no pisar un pago que llegue a la vez.
  SELECT current_period_end INTO v_end
    FROM public.mp_subscriptions WHERE user_id = v_ref.referrer_id FOR UPDATE;

  IF public.plan_key_for(v_ref.referrer_id) <> 'free' THEN
    -- Plan de pago vigente: un mes más desde su vencimiento (sin fecha de fin no hay nada que extender).
    UPDATE public.mp_subscriptions
       SET current_period_end = v_end + interval '1 month',
           next_payment_at    = v_end + interval '1 month',
           updated_at         = now()
     WHERE user_id = v_ref.referrer_id
       AND current_period_end IS NOT NULL;
  ELSE
    -- Sin plan de pago vigente: 1 mes del Plan Esencial desde hoy.
    INSERT INTO public.mp_subscriptions (user_id, plan, amount, currency, status, current_period_end)
    VALUES (v_ref.referrer_id, 'essential_monthly', 0, 'COP', 'active', now() + interval '1 month')
    ON CONFLICT (user_id) DO UPDATE
       SET plan                 = 'essential_monthly',
           status               = 'active',
           current_period_end   = now() + interval '1 month',
           next_payment_at      = NULL,
           updated_at           = now();
  END IF;

  UPDATE public.referrals
     SET status = 'rewarded', reward_applied_at = now()
   WHERE id = v_ref.id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_ref.referrer_id,
    'referral_reward',
    '¡Recompensa de referido!',
    'Tu colega se suscribió a Humanix. Sumamos 1 mes a tu plan.',
    '/planes'
  );

  RETURN 'rewarded';
END;
$$;

REVOKE ALL ON FUNCTION public.grant_referral_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_referral_reward(uuid) TO service_role;
