\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- Escenario sobre la RÉPLICA de producción: formulario de validación de mercado (/validacion).
-- Comprueba el cierre del INSERT abierto, los permisos mínimos, la lectura solo del superadmin, las restricciones
-- de la tabla, el canje del mes del plan Esencial (único camino para activarlo) y la publicación en Realtime.

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
CREATE FUNCTION public.t_svc(q text) RETURNS text LANGUAGE sql AS $$ SELECT public.t_run(NULL, 'service_role', q) $$;
CREATE FUNCTION public.t_eq(name text, got text, want text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got IS NOT DISTINCT FROM want, name, 'got=[' || COALESCE(got,'NULL') || '] want=[' || COALESCE(want,'NULL') || ']') $$;
CREATE FUNCTION public.t_err(name text, got text, pat text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (got LIKE 'ERR%' AND got ILIKE '%' || pat || '%', name, 'got=[' || COALESCE(got,'NULL') || '] pat=[' || pat || ']') $$;
CREATE FUNCTION public.t_true(name text, cond boolean) RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._t(ok, name, detail) VALUES (COALESCE(cond, false), name, 'cond=' || COALESCE(cond::text, 'NULL')) $$;
CREATE FUNCTION public.q1(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE q INTO r; RETURN COALESCE(r, 'NULL'); END $$;

-- ═══ Datos base ═════════════════════════════════════════════════════════════════
\set sa   '00000000-0000-0000-0000-00000000005a'
\set hr   '00000000-0000-0000-0000-00000000005b'
\set fam  '00000000-0000-0000-0000-0000000000f1'
\set oth  '00000000-0000-0000-0000-0000000000f9'
\set pay  '00000000-0000-0000-0000-0000000000f5'
\set pend '00000000-0000-0000-0000-0000000000f6'
\set old  '00000000-0000-0000-0000-0000000000f7'
\set fam2 '00000000-0000-0000-0000-0000000000f2'

INSERT INTO auth.users(id, email) VALUES
  (:'sa','sa@t.co'),(:'hr','hr@t.co'),(:'fam','fam@t.co'),(:'oth','oth@t.co'),
  (:'pay','pay@t.co'),(:'pend','pend@t.co'),(:'old','old@t.co'),(:'fam2','fam2@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'sa','superadmin'),(:'hr','hr_staff'),(:'fam','family'),(:'oth','family'),
  (:'pay','family'),(:'pend','family'),(:'old','family'),(:'fam2','family');

-- Planes previos: uno de pago vigente, uno pendiente (checkout iniciado) y uno cancelado.
INSERT INTO public.mp_subscriptions(user_id, plan, amount, status, current_period_end, mp_preapproval_id) VALUES
  (:'pay',  'essential_monthly', 9000,  'active',    now() + interval '10 days', 'pre-123'),
  (:'pend', 'pro_monthly',       29000, 'pending',   NULL,                       'pre-456'),
  (:'old',  'essential_monthly', 9000,  'cancelled', now() - interval '5 days',  'pre-789');

-- Respuestas verificadas (con código) y una sin verificar, sembradas como lo haría el servidor.
INSERT INTO public.validation_responses
  (id, profile_type, full_name, email, contact_key, pays_currently, willingness_pct, contact_verified_at,
   promo_code, benefit_status, benefit_expires_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','familia','Marta Rojas Díaz','marta@t.co','marta@t.co','yes',60, now(),'MLP-AAAAA-BBBBB','available', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002','familia','Sin Verificar Aún','sv@t.co','sv@t.co','no',10, NULL,'MLP-CCCCC-DDDDD','none', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000003','ips_eps','Clínica Vencida','cv@t.co','cv@t.co','yes',80, now(),'MLP-EEEEE-FFFFF','available', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000004','familia','Segundo Código','sc@t.co','sc@t.co','no',20, now(),'MLP-GGGGG-HHHHH','available', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000005','profesional','Con Plan Pago','cp@t.co','cp@t.co','yes',40, now(),'MLP-JJJJJ-KKKKK','available', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000006','profesional','Con Pago Pendiente','pp@t.co','pp@t.co','not_researched',30, now(),'MLP-LLLLL-MMMMM','available', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000007','familia','Con Plan Cancelado','pc@t.co','pc@t.co','no',50, now(),'MLP-NNNNN-PPPPP','available', now() + interval '30 days');

-- ═══ 1) Permisos: el navegador no escribe ni lee a escondidas ═══════════════════
SELECT public.t_err('1.1 anónimo no inserta respuestas (antes podía enviar premium_activated=true)', public.t_anon($$INSERT INTO public.validation_responses(profile_type, premium_activated, promo_code) VALUES ('familia', true, 'MLP-FALSO-FALSO')$$), 'permission denied');
SELECT public.t_err('1.2 un usuario con sesión tampoco inserta directo', public.t_val(:'fam', $$INSERT INTO public.validation_responses(profile_type) VALUES ('familia')$$), 'permission denied');
SELECT public.t_err('1.3 anónimo no lee respuestas', public.t_anon('SELECT count(*)::text FROM public.validation_responses'), 'permission denied');
SELECT public.t_err('1.4 nadie edita respuestas desde el navegador', public.t_val(:'fam', $$UPDATE public.validation_responses SET premium_activated = true$$), 'permission denied');
SELECT public.t_err('1.5 nadie borra respuestas desde el navegador', public.t_val(:'sa', 'DELETE FROM public.validation_responses'), 'permission denied');
SELECT public.t_eq('1.6 una familia no ve respuestas ajenas (RLS)', public.t_val(:'fam', 'SELECT count(*)::text FROM public.validation_responses'), '0');
SELECT public.t_eq('1.7 RR. HH. (staff) no ve datos de contacto de leads', public.t_val(:'hr', 'SELECT count(*)::text FROM public.validation_responses'), '0');
SELECT public.t_eq('1.8 el superadmin ve todas las respuestas', public.t_val(:'sa', 'SELECT count(*)::text FROM public.validation_responses'), '7');
SELECT public.t_err('1.9 los códigos de verificación no se tocan desde el navegador', public.t_val(:'sa', 'SELECT count(*)::text FROM public.validation_otps'), 'permission denied');
SELECT public.t_err('1.10 anónimo no toca los códigos de verificación', public.t_anon($$INSERT INTO public.validation_otps(contact, channel, code_hash) VALUES ('a@b.co','email','x')$$), 'permission denied');
SELECT public.t_eq('1.11 solo existe la política de lectura del superadmin', public.q1($$SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'validation_responses'$$), 'validation_responses_superadmin_select:SELECT');
SELECT public.t_eq('1.12 validation_otps no tiene políticas para clientes', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'validation_otps'$$), '0');
SELECT public.t_true('1.13 anónimo sin ningún privilegio sobre las dos tablas', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['validation_responses','validation_otps']) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   WHERE has_table_privilege('anon', 'public.' || t, p)));
SELECT public.t_true('1.14 authenticated solo puede SELECT en respuestas y nada en códigos', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('authenticated', 'public.validation_responses', p))
  AND has_table_privilege('authenticated', 'public.validation_responses', 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege('authenticated', 'public.validation_otps', p)));
