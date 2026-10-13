-- Escenario — SOS Familiar sobre la base real tal como está HOY (clinical_alerts de drizzle/0007 + 20261012150000 aplicada).
-- Variables: MIG (20261012160000_sos_familiar.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

\set c1 '00000000-0000-0000-0000-0000000000d1'
\set c2 '00000000-0000-0000-0000-0000000000d2'
\set c3 '00000000-0000-0000-0000-0000000000d3'
\set x1 '00000000-0000-0000-0000-0000000000e1'

INSERT INTO auth.users(id, email) VALUES (:'c1','c1@t.co'),(:'c2','c2@t.co'),(:'c3','c3@t.co'),(:'x1','x1@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES (:'c1','family'),(:'c2','family'),(:'c3','family'),(:'x1','professional');
INSERT INTO public.profiles(user_id, full_name) VALUES
  (:'f1','Ana María Gómez Ruiz'),(:'p1','Pedro Pérez López'),(:'c1','Luis Gómez Ruiz'),(:'f2','Marta Díaz Soto');
INSERT INTO public.institution_profiles(user_id, institution_name) VALUES (:'i1', 'Clínica Norte');

-- Círculo de cuidado de la familia 1: c1 (acepta y puede ver los servicios), c2 (acepta pero sin ver servicios), c3 (solo invitado).
INSERT INTO public.care_circle_members(owner_id, invited_email, member_id, relation, can_view_services, status, accepted_at) VALUES
  (:'f1', 'c1@t.co', :'c1', 'hijo',   true,  'accepted', now()),
  (:'f1', 'c2@t.co', :'c2', 'vecino', false, 'accepted', now()),
  (:'f1', 'c3@t.co', NULL,  'amigo',  true,  'invited',  NULL);

-- B1 (familia 1 ↔ profesional 1) está en curso; B3 (institución 1 ↔ profesional 1) empieza en 4 horas (inminente). B2 (familia 2 ↔ profesional 2) sigue a futuro.
UPDATE public.service_bookings SET status = 'in_progress', scheduled_at = now() - interval '1 hour'    WHERE id = :'b1';
UPDATE public.service_bookings SET status = 'confirmed',   scheduled_at = now() + interval '4 hours'    WHERE id = :'b3';  -- inminente, sin cruzarse con B1

CREATE FUNCTION public.t_cnt(u uuid, tbl text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_val(u, 'SELECT count(*)::text FROM public.' || tbl) $$;
CREATE FUNCTION public.t_upd(u uuid, stmt text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_val(u, 'WITH x AS (' || stmt || ' RETURNING 1) SELECT count(*)::text FROM x') $$;
-- El mismo INSERT que hace el botón (SosFamiliarButton).
CREATE FUNCTION public.sos_ins(u uuid, patient uuid, extra_cols text DEFAULT '', extra_vals text DEFAULT '', booking uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_val(u, format($q$INSERT INTO public.clinical_alerts(patient_id, booking_id, alert_type, severity, status, actual_value, lat, lng, accuracy_m, triggered_by%s)
                                   VALUES (%L, %L, 'sos_manual', 'critical', 'active', 0, 4.6097, -74.0817, 12, %L%s) RETURNING 'OK'$q$, extra_cols, patient, booking, u, extra_vals)) $$;
-- Ejecuta como superusuario (sin sesión, como el servidor) y devuelve el error en vez de abortar la prueba.
CREATE FUNCTION public.t_su(q text) RETURNS text LANGUAGE plpgsql AS $$ DECLARE v text; BEGIN EXECUTE q INTO v; RETURN COALESCE(v, 'NULL'); EXCEPTION WHEN OTHERS THEN RETURN 'ERR[' || SQLSTATE || '] ' || SQLERRM; END $$;
-- Rejuvenece los SOS ya enviados para que la guarda anti-abuso (2 min / 1 h) no estorbe a la prueba siguiente.
CREATE FUNCTION public.sos_age(mins integer) RETURNS void LANGUAGE sql AS $$ UPDATE public.clinical_alerts SET created_at = created_at - make_interval(mins => mins) WHERE alert_type = 'sos_manual' $$;

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_err('0.1 antes: el INSERT del botón falla porque faltan las columnas lat/lng', public.sos_ins(:'f1', :'f1'), 'does not exist');
SELECT public.t_err('0.2 antes: sin esas columnas, la política de inserción no existe y RLS rechaza el alta', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (%L, 'sos_manual', 'critical', 'active', 0) RETURNING 'OK'$q$, :'f1')), 'row-level security');
SELECT public.t_err('0.3 antes: el tipo sos_manual ni siquiera pasa el CHECK', public.t_su(format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (%L, 'sos_manual', 'critical', 'active', 0) RETURNING 'OK'$q$, :'f1')), 'alert_type_check');
SELECT public.t_true('0.4 antes: no existe ningún disparador de avisos', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clinical_alerts'::regclass AND NOT tgisinternal AND (tgname LIKE '%sos%' OR tgname LIKE '%notify%')));
SELECT public.t_eq('0.5 antes: el botón de pánico acepta citar la reserva de cualquiera', public.t_val(:'x1', format($q$INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type) VALUES (%L, %L, 'panic') RETURNING 'OK'$q$, :'x1', :'b1')), 'OK');
DELETE FROM public.emergency_incidents;
INSERT INTO public.emergency_incidents(triggered_by, incident_type, lat, lng) VALUES (:'f1', 'panic', 4.6, -74.08);
INSERT INTO public.notifications(user_id, type, title) VALUES (:'f1', 'care_alert', 'Aviso de prueba de la familia 1'), (:'hr', 'x', 'Aviso propio de RR. HH.');
SELECT public.t_eq('0.6 antes: RR. HH. y el evaluador leen los incidentes de emergencia (con ubicación) de todos', public.t_cnt(:'hr', 'emergency_incidents') || '/' || public.t_cnt(:'ev', 'emergency_incidents'), '1/1');
SELECT public.t_true('0.7 antes: RR. HH. lee los avisos de otras cuentas', public.t_val(:'hr', 'SELECT count(*)::text FROM public.notifications WHERE user_id <> auth.uid()')::int >= 1);
DELETE FROM public.emergency_incidents;

\i :MIG

-- ═══ 1. El camino feliz ═══════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('1.0 las cinco columnas nuevas existen', public.q1($$SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clinical_alerts' AND column_name IN ('lat','lng','accuracy_m','triggered_by','inapp_notified')$$), '5');
SELECT public.t_eq('1.1 la familia envía su SOS con la ubicación', public.sos_ins(:'f1', :'f1'), 'OK');
SELECT id AS s1 FROM public.clinical_alerts WHERE patient_id = :'f1' AND alert_type = 'sos_manual' ORDER BY created_at DESC LIMIT 1 \gset
SELECT public.t_eq('1.2 queda guardada con ubicación, crítica, activa y a nombre de quien la pulsó', public.q1(format($q$SELECT (lat = 4.6097 AND lng = -74.0817 AND accuracy_m = 12 AND triggered_by = %L AND status = 'active' AND severity = 'critical' AND notified_whatsapp = false)::text FROM public.clinical_alerts WHERE id = %L$q$, :'f1', :'s1')), 'true');
SELECT public.t_eq('1.3 se avisó dentro de la app a 2 personas: el círculo (c1) y el profesional del servicio en curso (p1)', public.q1(format($q$SELECT inapp_notified::text FROM public.clinical_alerts WHERE id = %L$q$, :'s1')), '2');
SELECT public.t_eq('1.4 c1 (círculo) recibió el aviso y va a su panel de familia', public.q1(format($q$SELECT count(*)::text || '/' || min(link) FROM public.notifications WHERE type = 'sos_alert' AND user_id = %L$q$, :'c1')), '1//dashboard/familia');
SELECT public.t_eq('1.5 p1 (profesional) recibió el aviso y va a su panel profesional', public.q1(format($q$SELECT count(*)::text || '/' || min(link) FROM public.notifications WHERE type = 'sos_alert' AND user_id = %L$q$, :'p1')), '1//dashboard/profesional');
SELECT public.t_eq('1.6 no se avisó a quien no corresponde: c2 (sin permiso), c3 (solo invitado), p2, x1, i1, f2', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'sos_alert' AND user_id IN (%L, %L, %L, %L, %L, %L)$q$, :'c2', :'c3', :'p2', :'x1', :'i1', :'f2')), '0');
SELECT public.t_eq('1.7 tampoco a quien pulsó el botón', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'sos_alert' AND user_id = %L$q$, :'f1')), '0');
SELECT public.t_true('1.8 el aviso trae el nombre corto, el mapa con las coordenadas y el 123', (SELECT title LIKE 'SOS: Ana R. pidió ayuda' AND body LIKE '%maps?q=4.609700,-74.081700%' AND body LIKE '%123%' AND (meta->>'alert_id')::uuid = :'s1'::uuid FROM public.notifications WHERE type = 'sos_alert' AND user_id = :'c1'));
SELECT public.t_eq('1.9 el superadmin lo ve como incidente «sos_familiar» con ubicación, uno solo', public.q1(format($q$SELECT count(*)::text || '/' || min(incident_type) || '/' || bool_and(lat = 4.6097 AND triggered_by = %L)::text FROM public.emergency_incidents$q$, :'f1')), '1/sos_familiar/true');
SELECT public.t_eq('1.10 el incidente del SOS no dispara el aviso del botón de pánico (no hay avisos duplicados)', public.q1($$SELECT count(*)::text FROM public.notifications WHERE type = 'emergency_alert'$$), '0');
-- Quién lo ve
SELECT public.t_eq('1.11 lo ven: la familia, su círculo, su profesional y el superadmin', public.t_cnt(:'f1', 'clinical_alerts') || public.t_cnt(:'c1', 'clinical_alerts') || public.t_cnt(:'p1', 'clinical_alerts') || public.t_cnt(:'sa', 'clinical_alerts'), '1111');
SELECT public.t_eq('1.12 no lo ven: el miembro sin permiso, el invitado, otro profesional, RR. HH., el evaluador ni la institución', public.t_cnt(:'c2', 'clinical_alerts') || public.t_cnt(:'c3', 'clinical_alerts') || public.t_cnt(:'p2', 'clinical_alerts') || public.t_cnt(:'hr', 'clinical_alerts') || public.t_cnt(:'ev', 'clinical_alerts') || public.t_cnt(:'i1', 'clinical_alerts'), '000000');
SELECT public.sos_age(1440);
SELECT public.t_eq('1.14 el SOS no necesita valor medido: el payload mínimo funciona (actual_value vale 0 por defecto)', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, triggered_by) VALUES (%L, 'sos_manual', 'critical', 'active', %L) RETURNING 'OK'$q$, :'f1', :'f1')) || '/' || public.q1($$SELECT actual_value::text FROM public.clinical_alerts WHERE alert_type = 'sos_manual' AND lat IS NULL$$), 'OK/0.00');
INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (:'f1', 'high_heart_rate', 'high', 'active', 133);
SELECT public.t_eq('1.15 una alerta automática de signos vitales (sin reserva) NO se abre al círculo ni al profesional: solo el SOS', public.t_val(:'c1', 'SELECT count(*)::text FROM public.clinical_alerts WHERE alert_type = ''high_heart_rate''') || '/' || public.t_val(:'p1', 'SELECT count(*)::text FROM public.clinical_alerts WHERE alert_type = ''high_heart_rate''') || '/' || public.t_val(:'f1', 'SELECT count(*)::text FROM public.clinical_alerts WHERE alert_type = ''high_heart_rate'''), '0/0/1');
DELETE FROM public.clinical_alerts WHERE alert_type = 'high_heart_rate';
SELECT public.t_eq('1.13 anon no lo ve ni lo envía', public.t_anon('SELECT count(*)::text FROM public.clinical_alerts'), 'ERR[42501] permission denied for table clinical_alerts');

