-- Escenario — datos de salud tal como están en PRODUCCIÓN hoy (clinical_alerts de drizzle/0007, vital_signs_readings y
-- wearable_connections de las migraciones de Lovable, con is_staff() y los privilegios por defecto de Supabase).
-- Variables: MIG (20261012150000_health_data_access.sql), HELPERS (../clinical_scope/helpers.sql), PROD_SQL (DDL de producción)
\i :HELPERS
\i :PROD_SQL

-- ═══ Datos ════════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.clinical_alerts(patient_id, booking_id, alert_type, actual_value, severity) VALUES
  (:'f1', :'b1', 'high_heart_rate', 130, 'high'),     -- servicio de la familia 1 con el profesional 1
  (:'t3', :'b3', 'high_heart_rate', 132, 'high'),     -- servicio de la institución 1 con el profesional 1
  (:'t4', :'b4', 'high_heart_rate', 133, 'high');     -- servicio de la institución 2 con el profesional 2
SELECT id AS a1 FROM public.clinical_alerts WHERE booking_id = :'b1' \gset
SELECT id AS a3 FROM public.clinical_alerts WHERE booking_id = :'b3' \gset
SELECT id AS a4 FROM public.clinical_alerts WHERE booking_id = :'b4' \gset
INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, unit, recorded_by) VALUES
  (:'f1', 'heart_rate', 72, 'bpm', :'f1'), (:'f2', 'heart_rate', 70, 'bpm', :'f2');
INSERT INTO public.wearable_connections(patient_id, provider) VALUES (:'f1', 'garmin'), (:'f2', 'fitbit');

