-- Escenario C — como producción hoy: SOLO `clinical_alerts`, tal como la creó drizzle/migrations/0007 (políticas ya
-- estrechas) y con los privilegios por defecto de Supabase (anon y authenticated con ALL).
-- La migración NO debe tocar las políticas (no añade ni quita lectores): solo retira privilegios que nadie usa.
-- Variables: MIG, HELPERS, DRIZZLE_CLINICAL (SQL de clinical_alerts extraído de drizzle/migrations/0007…)
\i :HELPERS
\i :DRIZZLE_CLINICAL

INSERT INTO public.clinical_alerts(patient_id, booking_id, alert_type, actual_value, severity) VALUES
  (:'f1', :'b1', 'high_heart_rate', 130, 'high'), (:'t3', :'b3', 'high_heart_rate', 132, 'high');
SELECT id AS a1 FROM public.clinical_alerts WHERE booking_id = :'b1' \gset

SELECT public.t_sig_policies() AS sig_pol_before, public.t_sig_acl() AS sig_acl_before \gset

SELECT public.t_eq('C0.1 producción: las dos políticas estrechas de drizzle', public.q1($$SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinical_alerts'$$), 'clinical_alerts_ack:UPDATE, clinical_alerts_read:SELECT');
SELECT public.t_true('C0.2 antes: anon y authenticated tienen privilegios de sobra (los por defecto)', has_table_privilege('anon', 'public.clinical_alerts', 'SELECT') AND has_table_privilege('authenticated', 'public.clinical_alerts', 'TRUNCATE'));
SELECT public.t_eq('C0.3 antes: la familia ve lo suyo', public.t_val(:'f1', 'SELECT count(*)::text FROM public.clinical_alerts'), '1');
SELECT public.t_eq('C0.4 antes: el profesional ve las de sus servicios', public.t_val(:'p1', 'SELECT count(*)::text FROM public.clinical_alerts'), '2');
SELECT public.t_eq('C0.5 antes: la institución NO ve las de sus servicios (hoy no hay política para quien contrató)', public.t_val(:'i1', 'SELECT count(*)::text FROM public.clinical_alerts'), '0');
SELECT public.t_eq('C0.6 antes: HR y evaluadores sí leen (is_staff) — observación, no la cambia esta migración', public.t_val(:'hr', 'SELECT count(*)::text FROM public.clinical_alerts') || '/' || public.t_val(:'ev', 'SELECT count(*)::text FROM public.clinical_alerts'), '2/2');
SELECT public.t_eq('C0.7 antes: el paciente atiende su alerta', public.t_val(:'f1', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '1');
UPDATE public.clinical_alerts SET status = 'active';
SELECT public.t_sig_policies() AS sig_pol_before, public.t_sig_acl() AS sig_acl_before \gset

\i :MIG

SELECT public.t_eq('C1.1 las políticas NO cambiaron (ni se añaden ni se quitan lectores)', public.t_sig_policies(), :'sig_pol_before');
SELECT public.t_true('C1.2 sí cambiaron los privilegios', public.t_sig_acl() <> :'sig_acl_before');
SELECT public.t_true('C1.3 anon ya no tiene ningún privilegio sobre la tabla', NOT (has_table_privilege('anon', 'public.clinical_alerts', 'SELECT') OR has_table_privilege('anon', 'public.clinical_alerts', 'INSERT')
   OR has_table_privilege('anon', 'public.clinical_alerts', 'UPDATE') OR has_table_privilege('anon', 'public.clinical_alerts', 'DELETE') OR has_table_privilege('anon', 'public.clinical_alerts', 'TRUNCATE')));
SELECT public.t_true('C1.4 authenticated ya no puede TRUNCATE, REFERENCES ni TRIGGER', NOT (has_table_privilege('authenticated', 'public.clinical_alerts', 'TRUNCATE')
   OR has_table_privilege('authenticated', 'public.clinical_alerts', 'REFERENCES') OR has_table_privilege('authenticated', 'public.clinical_alerts', 'TRIGGER')));
SELECT public.t_true('C1.5 authenticated conserva SELECT y UPDATE', has_table_privilege('authenticated', 'public.clinical_alerts', 'SELECT') AND has_table_privilege('authenticated', 'public.clinical_alerts', 'UPDATE'));
SELECT public.t_true('C1.6 service_role lo conserva todo', has_table_privilege('service_role', 'public.clinical_alerts', 'TRUNCATE') AND has_table_privilege('service_role', 'public.clinical_alerts', 'INSERT'));
SELECT public.t_err('C1.7 anon ya no consulta la tabla', public.t_anon('SELECT count(*)::text FROM public.clinical_alerts'), 'permission denied');
SELECT public.t_eq('C1.8 la familia sigue viendo lo suyo', public.t_val(:'f1', 'SELECT count(*)::text FROM public.clinical_alerts'), '1');
SELECT public.t_eq('C1.9 el profesional sigue viendo las de sus servicios', public.t_val(:'p1', 'SELECT count(*)::text FROM public.clinical_alerts'), '2');
SELECT public.t_eq('C1.10 la institución sigue sin ver (no se aflojó nada)', public.t_val(:'i1', 'SELECT count(*)::text FROM public.clinical_alerts'), '0');
SELECT public.t_eq('C1.11 HR y evaluadores siguen igual (la migración no toca esas políticas)', public.t_val(:'hr', 'SELECT count(*)::text FROM public.clinical_alerts') || '/' || public.t_val(:'ev', 'SELECT count(*)::text FROM public.clinical_alerts'), '2/2');
SELECT public.t_eq('C1.12 el paciente sigue atendiendo su alerta', public.t_val(:'f1', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'acknowledged' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '1');
SELECT public.t_eq('C1.13 y otro profesional no', public.t_val(:'p2', format($q$WITH u AS (UPDATE public.clinical_alerts SET status = 'resolved' WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, :'a1')), '0');

SELECT public.t_sig_policies() AS sig_pol_mid, public.t_sig_acl() AS sig_acl_mid \gset
\i :MIG
SELECT public.t_eq('C2.1 la segunda pasada no cambia nada (políticas)', public.t_sig_policies(), :'sig_pol_mid');
SELECT public.t_eq('C2.2 ni los privilegios', public.t_sig_acl(), :'sig_acl_mid');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
