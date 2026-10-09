\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- ═══ Utilidades de prueba ═══════════════════════════════════════════════════════
CREATE TABLE public._t (n serial, ok boolean, name text, detail text);

CREATE FUNCTION public.t_run(u uuid, r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text; v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt INTO v_res; v_res := COALESCE(v_res, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM || COALESCE(' | hint=' || NULLIF(v_hint, ''), '');
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

-- Sentencia (INSERT/UPDATE/DELETE) como usuario autenticado → 'OK' o el error.
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

CREATE FUNCTION public.t_val(u uuid, q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(u, 'authenticated', q) $$;
CREATE FUNCTION public.t_anon(q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(NULL, 'anon', q) $$;
CREATE FUNCTION public.t_svc(q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(NULL, 'service_role', q) $$;

CREATE FUNCTION public.t_int(u uuid, q text) RETURNS integer LANGUAGE sql AS
$$ SELECT CASE WHEN r LIKE 'ERR%' OR r = 'NULL' THEN -1 ELSE r::integer END FROM (SELECT public.t_val(u, q) AS r) x $$;

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
CREATE FUNCTION public.q1(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE q INTO r; RETURN COALESCE(r, 'NULL'); END $$;
-- Cuenta notificaciones de un tipo para un usuario.
CREATE FUNCTION public.n_of(u uuid, t text) RETURNS text LANGUAGE sql AS
$$ SELECT count(*)::text FROM public.notifications WHERE user_id = u AND type = t $$;

-- ═══ Datos base ═════════════════════════════════════════════════════════════════
\set fam1 '00000000-0000-0000-0000-0000000000f1'
\set fam2 '00000000-0000-0000-0000-0000000000f2'
\set out1 '00000000-0000-0000-0000-0000000000f3'
\set rel1 '00000000-0000-0000-0000-0000000000e1'
\set rel2 '00000000-0000-0000-0000-0000000000e2'
\set rel3 '00000000-0000-0000-0000-0000000000e3'
\set pro1 '00000000-0000-0000-0000-0000000000a1'
\set pro2 '00000000-0000-0000-0000-0000000000a2'
\set pro3 '00000000-0000-0000-0000-0000000000a3'
\set pro4 '00000000-0000-0000-0000-0000000000a4'
\set pblock '00000000-0000-0000-0000-0000000000a5'
\set inst1 '00000000-0000-0000-0000-000000000001'
\set inst2 '00000000-0000-0000-0000-000000000002'
\set staff '00000000-0000-0000-0000-00000000005a'

INSERT INTO auth.users(id, email) VALUES
  (:'fam1','fam1@t.co'),(:'fam2','fam2@t.co'),(:'out1','out1@t.co'),(:'rel1','rel1@t.co'),(:'rel2','rel2@t.co'),(:'rel3','rel3@t.co'),
  (:'pro1','pro1@t.co'),(:'pro2','pro2@t.co'),(:'pro3','pro3@t.co'),(:'pro4','pro4@t.co'),(:'pblock','pblock@t.co'),
  (:'inst1','inst1@t.co'),(:'inst2','inst2@t.co'),(:'staff','staff@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'fam1','family'),(:'fam2','family'),(:'out1','family'),(:'rel1','family'),(:'rel2','family'),(:'rel3','family'),
  (:'pro1','professional'),(:'pro2','professional'),(:'pro3','professional'),(:'pro4','professional'),(:'pblock','professional'),
  (:'inst1','institution'),(:'inst2','institution'),(:'staff','superadmin');
INSERT INTO public.profiles(user_id, full_name, phone, city, email) VALUES
  (:'fam1','Marta Rojas Díaz','3001110001','Bogotá','fam1@t.co'),(:'fam2','Julián Torres Vega','3001110002','Bogotá','fam2@t.co'),
  (:'out1','Otra Familia Ruiz','3001110003','Bogotá','out1@t.co'),(:'rel1','Pablo Rojas Díaz','3001110004','Cali','rel1@t.co'),
  (:'rel2','Rosa Díaz Mora','3001110005','Bogotá','rel2@t.co'),(:'rel3','Luis Rojas Mora','3001110006','Bogotá','rel3@t.co'),
  (:'pro1','Laura Gómez Pérez','3009990001','Bogotá','pro1@t.co'),(:'pro2','Camilo Ríos Soto','3009990002','Bogotá','pro2@t.co'),
  (:'pro3','Diana Mora Cruz','3009990003','Bogotá','pro3@t.co'),(:'pro4','Andrés Peña Luna','3009990004','Bogotá','pro4@t.co'),
  (:'pblock','Bloqueado Uno','3009990005','Bogotá','pblock@t.co'),
  (:'inst1','Clínica Santa Fe SAS',NULL,'Bogotá','inst1@t.co'),(:'inst2','Hospital San Rafael',NULL,'Medellín','inst2@t.co');
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, nit, city, address, verified) VALUES
  (:'inst1','Clínica Santa Fe','Clínica','900123456-7','Bogotá','Cra 15 # 100-20',true),
  (:'inst2','Hospital San Rafael','Hospital','800765432-1','Medellín',NULL,false);
INSERT INTO public.professional_profiles(user_id, specialty, rethus_verified, home_city, service_cities, published, available, blocked, avg_rating, total_jobs) VALUES
  (:'pro1','Auxiliar de enfermería',false,'Bogotá','{Bogotá}',true,true,false,4.8,12),
  (:'pro2','Auxiliar de enfermería',true,'Bogotá','{Bogotá}',true,true,false,4.6,8),
  (:'pro3','Enfermería',true,'Bogotá','{Bogotá}',true,true,false,4.9,30),
  (:'pro4','Fisioterapia',true,'Bogotá','{Bogotá}',true,true,false,4.2,3),
  (:'pblock','Enfermería',true,'Bogotá','{Bogotá}',true,true,true,3.0,1);
-- Planes: pro2 Esencial, inst1 IPS. Todos los demás son Free (sin fila en mp_subscriptions).
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES
  (:'pro2','essential_monthly','active', now() + interval '20 days'),
  (:'inst1','institution_monthly','active', now() + interval '20 days');
-- Círculo de cuidado de fam1: rel1 (aceptado, ve servicios), rel2 (aceptado, sin permiso de ver), rel3 (solo invitado).
INSERT INTO public.care_circle_members(owner_id, invited_email, member_id, relation, can_view_services, status, accepted_at) VALUES
  (:'fam1','rel1@t.co',:'rel1','hermano',true,'accepted',now()),
  (:'fam1','rel2@t.co',:'rel2','tía',false,'accepted',now()),
  (:'fam1','rel3@t.co',NULL,'primo',true,'invited',NULL);

-- Reserva de la familia con pro1 (confirmada, a futuro).
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount, service_address)
  VALUES (:'fam1', :'pro1', 'confirmed', now() + interval '2 hours', 4, 25000, 100000, 'Cra 7 # 45-10') RETURNING id)
SELECT id AS bk1 FROM ins \gset

-- ═══ 1) El parte solo se abre cuando el servicio está en curso ═════════════════
SELECT public.t_err('1.1 no se escribe antes de empezar (confirmado)',
  public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Hola')$q$, :'bk1', :'pro1')), 'en curso');
SELECT public.t_eq('1.2 sin llegada registrada antes de empezar', public.q1(format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_ok('1.3 el profesional sale en ruta', public.t_as(:'pro1', format($q$UPDATE public.service_bookings SET status = 'in_route', started_at = now() WHERE id = %L$q$, :'bk1')));
SELECT public.t_eq('1.4 en ruta tampoco hay llegada', public.q1(format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_ok('1.5 el profesional llega (en curso)', public.t_as(:'pro1', format($q$UPDATE public.service_bookings SET status = 'in_progress', arrived_at = now() WHERE id = %L$q$, :'bk1')));
SELECT public.t_eq('1.6 la llegada se registra sola', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'arrival' AND system_generated$q$, :'bk1')), '1');
SELECT public.t_eq('1.7 la llegada queda atribuida al profesional del servicio', public.q1(format($q$SELECT professional_id::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'arrival'$q$, :'bk1')), :'pro1');
SELECT public.t_eq('1.8 la familia recibe «ya está con el paciente»', public.n_of(:'fam1', 'care_started'), '1');
SELECT public.t_eq('1.9 el aviso usa el nombre corto del profesional', public.q1(format($q$SELECT title FROM public.notifications WHERE user_id = %L AND type = 'care_started'$q$, :'fam1')), 'Laura P. ya está con el paciente');
SELECT public.t_eq('1.10 el aviso lleva al detalle del servicio', public.q1(format($q$SELECT link FROM public.notifications WHERE user_id = %L AND type = 'care_started'$q$, :'fam1')), '/servicio/' || :'bk1');
SELECT public.t_eq('1.11 el hermano del círculo también se entera', public.n_of(:'rel1', 'care_started'), '1');
SELECT public.t_eq('1.12 quien no puede ver servicios no recibe aviso', public.n_of(:'rel2', 'care_started'), '0');
SELECT public.t_eq('1.13 quien solo está invitado no recibe aviso', public.n_of(:'rel3', 'care_started'), '0');
SELECT public.t_eq('1.14 otra familia no recibe aviso', public.n_of(:'out1', 'care_started'), '0');

-- ═══ 2) Escribir el parte: validaciones y falsificación ═══════════════════════
SELECT public.t_ok('2.1 medicamento', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'medication', 'Tomó losartán 50 mg a las 8:00 a.m. y metformina 850 mg con el almuerzo')$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.2 signos vitales', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, vital_systolic, vital_diastolic, vital_heart_rate, vital_temperature, vital_oxygen) VALUES (%L, %L, 'vital_signs', 'Presión 120/80, FC 72, SpO2 97%%, temperatura 36.5 °C', 120, 80, 72, 36.5, 97)$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.3 comida', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'meal', 'Almorzó sopa y arroz, comió 3/4 del plato y tomó 250 ml de agua')$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.4 actividad', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'activity', 'Caminó 15 minutos por el pasillo con andador, sin dolor')$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.5 texto clínico con «123» y fracciones no se bloquea', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Se llamó a la línea 123 por precaución; dolor 7/10 en rodilla derecha desde las 10:30')$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.6 inyectable y dosis', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'medication', 'Aplicó enoxaparina 40 mg en abdomen, rotando el sitio de inyección')$q$, :'bk1', :'pro1')));
SELECT public.t_ok('2.7 ánimo del paciente en una nota', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, mood) VALUES (%L, %L, 'note', 'Estuvo de buen humor y conversó con su nieto por videollamada', 'happy')$q$, :'bk1', :'pro1')));
SELECT public.t_err('2.8 ánimo inválido se rechaza', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, mood) VALUES (%L, %L, 'note', 'Nota', 'furious')$q$, :'bk1', :'pro1')), 'care_logs_mood_check');
SELECT public.t_err('2.9 teléfono en el parte se rechaza', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Escríbeme al 3001234567 para coordinar')$q$, :'bk1', :'pro1')), 'teléfonos');
SELECT public.t_err('2.10 instrucciones de pago se rechazan', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Pásame la plata por transferencia a la cuenta de ahorros')$q$, :'bk1', :'pro1')), 'pagos');
SELECT public.t_err('2.11 correo en el parte se rechaza', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Mi correo es laura@correo.com')$q$, :'bk1', :'pro1')), 'correos');
SELECT public.t_err('2.12 descripción vacía se rechaza', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', '   ')$q$, :'bk1', :'pro1')), 'care_logs_description_check');
SELECT public.t_err('2.13 tipo de evento inválido se rechaza', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'party', 'Fiesta')$q$, :'bk1', :'pro1')), 'care_logs_event_type_check');
SELECT public.t_err('2.14 signos vitales fuera de rango se rechazan', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, vital_oxygen) VALUES (%L, %L, 'vital_signs', 'SpO2', 120)$q$, :'bk1', :'pro1')), 'care_logs_vital_oxygen_check');

