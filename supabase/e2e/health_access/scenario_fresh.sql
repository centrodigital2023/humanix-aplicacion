-- Escenario — base SIN tablas de salud: la migración no hace nada ni falla.
\i :HELPERS
SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace)::text AS n_rel, (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)::text AS n_fn,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::text AS n_pol \gset
\i :MIG
SELECT public.t_eq('F1 no se crea ninguna relación', public.q1($$SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace$$), :'n_rel');
SELECT public.t_eq('F2 no se crea ninguna función', public.q1($$SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace$$), :'n_fn');
SELECT public.t_eq('F3 no cambia ninguna política', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'$$), :'n_pol');
\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
