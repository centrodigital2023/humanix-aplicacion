-- Escenario — Mapas en vivo: presencia sin GPS exacto, contadores reales y pines por rol. Sobre la réplica de producción
-- (con la moderación y las ofertas ya aplicadas, como hoy en producción).
-- Variables: MIG (20261012210000_live_map.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

\set p3 '00000000-0000-0000-0000-0000000000a3'
\set p4 '00000000-0000-0000-0000-0000000000a4'
\set p5 '00000000-0000-0000-0000-0000000000a5'
\set p6 '00000000-0000-0000-0000-0000000000a6'
\set f3 '00000000-0000-0000-0000-0000000000f3'
\set f4 '00000000-0000-0000-0000-0000000000f4'
\set i3 '00000000-0000-0000-0000-0000000000b3'

INSERT INTO auth.users(id, email) VALUES (:'p3','p3@t.co'),(:'p4','p4@t.co'),(:'p5','p5@t.co'),(:'p6','p6@t.co'),(:'f3','f3@t.co'),(:'f4','f4@t.co'),(:'i3','i3@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'p3','professional'),(:'p4','professional'),(:'p5','professional'),(:'p6','professional'),
  (:'f3','family'),(:'f4','family'),(:'i3','institution');

-- Producción hoy: get_platform_counts() existe y devuelve ceros fijos en «en línea» (la réplica base es anterior a ella; esta es la
-- definición leída de la base real el 2026-10-13).
CREATE OR REPLACE FUNCTION public.get_platform_counts()
 RETURNS TABLE(professionals_total bigint, professionals_available bigint, professionals_rethus bigint, professionals_online bigint, families_total bigint, families_online bigint, institutions_total bigint, institutions_online bigint, completed_services bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
WITH
pro_stats AS (
  SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE available = TRUE AND COALESCE(active, TRUE) IS NOT FALSE) AS available,
    COUNT(*) FILTER (WHERE rethus_verified = TRUE) AS rethus
  FROM public.professional_profiles
),
fam_stats AS (SELECT COUNT(*) AS total FROM public.family_profiles),
inst_stats AS (SELECT COUNT(*) AS total FROM public.institution_profiles),
svc AS (SELECT COUNT(*) AS completed FROM public.service_bookings WHERE status = 'completed')
SELECT ps.total, ps.available, ps.rethus, 0::bigint, fs.total, 0::bigint, is2.total, 0::bigint, sv.completed
FROM pro_stats ps, fam_stats fs, inst_stats is2, svc sv;
$function$;
GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;

-- Producción hoy: la vista del mapa de profesionales (security_invoker, parte de user_roles; la réplica base es anterior a ella). Versión reducida con
-- la misma estructura FROM/JOIN/WHERE que la real, para comprobar que a otra cuenta le sale vacía.
CREATE VIEW public.public_professionals_safe WITH (security_invoker = true) AS
 SELECT ur.user_id, pp.lat, pp.lng, pp.specialty, COALESCE(pr.full_name, 'Profesional') AS full_name, pr.phone
   FROM public.user_roles ur
   LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
   LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
  WHERE ur.role = 'professional'::public.app_role AND COALESCE(pp.active, true) IS NOT FALSE;
GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- Perfiles (con los disparadores de guarda apagados: solo para armar la escena).
SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city, phone, avatar_url) VALUES
  (:'p1','Laura Pérez','Bogotá','3001111111','https://x.test/p1.png'),
  (:'p2','Sofía Cano','Medellín','3002222222',NULL),
  (:'p3','Marta Ruiz','Bogotá','3003333333',NULL),
  (:'p4','Beatriz Núñez','Bogotá','3004444444',NULL),
  (:'p5','Elena Mora','Bogotá','3005555555',NULL),
  (:'p6','Rosa Díaz','Bogotá','3006666666',NULL),
  (:'f1','Ana Gómez','Bogotá','3101111111',NULL),
  (:'f2','Carlos Rey','Bogotá','3102222222',NULL),
  (:'f3','Lucía Toro','Bogotá','3103333333',NULL),
  (:'f4','Pedro Vega','Bogotá','3104444444',NULL),
  (:'i1','Clínica Norte','Bogotá','6011111111',NULL),
  (:'i2','IPS Oculta','Bogotá','6012222222',NULL),
  (:'i3','Geriátrico Sol','Bogotá','6013333333',NULL);
INSERT INTO public.professional_profiles(user_id, specialty, hourly_rate, avg_rating, trust_score, years_experience, rethus_verified, verified,
                                         published, active, available, blocked, lat, lng, home_city, reserved_until, avatar_url) VALUES
  (:'p1','Enfermería',25000,4.80,82,6,true, true, true, true, true,  false, 4.60971,-74.08175,'Bogotá',   NULL,'https://x.test/p1.png'),
  (:'p2','Fisioterapia',22000,4.20,64,3,false,false,true, true, false, false, 6.2442, -75.5812, 'Medellín', NULL,NULL),
  (:'p3','Cuidado',18000,4.50,70,4,false,false,true, true, true,  false, 4.65,   -74.05,   'Bogotá',   now() + interval '1 hour',NULL),
  (:'p4','Auxiliar',15000,0,0,1,false,false,false,true, true,  false, 4.66,   -74.06,   'Bogotá',   NULL,NULL),
  (:'p5','Enfermería',20000,3.9,50,2,false,false,true, true, true,  true,  4.67,   -74.07,   'Bogotá',   NULL,NULL),
  (:'p6','Terapia',21000,4.1,60,2,false,false,true, true, true,  false, 4.70,   -74.10,   'Bogotá',   NULL,NULL);
INSERT INTO public.family_profiles(user_id, default_lat, default_lng, default_address, whatsapp, patient_name, visible_on_map) VALUES
  (:'f1', 4.7001, -74.0301, 'Calle 100 # 10-20 (privada)', '3101111111', 'Paciente Uno',  true),
  (:'f2', 4.6097, -74.0817, 'Carrera 7 # 32-16 (privada)', '3102222222', 'Paciente Dos',  true),
  (:'f3', 4.6500, -74.0600, 'Calle 80 # 20-30 (privada)',  '3103333333', 'Paciente Tres', false),
  (:'f4', 4.6600, -74.0700, 'Calle 63 # 15-10 (privada)',  '3104444444', 'Paciente Cuatro', true);
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, city, lat, lng, verified, visible_on_map) VALUES
  (:'i1', 'Clínica Norte',  'clinica',   'Bogotá', 4.6486, -74.0628, true,  true),
  (:'i2', 'IPS Oculta',     'ips',       'Bogotá', 4.6000, -74.0700, false, false),
  (:'i3', 'Geriátrico Sol', 'geriatrico','Bogotá', 4.7100, -74.0400, false, true);
