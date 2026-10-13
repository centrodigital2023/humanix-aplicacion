-- ═══════════════════════════════════════════════════════════════════════════════
-- Avisos de ofertas nuevas, negociación según el plan y Trust Score (decisión pedida el 2026-10-12)
--
-- Pedido: la app avisa a los profesionales cuando se crea una oferta nueva; la familia ve las postulaciones en tarjetas (nombre,
-- contacto, zona, estrellas, Trust Score), las acepta, las rechaza o negocia el valor «según el plan»; el profesional y la
-- institución ven el Trust Score de la familia y de la institución que ofrece; todos con la cercanía a la vista.
--
-- Qué hace (todo en el servidor, donde no se puede saltar):
--   1. AVISOS. Al publicarse una necesidad de una familia (`family_needs`) o una oferta de trabajo (`job_offers`) abierta, la base
--      avisa dentro de la app (`notifications`, tipo `new_offer`) a los profesionales publicados, activos, disponibles y no
--      bloqueados de la MISMA CIUDAD o a menos de 30 km, los más cercanos primero y hasta 200 por oferta. Para no saturar:
--      un aviso por profesional y por quien publica cada 6 horas, máximo 10 al día por profesional, y quien ya tiene alertas
--      propias (`opportunity_alerts`) sigue recibiendo solo las suyas. Si algo falla, la oferta se publica igual.
--   2. NEGOCIAR POR PLAN. Hasta hoy solo se frenaba al profesional del plan gratuito; la familia contraofertaba gratis. Ahora
--      contraofertar el valor exige el plan Esencial en AMBOS lados (`negotiate_rate`, pista `negotiate_rate_requires_plan`), tanto en
--      las postulaciones por horas (`counter_slot_proposal`) como en las ofertas de trabajo que publica la familia
--      (`counter_application`; las instituciones siguen negociando sin plan). Aceptar y rechazar siguen siendo gratis. El nombre
--      completo del profesional también depende del plan (`view_full_names`): la familia del plan gratuito ve «Pedro P.».
--   3. POSTULANTES EN TARJETAS. `family_applicants()` (por horas) y `family_offer_applicants()` (ofertas de trabajo) entregan, para
--      la familia que llama, cada postulación con lo que decide: nombre (según plan), foto, especialidad, años, ciudad, cercanía por
--      rangos, estrellas, servicios, Trust Score, RETHUS, valor propuesto y de quién es el turno de responder. Nunca devuelven
--      coordenadas, ni el teléfono.
--   4. CONTACTO DEL POSTULANTE. `reveal_applicant_contact()` / `reveal_application_contact()` entregan el teléfono / WhatsApp del
--      profesional a una familia con plan Esencial o superior: cupo diario compartido (`reveal_daily_quota`), una fila de auditoría
--      por familia, profesional y día, y aviso al profesional. Los pagos siguen solo en la web: el contacto es para coordinar,
--      nunca para cobrar.
--   5. TRUST SCORE. `get_trust_score()` explica de dónde sale: familias e instituciones, 0–100 con base 30 + estrellas (desde 3
--      calificaciones) + servicios completados + identidad entregada o verificada + antigüedad − alertas de fraude sin resolver.
--      El del profesional es el que ya calcula la validación con IA (`professional_profiles.trust_score`; nadie lo escribe desde
--      el cliente). Las listas de oportunidades del profesional (`list_open_family_needs`, `list_open_family_offers`,
--      `list_open_institution_offers`) traen el Trust Score de quien ofrece y la cercanía por rangos.
--
-- Cercanía: SIEMPRE por rangos (2, 5, 10, 20, 50 y «más de 50» km). Con kilómetros exactos, quien cambie su propia ubicación podría
-- ir acercándose hasta descubrir dónde vive la otra parte.
--
-- Idempotente. Se prueba sobre la réplica de producción en supabase/e2e/offers/scenario_alerts.sql.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 0) Utilidades puras ──────────────────────────────────────────────────────────

-- Distancia entre dos puntos en kilómetros (haversine). Nula si falta alguna coordenada.
CREATE OR REPLACE FUNCTION public.hx_distance_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE 12742 * asin(sqrt(LEAST(1.0,
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))))
  END
$fn$;

-- Rango de cercanía: tope en km (2, 5, 10, 20, 50) o 100 para «más de 50». Nulo si no se sabe.
CREATE OR REPLACE FUNCTION public.hx_distance_band(p_km double precision)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
  SELECT CASE WHEN p_km IS NULL THEN NULL
              WHEN p_km <= 2 THEN 2
              WHEN p_km <= 5 THEN 5
              WHEN p_km <= 10 THEN 10
              WHEN p_km <= 20 THEN 20
              WHEN p_km <= 50 THEN 50
              ELSE 100 END
$fn$;

-- Nivel del Trust Score. Espejo de trustLevel() en src/lib/trustScore.ts.
CREATE OR REPLACE FUNCTION public.hx_trust_level(p_score integer)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
  SELECT CASE WHEN p_score IS NULL THEN 'unrated'
              WHEN p_score >= 85 THEN 'excellent'
              WHEN p_score >= 70 THEN 'high'
              WHEN p_score >= 50 THEN 'medium'
              ELSE 'building' END
$fn$;

-- Cómo se nombra a un profesional: completo según el plan de quien mira o abreviado («Pedro P.»).
CREATE OR REPLACE FUNCTION public.hx_pro_label(p_full_name text, p_short boolean)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
  SELECT CASE WHEN NULLIF(btrim(COALESCE(p_full_name, '')), '') IS NULL OR position('@' IN p_full_name) > 0 THEN 'Profesional'
              WHEN p_short THEN public.short_display_name(p_full_name)
              ELSE btrim(p_full_name) END
$fn$;

-- ── 1) Trust Score ───────────────────────────────────────────────────────────────

