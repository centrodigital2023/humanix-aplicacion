-- Escenario — base sin clinical_alerts (por ejemplo, instalada solo con la cadena de supabase/migrations): la migración no hace nada.
-- Variables: MIG, HELPERS
\i :HELPERS
SELECT public.t_sig_policies() AS sig_pol \gset
\i :MIG
SELECT public.t_eq('F.1 no crea funciones del SOS', public.q1($$SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('hx_sos_audience','hx_can_access_alert','hx_can_trigger_sos','clinical_alerts_sos_guard','clinical_alerts_sos_fanout','hx_notify_ex','hx_dashboard_link','emergency_incidents_fanout','trg_clinical_alerts_notify')$$), '0');
SELECT public.t_eq('F.2 no toca las políticas', public.t_sig_policies(), :'sig_pol');
SELECT public.t_true('F.3 la política del botón de pánico queda como estaba (sin la comprobación de la reserva)', (SELECT with_check FROM pg_policies WHERE tablename = 'emergency_incidents' AND policyname = 'emergency_insert_self') NOT LIKE '%service_bookings%');
\i :MIG
SELECT public.t_true('F.4 segunda pasada sin error', true);
\i :MIG2
SELECT public.t_eq('F.5 la lista de alertas tampoco hace nada sin clinical_alerts', public.q1($$SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'my_sos_alerts'$$), '0');
\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
