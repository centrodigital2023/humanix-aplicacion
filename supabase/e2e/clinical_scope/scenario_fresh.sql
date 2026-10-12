-- Escenario B — base SIN tablas clínicas (producción hoy, salvo clinical_alerts): la migración no crea ni cambia nada.
-- Variables: MIG, HELPERS
\i :HELPERS

SELECT public.t_sig_policies() AS sig_pol_before, public.t_sig_acl() AS sig_acl_before \gset
SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace)::text AS n_rel_before,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)::text AS n_fn_before,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::text AS n_pol_before \gset

SELECT public.t_eq('B0.1 la base no tiene tablas clínicas', public.q1($$SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports','eps_dashboard_metrics')$$), '0');

\i :MIG

SELECT public.t_eq('B1.1 no se creó ninguna relación', public.q1($$SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace$$), :'n_rel_before');
SELECT public.t_eq('B1.2 no se creó ninguna función', public.q1($$SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace$$), :'n_fn_before');
SELECT public.t_eq('B1.3 no cambió ninguna política del esquema', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'$$), :'n_pol_before');
SELECT public.t_eq('B1.4 las huellas de políticas y privilegios son las mismas', public.t_sig_policies() || public.t_sig_acl(), :'sig_pol_before' || :'sig_acl_before');
SELECT public.t_eq('B1.5 las cuentas siguen sin ver nada clínico (no hay tablas)', public.t_counts(:'i1'), 'alertas=- partes=- vitales=- umbrales=- riesgo=- informes=-');

\i :MIG
SELECT public.t_eq('B2.1 la segunda pasada tampoco cambia nada', public.t_sig_policies() || public.t_sig_acl(), :'sig_pol_before' || :'sig_acl_before');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