-- Cálculo interno (sin comprobar quién pregunta: lo hacen las funciones que lo usan).
-- Familias e instituciones:  30 + estrellas (0–35, desde 3 calificaciones) + servicios completados (0–15, tope 10)
--                            + identidad (0–15) + antigüedad (0–5, tope 12 meses) − alertas de fraude sin resolver (tope 50).
-- Profesionales: el de la validación con IA (nulo mientras no se haya validado).
CREATE OR REPLACE FUNCTION public.hx_trust_calc(p_user uuid, p_kind text DEFAULT NULL)
RETURNS TABLE (
  kind text, score integer, level text, enough_data boolean, ratings_count integer, stars_avg numeric,
  completed_services integer, verified boolean, source text, components jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_kind     text := p_kind;
  v_n        integer := 0;
  v_avg      numeric;
  v_done     integer := 0;
  v_enough   boolean;
  v_rating   integer := 0;
  v_services integer := 0;
  v_ident    integer := 0;
  v_senior   integer := 0;
  v_flags    integer := 0;
  v_verified boolean := false;
  v_since    timestamptz;
  v_ai       integer;
  v_score    integer;
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  IF v_kind IS NULL THEN
    v_kind := CASE WHEN public.has_role(p_user, 'professional'::public.app_role) THEN 'professional'
                   WHEN public.has_role(p_user, 'institution'::public.app_role) THEN 'institution'
                   WHEN public.has_role(p_user, 'family'::public.app_role) THEN 'family' END;
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('professional', 'institution', 'family') THEN
    RETURN;
  END IF;

  SELECT count(*)::integer, round(avg(sr.stars)::numeric, 2) INTO v_n, v_avg
    FROM public.service_ratings sr WHERE sr.rated_id = p_user;
  SELECT count(*)::integer INTO v_done
    FROM public.service_bookings b
   WHERE b.status = 'completed'
     AND (CASE WHEN v_kind = 'professional' THEN b.professional_id ELSE b.client_id END) = p_user;
  v_enough := v_n >= 3 OR v_done >= 3;

  IF v_kind = 'professional' THEN
    SELECT NULLIF(pp.trust_score, 0), COALESCE(pp.rethus_verified, false) OR pp.verification_status = 'verified'
      INTO v_ai, v_verified FROM public.professional_profiles pp WHERE pp.user_id = p_user;
    RETURN QUERY SELECT 'professional'::text, v_ai, public.hx_trust_level(v_ai), v_enough, v_n,
                        CASE WHEN v_n >= 1 THEN v_avg END, v_done, COALESCE(v_verified, false), 'ai_validation'::text,
                        jsonb_build_object('ai_validation', v_ai);
    RETURN;
  END IF;

  IF v_kind = 'family' THEN
    SELECT fp.created_at,
           (CASE WHEN COALESCE(fp.habeas_data_accepted, false) THEN 5 ELSE 0 END)
         + (CASE WHEN NULLIF(btrim(COALESCE(fp.id_number, '')), '') IS NOT NULL THEN 5 ELSE 0 END)
         + (CASE WHEN NULLIF(btrim(COALESCE(fp.id_doc_url, '')), '') IS NOT NULL THEN 5 ELSE 0 END),
           NULLIF(btrim(COALESCE(fp.id_number, '')), '') IS NOT NULL AND NULLIF(btrim(COALESCE(fp.id_doc_url, '')), '') IS NOT NULL
      INTO v_since, v_ident, v_verified FROM public.family_profiles fp WHERE fp.user_id = p_user;
  ELSE
    SELECT ip.created_at,
           (CASE WHEN COALESCE(ip.verified, false) THEN 9 ELSE 0 END)
         + (CASE WHEN NULLIF(btrim(COALESCE(ip.nit, '')), '') IS NOT NULL THEN 3 ELSE 0 END)
         + (CASE WHEN NULLIF(btrim(COALESCE(ip.chamber_of_commerce_number, '')), '') IS NOT NULL THEN 3 ELSE 0 END),
           COALESCE(ip.verified, false)
      INTO v_since, v_ident, v_verified FROM public.institution_profiles ip WHERE ip.user_id = p_user;
  END IF;
  v_ident := COALESCE(v_ident, 0);
  v_verified := COALESCE(v_verified, false);

  v_rating := CASE WHEN v_n >= 3 THEN round((v_avg - 1) / 4 * 35)::integer ELSE 0 END;
  v_services := round(LEAST(v_done, 10) * 1.5)::integer;
  v_senior := CASE WHEN v_since IS NULL THEN 0
                   ELSE round(LEAST(GREATEST(extract(epoch FROM (now() - v_since)) / 2592000.0, 0), 12) / 12 * 5)::integer END;

  -- Alertas de fraude sin resolver: restan sin decir el motivo (la tabla puede no existir en una base nueva).
  BEGIN
    SELECT COALESCE(sum(CASE ff.severity::text WHEN 'low' THEN 3 WHEN 'medium' THEN 8 WHEN 'high' THEN 20 ELSE 35 END), 0)::integer
      INTO v_flags FROM public.fraud_flags ff WHERE ff.user_id = p_user AND NOT COALESCE(ff.resolved, false);
  EXCEPTION WHEN undefined_table THEN
    v_flags := 0;
  END;
  v_flags := LEAST(COALESCE(v_flags, 0), 50);

  v_score := GREATEST(0, LEAST(100, 30 + v_rating + v_services + v_ident + v_senior - v_flags));
  RETURN QUERY SELECT v_kind, v_score, public.hx_trust_level(v_score), v_enough, v_n,
                      CASE WHEN v_n >= 3 THEN v_avg END, v_done, v_verified, 'platform'::text,
                      jsonb_build_object('base', 30, 'ratings', v_rating, 'services', v_services, 'identity', v_ident,
                                         'seniority', v_senior, 'adjustments', -v_flags);
END
$fn$;

-- Trust Score de una persona, para quien tiene motivo de verlo: el de un profesional lo ve cualquier cuenta (ya es público en su
-- perfil); el de una familia o institución, los profesionales, el personal y la propia cuenta. El desglose solo lo ve la propia
-- cuenta y el personal (puede incluir ajustes por alertas que no se explican a terceros).
CREATE OR REPLACE FUNCTION public.get_trust_score(p_user uuid)
RETURNS TABLE (
  user_id uuid, kind text, score integer, level text, enough_data boolean, ratings_count integer, stars_avg numeric,
  completed_services integer, verified boolean, source text, components jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  t     record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO t FROM public.hx_trust_calc(p_user);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT (v_uid = p_user OR public.is_staff(v_uid) OR t.kind = 'professional'
          OR public.has_role(v_uid, 'professional'::public.app_role)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p_user, t.kind, t.score, t.level, t.enough_data, t.ratings_count, t.stars_avg, t.completed_services,
                      t.verified, t.source,
                      CASE WHEN v_uid = p_user OR public.is_staff(v_uid) THEN t.components END;
END
$fn$;

-- ── 2) Avisos de ofertas nuevas a los profesionales cercanos ─────────────────────

-- Bitácora para no saturar: un aviso por profesional y por quien publica cada 6 h, y un tope diario. Solo la tocan estas funciones.
CREATE TABLE IF NOT EXISTS public.offer_notify_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  poster_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind            text NOT NULL,
  notified_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offer_notify_log_pro_time_idx ON public.offer_notify_log (professional_id, notified_at DESC);
CREATE INDEX IF NOT EXISTS offer_notify_log_time_idx ON public.offer_notify_log (notified_at);
ALTER TABLE public.offer_notify_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_notify_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.offer_notify_log TO service_role;

-- Avisa a los profesionales que encajan. Devuelve a cuántos avisó.
CREATE OR REPLACE FUNCTION public.hx_notify_nearby_professionals(
  p_kind text, p_poster uuid, p_city text, p_lat double precision, p_lng double precision,
  p_title text, p_body text, p_meta jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ck  text := public.city_key(p_city);
  v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota';
  v_n   integer := 0;
BEGIN
  IF p_poster IS NULL OR (COALESCE(v_ck, '') = '' AND (p_lat IS NULL OR p_lng IS NULL)) THEN
    RETURN 0;   -- sin ciudad ni coordenadas no se puede decir «cerca»
  END IF;
  IF random() < 0.05 THEN
    DELETE FROM public.offer_notify_log WHERE notified_at < now() - interval '3 days';
  END IF;

  WITH cand AS (
    SELECT pp.user_id, public.hx_distance_km(p_lat, p_lng, pp.lat, pp.lng) AS km
      FROM public.professional_profiles pp
     WHERE pp.published
       AND COALESCE(pp.active, true)
       AND NOT COALESCE(pp.blocked, false)
       AND COALESCE(pp.available, true)
       AND pp.user_id <> p_poster
       AND ((v_ck <> '' AND (public.city_key(pp.home_city) = v_ck
                              OR EXISTS (SELECT 1 FROM unnest(COALESCE(pp.service_cities, '{}'::text[])) AS c WHERE public.city_key(c) = v_ck)))
            OR public.hx_distance_km(p_lat, p_lng, pp.lat, pp.lng) <= 30)
       AND public.has_role(pp.user_id, 'professional'::public.app_role)
       AND NOT EXISTS (SELECT 1 FROM public.opportunity_alerts oa WHERE oa.professional_id = pp.user_id AND oa.active)
       AND NOT EXISTS (SELECT 1 FROM public.offer_notify_log l
                        WHERE l.professional_id = pp.user_id AND l.poster_id = p_poster AND l.notified_at > now() - interval '6 hours')
       AND (SELECT count(*) FROM public.offer_notify_log l WHERE l.professional_id = pp.user_id AND l.notified_at >= v_day) < 10
     ORDER BY km NULLS LAST, pp.user_id
     LIMIT 200
  ), lg AS (
    INSERT INTO public.offer_notify_log (professional_id, poster_id, kind)
    SELECT user_id, p_poster, p_kind FROM cand
    RETURNING 1
  )
  INSERT INTO public.notifications (user_id, type, title, body, link, meta)
  SELECT user_id, 'new_offer', p_title, p_body, '/dashboard/profesional', p_meta FROM cand;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- Necesidad de una familia → profesionales de su ciudad o a menos de 30 km. El aviso nunca lleva nombres.
CREATE OR REPLACE FUNCTION public.trg_family_need_notify_pros()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_city text;
  v_lat  double precision;
  v_lng  double precision;
BEGIN
  IF NEW.status::text <> 'open' OR NEW.ends_at <= now() THEN
    RETURN NULL;
  END IF;
  SELECT pr.city INTO v_city FROM public.profiles pr WHERE pr.user_id = NEW.family_user_id;
  SELECT fp.default_lat, fp.default_lng INTO v_lat, v_lng FROM public.family_profiles fp WHERE fp.user_id = NEW.family_user_id;
  PERFORM public.hx_notify_nearby_professionals(
    'family_need', NEW.family_user_id, v_city, v_lat, v_lng,
    'Nueva oferta de una familia cerca de ti',
    COALESCE(NULLIF(btrim(NEW.care_type), ''), 'Cuidado en casa')
      || CASE WHEN COALESCE(btrim(v_city), '') <> '' THEN ' en ' || btrim(v_city) ELSE '' END
      || ' · desde ' || to_char(NEW.starts_at AT TIME ZONE 'America/Bogota', 'DD/MM HH24:MI')
      || ' · ' || public.hx_cop(NEW.hourly_rate) || ' por hora',
    jsonb_build_object('kind', 'family_need', 'poster_id', NEW.family_user_id, 'need_id', NEW.id));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_family_need_notify_pros: %', SQLERRM;   -- un aviso fallido nunca impide publicar
  RETURN NULL;
END
$fn$;

-- Oferta de trabajo (de una institución o de una familia) → profesionales de su ciudad o a menos de 30 km.
CREATE OR REPLACE FUNCTION public.trg_job_offer_notify_pros()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_name text;
  v_lat  double precision := NEW.lat;
  v_lng  double precision := NEW.lng;
  v_plat double precision;
  v_plng double precision;
  v_inst boolean := NEW.poster_type::text = 'institution';
BEGIN
  IF NEW.status::text <> 'open' OR COALESCE(NEW.blocked, false) THEN
    RETURN NULL;
  END IF;
  -- Si la oferta no trae coordenadas, se usan las del perfil de quien publica (la institución o la familia).
  IF v_inst THEN
    SELECT NULLIF(btrim(ip.institution_name), ''), ip.lat, ip.lng INTO v_name, v_plat, v_plng
      FROM public.institution_profiles ip WHERE ip.user_id = NEW.posted_by;
  ELSE
    SELECT fp.default_lat, fp.default_lng INTO v_plat, v_plng
      FROM public.family_profiles fp WHERE fp.user_id = NEW.posted_by;
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    v_lat := v_plat;
    v_lng := v_plng;
  END IF;
  PERFORM public.hx_notify_nearby_professionals(
    CASE WHEN v_inst THEN 'institution_offer' ELSE 'family_offer' END, NEW.posted_by, NEW.city, v_lat, v_lng,
    CASE WHEN v_inst THEN 'Nueva oferta de una institución cerca de ti' ELSE 'Nueva oferta de una familia cerca de ti' END,
    CASE WHEN v_inst THEN COALESCE(v_name, 'Institución de salud') || ': ' ELSE '' END
      || left(NEW.title, 90) || ' · ' || COALESCE(NULLIF(btrim(NEW.city), ''), 'tu zona') || ' · ' || public.hx_cop(NEW.amount),
    jsonb_build_object('kind', CASE WHEN v_inst THEN 'institution_offer' ELSE 'family_offer' END,
                       'poster_id', NEW.posted_by, 'offer_id', NEW.id));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_job_offer_notify_pros: %', SQLERRM;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_family_needs_notify_pros ON public.family_needs;
CREATE TRIGGER trg_family_needs_notify_pros
  AFTER INSERT ON public.family_needs
  FOR EACH ROW WHEN (NEW.status = 'open')
  EXECUTE FUNCTION public.trg_family_need_notify_pros();

DROP TRIGGER IF EXISTS trg_job_offers_notify_pros ON public.job_offers;
CREATE TRIGGER trg_job_offers_notify_pros
  AFTER INSERT ON public.job_offers
  FOR EACH ROW WHEN (NEW.status = 'open')
  EXECUTE FUNCTION public.trg_job_offer_notify_pros();

-- ── 3) Negociar el valor: plan Esencial en ambos lados ───────────────────────────

CREATE OR REPLACE FUNCTION public.counter_slot_proposal(p_proposal_id uuid, p_rate integer, p_message text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  p        public.slot_proposals%ROWTYPE;
  v_role   text;
  v_posted integer;
  v_msg    text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_exp    timestamptz;
  v_new    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM set_config('app.proposal_rpc', 'on', true);
  PERFORM public.expire_stale_proposals();

  SELECT * INTO p FROM public.slot_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La propuesta ya no está disponible (%)', p.status::text;
  END IF;

  IF p.proposed_by::text = 'professional' AND p.family_user_id = v_uid THEN
    v_role := 'family';
  ELSIF p.proposed_by::text = 'family' AND p.professional_id = v_uid THEN
    v_role := 'professional';
  ELSE
    RAISE EXCEPTION 'Solo quien recibe la oferta puede contraofertar' USING ERRCODE = '42501';
  END IF;

  IF p.round_no >= 3 THEN
    RAISE EXCEPTION 'Esta es la última oferta: solo puedes aceptarla o rechazarla' USING ERRCODE = '23514';
  END IF;
  IF p.starts_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'El horario de la propuesta ya pasó' USING ERRCODE = '23514';
  END IF;
  -- Negociar el valor es una función del plan Esencial, para la familia y para el profesional (aceptar y rechazar son gratis).
  IF public.plan_key_for(v_uid) = 'free' THEN
    RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
      USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
  END IF;
  IF v_role = 'professional' THEN
    IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
      RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_posted := COALESCE(p.posted_rate, p.hourly_rate);
  IF p_rate IS NULL OR p_rate < public.rate_band_min(v_posted) OR p_rate > public.rate_band_max(v_posted) THEN
    RAISE EXCEPTION 'El valor por hora debe estar entre $% y $% para esta solicitud',
      public.rate_band_min(v_posted), public.rate_band_max(v_posted) USING ERRCODE = '23514';
  END IF;
  IF p_rate = p.hourly_rate THEN
    RAISE EXCEPTION 'La contraoferta debe cambiar el valor; si estás de acuerdo, acepta la oferta' USING ERRCODE = '23514';
  END IF;

  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 500 THEN
      RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_exp := GREATEST(LEAST(now() + interval '24 hours', p.starts_at - interval '1 hour'), now() + interval '15 minutes');

  UPDATE public.slot_proposals
     SET status = 'countered', decision_note = 'Contraoferta enviada'
   WHERE id = p.id;

  -- Dos ramas con literales: el tipo de proposed_by puede ser texto o enum según el linaje de migraciones.
  IF v_role = 'family' THEN
    INSERT INTO public.slot_proposals (
      family_user_id, professional_id, family_need_id, availability_slot_id, starts_at, ends_at, hourly_rate,
      proposed_by, status, message, round_no, parent_proposal_id, posted_rate, expires_at
    ) VALUES (
      p.family_user_id, p.professional_id, p.family_need_id, p.availability_slot_id, p.starts_at, p.ends_at, p_rate,
      'family', 'pending', v_msg, p.round_no + 1, p.id, v_posted, v_exp
    ) RETURNING id INTO v_new;
  ELSE
    INSERT INTO public.slot_proposals (
      family_user_id, professional_id, family_need_id, availability_slot_id, starts_at, ends_at, hourly_rate,
      proposed_by, status, message, round_no, parent_proposal_id, posted_rate, expires_at
    ) VALUES (
      p.family_user_id, p.professional_id, p.family_need_id, p.availability_slot_id, p.starts_at, p.ends_at, p_rate,
      'professional', 'pending', v_msg, p.round_no + 1, p.id, v_posted, v_exp
    ) RETURNING id INTO v_new;
  END IF;

  RETURN v_new;
END
$fn$;

-- Mis propuestas: el profesional se nombra completo solo a la familia con plan Esencial o superior (view_full_names).
CREATE OR REPLACE FUNCTION public.my_slot_proposals(p_limit integer DEFAULT 60)
RETURNS TABLE(
  id uuid, family_user_id uuid, professional_id uuid, family_need_id uuid, starts_at timestamptz, ends_at timestamptz,
  hourly_rate integer, proposed_by text, status text, message text, decision_note text, booking_id uuid, created_at timestamptz,
  round_no integer, parent_proposal_id uuid, posted_rate integer, expires_at timestamptz, peer_id uuid, peer_name text,
  peer_avatar text, peer_city text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  v_free boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  v_free := public.plan_key_for(v_uid) = 'free';

  RETURN QUERY
  SELECT sp.id, sp.family_user_id, sp.professional_id, sp.family_need_id, sp.starts_at, sp.ends_at,
         sp.hourly_rate, sp.proposed_by::text, sp.status::text, sp.message, sp.decision_note, sp.booking_id,
         sp.created_at, sp.round_no::integer, sp.parent_proposal_id, sp.posted_rate, sp.expires_at,
         peer.user_id,
         CASE WHEN sp.professional_id = v_uid THEN public.short_display_name(peer.full_name)
              ELSE public.hx_pro_label(peer.full_name, v_free) END,
         CASE WHEN sp.professional_id = v_uid THEN NULL
              ELSE COALESCE(pp.avatar_url, peer.avatar_url) END,
         peer.city
    FROM public.slot_proposals sp
    LEFT JOIN public.profiles peer
           ON peer.user_id = CASE WHEN sp.professional_id = v_uid THEN sp.family_user_id ELSE sp.professional_id END
    LEFT JOIN public.professional_profiles pp ON pp.user_id = sp.professional_id AND sp.family_user_id = v_uid
   WHERE sp.family_user_id = v_uid OR sp.professional_id = v_uid
   ORDER BY sp.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END
$fn$;

-- Contraoferta de una postulación a una oferta de trabajo: la misma regla de plan para la familia que la publicó.
CREATE OR REPLACE FUNCTION public.counter_application(p_application_id uuid, p_amount integer, p_message text DEFAULT NULL::text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_prev  text := current_setting('app.application_rpc', true);
  a       public.applications%ROWTYPE;
  o       public.job_offers%ROWTYPE;
  v_role   text;
  v_revise boolean := false;
  v_msg    text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_first  timestamptz;
  v_exp    timestamptz;
  v_name   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM public.expire_stale_applications();

  SELECT * INTO a FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id;
  IF a.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La postulación ya no está activa (%)', a.status::text USING ERRCODE = '23514';
  END IF;

  IF a.awaiting = 'institution' AND v_uid = o.posted_by THEN
    v_role := 'institution';
  ELSIF a.awaiting = 'professional' AND v_uid = a.professional_id THEN
    v_role := 'professional';
  ELSIF a.awaiting = 'institution' AND v_uid = a.professional_id THEN
    -- El profesional cambia SU propuesta mientras la institución no responde: no gasta una ronda.
    v_role := 'professional';
    v_revise := true;
  ELSE
    RAISE EXCEPTION 'Solo quien debe responder puede contraofertar' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'professional' THEN
    IF public.plan_key_for(v_uid) = 'free' THEN
      RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
        USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
    END IF;
    IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
      RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Negociar el valor también es del plan Esencial para la FAMILIA que publicó la oferta (las instituciones negocian sin plan, como antes).
  IF v_role = 'institution' AND o.poster_type::text = 'family' AND public.plan_key_for(v_uid) = 'free' THEN
    RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
      USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
  END IF;
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;
  IF a.round_no >= 3 THEN
    RAISE EXCEPTION 'Esta es la última oferta: solo puedes aceptarla o rechazarla' USING ERRCODE = '23514', HINT = 'final_round';
  END IF;
  IF p_amount IS NULL
     OR p_amount < public.offer_band_min(a.posted_amount, o.modality::text)
     OR p_amount > public.offer_band_max(a.posted_amount, o.modality::text) THEN
    RAISE EXCEPTION 'El valor debe estar entre % y % para esta oferta',
      public.hx_cop(public.offer_band_min(a.posted_amount, o.modality::text)),
      public.hx_cop(public.offer_band_max(a.posted_amount, o.modality::text))
      USING ERRCODE = '23514', HINT = 'rate_out_of_band';
  END IF;
  IF p_amount = a.proposed_amount THEN
    RAISE EXCEPTION 'La contraoferta debe cambiar el valor; si estás de acuerdo, acepta' USING ERRCODE = '23514';
  END IF;
  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 500 THEN
      RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje' USING ERRCODE = '23514', HINT = 'forbidden_content';
    END IF;
  END IF;

  SELECT min(s.starts_at) INTO v_first FROM public.job_offer_shifts s WHERE s.id = ANY (a.shift_ids);
  v_exp := GREATEST(
    LEAST(now() + CASE WHEN v_revise AND a.round_no <= 1 THEN interval '72 hours' ELSE interval '24 hours' END,
          COALESCE(v_first - interval '1 hour', 'infinity')),
    now() + interval '15 minutes');

  PERFORM set_config('app.application_rpc', 'on', true);
  IF v_revise THEN
    UPDATE public.applications SET proposed_amount = p_amount, expires_at = v_exp WHERE id = a.id;
  ELSE
    UPDATE public.applications
       SET proposed_amount = p_amount,
           round_no = a.round_no + 1,
           awaiting = CASE v_role WHEN 'institution' THEN 'professional' ELSE 'institution' END,
           expires_at = v_exp
     WHERE id = a.id;
  END IF;
  PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);

  INSERT INTO public.application_events (application_id, round_no, event, actor_id, actor_role, amount, message)
  VALUES (a.id, CASE WHEN v_revise THEN a.round_no ELSE a.round_no + 1 END, 'countered', v_uid, v_role, p_amount, v_msg);

  IF v_role = 'institution' THEN
    IF o.poster_type::text = 'family' THEN
      SELECT CASE WHEN public.short_display_name(p.full_name) = 'Familia' THEN 'La familia' ELSE public.short_display_name(p.full_name) END
        INTO v_name FROM public.profiles p WHERE p.user_id = o.posted_by;
    ELSE
      SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), 'La institución') INTO v_name
        FROM public.institution_profiles ip WHERE ip.user_id = o.posted_by;
    END IF;
    PERFORM public.hx_notify(a.professional_id, 'application_counter_offer',
      CASE WHEN a.round_no + 1 >= 3 THEN 'Última oferta recibida' ELSE 'Nueva contraoferta' END,
      COALESCE(v_name, 'La institución') || ' propone ' || public.hx_cop(p_amount) || ' para «' || left(o.title, 60) || '». Respóndela antes de que venza.',
      '/dashboard/profesional');
  ELSE
    SELECT public.short_display_name(p.full_name) INTO v_name FROM public.profiles p WHERE p.user_id = a.professional_id;
    PERFORM public.hx_notify(o.posted_by, 'application_counter_offer',
      CASE WHEN v_revise THEN 'Actualizaron una propuesta'
           WHEN a.round_no + 1 >= 3 THEN 'Última oferta recibida' ELSE 'Nueva contraoferta' END,
      COALESCE(v_name, 'El profesional') || CASE WHEN v_revise THEN ' ahora propone ' ELSE ' propone ' END ||
        public.hx_cop(p_amount) || ' para «' || left(o.title, 60) || '». Respóndela antes de que venza.',
      CASE WHEN o.poster_type::text = 'family' THEN '/dashboard/familia' ELSE '/dashboard/institucion' END);
  END IF;
  RETURN CASE WHEN v_revise THEN a.round_no ELSE a.round_no + 1 END;
END;
$fn$;

-- ── 4) Contacto del postulante (familia con plan Esencial o superior) ────────────

CREATE TABLE IF NOT EXISTS public.applicant_contact_reveals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  proposal_id     uuid REFERENCES public.slot_proposals (id) ON DELETE SET NULL,
  application_id  uuid REFERENCES public.applications (id) ON DELETE SET NULL,
  plan            text NOT NULL,
  revealed_on     date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_user_id, professional_id, revealed_on)
);
ALTER TABLE public.applicant_contact_reveals ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS applicant_contact_reveals_day_idx ON public.applicant_contact_reveals (family_user_id, revealed_on);
ALTER TABLE public.applicant_contact_reveals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acr_select_own ON public.applicant_contact_reveals;
CREATE POLICY acr_select_own ON public.applicant_contact_reveals
  FOR SELECT TO authenticated
  USING (family_user_id = auth.uid() OR public.has_role(auth.uid(), 'superadmin'::public.app_role));
