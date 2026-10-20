-- Escenario — SG-SST del profesional y protección del bloqueo del perfil. Variables: MIG, HELPERS, STUBS.
\i :HELPERS
\i :STUBS
INSERT INTO public.professional_profiles(user_id, published, active) VALUES (:'p1', true, true), (:'p2', true, true);
UPDATE public.professional_profiles SET blocked = true, blocked_reason = 'Revisión del evaluador', blocked_by = :'ev' WHERE user_id = :'p2';

-- ═══ ANTES (producción hoy) ═══
SELECT public.t_eq('0.1 antes: un profesional bloqueado por un evaluador se desbloquea solo', public.t_val(:'p2', $q$UPDATE public.professional_profiles SET blocked = false WHERE user_id = auth.uid() RETURNING blocked::text$q$), 'false');
UPDATE public.professional_profiles SET blocked = true, blocked_reason = 'Revisión del evaluador' WHERE user_id = :'p2';
SELECT public.t_true('0.2 antes: no existe la tabla', to_regclass('public.health_compliance') IS NULL);

\i :MIG

-- ═══ DESPUÉS ═══
SELECT public.t_eq('1.1 el profesional ya no se quita el bloqueo del evaluador', public.t_val(:'p2', $q$UPDATE public.professional_profiles SET blocked = false, blocked_reason = NULL WHERE user_id = auth.uid() RETURNING blocked::text || '/' || blocked_reason$q$), 'true/Revisión del evaluador');
SELECT public.t_eq('1.2 ni se bloquea a sí mismo, pero sigue editando su perfil', public.t_val(:'p1', $q$UPDATE public.professional_profiles SET blocked = true, bio = 'Hola' WHERE user_id = auth.uid() RETURNING blocked::text || '/' || bio$q$), 'false/Hola');
SELECT public.t_eq('1.3 el evaluador sigue bloqueando y desbloqueando', public.t_val(:'ev', format($q$UPDATE public.professional_profiles SET blocked = false, blocked_reason = NULL WHERE user_id = %L RETURNING blocked::text$q$, :'p2')), 'false');
UPDATE public.professional_profiles SET blocked = true, blocked_reason = 'Revisión del evaluador' WHERE user_id = :'p2';
SELECT public.t_eq('1.4 un perfil nuevo creado desde el navegador nace sin bloqueo', public.t_val(:'f1', $q$INSERT INTO public.professional_profiles(user_id, blocked, blocked_reason) VALUES (auth.uid(), true, 'x') RETURNING blocked::text || '/' || COALESCE(blocked_reason, '-')$q$), 'false/-');

-- Fechas
SELECT public.t_eq('2.1 con todo vigente queda «compliant»', public.t_val(:'p1', $q$INSERT INTO public.health_compliance(professional_id, vacuna_hepatitis_b_expires, vacuna_tetano_expires, examen_ocupacional_expires, curso_bioseguridad_expires, poliza_rc_expires, primeros_auxilios_expires, status, auto_blocked)
  VALUES (auth.uid(), current_date + 400, current_date + 400, current_date + 400, current_date + 400, current_date + 400, current_date + 400, 'expired', true) RETURNING status || '/' || auto_blocked$q$), 'compliant/false');
SELECT public.t_eq('2.2 quien escribe no fija el estado', public.t_val(:'p1', $q$UPDATE public.health_compliance SET status = 'compliant', poliza_rc_expires = current_date + 10 WHERE professional_id = auth.uid() RETURNING status$q$), 'expiring_soon');
SELECT public.t_val(:'p1', $q$UPDATE public.health_compliance SET poliza_rc_expires = current_date - 1 WHERE professional_id = auth.uid() RETURNING status || '/' || auto_blocked$q$) AS r \gset
SELECT public.t_eq('2.3 una fecha vencida oculta al profesional', :'r' || '/' || (SELECT blocked::text FROM public.professional_profiles WHERE user_id = :'p1'), 'expired/true/true');
SELECT public.t_eq('2.4 y deja de verse en el directorio público', public.t_anon(format('SELECT count(*)::text FROM public.professional_profiles WHERE user_id = %L', :'p1')), '0');
SELECT public.t_val(:'p1', $q$UPDATE public.health_compliance SET poliza_rc_expires = current_date + 400 WHERE professional_id = auth.uid() RETURNING status || '/' || auto_blocked$q$) AS r \gset
SELECT public.t_eq('2.5 renovar lo devuelve solo', :'r' || '/' || (SELECT blocked::text FROM public.professional_profiles WHERE user_id = :'p1'), 'compliant/false/false');
SELECT public.t_eq('2.6 vencido estando ya bloqueado por el evaluador: no se marca como SG-SST', public.t_val(:'p2', $q$INSERT INTO public.health_compliance(professional_id, poliza_rc_expires) VALUES (auth.uid(), current_date - 5) RETURNING status || '/' || auto_blocked$q$), 'expired/false');
SELECT public.t_val(:'p2', $q$UPDATE public.health_compliance SET poliza_rc_expires = current_date + 400 WHERE professional_id = auth.uid() RETURNING status$q$) AS r \gset
SELECT public.t_eq('2.7 y renovar no levanta el bloqueo del evaluador', :'r' || '/' || (SELECT blocked::text || '/' || blocked_reason FROM public.professional_profiles WHERE user_id = :'p2'), 'incomplete/true/Revisión del evaluador');
SELECT public.t_eq('2.8 no se cambia de dueño', public.t_val(:'p1', format($q$UPDATE public.health_compliance SET professional_id = %L WHERE professional_id = auth.uid() RETURNING professional_id::text$q$, :'f1')), :'p1');

