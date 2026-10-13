-- Escenario — PQRS propias: cada cuenta ve sus solicitudes sin el triaje interno. Sobre la réplica de producción.
-- Variables: MIG (20261012200000_pqrs_my_tickets.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS


INSERT INTO public.pqrs_tickets(user_id, contact_email, contact_name, type, subject, description, status, due_at, ai_category, ai_priority, ai_summary, ai_reply_draft, safety_level, assigned_to, resolution, resolved_at, radicado)
VALUES (:'f1', 'f1@t.co', 'Ana', 'queja', 'Un servicio', 'Llegó tarde', 'resolved', now() + interval '10 days', 'servicio', 'high', 'Resumen interno', 'BORRADOR INTERNO', 'review', :'sa', 'Hablamos con el profesional.', now(), 'PQRS-T-0001'),
       (:'f1', 'f1@t.co', 'Ana', 'peticion', 'Otra cosa', 'Necesito un certificado', 'open', now() + interval '15 days', NULL, NULL, NULL, NULL, 'none', NULL, NULL, NULL, 'PQRS-T-0002'),
       (:'f2', 'f2@t.co', 'Carlos', 'sugerencia', 'Idea', 'Una mejora', 'open', now() + interval '15 days', NULL, NULL, NULL, NULL, 'none', NULL, NULL, NULL, 'PQRS-T-0003'),
       (NULL, 'anon@t.co', 'Visitante', 'peticion', 'Sin cuenta', 'Pregunta', 'open', now() + interval '15 days', NULL, NULL, NULL, NULL, 'none', NULL, NULL, NULL, 'PQRS-T-0004');

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('0.1 antes: la dueña lee su triaje interno (borrador con IA, prioridad, seguridad)', public.t_val(:'f1', $q$SELECT string_agg(ai_reply_draft || '/' || ai_priority || '/' || safety_level, ',' ORDER BY radicado) FROM public.pqrs_tickets WHERE ai_reply_draft IS NOT NULL$q$), 'BORRADOR INTERNO/high/review');
SELECT public.t_eq('0.2 antes: ve sus dos solicitudes y ninguna ajena', public.t_val(:'f1', 'SELECT count(*)::text FROM public.pqrs_tickets'), '2');
SELECT public.t_true('0.3 antes: anon tiene SELECT de tabla', has_table_privilege('anon', 'public.pqrs_tickets', 'SELECT'));
SELECT public.t_true('0.4 antes: no existe la función de PQRS propias', to_regprocedure('public.my_pqrs_tickets(integer)') IS NULL);

\i :MIG

-- ═══ DESPUÉS ══════════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('1.1 la dueña ya no lee la tabla (ni su triaje interno)', public.t_val(:'f1', 'SELECT count(*)::text FROM public.pqrs_tickets'), '0');
SELECT public.t_eq('1.2 la función le entrega sus dos solicitudes, la más reciente primero', public.t_val(:'f1', $q$SELECT string_agg(radicado || ':' || status, ',') FROM (SELECT * FROM public.my_pqrs_tickets() ORDER BY radicado) t$q$), 'PQRS-T-0001:resolved,PQRS-T-0002:open');
SELECT public.t_eq('1.3 con la respuesta final y los plazos', public.t_val(:'f1', $q$SELECT resolution || '/' || (due_at IS NOT NULL) || '/' || (resolved_at IS NOT NULL) FROM public.my_pqrs_tickets() WHERE radicado = 'PQRS-T-0001'$q$), 'Hablamos con el profesional./true/true');
SELECT public.t_eq('1.4 la función NO devuelve nada interno ni de contacto', (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'my\_pqrs\_tickets%' ESCAPE '\' AND parameter_mode = 'OUT'),
  'id,radicado,type,subject,status,created_at,due_at,first_response_at,resolved_at,resolution');
SELECT public.t_eq('1.5 cada cuenta ve solo lo suyo', public.t_val(:'f2', 'SELECT count(*)::text FROM public.my_pqrs_tickets()') || '/' || public.t_val(:'p1', 'SELECT count(*)::text FROM public.my_pqrs_tickets()'), '1/0');
SELECT public.t_eq('1.6 el personal sigue leyendo todo, con el triaje', public.t_val(:'sa', 'SELECT count(*)::text FROM public.pqrs_tickets') || '/' || public.t_val(:'sa', $q$SELECT ai_reply_draft FROM public.pqrs_tickets WHERE radicado = 'PQRS-T-0001'$q$), '4/BORRADOR INTERNO');
SELECT public.t_eq('1.7 también RR. HH. y evaluadores (sin cambios en esta migración)', public.t_val(:'hr', 'SELECT count(*)::text FROM public.pqrs_tickets') || '/' || public.t_val(:'ev', 'SELECT count(*)::text FROM public.pqrs_tickets'), '4/4');
SELECT public.t_eq('1.8 el personal sigue actualizando', public.t_val(:'sa', $q$UPDATE public.pqrs_tickets SET status = 'in_progress' WHERE radicado = 'PQRS-T-0003' RETURNING status$q$), 'in_progress');
SELECT public.t_true('1.9 sin sesión no se llama la función', public.t_anon('SELECT count(*)::text FROM public.my_pqrs_tickets()') LIKE 'ERR[42501]%');
SELECT public.t_eq('1.9b una sesión sin cuenta (rol authenticated sin sub) tampoco', public.t_val(NULL, 'SELECT count(*)::text FROM public.my_pqrs_tickets()'), 'ERR[28000] No autenticado');
SELECT public.t_true('1.10 anon ya no tiene ningún privilegio sobre la tabla', NOT has_table_privilege('anon', 'public.pqrs_tickets', 'SELECT') AND NOT has_table_privilege('anon', 'public.pqrs_tickets', 'INSERT') AND NOT has_table_privilege('anon', 'public.pqrs_tickets', 'UPDATE') AND NOT has_table_privilege('anon', 'public.pqrs_tickets', 'DELETE'));
SELECT public.t_true('1.11 la tabla conserva RLS y su política del personal', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pqrs_tickets'::regclass) AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pqrs_tickets' AND policyname = 'pqrs_staff_all') AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pqrs_tickets' AND policyname = 'pqrs_select_owner_or_staff'));
SELECT public.t_true('1.12 la dueña no inserta ni actualiza directo en la tabla', public.t_val(:'f1', $q$UPDATE public.pqrs_tickets SET status = 'closed' WHERE radicado = 'PQRS-T-0002' RETURNING 'OK'$q$) = 'NULL' AND public.t_val(:'f1', $q$INSERT INTO public.pqrs_tickets(user_id, contact_email, contact_name, type, subject, description) VALUES (auth.uid(), 'x@t.co', 'X', 'queja', 'x', 'y') RETURNING 'OK'$q$) LIKE 'ERR[42501]%');
SELECT public.t_true('1.13 la función solo la ejecuta quien tiene sesión', has_function_privilege('authenticated', 'public.my_pqrs_tickets(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.my_pqrs_tickets(integer)', 'EXECUTE'));
SELECT public.t_eq('1.14 el límite se respeta', public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_pqrs_tickets(1)'), '1');
INSERT INTO public.pqrs_tickets(user_id, contact_email, contact_name, type, subject, description, status, due_at, radicado)
  SELECT :'f1', 'f1@t.co', 'Ana', 'peticion', 'Masiva ' || i, 'x', 'open', now() + interval '15 days', 'PQRS-T-1' || lpad(i::text, 3, '0') FROM generate_series(1, 60) i;
SELECT public.t_eq('1.15 aunque pida 500, nunca se entregan más de 50', public.t_val(:'f1', 'SELECT count(*)::text FROM public.my_pqrs_tickets(500)'), '50');

SELECT md5(pg_get_functiondef('public.my_pqrs_tickets(integer)'::regprocedure) || COALESCE((SELECT proacl::text FROM pg_proc WHERE oid = 'public.my_pqrs_tickets(integer)'::regprocedure), '')) AS sig_fn,
       (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'pqrs_tickets') AS sig_pol,
       (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.pqrs_tickets'::regclass) AS sig_acl \gset
\i :MIG
SELECT public.t_eq('2.1 la segunda pasada no cambia la función', md5(pg_get_functiondef('public.my_pqrs_tickets(integer)'::regprocedure) || COALESCE((SELECT proacl::text FROM pg_proc WHERE oid = 'public.my_pqrs_tickets(integer)'::regprocedure), '')), :'sig_fn');
SELECT public.t_eq('2.2 ni las políticas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'pqrs_tickets'), :'sig_pol');
SELECT public.t_eq('2.3 ni los privilegios', (SELECT COALESCE(relacl::text, '') FROM pg_class WHERE oid = 'public.pqrs_tickets'::regclass), :'sig_acl');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