-- Falsificación: quien no es el profesional del servicio no puede escribir en su parte.
SELECT public.t_err('2.15 otro profesional no escribe en el parte ajeno', public.t_as(:'pro3', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Intento ajeno')$q$, :'bk1', :'pro3')), 'Solo el profesional del servicio');
SELECT public.t_err('2.16 ni siquiera usando el id del verdadero profesional', public.t_as(:'pro3', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Suplantación')$q$, :'bk1', :'pro1')), 'Solo el profesional del servicio');
SELECT public.t_err('2.17 la familia no escribe en el parte', public.t_as(:'fam1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Nota de la familia')$q$, :'bk1', :'pro1')), 'Solo el profesional del servicio');
SELECT public.t_err('2.18 un anónimo no escribe', public.t_anon(format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Anónimo')$q$, :'bk1', :'pro1')), 'permission denied');
SELECT public.t_err('2.19 la llegada no se puede registrar a mano', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'arrival', 'Llegué hace una hora')$q$, :'bk1', :'pro1')), 'se registran solas');
SELECT public.t_err('2.20 la salida no se puede registrar a mano', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'departure', 'Salí')$q$, :'bk1', :'pro1')), 'se registran solas');
SELECT public.t_err('2.21 reserva inexistente', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (gen_random_uuid(), %L, 'note', 'Nada')$q$, :'pro1')), 'Servicio no encontrado');
SELECT public.t_eq('2.22 la atribución se fuerza al profesional real aunque se envíe otro id',
  public.t_val(:'pro1', format($q$WITH i AS (INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Id ajeno enviado') RETURNING professional_id) SELECT professional_id::text FROM i$q$, :'bk1', :'pro3')), :'pro1');
SELECT public.t_eq('2.23 foto y paciente se sanean', public.t_val(:'pro1', format($q$WITH i AS (INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, photo_url, patient_name) VALUES (%L, %L, 'note', 'Con foto', 'https://x.co/a.jpg', '   Rosa Díaz   ') RETURNING photo_url, patient_name) SELECT COALESCE(photo_url, 'sin-foto') || '|' || patient_name FROM i$q$, :'bk1', :'pro1')), 'sin-foto|Rosa Díaz');
SELECT public.t_err('2.24 no se edita un registro', public.t_as(:'pro1', format($q$UPDATE public.care_logs SET description = 'Cambiado' WHERE booking_id = %L$q$, :'bk1')), 'permission denied');
SELECT public.t_err('2.25 no se borra un registro', public.t_as(:'pro1', format($q$DELETE FROM public.care_logs WHERE booking_id = %L$q$, :'bk1')), 'permission denied');
SELECT public.t_err('2.26 la familia tampoco edita', public.t_as(:'fam1', format($q$UPDATE public.care_logs SET description = 'Cambiado' WHERE booking_id = %L$q$, :'bk1')), 'permission denied');
SELECT public.t_err('2.27 la familia tampoco borra', public.t_as(:'fam1', format($q$DELETE FROM public.care_logs WHERE booking_id = %L$q$, :'bk1')), 'permission denied');

-- Alertas: avisan de inmediato a la familia y al círculo; nunca se bloquean por contenido.
SELECT public.t_ok('2.28 incidente (con un teléfono de emergencia en el texto)', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'incident', 'Caída leve en el baño, sin golpe en la cabeza. Se avisó al hijo al 3001234567')$q$, :'bk1', :'pro1')));
SELECT public.t_eq('2.29 el incidente queda como alerta con motivo', public.q1(format($q$SELECT is_alert::text || '|' || (alert_reason IS NOT NULL)::text || '|' || (notified_at IS NOT NULL)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'incident'$q$, :'bk1')), 'true|true|true');
SELECT public.t_eq('2.30 la familia recibe la alerta', public.n_of(:'fam1', 'care_alert'), '1');
SELECT public.t_eq('2.31 el círculo recibe la alerta', public.n_of(:'rel1', 'care_alert'), '1');
SELECT public.t_eq('2.32 quien no ve servicios no recibe la alerta', public.n_of(:'rel2', 'care_alert'), '0');
SELECT public.t_eq('2.33 la alerta lleva al servicio', public.q1(format($q$SELECT link FROM public.notifications WHERE user_id = %L AND type = 'care_alert'$q$, :'fam1')), '/servicio/' || :'bk1');
SELECT public.t_ok('2.34 alerta marcada a mano (SpO2 baja)', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, vital_oxygen, is_alert, alert_reason) VALUES (%L, %L, 'vital_signs', 'Saturación baja, se elevó la cabecera', 89, true, 'SpO2 89%%')$q$, :'bk1', :'pro1')));
SELECT public.t_eq('2.35 segunda alerta a la familia', public.n_of(:'fam1', 'care_alert'), '2');
SELECT public.t_eq('2.36 un registro normal no genera alerta', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND is_alert$q$, :'bk1')), '2');

