-- ═══════════════════════════════════════════════════════════════════════════════
-- REGISTRO CON UBICACIÓN (2026-10-28): los usuarios nuevos vuelven a aparecer en los mapas en vivo.
--
-- Qué pasaba
--   El formulario de registro (`src/routes/auth.tsx`) envía en los metadatos la ciudad, la dirección y la ubicación del equipo
--   (lat/lng). La versión de `handle_new_user()` que corre en producción (revisada el 2026-10-28) es la anterior a
--   20260422120000_signup_location_metadata.sql: crea el perfil vacío y descarta esos datos. Así, un profesional recién registrado
--   queda sin `lat`/`lng` ni `home_city`, `map_professionals` lo devuelve sin posición y el mapa no lo pinta (no se inventan
--   posiciones). Lo mismo con la ubicación y la dirección de las familias y la ciudad de las instituciones.
--
-- Qué hace
--   1. Reemplaza `handle_new_user()` por la versión con ubicación, conservando la regla del personal de institución
--      (20261013120000: cuentas `institution_staff` solo reciben perfil, nunca rol).
--        • Profesional: lat/lng aproximados a la cuadrícula del mapa (~1 km, igual que el panel) y `home_city`.
--        • Familia: ubicación y dirección de servicio (el mapa las muestra solo aproximadas, ver `map_open_demand`).
--        • Institución: ciudad, dirección y ubicación.
--      Solo se aceptan coordenadas dentro de Colombia (mismos límites que `tracking_pings`).
--   2. Rellena las cuentas ya creadas con lo que mandaron al registrarse, solo donde el perfil está vacío (no pisa nada que la
--      persona haya cambiado después). Los disparadores `trg_map_ping` avisan al mapa en vivo.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Coordenadas de los metadatos del registro (NULL si faltan, no son números o caen fuera de Colombia) ──────────

CREATE OR REPLACE FUNCTION public.hx_signup_coord(p_meta jsonb, p_key text, p_min double precision, p_max double precision)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE
  v double precision;
BEGIN
  BEGIN
    v := NULLIF(p_meta->>p_key, '')::double precision;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v IS NULL OR v < p_min OR v > p_max THEN
    RETURN NULL;
  END IF;
  RETURN v;
END
$fn$;
REVOKE ALL ON FUNCTION public.hx_signup_coord(jsonb, text, double precision, double precision) FROM PUBLIC, anon, authenticated;

-- ── 1) Registro ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role      public.app_role;
  v_meta_role text;
  v_meta      jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_lat       double precision;
  v_lng       double precision;
  v_city      text := NULLIF(btrim(v_meta->>'city'), '');
  v_address   text := NULLIF(btrim(v_meta->>'address'), '');
BEGIN
  v_lat := public.hx_signup_coord(v_meta, 'lat', -5, 14);
  v_lng := public.hx_signup_coord(v_meta, 'lng', -82, -66);
  IF v_lat IS NULL OR v_lng IS NULL THEN
    v_lat := NULL;
    v_lng := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, full_name, email, phone, city)
  VALUES (
    NEW.id,
    COALESCE(v_meta->>'full_name', NEW.email),
    NEW.email,
    v_meta->>'phone',
    v_meta->>'city'
  );

  -- Personal de una institución (lo crea el servidor): solo el perfil. Su acceso sale de institution_members, nunca de un rol.
  IF v_meta->>'signup_kind' = 'institution_staff' THEN
    RETURN NEW;
  END IF;

  v_meta_role := v_meta->>'role';
  IF v_meta_role IN ('professional', 'family', 'institution') THEN
    v_role := v_meta_role::public.app_role;
  ELSE
    v_role := 'family'::public.app_role;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
    ON CONFLICT DO NOTHING;

  IF v_role = 'professional' THEN
    INSERT INTO public.professional_profiles (user_id, lat, lng, home_city)
    VALUES (NEW.id, public.hx_cell(v_lat), public.hx_cell(v_lng), v_city)
      ON CONFLICT (user_id) DO UPDATE
        SET lat       = COALESCE(public.professional_profiles.lat, EXCLUDED.lat),
            lng       = COALESCE(public.professional_profiles.lng, EXCLUDED.lng),
            home_city = COALESCE(public.professional_profiles.home_city, EXCLUDED.home_city);
  ELSIF v_role = 'institution' THEN
    INSERT INTO public.institution_profiles (user_id, institution_name, city, address, lat, lng)
    VALUES (NEW.id, COALESCE(NULLIF(btrim(v_meta->>'institution_name'), ''), 'Institución'), v_city, v_address, v_lat, v_lng)
      ON CONFLICT (user_id) DO UPDATE
        SET city    = COALESCE(public.institution_profiles.city, EXCLUDED.city),
            address = COALESCE(public.institution_profiles.address, EXCLUDED.address),
            lat     = COALESCE(public.institution_profiles.lat, EXCLUDED.lat),
            lng     = COALESCE(public.institution_profiles.lng, EXCLUDED.lng);
  ELSE
    INSERT INTO public.family_profiles (user_id, default_lat, default_lng, default_address)
    VALUES (NEW.id, v_lat, v_lng, v_address)
      ON CONFLICT (user_id) DO UPDATE
        SET default_lat     = COALESCE(public.family_profiles.default_lat, EXCLUDED.default_lat),
            default_lng     = COALESCE(public.family_profiles.default_lng, EXCLUDED.default_lng),
            default_address = COALESCE(public.family_profiles.default_address, EXCLUDED.default_address);
  END IF;

  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- El disparador ya existe (20261012140000); se asegura por si acaso.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 2) Cuentas ya creadas: lo que mandaron al registrarse, solo donde falta ─────

