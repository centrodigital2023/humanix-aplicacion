-- Escenario — Panel del profesional: «Mi oferta de servicio» y ofertas de familias con el estado de la negociación. Sobre la réplica de
-- producción con la moderación, las ofertas, las PQRS, los mapas en vivo y el directorio ya aplicados, como hoy en producción.
-- Variables: MIG (20261013110000_professional_panel.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

-- Ejecuta una sentencia SIN devolver filas (una inserción con RETURNING también pasa por la política de lectura; la «a ciegas» no).
CREATE FUNCTION public.t_exec(u uuid, r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt; v_res := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

\set p3 '00000000-0000-0000-0000-0000000000a3'
\set p4 '00000000-0000-0000-0000-0000000000a4'
\set p5 '00000000-0000-0000-0000-0000000000a5'

INSERT INTO auth.users(id, email) VALUES (:'p3','p3@t.co'),(:'p4','p4@t.co'),(:'p5','p5@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES (:'p3','professional'),(:'p4','professional'),(:'p5','professional');

-- Escena (con los disparadores de guarda apagados: solo para armarla).
SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city, phone, avatar_url) VALUES
  (:'p1','Laura Pérez','Bogotá','3001111111','https://x.test/p1.png'),
  (:'p2','Sofía Cano','Medellín','3002222222',NULL),
  (:'p3','Marta Ruiz','Bogotá','3003333333',NULL),
  (:'p4','Beatriz Núñez','Bogotá','3004444444',NULL),
  (:'p5','Elena Mora','Bogotá','3005555555',NULL),
  (:'f1','Ana Gómez','Bogotá','3101111111',NULL),
  (:'f2','Carlos Rey','Bogotá','3102222222',NULL),
  (:'i1','Clínica Norte','Bogotá','6011111111',NULL);
INSERT INTO public.professional_profiles(user_id, specialty, years_experience, rethus_verified, verified, hourly_rate, avg_rating, total_jobs, trust_score,
    service_cities, home_city, lat, lng, published, active, available, blocked, reserved_until) VALUES
  (:'p1','Enfermería',6,true, true, 25000,4.80,12,82,'{Bogotá}','Bogotá',   4.60971,-74.08175,true, true, true, false,NULL),
  (:'p2','Fisioterapia',3,false,false,22000,4.20, 3,64,'{Medellín}','Medellín',6.2442,-75.5812,true, true, false,false,NULL),
  (:'p3','Cuidado',4,false,false,18000,4.50, 5,70,'{Bogotá}','Bogotá',   4.65,   -74.05,   true, true, true, false,now() + interval '1 hour'),
  (:'p4','Auxiliar',1,false,false,15000,0,   0, 0,'{Bogotá}','Bogotá',   4.66,   -74.06,   false,true, true, false,NULL),
  (:'p5','Enfermería',2,false,false,20000,3.9,1,50,'{Bogotá}','Bogotá',   4.67,   -74.07,   true, true, true, false,NULL);
INSERT INTO public.family_profiles(user_id, default_lat, default_lng) VALUES (:'f1', 4.7001, -74.0301)
  ON CONFLICT (user_id) DO UPDATE SET default_lat = 4.7001, default_lng = -74.0301;
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, city, lat, lng, verified, visible_on_map)
  VALUES (:'i1', 'Clínica Norte', 'clinica', 'Bogotá', 4.66, -74.04, true, true)
  ON CONFLICT (user_id) DO UPDATE SET lat = 4.66, lng = -74.04;
SET session_replication_role = origin;

-- ═══ A) Ofertas de las familias para el profesional (v2) ═══════════════════════════════════════════════════════
SELECT public.t_true('A.0 antes: la lista no trae «urgente» ni el estado de la negociación', NOT EXISTS (
  SELECT 1 FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'list\_open\_family\_offers%' ESCAPE '\' AND parameter_name IN ('is_urgent','my_awaiting','my_amount')));

INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, lat, lng, status, is_urgent)
VALUES (:'f1', 'family', 'Cuidado de adulto mayor', 'Acompañamiento diurno de enfermería', 'hour', 24000, 'Bogotá', 4.70012, -74.03011, 'open', true) RETURNING id AS fo1 \gset
INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status)
VALUES (:'f2', 'family', 'Cuidado nocturno', 'Cuidado de paciente postoperatorio', 'shift', 160000, 'Bogotá', 'open') RETURNING id AS fo2 \gset
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'p1', 'essential_monthly', 'active', now() + interval '20 days');