REVOKE ALL ON public.applicant_contact_reveals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.applicant_contact_reveals TO authenticated;
GRANT ALL ON public.applicant_contact_reveals TO service_role;

-- Plan, cupo diario, auditoría y aviso. Lo usan las dos funciones de abajo (postulaciones por horas y a ofertas de trabajo).
CREATE OR REPLACE FUNCTION public.hx_reveal_pro_contact(p_family uuid, p_pro uuid, p_proposal uuid, p_application uuid)
RETURNS TABLE (full_name text, phone text, whatsapp text, city text, revealed_at timestamptz, reveals_left integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_plan    text;
  v_quota   integer;
  v_today   date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_used    integer;
  v_already boolean;
  v_name    text;
  v_phone   text;
  v_city    text;
  v_fam     text;
BEGIN
  v_plan := public.plan_key_for(p_family);
  v_quota := public.reveal_daily_quota(v_plan);
  IF v_quota = 0 THEN
    RAISE EXCEPTION 'Ver el WhatsApp del profesional está disponible desde el plan Esencial'
      USING ERRCODE = '42501', HINT = 'plan_required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.applicant_contact_reveals r
                  WHERE r.family_user_id = p_family AND r.professional_id = p_pro AND r.revealed_on = v_today),
         (SELECT count(DISTINCT r.professional_id)::integer FROM public.applicant_contact_reveals r
           WHERE r.family_user_id = p_family AND r.revealed_on = v_today)
    INTO v_already, v_used;
  SELECT NULLIF(btrim(pr.full_name), ''), NULLIF(btrim(COALESCE(pr.phone, '')), ''), pr.city
    INTO v_name, v_phone, v_city FROM public.profiles pr WHERE pr.user_id = p_pro;

  -- Sin teléfono registrado no hay nada que desbloquear: no gasta cupo ni avisa al profesional.
  IF v_phone IS NULL THEN
    RETURN QUERY SELECT COALESCE(v_name, 'Profesional'), NULL::text, NULL::text, v_city, now(), GREATEST(v_quota - v_used, 0);
    RETURN;
  END IF;

  IF NOT v_already AND v_used >= v_quota THEN
    RAISE EXCEPTION 'Alcanzaste el límite diario de contactos desbloqueados (%)', v_quota
      USING ERRCODE = '42501', HINT = 'quota_exceeded';
  END IF;

  -- Una fila por familia, profesional y día: repetir el desbloqueo no consume cupo ni vuelve a avisar.
  IF NOT v_already THEN
    INSERT INTO public.applicant_contact_reveals (family_user_id, professional_id, proposal_id, application_id, plan, revealed_on)
    VALUES (p_family, p_pro, p_proposal, p_application, v_plan, v_today)
    ON CONFLICT (family_user_id, professional_id, revealed_on) DO NOTHING;
    SELECT public.short_display_name(pr.full_name) INTO v_fam FROM public.profiles pr WHERE pr.user_id = p_family;
    PERFORM public.hx_notify(p_pro, 'contact_revealed', 'Una familia desbloqueó tu contacto',
      COALESCE(v_fam, 'Una familia') || ' vio tus datos de contacto para coordinar el servicio. Los pagos se hacen solo en la página web de Humanix.',
      '/dashboard/profesional');
  END IF;

  RETURN QUERY SELECT COALESCE(v_name, 'Profesional'), v_phone, v_phone, v_city, now(),
                      GREATEST(v_quota - v_used - CASE WHEN v_already THEN 0 ELSE 1 END, 0);