-- Tope de registros por turno (se llena con código de servidor, que no pasa por la guardia de usuario).
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'fam2', :'pro4', 'in_progress', now() + interval '300 hours', 2, 20000, 40000) RETURNING id)
SELECT id AS bkcap FROM ins \gset
INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) SELECT :'bkcap', :'pro4', 'note', 'n' || g FROM generate_series(1, 200) g;
SELECT public.t_err('2.37 tope de 200 registros por turno', public.t_as(:'pro4', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Uno más')$q$, :'bkcap', :'pro4')), 'demasiados registros');
SELECT public.t_eq('2.38 el código de servidor (service_role) sí puede escribir', public.t_svc(format($q$WITH i AS (INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Nota del servidor') RETURNING id) SELECT 'OK' FROM i$q$, :'bk1', :'pro3')), 'OK');
SELECT public.t_eq('2.39 y queda atribuida al profesional real de la reserva', public.q1(format($q$SELECT professional_id::text FROM public.care_logs WHERE booking_id = %L AND description = 'Nota del servidor'$q$, :'bk1')), :'pro1');

-- ═══ 3) Quién ve el parte ═════════════════════════════════════════════════════
SELECT count(*) AS nlogs FROM public.care_logs WHERE booking_id = :'bk1' \gset
SELECT public.t_eq('3.1 el profesional ve todo el parte', public.t_val(:'pro1', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), :'nlogs');
SELECT public.t_eq('3.2 la familia ve todo el parte', public.t_val(:'fam1', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), :'nlogs');
SELECT public.t_eq('3.3 el hermano del círculo ve todo el parte', public.t_val(:'rel1', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), :'nlogs');
SELECT public.t_eq('3.4 quien no tiene permiso de ver servicios no ve el parte', public.t_val(:'rel2', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_eq('3.5 quien solo está invitado no ve el parte', public.t_val(:'rel3', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_eq('3.6 otra familia no ve el parte', public.t_val(:'out1', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_eq('3.7 otro profesional no ve el parte', public.t_val(:'pro3', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_eq('3.8 una institución ajena no ve el parte', public.t_val(:'inst2', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), '0');
SELECT public.t_eq('3.9 un anónimo no ve el parte', public.t_anon(format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), 'ERR[42501] permission denied for table care_logs');
SELECT public.t_eq('3.10 el superadmin ve el parte', public.t_val(:'staff', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk1')), :'nlogs');

SELECT public.t_eq('3.11 get_care_summary para la familia', public.t_val(:'fam1', format('SELECT event_count::text || ''|'' || has_vitals::text || ''|'' || has_incident::text FROM public.get_care_summary(%L)', :'bk1')), :'nlogs' || '|true|true');
SELECT public.t_eq('3.12 get_care_summary para el círculo', public.t_val(:'rel1', format('SELECT event_count::text FROM public.get_care_summary(%L)', :'bk1')), :'nlogs');
SELECT public.t_err('3.13 get_care_summary niega a un extraño', public.t_val(:'out1', format('SELECT event_count::text FROM public.get_care_summary(%L)', :'bk1')), 'No autorizado');
SELECT public.t_err('3.14 get_care_summary niega a un invitado sin aceptar', public.t_val(:'rel3', format('SELECT event_count::text FROM public.get_care_summary(%L)', :'bk1')), 'No autorizado');
SELECT public.t_err('3.15 get_care_summary no se ofrece a anónimos', public.t_anon(format('SELECT event_count::text FROM public.get_care_summary(%L)', :'bk1')), 'permission denied');

SELECT public.t_val(:'fam1', format('SELECT public.care_report(%L)::text', :'bk1')) AS report1 \gset
SELECT public.t_true('3.16 el reporte es un JSON', :'report1' NOT LIKE 'ERR%');
SELECT public.t_eq('3.17 reporte: eventos del profesional', (:'report1'::jsonb ->> 'events'), (:'nlogs'::int - 1)::text);
SELECT public.t_eq('3.18 reporte: signos vitales', (:'report1'::jsonb ->> 'vitals_count'), '2');
SELECT public.t_eq('3.19 reporte: alertas e incidentes', (:'report1'::jsonb ->> 'alerts') || '|' || (:'report1'::jsonb ->> 'incidents'), '2|1');
SELECT public.t_eq('3.20 reporte: último signo vital es la saturación baja', (:'report1'::jsonb -> 'last_vitals' ->> 'oxygen'), '89');
SELECT public.t_eq('3.21 reporte: una lectura de ánimo', jsonb_array_length(:'report1'::jsonb -> 'moods')::text, '1');
SELECT public.t_eq('3.22 reporte: nombre corto del profesional', (:'report1'::jsonb ->> 'professional'), 'Laura P.');
SELECT public.t_eq('3.23 reporte: por tipo', (:'report1'::jsonb -> 'by_type' ->> 'medication'), '2');
SELECT public.t_true('3.24 reporte: hora de llegada', (:'report1'::jsonb ->> 'started_at') IS NOT NULL);
SELECT public.t_eq('3.25 reporte visible para el círculo', public.t_val(:'rel1', format('SELECT (public.care_report(%L) ->> ''status'')', :'bk1')), 'in_progress');
SELECT public.t_err('3.26 reporte niega a un extraño', public.t_val(:'out1', format('SELECT public.care_report(%L)::text', :'bk1')), 'No autorizado');
SELECT public.t_err('3.27 reporte niega a un anónimo', public.t_anon(format('SELECT public.care_report(%L)::text', :'bk1')), 'permission denied');

-- ═══ 4) Cierre del turno ═══════════════════════════════════════════════════════
SELECT public.t_ok('4.1 el profesional finaliza el servicio', public.t_as(:'pro1', format($q$UPDATE public.service_bookings SET status = 'completed', completed_at = now() WHERE id = %L$q$, :'bk1')));
SELECT public.t_eq('4.2 la salida se registra sola', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'departure' AND system_generated$q$, :'bk1')), '1');
SELECT public.t_true('4.3 la salida trae la duración', (SELECT description LIKE 'Terminó el turno%' FROM public.care_logs WHERE booking_id = :'bk1' AND event_type = 'departure'));
SELECT public.t_eq('4.4 la familia recibe «terminó el turno»', public.n_of(:'fam1', 'care_finished'), '1');
SELECT public.t_eq('4.5 el círculo recibe «terminó el turno»', public.n_of(:'rel1', 'care_finished'), '1');
SELECT public.t_true('4.6 el aviso de la familia invita a agradecer y calificar', (SELECT body ILIKE '%gracias%' AND body ILIKE '%califica%' FROM public.notifications WHERE user_id = :'fam1' AND type = 'care_finished'));
SELECT public.t_true('4.7 el aviso del círculo no pide calificar', (SELECT body NOT ILIKE '%califica%' FROM public.notifications WHERE user_id = :'rel1' AND type = 'care_finished'));
SELECT public.t_eq('4.8 el profesional celebra su primer servicio', public.n_of(:'pro1', 'career_milestone'), '1');
SELECT public.t_err('4.9 terminado el servicio ya no se escribe', public.t_as(:'pro1', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'note', 'Tarde')$q$, :'bk1', :'pro1')), 'en curso');
-- Idempotencia: el personal corrige el estado y lo vuelve a cerrar → no se duplican llegada ni salida.
SELECT public.t_ok('4.10 el personal reabre el servicio', public.t_as(:'staff', format($q$UPDATE public.service_bookings SET status = 'in_progress' WHERE id = %L$q$, :'bk1')));
SELECT public.t_ok('4.11 y lo vuelve a cerrar', public.t_as(:'staff', format($q$UPDATE public.service_bookings SET status = 'completed' WHERE id = %L$q$, :'bk1')));
SELECT public.t_eq('4.12 una sola llegada', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'arrival'$q$, :'bk1')), '1');
SELECT public.t_eq('4.13 una sola salida', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'departure'$q$, :'bk1')), '1');
SELECT public.t_eq('4.14 el hito no se repite al reabrir', public.n_of(:'pro1', 'career_milestone'), '1');
SELECT public.t_eq('4.15 el aviso de cierre a la familia no se repite', public.n_of(:'fam1', 'care_finished'), '1');
SELECT public.t_eq('4.16 el aviso de cierre al círculo no se repite', public.n_of(:'rel1', 'care_finished'), '1');
SELECT public.t_eq('4.17 el aviso de inicio no se repite', public.n_of(:'fam1', 'care_started'), '1');

-- ═══ 5) «Gracias» ═════════════════════════════════════════════════════════════
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'fam1', :'pro1', 'confirmed', now() + interval '60 hours', 2, 25000, 50000) RETURNING id)
SELECT id AS bkopen FROM ins \gset
SELECT public.t_err('5.1 no se agradece un servicio que no terminó', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], NULL)::text$q$, :'bkopen')), 'haya terminado');
SELECT public.t_err('5.2 una persona ajena no agradece', public.t_val(:'out1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], NULL)::text$q$, :'bk1')), 'No participaste');
SELECT public.t_err('5.3 el círculo no agradece en nombre de la familia', public.t_val(:'rel1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], NULL)::text$q$, :'bk1')), 'No participaste');
SELECT public.t_err('5.4 sin reconocimientos se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY[]::text[], NULL)::text$q$, :'bk1')), 'entre 1 y 3');
SELECT public.t_err('5.5 más de tres se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['punctual','caring','patient','peace_of_mind'], NULL)::text$q$, :'bk1')), 'entre 1 y 3');
SELECT public.t_err('5.6 un reconocimiento que no es de la familia se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['respectful'], NULL)::text$q$, :'bk1')), 'entre 1 y 3');
SELECT public.t_err('5.7 un reconocimiento inventado se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring','hacker'], NULL)::text$q$, :'bk1')), 'entre 1 y 3');
SELECT public.t_err('5.8 mensaje con teléfono se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], 'Llámame al 3004445566')::text$q$, :'bk1')), 'teléfonos');
SELECT public.t_err('5.9 mensaje con instrucción de pago se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], 'Te pago por nequi 3004445566')::text$q$, :'bk1')), 'pago');
SELECT public.t_err('5.10 mensaje de más de 280 caracteres se rechaza', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], %L)::text$q$, :'bk1', repeat('a', 281))), '280');
SELECT public.t_eq('5.11 sin errores no se guardó nada', public.q1('SELECT count(*)::text FROM public.care_kudos'), '0');
SELECT public.t_uuid(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['caring','punctual','caring'], '  Mi mamá la adora. Gracias por tanta paciencia  ')::text$q$, :'bk1')) AS kud1 \gset
SELECT public.t_eq('5.12 la familia agradece (se eliminan repetidos y se limpia el texto)', public.q1(format('SELECT cardinality(kinds)::text || ''|'' || message FROM public.care_kudos WHERE id = %L', :'kud1')), '2|Mi mamá la adora. Gracias por tanta paciencia');
SELECT public.t_eq('5.13 quedó atribuido a quien agradeció', public.q1(format('SELECT (from_user = %L AND to_user = %L AND from_role = ''client'')::text FROM public.care_kudos WHERE id = %L', :'fam1', :'pro1', :'kud1')), 'true');
SELECT public.t_err('5.14 no se agradece dos veces el mismo servicio', public.t_val(:'fam1', format($q$SELECT public.send_kudos(%L, ARRAY['patient'], NULL)::text$q$, :'bk1')), 'Ya enviaste');
SELECT public.t_eq('5.15 el profesional recibe el aviso con el mensaje', public.q1(format($q$SELECT n.title || '|' || n.body FROM public.notifications n WHERE n.user_id = %L AND n.type = 'kudos_received'$q$, :'pro1')), 'Marta D. te dio las gracias|«Mi mamá la adora. Gracias por tanta paciencia»');
SELECT public.t_uuid(:'pro1', format($q$SELECT public.send_kudos(%L, ARRAY['respectful','welcoming'], NULL)::text$q$, :'bk1')) AS kud2 \gset
SELECT public.t_eq('5.16 el profesional también agradece a la familia', public.q1(format('SELECT from_role FROM public.care_kudos WHERE id = %L', :'kud2')), 'professional');
SELECT public.t_err('5.17 el profesional no usa reconocimientos de la familia', public.t_val(:'pro1', format($q$SELECT public.send_kudos(%L, ARRAY['caring'], NULL)::text$q$, :'bkopen')), 'haya terminado');
SELECT public.t_eq('5.18 la familia recibe el aviso del profesional', public.n_of(:'fam1', 'kudos_received'), '1');
SELECT public.t_err('5.19 no se escribe en care_kudos por la API (insert)', public.t_as(:'fam1', format($q$INSERT INTO public.care_kudos(booking_id, from_user, to_user, from_role, kinds) VALUES (%L, %L, %L, 'client', ARRAY['caring'])$q$, :'bkopen', :'fam1', :'pro1')), 'permission denied');
SELECT public.t_err('5.20 no se edita (update)', public.t_as(:'fam1', format($q$UPDATE public.care_kudos SET message = 'x' WHERE id = %L$q$, :'kud1')), 'permission denied');
SELECT public.t_err('5.21 no se borra (delete)', public.t_as(:'fam1', format($q$DELETE FROM public.care_kudos WHERE id = %L$q$, :'kud1')), 'permission denied');
SELECT public.t_eq('5.22 el profesional ve lo enviado y lo recibido', public.t_val(:'pro1', 'SELECT count(*)::text FROM public.care_kudos'), '2');
SELECT public.t_eq('5.23 la familia ve lo enviado y lo recibido', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_kudos'), '2');
SELECT public.t_eq('5.24 otro profesional no ve nada', public.t_val(:'pro3', 'SELECT count(*)::text FROM public.care_kudos'), '0');
SELECT public.t_eq('5.25 el círculo no ve los gracias', public.t_val(:'rel1', 'SELECT count(*)::text FROM public.care_kudos'), '0');
SELECT public.t_eq('5.26 el superadmin los ve', public.t_val(:'staff', 'SELECT count(*)::text FROM public.care_kudos'), '2');
SELECT public.t_eq('5.27 anónimo: resumen público solo con lo que dan las familias',
  public.t_anon(format('SELECT string_agg(kind || '':'' || givers, '','' ORDER BY kind) FROM public.professional_kudos_summary(%L)', :'pro1')), 'caring:1,punctual:1');
SELECT public.t_eq('5.28 el resumen público no muestra lo que da el profesional', public.t_anon(format('SELECT count(*)::text FROM public.professional_kudos_summary(%L)', :'fam1')), '0');
SELECT public.t_eq('5.29 «mis gracias recibidos»: una fila con nombre corto', public.t_val(:'pro1', 'SELECT count(*)::text || ''|'' || min(from_name) FROM public.my_received_kudos()'), '1|Marta D.');
SELECT public.t_eq('5.30 la familia ve el agradecimiento del profesional', public.t_val(:'fam1', 'SELECT count(*)::text || ''|'' || min(from_name) || ''|'' || min(from_role) FROM public.my_received_kudos()'), '1|Laura P.|professional');
SELECT public.t_err('5.31 «mis gracias» no se ofrece a anónimos', public.t_anon('SELECT count(*)::text FROM public.my_received_kudos()'), 'permission denied');
SELECT public.t_eq('5.32 un tercero no ve agradecimientos ajenos', public.t_val(:'pro3', 'SELECT count(*)::text FROM public.my_received_kudos()'), '0');

-- ═══ 6) Trayectoria del profesional ═══════════════════════════════════════════
-- Servicios completados históricos de pro1 (familias distintas y varias semanas).
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount) VALUES
  (:'fam1', :'pro1', 'completed', now() - interval '7 days',  6, 25000, 150000),
  (:'fam1', :'pro1', 'completed', now() - interval '14 days', 4, 25000, 100000),
  (:'fam2', :'pro1', 'completed', now() - interval '21 days', 8, 25000, 200000),
  (:'fam2', :'pro1', 'cancelled', now() - interval '3 days',  8, 25000, 200000);