-- Vencimiento con el paso de los días
UPDATE public.health_compliance SET poliza_rc_expires = current_date + 400, vacuna_tetano_expires = current_date + 400 WHERE professional_id = :'p1';
ALTER TABLE public.health_compliance DISABLE TRIGGER trg_sync_health_compliance;
UPDATE public.health_compliance SET poliza_rc_expires = current_date - 1 WHERE professional_id = :'p1';  -- «pasaron los días»
ALTER TABLE public.health_compliance ENABLE TRIGGER trg_sync_health_compliance;
SELECT public.refresh_health_compliance()::text AS r \gset
SELECT public.t_eq('3.1 el trabajo diario recalcula lo que venció y oculta al profesional', :'r' || '/' || (SELECT status FROM public.health_compliance WHERE professional_id = :'p1')
  || '/' || (SELECT blocked::text FROM public.professional_profiles WHERE user_id = :'p1'), '1/expired/true');
SELECT public.t_eq('3.2 una segunda corrida no toca nada', (SELECT public.refresh_health_compliance()::text), '0');
SELECT public.t_true('3.3 el trabajo diario está programado y solo lo corre el servidor', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hx-refresh-health-compliance')
  AND NOT has_function_privilege('authenticated', 'public.refresh_health_compliance()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.refresh_health_compliance()', 'EXECUTE'));

-- Lectura y privilegios
SELECT public.t_eq('4.1 cada profesional ve solo lo suyo; el personal todo; una familia nada', public.t_val(:'p1', 'SELECT count(*)::text FROM public.health_compliance') || '/' || public.t_val(:'sa', 'SELECT count(*)::text FROM public.health_compliance') || '/' || public.t_val(:'f1', 'SELECT count(*)::text FROM public.health_compliance'), '1/2/0');
SELECT public.t_true('4.2 una familia no crea un registro SG-SST', public.t_val(:'f2', $q$INSERT INTO public.health_compliance(professional_id) VALUES (auth.uid()) RETURNING 'OK'$q$) LIKE 'ERR[42501]%');
SELECT public.t_eq('4.3 el profesional no borra su registro para esconder un vencimiento', public.t_val(:'p1', $q$DELETE FROM public.health_compliance WHERE professional_id = auth.uid() RETURNING 'OK'$q$), 'ERR[42501] permission denied for table health_compliance');
SELECT public.t_true('4.4 anon sin privilegios', NOT has_table_privilege('anon', 'public.health_compliance', 'SELECT') AND NOT has_table_privilege('anon', 'public.health_compliance', 'INSERT'));
SELECT public.t_true('4.5 nadie llama las funciones internas', NOT has_function_privilege('authenticated', 'public.sync_health_compliance()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.guard_professional_block_fields()', 'EXECUTE'));
SELECT public.t_true('4.6 en Realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'health_compliance'));

SELECT (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'health_compliance') AS sig_pol,
       (SELECT relacl::text FROM pg_class WHERE oid = 'public.health_compliance'::regclass) AS sig_acl,
       (SELECT count(*) FROM cron.job)::text AS sig_cron,
       (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.professional_profiles'::regclass)::text AS sig_trg \gset
\i :MIG
SELECT public.t_eq('5.1 segunda pasada: mismas políticas, privilegios, trabajos y disparadores',
  (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'health_compliance') || (SELECT relacl::text FROM pg_class WHERE oid = 'public.health_compliance'::regclass)
  || (SELECT count(*) FROM cron.job)::text || (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.professional_profiles'::regclass)::text,
  :'sig_pol' || :'sig_acl' || :'sig_cron' || :'sig_trg');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
