-- Escenario — sedes de la institución. Variables: MIG, HELPERS, STUBS.
\i :HELPERS
\i :STUBS
INSERT INTO public.institution_profiles(user_id, institution_name, city, address) VALUES (:'i1', 'Clínica Uno', 'Pasto', 'Cra 1');
SELECT public.t_true('0.1 antes: no existe la tabla', to_regclass('public.institution_branches') IS NULL);

\i :MIG

SELECT public.t_eq('1.1 la institución que ya existía recibe su sede principal', (SELECT string_agg(name || '/' || is_main, ',') FROM public.institution_branches WHERE institution_id = :'i1'), 'Clínica Uno/true');
INSERT INTO public.institution_profiles(user_id, institution_name) VALUES (:'i2', 'IPS Dos');
SELECT public.t_eq('1.2 una institución nueva también', (SELECT string_agg(name || '/' || is_main, ',') FROM public.institution_branches WHERE institution_id = :'i2'), 'IPS Dos/true');
SELECT public.t_eq('2.1 la institución agrega una sede (nunca como principal)', public.t_val(:'i1', $q$INSERT INTO public.institution_branches(institution_id, name, city, is_main) VALUES (auth.uid(), 'Sede Norte', 'Pasto', true) RETURNING is_main::text$q$), 'false');
SELECT public.t_eq('2.2 ve solo las suyas', public.t_val(:'i1', 'SELECT count(*)::text FROM public.institution_branches') || '/' || public.t_val(:'i2', 'SELECT count(*)::text FROM public.institution_branches'), '2/1');
SELECT public.t_true('2.3 una familia no crea sedes', public.t_val(:'f1', $q$INSERT INTO public.institution_branches(institution_id, name) VALUES (auth.uid(), 'x') RETURNING 'OK'$q$) LIKE 'ERR[42501]%');
SELECT public.t_true('2.4 ni a nombre de otra institución', public.t_val(:'i2', format($q$INSERT INTO public.institution_branches(institution_id, name) VALUES (%L, 'x') RETURNING 'OK'$q$, :'i1')) LIKE 'ERR[42501]%');
SELECT public.t_eq('2.5 no se cambia la principal ni el dueño', public.t_val(:'i1', format($q$UPDATE public.institution_branches SET is_main = NOT is_main, institution_id = %L, city = 'Ipiales' WHERE institution_id = auth.uid() AND name = 'Sede Norte' RETURNING is_main || '/' || (institution_id = auth.uid()) || '/' || city$q$, :'i2')), 'false/true/Ipiales');
SELECT public.t_eq('2.6 la principal no se borra; las demás sí', public.t_val(:'i1', 'WITH d AS (DELETE FROM public.institution_branches WHERE is_main RETURNING 1) SELECT count(*)::text FROM d') || '/' || public.t_val(:'i1', $q$WITH d AS (DELETE FROM public.institution_branches WHERE name = 'Sede Norte' RETURNING 1) SELECT count(*)::text FROM d$q$), '0/1');
SELECT public.t_eq('2.7 otra institución no borra ni edita lo ajeno', public.t_val(:'i2', format($q$WITH d AS (UPDATE public.institution_branches SET name = 'mía' WHERE institution_id = %L RETURNING 1) SELECT count(*)::text FROM d$q$, :'i1')), '0');
SELECT public.t_eq('2.8 el personal lee todo', public.t_val(:'sa', 'SELECT count(*)::text FROM public.institution_branches'), '2');
SELECT public.t_true('2.9 nombre vacío o enorme no entra', public.t_val(:'i1', $q$INSERT INTO public.institution_branches(institution_id, name) VALUES (auth.uid(), '  ') RETURNING 'OK'$q$) LIKE 'ERR[23514]%'
  AND public.t_val(:'i1', $q$INSERT INTO public.institution_branches(institution_id, name) VALUES (auth.uid(), repeat('x', 500)) RETURNING 'OK'$q$) LIKE 'ERR[23514]%');
INSERT INTO public.institution_branches(institution_id, name) SELECT :'i2', 'S' || g FROM generate_series(1, 199) g;
SELECT public.t_eq('2.10 tope de 200 sedes', public.t_val(:'i2', $q$INSERT INTO public.institution_branches(institution_id, name) VALUES (auth.uid(), 'una más') RETURNING 'OK'$q$), 'ERR[54000] Llegaste al máximo de 200 sedes');
SELECT public.t_true('2.11 anon sin privilegios y en Realtime', NOT has_table_privilege('anon', 'public.institution_branches', 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'institution_branches'));

SELECT (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'institution_branches') || (SELECT relacl::text FROM pg_class WHERE oid = 'public.institution_branches'::regclass) || (SELECT count(*) FROM public.institution_branches)::text AS sig \gset
\i :MIG
SELECT public.t_eq('3.1 segunda pasada: mismas políticas, privilegios y filas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'institution_branches') || (SELECT relacl::text FROM pg_class WHERE oid = 'public.institution_branches'::regclass) || (SELECT count(*) FROM public.institution_branches)::text, :'sig');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