SELECT public.t_val(:'pro1', 'SELECT public.my_career_stats()::text') AS stats1 \gset
SELECT public.t_true('6.1 la trayectoria es un JSON', :'stats1' NOT LIKE 'ERR%');
SELECT public.t_eq('6.2 servicios completados (los cancelados no cuentan)', (:'stats1'::jsonb ->> 'completed_services'), '4');
SELECT public.t_eq('6.3 horas de cuidado', (:'stats1'::jsonb ->> 'hours_total'), '22.0');
SELECT public.t_eq('6.4 familias atendidas', (:'stats1'::jsonb ->> 'clients_total'), '2');
SELECT public.t_eq('6.5 familias que repiten', (:'stats1'::jsonb ->> 'repeat_clients'), '1');
SELECT public.t_eq('6.6 gracias de familias', (:'stats1'::jsonb ->> 'kudos_total'), '1');
SELECT public.t_eq('6.7 gracias por tipo', (:'stats1'::jsonb -> 'kudos_by_kind' ->> 'caring') || '|' || (:'stats1'::jsonb -> 'kudos_by_kind' ->> 'punctual'), '1|1');
SELECT public.t_eq('6.8 servicios con parte escrito', (:'stats1'::jsonb ->> 'logged_services'), '1');
SELECT public.t_eq('6.9 alertas reportadas', (:'stats1'::jsonb ->> 'alerts_reported'), '2');
SELECT public.t_true('6.10 semanas activas (al menos 3 distintas)', jsonb_array_length(:'stats1'::jsonb -> 'week_starts') >= 3);
SELECT public.t_true('6.11 las semanas empiezan en lunes', NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(:'stats1'::jsonb -> 'week_starts') w WHERE extract(isodow FROM w::date) <> 1));
SELECT public.t_err('6.12 mi trayectoria no se ofrece a anónimos', public.t_anon('SELECT public.my_career_stats()::text'), 'permission denied');
SELECT public.t_eq('6.13 la trayectoria de pro3 está en cero', public.t_val(:'pro3', 'SELECT (public.my_career_stats() ->> ''completed_services'')'), '0');
SELECT public.t_eq('6.14 versión pública: completados', public.t_anon(format('SELECT (public.professional_public_stats(%L) ->> ''completed_services'')', :'pro1')), '4');
SELECT public.t_eq('6.15 versión pública sin datos internos', public.t_anon(format($q$SELECT (public.professional_public_stats(%L) ? 'clients_total')::text || '|' || (public.professional_public_stats(%L) ? 'alerts_reported')::text || '|' || (public.professional_public_stats(%L) ? 'last_service_at')::text$q$, :'pro1', :'pro1', :'pro1')), 'false|false|false');
SELECT public.t_eq('6.16 versión pública conserva los gracias por tipo', public.t_anon(format($q$SELECT (public.professional_public_stats(%L) -> 'kudos_by_kind' ->> 'caring')$q$, :'pro1')), '1');
SELECT public.t_eq('6.17 no hay versión pública de una familia', public.t_anon(format('SELECT public.professional_public_stats(%L)::text', :'fam1')), 'NULL');
SELECT public.t_eq('6.18 no hay versión pública de un profesional bloqueado', public.t_anon(format('SELECT public.professional_public_stats(%L)::text', :'pblock')), 'NULL');

