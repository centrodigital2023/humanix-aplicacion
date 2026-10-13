-- Escenario — Mejora de la tabla de presencia ANTIGUA (la de 20260610040000: GPS exacto, legible por anónimos).
-- En producción la tabla no existe; esto cubre un entorno que sí la tuvo (cadena completa de migraciones del repositorio).
-- Variables: MIG (20261012210000_live_map.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

-- La tabla y las políticas tal como las dejó la migración antigua.
CREATE TABLE public.user_locations (
  user_id     uuid             PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    real,
  heading     real,
  speed       real,
  is_online   boolean          NOT NULL DEFAULT true,
  user_type   text             CHECK (user_type IN ('professional', 'family', 'institution')),
  updated_at  timestamptz      NOT NULL DEFAULT now()
);
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_online_locations" ON public.user_locations FOR SELECT USING (is_online = TRUE);
CREATE POLICY "own_location_write" ON public.user_locations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT ON public.user_locations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_locations TO authenticated;
INSERT INTO public.user_locations(user_id, lat, lng, accuracy, heading, speed, is_online, user_type, updated_at) VALUES
  (:'p1', 4.609712, -74.081753, 5, 90, 3, true,  'professional', now() - interval '2 days'),
  (:'f1', 4.700123, -74.030111, 8, NULL, NULL, true, 'family', now() - interval '2 days'),
  (:'p2', 6.244212, -75.581234, 9, NULL, NULL, false, 'professional', now() - interval '3 days');

-- Un perfil profesional publicado para la presencia nueva (con los disparadores de guarda apagados: solo arma la escena).
SET session_replication_role = replica;
INSERT INTO public.professional_profiles(user_id, published, active, available) VALUES (:'p1', true, true, true);
SET session_replication_role = origin;

-- ═══ ANTES ═════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('0.1 antes: un anónimo lee el GPS exacto de quien está en línea', public.t_anon($q$SELECT string_agg(lat::text || '/' || lng::text, ',' ORDER BY lat) FROM public.user_locations$q$), '4.609712/-74.081753,4.700123/-74.030111');
SELECT public.t_true('0.2 antes: cualquiera con sesión podía escribir directo', has_table_privilege('authenticated', 'public.user_locations', 'INSERT'));

\i :MIG

-- ═══ DESPUÉS ══════════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_err('1.1 el anónimo ya no lee nada', public.t_anon('SELECT count(*)::text FROM public.user_locations'), 'permission denied');
SELECT public.t_eq('1.2 las políticas abiertas desaparecieron: solo queda la de lo propio o personal', (SELECT string_agg(policyname, ',') FROM pg_policies WHERE tablename = 'user_locations'), 'ul_select_self_or_staff');
SELECT public.t_true('1.3 nadie escribe directo', NOT has_table_privilege('authenticated', 'public.user_locations', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.user_locations', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.user_locations', 'DELETE') AND NOT has_table_privilege('anon', 'public.user_locations', 'SELECT'));
SELECT public.t_eq('1.4 sin precisión, rumbo ni velocidad', (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_locations'), 'user_id,lat,lng,is_online,user_type,updated_at,last_seen');
SELECT public.t_eq('1.5 las posiciones guardadas pasan a la cuadrícula de ~1 km; la familia no conserva ninguna',
  (SELECT string_agg(COALESCE(lat::text, 'sin') || '/' || COALESCE(lng::text, 'sin'), ',' ORDER BY user_type, user_id) FROM public.user_locations), 'sin/sin,4.61/-74.08,6.24/-75.58');
SELECT public.t_eq('1.6 se conservan las tres filas', (SELECT count(*)::text FROM public.user_locations), '3');
SELECT public.t_eq('1.7 una fila de hace días no cuenta como «en vivo» por haber agregado la columna', (SELECT count(*)::text FROM public.user_locations WHERE last_seen > now() - public.hx_presence_ttl()), '0');
SELECT public.t_eq('1.8 los contadores de «en vivo» siguen en cero', (SELECT pro_live || '/' || fam_live || '/' || inst_live FROM public.get_live_counts()), '0/0/0');
SELECT public.t_eq('1.9 la presencia nueva funciona sobre la tabla mejorada', public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.60971, -74.08175)) s$q$), 'ok');
SELECT public.t_eq('1.10 y cuenta como «en vivo»', (SELECT pro_live::text FROM public.get_live_counts()), '1');
SELECT public.t_eq('1.11 cada cuenta lee solo la suya', public.t_val(:'p1', 'SELECT count(*)::text FROM public.user_locations') || '/' || public.t_val(:'f2', 'SELECT count(*)::text FROM public.user_locations'), '1/0');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
