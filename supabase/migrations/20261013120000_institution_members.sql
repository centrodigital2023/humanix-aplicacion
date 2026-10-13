-- ═══════════════════════════════════════════════════════════════════════════════
-- PERSONAL DE LA INSTITUCIÓN (2026-10-13): usuario y contraseña propios, con acceso solo a los módulos que la institución decida.
--
-- Pedido: la EPS/IPS agrega a su personal con usuario y contraseña y define a qué módulos entra cada quien.
--
-- Cómo se resuelve (y por qué así)
--   • Cada persona del equipo es una CUENTA propia de Supabase Auth (la crea el servidor con la llave de servicio: createServerFn, sin
--     Edge Functions). No tiene rol en `user_roles` —los roles siguen viviendo solo ahí y el personal nunca recibe uno—: su pertenencia es
--     una fila de `institution_members` (institución, módulos, estado). Así nadie hereda privilegios por accidente y quitar a alguien es
--     borrar o suspender su fila.
--   • Delegación por módulo, en dos lugares y nada más:
--       1) LECTURA por RLS de lo que el módulo necesita (ofertas, turnos, postulaciones y el nombre de la institución).
--       2) ACCIONES por las funciones que ya existen (publicar, aceptar, rechazar, contraofertar, invitar al equipo, bandeja): cada una
--          resolvía «quién soy» con auth.uid(); ahora lo resuelve `hx_acting_institution(auth.uid(), módulo)`, que devuelve la institución
--          solo si la persona es de su equipo, está activa, tiene ese módulo y la institución conserva el plan con «multi_user_roles»
--          (IPS Mejorado). En cualquier otro caso devuelve la propia cuenta y la función rechaza como antes. Las reglas de negocio no se
--          copian: se reutilizan tal cual (por eso el parche cambia una sola línea de cada función).
--   • Lo que NO se delega (por diseño): firmar contratos, pagos y billetera, datos de pacientes y monitoreo clínico, el perfil y los
--     datos legales de la institución, y administrar al propio equipo. Eso sigue siendo solo de la cuenta de la institución.
--   • Cada acción del equipo sobre ofertas y postulaciones queda en `institution_member_actions` (quién, qué y cuándo), visible para la
--     institución.
--
-- Módulos de esta versión: «ofertas» (turnos y postulaciones) y «talento» (la red de profesionales y sus ofertas, solo lectura).
--
-- Producción (revisada el 2026-10-13): handle_new_user() es la versión anterior a 20260422120000 (sin ubicación al registrarse), así que
-- se parcha por TEXTO (una línea) en lugar de reemplazarla entera; para toda cuenta que no sea personal no cambia nada.
--
-- Idempotente. Depende de: institution_hub_smart_contracts (publish/accept/decline/counter_application, bandeja, invite_team_to_offer),
-- professional_opportunity_hub (plan_key_for), offer_alerts_and_plans (counter_application v2) y professional_panel
-- (list_open_service_offers).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Catálogo de módulos ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_staff_modules()
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT ARRAY['ofertas', 'talento']::text[]
$fn$;

-- ── 2) El personal ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.institution_members (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  member_user_id uuid        NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  username       text        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  display_name   text        NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
  job_title      text        CHECK (job_title IS NULL OR char_length(job_title) <= 80),
  modules        text[]      NOT NULL DEFAULT '{}' CHECK (modules <@ public.hx_staff_modules()),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS institution_members_inst_idx ON public.institution_members (institution_id);

ALTER TABLE public.institution_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS im_select_owner ON public.institution_members;
DROP POLICY IF EXISTS im_select_self  ON public.institution_members;
DROP POLICY IF EXISTS im_select_staff ON public.institution_members;
CREATE POLICY im_select_owner ON public.institution_members FOR SELECT TO authenticated USING (institution_id = (SELECT auth.uid()));
CREATE POLICY im_select_self  ON public.institution_members FOR SELECT TO authenticated USING (member_user_id = (SELECT auth.uid()));
CREATE POLICY im_select_staff ON public.institution_members FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));

-- Nadie escribe desde la API: crear, cambiar, suspender y borrar pasa por el servidor (llave de servicio), que también crea la cuenta.
REVOKE ALL ON public.institution_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.institution_members TO authenticated;
GRANT ALL ON public.institution_members TO service_role;

