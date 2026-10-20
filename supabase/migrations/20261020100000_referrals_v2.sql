-- Referidos, versión 2. Reemplaza el diseño de 20260606000001_referrals.sql, que nunca se aplicó en producción
-- (verificado el 19 oct 2026, docs/VERIFICACION_PAGOS.md §3) y tenía cuatro fallas:
--   1. Un código servía para una sola persona: la fila del código era la misma del referido.
--   2. `apply_referral_code(p_code, p_new_user_id)` aceptaba cualquier id: cualquiera podía «referir» cuentas ajenas.
--   3. Quien refería podía editar sus propias filas (política UPDATE con referrer_id = auth.uid()) y marcarse «rewarded».
--   4. `apply-referral-reward` extendía la tabla vieja `subscriptions` en vez de `mp_subscriptions`.
--
-- Ahora:
--   · `referral_codes`: un código por cuenta, reutilizable. Lo crea solo `get_or_create_referral_code()` para auth.uid().
--   · `referrals`: una fila por cuenta referida (único referred_id). Solo la escribe `apply_referral_code(p_code)`, que
--     usa auth.uid(), y el cobro (clave de servicio) cuando la persona referida paga su primer plan.
--   · Ninguna de las dos tablas se lee directo desde el navegador: `my_referral_summary()` entrega el código y los
--     conteos, sin decir quién se registró (Ley 1581).
--   · La recompensa la aplica `_shared/mpPayment.ts` dentro del mismo cobro que activa el plan de la persona referida:
--     reclama la fila (registered → rewarded) y extiende `mp_subscriptions` de quien refirió. Regla de AGENTS.md: el
--     plan solo lo escribe el cobro.
--
-- Idempotente: se puede aplicar dos veces sin cambiar nada.

-- ─── 0. Retirar el diseño viejo, solo si está vacío ───────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_referral_code(text, uuid);
DROP FUNCTION IF EXISTS public.get_or_create_referral_code(uuid);

DO $$
DECLARE v_rows bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'referrals' AND column_name = 'referred_email') THEN
    EXECUTE 'SELECT count(*) FROM public.referrals' INTO v_rows;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'public.referrals (diseño viejo) tiene % filas: migrarlas a mano antes de aplicar referrals_v2', v_rows;
    END IF;
    DROP TABLE public.referrals;
  END IF;
END $$;

-- ─── 1. Tablas ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id           uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code                  text        NOT NULL,
  status                text        NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'rewarded')),
  reward_mp_payment_id  text,
  rewarded_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referred_id),
  CHECK ((status = 'rewarded') = (rewarded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);

-- ─── 2. Privilegios y RLS (Supabase concede todo por defecto: se revoca explícito) ───────────────────────────────
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_codes, public.referrals FROM anon, authenticated;
GRANT ALL ON public.referral_codes, public.referrals TO service_role;
GRANT SELECT ON public.referral_codes, public.referrals TO authenticated;

DROP POLICY IF EXISTS referral_codes_staff_read ON public.referral_codes;
CREATE POLICY referral_codes_staff_read ON public.referral_codes FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS referrals_staff_read ON public.referrals;
CREATE POLICY referrals_staff_read ON public.referrals FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- ─── 3. Funciones para la persona con sesión ─────────────────────────────────────────────────────────────────────
-- Código propio (lo crea la primera vez). Sin parámetros: siempre es el de auth.uid().
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    BEGIN
      INSERT INTO public.referral_codes(user_id, code) VALUES (v_uid, v_code)
      ON CONFLICT (user_id) DO NOTHING;
      SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- El código aleatorio ya era de otra cuenta: se intenta con otro.
    END;
  END LOOP;
END $$;

-- Registrar que auth.uid() llegó con el código de alguien. Devuelve el resultado como texto (nunca lanza por un
-- código malo: el registro no se bloquea):
--   applied · invalid_code · own_code · already_referred · not_new (cuenta de más de 7 días o que ya pagó un plan)
--   · circular (quien tiene el código fue referido por esta misma cuenta)
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
  v_created  timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = v_code;
  IF v_referrer IS NULL THEN RETURN 'invalid_code'; END IF;
  IF v_referrer = v_uid THEN RETURN 'own_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN RETURN 'already_referred'; END IF;
  SELECT created_at INTO v_created FROM auth.users WHERE id = v_uid;
  IF v_created IS NULL OR v_created < now() - interval '7 days'
     -- Un plan activado alguna vez deja current_period_end (abrir un pago nuevo no lo borra).
     OR EXISTS (SELECT 1 FROM public.mp_subscriptions WHERE user_id = v_uid AND current_period_end IS NOT NULL) THEN
    RETURN 'not_new';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referrer_id = v_uid AND referred_id = v_referrer) THEN
    RETURN 'circular';
  END IF;
  INSERT INTO public.referrals(referrer_id, referred_id, code) VALUES (v_referrer, v_uid, v_code)
  ON CONFLICT (referred_id) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'applied' ELSE 'already_referred' END;
END $$;

-- Lo que ve quien refiere: su código y cuántas personas se registraron o ya pagaron. Sin nombres ni ids.
CREATE OR REPLACE FUNCTION public.my_referral_summary()
RETURNS TABLE (code text, registered integer, rewarded integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  RETURN QUERY
    SELECT (SELECT c.code FROM public.referral_codes c WHERE c.user_id = v_uid),
           count(*) FILTER (WHERE r.status = 'registered')::integer,
           count(*) FILTER (WHERE r.status = 'rewarded')::integer
    FROM public.referrals r WHERE r.referrer_id = v_uid;
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_referral_code(), public.apply_referral_code(text), public.my_referral_summary()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code(), public.apply_referral_code(text), public.my_referral_summary()
  TO authenticated, service_role;