-- ═══ 2. Falsificaciones ═══════════════════════════════════════════════════════════════════════════════════════
SELECT public.sos_age(1440);
SELECT public.t_err('2.1 nadie envía un SOS a nombre de un desconocido', public.sos_ins(:'f2', :'f1'), 'row-level security');
SELECT public.t_err('2.2 ni uno que no sea crítico', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by) VALUES (%L, 'sos_manual', 'low', 'active', 0, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'row-level security');
SELECT public.t_err('2.3b ni con estado distinto de activo', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by) VALUES (%L, 'sos_manual', 'critical', 'acknowledged', 0, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'row-level security');
SELECT public.t_err('2.4 un usuario no crea alertas de signos vitales (solo el servidor)', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by) VALUES (%L, 'high_heart_rate', 'critical', 'active', 190, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'row-level security');
SELECT public.t_err('2.5 no se puede declarar el aviso por WhatsApp ya enviado', public.sos_ins(:'f1', :'f1', ', notified_whatsapp', ', true'), 'row-level security');
SELECT public.t_err('2.6 ni el aviso en la app', public.sos_ins(:'f1', :'f1', ', inapp_notified', ', 99'), 'row-level security');
SELECT public.t_err('2.7 ni atribuir el SOS a otra persona', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by) VALUES (%L, 'sos_manual', 'critical', 'active', 0, %L) RETURNING 'OK'$q$, :'f1', :'f2')), 'row-level security');
SELECT public.t_err('2.8 ni dejarlo ya reconocido', public.sos_ins(:'f1', :'f1', ', acknowledged_by, acknowledged_at', format(', %L, now()', :'f1')), 'row-level security');
SELECT public.t_err('2.9 coordenadas imposibles', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, lat, lng, triggered_by) VALUES (%L, 'sos_manual', 'critical', 'active', 0, 123, -74, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'clinical_alerts_geo_chk');
SELECT public.t_err('2.10 latitud sin longitud', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, lat, triggered_by) VALUES (%L, 'sos_manual', 'critical', 'active', 0, 4.6, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'clinical_alerts_geo_chk');
SELECT public.t_err('2.11 anon no puede', public.t_anon(format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (%L, 'sos_manual', 'critical', 'active', 0) RETURNING 'OK'$q$, :'f1')), 'permission denied');
SELECT public.t_err('2.12 RR. HH. no puede pulsar el SOS de una familia', public.sos_ins(:'hr', :'f1'), 'row-level security');
SELECT public.t_err('2.12b ni el evaluador', public.sos_ins(:'ev', :'f1'), 'row-level security');
SELECT public.t_err('2.13 el superadmin tampoco pulsa el SOS de otro', public.sos_ins(:'sa', :'f1'), 'row-level security');
SELECT public.t_err('2.14 no se cita la reserva de otra persona para avisar a sus participantes', public.sos_ins(:'f1', :'f1', '', '', :'b2'), 'row-level security');
SELECT public.t_err('2.15 un profesional sin reserva con esa familia no puede', public.sos_ins(:'x1', :'f1', '', '', :'b1'), 'row-level security');
SELECT public.t_err('2.16 ni el profesional de otro servicio citando la reserva ajena', public.sos_ins(:'p2', :'f1', '', '', :'b1'), 'row-level security');
SELECT public.t_err('2.17 el miembro del círculo sin permiso para ver servicios tampoco', public.sos_ins(:'c2', :'f1'), 'row-level security');
SELECT public.t_err('2.18 ni el invitado que no aceptó', public.sos_ins(:'c3', :'f1'), 'row-level security');
SELECT public.t_eq('2.19 nada de lo anterior dejó filas ni avisos', public.q1($$SELECT (SELECT count(*) FROM public.clinical_alerts WHERE alert_type = 'sos_manual')::text || '/' || (SELECT count(*) FROM public.notifications WHERE type = 'sos_alert')$$), '2/4');