CREATE OR REPLACE FUNCTION public.hx_member_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.member_user_id = NEW.institution_id THEN
      RAISE EXCEPTION 'La institución no puede ser su propio personal' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.institution_id AND ur.role = 'institution'::public.app_role) THEN
      RAISE EXCEPTION 'Solo una institución puede tener personal' USING ERRCODE = '23514';
    END IF;
    -- Una cuenta con rol propio (profesional, institución, personal de Humanix) nunca pasa a ser personal de otra institución. La de
    -- «familia» sí puede aparecer aquí: es el rol por defecto que da el registro y el disparador de abajo lo retira.
    IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.member_user_id AND ur.role <> 'family'::public.app_role) THEN
      RAISE EXCEPTION 'Esa cuenta ya tiene un rol en Humanix: el personal usa una cuenta propia' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.member_user_id AND u.raw_user_meta_data ->> 'signup_kind' = 'institution_staff') THEN
      RAISE EXCEPTION 'La cuenta del personal debe crearse desde el panel de la institución' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM public.institution_members m WHERE m.institution_id = NEW.institution_id) >= 10 THEN
      RAISE EXCEPTION 'Una institución puede tener hasta 10 personas en su equipo' USING ERRCODE = '23514', HINT = 'member_limit';
    END IF;
  ELSE
    -- Quién es, de quién es y cómo entra no se cambian: se borra y se crea de nuevo.
    NEW.institution_id := OLD.institution_id;
    NEW.member_user_id := OLD.member_user_id;
    NEW.username       := OLD.username;
    NEW.created_by     := OLD.created_by;
    NEW.created_at     := OLD.created_at;
    NEW.updated_at     := now();
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_member_guard ON public.institution_members;
CREATE TRIGGER trg_member_guard BEFORE INSERT OR UPDATE ON public.institution_members
  FOR EACH ROW EXECUTE FUNCTION public.hx_member_guard();

-- El registro da por defecto el rol «familia» (y su perfil) a toda cuenta nueva: al personal se lo retira, para que no tenga ninguno.
CREATE OR REPLACE FUNCTION public.hx_member_clean_roles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  DELETE FROM public.user_roles WHERE user_id = NEW.member_user_id;
  DELETE FROM public.family_profiles WHERE user_id = NEW.member_user_id;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_member_clean_roles ON public.institution_members;
CREATE TRIGGER trg_member_clean_roles AFTER INSERT ON public.institution_members
  FOR EACH ROW EXECUTE FUNCTION public.hx_member_clean_roles();

-- ── 3) Quién actúa: la institución cuando la persona es de su equipo, activa y con el módulo ─────────────────────

CREATE OR REPLACE FUNCTION public.hx_acting_institution(p_uid uuid, p_module text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT m.institution_id
       FROM public.institution_members m
      WHERE p_uid IS NOT NULL
        AND p_uid = auth.uid()                                  -- no sirve para averiguar de quién es otra cuenta
        AND m.member_user_id = p_uid
        AND m.status = 'active'
        AND p_module = ANY (m.modules)
        AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.institution_id AND ur.role = 'institution'::public.app_role)
        AND public.plan_key_for(m.institution_id) = 'institution_monthly'   -- «multi_user_roles»: se pierde con el plan
      LIMIT 1),
    p_uid)
$fn$;

