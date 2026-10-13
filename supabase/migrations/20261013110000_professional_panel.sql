-- ═══════════════════════════════════════════════════════════════════════════════
-- PANEL DEL PROFESIONAL (2026-10-13): «Mi oferta de servicio» y ofertas de familias con el estado de la negociación.
--
-- Pedido: el profesional puede publicar su propia oferta (no puede publicar ofertas groseras ni ajenas a la salud / el cuidado) y las
-- familias y EPS/IPS la ven con su Trust Score; y el profesional ve las ofertas de las familias por cercanía y mejor pago, se postula y
-- propone su valor por hora.
--
-- Qué hace
--   1. list_open_family_offers() v2: las ofertas abiertas de las familias para el profesional agregan «urgente» y, si ya se postuló, a
--      quién le toca responder y el valor propuesto (antes solo traía el estado), para mostrar la negociación sin otra consulta.
--   2. professional_service_offers: la oferta de servicio del profesional (título, descripción, especialidad, modalidad y valor, ciudad,
--      vigencia). RLS: cada profesional ve y gestiona las suyas, el personal todas; nadie más lee la tabla.
--        • Disparador de guarda: moderación en el servidor (ofensivo, venta de artículos, ajeno a salud/cuidado, teléfonos/correos/
--          enlaces/direcciones/datos de pago — misma regla que las ofertas de las familias), «bloqueada» solo la mueve el personal,
--          máximo 5 ofertas vigentes por profesional y sin publicar con la cuenta en revisión.
--   3. list_open_service_offers(): lo que ven las familias, las instituciones y el personal: oferta + profesional (nombre completo con
--      sesión, calificación, RETHUS, Trust Score, estado) + cercanía por rangos respecto a quien mira. Sin teléfono ni dirección.
--   4. Aviso en vivo: difusión privada «service_offers_changed» por el tema que ya autoriza a toda cuenta con sesión (live_map_ping): los
--      clientes recargan por la función segura.
--
-- Idempotente. Depende de 20261012180000 (hx_offer_text_issue), 20261012190000 (hx_trust_calc, hx_distance_*, hx_pro_label) y
-- 20261012210000 (hx_cell, hx_presence_ttl y la política de live_map_ping).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Ofertas de las familias para el profesional (v2) ──────────────────────────

DROP FUNCTION IF EXISTS public.list_open_family_offers(integer);
CREATE FUNCTION public.list_open_family_offers(p_limit integer DEFAULT 100)
RETURNS TABLE(
  offer_id uuid, family_user_id uuid, display_name text, title text, description text, city text, specialty_required text,
  requirements text[], modality text, amount integer, is_urgent boolean, start_date timestamptz, end_date timestamptz,
  created_at timestamptz, my_application_id uuid, my_status text, my_awaiting text, my_amount integer,
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
         COALESCE(o.requirements, '{}'::text[]), o.modality::text, o.amount, COALESCE(o.is_urgent, false),
         o.start_date, o.end_date, o.created_at,
         ma.id, ma.status::text, ma.awaiting, ma.proposed_amount,
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
      SELECT a.id, a.status, a.awaiting, a.proposed_amount FROM public.applications a
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

-- ── 2) Mi oferta de servicio ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.professional_service_offers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title           text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 5 AND 120),
  description     text        CHECK (description IS NULL OR char_length(description) <= 800),
  specialty       text        CHECK (specialty IS NULL OR char_length(specialty) <= 80),
  modality        public.offer_modality NOT NULL DEFAULT 'hour',
  amount          integer     NOT NULL CHECK (amount BETWEEN 1000 AND 20000000),
  city            text        NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 80),
  available_from  timestamptz NOT NULL DEFAULT now(),
  available_until timestamptz,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed')),
  blocked         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (available_until IS NULL OR available_until > available_from)
);

CREATE INDEX IF NOT EXISTS pso_open_idx  ON public.professional_service_offers (created_at DESC) WHERE status = 'open' AND NOT blocked;
CREATE INDEX IF NOT EXISTS pso_owner_idx ON public.professional_service_offers (professional_id, status);

