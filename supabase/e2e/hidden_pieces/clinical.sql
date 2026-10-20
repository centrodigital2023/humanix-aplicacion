-- Escenario — monitoreo clínico (riesgo, umbrales, check-in/out y evidencias). Variables: MIG, HELPERS, STUBS.
\i :HELPERS
\i :STUBS
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f2', :'p1', 'cancelled', now() + interval '5 days', 4, 20000, 80000) RETURNING id AS b5 \gset
SELECT public.t_true('0.1 antes: no existen las tablas', to_regclass('public.patient_risk_scores') IS NULL
  AND to_regclass('public.service_checkins') IS NULL AND to_regclass('public.alert_thresholds') IS NULL);

\i :MIG

-- 1. Riesgo del paciente
SELECT public.t_eq('1.1 el paciente guarda su propio cálculo y queda quién lo hizo', public.t_val(:'f1', $q$INSERT INTO public.patient_risk_scores(patient_id, score, level, calculated_by) VALUES (auth.uid(), 40, 'medium', '00000000-0000-0000-0000-0000000000a2') RETURNING (calculated_by = auth.uid())::text$q$), 'true');
SELECT public.t_eq('1.2 su profesional (reserva vigente) también', public.t_val(:'p1', format($q$INSERT INTO public.patient_risk_scores(patient_id, score, level) VALUES (%L, 70, 'high') RETURNING calculated_by::text$q$, :'f1')), :'p1');
SELECT public.t_err('1.3 otro profesional no', public.t_val(:'p2', format($q$INSERT INTO public.patient_risk_scores(patient_id, score, level) VALUES (%L, 10, 'low') RETURNING 'OK'$q$, :'f1')), 'row-level security');
SELECT public.t_err('1.4 una reserva cancelada no da acceso', public.t_val(:'p1', format($q$INSERT INTO public.patient_risk_scores(patient_id, score, level) VALUES (%L, 10, 'low') RETURNING 'OK'$q$, :'f2')), 'row-level security');
SELECT public.t_eq('1.5 leen el paciente, su profesional y el superadmin; nadie más', public.t_val(:'f1', 'SELECT count(*)::text FROM public.patient_risk_scores') || '/' || public.t_val(:'p1', 'SELECT count(*)::text FROM public.patient_risk_scores')
  || '/' || public.t_val(:'p2', 'SELECT count(*)::text FROM public.patient_risk_scores') || '/' || public.t_val(:'f2', 'SELECT count(*)::text FROM public.patient_risk_scores')
  || '/' || public.t_val(:'hr', 'SELECT count(*)::text FROM public.patient_risk_scores') || '/' || public.t_val(:'ev', 'SELECT count(*)::text FROM public.patient_risk_scores')
  || '/' || public.t_val(:'sa', 'SELECT count(*)::text FROM public.patient_risk_scores'), '2/2/0/0/0/0/2');
SELECT public.t_err('1.6 nadie edita un cálculo', public.t_val(:'f1', 'UPDATE public.patient_risk_scores SET score = 1 RETURNING 1'), 'permission denied');
SELECT public.t_err('1.7 ni lo borra', public.t_val(:'f1', 'DELETE FROM public.patient_risk_scores RETURNING 1'), 'permission denied');
SELECT public.t_err('1.8 un puntaje fuera de 0-100 no entra', public.t_val(:'f1', $q$INSERT INTO public.patient_risk_scores(patient_id, score, level) VALUES (auth.uid(), 150, 'low') RETURNING 'OK'$q$), 'check constraint');
SELECT public.t_err('1.9 anon no lee', public.t_anon('SELECT count(*)::text FROM public.patient_risk_scores'), 'permission denied');