SELECT public.t_eq('1.15 el servidor (service role) escribe respuestas', public.t_svc($$WITH i AS (INSERT INTO public.validation_responses(profile_type, full_name) VALUES ('profesional','Prueba Servidor') RETURNING 1) SELECT 'OK' FROM i$$), 'OK');
SELECT public.t_eq('1.16 el servidor escribe códigos de verificación (solo huella)', public.t_svc($$WITH i AS (INSERT INTO public.validation_otps(contact, channel, code_hash) VALUES ('a@b.co','email','hash') RETURNING 1) SELECT 'OK' FROM i$$), 'OK');
SELECT public.t_eq('1.17 sin valor por defecto engañoso: ni 50 % ni código al insertar', public.q1($$SELECT COALESCE(willingness_pct::text,'nulo') || '|' || COALESCE(promo_code,'nulo') FROM public.validation_responses WHERE full_name = 'Prueba Servidor'$$), 'nulo|nulo');
DELETE FROM public.validation_otps WHERE contact = 'a@b.co';
DELETE FROM public.validation_responses WHERE full_name = 'Prueba Servidor';

-- ═══ 2) Restricciones de la tabla ═══════════════════════════════════════════════
SELECT public.t_err('2.1 perfil inválido', public.t_svc($$INSERT INTO public.validation_responses(profile_type) VALUES ('alienigena')$$), 'validation_responses_profile_chk');
SELECT public.t_err('2.2 disposición a pagar fuera de 0 a 100', public.t_svc($$INSERT INTO public.validation_responses(profile_type, willingness_pct) VALUES ('familia', 150)$$), 'validation_responses_wtp_chk');
SELECT public.t_err('2.3 respuesta de «¿pagas hoy?» inválida', public.t_svc($$INSERT INTO public.validation_responses(profile_type, pays_currently) VALUES ('familia', 'quizas')$$), 'validation_responses_pays_chk');
SELECT public.t_err('2.4 máximo 3 alternativas', public.t_svc($$INSERT INTO public.validation_responses(profile_type, alternatives) VALUES ('familia', ARRAY['a','b','c','d'])$$), 'validation_responses_alternatives_chk');
SELECT public.t_err('2.5 el beneficio solo puede ser el plan Esencial', public.t_svc($$INSERT INTO public.validation_responses(profile_type, benefit_plan) VALUES ('familia', 'pro_monthly')$$), 'validation_responses_benefit_plan_chk');
SELECT public.t_err('2.6 estado de beneficio inválido', public.t_svc($$INSERT INTO public.validation_responses(profile_type, benefit_status) VALUES ('familia', 'regalado')$$), 'validation_responses_benefit_chk');
SELECT public.t_err('2.7 texto desmesurado se rechaza', public.t_svc($$INSERT INTO public.validation_responses(profile_type, comments) VALUES ('familia', repeat('x', 3000))$$), 'validation_responses_len_chk');
SELECT public.t_err('2.8 un solo beneficio por contacto verificado', public.t_svc($$INSERT INTO public.validation_responses(profile_type, contact_key, promo_code) VALUES ('familia', 'marta@t.co', 'MLP-QQQQQ-RRRRR')$$), 'uq_validation_benefit_contact');
SELECT public.t_eq('2.9 varias respuestas del mismo contacto sin código sí se guardan (son datos de mercado)', public.t_svc($$WITH i AS (INSERT INTO public.validation_responses(profile_type, contact_key) VALUES ('familia', 'marta@t.co') RETURNING 1) SELECT 'OK' FROM i$$), 'OK');
SELECT public.t_err('2.10 código de beneficio repetido', public.t_svc($$INSERT INTO public.validation_responses(profile_type, promo_code) VALUES ('familia', 'MLP-AAAAA-BBBBB')$$), 'validation_responses_promo_code_key');
DELETE FROM public.validation_responses WHERE contact_key = 'marta@t.co' AND promo_code IS NULL;

