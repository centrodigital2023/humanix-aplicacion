-- Escenario — referidos v2: un código por cuenta, solo auth.uid() se refiere a sí misma, nadie edita sus filas y nadie
-- lee quién se registró. Sobre la réplica de producción. Variables: MIG, OLD (diseño viejo), HELPERS.
\i :HELPERS
-- La réplica no trae la fecha de creación de las cuentas; producción sí.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\set n1 '00000000-0000-0000-0000-0000000000d1'
\set n2 '00000000-0000-0000-0000-0000000000d2'
\set n3 '00000000-0000-0000-0000-0000000000d3'
\set old1 '00000000-0000-0000-0000-0000000000e1'
\set paid '00000000-0000-0000-0000-0000000000e2'
INSERT INTO auth.users(id, email, created_at) VALUES
  (:'n1', 'n1@t.co', now()), (:'n2', 'n2@t.co', now()), (:'n3', 'n3@t.co', now()),
  (:'old1', 'old@t.co', now() - interval '30 days'), (:'paid', 'paid@t.co', now());
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'paid', 'pro_monthly', 'active', now() + interval '10 days');

-- ═══ ANTES: el diseño viejo (aplicado en una base nueva) y vacío ═══════════════════════════════════════════════════
\i :OLD
SELECT public.t_true('0.1 antes: el diseño viejo deja que una cuenta «refiera» a otra por id', to_regprocedure('public.apply_referral_code(text,uuid)') IS NOT NULL);

\i :MIG

-- ═══ DESPUÉS ══════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('1.1 el diseño viejo ya no existe', to_regprocedure('public.apply_referral_code(text,uuid)') IS NULL AND to_regprocedure('public.get_or_create_referral_code(uuid)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referrals' AND column_name = 'referred_email'));
SELECT public.t_val(:'p1', 'SELECT public.get_or_create_referral_code()') AS code_p1 \gset
SELECT public.t_true('1.2 cada cuenta recibe un código de 8 caracteres', :'code_p1' ~ '^[A-Z0-9]{8}$');
SELECT public.t_eq('1.3 pedirlo otra vez devuelve el mismo', public.t_val(:'p1', 'SELECT public.get_or_create_referral_code()'), :'code_p1');
SELECT public.t_true('1.4 cuentas distintas, códigos distintos', public.t_val(:'p2', 'SELECT public.get_or_create_referral_code()') <> :'code_p1');
SELECT public.t_eq('1.5 sin sesión no hay código', public.t_val(NULL, 'SELECT public.get_or_create_referral_code()'), 'ERR[28000] No autenticado');
SELECT public.t_true('1.6 anon no ejecuta ninguna de las tres funciones', public.t_anon('SELECT public.get_or_create_referral_code()') LIKE 'ERR[42501]%'
  AND public.t_anon($q$SELECT public.apply_referral_code('X')$q$) LIKE 'ERR[42501]%' AND public.t_anon('SELECT count(*)::text FROM public.my_referral_summary()') LIKE 'ERR[42501]%');

SELECT public.t_eq('2.1 un mismo código sirve para varias personas', public.t_val(:'n1', format('SELECT public.apply_referral_code(%L)', :'code_p1')) || '/' || public.t_val(:'n2', format('SELECT public.apply_referral_code(%L)', lower(' ' || :'code_p1' || ' '))), 'applied/applied');
SELECT public.t_eq('2.2 la misma persona no se refiere dos veces (ni con otro código)', public.t_val(:'n1', format('SELECT public.apply_referral_code(%L)', public.t_val(:'p2', 'SELECT public.get_or_create_referral_code()'))), 'already_referred');
SELECT public.t_eq('2.3 código inexistente', public.t_val(:'n3', $q$SELECT public.apply_referral_code('ZZZZZZZZ')$q$), 'invalid_code');
SELECT public.t_eq('2.4 el propio código no vale', public.t_val(:'p1', format('SELECT public.apply_referral_code(%L)', :'code_p1')), 'own_code');
SELECT public.t_eq('2.5 una cuenta de hace un mes no es nueva', public.t_val(:'old1', format('SELECT public.apply_referral_code(%L)', :'code_p1')), 'not_new');
SELECT public.t_eq('2.6 quien ya pagó un plan no es nuevo', public.t_val(:'paid', format('SELECT public.apply_referral_code(%L)', :'code_p1')), 'not_new');
UPDATE auth.users SET created_at = now() - interval '30 days' WHERE id = :'p1';
SELECT public.t_eq('2.7 una cuenta vieja no se vuelve referida', public.t_val(:'p1', format('SELECT public.apply_referral_code(%L)', public.t_val(:'n1', 'SELECT public.get_or_create_referral_code()'))), 'not_new');
UPDATE auth.users SET created_at = now() WHERE id = :'p1';
SELECT public.t_eq('2.7b y entre dos cuentas nuevas no se vale referirse en círculo', public.t_val(:'p1', format('SELECT public.apply_referral_code(%L)', public.t_val(:'n1', 'SELECT public.get_or_create_referral_code()'))), 'circular');
SELECT public.t_eq('2.8 sin sesión no se aplica', public.t_val(NULL, format('SELECT public.apply_referral_code(%L)', :'code_p1')), 'ERR[28000] No autenticado');
SELECT public.t_eq('2.9 quedaron dos referidos, de la cuenta correcta', (SELECT string_agg(referred_id::text || ':' || status, ',' ORDER BY referred_id) FROM public.referrals WHERE referrer_id = :'p1'), :'n1' || ':registered,' || :'n2' || ':registered');