END
$fn$;

-- Postulación a una necesidad por horas (slot_proposals).
CREATE OR REPLACE FUNCTION public.reveal_applicant_contact(p_proposal_id uuid)
RETURNS TABLE (full_name text, phone text, whatsapp text, city text, revealed_at timestamptz, reveals_left integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  sp    public.slot_proposals%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO sp FROM public.slot_proposals WHERE id = p_proposal_id;
  IF NOT FOUND OR sp.family_user_id <> v_uid THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF sp.status::text NOT IN ('pending', 'accepted')
     OR (sp.status::text = 'pending' AND sp.expires_at IS NOT NULL AND sp.expires_at <= now()) THEN
    RAISE EXCEPTION 'Esta postulación ya no está vigente' USING ERRCODE = '42501', HINT = 'proposal_not_active';
  END IF;
  RETURN QUERY SELECT * FROM public.hx_reveal_pro_contact(v_uid, sp.professional_id, sp.id, NULL::uuid);
END
$fn$;

-- Postulación a una oferta de trabajo publicada por la familia (applications).
CREATE OR REPLACE FUNCTION public.reveal_application_contact(p_application_id uuid)
RETURNS TABLE (full_name text, phone text, whatsapp text, city text, revealed_at timestamptz, reveals_left integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  a     public.applications%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT x.* INTO a FROM public.applications x JOIN public.job_offers o ON o.id = x.job_offer_id
   WHERE x.id = p_application_id AND o.posted_by = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF a.status::text NOT IN ('pending', 'accepted')
     OR (a.status::text = 'pending' AND a.expires_at IS NOT NULL AND a.expires_at <= now()) THEN
    RAISE EXCEPTION 'Esta postulación ya no está vigente' USING ERRCODE = '42501', HINT = 'proposal_not_active';
  END IF;
  RETURN QUERY SELECT * FROM public.hx_reveal_pro_contact(v_uid, a.professional_id, NULL::uuid, a.id);
END
$fn$;

-- ── 5) Postulantes de la familia, en tarjetas ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.family_applicants(p_limit integer DEFAULT 60)
RETURNS TABLE (
  proposal_id uuid, professional_id uuid, family_need_id uuid, parent_proposal_id uuid,
  display_name text, name_is_short boolean, avatar_url text, specialty text, years_experience integer,
  city text, distance_band_km integer,
  ratings_count integer, stars_avg numeric, total_jobs integer,
  trust_score integer, trust_level text, rethus_verified boolean,
  hourly_rate integer, posted_rate integer, round_no integer, proposed_by text, status text, awaiting text,
  message text, starts_at timestamptz, ends_at timestamptz, hours numeric, estimated_total integer,
  expires_at timestamptz, created_at timestamptz, booking_id uuid,
  can_negotiate boolean, can_reveal boolean, has_phone boolean, contact_unlocked boolean, reveals_left integer, plan_key text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_quota integer;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_used  integer;
  v_lat   double precision;
  v_lng   double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  v_plan := public.plan_key_for(v_uid);
  v_quota := public.reveal_daily_quota(v_plan);
  SELECT count(DISTINCT r.professional_id)::integer INTO v_used
    FROM public.applicant_contact_reveals r WHERE r.family_user_id = v_uid AND r.revealed_on = v_today;
  SELECT fp.default_lat, fp.default_lng INTO v_lat, v_lng FROM public.family_profiles fp WHERE fp.user_id = v_uid;

  RETURN QUERY
  SELECT sp.id, sp.professional_id, sp.family_need_id, sp.parent_proposal_id,
         public.hx_pro_label(pr.full_name, v_plan = 'free'),
         v_plan = 'free',
         COALESCE(pp.avatar_url, pr.avatar_url), pp.specialty, pp.years_experience,
         COALESCE(NULLIF(btrim(pp.home_city), ''), pr.city),
         public.hx_distance_band(public.hx_distance_km(v_lat, v_lng, pp.lat, pp.lng)),
         rt.n, rt.avg, pp.total_jobs,
         tr.score, tr.level, COALESCE(pp.rethus_verified, false),
         sp.hourly_rate, COALESCE(sp.posted_rate, sp.hourly_rate), sp.round_no::integer, sp.proposed_by::text, sp.status::text,
         CASE WHEN sp.status::text = 'accepted' THEN 'done'
              WHEN sp.proposed_by::text = 'professional' THEN 'family'
              ELSE 'professional' END,
         sp.message, sp.starts_at, sp.ends_at,
         round(EXTRACT(EPOCH FROM (sp.ends_at - sp.starts_at))::numeric / 3600, 2),
         round(EXTRACT(EPOCH FROM (sp.ends_at - sp.starts_at))::numeric / 3600 * sp.hourly_rate)::integer,
         sp.expires_at, sp.created_at, sp.booking_id,
         v_plan <> 'free' AND sp.status::text = 'pending' AND sp.proposed_by::text = 'professional' AND sp.round_no < 3,
         v_quota > 0,
         NULLIF(btrim(COALESCE(pr.phone, '')), '') IS NOT NULL,
         EXISTS (SELECT 1 FROM public.applicant_contact_reveals r
                  WHERE r.family_user_id = v_uid AND r.professional_id = sp.professional_id AND r.revealed_on = v_today),
         GREATEST(v_quota - v_used, 0),
         v_plan
    FROM public.slot_proposals sp
    LEFT JOIN public.profiles pr ON pr.user_id = sp.professional_id
    LEFT JOIN public.professional_profiles pp ON pp.user_id = sp.professional_id
    LEFT JOIN LATERAL (
      SELECT (a.n + b.n) AS n,
             CASE WHEN a.n + b.n > 0 THEN round(((a.s + b.s) / (a.n + b.n))::numeric, 2) END AS avg
        FROM (SELECT count(*)::integer AS n, COALESCE(sum(sr.stars), 0)::numeric AS s
                FROM public.service_ratings sr WHERE sr.rated_id = sp.professional_id) a,
             (SELECT count(*)::integer AS n, COALESCE(sum(r.stars), 0)::numeric AS s
                FROM public.ratings r WHERE r.rated_user_id = sp.professional_id) b
    ) rt ON true
    LEFT JOIN LATERAL public.hx_trust_calc(sp.professional_id, 'professional') tr ON true
   WHERE sp.family_user_id = v_uid
     AND NOT COALESCE(pp.blocked, false)
     AND ((sp.status::text = 'pending' AND (sp.expires_at IS NULL OR sp.expires_at > now()))
          OR (sp.status::text = 'accepted' AND sp.updated_at > now() - interval '14 days'))
   ORDER BY (sp.status::text = 'pending' AND sp.proposed_by::text = 'professional') DESC, sp.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END
$fn$;

-- Postulaciones a las ofertas de trabajo que publicó la familia (applications), con la misma tarjeta.
CREATE OR REPLACE FUNCTION public.family_offer_applicants(p_limit integer DEFAULT 60)
RETURNS TABLE (
  application_id uuid, job_offer_id uuid, offer_title text, modality text, offer_start timestamptz, offer_end timestamptz, has_shifts boolean,
  professional_id uuid, display_name text, name_is_short boolean, avatar_url text, specialty text, years_experience integer,
  city text, distance_band_km integer,
  ratings_count integer, stars_avg numeric, total_jobs integer,
  trust_score integer, trust_level text, rethus_verified boolean,
  posted_amount integer, proposed_amount integer, round_no integer, status text, awaiting text,
  message text, expires_at timestamptz, created_at timestamptz,
  can_negotiate boolean, can_reveal boolean, has_phone boolean, contact_unlocked boolean, reveals_left integer, plan_key text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_quota integer;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_used  integer;
  v_lat   double precision;
  v_lng   double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  v_plan := public.plan_key_for(v_uid);
  v_quota := public.reveal_daily_quota(v_plan);
  SELECT count(DISTINCT r.professional_id)::integer INTO v_used
    FROM public.applicant_contact_reveals r WHERE r.family_user_id = v_uid AND r.revealed_on = v_today;
  SELECT fp.default_lat, fp.default_lng INTO v_lat, v_lng FROM public.family_profiles fp WHERE fp.user_id = v_uid;

  RETURN QUERY
  SELECT a.id, o.id, o.title, o.modality::text, o.start_date, o.end_date,
         EXISTS (SELECT 1 FROM public.job_offer_shifts s WHERE s.job_offer_id = o.id AND s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()),
         a.professional_id,
         public.hx_pro_label(pr.full_name, v_plan = 'free'),
         v_plan = 'free',
         COALESCE(pp.avatar_url, pr.avatar_url), pp.specialty, pp.years_experience,
         COALESCE(NULLIF(btrim(pp.home_city), ''), pr.city),
         public.hx_distance_band(public.hx_distance_km(COALESCE(o.lat, v_lat), COALESCE(o.lng, v_lng), pp.lat, pp.lng)),
         rt.n, rt.avg, pp.total_jobs,
         tr.score, tr.level, COALESCE(pp.rethus_verified, false),
         COALESCE(a.posted_amount, o.amount), COALESCE(a.proposed_amount, o.amount), a.round_no::integer, a.status::text,
         CASE WHEN a.status::text = 'accepted' THEN 'done'
              WHEN a.awaiting = 'professional' THEN 'professional'
              ELSE 'family' END,
         a.message, a.expires_at, a.created_at,
         v_plan <> 'free' AND a.status::text = 'pending' AND a.awaiting = 'institution' AND a.round_no < 3,
         v_quota > 0,
         NULLIF(btrim(COALESCE(pr.phone, '')), '') IS NOT NULL,
         EXISTS (SELECT 1 FROM public.applicant_contact_reveals r
                  WHERE r.family_user_id = v_uid AND r.professional_id = a.professional_id AND r.revealed_on = v_today),
         GREATEST(v_quota - v_used, 0),
         v_plan
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    LEFT JOIN public.profiles pr ON pr.user_id = a.professional_id
    LEFT JOIN public.professional_profiles pp ON pp.user_id = a.professional_id
    LEFT JOIN LATERAL (
      SELECT (x.n + y.n) AS n,
             CASE WHEN x.n + y.n > 0 THEN round(((x.s + y.s) / (x.n + y.n))::numeric, 2) END AS avg
        FROM (SELECT count(*)::integer AS n, COALESCE(sum(sr.stars), 0)::numeric AS s
                FROM public.service_ratings sr WHERE sr.rated_id = a.professional_id) x,
             (SELECT count(*)::integer AS n, COALESCE(sum(r.stars), 0)::numeric AS s
                FROM public.ratings r WHERE r.rated_user_id = a.professional_id) y
    ) rt ON true
    LEFT JOIN LATERAL public.hx_trust_calc(a.professional_id, 'professional') tr ON true
   WHERE o.posted_by = v_uid
     AND NOT COALESCE(pp.blocked, false)
     AND ((a.status::text = 'pending' AND (a.expires_at IS NULL OR a.expires_at > now()))
          OR (a.status::text = 'accepted' AND a.updated_at > now() - interval '14 days'))
   ORDER BY (a.status::text = 'pending' AND a.awaiting = 'institution') DESC, a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END
$fn$;

-- ── 6) Listas del profesional: Trust Score de quien ofrece y cercanía ────────────

DROP FUNCTION IF EXISTS public.list_open_family_needs(integer);
CREATE FUNCTION public.list_open_family_needs(p_limit integer DEFAULT 300)
RETURNS TABLE(
  id uuid, family_user_id uuid, display_name text, city text, care_type text, starts_at timestamptz, ends_at timestamptz,
  hourly_rate integer, notes_public text, created_at timestamptz, already_applied boolean, family_stars numeric,
  family_ratings integer, family_completed integer,
  family_trust integer, family_trust_level text, family_trust_enough boolean, family_verified boolean, distance_band_km integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden ver las solicitudes de las familias' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;
  SELECT pp.lat, pp.lng INTO v_lat, v_lng FROM public.professional_profiles pp WHERE pp.user_id = v_uid;

  RETURN QUERY
  WITH open_needs AS (
    SELECT fn.*
      FROM public.family_needs fn
     WHERE fn.status = 'open'
       AND fn.ends_at > now()
       AND fn.family_user_id <> v_uid
     ORDER BY fn.starts_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500)
  ), trust AS MATERIALIZED (
    SELECT f.uid, t.score, t.level, t.enough_data, t.verified
      FROM (SELECT DISTINCT n.family_user_id AS uid FROM open_needs n) f
      CROSS JOIN LATERAL public.hx_trust_calc(f.uid, 'family') t
  )
  SELECT fn.id,
         fn.family_user_id,
         public.short_display_name(pr.full_name),
         pr.city,
         fn.care_type,
         fn.starts_at,
         fn.ends_at,
         fn.hourly_rate,
         left(public.redact_contact_info(fn.notes), 280),
         fn.created_at,
         EXISTS (
           SELECT 1 FROM public.slot_proposals sp
            WHERE sp.professional_id = v_uid
              AND sp.family_user_id  = fn.family_user_id
              AND sp.status IN ('pending', 'accepted')
              AND (sp.expires_at IS NULL OR sp.expires_at > now())
              AND sp.starts_at <= fn.starts_at AND sp.ends_at >= fn.ends_at
         ),
         rep.stars,
         rep.n,
         done.n,
         tr.score,
         tr.level,
         tr.enough_data,
         tr.verified,
         public.hx_distance_band(public.hx_distance_km(
           v_lat, v_lng, round(fp.default_lat::numeric, 2)::double precision, round(fp.default_lng::numeric, 2)::double precision))
    FROM open_needs fn
    LEFT JOIN public.profiles pr ON pr.user_id = fn.family_user_id
    LEFT JOIN public.family_profiles fp ON fp.user_id = fn.family_user_id
    LEFT JOIN trust tr ON tr.uid = fn.family_user_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) >= 3 THEN round(avg(sr.stars)::numeric, 2) END AS stars,
             count(*)::integer AS n
        FROM public.service_ratings sr WHERE sr.rated_id = fn.family_user_id
    ) rep ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n
        FROM public.service_bookings b WHERE b.client_id = fn.family_user_id AND b.status = 'completed'
    ) done ON true
   ORDER BY fn.starts_at;