-- 2. Umbrales
SELECT public.t_eq('2.1 el paciente fija sus umbrales', public.t_val(:'f1', $q$INSERT INTO public.alert_thresholds(patient_id, vital_type, min_value, max_value) VALUES (auth.uid(), 'heart_rate', 55, 100) RETURNING vital_type$q$), 'heart_rate');
SELECT public.t_err('2.2 otro no los fija por él', public.t_val(:'p1', format($q$INSERT INTO public.alert_thresholds(patient_id, vital_type, min_value) VALUES (%L, 'spo2', 80) RETURNING 'OK'$q$, :'f1')), 'row-level security');
SELECT public.t_eq('2.3 ni los ve ni los cambia', public.t_val(:'f2', 'SELECT count(*)::text FROM public.alert_thresholds') || '/' || public.t_val(:'f2', 'WITH u AS (UPDATE public.alert_thresholds SET max_value = 300 RETURNING 1) SELECT count(*)::text FROM u'), '0/0');
SELECT public.t_err('2.4 mínimo mayor que máximo no entra', public.t_val(:'f1', $q$INSERT INTO public.alert_thresholds(patient_id, vital_type, min_value, max_value) VALUES (auth.uid(), 'spo2', 99, 90) RETURNING 'OK'$q$), 'check constraint');
SELECT public.t_err('2.5 los umbrales por defecto no los crea un usuario', public.t_val(:'f2', format('SELECT public.create_default_thresholds(%L)::text', :'f1')), 'permission denied');
SELECT public.t_run(NULL, 'service_role', format('SELECT public.create_default_thresholds(%L)::text', :'f1')) AS defres \gset
SELECT public.t_eq('2.6 sí la clave de servicio, sin pisar los que ya fijó el paciente', :'defres' || '/' || (SELECT count(*) || '/' || max(max_value) FILTER (WHERE vital_type = 'heart_rate') FROM public.alert_thresholds WHERE patient_id = :'f1'), '/6/100.00');

-- 3. Check-in / check-out
SELECT public.t_eq('3.1 el profesional marca llegada; el paciente sale de la reserva, no de lo que mande', public.t_val(:'p1', format($q$INSERT INTO public.service_checkins(booking_id, professional_id, patient_id, checkin_at, checkin_lat, checkin_lng, status) VALUES (%L, auth.uid(), %L, now(), 1.2, -77.3, 'checked_in') RETURNING patient_id::text$q$, :'b1', :'f2')), :'f1');
SELECT public.t_err('3.2 otro profesional no marca en una reserva ajena', public.t_val(:'p2', format($q$INSERT INTO public.service_checkins(booking_id, professional_id, status) VALUES (%L, auth.uid(), 'checked_in') RETURNING 'OK'$q$, :'b1')), 'row-level security');
SELECT public.t_err('3.3 ni a nombre de otro', public.t_val(:'p2', format($q$INSERT INTO public.service_checkins(booking_id, professional_id, status) VALUES (%L, %L, 'checked_in') RETURNING 'OK'$q$, :'b1', :'p1')), 'row-level security');
SELECT public.t_err('3.4 una sola fila por reserva y profesional', public.t_val(:'p1', format($q$INSERT INTO public.service_checkins(booking_id, professional_id) VALUES (%L, auth.uid()) RETURNING 'OK'$q$, :'b1')), 'duplicate key');
SELECT public.t_eq('3.5 al cerrar no puede mover la fila a otra reserva', public.t_val(:'p1', format($q$UPDATE public.service_checkins SET booking_id = %L, patient_id = %L, status = 'completed', duration_minutes = 240 WHERE booking_id = %L RETURNING (booking_id = %L) || '/' || (patient_id = %L) || '/' || status$q$, :'b3', :'f2', :'b1', :'b1', :'f1')), 'true/true/completed');
SELECT public.t_eq('3.6 leen el profesional, la familia del servicio y el superadmin', public.t_val(:'p1', 'SELECT count(*)::text FROM public.service_checkins') || '/' || public.t_val(:'f1', 'SELECT count(*)::text FROM public.service_checkins')
  || '/' || public.t_val(:'sa', 'SELECT count(*)::text FROM public.service_checkins'), '1/1/1');