SET session_replication_role = origin;

-- Demanda abierta y servicios (con todos los disparadores activos, como en producción).
INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, lat, lng, status)
VALUES (:'f1', 'family', 'Cuidado de adulto mayor', 'Acompañamiento diurno de enfermería', 'hour', 24000, 'Bogotá', 4.70012, -74.03011, 'open') RETURNING id AS o_f1 \gset
INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status)
VALUES (:'f3', 'family', 'Cuidado nocturno', 'Cuidado de paciente postoperatorio', 'shift', 160000, 'Bogotá', 'open') RETURNING id AS o_f3 \gset
INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status)
VALUES (:'i1', 'institution', 'Turno de enfermería', 'Cobertura de urgencias', 'shift', 160000, 'Bogotá', 'open') RETURNING id AS o_i1 \gset
INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status)
VALUES (:'f2', now() + interval '2 hours', now() + interval '3 hours', 18000, 'open');
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f4', :'p6', 'in_progress', now() - interval '1 hour', 4, 20000, 80000),
       (:'i3', :'p3', 'in_progress', now() - interval '1 hour', 4, 20000, 80000),
       (:'f1', :'p1', 'completed',   now() - interval '3 days', 4, 20000, 80000);

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('0.1 antes: no existe user_locations', to_regclass('public.user_locations') IS NULL);
SELECT public.t_true('0.2 antes: no existen las funciones de presencia ni de mapas', to_regprocedure('public.touch_presence(double precision,double precision)') IS NULL
  AND to_regprocedure('public.map_professionals(double precision,double precision,double precision,integer)') IS NULL AND to_regprocedure('public.get_live_counts()') IS NULL);