-- ═══ 3. Terceros que sí pueden pulsarlo ═══════════════════════════════════════════════════════════════════════
SELECT public.t_eq('3.1 el profesional con la reserva en curso lo pulsa por su paciente', public.sos_ins(:'p1', :'f1', '', '', :'b1'), 'OK');
SELECT id AS s2 FROM public.clinical_alerts WHERE triggered_by = :'p1' ORDER BY created_at DESC LIMIT 1 \gset
SELECT public.t_eq('3.2 se avisa a la familia y al círculo, no a él mismo (2 avisos)', public.q1(format($q$SELECT inapp_notified::text FROM public.clinical_alerts WHERE id = %L$q$, :'s2')), '2');
SELECT public.t_eq('3.2b el incidente que crea ese SOS (con reserva) no dispara además los avisos del botón de pánico: sin duplicados', public.q1($$SELECT count(*)::text FROM public.notifications WHERE type = 'emergency_alert'$$), '0');
SELECT public.t_true('3.3 el aviso dice quién lo activó', (SELECT body LIKE 'Pedro L. activó el SOS.%' FROM public.notifications WHERE type = 'sos_alert' AND user_id = :'f1' AND (meta->>'alert_id')::uuid = :'s2'::uuid));
SELECT public.sos_age(10);
SELECT public.t_eq('3.4 el miembro del círculo con permiso lo pulsa por la familia', public.sos_ins(:'c1', :'f1'), 'OK');
SELECT id AS s3 FROM public.clinical_alerts WHERE triggered_by = :'c1' ORDER BY created_at DESC LIMIT 1 \gset
SELECT public.sos_age(10);
SELECT public.t_eq('3.4b el círculo también puede pulsarlo citando una reserva de la familia', public.sos_ins(:'c1', :'f1', '', '', :'b1'), 'OK');
SELECT public.sos_age(10);
SELECT public.t_eq('3.5 avisa a la familia y al profesional (no a c1)', public.q1(format($q$SELECT inapp_notified::text FROM public.clinical_alerts WHERE id = %L$q$, :'s3')), '2');
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f1', :'x1', 'pending', now() + interval '5 days', 4, 20000, 80000) RETURNING id AS b5 \gset
SELECT public.sos_age(10);
SELECT public.t_err('3.6 con la reserva sin confirmar el profesional no puede pulsarlo', public.sos_ins(:'x1', :'f1', '', '', :'b5'), 'row-level security');
UPDATE public.service_bookings SET status = 'cancelled' WHERE id = :'b5';
SELECT public.t_err('3.6b ni con la reserva cancelada', public.sos_ins(:'x1', :'f1', '', '', :'b5'), 'row-level security');
SELECT public.t_eq('3.7 una institución lo pulsa por su servicio inminente (B3)', public.sos_ins(:'i1', :'i1', '', '', :'b3'), 'OK');
SELECT public.t_eq('3.8 y su profesional recibe el aviso en el panel profesional', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'sos_alert' AND user_id = %L AND title LIKE 'SOS: Clínica Norte%%'$q$, :'p1')), '1');
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f1', :'x1', 'pending', now() + interval '30 minutes', 1, 20000, 20000) RETURNING id AS b6 \gset
UPDATE public.service_bookings SET status = 'cancelled' WHERE id = :'b6';
SELECT public.sos_age(1440);
SELECT public.sos_ins(:'f1', :'f1') AS r39 \gset
SELECT public.t_eq('3.9 un profesional con una reserva CANCELADA dentro de la ventana no recibe el aviso del SOS', :'r39' || '/' || public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'sos_alert' AND user_id = %L$q$, :'x1')), 'OK/0');
SELECT public.sos_age(1440);

