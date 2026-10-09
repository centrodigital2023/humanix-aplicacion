\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- Escenario sobre la RÉPLICA de producción: deriva entre el repositorio y la base real, chat y contacto, y mínimo
-- privilegio de las tablas nuevas (con los privilegios por defecto de Supabase, que conceden ALL a anon y authenticated).

CREATE TABLE public._t (n serial, ok boolean, name text, detail text);

CREATE FUNCTION public.t_run(u uuid, r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt INTO v_res; v_res := COALESCE(v_res, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_res;
END $$;
CREATE FUNCTION public.t_val(u uuid, q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(u, 'authenticated', q) $$;
CREATE FUNCTION public.t_anon(q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(NULL, 'anon', q) $$;
CREATE FUNCTION public.t_eq(name text, got text, want text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got IS NOT DISTINCT FROM want, name, 'got=[' || COALESCE(got,'NULL') || '] want=[' || COALESCE(want,'NULL') || ']') $$;
CREATE FUNCTION public.t_err(name text, got text, pat text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got LIKE 'ERR%' AND got ILIKE '%' || pat || '%', name, 'got=[' || COALESCE(got,'NULL') || '] pat=[' || pat || ']') $$;
CREATE FUNCTION public.t_true(name text, cond boolean) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (COALESCE(cond, false), name, 'cond=' || COALESCE(cond::text, 'NULL')) $$;
CREATE FUNCTION public.q1(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE q INTO r; RETURN COALESCE(r, 'NULL'); END $$;

-- ═══ Datos base ═════════════════════════════════════════════════════════════════
\set fam '00000000-0000-0000-0000-0000000000f1'
\set pro '00000000-0000-0000-0000-0000000000a1'
\set oth '00000000-0000-0000-0000-0000000000f9'
\set hr  '00000000-0000-0000-0000-00000000005b'
\set sa  '00000000-0000-0000-0000-00000000005a'

INSERT INTO auth.users(id, email) VALUES (:'fam','fam@t.co'),(:'pro','pro@t.co'),(:'oth','oth@t.co'),(:'hr','hr@t.co'),(:'sa','sa@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES (:'fam','family'),(:'pro','professional'),(:'oth','family'),(:'hr','hr_staff'),(:'sa','superadmin');
INSERT INTO public.profiles(user_id, full_name, phone, city, email) VALUES
  (:'fam','Marta Rojas Díaz','3001110001','Bogotá','fam@t.co'),(:'pro','Laura Gómez Pérez','3009990001','Bogotá','pro@t.co'),
  (:'oth','Otra Persona','3001110009','Bogotá','oth@t.co');
INSERT INTO public.professional_profiles(user_id, specialty, published, available) VALUES (:'pro','Auxiliar de enfermería', true, true);

INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'fam', :'pro', 'confirmed', now() + interval '1 hour', 4, 20000, 80000) RETURNING id AS bk \gset
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'fam', :'pro', 'pending', now() + interval '2 days', 4, 20000, 80000) RETURNING id AS bkp \gset

-- ═══ 1) Chat y contacto de la reserva (huecos que tenía producción) ════════════
SELECT public.t_err('1.1 sin sesión no se abre el chat', public.t_anon(format('SELECT public.get_or_create_booking_conversation(%L)::text', :'bk')), 'permission denied');
SELECT public.t_err('1.2 un tercero no abre el chat de otra reserva', public.t_val(:'oth', format('SELECT public.get_or_create_booking_conversation(%L)::text', :'bk')), 'not_authorized');
SELECT public.t_err('1.3 reserva pendiente: aún no hay chat', public.t_val(:'fam', format('SELECT public.get_or_create_booking_conversation(%L)::text', :'bkp')), 'booking_not_paid');
SELECT public.t_val(:'fam', format('SELECT public.get_or_create_booking_conversation(%L)::text', :'bk')) AS conv \gset
SELECT public.t_true('1.4 la familia abre el chat de su reserva', :'conv' ~ '^[0-9a-f-]{36}$');
SELECT public.t_eq('1.5 el profesional obtiene la misma conversación', public.t_val(:'pro', format('SELECT public.get_or_create_booking_conversation(%L)::text', :'bk')), :'conv');
SELECT public.t_eq('1.6 solo una conversación por reserva', public.q1(format('SELECT count(*)::text FROM public.conversations WHERE booking_id = %L', :'bk')), '1');
SELECT public.t_eq('1.7 la familia envía un mensaje (antes fallaba por «updated_at»)', public.t_val(:'fam', format($q$WITH i AS (INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (%L, %L, 'Hola, ¿cómo va todo?') RETURNING 1) SELECT 'OK' FROM i$q$, :'conv', :'fam')), 'OK');
SELECT public.t_eq('1.8 el profesional responde', public.t_val(:'pro', format($q$WITH i AS (INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (%L, %L, 'Todo bien, ya llegué') RETURNING 1) SELECT 'OK' FROM i$q$, :'conv', :'pro')), 'OK');
SELECT public.t_eq('1.9 la conversación registra el último mensaje', public.q1(format('SELECT (last_message_at > created_at - interval ''1 second'' AND updated_at IS NOT NULL)::text FROM public.conversations WHERE id = %L', :'conv')), 'true');
SELECT public.t_err('1.10 un tercero no escribe en la conversación', public.t_val(:'oth', format($q$WITH i AS (INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (%L, %L, 'intruso') RETURNING 1) SELECT 'OK' FROM i$q$, :'conv', :'oth')), 'row-level security');
SELECT public.t_eq('1.11 un tercero no lee los mensajes', public.t_val(:'oth', format('SELECT count(*)::text FROM public.messages WHERE conversation_id = %L', :'conv')), '0');
SELECT public.t_eq('1.12 los dos participantes leen los 2 mensajes', public.t_val(:'fam', format('SELECT count(*)::text FROM public.messages WHERE conversation_id = %L', :'conv')), '2');

SELECT public.t_eq('1.13 contacto: la familia obtiene el teléfono del profesional', public.t_val(:'fam', format('SELECT phone FROM public.get_booking_contact(%L)', :'bk')), '3009990001');
SELECT public.t_err('1.14 contacto: un tercero no lo obtiene', public.t_val(:'oth', format('SELECT phone FROM public.get_booking_contact(%L)', :'bk')), 'not_authorized');
SELECT public.t_err('1.15 contacto: sin sesión no hay acceso', public.t_anon(format('SELECT phone FROM public.get_booking_contact(%L)', :'bk')), 'permission denied');
SELECT public.t_eq('1.16 la familia ve el rastro de su consulta, y solo el suyo', public.t_val(:'fam', format('SELECT count(*)::text FROM public.booking_contact_reveals WHERE booking_id = %L', :'bk')), '1');
SELECT public.t_eq('1.17 el tercero no ve ese rastro', public.t_val(:'oth', format('SELECT count(*)::text FROM public.booking_contact_reveals WHERE booking_id = %L', :'bk')), '0');
SELECT public.t_err('1.18 nadie escribe el rastro a mano', public.t_val(:'fam', format($q$INSERT INTO public.booking_contact_reveals(booking_id, revealer_id) VALUES (%L, %L)$q$, :'bk', :'fam')), 'permission denied');

-- ═══ 2) Lectura del parte: solo las partes y superadmin (HR y evaluadores no) ═══
INSERT INTO public.care_logs(booking_id, professional_id, event_type, description) VALUES (:'bk', :'pro', 'note', 'Nota de prueba');
SELECT public.t_eq('2.1 el profesional lee su parte', public.t_val(:'pro', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk')), '1');
SELECT public.t_eq('2.2 la familia lee el parte de su reserva', public.t_val(:'fam', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk')), '1');
SELECT public.t_eq('2.3 HR no lee datos de salud', public.t_val(:'hr', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk')), '0');
SELECT public.t_eq('2.4 el superadmin sí', public.t_val(:'sa', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk')), '1');
SELECT public.t_eq('2.5 un tercero no', public.t_val(:'oth', format('SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L', :'bk')), '0');
SELECT public.t_err('2.6 sin sesión no hay acceso al parte', public.t_anon(format('SELECT count(*) FROM public.care_logs WHERE booking_id = %L', :'bk')), 'permission denied');
SELECT public.t_eq('2.7 una sola política de lectura general más la del círculo', public.q1($$SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'care_logs'$$), 'care_logs_circle_read,care_logs_professional_insert,care_logs_read');

-- ═══ 3) Mínimo privilegio: ninguna tabla nueva queda abierta por los privilegios por defecto ═══
SELECT public.t_eq('3.1 anon no tiene ningún privilegio sobre las tablas nuevas', public.q1($$
  SELECT coalesce(string_agg(t || ':' || p, ', '), 'ninguno') FROM (
    SELECT t, p FROM unnest(ARRAY['pqrs_ticket_events','pqrs_intake_attempts','opportunity_contact_reveals','opportunity_alerts','opportunity_alert_log','job_offer_private','job_offer_shifts','application_events','smart_contracts','smart_contract_shifts','smart_contract_signatures','smart_contract_events','offer_team_invites','booking_contact_reveals','care_kudos','care_logs']) t,
         unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE to_regclass('public.' || t) IS NOT NULL AND has_table_privilege('anon', 'public.' || t, p)) x$$), 'ninguno');
SELECT public.t_eq('3.2 authenticated solo tiene los privilegios previstos', public.q1($$
  WITH want(t, p) AS (VALUES
    ('pqrs_ticket_events','SELECT'),('opportunity_contact_reveals','SELECT'),
    ('opportunity_alerts','SELECT'),('opportunity_alerts','INSERT'),('opportunity_alerts','UPDATE'),('opportunity_alerts','DELETE'),
    ('job_offer_private','SELECT'),('job_offer_private','INSERT'),('job_offer_private','UPDATE'),
    ('job_offer_shifts','SELECT'),('job_offer_shifts','INSERT'),('job_offer_shifts','UPDATE'),('job_offer_shifts','DELETE'),
    ('application_events','SELECT'),('smart_contracts','SELECT'),('smart_contract_shifts','SELECT'),('smart_contract_signatures','SELECT'),
    ('smart_contract_events','SELECT'),('offer_team_invites','SELECT'),('booking_contact_reveals','SELECT'),('care_kudos','SELECT'),
    ('care_logs','SELECT'),('care_logs','INSERT'))
  SELECT coalesce(string_agg(t || ':' || p, ', '), 'ninguno') FROM (
    SELECT t, p FROM unnest(ARRAY['pqrs_ticket_events','pqrs_intake_attempts','opportunity_contact_reveals','opportunity_alerts','opportunity_alert_log','job_offer_private','job_offer_shifts','application_events','smart_contracts','smart_contract_shifts','smart_contract_signatures','smart_contract_events','offer_team_invites','booking_contact_reveals','care_kudos','care_logs']) t,
         unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE to_regclass('public.' || t) IS NOT NULL AND has_table_privilege('authenticated', 'public.' || t, p)
      AND NOT EXISTS (SELECT 1 FROM want w WHERE w.t = t AND w.p = p)) x$$), 'ninguno');
SELECT public.t_eq('3.3 las tablas internas no se leen desde la API', public.q1($$
  SELECT coalesce(string_agg(t, ', '), 'ninguna') FROM unnest(ARRAY['pqrs_intake_attempts','opportunity_alert_log']) t
   WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT')$$), 'ninguna');
SELECT public.t_eq('3.4 ninguna función nueva es ejecutable por anon salvo las públicas previstas', public.q1($$
  SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), 'ninguna') FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('has_role','is_staff','log_audit','update_updated_at_column','city_key','professional_kudos_summary','professional_public_stats',
                           'assign_free_subscription','bump_conversation_last_message','compute_platform_fee','create_conversation_on_accept','guard_professional_publish',
                           'guard_professional_trust_fields','notify_circle_invitation','refresh_pro_avg_rating','validate_rating_dimensions','match_professionals_for_offer',
                           'guard_booking_integrity','guard_service_bookings_financials','notify_booking_cancelled',
                           -- funciones que ya existían en producción (en la réplica nacen con los privilegios por defecto)
                           'find_replacement_candidates','platform_commission_pct','professional_dimension_averages','respond_circle_invitation','accept_slot_proposal',
                           't_run','t_val','t_anon','t_eq','t_err','t_true','q1')$$), 'ninguna');
SELECT public.t_eq('3.5 las funciones de disparador nuevas no las ejecuta authenticated', public.q1($$
  SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), 'ninguna') FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.proname IN ('pqrs_before_insert','pqrs_before_update','care_logs_guard','care_logs_after_insert','booking_care_events','plan_b_after_cancel','applications_guard_insert','applications_guard_update',
                       'applications_after_change','job_offers_capture_private','job_offer_shifts_guard','smart_contracts_guard','smart_contract_events_chain','smart_contract_immutable','bookings_sync_offer_and_contract')$$), 'ninguna');

-- ═══ 4) Políticas que el repositorio quería eliminar pero tenían otro nombre en producción ═══
SELECT public.t_eq('4.1 los profesionales ya no leen la tabla de necesidades de las familias', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'family_needs' AND policyname IN ('fn_select_open_for_pros','family_needs_select_public_open','family_needs_select_authenticated')$$), '0');
SELECT public.t_eq('4.2 pqrs_tickets: nadie inserta directo (solo el servidor)', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pqrs_tickets' AND cmd = 'INSERT'$$), '0');
SELECT public.t_true('4.3 la oferta guarda dirección y teléfono aparte', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_job_offers_capture_private' AND NOT tgisinternal));
SELECT public.t_eq('4.4 un profesional no lee las necesidades de la familia por la tabla', public.t_val(:'pro', 'SELECT count(*)::text FROM public.family_needs'), '0');

-- ═══ 5) Los disparadores heredados de producción conviven con los nuevos ═══════
SELECT public.t_eq('5.1 la reserva transita con el guardián de producción y deja la llegada', public.t_val(:'pro', format($q$WITH u AS (UPDATE public.service_bookings SET status = 'in_progress', arrived_at = now() WHERE id = %L RETURNING 1) SELECT 'OK' FROM u$q$, :'bk')), 'OK');
SELECT public.t_eq('5.2 llegada registrada por el sistema', public.q1(format($q$SELECT count(*)::text FROM public.care_logs WHERE booking_id = %L AND event_type = 'arrival' AND system_generated$q$, :'bk')), '1');
SELECT public.t_eq('5.3 la familia fue avisada', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = 'care_started'$q$, :'fam')), '1');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
