-- Planes y precios (tabla de oct 2026). Idempotente. Espejo de `src/lib/plans.ts` y `supabase/functions/_shared/planBilling.ts`.
--
--   Familia      Free COP 0 · Familiar (essential_monthly) 9.900 · Premium Familiar (family_premium_monthly) 24.900
--   Profesional  Free COP 0 · Pro (pro_monthly) 19.900 · Premium (pro_premium_monthly) 39.900
--   Institución  Institucional (institution_monthly) desde 299.000 + 50.000 por sede adicional; anual 12 meses por 10
--
-- Qué cambia aquí:
--   1. Los dos planes nuevos cuentan como plan de pago en todas las reglas (plan_key_for, plan_tier_rank). Sin esto,
--      quien pagara Premium quedaría como Free en el servidor.
--   2. Comisión: 10 % (antes 12 %) al profesional por servicio cuando NADIE tiene plan de pago. Un servicio no paga
--      comisión si el profesional tiene Pro/Premium o si quien contrata (familia o institución) tiene un plan de pago
--      («Familiar: sin comisión»). La reserva guarda la comisión al crearse; al completarse se usa esa o una menor.
--   3. Cupos por plan: desbloqueos de contacto por día, créditos IA por mes y personas del círculo de cuidado.
--   4. Visibilidad: en el directorio público, Premium Profesional sube +1 y Pro +0,5 sobre la calificación.
--
-- Los precios no viven en SQL: los fija el servidor al crear el cobro en Mercado Pago (planBilling.planQuote).

-- ─── 1) Planes de pago ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_paid_plans()
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['essential_monthly', 'pro_monthly', 'family_premium_monthly', 'pro_premium_monthly', 'institution_monthly'];
$$;

-- Orden por precio (decide subir/bajar de plan). Mismo orden que PLAN_TIER en planBilling.ts.
CREATE OR REPLACE FUNCTION public.plan_tier_rank(_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_plan, ''))
    WHEN 'essential_monthly'      THEN 1
    WHEN 'essential'              THEN 1
    WHEN 'pro_monthly'            THEN 2
    WHEN 'pro'                    THEN 2
    WHEN 'family_premium_monthly' THEN 3
    WHEN 'pro_premium_monthly'    THEN 4
    WHEN 'institution_monthly'    THEN 5
    WHEN 'institution'            THEN 5
    ELSE 0 -- free / desconocido
  END;
$$;

-- Plan vigente de un usuario según mp_subscriptions (solo escribe el webhook de pagos). Uso interno.
CREATE OR REPLACE FUNCTION public.plan_key_for(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT s.plan
      FROM public.mp_subscriptions s
     WHERE s.user_id = p_user
       AND s.status IN ('active', 'approved')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.plan = ANY (public.hx_paid_plans())
     LIMIT 1
  ), 'free');
$$;

REVOKE ALL ON FUNCTION public.hx_paid_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_paid_plans() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.plan_key_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_key_for(uuid) TO service_role;

-- ─── 2) Comisión ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_free_commission_pct()
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT 10::numeric; $$;

-- Comisión de un profesional por sí solo: 0 % con un plan de pago, 10 % en Free. (Firma de siempre: la usan
-- accept_application, accept_slot_proposal, create_contract_for_application y el navegador.)
CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.plan_key_for(p_user_id) <> 'free' THEN 0::numeric
              ELSE public.hx_free_commission_pct() END;
$$;

COMMENT ON FUNCTION public.platform_commission_pct(uuid) IS
  'Comisión de plataforma según el plan del profesional: 0 % con plan de pago, 10 % en Free.';