SELECT public.t_eq('3.7 nadie más (ni otra familia, ni otro profesional, ni RR. HH.)', public.t_val(:'f2', 'SELECT count(*)::text FROM public.service_checkins') || '/' || public.t_val(:'p2', 'SELECT count(*)::text FROM public.service_checkins')
  || '/' || public.t_val(:'hr', 'SELECT count(*)::text FROM public.service_checkins') || '/' || public.t_val(:'i1', 'SELECT count(*)::text FROM public.service_checkins'), '0/0/0/0');
SELECT public.t_eq('3.8 la familia no edita el parte', public.t_val(:'f1', 'WITH u AS (UPDATE public.service_checkins SET notes = $$x$$ RETURNING 1) SELECT count(*)::text FROM u'), '0');
SELECT public.t_err('3.9 nadie borra un parte', public.t_val(:'p1', 'DELETE FROM public.service_checkins RETURNING 1'), 'permission denied');
SELECT public.t_eq('3.10 en un servicio de institución, el paciente es la institución de la reserva', public.t_val(:'p1', format($q$INSERT INTO public.service_checkins(booking_id, professional_id) VALUES (%L, auth.uid()) RETURNING patient_id::text$q$, :'b3')), :'i1');

-- 4. Evidencias (depósito privado)
SELECT public.t_true('4.1 el depósito es privado', NOT (SELECT public FROM storage.buckets WHERE id = 'evidence'));
SELECT public.t_eq('4.2 el profesional sube en la carpeta de su servicio', public.t_val(:'p1', format($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('evidence', 'checkins/%s/%s/1.jpg') RETURNING 'OK'$q$, :'b1', :'p1')), 'OK');
SELECT public.t_err('4.3 no en la de un servicio ajeno', public.t_val(:'p1', format($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('evidence', 'checkins/%s/%s/1.jpg') RETURNING 'OK'$q$, :'b2', :'p1')), 'row-level security');
SELECT public.t_err('4.4 ni en la carpeta de otro profesional', public.t_val(:'p2', format($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('evidence', 'checkins/%s/%s/1.jpg') RETURNING 'OK'$q$, :'b1', :'p1')), 'row-level security');
SELECT public.t_err('4.5 ni fuera de la ruta prevista', public.t_val(:'p1', format($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('evidence', 'checkins/%s/1.jpg') RETURNING 'OK'$q$, :'b1')), 'row-level security');
SELECT public.t_eq('4.6 leen las partes del servicio y el superadmin', public.t_val(:'p1', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$) || '/' || public.t_val(:'f1', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$)
  || '/' || public.t_val(:'sa', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$), '1/1/1');
SELECT public.t_eq('4.7 nadie más', public.t_val(:'f2', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$) || '/' || public.t_val(:'p2', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$)
  || '/' || public.t_anon($q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'evidence'$q$), '0/0/0');
SELECT public.t_true('4.8 una ruta mal formada no rompe la política', public.hx_evidence_booking('checkins/no-es-uuid/x/y.jpg') IS NULL AND public.hx_evidence_booking('otra/cosa') IS NULL);

-- 5. Privilegios y Realtime
SELECT public.t_true('5.1 anon sin privilegios en las tres tablas', NOT has_table_privilege('anon', 'public.patient_risk_scores', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.service_checkins', 'SELECT') AND NOT has_table_privilege('anon', 'public.alert_thresholds', 'SELECT'));
SELECT public.t_true('5.2 riesgo y partes en Realtime', (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('patient_risk_scores', 'service_checkins')) = 2);

SELECT public.t_sig_policies() || public.t_sig_acl() || (SELECT md5(string_agg(policyname || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE schemaname = 'storage')
  || (SELECT count(*) FROM public.service_checkins)::text || (SELECT count(*) FROM public.alert_thresholds)::text AS sig \gset
\i :MIG
SELECT public.t_eq('6.1 segunda pasada: mismas políticas, privilegios y filas', public.t_sig_policies() || public.t_sig_acl() || (SELECT md5(string_agg(policyname || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE schemaname = 'storage')
  || (SELECT count(*) FROM public.service_checkins)::text || (SELECT count(*) FROM public.alert_thresholds)::text, :'sig');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