CREATE FUNCTION public.t_cnt(u uuid, tbl text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_val(u, 'SELECT count(*)::text FROM public.' || tbl) $$;
CREATE FUNCTION public.t_upd(u uuid, stmt text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_val(u, 'WITH x AS (' || stmt || ' RETURNING 1) SELECT count(*)::text FROM x') $$;

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('0.1 antes: RR. HH. y el evaluador leen las alertas', public.t_cnt(:'hr', 'clinical_alerts') || '/' || public.t_cnt(:'ev', 'clinical_alerts'), '3/3');
SELECT public.t_eq('0.2 antes: la institución 1 no ve las alertas de su propio servicio', public.t_cnt(:'i1', 'clinical_alerts'), '0');
SELECT public.t_eq('0.3 antes: RR. HH. lee las lecturas de signos vitales y los códigos de emparejamiento', public.t_cnt(:'hr', 'vital_signs_readings') || '/' || public.t_cnt(:'hr', 'wearable_connections'), '2/2');
SELECT public.t_eq('0.4 antes: cualquiera inserta una lectura a nombre de otra familia', public.t_val(:'p2', format($q$INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, recorded_by) VALUES (%L, 'spo2', 60, %L) RETURNING 'OK'$q$, :'f1', :'p2')), 'OK');
DELETE FROM public.vital_signs_readings WHERE reading_type = 'spo2';
SELECT public.t_true('0.5 antes: anon tiene todos los privilegios sobre las dos tablas', has_table_privilege('anon', 'public.vital_signs_readings', 'SELECT') AND has_table_privilege('anon', 'public.wearable_connections', 'TRUNCATE'));
SELECT public.t_true('0.6 antes: authenticated puede reescribir cualquier columna de una alerta', has_column_privilege('authenticated', 'public.clinical_alerts', 'severity', 'UPDATE'));
SELECT public.t_sig_policies() AS x \gset

\i :MIG

-- ═══ DESPUÉS ══════════════════════════════════════════════════════════════════════════════════════════════════
-- Lectura de alertas
SELECT public.t_eq('1.1 RR. HH. y evaluador ya no leen las alertas', public.t_cnt(:'hr', 'clinical_alerts') || '/' || public.t_cnt(:'ev', 'clinical_alerts'), '0/0');
SELECT public.t_eq('1.2 el superadmin las lee todas', public.t_cnt(:'sa', 'clinical_alerts'), '3');
SELECT public.t_eq('1.3 la institución 1 ve la alerta de su servicio y solo esa', public.t_cnt(:'i1', 'clinical_alerts'), '1');
SELECT public.t_eq('1.4 la institución 2 ve la suya', public.t_cnt(:'i2', 'clinical_alerts'), '1');
SELECT public.t_eq('1.5 la familia 1 ve la de su servicio; la familia 2 ninguna', public.t_cnt(:'f1', 'clinical_alerts') || '/' || public.t_cnt(:'f2', 'clinical_alerts'), '1/0');
SELECT public.t_eq('1.6 el profesional 1 ve las de sus dos servicios; el 2 solo la suya', public.t_cnt(:'p1', 'clinical_alerts') || '/' || public.t_cnt(:'p2', 'clinical_alerts'), '2/1');
-- Atender una alerta
SELECT public.t_eq('2.1 la institución 1 atiende la alerta de su servicio', public.t_upd(:'i1', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L$q$, :'a3')), '1');
SELECT public.t_eq('2.2 y queda registrada ella como quien la atendió (el sistema lo pone)', public.q1(format($q$SELECT (acknowledged_by = %L AND acknowledged_at IS NOT NULL)::text FROM public.clinical_alerts WHERE id = %L$q$, :'i1', :'a3')), 'true');
SELECT public.t_eq('2.3 la institución 2 NO atiende la alerta de otra institución', public.t_upd(:'i2', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L$q$, :'a3')), '0');
SELECT public.t_eq('2.4 RR. HH. no atiende alertas', public.t_upd(:'hr', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L$q$, :'a1')), '0');
SELECT public.t_eq('2.5 el profesional del servicio sí', public.t_upd(:'p1', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L$q$, :'a1')), '1');
SELECT public.t_eq('2.6 nadie puede atribuir la atención a otro (el disparador pisa acknowledged_by)', public.t_upd(:'p2', format($q$UPDATE public.clinical_alerts SET status = 'acknowledged', acknowledged_by = %L WHERE id = %L$q$, :'f1', :'a4')), '1');
SELECT public.t_eq('2.7 …queda el profesional 2 como quien atendió, no la familia', public.q1(format($q$SELECT (acknowledged_by = %L)::text FROM public.clinical_alerts WHERE id = %L$q$, :'p2', :'a4')), 'true');
SELECT public.t_err('2.8 el valor de una alerta no se reescribe', public.t_upd(:'p2', format($q$UPDATE public.clinical_alerts SET actual_value = 1 WHERE id = %L$q$, :'a4')), 'permission denied');
SELECT public.t_err('2.9 ni su gravedad', public.t_upd(:'sa', format($q$UPDATE public.clinical_alerts SET severity = 'low' WHERE id = %L$q$, :'a4')), 'permission denied');
SELECT public.t_eq('2.10 sí se escriben notas', public.t_upd(:'p2', format($q$UPDATE public.clinical_alerts SET notes = 'en camino' WHERE id = %L$q$, :'a4')), '1');
SELECT public.t_eq('2.11 se puede resolver una alerta atendida', public.t_upd(:'p2', format($q$UPDATE public.clinical_alerts SET status = 'resolved' WHERE id = %L$q$, :'a4')), '1');
SELECT public.t_err('2.12 una alerta resuelta no se reabre', public.t_upd(:'p2', format($q$UPDATE public.clinical_alerts SET status = 'active' WHERE id = %L$q$, :'a4')), 'no se reabre');
SELECT public.t_err('2.13 una alerta atendida no vuelve a «activa»', public.t_upd(:'i1', format($q$UPDATE public.clinical_alerts SET status = 'active' WHERE id = %L$q$, :'a3')), 'no vuelve');
-- Lecturas de signos vitales
SELECT public.t_eq('3.1 RR. HH. ya no lee lecturas ni códigos de emparejamiento', public.t_cnt(:'hr', 'vital_signs_readings') || '/' || public.t_cnt(:'hr', 'wearable_connections'), '0/0');
SELECT public.t_eq('3.2 el superadmin sí', public.t_cnt(:'sa', 'vital_signs_readings') || '/' || public.t_cnt(:'sa', 'wearable_connections'), '2/2');
SELECT public.t_eq('3.3 la familia ve y gestiona lo suyo', public.t_cnt(:'f1', 'vital_signs_readings') || '/' || public.t_cnt(:'f1', 'wearable_connections'), '1/1');
SELECT public.t_err('3.4 un desconocido ya no inserta una lectura a nombre de otra familia', public.t_val(:'p2', format($q$INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, recorded_by) VALUES (%L, 'spo2', 60, %L) RETURNING 'OK'$q$, :'f1', :'p2')), 'row-level security');
SELECT public.t_eq('3.5 el profesional con reserva vigente sí registra a nombre de su cliente', public.t_val(:'p1', format($q$INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, recorded_by, source) VALUES (%L, 'spo2', 97, %L, 'professional') RETURNING 'OK'$q$, :'f1', :'p1')), 'OK');
SELECT public.t_eq('3.6 y lo puede leer de vuelta', public.t_val(:'p1', 'SELECT count(*)::text FROM public.vital_signs_readings WHERE recorded_by = auth.uid()'), '1');
SELECT public.t_eq('3.7 la familia registra su propia lectura', public.t_val(:'f1', format($q$INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, recorded_by) VALUES (%L, 'heart_rate', 80, %L) RETURNING 'OK'$q$, :'f1', :'f1')), 'OK');
UPDATE public.service_bookings SET status = 'cancelled' WHERE id = :'b1';
SELECT public.t_err('3.8 con la reserva cancelada el profesional ya no registra a su nombre', public.t_val(:'p1', format($q$INSERT INTO public.vital_signs_readings(family_user_id, reading_type, value, recorded_by) VALUES (%L, 'spo2', 98, %L) RETURNING 'OK'$q$, :'f1', :'p1')), 'row-level security');
-- Privilegios
SELECT public.t_err('4.1 anon ya no puede consultar las lecturas', public.t_anon('SELECT count(*)::text FROM public.vital_signs_readings'), 'permission denied');
SELECT public.t_err('4.2 ni los dispositivos', public.t_anon('SELECT count(*)::text FROM public.wearable_connections'), 'permission denied');
SELECT public.t_err('4.3 ni las alertas', public.t_anon('SELECT count(*)::text FROM public.clinical_alerts'), 'permission denied');
SELECT public.t_eq('4.4 authenticated conserva SELECT, INSERT, UPDATE y DELETE de lecturas y dispositivos (8) y nada más', public.q1($$
  SELECT count(*)::text FROM unnest(ARRAY['vital_signs_readings','wearable_connections']) AS t(n), unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(n)
   WHERE has_table_privilege('authenticated', 'public.' || t.n, p.n)$$), '8');