-- ═══ 4. Guarda anti-abuso ═════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('4.1 un SOS', public.sos_ins(:'f1', :'f1'), 'OK');
SELECT public.t_err('4.2 el segundo, enseguida, se rechaza con un mensaje que manda al 123', public.sos_ins(:'f1', :'f1'), 'llama al 123');
SELECT public.t_err('4.2b quien no puede pulsar este SOS recibe el rechazo de la política, no un aviso que delate que hubo uno reciente', public.sos_ins(:'f2', :'f1'), 'row-level security');
SELECT public.sos_age(5);
SELECT public.t_eq('4.3 pasados 2 minutos se acepta otro', public.sos_ins(:'f1', :'f1'), 'OK');
SELECT public.sos_age(5);
INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by, created_at)
SELECT :'f1', 'sos_manual', 'critical', 'active', 0, :'f1', now() - interval '10 minutes' - make_interval(mins => g) FROM generate_series(1, 3) g;
SELECT public.t_err('4.4 con cinco en la última hora ya no se acepta otro', public.sos_ins(:'f1', :'f1'), 'Demasiados SOS');
SELECT public.t_eq('4.5 el límite es por paciente: otra familia no se ve afectada', public.sos_ins(:'f2', :'f2'), 'OK');
SELECT public.sos_age(1440);

-- ═══ 5. Atender el SOS ═══════════════════════════════════════════════════════════════════════════════════════
SELECT id AS s5 FROM public.clinical_alerts WHERE patient_id = :'f1' AND alert_type = 'sos_manual' ORDER BY created_at DESC LIMIT 1 \gset
SELECT public.t_eq('5.1 el círculo lo reconoce («ya voy»)', public.t_upd(:'c1', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L$q$, :'s5')), '1');
SELECT public.t_eq('5.2 queda registrado quién lo atendió', public.q1(format($q$SELECT (acknowledged_by = %L AND acknowledged_at IS NOT NULL)::text FROM public.clinical_alerts WHERE id = %L$q$, :'c1', :'s5')), 'true');
SELECT public.t_eq('5.3 el miembro sin permiso no puede atenderlo', public.t_upd(:'c2', format($q$UPDATE public.clinical_alerts SET status = 'resolved' WHERE id = %L$q$, :'s5')), '0');
SELECT public.t_eq('5.4 el profesional del servicio sí lo resuelve', public.t_upd(:'p1', format($q$UPDATE public.clinical_alerts SET status = 'resolved' WHERE id = %L$q$, :'s5')), '1');
SELECT public.t_err('5.5 una alerta resuelta no se reabre', public.t_upd(:'f1', format($q$UPDATE public.clinical_alerts SET status = 'active' WHERE id = %L$q$, :'s5')), 'no se reabre');
SELECT public.t_err('5.6 no se reescribe la ubicación', public.t_upd(:'f1', format($q$UPDATE public.clinical_alerts SET lat = 0, lng = 0 WHERE id = %L$q$, :'s5')), 'permission denied');
SELECT public.t_err('5.7 ni el conteo de avisos', public.t_upd(:'f1', format($q$UPDATE public.clinical_alerts SET inapp_notified = 50 WHERE id = %L$q$, :'s5')), 'permission denied');
SELECT public.t_err('5.8 ni quién lo pulsó', public.t_upd(:'f1', format($q$UPDATE public.clinical_alerts SET triggered_by = %L WHERE id = %L$q$, :'f2', :'s5')), 'permission denied');
SELECT public.t_eq('5.9 el servidor (sin sesión) marca el WhatsApp enviado', public.q1(format($q$WITH x AS (UPDATE public.clinical_alerts SET notified_whatsapp = true, notified_at = now() WHERE id = %L RETURNING 1) SELECT count(*)::text FROM x$q$, :'s5')), '1');