SELECT public.t_eq('0.3 antes: el contador «en línea» es un cero fijo', (SELECT professionals_online::text || '/' || families_online || '/' || institutions_online FROM public.get_platform_counts()), '0/0/0');
SELECT public.t_eq('0.4 antes: las vistas del mapa salen vacías para otra cuenta (parten de user_roles)', public.t_val(:'f2', 'SELECT count(*)::text FROM public.public_professionals_safe'), '0');
SELECT n AS ping0 FROM (SELECT count(*) AS n FROM public._realtime_log WHERE topic = 'live_map_ping') x \gset
SELECT public.t_eq('0.5 antes: no hay avisos del mapa', :'ping0', '0');

\i :MIG

-- ═══ 1) La tabla de presencia ═════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('1.1 existe user_locations con RLS', to_regclass('public.user_locations') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_locations'::regclass));
SELECT public.t_eq('1.2 sin precisión, rumbo ni velocidad (solo posición aproximada)', (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_locations'), 'user_id,user_type,lat,lng,is_online,last_seen,updated_at');
SELECT public.t_true('1.3 anon no tiene ningún privilegio sobre la tabla', NOT has_table_privilege('anon', 'public.user_locations', 'SELECT') AND NOT has_table_privilege('anon', 'public.user_locations', 'INSERT'));
SELECT public.t_true('1.4 authenticated solo puede leer (sin escribir directo)', has_table_privilege('authenticated', 'public.user_locations', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.user_locations', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.user_locations', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.user_locations', 'DELETE'));
SELECT public.t_eq('1.5 una sola política: leer lo propio o ser personal', (SELECT string_agg(policyname, ',') FROM pg_policies WHERE tablename = 'user_locations'), 'ul_select_self_or_staff');

-- ═══ 2) touch_presence / stop_presence ════════════════════════════════════════════════════════════════════════
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.60971, -74.08175)) s$q$) AS r21 \gset
SELECT public.t_eq('2.1 el profesional comparte su posición: se guarda en la cuadrícula, no el GPS exacto',
  :'r21' || '|' || (SELECT user_type || '/' || lat || '/' || lng || '/' || is_online FROM public.user_locations WHERE user_id = :'p1'), 'ok|professional/4.61/-74.08/true');
SELECT public.t_val(:'f1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.7001, -74.0301)) s$q$) AS r22 \gset
SELECT public.t_eq('2.2 la familia cuenta como «en vivo» pero no publica posición', :'r22' || '|' ||
  (SELECT user_type || '/' || COALESCE(lat::text, 'sin') || '/' || COALESCE(lng::text, 'sin') FROM public.user_locations WHERE user_id = :'f1'), 'ok|family/sin/sin');
SELECT public.t_val(:'i1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.6486, -74.0628)) s$q$) AS r23 \gset
SELECT public.t_eq('2.3 la institución, igual', :'r23' || '|' ||
  (SELECT user_type || '/' || COALESCE(lat::text, 'sin') FROM public.user_locations WHERE user_id = :'i1'), 'ok|institution/sin');
SELECT public.t_val(:'sa', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.6, -74.0)) s$q$) AS r24 \gset
SELECT public.t_eq('2.4 el personal no genera presencia', :'r24' || '|' || (SELECT count(*) FROM public.user_locations WHERE user_id = :'sa'), 'ok|0');
SELECT public.t_err('2.5 sin sesión no se llama', public.t_anon($q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$), 'permission denied');
SELECT public.t_eq('2.6 con rol authenticated pero sin cuenta, tampoco', public.t_val(NULL, $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$), 'ERR[28000] No autenticado');
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(40.7, -74.0)) s$q$) AS r27 \gset
SELECT public.t_eq('2.7 coordenadas fuera de Colombia se ignoran (queda sin posición)', :'r27' || '|' ||
  (SELECT COALESCE(lat::text, 'sin') FROM public.user_locations WHERE user_id = :'p1'), 'ok|sin');