ALTER TABLE public.professional_service_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pso_select_owner_or_staff ON public.professional_service_offers;
DROP POLICY IF EXISTS pso_insert_owner          ON public.professional_service_offers;
DROP POLICY IF EXISTS pso_update_owner          ON public.professional_service_offers;
DROP POLICY IF EXISTS pso_delete_owner          ON public.professional_service_offers;
DROP POLICY IF EXISTS pso_staff_all             ON public.professional_service_offers;
CREATE POLICY pso_select_owner_or_staff ON public.professional_service_offers
  FOR SELECT TO authenticated USING (professional_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY pso_insert_owner ON public.professional_service_offers
  FOR INSERT TO authenticated
  WITH CHECK (professional_id = auth.uid() AND public.has_role(auth.uid(), 'professional'::public.app_role));
CREATE POLICY pso_update_owner ON public.professional_service_offers
  FOR UPDATE TO authenticated USING (professional_id = auth.uid()) WITH CHECK (professional_id = auth.uid());
CREATE POLICY pso_delete_owner ON public.professional_service_offers
  FOR DELETE TO authenticated USING (professional_id = auth.uid());
CREATE POLICY pso_staff_all ON public.professional_service_offers
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

REVOKE ALL ON public.professional_service_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_service_offers TO authenticated;
GRANT ALL ON public.professional_service_offers TO service_role;

-- Guarda: moderación del texto, «bloqueada» solo la mueve el personal, dueño fijo y tope de ofertas vigentes.
CREATE OR REPLACE FUNCTION public.hx_service_offer_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_staff boolean := false;
  v_text  text;
  v_issue text;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_staff := public.is_staff(v_uid);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND NOT v_staff THEN
      NEW.blocked := false;
    END IF;
  ELSE
    NEW.professional_id := OLD.professional_id;
    NEW.created_at := OLD.created_at;
    IF v_uid IS NOT NULL AND NOT v_staff THEN
      NEW.blocked := OLD.blocked;
    END IF;
    NEW.updated_at := now();
  END IF;

  -- Un profesional con la cuenta en revisión no publica ni reabre ofertas (igual que no puede postularse).
  IF v_uid IS NOT NULL AND NOT v_staff AND NEW.status = 'open' AND (TG_OP = 'INSERT' OR OLD.status <> 'open')
     AND EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = NEW.professional_id AND COALESCE(pp.blocked, false)) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;

  -- Máximo 5 ofertas vigentes (abiertas o en pausa) por profesional, también al reabrir una cerrada.
  IF v_uid IS NOT NULL AND NOT v_staff AND NEW.status IN ('open', 'paused') AND (TG_OP = 'INSERT' OR OLD.status = 'closed') THEN
    IF (SELECT count(*) FROM public.professional_service_offers o
         WHERE o.professional_id = NEW.professional_id AND o.status IN ('open', 'paused') AND o.id <> NEW.id) >= 5 THEN
      RAISE EXCEPTION 'Ya tienes 5 ofertas de servicio vigentes. Cierra o elimina una para publicar otra.'
        USING ERRCODE = '23514', HINT = 'service_offer_limit';
    END IF;
  END IF;

  -- Moderación (solo si cambia el texto y hay sesión): ofensivo, venta de artículos, ajeno a salud/cuidado y datos de contacto o pago.
  IF v_uid IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title
                            OR NEW.description IS DISTINCT FROM OLD.description OR NEW.specialty IS DISTINCT FROM OLD.specialty) THEN
    v_text := NEW.title || ' ' || COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.specialty, '');
    v_issue := public.hx_offer_text_issue(v_text, true);
    IF v_issue IS NULL AND to_regprocedure('public.message_has_forbidden_content(text)') IS NOT NULL
       AND public.message_has_forbidden_content(v_text) THEN
      v_issue := 'contact';
    END IF;
    IF v_issue IS NOT NULL THEN
      RAISE EXCEPTION '%', CASE v_issue
        WHEN 'rude'     THEN 'Tu texto tiene lenguaje ofensivo. Escríbelo con respeto.'
        WHEN 'sale'     THEN 'En Humanix solo se publican ofertas de salud y cuidado: no se venden, compran ni arriendan artículos.'
        WHEN 'offtopic' THEN 'Tu oferta no parece de salud o cuidado. Cuéntanos qué cuidado necesitas (por ejemplo: enfermería, acompañamiento, curaciones, terapias).'
        ELSE                 'No incluyas teléfonos, correos, enlaces ni direcciones en el texto: el contacto se desbloquea según tu plan y los pagos se hacen solo en la página web.'
      END USING ERRCODE = '23514', HINT = 'offer_' || v_issue;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_pso_guard ON public.professional_service_offers;
CREATE TRIGGER trg_pso_guard BEFORE INSERT OR UPDATE ON public.professional_service_offers
  FOR EACH ROW EXECUTE FUNCTION public.hx_service_offer_guard();

