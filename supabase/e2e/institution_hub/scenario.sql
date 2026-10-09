\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- ═══ Utilidades de prueba ═══════════════════════════════════════════════════════
CREATE TABLE public._t (n serial, ok boolean, name text, detail text);

CREATE FUNCTION public.t_as(u uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text; v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE stmt; v_res := 'OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM || COALESCE(' | hint=' || NULLIF(v_hint, ''), '');
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

CREATE FUNCTION public.t_val(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text; v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE q INTO v_res; v_res := COALESCE(v_res, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM || COALESCE(' | hint=' || NULLIF(v_hint, ''), '');
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

-- Igual que t_val pero para el service role (sin usuario).
CREATE FUNCTION public.t_svc(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text; v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE q INTO v_res; v_res := COALESCE(v_res, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM || COALESCE(' | hint=' || NULLIF(v_hint, ''), '');
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

-- Ejecuta como usuario y devuelve el uuid; si falla, aborta la prueba con el motivo.
CREATE FUNCTION public.t_uuid(u uuid, q text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_res text;
BEGIN
  v_res := public.t_val(u, q);
  IF v_res LIKE 'ERR%' OR v_res = 'NULL' THEN RAISE EXCEPTION 't_uuid falló: % -> %', q, v_res; END IF;
  RETURN v_res::uuid;
END $$;

CREATE FUNCTION public.t_eq(name text, got text, want text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got IS NOT DISTINCT FROM want, name, 'got=[' || COALESCE(got,'NULL') || '] want=[' || COALESCE(want,'NULL') || ']') $$;
CREATE FUNCTION public.t_err(name text, got text, pat text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got LIKE 'ERR%' AND got ILIKE '%' || pat || '%', name, 'got=[' || COALESCE(got,'NULL') || '] pat=[' || pat || ']') $$;
CREATE FUNCTION public.t_ok(name text, got text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got = 'OK', name, 'got=[' || COALESCE(got,'NULL') || ']') $$;
CREATE FUNCTION public.t_true(name text, cond boolean) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (COALESCE(cond, false), name, 'cond=' || COALESCE(cond::text, 'NULL')) $$;
-- Consulta de verificación como superusuario → texto.
CREATE FUNCTION public.q1(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE q INTO r; RETURN COALESCE(r, 'NULL'); END $$;

-- ═══ Datos base ═════════════════════════════════════════════════════════════════
\set inst1 '00000000-0000-0000-0000-000000000001'
\set inst2 '00000000-0000-0000-0000-000000000002'
\set pfree '00000000-0000-0000-0000-0000000000a1'
\set pess '00000000-0000-0000-0000-0000000000a2'
\set pother '00000000-0000-0000-0000-0000000000a3'
\set pfree2 '00000000-0000-0000-0000-0000000000a4'
\set pblock '00000000-0000-0000-0000-0000000000a5'
\set fam1 '00000000-0000-0000-0000-0000000000f1'
\set staff '00000000-0000-0000-0000-00000000005a'

INSERT INTO auth.users(id, email) VALUES
  (:'inst1','inst1@t.co'),(:'inst2','inst2@t.co'),(:'pfree','pfree@t.co'),(:'pess','pess@t.co'),(:'pother','pother@t.co'),
  (:'pfree2','pfree2@t.co'),(:'pblock','pblock@t.co'),(:'fam1','fam1@t.co'),(:'staff','staff@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'inst1','institution'),(:'inst2','institution'),(:'pfree','professional'),(:'pess','professional'),(:'pother','professional'),
  (:'pfree2','professional'),(:'pblock','professional'),(:'fam1','family'),(:'staff','superadmin');
INSERT INTO public.profiles(user_id, full_name, phone, city) VALUES
  (:'inst1','Clínica Santa Fe SAS',NULL,'Bogotá'),(:'inst2','Hospital San Rafael',NULL,'Medellín'),
  (:'pfree','Laura Gómez Pérez','3001110001','Bogotá'),(:'pess','Camilo Ríos Soto','3001110002','Bogotá'),
  (:'pother','Diana Mora Cruz','3001110003','Bogotá'),(:'pfree2','Andrés Peña Luna','3001112222','Bogotá'),
  (:'pblock','Bloqueado Uno','3001110005','Bogotá'),(:'fam1','Marta Rojas Díaz','3001110006','Bogotá');
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, nit, city, address, verified,
                                        legal_representative_name, legal_representative_phone) VALUES
  (:'inst1','Clínica Santa Fe','Clínica','900123456-7','Bogotá','Cra 15 # 100-20',true,'Ana María Duarte','3109998888'),
  (:'inst2','Hospital San Rafael','Hospital','800765432-1','Medellín',NULL,false,NULL,NULL);
INSERT INTO public.professional_profiles(user_id, specialty, rethus_verified, home_city, service_cities, published, available, blocked) VALUES
  (:'pfree','Auxiliar de enfermería',false,'Bogotá','{Bogotá}',true,true,false),
  (:'pess','Auxiliar de enfermería',true,'Bogotá','{Bogotá}',true,true,false),
  (:'pother','Auxiliar de enfermería',true,'Bogotá','{Bogotá}',true,true,false),
  (:'pfree2','Enfermería',true,'Bogotá','{Bogotá}',true,true,false),
  (:'pblock','Enfermería',true,'Bogotá','{Bogotá}',true,true,true);
-- Plan Esencial vigente para pess; pfree y pfree2 son Free (sin fila en mp_subscriptions).
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'pess','essential_monthly','active', now() + interval '20 days');
-- Alerta de pother: UCI en Bogotá.
INSERT INTO public.opportunity_alerts(professional_id, name, cities, care_types, min_rate) VALUES (:'pother','UCI Bogotá','{Bogotá}','{uci}',10000);

-- ═══ 1) Publicar una oferta con agenda y datos privados ═════════════════════════
SELECT jsonb_build_object(
  'title','Auxiliar de enfermería UCI adultos – turnos de noche',
  'description','Cubrimos noches en UCI adultos. Se requiere experiencia con ventilación mecánica.',
  'modality','shift','amount',180000,'city','Bogotá','specialty_required','Auxiliar de enfermería',
  'service_area','UCI adultos','is_urgent',true,
  'requirements', jsonb_build_array('RETHUS vigente','Experiencia UCI 1 año'),
  'address','Calle 100 # 15-20, Piso 4','contact_phone','3105551234','access_notes','Ingreso por urgencias; pregunte por la jefe de piso',
  'lat',4.6830123,'lng',-74.0421987,
  'shifts', jsonb_build_array(
     jsonb_build_object('starts_at', now() + interval '30 hours', 'ends_at', now() + interval '42 hours', 'positions', 1),
     jsonb_build_object('starts_at', now() + interval '54 hours', 'ends_at', now() + interval '66 hours', 'positions', 1))
)::text AS offer1_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offer1_json')) AS offer1 \gset

SELECT public.t_eq('1.1 la oferta no guarda address', public.q1(format('SELECT address FROM public.job_offers WHERE id = %L', :'offer1')), 'NULL');
SELECT public.t_eq('1.2 la oferta no guarda teléfono', public.q1(format('SELECT contact_phone FROM public.job_offers WHERE id = %L', :'offer1')), 'NULL');
SELECT public.t_eq('1.3 la dirección vive en job_offer_private', public.q1(format('SELECT address FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), 'Calle 100 # 15-20, Piso 4');
SELECT public.t_eq('1.4 el teléfono vive en job_offer_private', public.q1(format('SELECT contact_phone FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), '3105551234');
SELECT public.t_eq('1.5 coordenadas de la oferta aproximadas (2 decimales)', public.q1(format('SELECT lat::text || '','' || lng::text FROM public.job_offers WHERE id = %L', :'offer1')), '4.68,-74.04');
SELECT public.t_eq('1.6 coordenadas exactas guardadas aparte', public.q1(format('SELECT exact_lat::text FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), '4.6830123');
SELECT public.t_eq('1.7 notas de acceso guardadas', public.q1(format('SELECT access_notes FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), 'Ingreso por urgencias; pregunte por la jefe de piso');
SELECT public.t_eq('1.8 dos turnos en la agenda', public.q1(format('SELECT count(*)::text FROM public.job_offer_shifts WHERE job_offer_id = %L', :'offer1')), '2');
SELECT public.t_eq('1.9 start/end derivados de los turnos', public.q1(format('SELECT (start_date < end_date)::text FROM public.job_offers WHERE id = %L', :'offer1')), 'true');

-- Un profesional (cualquier autenticado) no ve la dirección ni el teléfono por la API.
SELECT public.t_eq('1.10 profesional lee address = NULL', public.t_val(:'pfree', format('SELECT address FROM public.job_offers WHERE id = %L', :'offer1')), 'NULL');
SELECT public.t_err('1.11 profesional no puede leer contact_phone (privilegio de columna)', public.t_val(:'pfree', format('SELECT contact_phone FROM public.job_offers WHERE id = %L', :'offer1')), 'permission denied');
SELECT public.t_eq('1.12 profesional no ve job_offer_private', public.t_val(:'pfree', 'SELECT count(*) FROM public.job_offer_private'), '0');
SELECT public.t_eq('1.13 la institución dueña sí ve job_offer_private', public.t_val(:'inst1', 'SELECT count(*) FROM public.job_offer_private'), '1');
SELECT public.t_eq('1.14 otra institución no ve job_offer_private ajeno', public.t_val(:'inst2', 'SELECT count(*) FROM public.job_offer_private'), '0');
SELECT public.t_eq('1.15 profesional no ve los turnos crudos (agenda)', public.t_val(:'pfree', format('SELECT count(*) FROM public.job_offer_shifts WHERE job_offer_id = %L', :'offer1')), '0');

-- La lista segura para profesionales.
SELECT public.t_eq('1.16 el feed trae la oferta', public.t_val(:'pfree', 'SELECT count(*) FROM public.list_open_institution_offers()'), '1');
SELECT public.t_eq('1.17 el feed trae el nombre de la institución', public.t_val(:'pfree', 'SELECT institution_name FROM public.list_open_institution_offers() LIMIT 1'), 'Clínica Santa Fe');
SELECT public.t_eq('1.18 el feed trae los 2 turnos', public.t_val(:'pfree', 'SELECT jsonb_array_length(shifts)::text FROM public.list_open_institution_offers() LIMIT 1'), '2');
SELECT public.t_true('1.19 la firma del feed no incluye dirección ni teléfono',
  pg_get_function_result('public.list_open_institution_offers(integer)'::regprocedure) !~* '(address|phone|contact)');
SELECT public.t_err('1.20 una familia no puede listar ofertas de instituciones', public.t_val(:'fam1', 'SELECT count(*) FROM public.list_open_institution_offers()'), 'No autorizado');
SELECT public.t_eq('1.21 la institución dueña no la ve en el feed', public.t_val(:'inst1', 'SELECT count(*) FROM public.list_open_institution_offers()'), 'ERR[42501] No autorizado');
SELECT public.t_eq('1.22 alerta de pother notificada', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''opportunity_alert''', :'pother')), '1');
SELECT public.t_eq('1.23 pfree (sin alertas) no recibe aviso', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''opportunity_alert''', :'pfree')), '0');
SELECT public.t_true('1.24 aviso en vivo de ofertas emitido', EXISTS (SELECT 1 FROM public._realtime_log WHERE event = 'offers_changed' AND topic = 'open_needs_ping'));

-- Si la institución escribe address por la API (formularios actuales), se traslada a lo privado.
SELECT public.t_ok('1.25 la institución edita address por la API', public.t_as(:'inst1', format('UPDATE public.job_offers SET address = ''Cra 7 # 1-1'' WHERE id = %L', :'offer1')));
SELECT public.t_eq('1.26 la API no deja address en la oferta', public.q1(format('SELECT address FROM public.job_offers WHERE id = %L', :'offer1')), 'NULL');
SELECT public.t_eq('1.27 la nueva dirección quedó en lo privado', public.q1(format('SELECT address FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), 'Cra 7 # 1-1');
SELECT public.t_eq('1.28 el teléfono privado se conserva al editar la dirección', public.q1(format('SELECT contact_phone FROM public.job_offer_private WHERE job_offer_id = %L', :'offer1')), '3105551234');

-- Validaciones de publicación.
SELECT public.t_err('1.29 monto fuera del rango de la modalidad', public.t_val(:'inst1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"hour","amount":500,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)$q$), 'valor debe estar entre');
SELECT public.t_err('1.30 descripción con teléfono se rechaza', public.t_val(:'inst1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","description":"Llamar al 3001234567","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)$q$), 'forbidden_content');
SELECT public.t_err('1.31 sin turnos se rechaza', public.t_val(:'inst1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[]}'::jsonb)$q$), 'entre 1 y 60 turnos');
SELECT public.t_err('1.32 turno de más de 24 h se rechaza', public.t_val(:'inst1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-03T10:00:00Z"}]}'::jsonb)$q$), 'máximo 24 horas');
SELECT public.t_err('1.33 un profesional no puede publicar', public.t_val(:'pfree', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)$q$), 'Solo las instituciones');

-- Segunda oferta (por hora) para negociación y rondas.
SELECT jsonb_build_object('title','Enfermería general – refuerzo diurno','modality','hour','amount',20000,'city','Bogotá',
  'specialty_required','Enfermería','service_area','Hospitalización',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '100 hours', 'ends_at', now() + interval '106 hours', 'positions', 1)))::text AS offer2_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offer2_json')) AS offer2 \gset

-- ═══ 2) Un profesional Free se postula y el sistema le impide negociar ═════════
SELECT public.t_uuid(:'pfree', format('SELECT public.apply_to_offer(%L, NULL, %L, NULL)', :'offer1', 'Tengo 5 años en UCI')) AS app1 \gset
SELECT public.t_eq('2.1 postulación pendiente', public.q1(format('SELECT status::text FROM public.applications WHERE id = %L', :'app1')), 'pending');
SELECT public.t_eq('2.2 valor publicado y propuesto iguales', public.q1(format('SELECT posted_amount || ''/'' || proposed_amount FROM public.applications WHERE id = %L', :'app1')), '180000/180000');
SELECT public.t_eq('2.3 espera respuesta de la institución', public.q1(format('SELECT awaiting FROM public.applications WHERE id = %L', :'app1')), 'institution');
SELECT public.t_eq('2.4 cubre los dos turnos', public.q1(format('SELECT cardinality(shift_ids)::text FROM public.applications WHERE id = %L', :'app1')), '2');
SELECT public.t_true('2.5 con vencimiento', (SELECT expires_at > now() FROM public.applications WHERE id = :'app1'));
SELECT public.t_eq('2.6 evento «applied» registrado', public.q1(format('SELECT count(*)::text FROM public.application_events WHERE application_id = %L AND event = ''applied''', :'app1')), '1');
SELECT public.t_eq('2.7 la institución fue notificada', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''application_received''', :'inst1')), '1');
SELECT public.t_err('2.8 no puede postularse dos veces', public.t_val(:'pfree', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer1')), 'Ya te postulaste');

-- Intentos de negociar siendo Free (por la función y por la API directa).
SELECT public.t_err('2.9 Free no puede cambiar su propuesta', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 200000, NULL)', :'app1')), 'negotiate_rate_requires_plan');
SELECT public.t_err('2.10 Free no puede editar el valor por la API', public.t_as(:'pfree', format('UPDATE public.applications SET proposed_amount = 200000 WHERE id = %L', :'app1')), 'use_application_rpc');
SELECT public.t_err('2.11 Free no puede aceptarse a sí mismo por la API', public.t_as(:'pfree', format('UPDATE public.applications SET status = ''accepted'' WHERE id = %L', :'app1')), 'no permitido');
SELECT public.t_err('2.12 Free no puede insertar una postulación con otro valor', public.t_as(:'pfree', format('INSERT INTO public.applications(job_offer_id, professional_id, proposed_amount) VALUES (%L, %L, 30000)', :'offer2', :'pfree')), 'negotiate_rate_requires_plan');
SELECT public.t_err('2.13 Free no puede desbloquear el contacto', public.t_val(:'pfree', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app1')), 'plan_required');
SELECT public.t_err('2.14 sin postulación no hay desbloqueo', public.t_val(:'pother', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app1')), 'application_required');
SELECT public.t_err('2.15 el profesional no se acepta a sí mismo', public.t_val(:'pfree', format('SELECT public.accept_application(%L, NULL)', :'app1')), 'Solo quien debe responder');
SELECT public.t_err('2.16 otra institución no puede aceptar', public.t_val(:'inst2', format('SELECT public.accept_application(%L, NULL)', :'app1')), 'Solo quien debe responder');

-- Inserción directa con la forma antigua de la API: el servidor fija el estado y los valores.
SELECT public.t_ok('2.17 inserción directa antigua (pother, status accepted)', public.t_as(:'pother', format('INSERT INTO public.applications(job_offer_id, professional_id, status, message) VALUES (%L, %L, ''accepted'', ''Disponible'')', :'offer1', :'pother')));
SELECT public.t_eq('2.18 el servidor la dejó pendiente', public.q1(format('SELECT status::text || ''/'' || proposed_amount || ''/'' || awaiting FROM public.applications WHERE job_offer_id = %L AND professional_id = %L', :'offer1', :'pother')), 'pending/180000/institution');
SELECT public.t_err('2.19 mensaje con teléfono por la API directa', public.t_as(:'pfree2', format('INSERT INTO public.applications(job_offer_id, professional_id, message) VALUES (%L, %L, ''escríbeme al 3004445566'')', :'offer2', :'pfree2')), 'forbidden_content');
SELECT public.t_err('2.20 profesional bloqueado no puede postularse', public.t_val(:'pblock', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer2')), 'en revisión');
SELECT public.t_err('2.21 una institución no puede postularse', public.t_val(:'inst2', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer1')), 'Solo los profesionales');

-- ═══ 3) Pasa a Esencial y contraoferta ═════════════════════════════════════════
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'pfree','essential_monthly','active', now() + interval '30 days');
SELECT public.t_err('3.1 fuera de rango (muy alto)', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 500000, NULL)', :'app1')), 'rate_out_of_band');
SELECT public.t_err('3.2 fuera de rango (muy bajo)', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 100000, NULL)', :'app1')), 'rate_out_of_band');
SELECT public.t_err('3.3 mensaje con teléfono en la contraoferta', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 200000, %L)', :'app1', 'llámame al 3001234567')), 'forbidden_content');
SELECT public.t_err('3.4 mismo valor no es contraoferta', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 180000, NULL)', :'app1')), 'debe cambiar el valor');
SELECT public.t_eq('3.5 Esencial cambia su propuesta sin gastar ronda', public.t_val(:'pfree', format('SELECT public.counter_application(%L, 200000, %L)', :'app1', 'Con cobertura de turnos corridos')), '1');
SELECT public.t_eq('3.6 el valor propuesto cambió', public.q1(format('SELECT proposed_amount::text || ''/'' || round_no || ''/'' || awaiting FROM public.applications WHERE id = %L', :'app1')), '200000/1/institution');
SELECT public.t_eq('3.7 evento «countered» registrado', public.q1(format('SELECT count(*)::text FROM public.application_events WHERE application_id = %L AND event = ''countered'' AND amount = 200000', :'app1')), '1');
SELECT public.t_eq('3.8 la institución recibió el aviso', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''application_counter_offer''', :'inst1')), '1');

-- ═══ 4) La institución acepta → la reserva queda con la dirección ═════════════
SELECT public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)::text', :'app1')) AS accept1 \gset
SELECT public.t_true('4.0 aceptar devolvió el resultado', :'accept1' NOT LIKE 'ERR%') ;
SELECT (:'accept1'::jsonb ->> 'contract_id')::uuid AS contract1 \gset
SELECT public.t_eq('4.1 dos reservas confirmadas', public.q1(format('SELECT count(*)::text FROM public.service_bookings WHERE application_id = %L AND status = ''confirmed''', :'app1')), '2');
SELECT public.t_eq('4.2 la reserva quedó con la dirección', public.q1(format('SELECT DISTINCT service_address FROM public.service_bookings WHERE application_id = %L', :'app1')), 'Cra 7 # 1-1');
SELECT public.t_eq('4.3 coordenadas exactas en la reserva', public.q1(format('SELECT DISTINCT service_lat::text FROM public.service_bookings WHERE application_id = %L', :'app1')), '4.6830123');
SELECT public.t_eq('4.4 valor acordado por turno', public.q1(format('SELECT DISTINCT total_amount::text FROM public.service_bookings WHERE application_id = %L', :'app1')), '200000');
SELECT public.t_eq('4.5 cliente y profesional correctos', public.q1(format('SELECT DISTINCT (client_id = %L AND professional_id = %L)::text FROM public.service_bookings WHERE application_id = %L', :'inst1', :'pfree', :'app1')), 'true');
SELECT public.t_eq('4.6 sin comisión para plan Esencial', public.q1(format('SELECT DISTINCT platform_fee_pct::text || ''/'' || platform_fee_amount FROM public.service_bookings WHERE application_id = %L', :'app1')), '0/0');
SELECT public.t_eq('4.7 postulación aceptada con valor acordado', public.q1(format('SELECT status::text || ''/'' || agreed_amount FROM public.applications WHERE id = %L', :'app1')), 'accepted/200000');
SELECT public.t_eq('4.8 cupos ocupados', public.q1(format('SELECT string_agg(filled || status, '','' ORDER BY starts_at) FROM public.job_offer_shifts WHERE job_offer_id = %L', :'offer1')), '1filled,1filled');
SELECT public.t_eq('4.9 oferta cubierta', public.q1(format('SELECT status::text FROM public.job_offers WHERE id = %L', :'offer1')), 'filled');
SELECT public.t_eq('4.10 otra postulación al mismo turno cerrada', public.q1(format('SELECT status::text || ''/'' || closed_reason FROM public.applications WHERE job_offer_id = %L AND professional_id = %L', :'offer1', :'pother')), 'rejected/offer_filled');
SELECT public.t_eq('4.11 el profesional descartado fue avisado', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''application_rejected''', :'pother')), '1');
SELECT public.t_eq('4.12 agenda del profesional ocupada', public.q1(format('SELECT count(*)::text FROM public.availability_slots WHERE user_id = %L AND status = ''busy''', :'pfree')), '2');
SELECT public.t_eq('4.13 chat creado al aceptar', public.q1(format('SELECT count(*)::text FROM public.conversations WHERE application_id = %L', :'app1')), '1');
SELECT public.t_eq('4.14 el profesional fue avisado de la aceptación', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''application_accepted''', :'pfree')), '1');
SELECT public.t_eq('4.15 la institución fue avisada de la reserva', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''booking_confirmed''', :'inst1')), '1');
SELECT public.t_eq('4.16 evento «accepted» registrado', public.q1(format('SELECT count(*)::text FROM public.application_events WHERE application_id = %L AND event = ''accepted''', :'app1')), '1');
SELECT public.t_err('4.17 no se acepta dos veces', public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)', :'app1')), 'ya no está disponible');
SELECT public.t_eq('4.18 el profesional ya ve la dirección en su reserva', public.t_val(:'pfree', format('SELECT DISTINCT service_address FROM public.service_bookings WHERE application_id = %L', :'app1')), 'Cra 7 # 1-1');

-- ═══ 5) El profesional desbloquea el contacto y la institución ve el aviso ════
SELECT public.t_eq('5.1 desbloqueo: teléfono', public.t_val(:'pfree', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app1')), '3105551234');
SELECT public.t_eq('5.2 desbloqueo: dirección', public.t_val(:'pfree', format('SELECT address FROM public.reveal_offer_contact(%L)', :'app1')), 'Cra 7 # 1-1');
SELECT public.t_eq('5.3 desbloqueo: notas de acceso', public.t_val(:'pfree', format('SELECT access_notes FROM public.reveal_offer_contact(%L)', :'app1')), 'Ingreso por urgencias; pregunte por la jefe de piso');
SELECT public.t_eq('5.4 desbloqueo: institución', public.t_val(:'pfree', format('SELECT counterpart_name FROM public.reveal_offer_contact(%L)', :'app1')), 'Clínica Santa Fe');
SELECT public.t_eq('5.5 desbloqueos que quedan hoy (plan Esencial = 15)', public.t_val(:'pfree', format('SELECT reveals_left::text FROM public.reveal_offer_contact(%L)', :'app1')), '14');
SELECT public.t_eq('5.6 la institución recibe UN aviso por contraparte y día', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''contact_revealed''', :'inst1')), '1');
SELECT public.t_eq('5.7 auditoría del desbloqueo', public.q1(format('SELECT counterpart_kind || ''/'' || (job_offer_id = %L)::text FROM public.opportunity_contact_reveals WHERE professional_id = %L LIMIT 1', :'offer1', :'pfree')), 'institution/true');
SELECT public.t_eq('5.8 la institución ve quién desbloqueó su contacto (una fila por día)', public.t_val(:'inst1', 'SELECT count(*) FROM public.opportunity_contact_reveals'), '1');
SELECT public.t_eq('5.9 contacto de la reserva (Esencial)', public.t_val(:'pfree', format('SELECT phone FROM public.get_booking_contact((SELECT id FROM public.service_bookings WHERE application_id = %L ORDER BY scheduled_at LIMIT 1))', :'app1')), '3105551234');
SELECT public.t_eq('5.10 la institución obtiene el contacto del profesional', public.t_val(:'inst1', format('SELECT phone FROM public.get_booking_contact((SELECT id FROM public.service_bookings WHERE application_id = %L ORDER BY scheduled_at LIMIT 1))', :'app1')), '3001110001');

-- ═══ 6) Profesional Free con reserva: ve la dirección pero no el contacto ═════
SELECT jsonb_build_object('title','Auxiliar de enfermería – urgencias fin de semana','modality','shift','amount',150000,'city','Bogotá',
  'specialty_required','Auxiliar de enfermería','address','Av. 68 # 22-10','contact_phone','3207778899',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '200 hours', 'ends_at', now() + interval '208 hours', 'positions', 1)))::text AS offer3_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offer3_json')) AS offer3 \gset
SELECT public.t_uuid(:'pfree2', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer3')) AS app3 \gset
SELECT public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)::text', :'app3')) AS accept3 \gset
SELECT public.t_true('6.0 aceptación de pfree2', :'accept3' NOT LIKE 'ERR%');
SELECT public.t_eq('6.1 Free ve la dirección en su reserva', public.t_val(:'pfree2', format('SELECT service_address FROM public.service_bookings WHERE application_id = %L', :'app3')), 'Av. 68 # 22-10');
SELECT public.t_eq('6.2 comisión 12 % para Free', public.q1(format('SELECT platform_fee_pct::text || ''/'' || platform_fee_amount || ''/'' || professional_payout FROM public.service_bookings WHERE application_id = %L', :'app3')), '12/18000/132000');
SELECT public.t_err('6.3 Free NO obtiene el teléfono de la reserva', public.t_val(:'pfree2', format('SELECT phone FROM public.get_booking_contact((SELECT id FROM public.service_bookings WHERE application_id = %L))', :'app3')), 'plan_required');
SELECT public.t_err('6.4 Free NO desbloquea el contacto', public.t_val(:'pfree2', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app3')), 'plan_required');
SELECT public.t_eq('6.5 la institución sí obtiene el contacto del profesional', public.t_val(:'inst1', format('SELECT phone FROM public.get_booking_contact((SELECT id FROM public.service_bookings WHERE application_id = %L))', :'app3')), '3001112222');

-- ═══ 7) Rondas, vencimiento y reintento (oferta por hora) ═════════════════════
SELECT public.t_uuid(:'pess', format('SELECT public.apply_to_offer(%L, 24000, %L, NULL)', :'offer2', 'Propongo 24.000 por mi experiencia')) AS app2 \gset
SELECT public.t_eq('7.1 Esencial se postula con otro valor', public.q1(format('SELECT proposed_amount::text || ''/'' || posted_amount FROM public.applications WHERE id = %L', :'app2')), '24000/20000');
SELECT public.t_err('7.2 valor fuera de rango al postularse', public.t_val(:'pess', format('SELECT public.apply_to_offer(%L, 100000, NULL, NULL)', :'offer2')), 'Ya te postulaste');
SELECT public.t_eq('7.3 la institución contraoferta (ronda 2)', public.t_val(:'inst1', format('SELECT public.counter_application(%L, 22000, NULL)', :'app2')), '2');
SELECT public.t_eq('7.4 ahora espera al profesional', public.q1(format('SELECT awaiting FROM public.applications WHERE id = %L', :'app2')), 'professional');
SELECT public.t_err('7.5 la institución no puede contraofertar dos veces seguidas', public.t_val(:'inst1', format('SELECT public.counter_application(%L, 21000, NULL)', :'app2')), 'Solo quien debe responder');
SELECT public.t_eq('7.6 el profesional contraoferta (ronda 3, última)', public.t_val(:'pess', format('SELECT public.counter_application(%L, 23000, NULL)', :'app2')), '3');
SELECT public.t_err('7.7 ronda 3: la institución ya no puede contraofertar', public.t_val(:'inst1', format('SELECT public.counter_application(%L, 22500, NULL)', :'app2')), 'final_round');
SELECT public.t_err('7.8 ronda 3: el profesional tampoco puede cambiarla', public.t_val(:'pess', format('SELECT public.counter_application(%L, 23500, NULL)', :'app2')), 'final_round');
SELECT public.t_ok('7.9 la institución rechaza con nota', public.t_as(:'inst1', format('SELECT public.decline_application(%L, %L)', :'app2', 'No encaja con el presupuesto')));
SELECT public.t_eq('7.10 estado tras rechazar', public.q1(format('SELECT status::text || ''/'' || closed_reason || ''/'' || decision_note FROM public.applications WHERE id = %L', :'app2')), 'rejected/institution_declined/No encaja con el presupuesto');
SELECT public.t_err('7.11 no puede volver a postularse tras un rechazo', public.t_val(:'pess', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer2')), 'ya respondió');
SELECT public.t_eq('7.12 el profesional rechazado fue avisado', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''application_rejected''', :'pess')), '1');

SELECT public.t_uuid(:'pother', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer2')) AS app2b \gset
SELECT public.t_ok('7.13 el profesional retira su postulación', public.t_as(:'pother', format('SELECT public.decline_application(%L, NULL)', :'app2b')));
SELECT public.t_eq('7.14 retirada', public.q1(format('SELECT status::text || ''/'' || closed_reason FROM public.applications WHERE id = %L', :'app2b')), 'withdrawn/professional_withdrew');
SELECT public.t_uuid(:'pother', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer2')) AS app2c \gset
SELECT public.t_true('7.15 puede volver a postularse tras retirar', :'app2c' <> :'app2b');
UPDATE public.applications SET expires_at = now() - interval '1 minute' WHERE id = :'app2c';
SELECT public.t_eq('7.16 vencen las postulaciones sin respuesta', public.t_svc('SELECT public.expire_stale_applications()::text'), '1');
SELECT public.t_eq('7.17 vencida', public.q1(format('SELECT status::text || ''/'' || closed_reason FROM public.applications WHERE id = %L', :'app2c')), 'withdrawn/expired');
SELECT public.t_eq('7.18 evento «expired»', public.q1(format('SELECT count(*)::text FROM public.application_events WHERE application_id = %L AND event = ''expired''', :'app2c')), '1');
SELECT public.t_eq('7.19 aviso de vencimiento', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND title LIKE ''%%venció sin respuesta%%''', :'pother')), '1');
SELECT public.t_err('7.20 los clientes no pueden ejecutar el vencimiento', public.t_val(:'pfree', 'SELECT public.expire_stale_applications()'), 'permission denied');

-- Cruce de horarios: pfree ya tiene las noches confirmadas.
SELECT jsonb_build_object('title','Auxiliar noche – refuerzo extra','modality','shift','amount',160000,'city','Bogotá',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '36 hours', 'ends_at', now() + interval '44 hours', 'positions', 1)))::text AS offer5_json \gset
SELECT public.t_uuid(:'inst2', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offer5_json')) AS offer5 \gset
SELECT public.t_err('7.21 cruce con una reserva confirmada', public.t_val(:'pfree', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer5')), 'se cruza');

-- ═══ 8) Contrato inteligente ═══════════════════════════════════════════════════
SELECT public.t_eq('8.1 contrato pendiente de firma', public.q1(format('SELECT status FROM public.smart_contracts WHERE id = %L', :'contract1')), 'pending_signature');
SELECT public.t_eq('8.2 total del contrato', public.q1(format('SELECT total_amount::text FROM public.smart_contracts WHERE id = %L', :'contract1')), '400000');
SELECT public.t_true('8.3 hash de los términos', (SELECT terms_hash ~ '^[0-9a-f]{64}$' AND terms_hash = encode(sha256(convert_to(terms::text,'UTF8')),'hex') FROM public.smart_contracts WHERE id = :'contract1'));
SELECT public.t_eq('8.4 dos turnos ligados a las reservas', public.q1(format('SELECT count(*)::text FROM public.smart_contract_shifts WHERE contract_id = %L AND booking_id IS NOT NULL', :'contract1')), '2');
SELECT public.t_eq('8.5 los términos incluyen NIT y representante legal', public.q1(format('SELECT (terms #>> ''{parties,institution,nit}'') || ''/'' || (terms #>> ''{parties,institution,legal_representative}'') FROM public.smart_contracts WHERE id = %L', :'contract1')), '900123456-7/Ana María Duarte');
SELECT public.t_eq('8.6 los términos incluyen la dirección del servicio', public.q1(format('SELECT terms #>> ''{object,address}'' FROM public.smart_contracts WHERE id = %L', :'contract1')), 'Cra 7 # 1-1');
SELECT public.t_eq('8.7 el pago es solo por la página web', public.q1(format('SELECT terms #>> ''{economics,payment_channel}'' FROM public.smart_contracts WHERE id = %L', :'contract1')), 'platform_web_only');
SELECT public.t_eq('8.8 evento de creación', public.q1(format('SELECT string_agg(event, '','' ORDER BY seq) FROM public.smart_contract_events WHERE contract_id = %L', :'contract1')), 'created');
SELECT public.t_eq('8.9 la institución ve su contrato', public.t_val(:'inst1', format('SELECT count(*) FROM public.smart_contracts WHERE id = %L', :'contract1')), '1');
SELECT public.t_eq('8.10 el profesional ve su contrato', public.t_val(:'pfree', format('SELECT count(*) FROM public.smart_contracts WHERE id = %L', :'contract1')), '1');
SELECT public.t_eq('8.11 un tercero no ve el contrato', public.t_val(:'pother', format('SELECT count(*) FROM public.smart_contracts WHERE id = %L', :'contract1')), '0');
SELECT public.t_eq('8.12 un tercero no ve sus turnos', public.t_val(:'pother', format('SELECT count(*) FROM public.smart_contract_shifts WHERE contract_id = %L', :'contract1')), '0');
SELECT public.t_err('8.13 el cliente no puede editar el contrato', public.t_as(:'inst1', format('UPDATE public.smart_contracts SET status = ''active'' WHERE id = %L', :'contract1')), 'permission denied');
SELECT public.t_err('8.14 el cliente no puede insertar firmas', public.t_as(:'pfree', format('INSERT INTO public.smart_contract_signatures(contract_id, party, signer_id, signer_name, signer_identity, identity_method, terms_hash, body_hash, accepted_clauses, step_up, signature_hash) VALUES (%L, ''professional'', %L, ''x'', ''x'', ''x'', ''x'', ''x'', ''{}'', ''{}'', ''x'')', :'contract1', :'pfree')), 'permission denied');
SELECT public.t_err('8.15 el cliente no puede registrar firmas por RPC', public.t_val(:'pfree', format('SELECT public.record_contract_signature(%L, %L, ''x'', ''x'', ''{}'', ''{}''::jsonb, NULL, NULL)', :'contract1', :'pfree')), 'permission denied');

-- Identidad: pfree aún no tiene RETHUS verificado.
SELECT public.t_eq('8.16 pfree no está listo (falta RETHUS)', public.t_val(:'pfree', format('SELECT (public.contract_signer_readiness(%L, %L) ->> ''missing'')', :'contract1', :'pfree')), '["rethus"]');
SELECT public.t_eq('8.17 la institución verificada está lista', public.t_val(:'inst1', format('SELECT (public.contract_signer_readiness(%L, %L) ->> ''ready'')', :'contract1', :'inst1')), 'true');
SELECT public.t_err('8.18 no se consulta la identidad de otra persona', public.t_val(:'pother', format('SELECT public.contract_signer_readiness(%L, %L)', :'contract1', :'pfree')), 'No autorizado');

-- Ajuste de condiciones por la institución antes de que alguien firme.
SELECT terms_hash AS hash_v1 FROM public.smart_contracts WHERE id = :'contract1' \gset
SELECT public.t_err('8.19 el profesional no ajusta condiciones', public.t_val(:'pfree', format('SELECT public.update_contract_conditions(%L, ''{"tolerance_minutes": 5}''::jsonb)', :'contract1')), 'Solo la institución');
SELECT public.t_err('8.20 condición desconocida', public.t_val(:'inst1', format('SELECT public.update_contract_conditions(%L, ''{"hack": true}''::jsonb)', :'contract1')), 'desconocida');
SELECT public.t_err('8.21 aviso de cancelación no permitido', public.t_val(:'inst1', format('SELECT public.update_contract_conditions(%L, ''{"cancellation_notice_hours": 7}''::jsonb)', :'contract1')), 'Aviso de cancelación');
SELECT public.t_err('8.22 condiciones extra con teléfono', public.t_val(:'inst1', format('SELECT public.update_contract_conditions(%L, ''{"extra": "Llamar al 3001234567 antes"}''::jsonb)', :'contract1')), 'forbidden_content');
SELECT public.t_val(:'inst1', format('SELECT public.update_contract_conditions(%L, %L::jsonb)', :'contract1', '{"tolerance_minutes": 10, "extra": "Traer carné y documento de identidad"}')) AS hash_v2 \gset
SELECT public.t_true('8.23 el hash cambia con la nueva versión', :'hash_v2' ~ '^[0-9a-f]{64}$' AND :'hash_v2' <> :'hash_v1');
SELECT public.t_eq('8.24 versión 2 y condiciones guardadas', public.q1(format('SELECT version || ''/'' || (terms #>> ''{conditions,tolerance_minutes}'') || ''/'' || (terms ->> ''version'') FROM public.smart_contracts WHERE id = %L', :'contract1')), '2/10/2');
SELECT public.t_eq('8.25 el profesional fue avisado del cambio', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''contract_updated''', :'pfree')), '1');

-- Firma: solo service_role y con todas las garantías.
SELECT format($f$SELECT public.record_contract_signature(%%L, %%L, %%L, %%L, ARRAY['contract','credentials','confidentiality','esign'], jsonb_build_object('method','email_otp','authenticated_at', now()), 'iphash', 'ua')$f$) AS sigfmt \gset
SELECT public.t_err('8.26 firma sin identidad verificada', public.t_svc(format(:'sigfmt', :'contract1', :'pfree', :'hash_v2', repeat('a', 64))), 'identity_not_verified');
UPDATE public.professional_profiles SET rethus_verified = true, rethus_number = '12345-RTH' WHERE user_id = :'pfree';
SELECT public.t_err('8.27 firma con hash de otra versión', public.t_svc(format(:'sigfmt', :'contract1', :'pfree', :'hash_v1', repeat('a', 64))), 'terms_changed');
SELECT public.t_err('8.28 firma sin aceptar todas las declaraciones', public.t_svc(format($f$SELECT public.record_contract_signature(%L, %L, %L, %L, ARRAY['contract'], jsonb_build_object('method','email_otp','authenticated_at', now()), 'iphash', 'ua')$f$, :'contract1', :'pfree', :'hash_v2', repeat('a', 64))), 'clauses_required');
SELECT public.t_err('8.29 firma con segundo factor vencido', public.t_svc(format($f$SELECT public.record_contract_signature(%L, %L, %L, %L, ARRAY['contract','credentials','confidentiality','esign'], jsonb_build_object('method','email_otp','authenticated_at', now() - interval '1 hour'), 'iphash', 'ua')$f$, :'contract1', :'pfree', :'hash_v2', repeat('a', 64))), 'step_up_required');
SELECT public.t_err('8.30 firma sin segundo factor', public.t_svc(format($f$SELECT public.record_contract_signature(%L, %L, %L, %L, ARRAY['contract','credentials','confidentiality','esign'], NULL, 'iphash', 'ua')$f$, :'contract1', :'pfree', :'hash_v2', repeat('a', 64))), 'step_up_required');
SELECT public.t_err('8.31 firma con huella de texto inválida', public.t_svc(format(:'sigfmt', :'contract1', :'pfree', :'hash_v2', 'no-es-hash')), 'huella del texto');
SELECT public.t_err('8.32 un tercero no puede firmar', public.t_svc(format(:'sigfmt', :'contract1', :'pother', :'hash_v2', repeat('a', 64))), 'No participas');
SELECT public.t_svc(format(:'sigfmt', :'contract1', :'pfree', :'hash_v2', repeat('b', 64))) AS sign_pro \gset
SELECT public.t_true('8.33 firma del profesional registrada', :'sign_pro' NOT LIKE 'ERR%' AND (:'sign_pro'::jsonb ->> 'status') = 'partially_signed');
SELECT public.t_eq('8.34 contrato parcialmente firmado', public.q1(format('SELECT status FROM public.smart_contracts WHERE id = %L', :'contract1')), 'partially_signed');
SELECT public.t_err('8.35 no se firma dos veces', public.t_svc(format(:'sigfmt', :'contract1', :'pfree', :'hash_v2', repeat('b', 64))), 'Ya firmaste');
SELECT public.t_err('8.36 con una firma ya no se editan condiciones', public.t_val(:'inst1', format('SELECT public.update_contract_conditions(%L, ''{"tolerance_minutes": 3}''::jsonb)', :'contract1')), 'contract_locked');
SELECT public.t_eq('8.37 identidad registrada del profesional', public.q1(format('SELECT signer_identity || ''|'' || identity_method FROM public.smart_contract_signatures WHERE contract_id = %L AND party = ''professional''', :'contract1')), 'RETHUS 12345-RTH · Auxiliar de enfermería|rethus_verified+email_otp');
SELECT public.t_eq('8.38 la institución fue avisada de la firma pendiente', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''contract_signature_pending''', :'inst1')), '1');
SELECT public.t_svc(format(:'sigfmt', :'contract1', :'inst1', :'hash_v2', repeat('c', 64))) AS sign_inst \gset
SELECT public.t_true('8.39 firma de la institución → vigente', :'sign_inst' NOT LIKE 'ERR%' AND (:'sign_inst'::jsonb ->> 'fully_signed') = 'true');
SELECT public.t_eq('8.40 contrato activo', public.q1(format('SELECT status FROM public.smart_contracts WHERE id = %L', :'contract1')), 'active');
SELECT public.t_eq('8.41 cadena de eventos', public.q1(format('SELECT string_agg(event, '','' ORDER BY seq) FROM public.smart_contract_events WHERE contract_id = %L', :'contract1')), 'created,conditions_updated,signed,signed,activated');
SELECT public.t_eq('8.42 identidad de la institución', public.q1(format('SELECT signer_identity FROM public.smart_contract_signatures WHERE contract_id = %L AND party = ''institution''', :'contract1')), 'NIT 900123456-7 · Clínica Santa Fe');
SELECT public.t_eq('8.43 integridad verificada', public.t_val(:'pfree', format('SELECT (public.verify_contract_integrity(%L) ->> ''ok'')', :'contract1')), 'true');
SELECT public.t_err('8.44 un tercero no verifica el contrato', public.t_val(:'pother', format('SELECT public.verify_contract_integrity(%L)', :'contract1')), 'No autorizado');
SELECT public.t_err('8.45 el contrato firmado ya no admite más firmas', public.t_svc(format(:'sigfmt', :'contract1', :'inst1', :'hash_v2', repeat('c', 64))), 'ya no admite firmas');
SELECT public.t_eq('8.46 mis contratos (profesional)', public.t_val(:'pfree', 'SELECT count(*) FROM public.my_smart_contracts()'), '1');
SELECT public.t_eq('8.47 mis contratos: contraparte y firmas', public.t_val(:'pfree', 'SELECT counterpart_name || ''/'' || i_signed::text || ''/'' || other_signed::text FROM public.my_smart_contracts()'), 'Clínica Santa Fe/true/true');

-- Manipulación: se detecta aunque alguien con acceso total modifique los registros.
BEGIN;
  ALTER TABLE public.smart_contract_events DISABLE TRIGGER trg_smart_contract_events_immutable;
  UPDATE public.smart_contract_events SET data = '{"hack": 1}'::jsonb WHERE contract_id = :'contract1' AND seq = 3;
  ALTER TABLE public.smart_contract_events ENABLE TRIGGER trg_smart_contract_events_immutable;
  SELECT public.t_eq('8.48 alterar un evento rompe la verificación', public.q1(format('SELECT (public.verify_contract_integrity(%L) ->> ''events_ok'')', :'contract1')), 'false');
ROLLBACK;
BEGIN;
  ALTER TABLE public.smart_contract_signatures DISABLE TRIGGER trg_smart_contract_signatures_immutable;
  UPDATE public.smart_contract_signatures SET body_hash = repeat('f', 64) WHERE contract_id = :'contract1' AND party = 'professional';
  ALTER TABLE public.smart_contract_signatures ENABLE TRIGGER trg_smart_contract_signatures_immutable;
  SELECT public.t_eq('8.49 alterar una firma rompe la verificación', public.q1(format('SELECT (public.verify_contract_integrity(%L) ->> ''signatures_ok'')', :'contract1')), 'false');
ROLLBACK;
SELECT public.t_err('8.50 eventos inmutables (ni el servicio los edita)', public.t_svc(format('UPDATE public.smart_contract_events SET data = ''{}'' WHERE contract_id = %L', :'contract1')::text || '; SELECT 1'), 'inmutables');
SELECT public.t_eq('8.51 la integridad sigue intacta tras los intentos', public.q1(format('SELECT (public.verify_contract_integrity(%L) ->> ''ok'')', :'contract1')), 'true');
SELECT public.t_err('8.52 los términos no se tocan sin las acciones del contrato', public.t_svc(format('UPDATE public.smart_contracts SET terms = ''{}''::jsonb WHERE id = %L', :'contract1')::text || '; SELECT 1'), 'solo se modifica');

-- ═══ 9) Flujo de contratos anterior cerrado ═══════════════════════════════════
SELECT public.t_err('9.1 sign_contract está deshabilitado', public.t_val(:'pfree', $q$SELECT public.sign_contract('00000000-0000-0000-0000-000000000000', '123456', 'professional')$q$), 'contrato inteligente');
SELECT public.t_err('9.2 el cliente no puede insertar service_contracts', public.t_as(:'pfree', format('INSERT INTO public.service_contracts(family_id, professional_id, service_description, start_date) VALUES (%L, %L, ''x'', current_date)', :'pfree', :'pfree')), 'row-level security');

-- ═══ 10) Familia: oferta propia sin agenda → horario al aceptar; la familia ve el aviso ═══
INSERT INTO public.job_offers(id, posted_by, poster_type, title, modality, amount, city, address, contact_phone)
  VALUES ('00000000-0000-0000-0000-0000000000b1', :'fam1', 'family', 'Cuidado de adulto mayor en casa', 'hour', 18000, 'Bogotá', 'Cra 50 # 80-12 apto 301', '3118887766');
SELECT public.t_eq('10.1 la dirección de la familia también se mueve a lo privado', public.q1($q$SELECT COALESCE(address, 'NULL') || '/' || (SELECT address FROM public.job_offer_private WHERE job_offer_id = '00000000-0000-0000-0000-0000000000b1') FROM public.job_offers WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$), 'NULL/Cra 50 # 80-12 apto 301');
SELECT public.t_uuid(:'pess', $q$SELECT public.apply_to_offer('00000000-0000-0000-0000-0000000000b1', NULL, NULL, NULL)$q$) AS app4 \gset
SELECT public.t_err('10.2 sin horario no se puede aceptar', public.t_val(:'fam1', format('SELECT public.accept_application(%L, NULL)', :'app4')), 'shifts_required');
SELECT public.t_val(:'fam1', format($q$SELECT public.accept_application(%L, jsonb_build_array(jsonb_build_object('starts_at', now() + interval '300 hours', 'ends_at', now() + interval '308 hours')))::text$q$, :'app4')) AS accept4 \gset
SELECT public.t_true('10.3 la familia acepta definiendo el horario', :'accept4' NOT LIKE 'ERR%');
SELECT public.t_eq('10.3b las ofertas de familias no generan contrato', public.q1(format('SELECT count(*)::text FROM public.smart_contracts WHERE application_id = %L', :'app4')), '0');
SELECT public.t_eq('10.4 reserva de la familia con su dirección', public.q1(format('SELECT service_address FROM public.service_bookings WHERE application_id = %L', :'app4')), 'Cra 50 # 80-12 apto 301');
SELECT public.t_eq('10.5 pess (Esencial) desbloquea el contacto de la familia', public.t_val(:'pess', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app4')), '3118887766');
SELECT public.t_eq('10.6 la FAMILIA ve el aviso', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''contact_revealed''', :'fam1')), '1');
SELECT public.t_eq('10.7 la familia ve quién desbloqueó su contacto', public.t_val(:'fam1', 'SELECT counterpart_kind FROM public.opportunity_contact_reveals LIMIT 1'), 'family');

-- ═══ 10b) Extras: aceptar una contraoferta siendo Free, rechazos, contacto previo a la aceptación ═══
SELECT jsonb_build_object('title','Terapia respiratoria – turno mañana','modality','shift','amount',200000,'city','Bogotá',
  'address','Calle 53 # 10-35','contact_phone','3151239876',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '400 hours', 'ends_at', now() + interval '408 hours', 'positions', 2)))::text AS offer6_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offer6_json')) AS offer6 \gset
SELECT public.t_uuid(:'pfree2', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer6')) AS app6 \gset
SELECT public.t_eq('10b.1 la institución contraoferta a un Free', public.t_val(:'inst1', format('SELECT public.counter_application(%L, 190000, %L)', :'app6', 'Podemos pagar 190.000')), '2');
SELECT public.t_eq('10b.2 el Free ve la contraoferta en sus postulaciones', public.t_val(:'pfree2', format('SELECT proposed_amount::text || ''/'' || awaiting FROM public.my_offer_applications() WHERE application_id = %L', :'app6')), '190000/professional');
SELECT public.t_err('10b.3 el Free no puede contraofertar de vuelta', public.t_val(:'pfree2', format('SELECT public.counter_application(%L, 195000, NULL)', :'app6')), 'negotiate_rate_requires_plan');
SELECT public.t_err('10b.4 la institución no puede aceptar su propia contraoferta', public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)', :'app6')), 'Solo quien debe responder');
SELECT public.t_err('10b.5 contacto previo: el Free no puede', public.t_val(:'pfree2', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app6')), 'plan_required');
SELECT public.t_val(:'pfree2', format('SELECT public.accept_application(%L, NULL)::text', :'app6')) AS accept6 \gset
SELECT public.t_true('10b.6 el Free acepta la contraoferta de la institución', :'accept6' NOT LIKE 'ERR%');
SELECT public.t_eq('10b.7 valor acordado = el de la contraoferta', public.q1(format('SELECT agreed_amount::text FROM public.applications WHERE id = %L', :'app6')), '190000');
SELECT public.t_eq('10b.8 hay cupo para 2: la oferta sigue abierta', public.q1(format('SELECT status::text FROM public.job_offers WHERE id = %L', :'offer6')), 'open');
SELECT public.t_eq('10b.9 un cupo ocupado de 2', public.q1(format('SELECT filled || ''/'' || positions || ''/'' || status FROM public.job_offer_shifts WHERE job_offer_id = %L', :'offer6')), '1/2/open');
SELECT public.t_eq('10b.10 evento de aceptación por el profesional', public.q1(format('SELECT actor_role FROM public.application_events WHERE application_id = %L AND event = ''accepted''', :'app6')), 'professional');

-- Contacto ANTES de la aceptación (Esencial + postulación pendiente).
SELECT public.t_uuid(:'pess', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer6')) AS app7 \gset
SELECT public.t_eq('10b.11 Esencial con postulación pendiente ve la dirección', public.t_val(:'pess', format('SELECT address FROM public.reveal_offer_contact(%L)', :'app7')), 'Calle 53 # 10-35');
SELECT public.t_eq('10b.12 …y el teléfono de la oferta', public.t_val(:'pess', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app7')), '3151239876');

-- Rechazo directo por la API (formulario actual de la institución) y retiro por la API.
SELECT public.t_ok('10b.13 la institución rechaza por la API', public.t_as(:'inst1', format('UPDATE public.applications SET status = ''rejected'' WHERE id = %L', :'app7')));
SELECT public.t_eq('10b.14 queda registrado el motivo', public.q1(format('SELECT closed_reason FROM public.applications WHERE id = %L', :'app7')), 'institution_declined');
SELECT public.t_err('10b.15 tras el rechazo ya no se desbloquea el contacto', public.t_val(:'pess', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app7')), 'application_required');
SELECT public.t_uuid(:'pother', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer6')) AS app8 \gset
SELECT public.t_ok('10b.16 el profesional retira por la API', public.t_as(:'pother', format('UPDATE public.applications SET status = ''withdrawn'' WHERE id = %L', :'app8')));
SELECT public.t_eq('10b.17 motivo del retiro', public.q1(format('SELECT closed_reason FROM public.applications WHERE id = %L', :'app8')), 'professional_withdrew');
SELECT public.t_err('10b.18 no se puede reabrir una postulación cerrada por la API', public.t_as(:'pother', format('UPDATE public.applications SET status = ''pending'' WHERE id = %L', :'app8')), 'ya no está activa');
SELECT public.t_uuid(:'pother', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer6')) AS app9 \gset
SELECT public.t_eq('10b.19 la institución contraoferta y el profesional rechaza la contraoferta', public.t_val(:'inst1', format('SELECT public.counter_application(%L, 210000, NULL)', :'app9')), '2');
SELECT public.t_ok('10b.20 el profesional rechaza la contraoferta', public.t_as(:'pother', format('SELECT public.decline_application(%L, NULL)', :'app9')));
SELECT public.t_eq('10b.21 motivo: contraoferta rechazada', public.q1(format('SELECT closed_reason FROM public.applications WHERE id = %L', :'app9')), 'professional_declined_counter');

-- Reserva de familia sin oferta: el Free no obtiene el teléfono; el Esencial sí.
INSERT INTO public.service_bookings(id, client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES ('00000000-0000-0000-0000-0000000000e1', :'fam1', :'pfree2', 'confirmed', now() + interval '500 hours', 4, 25000, 100000),
         ('00000000-0000-0000-0000-0000000000e2', :'fam1', :'pess', 'confirmed', now() + interval '520 hours', 4, 25000, 100000);
SELECT public.t_err('10b.22 reserva de familia: el Free no obtiene el teléfono', public.t_val(:'pfree2', $q$SELECT phone FROM public.get_booking_contact('00000000-0000-0000-0000-0000000000e1')$q$), 'plan_required');
SELECT public.t_eq('10b.23 reserva de familia: la familia obtiene el del profesional', public.t_val(:'fam1', $q$SELECT phone FROM public.get_booking_contact('00000000-0000-0000-0000-0000000000e1')$q$), '3001112222');
SELECT public.t_eq('10b.24 reserva de familia: el Esencial obtiene el de la familia', public.t_val(:'pess', $q$SELECT phone FROM public.get_booking_contact('00000000-0000-0000-0000-0000000000e2')$q$), '3001110006');
SELECT public.t_eq('10b.25 y la familia recibe el aviso hacia su panel', public.q1(format('SELECT link FROM public.notifications WHERE user_id = %L AND type = ''contact_revealed'' ORDER BY created_at DESC LIMIT 1', :'fam1')), '/dashboard/familia');

-- Rechazar y vencer contratos.
SELECT id AS contract3 FROM public.smart_contracts WHERE application_id = :'app3' \gset
SELECT public.t_err('10b.26 un tercero no rechaza el contrato', public.t_val(:'pother', format('SELECT public.decline_contract(%L, NULL)', :'contract3')), 'No participas');
SELECT public.t_ok('10b.27 el profesional rechaza el contrato', public.t_as(:'pfree2', format('SELECT public.decline_contract(%L, %L)', :'contract3', 'No me cuadra el horario')));
SELECT public.t_eq('10b.28 contrato rechazado + evento', public.q1(format('SELECT status || ''/'' || (SELECT string_agg(event, '','' ORDER BY seq) FROM public.smart_contract_events WHERE contract_id = c.id) FROM public.smart_contracts c WHERE id = %L', :'contract3')), 'declined/created,declined');
SELECT public.t_eq('10b.29 la institución fue avisada del rechazo', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''contract_declined''', :'inst1')), '1');
SELECT public.t_err('10b.30 un contrato rechazado no se firma', public.t_svc(format($f$SELECT public.record_contract_signature(%L, %L, (SELECT terms_hash FROM public.smart_contracts WHERE id = %L), %L, ARRAY['contract','credentials','confidentiality','esign'], jsonb_build_object('method','email_otp','authenticated_at', now()), 'ip', 'ua')$f$, :'contract3', :'inst1', :'contract3', repeat('d', 64))), 'ya no admite firmas');
SELECT id AS contract6 FROM public.smart_contracts WHERE application_id = :'app6' \gset
BEGIN;
  SELECT set_config('app.contract_rpc', 'on', true) \g /dev/null
  UPDATE public.smart_contracts SET signature_deadline = now() - interval '1 minute' WHERE id = :'contract6';
  SELECT set_config('app.contract_rpc', '', true) \g /dev/null
  SELECT public.t_err('10b.31 firmar después del plazo', public.t_svc(format($f$SELECT public.record_contract_signature(%L, %L, (SELECT terms_hash FROM public.smart_contracts WHERE id = %L), %L, ARRAY['contract','credentials','confidentiality','esign'], jsonb_build_object('method','email_otp','authenticated_at', now()), 'ip', 'ua')$f$, :'contract6', :'inst1', :'contract6', repeat('e', 64))), 'contract_expired');
  SELECT public.t_eq('10b.32 el plazo vencido aparece en la verificación de identidad', public.t_val(:'inst1', format('SELECT (public.contract_signer_readiness(%L, %L) -> ''checks'' -> 0 ->> ''ok'')', :'contract6', :'inst1')), 'false');
  SELECT public.t_eq('10b.33 vencen los contratos sin firmar', public.t_svc('SELECT public.expire_stale_contracts()::text'), '1');
  SELECT public.t_eq('10b.34 contrato vencido', public.q1(format('SELECT status FROM public.smart_contracts WHERE id = %L', :'contract6')), 'expired');
COMMIT;

-- Cupo diario de desbloqueos (Esencial = 15 contrapartes distintas por día).
INSERT INTO auth.users(id, email) SELECT ('00000000-0000-0000-0000-00000000c0' || lpad(g::text, 2, '0'))::uuid, 'c' || g || '@t.co' FROM generate_series(1, 15) g;
INSERT INTO public.opportunity_contact_reveals(professional_id, family_user_id, plan)
  SELECT :'pess', ('00000000-0000-0000-0000-00000000c0' || lpad(g::text, 2, '0'))::uuid, 'essential_monthly' FROM generate_series(1, 14) g;
-- pess ya reveló 1 contraparte hoy (la familia); con 14 más son 15 → la siguiente nueva se rechaza.
SELECT public.t_uuid(:'pess', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer5')) AS app5 \gset
SELECT public.t_err('10.8 cupo diario agotado', public.t_val(:'pess', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app5')), 'quota_exceeded');
SELECT public.t_eq('10.9 una contraparte ya desbloqueada hoy no consume cupo', public.t_val(:'pess', format('SELECT phone FROM public.reveal_offer_contact(%L)', :'app4')), '3118887766');



-- ═══ 11) Cancelación de un turno: el cupo se reabre y hay aviso ═══════════════
SELECT id AS bk1 FROM public.service_bookings WHERE application_id = :'app1' ORDER BY scheduled_at LIMIT 1 \gset
SELECT public.t_ok('11.1 el profesional cancela su primer turno', public.t_as(:'pfree', format('UPDATE public.service_bookings SET status = ''cancelled'', cancel_reason = ''Imprevisto'' WHERE id = %L', :'bk1')));
SELECT public.t_eq('11.2 el cupo vuelve a abrirse', public.q1(format('SELECT filled || status FROM public.job_offer_shifts WHERE id = (SELECT job_offer_shift_id FROM public.service_bookings WHERE id = %L)', :'bk1')), '0open');
SELECT public.t_eq('11.3 la oferta se reabre como urgente', public.q1(format('SELECT status::text || ''/'' || is_urgent::text FROM public.job_offers WHERE id = %L', :'offer1')), 'open/true');
SELECT public.t_eq('11.4 la institución es avisada', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''shift_cancelled_by_professional''', :'inst1')), '1');
SELECT public.t_eq('11.5 el turno del contrato queda cancelado', public.q1(format('SELECT status FROM public.smart_contract_shifts WHERE booking_id = %L', :'bk1')), 'cancelled');
SELECT public.t_eq('11.6 evento del turno cancelado', public.q1(format('SELECT count(*)::text FROM public.smart_contract_events WHERE contract_id = %L AND event = ''shift_cancelled''', :'contract1')), '1');
SELECT public.t_eq('11.7 el turno reabierto aparece en el feed', public.t_val(:'pother', 'SELECT count(*) FROM public.list_open_institution_offers() WHERE title LIKE ''Auxiliar de enfermería UCI%'''), '1');
-- El segundo turno se completa y el contrato se cierra como completado.
SELECT id AS bk2 FROM public.service_bookings WHERE application_id = :'app1' AND status = 'confirmed' ORDER BY scheduled_at LIMIT 1 \gset
UPDATE public.service_bookings SET status = 'in_progress' WHERE id = :'bk2';
UPDATE public.service_bookings SET status = 'completed' WHERE id = :'bk2';
SELECT public.t_eq('11.8 contrato completado al cerrarse el último turno', public.q1(format('SELECT status FROM public.smart_contracts WHERE id = %L', :'contract1')), 'completed');

-- ═══ 12) Reputación de la institución ═════════════════════════════════════════
INSERT INTO public.service_bookings(id, client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  SELECT ('00000000-0000-0000-0000-00000000d0' || lpad(g::text, 2, '0'))::uuid, :'inst1',
         (ARRAY[:'pess', :'pother', :'pfree2'])[g]::uuid, 'completed', now() - interval '10 days' - (g || ' days')::interval, 8, 20000, 160000
    FROM generate_series(1, 3) g;
INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars, comment)
  SELECT ('00000000-0000-0000-0000-00000000d0' || lpad(g::text, 2, '0'))::uuid, (ARRAY[:'pess', :'pother', :'pfree2'])[g]::uuid, :'inst1',
         (ARRAY[5, 4, 5])[g], (ARRAY['Excelente trato, llamé al 3001234567', 'Buena coordinación', 'Muy organizados'])[g]
    FROM generate_series(1, 3) g;
INSERT INTO public.service_rating_dimensions(booking_id, rater_id, rated_id, rater_role, scores)
  SELECT ('00000000-0000-0000-0000-00000000d0' || lpad(g::text, 2, '0'))::uuid, (ARRAY[:'pess', :'pother', :'pfree2'])[g]::uuid, :'inst1', 'professional',
         '{"clarity":5,"treatment":4,"payment":5,"environment":4}'::jsonb
    FROM generate_series(1, 3) g;
SELECT public.t_eq('12.1 reputación: 3 calificaciones', public.t_val(:'pfree', format('SELECT ratings_count::text || ''/'' || stars_avg::text FROM public.institution_reputation(%L)', :'inst1')), '3/4.67');
SELECT public.t_eq('12.2 reputación: dimensiones con ≥3 calificaciones', public.t_val(:'pfree', format('SELECT jsonb_array_length(dimensions)::text FROM public.institution_reputation(%L)', :'inst1')), '4');
SELECT public.t_eq('12.3 reputación: servicios completados (3 sembrados + el turno completado)', public.t_val(:'pfree', format('SELECT completed_services::text FROM public.institution_reputation(%L)', :'inst1')), '4');
SELECT public.t_err('12.4 una familia no consulta la reputación', public.t_val(:'fam1', format('SELECT * FROM public.institution_reputation(%L)', :'inst1')), 'No autorizado');
SELECT public.t_true('12.5 el comentario se limpia de teléfonos', (SELECT comment NOT LIKE '%3001234567%' FROM public.service_ratings WHERE booking_id = '00000000-0000-0000-0000-00000000d001'));
SELECT public.t_eq('12.6 reputación visible en el feed (≥3)', public.t_val(:'pother', 'SELECT rating_avg::text FROM public.list_open_institution_offers() WHERE title LIKE ''Auxiliar de enfermería UCI%'''), '4.67');

-- ═══ 13) Bandejas y oferta de talento ═════════════════════════════════════════
SELECT public.t_true('13.1 buzón de la institución', (SELECT public.t_val(:'inst1', 'SELECT count(*) FROM public.institution_application_inbox()')::int >= 4));
SELECT public.t_err('13.2 buzón vedado a profesionales', public.t_val(:'pfree', 'SELECT count(*) FROM public.institution_application_inbox()'), 'No autorizado');
SELECT public.t_eq('13.3 el buzón trae RETHUS y calificación del postulante', public.t_val(:'inst1', format('SELECT rethus_verified::text || ''/'' || professional_name FROM public.institution_application_inbox() WHERE application_id = %L', :'app1')), 'true/Laura Gómez Pérez');
SELECT public.t_eq('13.4 el buzón trae el estado del contrato', public.t_val(:'inst1', format('SELECT contract_status FROM public.institution_application_inbox() WHERE application_id = %L', :'app1')), 'completed');
SELECT public.t_eq('13.5 mis postulaciones (profesional)', public.t_val(:'pfree', format('SELECT status || ''/'' || COALESCE(contract_status, ''-'') FROM public.my_offer_applications() WHERE application_id = %L', :'app1')), 'accepted/completed');
SELECT public.t_eq('13.6 oferta de talento: muestra pequeña → NULL', public.t_val(:'inst1', 'SELECT COALESCE(professionals::text, ''NULL'') FROM public.market_supply_snapshot(''Bogotá'', NULL)'), 'NULL');
SELECT public.t_err('13.7 oferta de talento: vedada a profesionales', public.t_val(:'pfree', 'SELECT * FROM public.market_supply_snapshot(''Bogotá'', NULL)'), 'No autorizado');

-- ═══ 14) Auditoría de permisos ════════════════════════════════════════════════
SELECT public.t_true('14.1 RLS activo en todas las tablas nuevas', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('job_offer_private','job_offer_shifts','application_events','smart_contracts','smart_contract_shifts','smart_contract_signatures','smart_contract_events','offer_team_invites')
     AND NOT c.relrowsecurity));
SELECT public.t_true('14.2 nada de lo nuevo es ejecutable por anon', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('publish_institution_offer','list_open_institution_offers','apply_to_offer','counter_application','decline_application','accept_application','reveal_offer_contact','get_booking_contact','my_offer_applications','institution_application_inbox','market_supply_snapshot','update_contract_conditions','decline_contract','contract_signer_readiness','verify_contract_integrity','my_smart_contracts','record_contract_signature','create_contract_for_application','append_contract_event','consume_reveal_quota','expire_stale_contracts','expire_stale_applications','notify_offer_alerts','institution_reputation','invite_team_to_offer')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')));
SELECT public.t_true('14.3 funciones internas no ejecutables por authenticated', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('record_contract_signature','create_contract_for_application','append_contract_event','consume_reveal_quota','expire_stale_contracts','expire_stale_applications','notify_offer_alerts','hx_notify')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
SELECT public.t_true('14.4 las tablas de contrato no admiten escritura de authenticated', NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
   WHERE grantee = 'authenticated' AND table_schema = 'public'
     AND table_name IN ('smart_contracts','smart_contract_shifts','smart_contract_signatures','smart_contract_events','application_events','offer_team_invites')
     AND privilege_type IN ('INSERT','UPDATE','DELETE')));


-- ═══ 14b) La banda de negociación coincide con la tabla de referencia (misma que verifica TypeScript) ═══
CREATE TABLE public._band_golden (modality text, posted integer, bmin integer, bmax integer);
\copy public._band_golden FROM 'band_golden.csv' WITH (FORMAT csv)
SELECT public.t_true('14.5 la tabla de referencia de la banda no está vacía', (SELECT count(*) FROM public._band_golden) > 100);
SELECT public.t_eq('14.6 offer_band_min/max coinciden con la tabla de referencia', (SELECT count(*) FILTER (WHERE public.offer_band_min(posted, modality) <> bmin OR public.offer_band_max(posted, modality) <> bmax)::text FROM public._band_golden), '0');

-- ═══ 15) Equipo de confianza ══════════════════════════════════════════════════
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', jsonb_build_object(
  'title', 'Auxiliar de enfermería hospitalización', 'modality', 'shift', 'amount', 150000, 'city', 'Bogotá',
  'specialty_required', 'Auxiliar de enfermería',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '700 hours', 'ends_at', now() + interval '708 hours', 'positions', 2)))::text)) AS offer7 \gset