-- ═══ 3) Canje del mes del plan Esencial ═════════════════════════════════════════
SELECT public.t_err('3.1 anónimo no canjea', public.t_anon($$SELECT public.redeem_validation_benefit(NULL, 'MLP-AAAAA-BBBBB')::text$$), 'permission denied');
SELECT public.t_err('3.2 un usuario con sesión no canjea directo (solo el servidor)', public.t_val(:'fam', format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-AAAAA-BBBBB')::text$q$, :'fam')), 'permission denied');
SELECT public.t_eq('3.3 sin usuario identificado no hay canje', public.t_svc($$SELECT public.redeem_validation_benefit(NULL, 'MLP-AAAAA-BBBBB') ->> 'error'$$), 'unauthenticated');
SELECT public.t_eq('3.4 formato de código inválido', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'hola') ->> 'error'$q$, :'fam')), 'invalid_code');
SELECT public.t_eq('3.5 código inexistente', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-ZZZZZ-ZZZZZ') ->> 'error'$q$, :'fam')), 'invalid_code');
SELECT public.t_eq('3.6 contacto sin verificar: no hay beneficio', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-CCCCC-DDDDD') ->> 'error'$q$, :'fam')), 'not_verified');
SELECT public.t_eq('3.7 código vencido', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-EEEEE-FFFFF') ->> 'error'$q$, :'fam')), 'expired');
SELECT public.t_eq('3.8 quien ya paga un plan no gasta su código', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-JJJJJ-KKKKK') ->> 'error'$q$, :'pay')), 'plan_active');
SELECT public.t_eq('3.9 …y el código sigue disponible', public.q1($$SELECT benefit_status FROM public.validation_responses WHERE promo_code = 'MLP-JJJJJ-KKKKK'$$), 'available');
SELECT public.t_eq('3.10 canje correcto (con minúsculas y espacios)', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, '  mlp-aaaaa-bbbbb ') ->> 'ok'$q$, :'fam')), 'true');
SELECT public.t_eq('3.11 queda un plan Esencial activo, gratis y por un mes', public.q1(format($q$SELECT plan || '|' || status || '|' || amount || '|' || (current_period_end > now() + interval '27 days' AND current_period_end < now() + interval '32 days')::text || '|' || COALESCE(mp_preapproval_id, 'sin-mp') FROM public.mp_subscriptions WHERE user_id = %L$q$, :'fam')), 'essential_monthly|active|0|true|sin-mp');
SELECT public.t_eq('3.12 el plan se lee como Esencial', public.q1(format('SELECT public.plan_key_for(%L)', :'fam')), 'essential_monthly');
SELECT public.t_eq('3.13 la respuesta queda marcada como canjeada', public.q1($$SELECT (redeemed_by IS NOT NULL)::text || '|' || premium_activated::text || '|' || benefit_status || '|' || (redeemed_at IS NOT NULL)::text FROM public.validation_responses WHERE promo_code = 'MLP-AAAAA-BBBBB'$$), 'true|true|redeemed|true');
SELECT public.t_eq('3.14 la persona recibe un aviso', public.q1(format($q$SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = 'benefit_redeemed'$q$, :'fam')), '1');
SELECT public.t_eq('3.15 el mismo código no se canjea dos veces (otra cuenta)', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-AAAAA-BBBBB') ->> 'error'$q$, :'oth')), 'already_redeemed');
SELECT public.t_eq('3.16 ni la misma cuenta', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-AAAAA-BBBBB') ->> 'error'$q$, :'fam')), 'already_redeemed');
SELECT public.t_eq('3.17 una cuenta solo recibe un beneficio', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-GGGGG-HHHHH') ->> 'error'$q$, :'fam')), 'user_already_rewarded');
SELECT public.t_eq('3.18 con un pago pendiente se activa el mes y se limpia la preaprobación', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-LLLLL-MMMMM') ->> 'ok'$q$, :'pend')), 'true');
SELECT public.t_eq('3.19 …la fila de suscripción quedó con el plan Esencial', public.q1(format($q$SELECT plan || '|' || status || '|' || COALESCE(mp_preapproval_id, 'sin-mp') FROM public.mp_subscriptions WHERE user_id = %L$q$, :'pend')), 'essential_monthly|active|sin-mp');
SELECT public.t_eq('3.20 con un plan cancelado y vencido también se activa', public.t_svc(format($q$SELECT public.redeem_validation_benefit(%L, 'MLP-NNNNN-PPPPP') ->> 'ok'$q$, :'old')), 'true');
SELECT public.t_eq('3.21 una sola fila de suscripción por persona', public.q1($$SELECT max(n)::text FROM (SELECT count(*) AS n FROM public.mp_subscriptions GROUP BY user_id) x$$), '1');
SELECT public.t_eq('3.22 el código vencido no se consumió', public.q1($$SELECT benefit_status || '|' || (redeemed_by IS NULL)::text FROM public.validation_responses WHERE promo_code = 'MLP-EEEEE-FFFFF'$$), 'available|true');
SELECT public.t_eq('3.23 quien ya paga conserva su plan intacto', public.q1(format($q$SELECT plan || '|' || amount || '|' || mp_preapproval_id FROM public.mp_subscriptions WHERE user_id = %L$q$, :'pay')), 'essential_monthly|9000|pre-123');
SELECT public.t_err('3.24 una cuenta no puede canjear dos respuestas aunque se fuerce por SQL', public.t_svc(format($q$UPDATE public.validation_responses SET redeemed_by = %L WHERE promo_code = 'MLP-GGGGG-HHHHH'$q$, :'fam')), 'uq_validation_benefit_user');

-- ═══ 4) Tabulación en vivo y migración repetible ═════════════════════════════════
SELECT public.t_true('4.1 la tabla está en la publicación de Realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'validation_responses'));
SELECT public.t_true('4.2 la función de canje es solo del servidor', has_function_privilege('service_role', 'public.redeem_validation_benefit(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.redeem_validation_benefit(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.redeem_validation_benefit(uuid, text)', 'EXECUTE'));
SELECT public.t_true('4.3 el código de verificación puede guardarse solo como huella', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'validation_otps' AND column_name = 'code' AND is_nullable = 'YES'));
SELECT public.t_err('4.4 pero un código sin texto ni huella se rechaza', public.t_svc($$INSERT INTO public.validation_otps(contact, channel) VALUES ('a@b.co','email')$$), 'validation_otps_code_present_chk');

-- Segunda pasada: la migración debe ser idempotente y no cambiar nada.
\set QUIET off
\i ../../migrations/20261011100000_market_validation_v2.sql
\set QUIET on
SELECT public.t_eq('4.5 la migración repetida no rompe el canje ni los datos', public.q1($$SELECT count(*)::text FROM public.validation_responses$$), '7');
SELECT public.t_eq('4.6 y sigue habiendo una sola política en respuestas', public.q1($$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'validation_responses'$$), '1');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