-- ── 3) Lo que ven las familias, las instituciones y el personal ─────────────────

CREATE OR REPLACE FUNCTION public.list_open_service_offers(p_limit integer DEFAULT 100)
RETURNS TABLE (
  offer_id uuid, professional_id uuid, display_name text, avatar_url text, profile_specialty text,
  title text, description text, specialty text, modality text, amount integer, city text,
  available_from timestamptz, available_until timestamptz, created_at timestamptz,
  avg_rating numeric, total_jobs integer, rethus_verified boolean, verified boolean,
  trust_score integer, trust_level text, trust_enough boolean,
  availability_status text, live boolean, distance_band_km integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.is_staff(v_uid) OR public.has_role(v_uid, 'family'::public.app_role) OR public.has_role(v_uid, 'institution'::public.app_role)) THEN
    RAISE EXCEPTION 'Solo las familias y las instituciones pueden ver las ofertas de los profesionales' USING ERRCODE = '42501';
  END IF;

  -- Desde dónde se mide la cercanía: la zona de la familia o la sede de la institución (siempre aproximada).
  SELECT round(fp.default_lat::numeric, 2)::double precision, round(fp.default_lng::numeric, 2)::double precision
    INTO v_lat, v_lng FROM public.family_profiles fp WHERE fp.user_id = v_uid;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    SELECT round(ip.lat::numeric, 2)::double precision, round(ip.lng::numeric, 2)::double precision
      INTO v_lat, v_lng FROM public.institution_profiles ip WHERE ip.user_id = v_uid;
  END IF;

  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.professional_id AS pro_id
      FROM public.service_bookings b
     WHERE b.status = 'in_progress'
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  ), open_offers AS (
    SELECT o.*
      FROM public.professional_service_offers o
      JOIN public.professional_profiles pp ON pp.user_id = o.professional_id
     WHERE o.status = 'open' AND NOT o.blocked
       AND (o.available_until IS NULL OR o.available_until > now())
       AND COALESCE(pp.published, false) AND COALESCE(pp.active, true) AND NOT COALESCE(pp.blocked, false)
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = o.professional_id AND ur.role = 'professional'::public.app_role)
     ORDER BY o.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300)
  )
  SELECT o.id, o.professional_id, public.hx_pro_label(pr.full_name, false), COALESCE(pp.avatar_url, pr.avatar_url), pp.specialty,
         o.title, left(public.redact_contact_info(o.description), 800), o.specialty, o.modality::text, o.amount, o.city,
         o.available_from, o.available_until, o.created_at,
         pp.avg_rating, pp.total_jobs, COALESCE(pp.rethus_verified, false), COALESCE(pp.verified, false),
         t.score, t.level, t.enough_data,
         CASE WHEN COALESCE(pp.reserved_until > now(), false) OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = o.professional_id) THEN 'busy'
              WHEN COALESCE(pp.available, false) THEN 'available'
              ELSE 'unavailable' END,
         COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false),
         public.hx_distance_band(public.hx_distance_km(v_lat, v_lng, public.hx_cell(pp.lat), public.hx_cell(pp.lng)))
    FROM open_offers o
    JOIN public.professional_profiles pp ON pp.user_id = o.professional_id
    LEFT JOIN public.profiles pr ON pr.user_id = o.professional_id
    LEFT JOIN public.user_locations ul ON ul.user_id = o.professional_id
    LEFT JOIN LATERAL public.hx_trust_calc(o.professional_id, 'professional') t ON true
   ORDER BY public.hx_distance_km(v_lat, v_lng, public.hx_cell(pp.lat), public.hx_cell(pp.lng)) NULLS LAST,
            pp.avg_rating DESC NULLS LAST, o.created_at DESC;
END
$fn$;

-- ── 4) Aviso en vivo ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_ping_service_offers()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'service_offers_changed', 'live_map_ping', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.trg_ping_service_offers()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  PERFORM public.hx_ping_service_offers();
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_pso_ping ON public.professional_service_offers;
CREATE TRIGGER trg_pso_ping AFTER INSERT OR UPDATE OR DELETE ON public.professional_service_offers
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ping_service_offers();

-- ── 5) Permisos ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.hx_service_offer_guard()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_ping_service_offers()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_ping_service_offers()     FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.list_open_family_offers(integer)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_open_service_offers(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_family_offers(integer)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_service_offers(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