-- ¿La sesión actual es de alguien del equipo de esta institución, con este módulo? (para pruebas y pantallas)
CREATE OR REPLACE FUNCTION public.hx_member_can(p_institution uuid, p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NOT NULL AND p_institution IS NOT NULL AND p_institution <> auth.uid()
     AND public.hx_acting_institution(auth.uid(), p_module) = p_institution
$fn$;

REVOKE ALL ON FUNCTION public.hx_staff_modules()                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_acting_institution(uuid, text)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_member_can(uuid, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_member_guard()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_member_clean_roles()              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_staff_modules()                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_acting_institution(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_member_can(uuid, text)         TO authenticated, service_role;

-- ── 4) Lectura por módulo (RLS) ──────────────────────────────────────────────────
-- El resultado de hx_acting_institution(...) se calcula UNA vez por consulta ((SELECT …) es un InitPlan): no pesa en las listas grandes.
-- Solo suman lectura: ninguna política de escritura cambia, así que el personal no inserta ni modifica nada por la API.

DROP POLICY IF EXISTS jo_member_select ON public.job_offers;
CREATE POLICY jo_member_select ON public.job_offers FOR SELECT TO authenticated
  USING (posted_by <> (SELECT auth.uid()) AND posted_by = (SELECT public.hx_acting_institution((SELECT auth.uid()), 'ofertas')));

DROP POLICY IF EXISTS jos_member_select ON public.job_offer_shifts;
CREATE POLICY jos_member_select ON public.job_offer_shifts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_offers o
                  WHERE o.id = job_offer_shifts.job_offer_id
                    AND o.posted_by <> (SELECT auth.uid())
                    AND o.posted_by = (SELECT public.hx_acting_institution((SELECT auth.uid()), 'ofertas'))));

DROP POLICY IF EXISTS apps_member_select ON public.applications;
CREATE POLICY apps_member_select ON public.applications FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_offers o
                  WHERE o.id = applications.job_offer_id
                    AND o.posted_by <> (SELECT auth.uid())
                    AND o.posted_by = (SELECT public.hx_acting_institution((SELECT auth.uid()), 'ofertas'))));

-- El nombre y la ciudad de la institución los necesita cualquier módulo.
DROP POLICY IF EXISTS inst_member_select ON public.institution_profiles;
CREATE POLICY inst_member_select ON public.institution_profiles FOR SELECT TO authenticated
  USING (user_id <> (SELECT auth.uid())
         AND (user_id = (SELECT public.hx_acting_institution((SELECT auth.uid()), 'ofertas'))
              OR user_id = (SELECT public.hx_acting_institution((SELECT auth.uid()), 'talento'))));

-- ── 5) Acciones: las mismas funciones, actuando como la institución cuando corresponde ───────────────────────────
-- Cada una declara `v_uid uuid := auth.uid();` (con los espacios que tenga para alinear) y no usa auth.uid() en otro lugar. Se re-crean
-- desde su definición actual cambiando esa línea; si alguna ya no tiene esa forma, la migración falla (y se deshace) en vez de dejar un
-- permiso a medias.

DO $hx_patch$
DECLARE
  r       record;
  def     text;
  n       integer;
  pat     constant text := '(v_uid\s+uuid\s*:=\s*)auth\.uid\(\)\s*;';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('publish_institution_offer(jsonb)',                'ofertas'),
      ('accept_application(uuid,jsonb)',                  'ofertas'),
      ('decline_application(uuid,text)',                  'ofertas'),
      ('counter_application(uuid,integer,text)',          'ofertas'),
      ('institution_application_inbox(integer)',          'ofertas'),
      ('invite_team_to_offer(uuid)',                      'ofertas')
    ) AS t(sig, module)
  LOOP
    IF to_regprocedure('public.' || r.sig) IS NULL THEN
      RAISE EXCEPTION 'Falta la función public.% (¿se aplicó la migración del hub de instituciones?)', r.sig;
    END IF;
    def := pg_get_functiondef(to_regprocedure('public.' || r.sig));
    IF position('hx_acting_institution' IN def) > 0 THEN
      CONTINUE;  -- ya parchada
    END IF;
    n := (length(def) - length(replace(def, 'auth.uid()', ''))) / length('auth.uid()');
    IF n <> 1 OR regexp_count(def, pat) <> 1 THEN
      RAISE EXCEPTION 'public.% no tiene la forma esperada (auth.uid() aparece % veces): no se delega', r.sig, n;
    END IF;
    EXECUTE regexp_replace(def, pat, format('\1public.hx_acting_institution(auth.uid(), %L);', r.module));
  END LOOP;
END
$hx_patch$;

-- ── 6) El registro no le da rol al personal ─────────────────────────────────────────────────────────────────────