-- Latido repetido con la misma cuadrícula: no se reescribe (no cambia updated_at ni avisa al mapa)
SELECT public.t_val(:'p3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p3 \gset
SELECT updated_at AS upd1 FROM public.user_locations WHERE user_id = :'p3' \gset
SELECT count(*) AS ping1 FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_val(:'p3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p3b \gset
SELECT public.t_eq('2.8 un latido repetido no reescribe la fila', (SELECT (updated_at = :'upd1'::timestamptz)::text FROM public.user_locations WHERE user_id = :'p3'), 'true');
SELECT public.t_eq('2.9 ni avisa al mapa', (SELECT count(*)::text FROM public._realtime_log WHERE topic = 'live_map_ping'), :'ping1');
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.5, -74.2)) s$q$) AS _p1a \gset
SELECT count(*) AS ping2 FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_eq('2.10 moverse de cuadrícula sí avisa al mapa', (:ping2 - :ping1)::text, '1');
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.5, -74.2)) s$q$) AS _p1b \gset
SELECT public.t_eq('2.11 y el mismo sitio otra vez, no', (SELECT count(*)::text FROM public._realtime_log WHERE topic = 'live_map_ping'), :'ping2');
SELECT public.t_eq('2.12 la posición compartida queda aproximada', (SELECT lat || '/' || lng FROM public.user_locations WHERE user_id = :'p1'), '4.5/-74.2');
-- Un latido de refresco (pasados los 20 s) renueva la fila pero no cambia nada de lo que ve el mapa: no avisa
UPDATE public.user_locations SET last_seen = now() - interval '30 seconds', updated_at = now() - interval '30 seconds' WHERE user_id = :'p3';
SELECT count(*) AS ping_r0 FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_val(:'p3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p3c \gset
SELECT public.t_eq('2.12 un latido de refresco (pasados 20 s) renueva la fila', (SELECT (last_seen > now() - interval '10 seconds')::text FROM public.user_locations WHERE user_id = :'p3'), 'true');
SELECT public.t_eq('2.13 y no avisa al mapa (no cambió nada visible)', (SELECT count(*)::text FROM public._realtime_log WHERE topic = 'live_map_ping'), :'ping_r0');
-- Más presencia para los contadores: p4 (sin publicar), f3 y p6 (las haremos viejas)
SELECT public.t_val(:'p4', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p4 \gset
SELECT public.t_val(:'f3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _f3 \gset
SELECT public.t_val(:'p6', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p6 \gset
UPDATE public.user_locations SET last_seen = now() - interval '5 minutes' WHERE user_id IN (:'f3', :'p6');

-- ═══ 3) Contadores reales ═════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('3.1 profesionales: registrados / disponibles / ocupados / en vivo',
  (SELECT pro_total || '/' || pro_available || '/' || pro_busy || '/' || pro_live FROM public.get_live_counts()), '5/1/2/2');
SELECT public.t_eq('3.2 familias: registradas / con oferta u horas abiertas / con servicio en curso / en vivo',
  (SELECT fam_total || '/' || fam_available || '/' || fam_busy || '/' || fam_live FROM public.get_live_counts()), '4/3/1/1');
SELECT public.t_eq('3.3 instituciones: registradas / con ofertas abiertas / con servicio en curso / en vivo',
  (SELECT inst_total || '/' || inst_available || '/' || inst_busy || '/' || inst_live FROM public.get_live_counts()), '3/1/1/1');
SELECT public.t_eq('3.4 servicios completados', (SELECT completed_services::text FROM public.get_live_counts()), '1');
SELECT public.t_eq('3.5 la función antigua deja de devolver ceros y mantiene su forma',
  (SELECT professionals_total || '/' || professionals_available || '/' || professionals_rethus || '/' || professionals_online || '/' || families_total || '/' || families_online || '/' || institutions_total || '/' || institutions_online || '/' || completed_services FROM public.get_platform_counts()),
  '5/1/1/2/4/1/3/1/1');
SELECT public.t_eq('3.6 los contadores son públicos (anónimos incluidos)', public.t_anon('SELECT pro_available::text FROM public.get_live_counts()') || '|' || public.t_anon('SELECT professionals_total::text FROM public.get_platform_counts()'), '1|5');
SELECT public.t_eq('3.7 una presencia sin latido en 3 minutos no cuenta', (SELECT (SELECT fam_live FROM public.get_live_counts())::text || '/' || (SELECT count(*) FROM public.user_locations WHERE user_type = 'family' AND is_online)), '1/2');

-- ═══ 4) Profesionales en el mapa ══════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('4.1 una familia ve a los 4 profesionales publicados, en vivo primero (no el sin publicar ni el bloqueado)',
  public.t_val(:'f2', $q$SELECT string_agg(t.display_name, ',' ORDER BY t.ordinality) FROM public.map_professionals() WITH ORDINALITY AS t$q$), 'Laura P.,Marta R.,Rosa D.,Sofía C.');
SELECT public.t_eq('4.2 estados: disponible / ocupado (reserva) / ocupado (servicio en curso) / no disponible',
  public.t_val(:'f2', $q$SELECT string_agg(t.status, ',' ORDER BY t.ordinality) FROM public.map_professionals() WITH ORDINALITY AS t$q$), 'available,busy,busy,unavailable');
SELECT public.t_eq('4.3 «en vivo» sale de la presencia reciente (Rosa tiene una vieja: no cuenta)', public.t_val(:'f2', $q$SELECT string_agg(t.live::text, ',' ORDER BY t.ordinality) FROM public.map_professionals() WITH ORDINALITY AS t$q$), 'true,true,false,false');
SELECT public.t_eq('4.4 la posición compartida manda; si no, la sede aproximada',
  public.t_val(:'f2', $q$SELECT string_agg(t.display_name || '=' || COALESCE(t.lat::text, 'sin') || '/' || COALESCE(t.lng::text, 'sin'), ' ' ORDER BY t.ordinality) FROM public.map_professionals() WITH ORDINALITY AS t$q$),
  'Laura P.=4.5/-74.2 Marta R.=4.65/-74.05 Rosa D.=4.7/-74.1 Sofía C.=6.24/-75.58');
SELECT public.t_eq('4.5 sin teléfono, dirección ni nombre completo: solo lo del mapa',
  (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'map\_professionals%' ESCAPE '\' AND parameter_mode = 'OUT'),
  'pro_id,display_name,avatar_url,specialty,sub_specialties,gender,years_experience,hourly_rate,avg_rating,trust_score,rethus_verified,verified,home_city,lat,lng,status,live,last_seen');
SELECT public.t_eq('4.6 un anónimo ve lo mismo pero sin foto', public.t_anon($q$SELECT count(*)::text || '/' || count(t.avatar_url) FROM public.map_professionals() t$q$) || ' vs ' || public.t_val(:'f2', $q$SELECT count(*)::text || '/' || count(t.avatar_url) FROM public.map_professionals() t$q$), '4/0 vs 4/1');
SELECT public.t_eq('4.7 el radio filtra por cercanía (Bogotá sí, Medellín no)', public.t_val(:'i1', $q$SELECT string_agg(t.display_name, ',' ORDER BY t.display_name) FROM public.map_professionals(4.6097, -74.0817, 25) t$q$), 'Laura P.,Marta R.,Rosa D.');
SELECT public.t_eq('4.8 el límite se respeta', public.t_val(:'f2', 'SELECT count(*)::text FROM public.map_professionals(NULL, NULL, NULL, 2)'), '2');

-- ═══ 5) Demanda abierta en el mapa del profesional ════════════════════════════════════════════════════════════
SELECT public.t_eq('5.1 el profesional ve a la familia con oferta, a la institución y a la familia con horas; no a la que se ocultó ni a quien no tiene nada abierto',
  public.t_val(:'p1', $q$SELECT string_agg(t.display_name, ',' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$), 'Ana G.,Clínica Norte,Carlos R.');
SELECT public.t_eq('5.2 con su tipo, lo abierto y lo mejor pagado por hora',
  public.t_val(:'p1', $q$SELECT string_agg(t.poster_kind || ':' || t.open_offers || ':' || trim_scale(t.open_hours) || ':' || t.top_hourly, ' ' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$),
  'family:1:0:24000 institution:1:0:20000 family:0:1:18000');
SELECT public.t_eq('5.3 la posición de la oferta ya viene aproximada, nunca el punto exacto de la casa',
  public.t_val(:'p1', $q$SELECT string_agg(t.display_name || '=' || t.lat || '/' || t.lng, ' ' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$),
  'Ana G.=4.7/-74.03 Clínica Norte=4.65/-74.06 Carlos R.=4.61/-74.08');
SELECT public.t_eq('5.4 trae el Trust Score de quien publica', public.t_val(:'p1', $q$SELECT string_agg((t.trust_score IS NOT NULL)::text || '/' || t.trust_level, ',' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$), 'true/building,true/building,true/building');
SELECT public.t_eq('5.5 enlaza con la oferta cuando la hay', public.t_val(:'p1', $q$SELECT string_agg(COALESCE((t.offer_id = '$q$ || :'o_f1' || $q$')::text, 'sin') , ',' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$), 'true,false,sin');
SELECT public.t_eq('5.6 el radio filtra y marca la cercanía por rangos', public.t_val(:'p1', $q$SELECT string_agg(t.display_name || ':' || t.distance_band, ',' ORDER BY t.ordinality) FROM public.map_open_demand(4.6097, -74.0817, 8) WITH ORDINALITY AS t$q$), 'Carlos R.:2,Clínica Norte:10');
SELECT public.t_eq('5.7 no devuelve teléfono, dirección ni nombre del paciente',
  (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'map\_open\_demand%' ESCAPE '\' AND parameter_mode = 'OUT'),
  'poster_id,poster_kind,display_name,city,lat,lng,open_offers,open_hours,top_hourly,is_urgent,offer_id,trust_score,trust_level,trust_enough,distance_band');
SELECT public.t_eq('5.8 una familia no ve la demanda de otras', public.t_val(:'f2', 'SELECT count(*)::text FROM public.map_open_demand()'), '0');
SELECT public.t_eq('5.9 el personal sí la ve completa', public.t_val(:'sa', 'SELECT count(*)::text FROM public.map_open_demand()'), '3');
SELECT public.t_err('5.10 sin sesión no se llama', public.t_anon('SELECT count(*)::text FROM public.map_open_demand()'), 'permission denied');
SELECT public.t_val(:'f1', $q$UPDATE public.family_profiles SET visible_on_map = false WHERE user_id = auth.uid() RETURNING 'ok'$q$) AS r511 \gset
SELECT public.t_eq('5.11 la familia que se oculta sale del mapa', :'r511' || '|' ||
  public.t_val(:'p1', $q$SELECT string_agg(t.display_name, ',' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$), 'ok|Clínica Norte,Carlos R.');
SELECT public.t_val(:'f1', $q$UPDATE public.family_profiles SET visible_on_map = true WHERE user_id = auth.uid() RETURNING 'ok'$q$) AS r512 \gset
SELECT public.t_eq('5.12 y vuelve al mostrarse', :'r512' || '|' ||
  public.t_val(:'p1', $q$SELECT count(*)::text FROM public.map_open_demand()$q$), 'ok|3');
SELECT public.t_val(:'f1', format($q$UPDATE public.job_offers SET status = 'closed' WHERE id = %L RETURNING 'ok'$q$, :'o_f1')) AS r513 \gset
SELECT public.t_eq('5.13 al cerrar lo abierto, la familia deja de verse y de contarse', :'r513' || '|' ||
  public.t_val(:'p1', $q$SELECT string_agg(t.display_name, ',' ORDER BY t.ordinality) FROM public.map_open_demand() WITH ORDINALITY AS t$q$) || '|' || (SELECT fam_available::text FROM public.get_live_counts()), 'ok|Clínica Norte,Carlos R.|2');
UPDATE public.job_offers SET status = 'open' WHERE id = :'o_f1';

-- ═══ 6) Instituciones en el mapa ══════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('6.1 instituciones visibles con su estado (disponible / ocupada); la oculta no sale',
  public.t_val(:'f2', $q$SELECT string_agg(t.name || ':' || t.status, ',' ORDER BY t.name) FROM public.map_institutions() t$q$), 'Clínica Norte:available,Geriátrico Sol:busy');
SELECT public.t_eq('6.2 posición en cuadrícula de ~0,5 km, no la sede exacta', public.t_val(:'f2', $q$SELECT t.lat || '/' || t.lng FROM public.map_institutions() t WHERE t.name = 'Clínica Norte'$q$), '4.65/-74.065');
SELECT public.t_eq('6.3 con la cantidad de ofertas y si están en vivo', public.t_val(:'f2', $q$SELECT t.open_offers || '/' || t.live FROM public.map_institutions() t WHERE t.name = 'Clínica Norte'$q$), '1/true');
SELECT public.t_eq('6.4 también para anónimos', public.t_anon('SELECT count(*)::text FROM public.map_institutions()'), '2');

-- ═══ 7) Presencia: lectura, escritura y salida ════════════════════════════════════════════════════════════════
SELECT public.t_eq('7.1 cada cuenta lee solo su fila', public.t_val(:'p1', 'SELECT count(*)::text FROM public.user_locations') || '/' || public.t_val(:'f2', 'SELECT count(*)::text FROM public.user_locations'), '1/0');
SELECT public.t_eq('7.2 el personal lee todas', public.t_val(:'sa', 'SELECT count(*)::text FROM public.user_locations'), '7');
SELECT public.t_err('7.3 anónimo: sin acceso a la tabla', public.t_anon('SELECT count(*)::text FROM public.user_locations'), 'permission denied');
SELECT public.t_err('7.4 nadie escribe directo (insertar)', public.t_val(:'p2', $q$INSERT INTO public.user_locations(user_id, user_type, lat, lng) VALUES (auth.uid(), 'professional', 4.6, -74.0) RETURNING 'x'$q$), 'permission denied');
SELECT public.t_err('7.5 nadie escribe directo (actualizar la propia)', public.t_val(:'p1', $q$UPDATE public.user_locations SET lat = 4.123456 WHERE user_id = auth.uid() RETURNING 'x'$q$), 'permission denied');
SELECT count(*) AS ping_s0 FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.stop_presence()) s$q$) AS r76 \gset
SELECT public.t_eq('7.6 la salida borra la posición y marca fuera de línea', :'r76' || '|' ||
  (SELECT is_online::text || '/' || COALESCE(lat::text, 'sin') FROM public.user_locations WHERE user_id = :'p1'), 'ok|false/sin');
SELECT public.t_eq('7.6b y avisa al mapa una vez', ((SELECT count(*) FROM public._realtime_log WHERE topic = 'live_map_ping') - :ping_s0)::text, '1');
SELECT public.t_eq('7.7 y el mapa vuelve a su sede aproximada, ya sin «en vivo»', public.t_val(:'f2', $q$SELECT t.live || '/' || t.lat FROM public.map_professionals() t WHERE t.display_name = 'Laura P.'$q$), 'false/4.61');
SELECT public.t_eq('7.8 los contadores bajan', (SELECT pro_live::text FROM public.get_live_counts()), '1');
SELECT count(*) AS ping3 FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.stop_presence()) s$q$) AS _stop2 \gset
SELECT public.t_eq('7.9 irse dos veces no repite el aviso', (SELECT count(*)::text FROM public._realtime_log WHERE topic = 'live_map_ping'), :'ping3');
SELECT public.t_err('7.10 sin sesión no se llama stop_presence', public.t_anon($q$SELECT 'ok' FROM (SELECT public.stop_presence()) s$q$), 'permission denied');

-- ═══ 8) Avisos en vivo ════════════════════════════════════════════════════════════════════════════════════════
SELECT count(*) AS ping_a FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
UPDATE public.professional_profiles SET available = false WHERE user_id = :'p1';
SELECT count(*) AS ping_b FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
UPDATE public.professional_profiles SET available = true WHERE user_id = :'p1';
UPDATE public.professional_profiles SET bio = 'otra cosa' WHERE user_id = :'p1';
SELECT count(*) AS ping_c FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
SELECT public.t_eq('8.1 cambiar la disponibilidad avisa al mapa (una vez por sentencia)', (:ping_b - :ping_a)::text, '1');
SELECT public.t_eq('8.2 volver a disponible avisa; cambiar la biografía no', (:ping_c - :ping_b)::text, '1');
SELECT count(*) AS ping_d FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status)
VALUES (:'f4', 'family', 'Cuidado diurno', 'Acompañamiento de enfermería a domicilio', 'hour', 22000, 'Bogotá', 'open') RETURNING id AS o_f4 \gset
SELECT public.t_true('8.3 publicar una oferta avisa al mapa', (SELECT count(*) FROM public._realtime_log WHERE topic = 'live_map_ping') > :ping_d);
SELECT count(*) AS ping_e FROM public._realtime_log WHERE topic = 'live_map_ping' \gset
UPDATE public.service_bookings SET status = 'completed' WHERE client_id = :'f4' AND status = 'in_progress';
SELECT public.t_true('8.4 terminar un servicio avisa al mapa', (SELECT count(*) FROM public._realtime_log WHERE topic = 'live_map_ping') > :ping_e);
SELECT public.t_eq('8.5 y el contador de ocupados se actualiza (Rosa quedó libre)', (SELECT pro_busy::text || '/' || pro_available FROM public.get_live_counts()), '1/2');
SELECT public.t_true('8.6 el aviso está en las siete tablas', (SELECT count(DISTINCT c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'trg_map_ping' AND NOT t.tgisinternal) = 7);
SELECT public.t_true('8.7 la política de Realtime deja escuchar solo ese tema a las cuentas con sesión',
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname = 'live_map_ping_for_authenticated' AND roles = '{authenticated}' AND qual LIKE '%live_map_ping%'));
ALTER FUNCTION realtime.send(jsonb, text, text, boolean) RENAME TO send_off;
SELECT public.t_run(NULL, 'postgres', $q$SELECT 'ok' FROM (SELECT public.hx_ping_map()) s$q$) AS r88 \gset
UPDATE public.professional_profiles SET available = available WHERE user_id = :'p1';
ALTER FUNCTION realtime.send_off(jsonb, text, text, boolean) RENAME TO send;
SELECT public.t_eq('8.8 si Realtime falla, el aviso no rompe nada (ni la sentencia que lo dispara)', :'r88', 'ok');

-- ═══ 9) Permisos ══════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('9.1 las funciones internas no las llama nadie desde la API', NOT has_function_privilege('authenticated', 'public.hx_ping_map()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hx_ping_map()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.trg_ping_map()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hx_cell(double precision,numeric)', 'EXECUTE'));
SELECT public.t_true('9.2 presencia y demanda: solo con sesión', has_function_privilege('authenticated', 'public.touch_presence(double precision,double precision)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.touch_presence(double precision,double precision)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.stop_presence()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.stop_presence()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.map_open_demand(double precision,double precision,double precision,integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.map_open_demand(double precision,double precision,double precision,integer)', 'EXECUTE'));
SELECT public.t_true('9.3 contadores y mapa público: también anónimos', has_function_privilege('anon', 'public.get_live_counts()', 'EXECUTE') AND has_function_privilege('anon', 'public.get_platform_counts()', 'EXECUTE')
  AND has_function_privilege('anon', 'public.map_professionals(double precision,double precision,double precision,integer)', 'EXECUTE') AND has_function_privilege('anon', 'public.map_institutions(integer)', 'EXECUTE'));
