-- Escenario — Directorio público de profesionales (public_professionals). Sobre la réplica de producción con la moderación, las ofertas,
-- las PQRS y los mapas en vivo ya aplicados, como hoy en producción.
-- Variables: MIG (20261013100000_public_professionals.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

\set p3 '00000000-0000-0000-0000-0000000000a3'
\set p4 '00000000-0000-0000-0000-0000000000a4'
\set p5 '00000000-0000-0000-0000-0000000000a5'
\set p6 '00000000-0000-0000-0000-0000000000a6'
\set p7 '00000000-0000-0000-0000-0000000000a7'
\set f9 '00000000-0000-0000-0000-0000000000f9'

INSERT INTO auth.users(id, email) VALUES (:'p3','p3@t.co'),(:'p4','p4@t.co'),(:'p5','p5@t.co'),(:'p6','p6@t.co'),(:'p7','p7@t.co'),(:'f9','f9@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'p3','professional'),(:'p4','professional'),(:'p5','professional'),(:'p6','professional'),(:'p7','professional'),(:'f9','family');

-- Producción hoy: las vistas del directorio (security_invoker, parten de user_roles / profiles; la réplica base es anterior a ellas).
-- Versión reducida con la misma estructura FROM/JOIN/WHERE que la real, para comprobar que a otra cuenta le salen vacías.
CREATE VIEW public.public_professionals_safe WITH (security_invoker = true) AS
 SELECT ur.user_id, pp.specialty, pp.avg_rating, COALESCE(pr.full_name, 'Profesional') AS full_name, pr.phone
   FROM public.user_roles ur
   LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
   LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
  WHERE ur.role = 'professional'::public.app_role AND COALESCE(pp.active, true) IS NOT FALSE;
GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;
CREATE VIEW public.public_profiles_safe WITH (security_invoker = true) AS
 SELECT p.user_id, p.full_name, p.city, p.avatar_url, p.bio
   FROM public.profiles p JOIN public.professional_profiles pp ON pp.user_id = p.user_id
  WHERE pp.published = true AND pp.active = true AND COALESCE(pp.blocked, false) = false;
GRANT SELECT ON public.public_profiles_safe TO anon, authenticated;

-- Escena (con los disparadores de guarda apagados: solo para armarla).
SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city, phone, avatar_url) VALUES
  (:'p1','Laura Pérez','Bogotá','3001111111','https://x.test/p1.png'),
  (:'p2','Sofía Cano','Medellín','3002222222',NULL),
  (:'p3','Marta Ruiz','Bogotá','3003333333',NULL),
  (:'p4','Beatriz Núñez','Bogotá','3004444444',NULL),
  (:'p5','Elena Mora','Bogotá','3005555555',NULL),
  (:'p6','Rosa Díaz','Bogotá','3006666666',NULL),
  (:'f1','Ana Gómez','Bogotá','3101111111',NULL),
  (:'f2','Carlos Rey','Bogotá','3102222222',NULL);
INSERT INTO public.professional_profiles(user_id, specialty, sub_specialties, gender, years_experience, rethus_number, rethus_verified, verified,
    hourly_rate, shift_rate, monthly_rate, avg_rating, total_jobs, trust_score, service_cities, home_city, lat, lng,
    published, active, available, blocked, reserved_until, avatar_url, bio, ai_summary, languages) VALUES
  (:'p1','Enfermería','{geriatría,heridas}','F',6,'RH-1001',true, true, 25000,160000,4800000,4.80,12,82,'{Bogotá,Soacha}','Bogotá',   4.60971,-74.08175,true, true, true,  false,NULL,                       'https://x.test/p1.png','Enfermera con experiencia en geriatría','Perfil sólido','{es,en}'),
  (:'p2','Fisioterapia',NULL,'F',3,NULL,    false,false,22000,NULL,NULL,   4.20, 3,64,'{Medellín}',     'Medellín', 6.2442,  -75.5812, true, true, false, false,NULL,                       NULL,                   NULL,'Rehabilitación domiciliaria','{es}'),
  (:'p3','Cuidado',NULL,'F',4,NULL,         false,false,18000,NULL,NULL,   4.50, 5,70,'{bogotá}',      NULL,       4.65,    -74.05,   true, true, true,  false,now() + interval '1 hour', NULL,                   NULL,NULL,'{es}'),
  (:'p4','Auxiliar',NULL,'F',1,NULL,        false,false,15000,NULL,NULL,   0,    0, 0,'{Bogotá}',      'Bogotá',   4.66,    -74.06,   false,true, true,  false,NULL,                       NULL,                   NULL,NULL,'{es}'),
  (:'p5','Enfermería',NULL,'F',2,NULL,      false,false,20000,NULL,NULL,   3.9,  1,50,'{Bogotá}',      'Bogotá',   4.67,    -74.07,   true, true, true,  true, NULL,                       NULL,                   NULL,NULL,'{es}'),
  (:'p6','Terapia',NULL,'F',2,NULL,         false,false,21000,NULL,NULL,   4.1,  2,60,'{Bogotá}',      'Bogotá',   4.70,    -74.10,   true, false,true,  false,NULL,                       NULL,                   NULL,NULL,'{es}'),
  -- Una familia con un perfil profesional viejo (sin rol de profesional): no es un profesional.
  (:'f2','Enfermería',NULL,'M',2,NULL,      false,false,19000,NULL,NULL,   4.95,  9,90,'{Bogotá}',      'Bogotá',   4.70,    -74.03,   true, true, true,  false,NULL,                       NULL,                   NULL,NULL,'{es}');
SET session_replication_role = origin;
-- p7: profesional publicado sin fila en profiles (sin nombre)
SET session_replication_role = replica;
INSERT INTO public.professional_profiles(user_id, specialty, hourly_rate, avg_rating, trust_score, service_cities, home_city, published, active, available, blocked)
VALUES (:'p7','Terapia',17000,3.0,40,'{}','Cali',true,true,true,false);
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f1', :'p2', 'in_progress', now() - interval '1 hour', 4, 20000, 80000);
SET session_replication_role = origin;
-- p1 comparte su presencia (en vivo); p3 también, pero hace diez minutos (ya no cuenta como en vivo)
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.60971, -74.08175)) s$q$) AS _p1 \gset
SELECT public.t_val(:'p3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _p3 \gset
UPDATE public.user_locations SET last_seen = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' WHERE user_id = :'p3';

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('0.1 antes: el directorio sale vacío para una familia (la vista parte de user_roles)', public.t_val(:'f9', 'SELECT count(*)::text FROM public.public_professionals_safe'), '0');
SELECT public.t_eq('0.2 antes: y para los nombres (public_profiles_safe parte de profiles; solo se ve a quien ya se contrató)', public.t_val(:'f9', 'SELECT count(*)::text FROM public.public_profiles_safe'), '0');
SELECT public.t_eq('0.3 antes: el personal sí los ve', public.t_val(:'sa', 'SELECT (count(*) > 0)::text FROM public.public_professionals_safe'), 'true');
SELECT public.t_true('0.4 antes: no existe la función', to_regprocedure('public.public_professionals(uuid[],text,text,boolean,integer,integer,numeric,integer)') IS NULL);

\i :MIG

-- ═══ 1) Quién aparece ═════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('1.1 una familia ve a los profesionales publicados, activos y no bloqueados, mejor calificados primero (no el sin publicar, el bloqueado, el inactivo ni la familia con perfil viejo)',
  public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.ordinality) FROM public.public_professionals() WITH ORDINALITY AS t$q$), 'Laura Pérez,Marta Ruiz,Sofía Cano,Profesional');