SELECT public.t_eq('5.10 el conteo de avisos de cada SOS cuadra con los avisos guardados', public.q1($$SELECT count(*)::text FROM public.clinical_alerts a WHERE a.alert_type = 'sos_manual' AND a.inapp_notified <> (SELECT count(*) FROM public.notifications n WHERE n.type = 'sos_alert' AND (n.meta->>'alert_id')::uuid = a.id)$$), '0');

-- ═══ 6. Botón de pánico de un servicio (emergency_incidents) ═══════════════════════════════════════════════════
DELETE FROM public.notifications WHERE type IN ('sos_alert', 'emergency_alert');
SELECT public.t_eq('6.1 el profesional del servicio B1 pulsa el pánico', public.t_val(:'p1', format($q$INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type, lat, lng) VALUES (%L, %L, 'panic', 4.61, -74.08) RETURNING 'OK'$q$, :'p1', :'b1')), 'OK');
SELECT public.t_eq('6.2 avisa a la familia y a su círculo con permiso (f1 y c1), no a él', public.q1($$SELECT string_agg(u, ',' ORDER BY u) FROM (SELECT right(user_id::text, 2) AS u FROM public.notifications WHERE type = 'emergency_alert') s$$), 'd1,f1');
SELECT public.t_true('6.3 el aviso trae el mapa y la reserva', (SELECT body LIKE '%maps?q=4.610000,-74.080000%' AND (meta->>'booking_id')::uuid = :'b1'::uuid FROM public.notifications WHERE type = 'emergency_alert' AND user_id = :'f1'));
SELECT public.t_err('6.4 quien no es parte de la reserva no puede citarla', public.t_val(:'x1', format($q$INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type) VALUES (%L, %L, 'panic') RETURNING 'OK'$q$, :'x1', :'b1')), 'row-level security');
SELECT public.t_err('6.5 ni un profesional de otro servicio', public.t_val(:'p2', format($q$INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type) VALUES (%L, %L, 'panic') RETURNING 'OK'$q$, :'p2', :'b1')), 'row-level security');
SELECT public.t_val(:'f1', format($q$INSERT INTO public.emergency_incidents(triggered_by, incident_type) VALUES (%L, 'panic') RETURNING 'OK'$q$, :'f1')) AS r66 \gset
SELECT public.t_eq('6.6 sin reserva sí se registra (solo lo ve el superadmin) y no avisa a nadie', :'r66' || '/' || public.q1($$SELECT count(*)::text FROM public.notifications WHERE type = 'emergency_alert'$$), 'OK/2');
SELECT public.t_err('6.7 no se registra el pánico a nombre de otro', public.t_val(:'f1', format($q$INSERT INTO public.emergency_incidents(triggered_by, incident_type) VALUES (%L, 'panic') RETURNING 'OK'$q$, :'f2')), 'row-level security');
SELECT public.t_val(:'f1', format($q$INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type) VALUES (%L, %L, 'panic') RETURNING 'OK'$q$, :'f1', :'b1')) AS r68 \gset
SELECT public.t_eq('6.8 la familia cuando pulsa el pánico en su servicio avisa al profesional', :'r68' || '/' || public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE type = 'emergency_alert' AND user_id = %L$q$, :'p1')), 'OK/1');

SELECT count(*)::text AS n69 FROM public.notifications WHERE type = 'emergency_alert' \gset
INSERT INTO public.emergency_incidents(triggered_by, booking_id, incident_type) VALUES (:'x1', :'b1', 'panic');
SELECT public.t_eq('6.9 aunque un incidente cite una reserva ajena (p. ej. creado por el servidor), el disparador no avisa a nadie', (SELECT count(*)::text FROM public.notifications WHERE type = 'emergency_alert'), :'n69');