-- ═══ 7) Equipo de confianza y cancelación del profesional (familia) ═══════════
INSERT INTO public.care_favorites(client_id, professional_id) VALUES (:'fam1', :'pro1'), (:'fam1', :'pro2'), (:'fam1', :'pro3');
SELECT public.t_eq('7.1 mi equipo: tres profesionales', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.my_trusted_team()'), '3');
SELECT public.t_eq('7.2 mi equipo: primero con quien más he trabajado', public.t_val(:'fam1', 'SELECT professional_id::text FROM public.my_trusted_team() LIMIT 1'), :'pro1');
SELECT public.t_eq('7.3 mi equipo: servicios juntos', public.t_val(:'fam1', format('SELECT services_together::text FROM public.my_trusted_team() WHERE professional_id = %L', :'pro1')), '3');
SELECT public.t_eq('7.4 mi equipo: nombre corto', public.t_val(:'fam1', format('SELECT display_name FROM public.my_trusted_team() WHERE professional_id = %L', :'pro2')), 'Camilo S.');
SELECT public.t_eq('7.5 otra familia no ve mi equipo', public.t_val(:'fam2', 'SELECT count(*)::text FROM public.my_trusted_team()'), '0');
SELECT public.t_err('7.6 mi equipo no se ofrece a anónimos', public.t_anon('SELECT count(*)::text FROM public.my_trusted_team()'), 'permission denied');

-- Servicio futuro de fam1 con pro1; pro3 está ocupada en esa franja; pro2 está libre.
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'fam1', :'pro1', 'confirmed', now() + interval '200 hours', 4, 25000, 100000) RETURNING id)
SELECT id AS bkc FROM ins \gset
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'fam2', :'pro3', 'confirmed', now() + interval '201 hours', 2, 30000, 60000);
SELECT public.t_eq('7.7 cuántos del equipo están libres (sin contar a quien cancela)', public.q1(format($q$SELECT public.trusted_team_free_count(%L, %L::timestamptz + interval '200 hours', %L::timestamptz + interval '204 hours', %L)::text$q$, :'fam1', now(), now(), :'pro1')), '1');
SELECT public.t_ok('7.8 pro1 cancela el servicio', public.t_as(:'pro1', format($q$UPDATE public.service_bookings SET status = 'cancelled', cancel_reason = 'Imprevisto' WHERE id = %L$q$, :'bkc')));
SELECT public.t_eq('7.9 el aviso dice cuántos de mi equipo están libres', public.q1(format($q$SELECT body FROM public.notifications WHERE user_id = %L AND type = 'booking_cancelled' AND link = %L$q$, :'fam1', '/servicio/' || :'bkc')),
  '1 profesional de tu equipo de confianza está libre en ese horario. Pídeles que te cubran desde el detalle del servicio.');