WITH meta AS (
  SELECT u.id,
         public.hx_signup_coord(u.raw_user_meta_data, 'lat', -5, 14)   AS lat,
         public.hx_signup_coord(u.raw_user_meta_data, 'lng', -82, -66) AS lng,
         NULLIF(btrim(u.raw_user_meta_data->>'city'), '')              AS city
    FROM auth.users u
)
UPDATE public.professional_profiles pp
   SET lat       = CASE WHEN pp.lat IS NULL AND pp.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL
                        THEN public.hx_cell(m.lat) ELSE pp.lat END,
       lng       = CASE WHEN pp.lat IS NULL AND pp.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL
                        THEN public.hx_cell(m.lng) ELSE pp.lng END,
       home_city = COALESCE(NULLIF(btrim(pp.home_city), ''), m.city, NULLIF(btrim(pp.home_city), ''))
  FROM meta m
 WHERE m.id = pp.user_id
   AND ((pp.lat IS NULL AND pp.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL)
        OR (NULLIF(btrim(pp.home_city), '') IS NULL AND m.city IS NOT NULL));

WITH meta AS (
  SELECT u.id,
         public.hx_signup_coord(u.raw_user_meta_data, 'lat', -5, 14)   AS lat,
         public.hx_signup_coord(u.raw_user_meta_data, 'lng', -82, -66) AS lng,
         NULLIF(btrim(u.raw_user_meta_data->>'address'), '')           AS address
    FROM auth.users u
)
UPDATE public.family_profiles fp
   SET default_lat     = CASE WHEN fp.default_lat IS NULL AND fp.default_lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL
                              THEN m.lat ELSE fp.default_lat END,
       default_lng     = CASE WHEN fp.default_lat IS NULL AND fp.default_lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL
                              THEN m.lng ELSE fp.default_lng END,
       default_address = COALESCE(fp.default_address, m.address)
  FROM meta m
 WHERE m.id = fp.user_id
   AND ((fp.default_lat IS NULL AND fp.default_lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL)
        OR (fp.default_address IS NULL AND m.address IS NOT NULL));

WITH meta AS (
  SELECT u.id,
         public.hx_signup_coord(u.raw_user_meta_data, 'lat', -5, 14)   AS lat,
         public.hx_signup_coord(u.raw_user_meta_data, 'lng', -82, -66) AS lng,
         NULLIF(btrim(u.raw_user_meta_data->>'city'), '')              AS city,
         NULLIF(btrim(u.raw_user_meta_data->>'address'), '')           AS address
    FROM auth.users u
)
UPDATE public.institution_profiles ip
   SET lat     = CASE WHEN ip.lat IS NULL AND ip.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL THEN m.lat ELSE ip.lat END,
       lng     = CASE WHEN ip.lat IS NULL AND ip.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL THEN m.lng ELSE ip.lng END,
       city    = COALESCE(NULLIF(btrim(ip.city), ''), m.city, ip.city),
       address = COALESCE(NULLIF(btrim(ip.address), ''), m.address, ip.address)
  FROM meta m
 WHERE m.id = ip.user_id
   AND ((ip.lat IS NULL AND ip.lng IS NULL AND m.lat IS NOT NULL AND m.lng IS NOT NULL)
        OR (NULLIF(btrim(ip.city), '') IS NULL AND m.city IS NOT NULL)
        OR (NULLIF(btrim(ip.address), '') IS NULL AND m.address IS NOT NULL));

-- Un solo aviso al mapa por si los disparadores no alcanzaron a emitir (sin datos, ver hx_ping_map).
SELECT public.hx_ping_map();