DO $hx_hnu$
DECLARE
  def    text;
  needle constant text := $n$v_meta_role := NEW.raw_user_meta_data->>'role';$n$;
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE NOTICE 'No existe handle_new_user(): no se parcha el registro del personal';
    RETURN;
  END IF;
  def := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  IF position('institution_staff' IN def) > 0 THEN
    RETURN;  -- ya parchada
  END IF;
  IF position(needle IN def) = 0 THEN
    RAISE EXCEPTION 'handle_new_user() no tiene la forma esperada: revísala antes de permitir cuentas de personal';
  END IF;
  EXECUTE replace(def, needle,
    $r$-- Personal de una institución (lo crea el servidor): solo el perfil. Su acceso sale de institution_members, nunca de un rol.
  IF NEW.raw_user_meta_data->>'signup_kind' = 'institution_staff' THEN
    RETURN NEW;
  END IF;

  v_meta_role := NEW.raw_user_meta_data->>'role';$r$);
END
$hx_hnu$;

-- ── 7) Quién hizo qué ───────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.institution_member_actions (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid        NOT NULL,
  member_user_id uuid        NOT NULL,
  member_name    text,
  action         text        NOT NULL,
  target_table   text        NOT NULL,
  target_id      uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS institution_member_actions_inst_idx ON public.institution_member_actions (institution_id, created_at DESC);

ALTER TABLE public.institution_member_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ima_select_owner ON public.institution_member_actions;
DROP POLICY IF EXISTS ima_select_staff ON public.institution_member_actions;
CREATE POLICY ima_select_owner ON public.institution_member_actions FOR SELECT TO authenticated USING (institution_id = (SELECT auth.uid()));
CREATE POLICY ima_select_staff ON public.institution_member_actions FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));
REVOKE ALL ON public.institution_member_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.institution_member_actions TO authenticated;
GRANT ALL ON public.institution_member_actions TO service_role;

-- Registra lo que hace una persona del equipo (quien no es del equipo no deja nada). Una falla al registrar no frena la operación.
CREATE OR REPLACE FUNCTION public.hx_log_member_action()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  m        record;
  v_action text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT im.institution_id, im.display_name INTO m FROM public.institution_members im WHERE im.member_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'job_offers' THEN
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'offer_published' ELSE 'offer_updated' END;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
      v_action := 'application_' || NEW.status::text;
    ELSIF NEW.proposed_amount IS DISTINCT FROM OLD.proposed_amount THEN
      v_action := 'application_countered';
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.institution_member_actions (institution_id, member_user_id, member_name, action, target_table, target_id)
    VALUES (m.institution_id, v_uid, m.display_name, v_action, TG_TABLE_NAME, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'hx_log_member_action: %', SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.hx_log_member_action() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_member_audit_offers ON public.job_offers;
CREATE TRIGGER trg_member_audit_offers AFTER INSERT OR UPDATE ON public.job_offers
  FOR EACH ROW EXECUTE FUNCTION public.hx_log_member_action();
DROP TRIGGER IF EXISTS trg_member_audit_apps ON public.applications;
CREATE TRIGGER trg_member_audit_apps AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.hx_log_member_action();

-- ── 8) Módulo «talento»: la lista de ofertas de profesionales también para el personal con ese módulo ─────────────

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
  v_uid  uuid := auth.uid();
  v_inst uuid := public.hx_acting_institution(auth.uid(), 'talento');   -- la institución del personal con el módulo «talento»
  v_lat  double precision;
  v_lng  double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.is_staff(v_uid) OR public.has_role(v_uid, 'family'::public.app_role) OR public.has_role(v_uid, 'institution'::public.app_role)
          OR v_inst <> v_uid) THEN
    RAISE EXCEPTION 'Solo las familias y las instituciones pueden ver las ofertas de los profesionales' USING ERRCODE = '42501';
  END IF;

  -- Desde dónde se mide la cercanía: la zona de la familia o la sede de la institución (siempre aproximada).
  SELECT round(fp.default_lat::numeric, 2)::double precision, round(fp.default_lng::numeric, 2)::double precision
    INTO v_lat, v_lng FROM public.family_profiles fp WHERE fp.user_id = v_uid;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    SELECT round(ip.lat::numeric, 2)::double precision, round(ip.lng::numeric, 2)::double precision
      INTO v_lat, v_lng FROM public.institution_profiles ip WHERE ip.user_id = v_inst;
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

REVOKE ALL ON FUNCTION public.list_open_service_offers(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_service_offers(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