SELECT public.t_true('9.4 son SECURITY DEFINER con search_path fijo', (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public%') FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('touch_presence','stop_presence','map_professionals','map_open_demand','map_institutions','get_live_counts','get_platform_counts','hx_ping_map','trg_ping_map')));

-- ═══ 10) Segunda pasada ═══════════════════════════════════════════════════════════════════════════════════════
SELECT (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('touch_presence','stop_presence','map_professionals','map_open_demand','map_institutions','get_live_counts','get_platform_counts','hx_ping_map','trg_ping_map','hx_cell','hx_presence_ttl')) AS sig_fn,
       (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename IN ('user_locations', 'messages') AND schemaname IN ('public', 'realtime')) AS sig_pol,
       (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.user_locations'::regclass) AS sig_acl,
       (SELECT md5(string_agg(c.relname || t.tgname, '|' ORDER BY c.relname)) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'trg_map_ping' AND NOT t.tgisinternal) AS sig_trg \gset
\i :MIG
SELECT public.t_eq('10.1 la segunda pasada no cambia las funciones ni sus permisos', (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('touch_presence','stop_presence','map_professionals','map_open_demand','map_institutions','get_live_counts','get_platform_counts','hx_ping_map','trg_ping_map','hx_cell','hx_presence_ttl')), :'sig_fn');
SELECT public.t_eq('10.2 ni las políticas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename IN ('user_locations', 'messages') AND schemaname IN ('public', 'realtime')), :'sig_pol');
SELECT public.t_eq('10.3 ni los privilegios de la tabla', (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.user_locations'::regclass), :'sig_acl');
SELECT public.t_eq('10.4 ni los disparadores', (SELECT md5(string_agg(c.relname || t.tgname, '|' ORDER BY c.relname)) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'trg_map_ping' AND NOT t.tgisinternal), :'sig_trg');
SELECT public.t_eq('10.5 ni los datos de presencia', (SELECT count(*)::text FROM public.user_locations), '7');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