END
$fn$;

DROP FUNCTION IF EXISTS public.list_open_institution_offers(integer);
CREATE FUNCTION public.list_open_institution_offers(p_limit integer DEFAULT 200)
RETURNS TABLE(
  offer_id uuid, institution_user_id uuid, institution_name text, institution_type text, institution_verified boolean,
  title text, description text, city text, service_area text, specialty_required text, requirements text[], modality text,
  amount integer, is_urgent boolean, start_date timestamptz, end_date timestamptz, positions_total integer,
  positions_filled integer, shifts jsonb, created_at timestamptz, lat double precision, lng double precision,
  my_application_id uuid, my_status text, my_awaiting text, my_amount integer, rating_count integer, rating_avg numeric,
  completed_services integer,
  institution_trust integer, institution_trust_level text, institution_trust_enough boolean, distance_band_km integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT pp.lat, pp.lng INTO v_lat, v_lng FROM public.professional_profiles pp WHERE pp.user_id = v_uid;

  RETURN QUERY
  WITH trust AS MATERIALIZED (
    SELECT i.uid, t.score, t.level, t.enough_data
      FROM (SELECT DISTINCT x.posted_by AS uid FROM public.job_offers x
             WHERE x.poster_type::text = 'institution' AND x.status::text = 'open' AND NOT x.blocked) i
      CROSS JOIN LATERAL public.hx_trust_calc(i.uid, 'institution') t
  )
  SELECT o.id,
         o.posted_by,
         COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Institución de salud'),
         ip.institution_type,
         COALESCE(ip.verified, false),
         o.title, o.description, o.city, o.service_area, o.specialty_required,
         COALESCE(o.requirements, '{}'::text[]),
         o.modality::text, o.amount, o.is_urgent,
         COALESCE(sh.first_start, o.start_date),
         COALESCE(sh.last_end, o.end_date),
         COALESCE(sh.pos_total, 0), COALESCE(sh.pos_filled, 0),
         COALESCE(sh.shifts, '[]'::jsonb),
         o.created_at, o.lat, o.lng,
         ma.id, ma.status::text, ma.awaiting, ma.proposed_amount,
         rt.n, CASE WHEN rt.n >= 3 THEN rt.avg END, cs.n,
         tr.score, tr.level, tr.enough_data,
         public.hx_distance_band(public.hx_distance_km(v_lat, v_lng, COALESCE(o.lat, ip.lat), COALESCE(o.lng, ip.lng)))
    FROM public.job_offers o
    LEFT JOIN public.institution_profiles ip ON ip.user_id = o.posted_by
    LEFT JOIN trust tr ON tr.uid = o.posted_by
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                                          'positions', s.positions, 'filled', s.filled)
                       ORDER BY s.starts_at)
               FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS shifts,
             min(s.starts_at) FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS first_start,
             max(s.ends_at)   FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS last_end,
             COALESCE(sum(s.positions) FILTER (WHERE s.status <> 'cancelled' AND s.ends_at > now()), 0)::integer AS pos_total,
             COALESCE(sum(s.filled)    FILTER (WHERE s.status <> 'cancelled' AND s.ends_at > now()), 0)::integer AS pos_filled,
             (count(*) FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()))::integer AS open_n,
             (count(*) > 0) AS has_any
        FROM public.job_offer_shifts s WHERE s.job_offer_id = o.id
    ) sh ON true
    LEFT JOIN LATERAL (
      SELECT a.id, a.status, a.awaiting, a.proposed_amount
        FROM public.applications a
       WHERE a.job_offer_id = o.id AND a.professional_id = v_uid
       ORDER BY a.created_at DESC LIMIT 1
    ) ma ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n, round(avg(sr.stars)::numeric, 2) AS avg
        FROM public.service_ratings sr WHERE sr.rated_id = o.posted_by
    ) rt ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n
        FROM public.service_bookings b WHERE b.client_id = o.posted_by AND b.status = 'completed'
    ) cs ON true
   WHERE o.poster_type::text = 'institution'
     AND o.status::text = 'open'
     AND NOT o.blocked
     AND o.posted_by <> v_uid
     AND (COALESCE(sh.open_n, 0) > 0 OR (NOT COALESCE(sh.has_any, false) AND (o.end_date IS NULL OR o.end_date > now())))
   ORDER BY o.is_urgent DESC, COALESCE(sh.first_start, o.start_date, o.created_at) ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 400);