-- Comisión de un servicio: 0 % si el profesional O quien contrata tiene un plan de pago; si no, 10 %.
CREATE OR REPLACE FUNCTION public.booking_commission_pct(p_professional uuid, p_client uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.plan_key_for(p_professional) <> 'free'
                OR (p_client IS NOT NULL AND public.plan_key_for(p_client) <> 'free')
              THEN 0::numeric
              ELSE public.hx_free_commission_pct() END;
$$;

COMMENT ON FUNCTION public.booking_commission_pct(uuid, uuid) IS
  'Comisión de un servicio: 0 % si el profesional o quien contrata tiene plan de pago; 10 % si ninguno.';

-- Lo que vería quien contrata para un profesional (sin revelar el plan de nadie: solo el porcentaje del servicio).
CREATE OR REPLACE FUNCTION public.my_booking_commission_pct(p_professional uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.booking_commission_pct(p_professional, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.hx_free_commission_pct() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_commission_pct(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.booking_commission_pct(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_booking_commission_pct(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_free_commission_pct() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_commission_pct(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_commission_pct(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_booking_commission_pct(uuid) TO authenticated, service_role;

-- Toda reserva nueva guarda la comisión con la regla de los dos lados (antes miraba solo al profesional).
CREATE OR REPLACE FUNCTION public.hx_booking_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.platform_fee_pct := public.booking_commission_pct(NEW.professional_id, NEW.client_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hx_booking_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sb_a_commission ON public.service_bookings;
CREATE TRIGGER trg_sb_a_commission
  BEFORE INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_booking_commission();

-- Al completar un servicio intermediado se acredita el neto con la comisión de la reserva (o menor).
CREATE OR REPLACE FUNCTION public.credit_booking_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gross bigint;
  v_pct   numeric;
  v_net   bigint;
BEGIN
  -- Con pago directo al profesional, Humanix no tiene ese dinero: no hay nada que acreditar.
  IF NEW.payment_mode IS DISTINCT FROM 'platform' THEN RETURN NEW; END IF;
  v_gross := COALESCE(NEW.total_amount, 0)::bigint * 100;
  IF v_gross <= 0 THEN RETURN NEW; END IF;
  -- La comisión que quedó en la reserva, o menos si hoy alguno de los dos tiene plan de pago (nunca más).
  v_pct := LEAST(COALESCE(NEW.platform_fee_pct, public.hx_free_commission_pct()),
                 public.booking_commission_pct(NEW.professional_id, NEW.client_id));
  v_net := v_gross - round(v_gross * v_pct / 100.0)::bigint;
  IF v_net <= 0 THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.record_wallet_transaction(NEW.professional_id, 'service_earning', v_net, NEW.id,
      CASE WHEN v_pct > 0 THEN format('Servicio completado · comisión Humanix %s%%', v_pct)
           ELSE 'Servicio completado · sin comisión' END);
  EXCEPTION WHEN unique_violation THEN
    NULL; -- ya acreditado
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.credit_booking_completion() FROM PUBLIC, anon, authenticated;

-- ─── 3) Cupos por plan ─────────────────────────────────────────────────────────

-- Desbloqueos de contacto por día (espejo de REVEAL_DAILY_QUOTA en opportunities.ts).
CREATE OR REPLACE FUNCTION public.reveal_daily_quota(p_plan text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_plan
    WHEN 'essential_monthly'      THEN 15
    WHEN 'family_premium_monthly' THEN 40
    WHEN 'pro_monthly'            THEN 40
    WHEN 'pro_premium_monthly'    THEN 80
    WHEN 'institution_monthly'    THEN 40
    ELSE 0
  END;
$$;

-- Créditos IA del mes (espejo de AI_MONTHLY_CREDITS en plans.ts).
CREATE OR REPLACE FUNCTION public.ai_credits_monthly_allowance(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.plan_key_for(p_user_id)
    WHEN 'institution_monthly'    THEN 2000
    WHEN 'pro_premium_monthly'    THEN 1000
    WHEN 'pro_monthly'            THEN 400
    WHEN 'family_premium_monthly' THEN 300
    WHEN 'essential_monthly'      THEN 150
    ELSE 30
  END;
$$;

REVOKE ALL ON FUNCTION public.reveal_daily_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_daily_quota(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_credits_monthly_allowance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credits_monthly_allowance(uuid) TO service_role;

-- Círculo de cuidado: personas que se pueden invitar (espejo de CIRCLE_LIMIT en plans.ts). El círculo familiar
-- completo es del plan Premium Familiar. Las invitaciones rechazadas no cuentan; las que ya existen no se tocan.
CREATE OR REPLACE FUNCTION public.hx_circle_limit(p_plan text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_plan
    WHEN 'family_premium_monthly' THEN 10
    WHEN 'institution_monthly'    THEN 10
    WHEN 'essential_monthly'      THEN 3
    WHEN 'pro_monthly'            THEN 3
    WHEN 'pro_premium_monthly'    THEN 3
    ELSE 1
  END;
$$;

-- Lo que el panel muestra: cuántas personas tiene y cuántas puede tener quien mira.
CREATE OR REPLACE FUNCTION public.my_circle_quota()
RETURNS TABLE (used integer, circle_limit integer, plan text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*)::integer FROM public.care_circle_members m
           WHERE m.owner_id = auth.uid() AND m.status <> 'declined'),
         public.hx_circle_limit(public.plan_key_for(auth.uid())),
         public.plan_key_for(auth.uid())
   WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.guard_circle_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  -- El servidor (sin sesión o con la clave de servicio) no tiene tope.
  IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('care_circle:' || NEW.owner_id::text));
  v_limit := public.hx_circle_limit(public.plan_key_for(NEW.owner_id));
  SELECT count(*)::integer INTO v_used
    FROM public.care_circle_members m
   WHERE m.owner_id = NEW.owner_id AND m.status <> 'declined';
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Tu plan permite % persona(s) en el círculo de cuidado', v_limit
      USING ERRCODE = '42501', HINT = 'circle_limit';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hx_circle_limit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_circle_limit(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_circle_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_circle_quota() TO authenticated;
REVOKE ALL ON FUNCTION public.guard_circle_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_circle_limit ON public.care_circle_members;
CREATE TRIGGER trg_guard_circle_limit
  BEFORE INSERT ON public.care_circle_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_circle_limit();

-- ─── 4) Visibilidad en el directorio ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_plan_visibility_boost(p_user uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.plan_key_for(p_user)
    WHEN 'pro_premium_monthly' THEN 1.0
    WHEN 'pro_monthly'         THEN 0.5
    ELSE 0
  END::numeric;
$$;

REVOKE ALL ON FUNCTION public.hx_plan_visibility_boost(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_plan_visibility_boost(uuid) TO service_role;

-- Badge «verificado destacado»: profesionales con Premium Profesional (dato público por diseño, como el badge).
CREATE OR REPLACE FUNCTION public.featured_professionals(p_ids uuid[])
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
    FROM unnest(COALESCE(p_ids[1:500], '{}'::uuid[])) AS u(id)
   WHERE public.plan_key_for(u.id) = 'pro_premium_monthly';
$$;

REVOKE ALL ON FUNCTION public.featured_professionals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.featured_professionals(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_professionals(
  p_ids        uuid[]  DEFAULT NULL,
  p_specialty  text    DEFAULT NULL,
  p_city       text    DEFAULT NULL,
  p_verified   boolean DEFAULT NULL,
  p_min_rate   integer DEFAULT NULL,
  p_max_rate   integer DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL,
  p_limit      integer DEFAULT 60
)
RETURNS TABLE (
  user_id uuid, full_name text, avatar_url text, specialty text, sub_specialties text[], gender text, years_experience integer,
  home_city text, service_cities text[], hourly_rate integer, shift_rate integer, monthly_rate integer, avg_rating numeric,
  total_jobs integer, trust_score integer, verified boolean, rethus_verified boolean, rethus_number text, ai_summary text,
  ai_strengths text[], certifications jsonb, work_experience jsonb, languages text[], availability jsonb, bio text,
  available boolean, availability_status text, reserved_until timestamptz, active boolean, published boolean,
  lat double precision, lng double precision, live boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_staff boolean := false;
  v_spec  text := NULLIF(btrim(COALESCE(p_specialty, '')), '');
  v_city  text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_limit integer;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_staff := public.is_staff(v_uid);
  END IF;
  -- Las búsquedas por id (perfil, nombres de postulantes) pueden pedir más filas que el tope de una lista.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 60), COALESCE(cardinality(p_ids), 0), 1), 500);

  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.professional_id AS pro_id
      FROM public.service_bookings b
     WHERE b.status = 'in_progress'
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  )
  SELECT pp.user_id,
         public.hx_pro_label(pr.full_name, v_uid IS NULL),
         CASE WHEN v_uid IS NULL THEN NULL ELSE COALESCE(pp.avatar_url, pr.avatar_url) END,
         pp.specialty, pp.sub_specialties, pp.gender, pp.years_experience,
         pp.home_city, pp.service_cities, pp.hourly_rate, pp.shift_rate, pp.monthly_rate, pp.avg_rating,
         pp.total_jobs, pp.trust_score, COALESCE(pp.verified, false), COALESCE(pp.rethus_verified, false),
         CASE WHEN v_uid IS NULL THEN NULL ELSE pp.rethus_number END,
         pp.ai_summary, pp.ai_strengths, pp.certifications, pp.work_experience, pp.languages, pp.availability, pp.bio,
         COALESCE(pp.available, false),
         CASE WHEN COALESCE(pp.reserved_until > now(), false) OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = pp.user_id) THEN 'busy'
              WHEN COALESCE(pp.available, false) THEN 'available'
              ELSE 'unavailable' END,
         pp.reserved_until, COALESCE(pp.active, true), COALESCE(pp.published, false),
         public.hx_cell(pp.lat), public.hx_cell(pp.lng),
         COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false)
    FROM public.professional_profiles pp
    LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
    LEFT JOIN public.user_locations ul ON ul.user_id = pp.user_id
   WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pp.user_id AND ur.role = 'professional'::public.app_role)
     AND ((COALESCE(pp.published, false) AND COALESCE(pp.active, true) AND NOT COALESCE(pp.blocked, false))
          OR (p_ids IS NOT NULL AND (pp.user_id = v_uid OR v_staff)))
     AND (p_ids IS NULL OR pp.user_id = ANY (p_ids))
     AND (v_spec IS NULL OR pp.specialty ILIKE '%' || v_spec || '%')
     AND (v_city IS NULL
          OR lower(btrim(COALESCE(pp.home_city, ''))) = lower(v_city)
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(pp.service_cities, '{}'::text[])) c WHERE lower(btrim(c)) = lower(v_city)))
     AND (p_verified IS NOT TRUE OR COALESCE(pp.verified, false))
     AND (p_min_rate IS NULL OR pp.hourly_rate >= p_min_rate)
     AND (p_max_rate IS NULL OR pp.hourly_rate <= p_max_rate)
     AND (p_min_rating IS NULL OR pp.avg_rating >= p_min_rating)
   -- Prioridad por plan: Premium Profesional (+1 estrella) y Pro (+0,5) aparecen antes, sin tapar a quien está mucho
   -- mejor calificado. Las búsquedas por id no cambian (el orden ahí no importa).
   ORDER BY COALESCE(pp.avg_rating, 0) + public.hx_plan_visibility_boost(pp.user_id) DESC,
            pp.trust_score DESC NULLS LAST, pp.user_id
   LIMIT v_limit;
END
$fn$;

REVOKE ALL ON FUNCTION public.public_professionals(uuid[], text, text, boolean, integer, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_professionals(uuid[], text, text, boolean, integer, integer, numeric, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