SELECT public.t_true('4.5 clinical_alerts: authenticated lee y solo actualiza estado y notas', has_table_privilege('authenticated', 'public.clinical_alerts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.clinical_alerts', 'UPDATE') AND has_column_privilege('authenticated', 'public.clinical_alerts', 'status', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.clinical_alerts', 'notes', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'severity', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'actual_value', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'alert_type', 'UPDATE'));
SELECT public.t_true('4.5b clinical_alerts: authenticated sin TRUNCATE, REFERENCES ni TRIGGER', NOT has_table_privilege('authenticated', 'public.clinical_alerts', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.clinical_alerts', 'REFERENCES') AND NOT has_table_privilege('authenticated', 'public.clinical_alerts', 'TRIGGER')
  AND has_table_privilege('authenticated', 'public.clinical_alerts', 'INSERT') AND has_table_privilege('authenticated', 'public.clinical_alerts', 'DELETE'));
SELECT public.t_true('4.6 service_role lo conserva todo', has_table_privilege('service_role', 'public.clinical_alerts', 'UPDATE') AND has_table_privilege('service_role', 'public.vital_signs_readings', 'TRUNCATE'));
SELECT public.t_eq('4.7 el servidor (sin sesión) sí actualiza los avisos enviados', public.q1(format($q$WITH x AS (UPDATE public.clinical_alerts SET notified_whatsapp = true, notified_at = now() WHERE id = %L RETURNING 1) SELECT count(*)::text FROM x$q$, :'a1')), '1');
SELECT public.t_true('4.8 RLS sigue activa en las tres', (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.clinical_alerts'::regclass, 'public.vital_signs_readings'::regclass, 'public.wearable_connections'::regclass)));
SELECT public.t_eq('4.9 ninguna política de las tres tablas usa is_staff()', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('clinical_alerts','vital_signs_readings','wearable_connections') AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_staff%'$$), '0');
-- Idempotencia
SELECT public.t_sig_policies() AS sig_pol_1, public.t_sig_acl() AS sig_acl_1 \gset
\i :MIG
SELECT public.t_eq('5.1 la segunda pasada no cambia las políticas', public.t_sig_policies(), :'sig_pol_1');
SELECT public.t_eq('5.2 ni los privilegios', public.t_sig_acl(), :'sig_acl_1');
SELECT public.t_true('5.3 ni el privilegio por columnas de las alertas', has_column_privilege('authenticated', 'public.clinical_alerts', 'status', 'UPDATE') AND NOT has_column_privilege('authenticated', 'public.clinical_alerts', 'severity', 'UPDATE'));

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