INSERT INTO public.care_favorites(client_id, professional_id) VALUES (:'inst1', :'pess'), (:'inst1', :'pother'), (:'inst1', :'pfree2');
SELECT public.t_uuid(:'pfree2', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offer7')) AS app_inv \gset
SELECT public.t_eq('15.1 invita a los favoritos que aún no se postulan', public.t_val(:'inst1', format('SELECT public.invite_team_to_offer(%L)::text', :'offer7')), '2');
SELECT public.t_eq('15.2 cada invitado recibe su aviso', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE type = ''team_invite'' AND user_id IN (%L, %L)', :'pess', :'pother')), '2');
SELECT public.t_eq('15.3 quien ya se postuló no recibe invitación', public.q1(format('SELECT count(*)::text FROM public.notifications WHERE type = ''team_invite'' AND user_id = %L', :'pfree2')), '0');
SELECT public.t_eq('15.4 invitar de nuevo no repite avisos', public.t_val(:'inst1', format('SELECT public.invite_team_to_offer(%L)::text', :'offer7')), '0');
SELECT public.t_err('15.5 solo quien publicó puede invitar', public.t_val(:'inst2', format('SELECT public.invite_team_to_offer(%L)::text', :'offer7')), 'No autorizado');
SELECT public.t_err('15.6 un profesional no invita', public.t_val(:'pess', format('SELECT public.invite_team_to_offer(%L)::text', :'offer7')), 'No autorizado');
SELECT public.t_eq('15.7 el invitado ve su invitación', public.t_val(:'pess', 'SELECT count(*)::text FROM public.offer_team_invites'), '1');
SELECT public.t_eq('15.8 otro profesional no ve invitaciones ajenas', public.t_val(:'pfree', 'SELECT count(*)::text FROM public.offer_team_invites'), '0');
SELECT public.t_err('15.9 el cliente no escribe invitaciones directamente', public.t_as(:'inst1', format('INSERT INTO public.offer_team_invites(job_offer_id, professional_id, invited_by) VALUES (%L, %L, %L)', :'offer7', :'pfree', :'inst1')), 'permission denied');
SELECT public.t_eq('15.10 el aviso lleva al panel del profesional', public.q1(format('SELECT link FROM public.notifications WHERE type = ''team_invite'' AND user_id = %L', :'pess')), '/dashboard/profesional');
UPDATE public.job_offers SET status = 'closed' WHERE id = :'offer7';
SELECT public.t_err('15.11 no se invita a una oferta cerrada', public.t_val(:'inst1', format('SELECT public.invite_team_to_offer(%L)::text', :'offer7')), 'ya no está abierta');

-- ═══ Resumen ═══════════════════════════════════════════════════════════════════
\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