SELECT public.t_eq('1.2 una institución ve lo mismo', public.t_val(:'i1', 'SELECT count(*)::text FROM public.public_professionals()'), '4');
SELECT public.t_eq('1.3 un visitante sin sesión también, con el nombre abreviado',
  public.t_anon($q$SELECT string_agg(t.full_name, ',' ORDER BY t.ordinality) FROM public.public_professionals() WITH ORDINALITY AS t$q$), 'Laura P.,Marta R.,Sofía C.,Profesional');
SELECT public.t_eq('1.4 el profesional sin nombre en su perfil sale como «Profesional»', public.t_val(:'f1', format($q$SELECT t.full_name FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p7')), 'Profesional');

-- ═══ 2) Qué datos viajan ══════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('2.1 sin teléfono ni coordenadas exactas: solo las columnas del directorio',
  (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'public\_professionals%' ESCAPE '\' AND parameter_mode = 'OUT'),
  'user_id,full_name,avatar_url,specialty,sub_specialties,gender,years_experience,home_city,service_cities,hourly_rate,shift_rate,monthly_rate,avg_rating,total_jobs,trust_score,verified,rethus_verified,rethus_number,ai_summary,ai_strengths,certifications,work_experience,languages,availability,bio,available,availability_status,reserved_until,active,published,lat,lng,live');
SELECT public.t_eq('2.2 la posición viene en cuadrícula de ~1 km, nunca el punto exacto',
  public.t_val(:'f1', $q$SELECT string_agg(t.full_name || '=' || COALESCE(t.lat::text, 'sin') || '/' || COALESCE(t.lng::text, 'sin'), ' ' ORDER BY t.ordinality) FROM public.public_professionals() WITH ORDINALITY AS t WHERE t.full_name <> 'Profesional'$q$),
  'Laura Pérez=4.61/-74.08 Marta Ruiz=4.65/-74.05 Sofía Cano=6.24/-75.58');
SELECT public.t_eq('2.3 la foto y el número de RETHUS solo con sesión: el visitante no los ve',
  public.t_anon($q$SELECT count(t.avatar_url)::text || '/' || count(t.rethus_number) FROM public.public_professionals() t$q$) || ' vs ' ||
  public.t_val(:'f1', $q$SELECT count(t.avatar_url)::text || '/' || count(t.rethus_number) FROM public.public_professionals() t$q$), '0/0 vs 1/1');
SELECT public.t_eq('2.4 trae lo que muestra el perfil: tarifas, calificación, confianza, verificación, ciudades',
  public.t_val(:'f1', format($q$SELECT t.specialty || '|' || t.hourly_rate || '|' || t.shift_rate || '|' || t.monthly_rate || '|' || t.avg_rating || '|' || t.total_jobs || '|' || t.trust_score || '|' || t.verified || '|' || t.rethus_verified || '|' || t.rethus_number || '|' || array_to_string(t.service_cities, '+') || '|' || t.years_experience
      FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p1')),
  'Enfermería|25000|160000|4800000|4.80|12|82|true|true|RH-1001|Bogotá+Soacha|6');
SELECT public.t_eq('2.5 estado: disponible / ocupado por reserva / ocupado por servicio en curso',
  public.t_val(:'f1', $q$SELECT string_agg(t.full_name || ':' || t.availability_status || ':' || t.available, ' ' ORDER BY t.ordinality) FROM public.public_professionals() WITH ORDINALITY AS t WHERE t.full_name <> 'Profesional'$q$),
  'Laura Pérez:available:true Marta Ruiz:busy:true Sofía Cano:busy:false');
SELECT public.t_eq('2.6 «en vivo» sale de la presencia reciente', public.t_val(:'f1', $q$SELECT string_agg(t.full_name || ':' || t.live, ' ' ORDER BY t.ordinality) FROM public.public_professionals() WITH ORDINALITY AS t WHERE t.full_name <> 'Profesional'$q$),
  'Laura Pérez:true Marta Ruiz:false Sofía Cano:false');

-- ═══ 3) Filtros en el servidor ════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('3.1 especialidad (sin importar mayúsculas)', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(p_specialty := 'enferm') t$q$), 'Laura Pérez');
SELECT public.t_eq('3.2 ciudad de servicio (sin importar mayúsculas ni tildes de la lista)', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(p_city := 'Bogotá') t$q$), 'Laura Pérez,Marta Ruiz');
SELECT public.t_eq('3.3 ciudad base cuando no hay lista de ciudades', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(p_city := 'Medellín') t$q$), 'Sofía Cano');
SELECT public.t_eq('3.4 solo verificados', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',') FROM public.public_professionals(p_verified := true) t$q$), 'Laura Pérez');
SELECT public.t_eq('3.5 verificado = falso no filtra (es «sin restricción»)', public.t_val(:'f1', 'SELECT count(*)::text FROM public.public_professionals(p_verified := false)'), '4');
SELECT public.t_eq('3.6 tarifa por hora mínima y máxima', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(p_min_rate := 18000, p_max_rate := 22000) t$q$), 'Marta Ruiz,Sofía Cano');
SELECT public.t_eq('3.7 calificación mínima', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(p_min_rating := 4.5) t$q$), 'Laura Pérez,Marta Ruiz');
SELECT public.t_eq('3.8 por id', public.t_val(:'f1', format($q$SELECT string_agg(t.full_name, ',' ORDER BY t.full_name) FROM public.public_professionals(ARRAY[%L::uuid, %L::uuid, %L::uuid]) t$q$, :'p1', :'p2', :'p4')), 'Laura Pérez,Sofía Cano');
SELECT public.t_eq('3.9 el límite se respeta', public.t_val(:'f1', 'SELECT count(*)::text FROM public.public_professionals(p_limit := 2)'), '2');
SELECT public.t_eq('3.10 pedir más ids que el límite devuelve todos los publicados pedidos', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid, %L::uuid, %L::uuid, %L::uuid], p_limit := 1) t$q$, :'p1', :'p2', :'p3', :'p7')), '4');
SELECT public.t_eq('3.12 una ciudad que solo está como ciudad base (sin lista de ciudades de servicio)', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',') FROM public.public_professionals(p_city := 'cali') t$q$), 'Profesional');
SELECT public.t_eq('3.11 los filtros se combinan', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',') FROM public.public_professionals(p_city := 'Bogotá', p_min_rating := 4.6, p_verified := true) t$q$), 'Laura Pérez');