SELECT public.t_eq('3.1 el resumen da el código y los conteos', public.t_val(:'p1', $q$SELECT code || '/' || registered || '/' || rewarded FROM public.my_referral_summary()$q$), :'code_p1' || '/2/0');
SELECT public.t_eq('3.2 el resumen no dice quién se registró', (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'my\_referral\_summary%' ESCAPE '\' AND parameter_mode = 'OUT'), 'code,registered,rewarded');
SELECT public.t_eq('3.3 quien refiere no lee la tabla (ni ids ni fechas)', public.t_val(:'p1', 'SELECT count(*)::text FROM public.referrals') || '/' || public.t_val(:'n1', 'SELECT count(*)::text FROM public.referrals') || '/' || public.t_val(:'p1', 'SELECT count(*)::text FROM public.referral_codes'), '0/0/0');
SELECT public.t_eq('3.4 el personal sí lee todo', public.t_val(:'sa', 'SELECT count(*)::text FROM public.referrals') || '/' || public.t_val(:'sa', 'SELECT count(*)::text FROM public.referral_codes'), '2/3');
SELECT public.t_true('3.5 nadie se marca recompensado ni se inserta a mano', public.t_val(:'p1', $q$UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() RETURNING 'OK'$q$) LIKE 'ERR[42501]%'
  AND public.t_val(:'n3', format($q$INSERT INTO public.referrals(referrer_id, referred_id, code) VALUES (%L, auth.uid(), 'X') RETURNING 'OK'$q$, :'p1')) LIKE 'ERR[42501]%'
  AND public.t_val(:'p1', $q$UPDATE public.referral_codes SET code = 'AAAAAAAA' RETURNING 'OK'$q$) LIKE 'ERR[42501]%'
  AND public.t_val(:'sa', $q$UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() RETURNING 'OK'$q$) LIKE 'ERR[42501]%');
SELECT public.t_true('3.6 anon no tiene ningún privilegio sobre las tablas', NOT has_table_privilege('anon', 'public.referrals', 'SELECT') AND NOT has_table_privilege('anon', 'public.referral_codes', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.referrals', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.referrals', 'UPDATE'));

-- El cobro (clave de servicio) reclama la fila como lo hace mpPayment.ts: solo una vez.
SELECT public.t_eq('4.1 el cobro reclama la recompensa una sola vez', public.t_run(NULL, 'service_role', format($q$WITH c AS (UPDATE public.referrals SET status = 'rewarded', rewarded_at = now(), reward_mp_payment_id = '9001' WHERE referred_id = %L AND status = 'registered' RETURNING referrer_id) SELECT count(*)::text FROM c$q$, :'n1')), '1');
SELECT public.t_eq('4.2 el segundo reclamo no encuentra nada', public.t_run(NULL, 'service_role', format($q$WITH c AS (UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() WHERE referred_id = %L AND status = 'registered' RETURNING 1) SELECT count(*)::text FROM c$q$, :'n1')), '0');
SELECT public.t_eq('4.3 el resumen lo cuenta', public.t_val(:'p1', $q$SELECT registered || '/' || rewarded FROM public.my_referral_summary()$q$), '1/1');
SELECT public.t_true('4.4 recompensado siempre lleva fecha', public.t_run(NULL, 'service_role', $q$UPDATE public.referrals SET status = 'rewarded' WHERE referred_id = '00000000-0000-0000-0000-0000000000d2' RETURNING 'OK'$q$) LIKE 'ERR[23514]%');

SELECT md5(string_agg(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) AS sig_fn FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_or_create_referral_code', 'apply_referral_code', 'my_referral_summary') \gset
SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) AS sig_pol FROM pg_policies WHERE tablename IN ('referrals', 'referral_codes') \gset
SELECT (SELECT relacl::text FROM pg_class WHERE oid = 'public.referrals'::regclass) || (SELECT relacl::text FROM pg_class WHERE oid = 'public.referral_codes'::regclass) AS sig_acl \gset
SELECT count(*)::text AS rows_before FROM public.referrals \gset
\i :MIG
SELECT public.t_eq('5.1 la segunda pasada no cambia las funciones', (SELECT md5(string_agg(pg_get_functiondef(p.oid) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_or_create_referral_code', 'apply_referral_code', 'my_referral_summary')), :'sig_fn');
SELECT public.t_eq('5.2 ni las políticas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename IN ('referrals', 'referral_codes')), :'sig_pol');
SELECT public.t_eq('5.3 ni los privilegios', (SELECT relacl::text FROM pg_class WHERE oid = 'public.referrals'::regclass) || (SELECT relacl::text FROM pg_class WHERE oid = 'public.referral_codes'::regclass), :'sig_acl');
SELECT public.t_eq('5.4 ni los datos', (SELECT count(*)::text FROM public.referrals), :'rows_before');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