-- Sin equipo: texto genérico.
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'out1', :'pro4', 'confirmed', now() + interval '400 hours', 3, 20000, 60000) RETURNING id)
SELECT id AS bkd FROM ins \gset
SELECT public.t_ok('7.10 pro4 cancela', public.t_as(:'pro4', format($q$UPDATE public.service_bookings SET status = 'cancelled' WHERE id = %L$q$, :'bkd')));
SELECT public.t_eq('7.11 sin equipo, el aviso es el de siempre', public.q1(format($q$SELECT body FROM public.notifications WHERE user_id = %L AND type = 'booking_cancelled' AND link = %L$q$, :'out1', '/servicio/' || :'bkd')),
  'Puedes buscar un reemplazo disponible para el mismo horario desde el detalle del servicio.');
-- Cancelación de la familia: avisa al profesional.
WITH ins AS (INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  VALUES (:'out1', :'pro4', 'confirmed', now() + interval '500 hours', 3, 20000, 60000) RETURNING id)
SELECT id AS bke FROM ins \gset
SELECT public.t_ok('7.12 la familia cancela', public.t_as(:'out1', format($q$UPDATE public.service_bookings SET status = 'cancelled' WHERE id = %L$q$, :'bke')));
SELECT public.t_eq('7.13 el profesional recibe el aviso de siempre', public.q1(format($q$SELECT body FROM public.notifications WHERE user_id = %L AND type = 'booking_cancelled' AND link = %L$q$, :'pro4', '/servicio/' || :'bke')),
  'El servicio programado fue cancelado.');
SELECT public.t_eq('7.14 una cancelación de familia no activa el plan B', public.n_of(:'out1', 'plan_b_started'), '0');

-- ═══ 8) Institución: parte del turno, plan B y gracias ═══════════════════════
SELECT jsonb_build_object('title','Auxiliar de enfermería hospitalización','modality','shift','amount',150000,'city','Bogotá',
  'specialty_required','Auxiliar de enfermería','service_area','Hospitalización',
  'address','Calle 100 # 15-20','contact_phone','3105551234',
  'shifts', jsonb_build_array(
    jsonb_build_object('starts_at', now() + interval '600 hours', 'ends_at', now() + interval '608 hours', 'positions', 1),
    jsonb_build_object('starts_at', now() + interval '624 hours', 'ends_at', now() + interval '632 hours', 'positions', 1)))::text AS offera_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offera_json')) AS offera \gset
SELECT public.t_uuid(:'pro2', format('SELECT public.apply_to_offer(%L, NULL, %L, NULL)', :'offera', 'Con experiencia en hospitalización')) AS appa \gset
SELECT public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)::text', :'appa')) AS accepta \gset
SELECT public.t_true('8.1 la institución aceptó y se crearon las reservas', :'accepta' NOT LIKE 'ERR%');
SELECT id AS bka1 FROM public.service_bookings WHERE application_id = :'appa' ORDER BY scheduled_at LIMIT 1 \gset
SELECT id AS bka2 FROM public.service_bookings WHERE application_id = :'appa' ORDER BY scheduled_at DESC LIMIT 1 \gset
SELECT public.t_eq('8.2 dos reservas de la institución', public.q1(format('SELECT count(*)::text FROM public.service_bookings WHERE application_id = %L AND client_id = %L', :'appa', :'inst1')), '2');