-- ═══ 4) Lo no publicado, el dueño y el personal ═══════════════════════════════════════════════════════════════
SELECT public.t_eq('4.1 un perfil sin publicar no se ve por id para otra familia', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p4')), '0');
SELECT public.t_eq('4.2 ni uno bloqueado', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p5')), '0');
SELECT public.t_eq('4.3 ni uno inactivo', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p6')), '0');
SELECT public.t_eq('4.4 el dueño ve su propio perfil sin publicar por id', public.t_val(:'p4', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p4')), '1');
SELECT public.t_eq('4.5 el personal ve lo no publicado y lo bloqueado por id', public.t_val(:'sa', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid, %L::uuid, %L::uuid]) t$q$, :'p4', :'p5', :'p6')), '3');
SELECT public.t_eq('4.6 pero en la lista general ni el personal ve lo no publicado', public.t_val(:'sa', 'SELECT count(*)::text FROM public.public_professionals()'), '4');
SELECT public.t_eq('4.7 otro profesional no ve el perfil sin publicar del compañero', public.t_val(:'p1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p4')), '0');
SELECT public.t_eq('4.8 quien no tiene el rol de profesional no aparece aunque conserve un perfil viejo (ni por id)', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'f2')), '0');
UPDATE public.user_roles SET role = 'family' WHERE user_id = :'p3';
SELECT public.t_eq('4.9 si deja de ser profesional, desaparece del directorio', public.t_val(:'f1', format($q$SELECT count(*)::text FROM public.public_professionals(ARRAY[%L::uuid]) t$q$, :'p3')), '0');
UPDATE public.user_roles SET role = 'professional' WHERE user_id = :'p3';

