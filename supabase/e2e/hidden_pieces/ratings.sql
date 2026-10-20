-- Escenario — calificaciones: quién califica, respuestas, reportes y moderación. Variables: MIG, HELPERS, STUBS.
\i :HELPERS
\i :STUBS
SELECT public.t_val(:'sa', format($q$UPDATE public.service_bookings SET status = 'completed' WHERE id = %L RETURNING status$q$, :'b1')) AS r \gset
SELECT public.t_true('0.1 antes: cualquiera califica a cualquiera con un servicio inventado', public.t_val(:'f2', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (gen_random_uuid(), auth.uid(), %L, 1) RETURNING 'OK'$q$, :'p1')) = 'OK');
DELETE FROM public.service_ratings;

\i :MIG

-- 1. Quién califica
SELECT public.t_eq('1.1 la familia califica a su profesional en un servicio completado', public.t_val(:'f1', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars, comment, status, response_text) VALUES (%L, auth.uid(), %L, 2, 'llegó tarde', 'flagged', 'auto') RETURNING status || '/' || coalesce(response_text, '-')$q$, :'b1', :'p1')), 'published/-');
SELECT public.t_eq('1.2 y el profesional a la familia', public.t_val(:'p1', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (%L, auth.uid(), %L, 5) RETURNING 'OK'$q$, :'b1', :'f1')), 'OK');
SELECT public.t_err('1.3 un servicio inventado ya no sirve', public.t_val(:'f2', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (gen_random_uuid(), auth.uid(), %L, 1) RETURNING 'OK'$q$, :'p1')), 'row-level security');
SELECT public.t_err('1.4 ni el servicio de otra familia', public.t_val(:'f2', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (%L, auth.uid(), %L, 1) RETURNING 'OK'$q$, :'b1', :'p1')), 'row-level security');
SELECT public.t_err('1.5 ni uno sin completar', public.t_val(:'f2', format($q$INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (%L, auth.uid(), %L, 1) RETURNING 'OK'$q$, :'b2', :'p2')), 'row-level security');
SELECT id AS r1 FROM public.service_ratings WHERE rater_id = :'f1' \gset
SELECT id AS r2 FROM public.service_ratings WHERE rater_id = :'p1' \gset

-- 2. Editar
SELECT public.t_eq('2.1 el autor corrige estrellas y comentario, pero no mueve la reseña ni se responde', public.t_val(:'f1', format($q$UPDATE public.service_ratings SET stars = 3, comment = 'llegó tarde, buen trato', rated_id = %L, booking_id = gen_random_uuid(), response_text = 'x', status = 'flagged' WHERE id = %L RETURNING stars || '/' || (rated_id = %L) || '/' || (booking_id = %L) || '/' || coalesce(response_text, '-') || '/' || status$q$, :'p2', :'r1', :'p1', :'b1')), '3/true/true/-/published');

-- 3. Responder
SELECT public.t_err('3.1 el autor no se responde a sí mismo', public.t_val(:'f1', format($q$SELECT public.respond_to_rating(%L, 'hola')::text$q$, :'r1')), 'No autorizado');
SELECT public.t_err('3.2 un tercero tampoco', public.t_val(:'p2', format($q$SELECT public.respond_to_rating(%L, 'hola')::text$q$, :'r1')), 'No autorizado');
SELECT public.t_err('3.3 respuesta vacía o enorme no', public.t_val(:'p1', format($q$SELECT public.respond_to_rating(%L, '   ')::text$q$, :'r1')), 'entre 1 y 300');
SELECT public.t_val(:'p1', format($q$SELECT public.respond_to_rating(%L, '  Gracias, mejoraré la puntualidad  ')::text$q$, :'r1')) AS r \gset
SELECT public.t_eq('3.4 el calificado responde una vez', :'r' || '/' || (SELECT response_text FROM public.service_ratings WHERE id = :'r1'), '/Gracias, mejoraré la puntualidad');
SELECT public.t_err('3.5 y no dos', public.t_val(:'p1', format($q$SELECT public.respond_to_rating(%L, 'otra')::text$q$, :'r1')), 'ya tiene respuesta');
SELECT public.t_eq('3.6 el autor no borra la respuesta editando', public.t_val(:'f1', format($q$UPDATE public.service_ratings SET response_text = NULL WHERE id = %L RETURNING response_text$q$, :'r1')), 'Gracias, mejoraré la puntualidad');

-- 4. Reportar y moderar
SELECT public.t_err('4.1 solo el calificado reporta', public.t_val(:'f2', format($q$SELECT public.flag_rating(%L, 'falsa')::text$q$, :'r1')), 'No autorizado');
SELECT public.t_val(:'p1', format($q$SELECT public.flag_rating(%L, 'No refleja el servicio')::text$q$, :'r1')) AS r \gset
SELECT public.t_eq('4.2 el reporte queda en cola sin ocultar la reseña al autor ni al promedio', (SELECT status || '/' || flagged_by::text FROM public.service_ratings WHERE id = :'r1') || '/' || public.t_val(:'f1', 'SELECT count(*)::text FROM public.service_ratings'), 'flagged/' || :'p1' || '/2');
SELECT public.t_err('4.3 el calificado no modera', public.t_val(:'p1', format($q$SELECT public.moderate_rating(%L, false)::text$q$, :'r1')), 'Solo el personal');
SELECT public.t_val(:'sa', format($q$SELECT public.moderate_rating(%L, true, 'Opinión legítima')::text$q$, :'r1')) AS r \gset
SELECT public.t_eq('4.4 el personal la mantiene', (SELECT status || '/' || (moderated_by = :'sa') FROM public.service_ratings WHERE id = :'r1'), 'published/true');
SELECT public.t_val(:'p1', format($q$SELECT public.flag_rating(%L, 'otra vez')::text$q$, :'r1')) AS r \gset
SELECT public.t_eq('4.5 una reseña ya revisada no se vuelve a reportar', (SELECT status FROM public.service_ratings WHERE id = :'r1'), 'published');
SELECT public.t_val(:'f1', format($q$SELECT public.flag_rating(%L, 'ofensiva')::text$q$, :'r2')) AS r \gset
SELECT public.t_val(:'sa', format($q$SELECT public.moderate_rating(%L, false, 'Ofensiva')::text$q$, :'r2')) AS r \gset
SELECT public.t_eq('4.6 retirarla la borra y deja rastro', :'r' || '/' || (SELECT count(*) FROM public.service_ratings WHERE id = :'r2')::text || '/' || (SELECT action || ':' || (meta ->> 'stars') FROM public.audit_log WHERE resource_id = :'r2'), '/0/rating_removed:5');
SELECT public.t_eq('4.7 nadie fija la moderación editando', public.t_val(:'f1', format($q$UPDATE public.service_ratings SET moderated_at = NULL, moderated_by = NULL WHERE id = %L RETURNING (moderated_by = '00000000-0000-0000-0000-00000000005a')::text$q$, :'r1')), 'true');
SELECT public.t_err('4.8 anon no llama a las funciones', public.t_anon(format($q$SELECT public.flag_rating(%L)::text$q$, :'r1')), 'permission denied');

SELECT (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'service_ratings')
  || (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.service_ratings'::regclass)::text AS sig \gset
\i :MIG
SELECT public.t_eq('5.1 segunda pasada: mismas políticas y restricciones', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'service_ratings')
  || (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.service_ratings'::regclass)::text, :'sig');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