END
$fn$;

-- Ofertas de trabajo publicadas por familias, para el profesional: quién ofrece (nombre abreviado), su Trust Score, su reputación y la
-- cercanía por rangos. El detalle de contacto y la dirección nunca viajan aquí (el contacto del texto se oculta).
CREATE OR REPLACE FUNCTION public.list_open_family_offers(p_limit integer DEFAULT 100)
RETURNS TABLE(
  offer_id uuid, family_user_id uuid, display_name text, title text, description text, city text, specialty_required text,
  requirements text[], modality text, amount integer, start_date timestamptz, end_date timestamptz, created_at timestamptz,
  my_application_id uuid, my_status text,
  family_stars numeric, family_ratings integer, family_completed integer,
  family_trust integer, family_trust_level text, family_trust_enough boolean, family_verified boolean, distance_band_km integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden ver las ofertas de las familias' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;
  SELECT pp.lat, pp.lng INTO v_lat, v_lng FROM public.professional_profiles pp WHERE pp.user_id = v_uid;

  RETURN QUERY
  WITH open_offers AS (
    SELECT o.*
      FROM public.job_offers o
     WHERE o.poster_type::text = 'family'
       AND o.status::text = 'open'
       AND NOT COALESCE(o.blocked, false)
       AND o.posted_by <> v_uid
       AND (o.end_date IS NULL OR o.end_date > now())
     ORDER BY o.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300)
  ), trust AS MATERIALIZED (
    SELECT f.uid, t.score, t.level, t.enough_data, t.verified
      FROM (SELECT DISTINCT n.posted_by AS uid FROM open_offers n) f
      CROSS JOIN LATERAL public.hx_trust_calc(f.uid, 'family') t
  )
  SELECT o.id, o.posted_by, public.short_display_name(pr.full_name),
         o.title, left(public.redact_contact_info(o.description), 600), o.city, o.specialty_required,
         COALESCE(o.requirements, '{}'::text[]), o.modality::text, o.amount, o.start_date, o.end_date, o.created_at,
         ma.id, ma.status::text,
         rep.stars, rep.n, done.n,
         tr.score, tr.level, tr.enough_data, tr.verified,
         public.hx_distance_band(public.hx_distance_km(
           v_lat, v_lng,
           COALESCE(o.lat, round(fp.default_lat::numeric, 2)::double precision), COALESCE(o.lng, round(fp.default_lng::numeric, 2)::double precision)))
    FROM open_offers o
    LEFT JOIN public.profiles pr ON pr.user_id = o.posted_by
    LEFT JOIN public.family_profiles fp ON fp.user_id = o.posted_by
    LEFT JOIN trust tr ON tr.uid = o.posted_by
    LEFT JOIN LATERAL (
      SELECT a.id, a.status FROM public.applications a
       WHERE a.job_offer_id = o.id AND a.professional_id = v_uid
       ORDER BY a.created_at DESC LIMIT 1
    ) ma ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) >= 3 THEN round(avg(sr.stars)::numeric, 2) END AS stars, count(*)::integer AS n
        FROM public.service_ratings sr WHERE sr.rated_id = o.posted_by
    ) rep ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n FROM public.service_bookings b WHERE b.client_id = o.posted_by AND b.status = 'completed'
    ) done ON true
   ORDER BY o.created_at DESC;
