-- Escenario A — cadena del repositorio (políticas «por rol»): la fuga EXISTE antes de la migración y DESAPARECE después.
-- Variables: MIG = ruta de supabase/migrations/20261012100000_clinical_data_scope.sql
\i :HELPERS

-- ═══ Datos: un registro clínico por servicio en cada tabla ═══════════════════════════════════════════════════
INSERT INTO public.vital_signs(patient_id, booking_id, type, value, unit) VALUES
  (:'f1', :'b1', 'heart_rate', 72, 'bpm'), (:'f2', :'b2', 'heart_rate', 70, 'bpm'),
  (:'t3', :'b3', 'heart_rate', 75, 'bpm'), (:'t4', :'b4', 'heart_rate', 68, 'bpm');
INSERT INTO public.alert_thresholds(patient_id, vital_type, min_value, max_value) VALUES
  (:'f1','heart_rate',50,110), (:'f2','heart_rate',50,110), (:'t3','heart_rate',50,110), (:'t4','heart_rate',50,110);
INSERT INTO public.clinical_alerts(patient_id, booking_id, alert_type, actual_value, severity) VALUES
  (:'f1', :'b1', 'high_heart_rate', 130, 'high'), (:'f2', :'b2', 'high_heart_rate', 131, 'high'),
  (:'t3', :'b3', 'high_heart_rate', 132, 'high'), (:'t4', :'b4', 'high_heart_rate', 133, 'high');
SELECT id AS a1 FROM public.clinical_alerts WHERE booking_id = :'b1' \gset
SELECT id AS a3 FROM public.clinical_alerts WHERE booking_id = :'b3' \gset
SELECT id AS a4 FROM public.clinical_alerts WHERE booking_id = :'b4' \gset
INSERT INTO public.service_checkins(booking_id, professional_id, patient_id) VALUES
  (:'b1', :'p1', :'f1'), (:'b2', :'p2', :'f2'), (:'b3', :'p1', :'t3'), (:'b4', :'p2', :'t4');
INSERT INTO public.patient_risk_scores(patient_id, booking_id, score, level) VALUES
  (:'f1', :'b1', 30, 'medium'), (:'f2', :'b2', 40, 'medium'), (:'t3', :'b3', 80, 'critical'), (:'t4', :'b4', 60, 'high'),
  (:'f1', NULL, 35, 'medium');
INSERT INTO public.clinical_reports(patient_id, booking_id, period, period_start, period_end, report_text) VALUES
  (:'f1', :'b1', 'daily', current_date, current_date, 'x'), (:'f2', :'b2', 'daily', current_date, current_date, 'x'),
  (:'t3', :'b3', 'daily', current_date, current_date, 'x'), (:'t4', :'b4', 'daily', current_date, current_date, 'x');
SELECT id AS th_f1 FROM public.alert_thresholds WHERE patient_id = :'f1' \gset

SELECT public.t_sig_policies() AS sig_pol_before, public.t_sig_acl() AS sig_acl_before \gset