-- ═══ 6b. Incidentes y avisos: RR. HH. y evaluadores fuera ══════════════════════════════════════════════════════
SELECT public.t_eq('6b.1 RR. HH. y el evaluador ya no leen los incidentes de emergencia', public.t_cnt(:'hr', 'emergency_incidents') || '/' || public.t_cnt(:'ev', 'emergency_incidents'), '0/0');
SELECT public.t_true('6b.2 el superadmin los lee todos', public.t_cnt(:'sa', 'emergency_incidents')::int >= 4);
SELECT public.t_eq('6b.3 quien pulsó el botón ve el suyo; la contraparte de la reserva también', public.t_val(:'f1', 'SELECT (count(*) > 0)::text FROM public.emergency_incidents') || '/' || public.t_val(:'p1', format($q$SELECT (count(*) > 0)::text FROM public.emergency_incidents WHERE booking_id = %L$q$, :'b1')), 'true/true');
SELECT public.t_eq('6b.4 un tercero (otro profesional sin relación) no ve incidentes ajenos', public.t_cnt(:'p2', 'emergency_incidents'), '0');
SELECT public.t_eq('6b.5 RR. HH. solo lee sus propios avisos (1), no los de las demás cuentas', public.t_cnt(:'hr', 'notifications') || '/' || public.t_val(:'hr', 'SELECT count(*)::text FROM public.notifications WHERE user_id <> auth.uid()'), '1/0');
SELECT public.t_eq('6b.6 el evaluador no lee los avisos de otros', public.t_val(:'ev', format($q$SELECT count(*)::text FROM public.notifications WHERE user_id <> auth.uid()$q$)), '0');
SELECT public.t_true('6b.7 el superadmin lee todos los avisos', public.t_cnt(:'sa', 'notifications')::int >= 4);
SELECT public.t_true('6b.8 cada persona sigue leyendo y marcando como leído lo suyo', public.t_val(:'c1', 'SELECT (count(*) > 0)::text FROM public.notifications') = 'true' AND public.t_upd(:'c1', $q$UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL$q$)::int >= 1);
SELECT public.t_eq('6b.9 y no puede marcar los de otro', public.t_upd(:'c1', format($q$UPDATE public.notifications SET read_at = now() WHERE user_id = %L$q$, :'f1')), '0');
SELECT public.t_eq('6b.10 RR. HH. no puede borrar ni crear avisos ajenos', public.t_val(:'hr', format($q$WITH x AS (DELETE FROM public.notifications WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM x$q$, :'f1')) || '/' || public.t_val(:'hr', format($q$INSERT INTO public.notifications(user_id, type, title) VALUES (%L, 'x', 'spam') RETURNING 'OK'$q$, :'f1')), '0/ERR[42501] new row violates row-level security policy for table "notifications"');
SELECT public.t_eq('6b.11 ninguna de las políticas de estas dos tablas usa is_staff()', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('emergency_incidents','notifications') AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_staff%'$$), '0');

-- ═══ 7. Robustez: un fallo al avisar no pierde el SOS ═════════════════════════════════════════════════════════
CREATE FUNCTION public.t_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
CREATE TRIGGER t_boom_n BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_boom();
SELECT public.t_eq('7.1 si no se pueden guardar los avisos, el SOS se guarda igual', public.sos_ins(:'f1', :'f1'), 'OK');
SELECT public.t_eq('7.2 y dice la verdad: 0 personas avisadas', public.q1($$SELECT inapp_notified::text FROM public.clinical_alerts WHERE alert_type = 'sos_manual' ORDER BY created_at DESC LIMIT 1$$), '0');
DROP TRIGGER t_boom_n ON public.notifications;
SELECT public.sos_age(1440);
CREATE TRIGGER t_boom_i BEFORE INSERT ON public.emergency_incidents FOR EACH ROW EXECUTE FUNCTION public.t_boom();
SELECT public.sos_ins(:'f1', :'f1') AS r73 \gset
SELECT public.t_eq('7.3 si falla el incidente, el SOS se guarda y se avisa igual', :'r73' || '/' || public.q1($$SELECT inapp_notified::text FROM public.clinical_alerts WHERE alert_type = 'sos_manual' ORDER BY created_at DESC LIMIT 1$$), 'OK/2');
DROP TRIGGER t_boom_i ON public.emergency_incidents;
SELECT public.sos_age(1440);

-- ═══ 8. WhatsApp automático: inerte hasta que existan pg_net, el secreto de Vault y los secretos de la función ════════
SELECT public.t_true('8.1 el gancho existe y solo mira el SOS', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clinical_alerts'::regclass AND tgname = 'clinical_alerts_notify_webhook' AND pg_get_triggerdef(oid) LIKE '%sos_manual%'));
SELECT public.t_eq('8.2 sin pg_net ni Vault, el envío del SOS no falla ni hace nada', public.sos_ins(:'f2', :'f2'), 'OK');
SELECT public.sos_age(1440);
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE public.t_http(url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.t_http VALUES (url, headers, body) RETURNING 1::bigint $$;
CREATE TABLE vault.secrets_t(name text, decrypted_secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT name, decrypted_secret FROM vault.secrets_t;
SELECT public.sos_ins(:'f2', :'f2') AS r83 \gset
SELECT public.t_eq('8.3 con pg_net pero sin el secreto, no envía', :'r83' || '/' || public.q1('SELECT count(*)::text FROM public.t_http'), 'OK/0');
SELECT public.sos_age(1440);
INSERT INTO vault.secrets_t VALUES ('internal_webhook_secret', 's3cr3t');
SELECT public.sos_ins(:'f2', :'f2') AS r84 \gset
SELECT public.t_eq('8.4 con pg_net y el secreto, avisa a la función clinical-alert-notify', :'r84' || '/' || public.q1('SELECT count(*)::text FROM public.t_http'), 'OK/1');
SELECT public.t_true('8.5 con la dirección, el secreto y el registro de la alerta', (SELECT url LIKE '%/functions/v1/clinical-alert-notify' AND headers->>'x-webhook-secret' = 's3cr3t' AND body->'record'->>'alert_type' = 'sos_manual' AND (body->'record'->>'lat')::float = 4.6097 FROM public.t_http LIMIT 1));
INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (:'f2', 'high_heart_rate', 'high', 'active', 130);
SELECT public.t_eq('8.6 las alertas de signos vitales no pasan por el gancho (todavía)', public.q1('SELECT count(*)::text FROM public.t_http'), '1');
DROP VIEW vault.decrypted_secrets; DROP SCHEMA vault CASCADE; DROP SCHEMA net CASCADE;

-- ═══ 9. Lo que no debe cambiar ═══════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('9.1 RR. HH. y el evaluador siguen sin leer alertas', public.t_cnt(:'hr', 'clinical_alerts') || '/' || public.t_cnt(:'ev', 'clinical_alerts'), '0/0');
INSERT INTO public.clinical_alerts(patient_id, booking_id, alert_type, severity, status, actual_value) VALUES (:'t3', :'b3', 'high_heart_rate', 'high', 'active', 131);
SELECT public.t_eq('9.2 la institución sigue viendo la alerta de signos vitales de SU servicio (B3)', public.t_val(:'i1', format($q$SELECT count(*)::text FROM public.clinical_alerts WHERE patient_id = %L$q$, :'t3')), '1');
SELECT public.t_eq('9.2b y no ve las de una familia ajena', public.t_val(:'i1', format($q$SELECT count(*)::text FROM public.clinical_alerts WHERE patient_id = %L$q$, :'f1')), '0');
SELECT public.t_eq('9.3 el servidor sigue creando alertas de signos vitales (sin ubicación ni valor por defecto que estorbe)', public.q1(format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value) VALUES (%L, 'low_spo2', 'high', 'active', 88) RETURNING 'OK'$q$, :'f2')), 'OK');
SELECT public.t_true('9.4 authenticated sigue sin poder reescribir tipo, gravedad ni valor', NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'severity', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'alert_type', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'actual_value', 'UPDATE'));
SELECT public.t_true('9.5 anon sigue sin ningún privilegio', NOT has_table_privilege('anon', 'public.clinical_alerts', 'SELECT') AND NOT has_table_privilege('anon', 'public.clinical_alerts', 'INSERT'));
SELECT public.t_true('9.6 las funciones internas no se llaman desde la API', NOT has_function_privilege('authenticated', 'public.hx_sos_audience(uuid,uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hx_notify_ex(uuid,text,text,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.clinical_alerts_sos_fanout()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.notify_edge_function(text,jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hx_can_access_alert(uuid,uuid,text)', 'EXECUTE'));
SELECT public.t_true('9.7 las que usan las políticas sí las ejecuta authenticated', has_function_privilege('authenticated', 'public.hx_can_access_alert(uuid,uuid,text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.hx_can_trigger_sos(uuid,uuid)', 'EXECUTE'));
SELECT public.t_eq('9.8 ninguna política de clinical_alerts usa is_staff()', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinical_alerts' AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_staff%'$$), '0');
SELECT public.t_eq('9.9 las políticas de clinical_alerts son tres: lectura, atención y SOS', public.q1($$SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinical_alerts'$$), 'clinical_alerts_ack,clinical_alerts_read,clinical_alerts_sos_insert');

-- ═══ 11. Lista de alertas SOS (my_sos_alerts) ═════════════════════════════════════════════════════════════════
SELECT public.t_err('11.0 antes de la migración la función no existe', public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_sos_alerts(10)'), 'does not exist');
\i :MIG2
-- Estado de partida: una alerta abierta de f1 (reciente), una vieja (10 días), una resuelta; y otra de f2.
DELETE FROM public.clinical_alerts WHERE alert_type = 'sos_manual';
INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, lat, lng, triggered_by, created_at) VALUES
  (:'f1', 'sos_manual', 'critical', 'active',   0, 4.6097, -74.0817, :'f1', now() - interval '5 minutes'),
  (:'f1', 'sos_manual', 'critical', 'resolved', 0, 4.61,   -74.08,   :'f1', now() - interval '3 hours'),
  (:'f1', 'sos_manual', 'critical', 'active',   0, 4.6,    -74.0,    :'f1', now() - interval '10 days'),
  (:'f2', 'sos_manual', 'critical', 'active',   0, 4.7,    -74.1,    :'f2', now() - interval '1 minute');
UPDATE public.clinical_alerts SET acknowledged_by = :'c1', acknowledged_at = now() - interval '2 hours', resolved_at = now() - interval '2 hours' WHERE status = 'resolved';
SELECT public.t_eq('11.1 la familia ve las suyas (7 días) y primero la activa', public.t_val(:'f1', $q$SELECT string_agg(status || ':' || mine::text, ',' ORDER BY ord) FROM (SELECT status, mine, row_number() OVER () AS ord FROM public.my_sos_alerts(10)) s$q$), 'active:true,resolved:true');
SELECT public.t_eq('11.2 con el nombre corto', public.t_val(:'f1', 'SELECT min(patient_name) FROM public.my_sos_alerts(10)'), 'Ana R.');
SELECT public.t_eq('11.3 el círculo ve las de la familia, no marcadas como suyas', public.t_val(:'c1', $q$SELECT count(*)::text || '/' || bool_or(mine)::text FROM public.my_sos_alerts(10)$q$), '2/false');
SELECT public.t_eq('11.4 el profesional con servicio vigente también', public.t_val(:'p1', 'SELECT count(*)::text FROM public.my_sos_alerts(10)'), '2');
SELECT public.t_eq('11.5 y ninguno ve las de la otra familia (f2)', public.t_val(:'c1', format($q$SELECT count(*)::text FROM public.my_sos_alerts(10) WHERE patient_id = %L$q$, :'f2')) || '/' || public.t_val(:'p1', format($q$SELECT count(*)::text FROM public.my_sos_alerts(10) WHERE patient_id = %L$q$, :'f2')), '0/0');
SELECT public.t_eq('11.6 sin permiso no se ve nada: miembro sin permiso, invitado, otro profesional, RR. HH., evaluador, institución sin relación', public.t_val(:'c2', 'SELECT count(*)::text FROM public.my_sos_alerts(10)') || public.t_val(:'c3', 'SELECT count(*)::text FROM public.my_sos_alerts(10)') || public.t_val(:'p2', format($q$SELECT count(*)::text FROM public.my_sos_alerts(10) WHERE patient_id <> %L$q$, :'f2')) || public.t_val(:'hr', 'SELECT count(*)::text FROM public.my_sos_alerts(10)') || public.t_val(:'ev', 'SELECT count(*)::text FROM public.my_sos_alerts(10)') || public.t_val(:'i2', 'SELECT count(*)::text FROM public.my_sos_alerts(10)'), '000000');
SELECT public.t_eq('11.7 el superadmin ve las de todos', public.t_val(:'sa', 'SELECT count(*)::text FROM public.my_sos_alerts(50)'), '3');
SELECT public.t_eq('11.8 la que atendió c1 trae su nombre corto', public.t_val(:'f1', $q$SELECT acknowledged_by_name FROM public.my_sos_alerts(10) WHERE status = 'resolved'$q$), 'Luis R.');
SELECT public.t_eq('11.9 quien la pulsó por otro aparece en triggered_by_name', public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_sos_alerts(10) WHERE triggered_by_name IS NOT NULL'), '0');
INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, status, actual_value, triggered_by, created_at) VALUES (:'f1', 'sos_manual', 'critical', 'active', 0, :'p1', now() - interval '30 seconds');
SELECT public.t_eq('11.10 …si lo pulsó el profesional, sale su nombre corto («Pedro L.»)', public.t_val(:'f1', $q$SELECT triggered_by_name FROM public.my_sos_alerts(10) WHERE triggered_by_name IS NOT NULL$q$), 'Pedro L.');
SELECT public.t_eq('11.11 el límite se acota: 0 o negativo devuelve al menos 1; nulo usa 20', public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_sos_alerts(0)') || '/' || public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_sos_alerts(NULL)'), '1/3');
SELECT public.t_err('11.12 anon no la ejecuta', public.t_anon('SELECT count(*)::text FROM public.my_sos_alerts(10)'), 'permission denied');
SELECT public.t_eq('11.13 el miembro del círculo la reconoce desde la lista y se ve quién fue', public.t_upd(:'c1', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE patient_id = %L AND status = 'active' AND triggered_by = %L AND created_at > now() - interval '1 day'$q$, :'f1', :'f1')) || '/' || public.t_val(:'f1', $q$SELECT string_agg(DISTINCT acknowledged_by_name, ',') FROM public.my_sos_alerts(10) WHERE status = 'acknowledged'$q$), '1/Luis R.');
SELECT public.t_true('11.14 clinical_alerts está publicada en Realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clinical_alerts'));
SELECT public.t_true('11.15 y la función no es ejecutable por anon pero sí por authenticated', NOT has_function_privilege('anon', 'public.my_sos_alerts(integer)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.my_sos_alerts(integer)', 'EXECUTE'));
SELECT md5(pg_get_functiondef('public.my_sos_alerts(integer)'::regprocedure)) AS sig_feed \gset
\i :MIG2
SELECT public.t_eq('11.16 segunda pasada idéntica', md5(pg_get_functiondef('public.my_sos_alerts(integer)'::regprocedure)), :'sig_feed');