\i :MIG

SELECT public.t_eq('A.1 ahora trae urgente, a quién le toca y el valor propuesto (columnas nuevas)',
  (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FILTER (WHERE parameter_name IN ('is_urgent','my_awaiting','my_amount')) FROM information_schema.parameters
    WHERE specific_schema = 'public' AND specific_name LIKE 'list\_open\_family\_offers%' ESCAPE '\' AND parameter_mode = 'OUT'), 'is_urgent,my_awaiting,my_amount');
SELECT public.t_eq('A.2 el profesional ve las ofertas abiertas de las familias con urgencia, Trust Score y cercanía',
  public.t_val(:'p1', $q$SELECT string_agg(t.display_name || ':' || t.is_urgent || ':' || (t.family_trust IS NOT NULL) || ':' || COALESCE(t.distance_band_km::text, 'sin'), ' ' ORDER BY t.title) FROM public.list_open_family_offers() t$q$),
  'Ana G.:true:true:20 Carlos R.:false:true:sin');
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_offer(%L::uuid, 26000, 'Hola, tengo experiencia')$q$, :'fo1')) AS app1 \gset
SELECT public.t_eq('A.3 antes de postularse no hay estado de negociación',
  public.t_val(:'p1', format($q$SELECT COALESCE(t.my_status, 'sin') || '/' || COALESCE(t.my_awaiting, 'sin') || '/' || COALESCE(t.my_amount::text, 'sin') FROM public.list_open_family_offers() t WHERE t.offer_id = %L$q$, :'fo2')), 'sin/sin/sin');
SELECT public.t_eq('A.4 tras postularse con su valor: pendiente, le toca a la familia y el valor que propuso',
  public.t_val(:'p1', format($q$SELECT t.my_status || '/' || t.my_awaiting || '/' || t.my_amount FROM public.list_open_family_offers() t WHERE t.offer_id = %L$q$, :'fo1')), 'pending/institution/26000');
SELECT public.t_err('A.5 una familia no ve las ofertas de otras', public.t_val(:'f2', 'SELECT count(*)::text FROM public.list_open_family_offers()'), 'Solo los profesionales');
SELECT public.t_err('A.6 un visitante tampoco', public.t_anon('SELECT count(*)::text FROM public.list_open_family_offers()'), 'permission denied');
SELECT public.t_true('A.7 permisos: solo cuentas con sesión', has_function_privilege('authenticated', 'public.list_open_family_offers(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.list_open_family_offers(integer)', 'EXECUTE'));