-- ═══ 5) Permisos ══════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('5.1 pueden llamarla visitantes y cuentas con sesión', has_function_privilege('anon', 'public.public_professionals(uuid[],text,text,boolean,integer,integer,numeric,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.public_professionals(uuid[],text,text,boolean,integer,integer,numeric,integer)', 'EXECUTE'));
SELECT public.t_true('5.2 es SECURITY DEFINER con search_path fijo', (SELECT p.prosecdef AND p.proconfig::text LIKE '%search_path=public%' FROM pg_proc p WHERE p.proname = 'public_professionals'));
SELECT public.t_true('5.4 PUBLIC no conserva la ejecución (solo los dos roles de la API)', (SELECT COALESCE(p.proacl::text, '') NOT LIKE '%,=X/%' AND COALESCE(p.proacl::text, '') NOT LIKE '{=X/%' FROM pg_proc p WHERE p.proname = 'public_professionals'));
SELECT public.t_eq('5.3 no cambia la tabla de profesionales ni sus políticas', (SELECT count(*)::text FROM pg_policies WHERE tablename = 'professional_profiles'), (SELECT count(*)::text FROM pg_policies WHERE tablename = 'professional_profiles'));

-- ═══ 6) Segunda pasada ════════════════════════════════════════════════════════════════════════════════════════
SELECT (SELECT md5(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, '')) FROM pg_proc p WHERE p.proname = 'public_professionals') AS sig \gset
\i :MIG
SELECT public.t_eq('6.1 la segunda pasada no cambia la función ni sus permisos', (SELECT md5(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, '')) FROM pg_proc p WHERE p.proname = 'public_professionals'), :'sig');
SELECT public.t_eq('6.2 y sigue devolviendo lo mismo', public.t_val(:'f1', 'SELECT count(*)::text FROM public.public_professionals()'), '4');

-- ═══ 7) Tope de filas ════════════════════════════════════════════════════════════════════════════════════════
SET session_replication_role = replica;
INSERT INTO public.user_roles(user_id, role) SELECT gen_random_uuid(), 'professional' FROM generate_series(1, 520);
INSERT INTO public.professional_profiles(user_id, specialty, hourly_rate, avg_rating, published, active, available, blocked)
  SELECT ur.user_id, 'Cuidado', 15000, 1, true, true, true, false FROM public.user_roles ur WHERE ur.role = 'professional' AND NOT EXISTS (SELECT 1 FROM public.professional_profiles x WHERE x.user_id = ur.user_id);
SET session_replication_role = origin;
SELECT public.t_eq('7.1 una lista nunca pasa de 500 filas, pida lo que pida', public.t_val(:'f1', 'SELECT count(*)::text FROM public.public_professionals(p_limit := 100000)'), '500');
SELECT public.t_eq('7.2 y con el límite por defecto, 60', public.t_val(:'f1', 'SELECT count(*)::text FROM public.public_professionals()'), '60');
SELECT public.t_eq('7.3 los mejores calificados siguen primero', public.t_val(:'f1', $q$SELECT string_agg(t.full_name, ',' ORDER BY t.ordinality) FROM (SELECT * FROM public.public_professionals(p_limit := 3) WITH ORDINALITY) t$q$), 'Laura Pérez,Marta Ruiz,Sofía Cano');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