END
$fn$;

-- ── 7) Permisos ──────────────────────────────────────────────────────────────────
-- Utilidades y piezas internas: solo las usan funciones del servidor (propiedad de la base), nunca la API.
REVOKE ALL ON FUNCTION public.hx_distance_km(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_distance_band(double precision)                                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_trust_level(integer)                                                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_pro_label(text, boolean)                                                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_trust_calc(uuid, text)                                                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_reveal_pro_contact(uuid, uuid, uuid, uuid)                                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_notify_nearby_professionals(text, uuid, text, double precision, double precision, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_family_need_notify_pros()                                                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_job_offer_notify_pros()                                                            FROM PUBLIC, anon, authenticated;

-- Lo que llama la aplicación (con sesión iniciada).
REVOKE ALL ON FUNCTION public.get_trust_score(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.family_applicants(integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reveal_applicant_contact(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reveal_application_contact(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.family_offer_applicants(integer)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counter_application(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counter_slot_proposal(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_slot_proposals(integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_open_family_needs(integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_open_institution_offers(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_open_family_offers(integer)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trust_score(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.family_applicants(integer)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_applicant_contact(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_application_contact(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.family_offer_applicants(integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.counter_application(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.counter_slot_proposal(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_slot_proposals(integer)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_family_needs(integer)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_institution_offers(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_family_offers(integer)      TO authenticated;

NOTIFY pgrst, 'reload schema';