-- Turno 1: pro2 trabaja, la institución ve el parte (clientes institucionales).
SELECT public.t_ok('8.3 pro2 inicia el turno', public.t_as(:'pro2', format($q$UPDATE public.service_bookings SET status = 'in_progress', arrived_at = now() WHERE id = %L$q$, :'bka1')));
SELECT public.t_eq('8.4 la institución recibe el aviso de inicio con nombre corto', public.q1(format($q$SELECT title FROM public.notifications WHERE user_id = %L AND type = 'care_started'$q$, :'inst1')), 'Camilo S. ya está con el paciente');
SELECT public.t_ok('8.5 pro2 registra signos vitales', public.t_as(:'pro2', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description, vital_systolic, vital_diastolic, vital_heart_rate) VALUES (%L, %L, 'vital_signs', 'Paciente cama 12 estable', 118, 76, 70)$q$, :'bka1', :'pro2')));
SELECT public.t_ok('8.6 pro2 registra un incidente', public.t_as(:'pro2', format($q$INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (%L, %L, 'incident', 'Reacción cutánea leve tras antibiótico; se avisó a la jefe de turno')$q$, :'bka1', :'pro2')));
SELECT public.t_eq('8.7 la institución recibe la alerta', public.n_of(:'inst1', 'care_alert'), '1');
SELECT public.t_eq('8.8 la institución ve el parte de su turno', public.t_val(:'inst1', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bka1')), '3');
SELECT public.t_eq('8.9 otra institución no lo ve', public.t_val(:'inst2', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bka1')), '0');
SELECT public.t_eq('8.10 el reporte para la institución', public.t_val(:'inst1', format($q$SELECT (public.care_report(%L) ->> 'alerts') || '|' || (public.care_report(%L) ->> 'vitals_count')$q$, :'bka1', :'bka1')), '1|1');
SELECT public.t_ok('8.11 pro2 finaliza el turno', public.t_as(:'pro2', format($q$UPDATE public.service_bookings SET status = 'completed', completed_at = now() WHERE id = %L$q$, :'bka1')));
SELECT public.t_eq('8.12 la institución recibe el aviso de cierre', public.n_of(:'inst1', 'care_finished'), '1');
SELECT public.t_uuid(:'inst1', format($q$SELECT public.send_kudos(%L, ARRAY['communicative','professional'], 'Excelente trabajo en hospitalización')::text$q$, :'bka1')) AS kuda \gset
SELECT public.t_eq('8.13 la institución agradece (nombre de la institución en el aviso)', public.q1(format($q$SELECT title FROM public.notifications WHERE user_id = %L AND type = 'kudos_received'$q$, :'pro2')), 'Clínica Santa Fe te dio las gracias');

-- Plan B: equipo de la institución = pro1 (libre), pro3 (libre), pro4 (libre) + pro2 (quien cancela).
INSERT INTO public.care_favorites(client_id, professional_id) VALUES (:'inst1', :'pro1'), (:'inst1', :'pro2'), (:'inst1', :'pro3'), (:'inst1', :'pro4');
SELECT public.t_ok('8.14 pro2 cancela el segundo turno', public.t_as(:'pro2', format($q$UPDATE public.service_bookings SET status = 'cancelled', cancel_reason = 'Enfermedad' WHERE id = %L$q$, :'bka2')));
SELECT public.t_eq('8.15 el cupo vuelve a abrirse', public.q1(format($q$SELECT status::text FROM public.job_offers WHERE id = %L$q$, :'offera')), 'open');
SELECT public.t_eq('8.16 plan B: se invitó a tres del equipo (no a quien canceló)', public.q1(format('SELECT count(*)::text FROM public.offer_team_invites WHERE job_offer_id = %L', :'offera')), '3');
SELECT public.t_eq('8.17 quien canceló no recibe invitación', public.q1(format('SELECT count(*)::text FROM public.offer_team_invites WHERE job_offer_id = %L AND professional_id = %L', :'offera', :'pro2')), '0');
SELECT public.t_eq('8.18 cada invitado recibe el aviso urgente', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'team_invite_urgent' AND user_id IN (%L, %L, %L)$q$, :'pro1', :'pro3', :'pro4')), '3');
SELECT public.t_true('8.19 el aviso urgente nombra a la institución', (SELECT title = 'Clínica Santa Fe confía en ti: se liberó un turno' FROM public.notifications WHERE type = 'team_invite_urgent' AND user_id = :'pro1'));
SELECT public.t_eq('8.20 la institución sabe que se activó el plan B', public.q1(format($q$SELECT body FROM public.notifications WHERE user_id = %L AND type = 'plan_b_started'$q$, :'inst1')),
  'Avisamos a 3 profesionales de tu equipo de confianza sobre el turno que quedó libre. Te contamos apenas alguien se postule.');
SELECT public.t_eq('8.21 el aviso de plan B lleva al panel de la institución', public.q1(format($q$SELECT link FROM public.notifications WHERE user_id = %L AND type = 'plan_b_started'$q$, :'inst1')), '/dashboard/institucion');
SELECT public.t_eq('8.22 no se duplica el aviso de cancelación de siempre', public.n_of(:'inst1', 'booking_cancelled'), '0');
SELECT public.t_eq('8.23 la institución recibe el aviso del hub', public.n_of(:'inst1', 'shift_cancelled_by_professional'), '1');
SELECT public.t_eq('8.24 invitar a mano no repite a nadie', public.t_val(:'inst1', format('SELECT public.invite_team_to_offer(%L)::text', :'offera')), '0');
SELECT public.t_eq('8.25 un invitado ve su invitación', public.t_val(:'pro1', 'SELECT count(*)::text FROM public.offer_team_invites'), '1');
SELECT public.t_err('8.26 solo quien publicó puede invitar', public.t_val(:'inst2', format('SELECT public.invite_team_to_offer(%L)::text', :'offera')), 'No autorizado');
SELECT public.t_err('8.27 un profesional no puede invitar', public.t_val(:'pro1', format('SELECT public.invite_team_to_offer(%L)::text', :'offera')), 'No autorizado');
SELECT public.t_err('8.28 invite_team_core no se ofrece a usuarios', public.t_val(:'inst1', format('SELECT public.invite_team_core(%L, %L, NULL, true)::text', :'offera', :'inst1')), 'permission denied');
-- Si quien cancela es la institución, no hay plan B.
SELECT jsonb_build_object('title','Refuerzo nocturno','modality','shift','amount',160000,'city','Bogotá','specialty_required','Auxiliar de enfermería',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '700 hours', 'ends_at', now() + interval '708 hours', 'positions', 1)))::text AS offerb_json \gset
SELECT public.t_uuid(:'inst1', format('SELECT public.publish_institution_offer(%L::jsonb)', :'offerb_json')) AS offerb \gset
SELECT public.t_uuid(:'pro4', format('SELECT public.apply_to_offer(%L, NULL, NULL, NULL)', :'offerb')) AS appb \gset
SELECT public.t_val(:'inst1', format('SELECT public.accept_application(%L, NULL)::text', :'appb')) AS acceptb \gset
SELECT id AS bkb FROM public.service_bookings WHERE application_id = :'appb' LIMIT 1 \gset
SELECT public.t_ok('8.29 la institución cancela el turno', public.t_as(:'inst1', format($q$UPDATE public.service_bookings SET status = 'cancelled', cancel_reason = 'Cambio de plan' WHERE id = %L$q$, :'bkb')));
SELECT public.t_eq('8.30 la cancelación de la institución no invita a nadie', public.q1(format('SELECT count(*)::text FROM public.offer_team_invites WHERE job_offer_id = %L', :'offerb')), '0');
SELECT public.t_eq('8.31 el profesional es avisado de la cancelación', public.n_of(:'pro4', 'shift_cancelled_by_institution'), '1');