-- ═══ ANTES: la fuga existe (esto demuestra que las pruebas de después sí detectan el problema) ═══════════════
SELECT public.t_eq('A0.1 antes: la institución 1 ve TODO lo de todas las demás', public.t_counts(:'i1'), 'alertas=4 partes=4 vitales=4 umbrales=4 riesgo=5 informes=4');
SELECT public.t_eq('A0.2 antes: el profesional 2 lee todos los puntajes y los informes de la plataforma', public.t_counts(:'p2'), 'alertas=2 partes=2 vitales=2 umbrales=0 riesgo=5 informes=4');
SELECT public.t_eq('A0.3 antes: la familia 2 ve solo lo suyo', public.t_counts(:'f2'), 'alertas=1 partes=1 vitales=1 umbrales=1 riesgo=1 informes=1');
SELECT public.t_eq('A0.4 antes: la institución 2 puede modificar la alerta de otra familia', public.t_val(:'i2', format($q$WITH u AS (UPDATE public.clinical_alerts SET notes = 'tocada' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '1');
-- (Un profesional solo modificaba lo que además podía leer: la política de lectura lo acotaba a sus servicios.)
SELECT public.t_eq('A0.4b antes: el profesional 2 NO modificaba la alerta de otra familia (la lectura lo limitaba)', public.t_val(:'p2', format($q$WITH u AS (UPDATE public.clinical_alerts SET notes = 'tocada' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '0');
SELECT public.t_eq('A0.5 antes: la institución 1 puede modificar el umbral de otra familia', public.t_val(:'i1', format($q$WITH u AS (UPDATE public.alert_thresholds SET max_value = 999 WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'th_f1')), '1');
UPDATE public.clinical_alerts SET notes = NULL; UPDATE public.alert_thresholds SET max_value = 110;
SELECT public.t_eq('A0.6 antes: anon no ve filas pero tiene privilegios de tabla', public.t_anon('SELECT count(*)::text FROM public.clinical_alerts'), '0');
SELECT public.t_true('A0.7 antes: anon tiene SELECT sobre la vista del portal EPS', has_table_privilege('anon', 'public.eps_dashboard_metrics', 'SELECT'));
SELECT public.t_true('A0.8 antes: authenticated puede TRUNCATE las alertas', has_table_privilege('authenticated', 'public.clinical_alerts', 'TRUNCATE'));
SELECT public.t_true('A0.9 antes: cualquiera puede llamar create_default_thresholds', has_function_privilege('authenticated', 'public.create_default_thresholds(uuid)', 'EXECUTE') AND has_function_privilege('anon', 'public.create_default_thresholds(uuid)', 'EXECUTE'));
SELECT public.t_eq('A0.10 antes: la vista del portal EPS cuenta a todos los pacientes (corre con los permisos de su dueño)', public.t_val(:'i1', 'SELECT total_patients::text FROM public.eps_dashboard_metrics'), '4');

-- Un entorno donde alguien apagó RLS de una tabla clínica: la migración debe volver a encenderla.
ALTER TABLE public.clinical_reports DISABLE ROW LEVEL SECURITY;
-- Y otro donde authenticated ya solo podía LEER los informes: la migración no debe devolverle INSERT, UPDATE ni DELETE.
REVOKE INSERT, UPDATE, DELETE ON public.clinical_reports FROM authenticated;

-- ═══ LA MIGRACIÓN ════════════════════════════════════════════════════════════════════════════════════════════
\i :MIG

-- ═══ DESPUÉS: cada cuenta ve solo lo de sus servicios ════════════════════════════════════════════════════════
SELECT public.t_eq('A1.1 familia 1: lo suyo (incluye el puntaje sin servicio)', public.t_counts(:'f1'), 'alertas=1 partes=1 vitales=1 umbrales=1 riesgo=2 informes=1');
SELECT public.t_eq('A1.2 familia 2: lo suyo', public.t_counts(:'f2'), 'alertas=1 partes=1 vitales=1 umbrales=1 riesgo=1 informes=1');
SELECT public.t_eq('A1.3 profesional 1: los servicios B1 y B3, sin umbrales', public.t_counts(:'p1'), 'alertas=2 partes=2 vitales=2 umbrales=0 riesgo=2 informes=2');
SELECT public.t_eq('A1.4 profesional 2: los servicios B2 y B4, sin umbrales', public.t_counts(:'p2'), 'alertas=2 partes=2 vitales=2 umbrales=0 riesgo=2 informes=2');
SELECT public.t_eq('A1.5 institución 1: solo su servicio B3', public.t_counts(:'i1'), 'alertas=1 partes=1 vitales=1 umbrales=0 riesgo=1 informes=1');
SELECT public.t_eq('A1.6 institución 2: solo su servicio B4', public.t_counts(:'i2'), 'alertas=1 partes=1 vitales=1 umbrales=0 riesgo=1 informes=1');
SELECT public.t_eq('A1.7 superadmin: todo', public.t_counts(:'sa'), 'alertas=4 partes=4 vitales=4 umbrales=4 riesgo=5 informes=4');
SELECT public.t_eq('A1.8 HR no lee datos de salud', public.t_counts(:'hr'), 'alertas=0 partes=0 vitales=0 umbrales=0 riesgo=0 informes=0');
SELECT public.t_eq('A1.9 un evaluador no lee datos de salud', public.t_counts(:'ev'), 'alertas=0 partes=0 vitales=0 umbrales=0 riesgo=0 informes=0');
SELECT public.t_eq('A1.10 un paciente sin rol ni servicio solo ve lo suyo (nada de lo de otros)', public.t_counts(:'t4'), 'alertas=1 partes=1 vitales=1 umbrales=1 riesgo=1 informes=1');

-- Escrituras
SELECT public.t_eq('A2.1 el profesional 2 ya no modifica la alerta de otra familia', public.t_val(:'p2', format($q$WITH u AS (UPDATE public.clinical_alerts SET notes = 'tocada' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '0');
SELECT public.t_eq('A2.2 la institución 2 ya no modifica la alerta de la institución 1', public.t_val(:'i2', format($q$WITH u AS (UPDATE public.clinical_alerts SET notes = 'tocada' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a3')), '0');
SELECT public.t_eq('A2.3 la institución 1 sí atiende la alerta de su servicio', public.t_val(:'i1', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a3')), '1');
SELECT public.t_eq('A2.4 el profesional del servicio sí atiende su alerta', public.t_val(:'p1', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'resolved' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a3')), '1');
SELECT public.t_eq('A2.5 el paciente sí atiende su propia alerta', public.t_val(:'f1', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '1');
SELECT public.t_eq('A2.6 HR no atiende alertas', public.t_val(:'hr', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a4')), '0');
SELECT public.t_eq('A2.7 el superadmin sí', public.t_val(:'sa', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a4')), '1');
SELECT public.t_eq('A2.8 la institución 1 ya no modifica el umbral de otra familia', public.t_val(:'i1', format($q$WITH u AS (UPDATE public.alert_thresholds SET max_value = 999 WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'th_f1')), '0');
SELECT public.t_eq('A2.9 la familia sí modifica su propio umbral', public.t_val(:'f1', format($q$WITH u AS (UPDATE public.alert_thresholds SET max_value = 120 WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'th_f1')), '1');
SELECT public.t_err('A2.10 la institución 1 no crea umbrales a nombre de un paciente ajeno', public.t_val(:'i1', format($q$INSERT INTO public.alert_thresholds(patient_id, vital_type, min_value, max_value) VALUES (%L, 'spo2', 90, NULL) RETURNING 'x'$q$, :'t3')), 'row-level security');
-- Lo que ya funcionaba sigue funcionando
SELECT public.t_eq('A2.11 el SOS del propio paciente sigue entrando', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, actual_value) VALUES (%L, 'sos_manual', 'critical', 0) RETURNING 'OK'$q$, :'f1')), 'OK');
SELECT public.t_err('A2.12 pero nadie crea un SOS a nombre de otro', public.t_val(:'f1', format($q$INSERT INTO public.clinical_alerts(patient_id, alert_type, severity, actual_value) VALUES (%L, 'sos_manual', 'critical', 0) RETURNING 'OK'$q$, :'f2')), 'row-level security');
SELECT public.t_eq('A2.13 el profesional del servicio sigue registrando signos vitales', public.t_val(:'p1', format($q$INSERT INTO public.vital_signs(patient_id, booking_id, type, value, unit) VALUES (%L, %L, 'spo2', 97, '%%') RETURNING 'OK'$q$, :'f1', :'b1')), 'OK');
SELECT public.t_err('A2.14 y otro profesional no los registra en un servicio ajeno', public.t_val(:'p2', format($q$INSERT INTO public.vital_signs(patient_id, booking_id, type, value, unit) VALUES (%L, %L, 'spo2', 97, '%%') RETURNING 'OK'$q$, :'f1', :'b1')), 'row-level security');
SELECT public.t_eq('A2.15 el profesional sigue registrando su check-in', public.t_val(:'p1', format($q$INSERT INTO public.service_checkins(booking_id, professional_id, patient_id) VALUES (%L, %L, %L) RETURNING 'OK'$q$, :'b1', :'p1', :'f1')), 'OK');

-- Privilegios
SELECT public.t_err('A3.1 anon ya no puede ni consultar las alertas', public.t_anon('SELECT count(*)::text FROM public.clinical_alerts'), 'permission denied');
SELECT public.t_err('A3.2 anon ya no puede ni consultar los puntajes', public.t_anon('SELECT count(*)::text FROM public.patient_risk_scores'), 'permission denied');
SELECT public.t_err('A3.3 anon ya no puede consultar la vista del portal EPS', public.t_anon('SELECT count(*)::text FROM public.eps_dashboard_metrics'), 'permission denied');
SELECT public.t_true('A3.3b anon no conserva ningún privilegio sobre la vista (además de que ya no la puede leer)', NOT has_table_privilege('anon', 'public.eps_dashboard_metrics', 'SELECT'));
SELECT public.t_eq('A3.4 ni anon ni authenticated conservan TRUNCATE, REFERENCES ni TRIGGER en ninguna tabla clínica', public.q1($$
  SELECT count(*)::text FROM unnest(ARRAY['vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports']) AS t(n),
         unnest(ARRAY['anon','authenticated']) AS r(n), unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) AS p(n)
   WHERE has_table_privilege(r.n, 'public.' || t.n, p.n)$$), '0');
SELECT public.t_eq('A3.5 authenticated conserva SELECT, INSERT, UPDATE y DELETE donde ya los tenía (los gobierna RLS)', public.q1($$
  SELECT count(*)::text FROM unnest(ARRAY['vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores']) AS t(n),
         unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(n)
   WHERE has_table_privilege('authenticated', 'public.' || t.n, p.n)$$), '20');
SELECT public.t_true('A3.5b y no se le añade nada donde tenía menos: clinical_reports sigue solo con SELECT',
  has_table_privilege('authenticated', 'public.clinical_reports', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.clinical_reports', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.clinical_reports', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.clinical_reports', 'DELETE'));
SELECT public.t_true('A3.6 service_role conserva todo', has_table_privilege('service_role', 'public.clinical_alerts', 'TRUNCATE') AND has_table_privilege('service_role', 'public.patient_risk_scores', 'INSERT'));
SELECT public.t_true('A3.7 la función de umbrales solo la ejecuta el servidor', NOT has_function_privilege('anon', 'public.create_default_thresholds(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.create_default_thresholds(uuid)', 'EXECUTE') AND has_function_privilege('service_role', 'public.create_default_thresholds(uuid)', 'EXECUTE'));
SELECT public.t_true('A3.8 las dos funciones SECURITY DEFINER fijan search_path', (SELECT bool_and(p.proconfig IS NOT NULL AND p.proconfig::text LIKE '%search_path=public%')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('create_default_thresholds','evaluate_vital_alert')));
SELECT public.t_eq('A3.9 RLS sigue activa en todas', public.q1($$SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports') AND relrowsecurity$$), '6');

-- La vista del portal EPS respeta RLS de quien la consulta
SELECT public.t_eq('A4.1 la institución 1 solo cuenta a su paciente', public.t_val(:'i1', 'SELECT total_patients::text FROM public.eps_dashboard_metrics'), '1');
SELECT public.t_eq('A4.2 la institución 2 solo cuenta a su paciente', public.t_val(:'i2', 'SELECT total_patients::text FROM public.eps_dashboard_metrics'), '1');
SELECT public.t_eq('A4.3 el superadmin ve el total', public.t_val(:'sa', 'SELECT total_patients::text FROM public.eps_dashboard_metrics'), '4');
SELECT public.t_eq('A4.4 HR no ve nada', public.t_val(:'hr', 'SELECT total_patients::text FROM public.eps_dashboard_metrics'), 'NULL');
SELECT public.t_true('A4.5 la vista es security_invoker', EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.eps_dashboard_metrics'::regclass AND reloptions::text LIKE '%security_invoker=true%'));

-- Inventario de políticas: ninguna «por rol»
SELECT public.t_eq('A5.1 ninguna política de las tablas clínicas nombra roles institution/professional/family', public.q1($$
  SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports')
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '''(institution|professional|family)''::'$$), '0');
SELECT public.t_eq('A5.2 las políticas conservan el mismo nombre y comando', public.q1($$
  SELECT string_agg(tablename || '.' || policyname || ':' || cmd, ', ' ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports')$$),
  'alert_thresholds.alert_thresholds_owner:ALL, clinical_alerts.clinical_alerts_read:SELECT, clinical_alerts.clinical_alerts_sos_self_insert:INSERT, clinical_alerts.clinical_alerts_update:UPDATE, clinical_reports.clinical_reports_read:SELECT, patient_risk_scores.risk_scores_read:SELECT, service_checkins.checkins_patient_read:SELECT, service_checkins.checkins_professional_all:ALL, vital_signs.vital_signs_patient_select:SELECT, vital_signs.vital_signs_professional_insert:INSERT');
SELECT public.t_true('A5.3 las políticas nuevas son solo para authenticated', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
   AND policyname IN ('vital_signs_patient_select','alert_thresholds_owner','clinical_alerts_read','clinical_alerts_update','checkins_patient_read','risk_scores_read','clinical_reports_read')
   AND roles <> ARRAY['authenticated']::name[]));

-- ═══ SEGUNDA PASADA: idempotente ═════════════════════════════════════════════════════════════════════════════
SELECT public.t_sig_policies() AS sig_pol_mid, public.t_sig_acl() AS sig_acl_mid \gset
SELECT public.t_true('A6.0 las políticas y los privilegios cambiaron con la primera pasada', :'sig_pol_mid' <> :'sig_pol_before' AND :'sig_acl_mid' <> :'sig_acl_before');
\i :MIG
SELECT public.t_eq('A6.1 la segunda pasada no cambia las políticas', public.t_sig_policies(), :'sig_pol_mid');
SELECT public.t_eq('A6.2 ni los privilegios', public.t_sig_acl(), :'sig_acl_mid');
SELECT public.t_eq('A6.3 y el resultado para las cuentas es el mismo', public.t_counts(:'i1'), 'alertas=1 partes=1 vitales=1 umbrales=0 riesgo=1 informes=1');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