-- ═══ 10. Idempotencia ═════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_sig_policies() AS sig_pol, public.t_sig_acl() AS sig_acl,
       (SELECT md5(string_agg(tablename || policyname || cmd || coalesce(qual,'') || coalesce(with_check,''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('emergency_incidents','notifications')) AS sig_pol2,
       (SELECT md5(string_agg(p.proname || pg_get_functiondef(p.oid), '|' ORDER BY p.proname)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('hx_sos_audience','hx_can_access_alert','hx_can_trigger_sos','clinical_alerts_sos_guard','clinical_alerts_sos_fanout','hx_notify_ex','hx_dashboard_link','emergency_incidents_fanout','trg_clinical_alerts_notify','notify_edge_function')) AS sig_fn,
       (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgrelid IN ('public.clinical_alerts'::regclass, 'public.emergency_incidents'::regclass) AND NOT tgisinternal) AS sig_trg \gset
\i :MIG
SELECT public.t_eq('10.1 la segunda pasada no cambia las políticas', public.t_sig_policies(), :'sig_pol');
SELECT public.t_eq('10.2 ni los privilegios', public.t_sig_acl(), :'sig_acl');
SELECT public.t_eq('10.2b ni las políticas de incidentes y avisos', (SELECT md5(string_agg(tablename || policyname || cmd || coalesce(qual,'') || coalesce(with_check,''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('emergency_incidents','notifications')), :'sig_pol2');
SELECT public.t_eq('10.3 ni las funciones', (SELECT md5(string_agg(p.proname || pg_get_functiondef(p.oid), '|' ORDER BY p.proname)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('hx_sos_audience','hx_can_access_alert','hx_can_trigger_sos','clinical_alerts_sos_guard','clinical_alerts_sos_fanout','hx_notify_ex','hx_dashboard_link','emergency_incidents_fanout','trg_clinical_alerts_notify','notify_edge_function')), :'sig_fn');
SELECT public.t_eq('10.4 ni los disparadores', (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgrelid IN ('public.clinical_alerts'::regclass, 'public.emergency_incidents'::regclass) AND NOT tgisinternal), :'sig_trg');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