-- ═══ B) Mi oferta de servicio: la tabla ═══════════════════════════════════════════════════════════════════════
SELECT public.t_true('B.1 existe con RLS', to_regclass('public.professional_service_offers') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.professional_service_offers'::regclass));
SELECT public.t_true('B.2 anon sin ningún privilegio; authenticated solo lee, inserta, actualiza y borra (sin TRUNCATE)',
  NOT has_table_privilege('anon', 'public.professional_service_offers', 'SELECT') AND NOT has_table_privilege('anon', 'public.professional_service_offers', 'INSERT')
  AND has_table_privilege('authenticated', 'public.professional_service_offers', 'SELECT') AND has_table_privilege('authenticated', 'public.professional_service_offers', 'INSERT')
  AND has_table_privilege('authenticated', 'public.professional_service_offers', 'UPDATE') AND has_table_privilege('authenticated', 'public.professional_service_offers', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.professional_service_offers', 'TRUNCATE'));
SELECT public.t_eq('B.3 las cinco políticas', (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'professional_service_offers'),
  'pso_delete_owner,pso_insert_owner,pso_select_owner_or_staff,pso_staff_all,pso_update_owner');

-- Publicar (como cada profesional, con su sesión)
SELECT public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera profesional para cuidado domiciliario', 'Cuidado de adultos mayores, curaciones y acompañamiento en casa', 'Enfermería', 'hour', 28000, 'Bogotá') RETURNING id$q$) AS so1 \gset
SELECT public.t_true('B.4 el profesional publica su oferta', :'so1' ~ '^[0-9a-f-]{36}$');
SELECT public.t_val(:'p2', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Fisioterapia a domicilio', 'Rehabilitación y terapia respiratoria para pacientes en casa', 'Fisioterapia', 'hour', 22000, 'Medellín') RETURNING id$q$) AS so2 \gset
SELECT public.t_val(:'p3', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Cuidadora con experiencia', 'Cuidado de pacientes y acompañamiento nocturno', 'Cuidado', 'shift', 120000, 'Bogotá') RETURNING id$q$) AS so3 \gset
SELECT public.t_val(:'p4', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Auxiliar de enfermería disponible', 'Cuidado de pacientes en casa', 'Auxiliar', 'hour', 15000, 'Bogotá') RETURNING id$q$) AS so4 \gset
SELECT public.t_val(:'p5', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera para turnos de cuidado', 'Cuidado y curaciones a domicilio', 'Enfermería', 'hour', 20000, 'Bogotá') RETURNING id$q$) AS so5 \gset
SELECT public.t_val(:'p5', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera con turnos de cuidado', 'Cuidado y curaciones a domicilio', 'Enfermería', 'hour', 21000, 'Bogotá') RETURNING id$q$) AS so5b \gset
SELECT count(*) AS n_antes FROM public.professional_service_offers \gset
SELECT public.t_err('B.5 una familia no puede publicar una oferta de servicio (inserción a ciegas)', public.t_exec(:'f1', 'authenticated', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Cuidado de pacientes en casa', 'Enfermería', 'Enfermería', 'hour', 20000, 'Bogotá')$q$), 'row-level security');
SELECT public.t_err('B.6 nadie publica a nombre de otro profesional (inserción a ciegas)', public.t_exec(:'p2', 'authenticated', format($q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (%L::uuid, 'Fisioterapia a domicilio', 'Rehabilitación', 'Fisioterapia', 'hour', 22000, 'Medellín')$q$, :'p1')), 'row-level security');
SELECT public.t_eq('B.6b y no queda ninguna fila nueva', (SELECT count(*) - :n_antes FROM public.professional_service_offers)::text, '0');
SELECT public.t_err('B.7 un visitante no escribe', public.t_anon($q$INSERT INTO public.professional_service_offers(professional_id, title, modality, amount, city) VALUES (gen_random_uuid(), 'Enfermera domiciliaria', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'permission denied');

-- ═══ C) Moderación en el servidor ═════════════════════════════════════════════════════════════════════════════
SELECT public.t_err('C.1 lenguaje ofensivo', public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera para cuidado, no se aceptan pendejos', 'Cuidado de pacientes', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'lenguaje ofensivo');
SELECT public.t_err('C.2 venta de artículos', public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Vendo ropa y artículos usados', 'Cuidado y envío gratis', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'no se venden, compran ni arriendan');
SELECT public.t_err('C.3 ajeno a la salud y el cuidado', public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Clases de guitarra y canto', 'Aprende rápido con un profesor experimentado', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'no parece de salud o cuidado');
SELECT public.t_err('C.4 teléfono en el texto', public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera para cuidado domiciliario', 'Llámame al 3001234567 para acordar', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'No incluyas teléfonos');
SELECT public.t_err('C.5 enlace en el texto', public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera para cuidado domiciliario', 'Más información en https://mi-sitio.example/enfermera', 'hour', 20000, 'Bogotá') RETURNING id$q$), 'No incluyas teléfonos');
SELECT public.t_err('C.6 al editar el texto también se revisa', public.t_val(:'p1', format($q$UPDATE public.professional_service_offers SET description = 'Cuidado de pacientes, vendo mercancía' WHERE id = %L RETURNING 'ok'$q$, :'so1')), 'no se venden, compran ni arriendan');
SELECT public.t_eq('C.7 un texto de salud y cuidado pasa (también sin descripción)', public.t_val(:'p1', $q$WITH x AS (INSERT INTO public.professional_service_offers(professional_id, title, modality, amount, city, status)
  VALUES (auth.uid(), 'Terapia respiratoria domiciliaria', 'hour', 30000, 'Bogotá', 'paused') RETURNING id) SELECT 'ok' FROM x$q$), 'ok');
SELECT public.t_val(:'p1', format($q$DELETE FROM public.professional_service_offers WHERE id <> %L AND professional_id = auth.uid() RETURNING 'x'$q$, :'so1')) AS _clean \gset
-- Una fila antigua con un texto que hoy no pasaría puede seguir cambiando otras columnas (la moderación solo mira lo que cambia).
SET session_replication_role = replica;
INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city) VALUES (:'p3', 'Cuidado de pacientes', 'oferta antigua, vendo cosas', 'hour', 18000, 'Bogotá') RETURNING id AS so_old \gset
SET session_replication_role = origin;
SELECT public.t_eq('C.8 lo que no cambia no se vuelve a juzgar', public.t_val(:'p3', format($q$UPDATE public.professional_service_offers SET amount = 19000 WHERE id = %L RETURNING 'ok'$q$, :'so_old')), 'ok');
SELECT public.t_val(:'p3', format($q$DELETE FROM public.professional_service_offers WHERE id = %L RETURNING 'x'$q$, :'so_old')) AS _clean2 \gset

UPDATE public.professional_profiles SET blocked = true WHERE user_id = :'p5';
SELECT public.t_err('C.9 un profesional con la cuenta en revisión no publica', public.t_val(:'p5', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Enfermera para cuidado nocturno', 'Cuidado de pacientes', 'Enfermería', 'hour', 21000, 'Bogotá') RETURNING id$q$), 'Tu cuenta está en revisión');
SELECT public.t_val(:'p5', format($q$UPDATE public.professional_service_offers SET status = 'closed' WHERE id = %L RETURNING 'ok'$q$, :'so5b')) AS c10 \gset
SELECT public.t_err('C.10 ni reabre una cerrada (aunque sí puede cerrarla)', public.t_val(:'p5', format($q$UPDATE public.professional_service_offers SET status = 'open' WHERE id = %L RETURNING 'ok'$q$, :'so5b')), 'Tu cuenta está en revisión');
SELECT public.t_eq('C.10b cerrar la suya sí puede', :'c10', 'ok');
UPDATE public.professional_service_offers SET status = 'open' WHERE id = :'so5b';

-- ═══ D) Bloqueo, dueño y tope ═════════════════════════════════════════════════════════════════════════════════
SELECT public.t_val(:'sa', format($q$UPDATE public.professional_service_offers SET blocked = true WHERE id = %L RETURNING 'ok'$q$, :'so5')) AS d1a \gset
SELECT public.t_val(:'p5', format($q$UPDATE public.professional_service_offers SET blocked = false WHERE id = %L RETURNING 'ok'$q$, :'so5')) AS d1b \gset
SELECT public.t_eq('D.1 el personal bloquea una oferta y el dueño no puede quitarle el bloqueo', :'d1a' || '|' || :'d1b' || '|' ||
  (SELECT blocked::text FROM public.professional_service_offers WHERE id = :'so5'), 'ok|ok|true');
SELECT public.t_val(:'p4', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city, blocked)
  VALUES (auth.uid(), 'Acompañamiento de pacientes', 'Cuidado y acompañamiento', 'hour', 16000, 'Bogotá', true) RETURNING id$q$) AS so_b \gset
SELECT public.t_eq('D.2 ni nacer ya bloqueada o desbloqueada a su gusto: siempre nace abierta al público', (SELECT blocked::text FROM public.professional_service_offers WHERE id = :'so_b'), 'false');
SELECT public.t_val(:'p4', format($q$DELETE FROM public.professional_service_offers WHERE id = %L RETURNING 'x'$q$, :'so_b')) AS _clean3 \gset
SELECT public.t_eq('D.3 el dueño no cambia a quién pertenece', public.t_val(:'p1', format($q$UPDATE public.professional_service_offers SET professional_id = %L::uuid WHERE id = %L RETURNING professional_id = auth.uid()$q$, :'p2', :'so1')), 'true');
SELECT public.t_eq('D.4 otro profesional no toca la oferta ajena (ninguna fila)', public.t_val(:'p2', format($q$UPDATE public.professional_service_offers SET amount = 1000 WHERE id = %L RETURNING 'ok'$q$, :'so1')), 'NULL');
SELECT public.t_eq('D.5 ni la borra', public.t_val(:'p2', format($q$DELETE FROM public.professional_service_offers WHERE id = %L RETURNING 'ok'$q$, :'so1')), 'NULL');
SELECT public.t_eq('D.6 el dueño la pausa y la vuelve a abrir', public.t_val(:'p1', format($q$UPDATE public.professional_service_offers SET status = 'paused' WHERE id = %L RETURNING status$q$, :'so1'))
  || '|' || public.t_val(:'p1', format($q$UPDATE public.professional_service_offers SET status = 'open' WHERE id = %L RETURNING status$q$, :'so1')), 'paused|open');
SELECT updated_at AS u0, created_at AS c0 FROM public.professional_service_offers WHERE id = :'so1' \gset
SELECT public.t_val(:'p1', format($q$UPDATE public.professional_service_offers SET created_at = now() + interval '9 days', amount = 29000 WHERE id = %L RETURNING 'ok'$q$, :'so1')) AS d7 \gset
SELECT public.t_eq('D.7 la fecha de creación no cambia y la de modificación sí', :'d7' || '|' || (SELECT (created_at = :'c0'::timestamptz)::text || '/' || (updated_at > :'u0'::timestamptz)::text FROM public.professional_service_offers WHERE id = :'so1'), 'ok|true/true');
-- Políticas «a ciegas» (sin WHERE ni RETURNING la política de lectura no filtra): un profesional solo toca lo suyo.
SELECT max(updated_at) AS otros0, count(*) AS otros_n FROM public.professional_service_offers WHERE professional_id <> :'p4' \gset
SELECT public.t_exec(:'p4', 'authenticated', 'UPDATE public.professional_service_offers SET description = description') AS d7b \gset
SELECT public.t_eq('D.7b una actualización sin filtro solo alcanza lo propio', :'d7b' || '|' || (SELECT (max(updated_at) = :'otros0'::timestamptz)::text FROM public.professional_service_offers WHERE professional_id <> :'p4'), 'ok|true');
SELECT public.t_exec(:'p4', 'authenticated', 'DELETE FROM public.professional_service_offers') AS d7c \gset
SELECT public.t_eq('D.7c un borrado sin filtro solo alcanza lo propio', :'d7c' || '|' || (SELECT count(*) FROM public.professional_service_offers WHERE professional_id <> :'p4')::text || '|' || (SELECT count(*) FROM public.professional_service_offers WHERE professional_id = :'p4')::text, 'ok|' || :'otros_n' || '|0');
-- p4 (perfil sin publicar) vuelve a tener una oferta abierta: no debe verse en el listado público.
SELECT public.t_val(:'p4', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Auxiliar de enfermería disponible', 'Cuidado de pacientes en casa', 'Auxiliar', 'hour', 15000, 'Bogotá') RETURNING id$q$) AS so4b \gset

-- Tope de 5 ofertas vigentes (abiertas o en pausa)
DO $do$ BEGIN FOR i IN 1..4 LOOP
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES ('00000000-0000-0000-0000-0000000000a2', 'Terapia a domicilio ' || i, 'Terapia y rehabilitación de pacientes', 'hour', 20000 + i, 'Medellín');
  RESET ROLE;
END LOOP; END $do$;
SELECT public.t_eq('D.8 el profesional llega a 5 vigentes', (SELECT count(*)::text FROM public.professional_service_offers WHERE professional_id = :'p2' AND status IN ('open','paused')), '5');
SELECT public.t_err('D.9 la sexta se rechaza con un mensaje claro', public.t_val(:'p2', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Terapia a domicilio 6', 'Terapia y rehabilitación', 'hour', 20000, 'Medellín') RETURNING id$q$), 'Ya tienes 5 ofertas de servicio vigentes');
SELECT public.t_eq('D.10 cerrar una libera un cupo', public.t_val(:'p2', format($q$UPDATE public.professional_service_offers SET status = 'closed' WHERE id = %L RETURNING status$q$, :'so2')) || '|' ||
  public.t_val(:'p2', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Terapia a domicilio 7', 'Terapia y rehabilitación', 'hour', 20000, 'Medellín') RETURNING 'ok'$q$), 'closed|ok');
SELECT public.t_err('D.11 reabrir una cerrada con 5 vigentes también se rechaza', public.t_val(:'p2', format($q$UPDATE public.professional_service_offers SET status = 'open' WHERE id = %L RETURNING status$q$, :'so2')), 'Ya tienes 5 ofertas de servicio vigentes');
SELECT public.t_eq('D.12 el tope no es de otros: otro profesional publica con normalidad', public.t_val(:'p3', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Cuidado con experiencia', 'Cuidado de pacientes en casa', 'hour', 18000, 'Bogotá') RETURNING 'ok'$q$), 'ok');
SELECT public.t_val(:'p3', $q$DELETE FROM public.professional_service_offers WHERE professional_id = auth.uid() AND title = 'Cuidado con experiencia' RETURNING 'x'$q$) AS _clean4 \gset

-- ═══ E) Quién lee la tabla ════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('E.1 cada profesional ve solo las suyas', public.t_val(:'p1', 'SELECT count(*)::text FROM public.professional_service_offers') || '/' || public.t_val(:'p3', 'SELECT count(*)::text FROM public.professional_service_offers'), '1/1');
SELECT public.t_eq('E.2 una familia no lee la tabla (solo la función)', public.t_val(:'f1', 'SELECT count(*)::text FROM public.professional_service_offers'), '0');
SELECT public.t_true('E.3 el personal lee todas', public.t_val(:'sa', 'SELECT count(*)::text FROM public.professional_service_offers')::integer >= 8);
SELECT public.t_err('E.4 un visitante no lee la tabla', public.t_anon('SELECT count(*)::text FROM public.professional_service_offers'), 'permission denied');

-- ═══ F) Lo que ven las familias, las instituciones y el personal ═════════════════════════════════════════════
-- Casos que NO deben aparecer: en pausa, vencida, bloqueada, de un profesional sin publicar o bloqueado, o que dejó de ser profesional.
SET session_replication_role = replica;
INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city, status) VALUES
  (:'p1', 'Enfermería en pausa', 'Cuidado de pacientes', 'hour', 27000, 'Bogotá', 'paused'),
  (:'p3', 'Cuidado de pacientes (cerrada)', 'Cuidado de pacientes', 'hour', 17000, 'Bogotá', 'closed');
INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city, available_from, available_until) VALUES
  (:'p3', 'Cuidado de pacientes (vencida)', 'Cuidado de pacientes', 'hour', 17500, 'Bogotá', now() - interval '3 days', now() - interval '1 day');
INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city) VALUES
  (:'p1', 'Enfermería con teléfono antiguo', 'Cuidado de pacientes. Llámame al 3001234567', 'hour', 26000, 'Bogotá');
SET session_replication_role = origin;
UPDATE public.professional_service_offers SET blocked = true WHERE title = 'Enfermería con teléfono antiguo';
SELECT public.t_eq('F.1 la familia ve solo las abiertas, no bloqueadas, vigentes y de profesionales publicados (no el sin publicar ni el bloqueado)',
  public.t_val(:'f1', $q$SELECT string_agg(t.title, ' | ' ORDER BY t.title) FROM public.list_open_service_offers() t$q$),
  'Cuidadora con experiencia | Enfermera profesional para cuidado domiciliario | Terapia a domicilio 1 | Terapia a domicilio 2 | Terapia a domicilio 3 | Terapia a domicilio 4 | Terapia a domicilio 7');
SELECT public.t_eq('F.2 lo mismo para una institución', public.t_val(:'i1', 'SELECT count(*)::text FROM public.list_open_service_offers()'), '7');
SELECT public.t_eq('F.3 y para el personal', public.t_val(:'sa', 'SELECT count(*)::text FROM public.list_open_service_offers()'), '7');
SELECT public.t_err('F.4 otro profesional no la usa', public.t_val(:'p1', 'SELECT count(*)::text FROM public.list_open_service_offers()'), 'Solo las familias y las instituciones');
SELECT public.t_err('F.5 un visitante tampoco', public.t_anon('SELECT count(*)::text FROM public.list_open_service_offers()'), 'permission denied');
SELECT public.t_eq('F.6 trae quién es, su calificación, RETHUS, Trust Score y el estado',
  public.t_val(:'f1', $q$SELECT t.display_name || '|' || t.avg_rating || '|' || t.rethus_verified || '|' || t.verified || '|' || t.trust_score || '|' || t.trust_level || '|' || t.availability_status || '|' || t.profile_specialty || '|' || t.specialty || '|' || t.modality || '|' || t.amount
      FROM public.list_open_service_offers() t WHERE t.title = 'Enfermera profesional para cuidado domiciliario'$q$),
  'Laura Pérez|4.80|true|true|82|high|available|Enfermería|Enfermería|hour|29000');
SELECT public.t_eq('F.7 la cercanía por rangos respecto a quien mira, y la más cercana primero',
  public.t_val(:'f1', $q$SELECT string_agg(t.display_name || ':' || t.distance_band_km, ' ' ORDER BY t.ordinality) FROM public.list_open_service_offers() WITH ORDINALITY AS t WHERE t.title IN ('Cuidadora con experiencia','Enfermera profesional para cuidado domiciliario')$q$),
  'Marta Ruiz:10 Laura Pérez:20');
SELECT public.t_eq('F.8 una institución mide desde su sede', public.t_val(:'i1', $q$SELECT string_agg(t.display_name || ':' || t.distance_band_km, ' ' ORDER BY t.ordinality) FROM public.list_open_service_offers() WITH ORDINALITY AS t WHERE t.title IN ('Cuidadora con experiencia','Enfermera profesional para cuidado domiciliario')$q$),
  'Marta Ruiz:2 Laura Pérez:10');
SELECT public.t_eq('F.9 quien no tiene ubicación no ve cercanía (pero sí las ofertas)', public.t_val(:'f2', $q$SELECT count(*)::text || '/' || count(t.distance_band_km) FROM public.list_open_service_offers() t$q$), '7/0');
SELECT public.t_eq('F.10 sin teléfono, dirección ni contacto: solo las columnas del listado',
  (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'list\_open\_service\_offers%' ESCAPE '\' AND parameter_mode = 'OUT'),
  'offer_id,professional_id,display_name,avatar_url,profile_specialty,title,description,specialty,modality,amount,city,available_from,available_until,created_at,avg_rating,total_jobs,rethus_verified,verified,trust_score,trust_level,trust_enough,availability_status,live,distance_band_km');
UPDATE public.professional_service_offers SET blocked = false WHERE title = 'Enfermería con teléfono antiguo';
SELECT public.t_eq('F.11 si una fila antigua trae un teléfono, la lista lo oculta', public.t_val(:'f1', $q$SELECT t.description FROM public.list_open_service_offers() t WHERE t.title = 'Enfermería con teléfono antiguo'$q$), 'Cuidado de pacientes. Llámame al [contacto oculto]');
UPDATE public.professional_service_offers SET blocked = true WHERE title = 'Enfermería con teléfono antiguo';
UPDATE public.user_roles SET role = 'family' WHERE user_id = :'p3';
SELECT public.t_eq('F.12 si deja de ser profesional, su oferta desaparece', public.t_val(:'f1', 'SELECT count(*)::text FROM public.list_open_service_offers() t WHERE t.professional_id = ' || quote_literal(:'p3')), '0');
UPDATE public.user_roles SET role = 'professional' WHERE user_id = :'p3';
SELECT public.t_val(:'p1', $q$SELECT 'ok' FROM (SELECT public.touch_presence(4.60971, -74.08175)) s$q$) AS _pres \gset
SELECT public.t_val(:'p3', $q$SELECT 'ok' FROM (SELECT public.touch_presence()) s$q$) AS _pres3 \gset
UPDATE public.user_locations SET last_seen = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' WHERE user_id = :'p3';
SELECT public.t_eq('F.14 «en vivo» y «ocupado» salen de la presencia y de la reserva', public.t_val(:'f1', $q$SELECT string_agg(t.display_name || ':' || t.live || ':' || t.availability_status, ' ' ORDER BY t.display_name) FROM public.list_open_service_offers() t WHERE t.title IN ('Cuidadora con experiencia','Enfermera profesional para cuidado domiciliario')$q$),
  'Laura Pérez:true:available Marta Ruiz:false:busy');

-- ═══ G) Aviso en vivo ═════════════════════════════════════════════════════════════════════════════════════════
SELECT count(*) AS png0 FROM public._realtime_log WHERE topic = 'live_map_ping' AND event = 'service_offers_changed' \gset
SELECT public.t_val(:'p3', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, modality, amount, city)
  VALUES (auth.uid(), 'Cuidado de pacientes en casa', 'Acompañamiento y cuidado', 'hour', 18000, 'Bogotá') RETURNING id$q$) AS so_g \gset
SELECT count(*) AS png1 FROM public._realtime_log WHERE topic = 'live_map_ping' AND event = 'service_offers_changed' \gset
SELECT public.t_eq('G.1 publicar avisa una vez', (:png1 - :png0)::text, '1');
UPDATE public.professional_service_offers SET status = 'paused' WHERE professional_id IN (:'p1', :'p3') AND status = 'open';
SELECT count(*) AS png2 FROM public._realtime_log WHERE topic = 'live_map_ping' AND event = 'service_offers_changed' \gset
SELECT public.t_eq('G.2 pausar varias a la vez (una sentencia) avisa una sola vez', (:png2 - :png1)::text, '1');
DELETE FROM public.professional_service_offers WHERE id = :'so_g';
SELECT count(*) AS png3 FROM public._realtime_log WHERE topic = 'live_map_ping' AND event = 'service_offers_changed' \gset
SELECT public.t_eq('G.3 borrar también avisa', (:png3 - :png2)::text, '1');
SELECT public.t_true('G.4 el aviso no lleva datos y va por el tema que ya autoriza a toda cuenta con sesión',
  NOT EXISTS (SELECT 1 FROM public._realtime_log WHERE event = 'service_offers_changed' AND (payload <> '{}'::jsonb OR topic <> 'live_map_ping' OR NOT private)));
SELECT public.t_true('G.5 las funciones internas no las llama la API', NOT has_function_privilege('authenticated', 'public.hx_service_offer_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_ping_service_offers()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.trg_ping_service_offers()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.list_open_service_offers(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.list_open_service_offers(integer)', 'EXECUTE'));
SELECT public.t_true('G.6 las funciones nuevas son SECURITY DEFINER con search_path fijo', (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public%') FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('list_open_service_offers','list_open_family_offers','hx_ping_service_offers','trg_ping_service_offers')));

-- ═══ H) Segunda pasada ════════════════════════════════════════════════════════════════════════════════════════
SELECT (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('list_open_service_offers','list_open_family_offers','hx_service_offer_guard','hx_ping_service_offers','trg_ping_service_offers')) AS sig_fn,
       (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'professional_service_offers') AS sig_pol,
       (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.professional_service_offers'::regclass) AS sig_acl,
       (SELECT count(*) FROM public.professional_service_offers) AS sig_rows \gset
\i :MIG
SELECT public.t_eq('H.1 la segunda pasada no cambia las funciones ni sus permisos', (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('list_open_service_offers','list_open_family_offers','hx_service_offer_guard','hx_ping_service_offers','trg_ping_service_offers')), :'sig_fn');
SELECT public.t_eq('H.2 ni las políticas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'professional_service_offers'), :'sig_pol');
SELECT public.t_eq('H.3 ni los privilegios de la tabla', (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.professional_service_offers'::regclass), :'sig_acl');
SELECT public.t_eq('H.4 ni los datos', (SELECT count(*)::text FROM public.professional_service_offers), :'sig_rows');
SELECT public.t_eq('H.5 un solo disparador de guarda y uno de aviso', (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.professional_service_offers'::regclass AND NOT tgisinternal), 'trg_pso_guard,trg_pso_ping');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