-- ═══ 9) Historia de cuidado (premium) ═════════════════════════════════════════
SELECT public.t_err('9.1 Free no accede a la historia exportable', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_history_report()'), 'plan_required');
SELECT public.t_err('9.2 anónimo no accede', public.t_anon('SELECT count(*)::text FROM public.care_history_report()'), 'permission denied');
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'fam1','essential_monthly','active', now() + interval '25 days');
SELECT public.t_true('9.3 con plan Esencial devuelve la historia pasada de la familia (los servicios futuros no cuentan)', public.t_int(:'fam1', 'SELECT count(*)::text FROM public.care_history_report()') = 3);
SELECT public.t_eq('9.4 el servicio del parte trae sus cifras', public.t_val(:'fam1', format('SELECT events::text || ''|'' || vitals || ''|'' || alerts || ''|'' || incidents || ''|'' || COALESCE(last_mood, ''-'') || ''|'' || kudos_sent::text FROM public.care_history_report() WHERE booking_id = %L', :'bk1')), '12|2|2|1|happy|true');
SELECT public.t_eq('9.5 el nombre del profesional es el corto', public.t_val(:'fam1', format('SELECT professional FROM public.care_history_report() WHERE booking_id = %L', :'bk1')), 'Laura P.');
SELECT public.t_eq('9.6 solo ve sus propios servicios', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_history_report() WHERE booking_id IN (SELECT id FROM public.service_bookings WHERE client_id <> ''' || :'fam1' || ''')'), '0');
SELECT public.t_eq('9.7 el rango de fechas filtra', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_history_report((now() + interval ''2 years'')::date, (now() + interval ''3 years'')::date)'), '0');
SELECT public.t_true('9.8 la institución con plan IPS exporta con el nombre de la oferta (2 turnos, uno cancelado)', public.t_int(:'inst1', $q$SELECT count(*)::text FROM public.care_history_report((now() - interval '1 day')::date, (now() + interval '60 days')::date) WHERE offer_title = 'Auxiliar de enfermería hospitalización'$q$) = 2);
SELECT public.t_eq('9.9 una institución sin plan no accede', public.t_val(:'inst2', 'SELECT count(*)::text FROM public.care_history_report()'), 'ERR[42501] plan_required: la historia de cuidado exportable requiere un plan de pago');
SELECT public.t_eq('9.10 un profesional no tiene servicios como cliente', public.t_val(:'pro2', 'SELECT count(*)::text FROM public.care_history_report()'), '0');
SELECT public.t_eq('9.11 el superadmin puede consultar (sin servicios propios)', public.t_val(:'staff', 'SELECT count(*)::text FROM public.care_history_report()'), '0');
-- Un plan vencido o pendiente no cuenta.
UPDATE public.mp_subscriptions SET status = 'pending' WHERE user_id = :'fam1';
SELECT public.t_err('9.12 plan pendiente = sin acceso', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_history_report()'), 'plan_required');
UPDATE public.mp_subscriptions SET status = 'active', current_period_end = now() - interval '1 day' WHERE user_id = :'fam1';
SELECT public.t_err('9.13 plan vencido = sin acceso', public.t_val(:'fam1', 'SELECT count(*)::text FROM public.care_history_report()'), 'plan_required');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '10 days' WHERE user_id = :'fam1';

-- ═══ 10) Auditoría de permisos ════════════════════════════════════════════════
SELECT public.t_eq('10.1 RLS activo en care_kudos', public.q1($$SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.care_kudos'::regclass$$), 'true');
SELECT public.t_eq('10.2 RLS activo en care_logs', public.q1($$SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.care_logs'::regclass$$), 'true');
SELECT public.t_true('10.3 anónimo sin privilegios sobre care_logs', NOT has_table_privilege('anon', 'public.care_logs', 'SELECT') AND NOT has_table_privilege('anon', 'public.care_logs', 'INSERT'));
SELECT public.t_true('10.4 anónimo sin privilegios sobre care_kudos', NOT has_table_privilege('anon', 'public.care_kudos', 'SELECT') AND NOT has_table_privilege('anon', 'public.care_kudos', 'INSERT'));
SELECT public.t_true('10.5 care_logs es de solo-agregar para usuarios', has_table_privilege('authenticated', 'public.care_logs', 'SELECT') AND has_table_privilege('authenticated', 'public.care_logs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.care_logs', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.care_logs', 'DELETE') AND NOT has_table_privilege('authenticated', 'public.care_logs', 'TRUNCATE'));
SELECT public.t_true('10.6 care_kudos solo se lee desde la API', has_table_privilege('authenticated', 'public.care_kudos', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.care_kudos', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.care_kudos', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.care_kudos', 'DELETE'));
SELECT public.t_true('10.7 service_role conserva el acceso total', has_table_privilege('service_role', 'public.care_logs', 'INSERT') AND has_table_privilege('service_role', 'public.care_kudos', 'INSERT'));
SELECT public.t_true('10.8 las funciones internas no se ofrecen a usuarios',
  NOT has_function_privilege('authenticated', 'public.party_display_name(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.care_watchers(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.care_can_view(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.career_stats_core(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.invite_team_core(uuid, uuid, uuid, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.trusted_team_free_count(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.party_display_name(uuid)', 'EXECUTE'));
SELECT public.t_true('10.9 los disparadores no se ofrecen a usuarios',
  NOT has_function_privilege('authenticated', 'public.care_logs_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.care_logs_after_insert()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.booking_care_events()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.plan_b_after_cancel()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.notify_booking_cancelled()', 'EXECUTE'));
SELECT public.t_true('10.10 solo los resúmenes públicos se ofrecen a anónimos',
  has_function_privilege('anon', 'public.professional_kudos_summary(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.professional_public_stats(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.send_kudos(uuid, text[], text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_career_stats()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_trusted_team()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.care_report(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_care_summary(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.care_history_report(date, date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.invite_team_to_offer(uuid)', 'EXECUTE'));
SELECT public.t_true('10.11 las funciones de usuario fijan search_path',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.prosecdef
                 AND p.proname IN ('care_logs_guard','care_logs_after_insert','booking_care_events','care_can_view','get_care_summary','care_report',
                                   'send_kudos','my_received_kudos','professional_kudos_summary','career_stats_core','my_career_stats','professional_public_stats',
                                   'my_trusted_team','trusted_team_free_count','invite_team_core','invite_team_to_offer','plan_b_after_cancel','notify_booking_cancelled',
                                   'care_history_report','party_display_name','care_watchers')
                 AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))));
SELECT public.t_eq('10.12 el reconocimiento de los permitidos coincide con TypeScript (familia)', public.q1($$SELECT array_to_string(public.kudos_allowed_kinds('client'), ',')$$), 'punctual,caring,patient,peace_of_mind,communicative,professional');
SELECT public.t_eq('10.13 el reconocimiento de los permitidos coincide con TypeScript (profesional)', public.q1($$SELECT array_to_string(public.kudos_allowed_kinds('professional'), ',')$$), 'respectful,clear_instructions,welcoming,well_prepared');
SELECT public.t_eq('10.14 hx_duration_label', public.q1($$SELECT public.hx_duration_label(0) || '|' || public.hx_duration_label(45) || '|' || public.hx_duration_label(60) || '|' || public.hx_duration_label(135) || '|' || COALESCE(public.hx_duration_label(-1), 'NULL')$$), '0 min|45 min|1 h|2 h 15 min|NULL');

-- ═══ 11) Realtime: las tablas del lazo de cuidado quedan publicadas ═════════════
SELECT public.t_true('11.1 care_logs publicada para el parte en vivo', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'care_logs'));
SELECT public.t_true('11.2 service_bookings y notifications publicadas', (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('service_bookings', 'notifications')) = 2);
SELECT public.t_true('11.3 las tablas de las agendas publicadas', (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('slot_proposals', 'family_needs', 'applications', 'job_offers', 'job_offer_shifts', 'smart_contracts', 'service_ratings')) = 7);
SELECT public.t_eq('11.4 sin duplicados tras aplicarla dos veces', public.q1($$SELECT (count(*) - count(DISTINCT tablename))::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime'$$), '0');
SELECT public.t_true('11.5 no publica tablas sensibles que no se escuchan', NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('user_roles', 'care_kudos', 'job_offer_private', 'smart_contract_signatures')));

-- ═══ Resumen ═══════════════════════════════════════════════════════════════════
\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
