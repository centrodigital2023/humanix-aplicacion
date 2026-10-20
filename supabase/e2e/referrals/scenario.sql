-- Escenario — Referidos: código propio, uso del código siempre con auth.uid(), filas de solo lectura para clientes y recompensa con
-- mp_subscriptions. Sobre la réplica de producción, donde referrals todavía no existe.
-- Variables: MIG (20261020150000_referrals_security.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

-- auth.users de Supabase tiene created_at; la réplica solo guarda lo que usaban las migraciones anteriores.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Ejecuta como superusuario (sin sesión) una sentencia y devuelve el error si lo hay (para probar restricciones).
CREATE FUNCTION public.t_sys(stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    EXECUTE stmt; v_res := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM;
  END;
  RETURN v_res;
END $$;

\set a '00000000-0000-0000-0000-0000000001a1'
\set b '00000000-0000-0000-0000-0000000001b1'
\set c '00000000-0000-0000-0000-0000000001c1'
\set d '00000000-0000-0000-0000-0000000001d1'
\set e '00000000-0000-0000-0000-0000000001e1'
\set f '00000000-0000-0000-0000-0000000001f1'
\set g '00000000-0000-0000-0000-0000000001a2'
\set sa '00000000-0000-0000-0000-0000000001a3'

-- a: refiere, con Plan Pro vigente · b, d: cuentas nuevas · c: cuenta de hace 60 días · e: refiere, sin plan
-- f: cuenta nueva que ya pagó · g: cuenta nueva · sa: superadmin
INSERT INTO auth.users(id, email, created_at) VALUES
  (:'a','a@t.co', now() - interval '90 days'), (:'b','b@t.co', now()), (:'c','c@t.co', now() - interval '60 days'),
  (:'d','d@t.co', now()), (:'e','e@t.co', now() - interval '5 days'), (:'f','f@t.co', now()), (:'g','g@t.co', now()),
  (:'sa','sa@t.co', now() - interval '200 days');
INSERT INTO public.user_roles(user_id, role) VALUES (:'sa','superadmin');
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES
  (:'a','pro_monthly','active', now() + interval '10 days'),
  (:'f','essential_monthly','active', now() + interval '20 days');

-- ═══ 0) Antes de la migración ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('0.1 antes: referrals no existe en producción', to_regclass('public.referrals') IS NULL);

\i :MIG
\i :MIG
SELECT public.t_true('0.2 la migración es idempotente (se aplicó dos veces)', to_regclass('public.referral_codes') IS NOT NULL);

-- ═══ 1) Código propio ═══════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_err('1.1 nadie obtiene el código de otra persona',
  public.t_val(:'a', format('SELECT public.get_or_create_referral_code(%L)', :'b')), 'forbidden');
SELECT public.t_err('1.2 sin sesión no hay código',
  public.t_anon(format('SELECT public.get_or_create_referral_code(%L)', :'a')), 'permission denied');
SELECT public.t_val(:'a', format('SELECT public.get_or_create_referral_code(%L)', :'a')) AS code_a \gset
SELECT public.t_true('1.3 el código tiene la forma esperada', :'code_a' ~ '^[A-Z0-9]{6,12}$');
SELECT public.t_eq('1.4 pedirlo otra vez devuelve el mismo código',
  public.t_val(:'a', format('SELECT public.get_or_create_referral_code(%L)', :'a')), :'code_a');
SELECT public.t_eq('1.5 cada quien ve solo su código',
  public.t_val(:'b', 'SELECT count(*)::text FROM public.referral_codes'), '0');
SELECT public.t_err('1.6 nadie escribe códigos desde el navegador',
  public.t_val(:'b', format('INSERT INTO public.referral_codes(user_id, code) VALUES (%L, ''MIO12345'') RETURNING code', :'b')), 'permission denied');

-- ═══ 2) Usar un código: siempre para auth.uid() ═════════════════════════════════════════════════════════════════
SELECT public.t_true('2.1 ya no existe la versión que recibía el id de otra persona',
  to_regprocedure('public.apply_referral_code(text, uuid)') IS NULL);
SELECT public.t_eq('2.2 no se puede usar el propio código',
  public.t_val(:'a', format('SELECT public.apply_referral_code(%L)', :'code_a')), 'self_referral');
SELECT public.t_eq('2.3 una cuenta nueva usa el código (sin importar mayúsculas ni espacios)',
  public.t_val(:'b', format('SELECT public.apply_referral_code(%L)', ' ' || lower(:'code_a') || ' ')), 'applied');
SELECT public.t_eq('2.4 y solo una vez',
  public.t_val(:'b', format('SELECT public.apply_referral_code(%L)', :'code_a')), 'already_referred');
SELECT public.t_eq('2.5 el mismo enlace sirve para otra persona',
  public.t_val(:'d', format('SELECT public.apply_referral_code(%L)', :'code_a')), 'applied');
SELECT public.t_eq('2.6 una cuenta de hace más de 30 días no es elegible',
  public.t_val(:'c', format('SELECT public.apply_referral_code(%L)', :'code_a')), 'not_eligible');
SELECT public.t_eq('2.7 quien ya tiene plan de pago no es elegible',
  public.t_val(:'f', format('SELECT public.apply_referral_code(%L)', :'code_a')), 'not_eligible');
SELECT public.t_eq('2.8 un código inexistente',
  public.t_val(:'g', 'SELECT public.apply_referral_code(''ZZZZ9999'')'), 'invalid_code');
SELECT public.t_eq('2.9 un código mal formado',
  public.t_val(:'g', 'SELECT public.apply_referral_code(''x''''; drop table x; --'')'), 'invalid_code');
SELECT public.t_err('2.10 sin sesión no se usa un código',
  public.t_anon(format('SELECT public.apply_referral_code(%L)', :'code_a')), 'permission denied');
SELECT public.t_eq('2.11 la fila guarda a quien refiere y a quien usó el código',
  public.q1(format('SELECT referrer_id::text || ''|'' || status FROM public.referrals WHERE referred_id = %L', :'b')), :'a' || '|registered');
-- e refiere a g; luego g no puede «devolver» el referido a e.
SELECT public.t_val(:'e', format('SELECT public.get_or_create_referral_code(%L)', :'e')) AS code_e \gset
SELECT public.t_val(:'g', format('SELECT public.get_or_create_referral_code(%L)', :'g')) AS code_g \gset
SELECT public.t_eq('2.12 g usa el código de e',
  public.t_val(:'g', format('SELECT public.apply_referral_code(%L)', :'code_e')), 'applied');
SELECT public.t_eq('2.13 e no puede usar el código de quien refirió',
  public.t_val(:'e', format('SELECT public.apply_referral_code(%L)', :'code_g')), 'not_eligible');

-- ═══ 3) Filas de solo lectura ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('3.1 quien refiere ve sus referidos',
  public.t_val(:'a', 'SELECT count(*)::text FROM public.referrals'), '2');
SELECT public.t_eq('3.2 la persona referida ve solo su fila',
  public.t_val(:'b', 'SELECT count(*)::text FROM public.referrals'), '1');
SELECT public.t_eq('3.3 otra persona no ve nada',
  public.t_val(:'c', 'SELECT count(*)::text FROM public.referrals'), '0');
SELECT public.t_eq('3.4 el personal ve todo',
  public.t_val(:'sa', 'SELECT count(*)::text FROM public.referrals'), '3');
SELECT public.t_err('3.5 quien refiere no ve el correo de la persona referida',
  public.t_val(:'a', 'SELECT string_agg(referred_email, '','') FROM public.referrals'), 'permission denied');
SELECT public.t_err('3.6 quien refiere no puede marcarse la recompensa',
  public.t_val(:'a', 'UPDATE public.referrals SET status = ''rewarded'' RETURNING status'), 'permission denied');
SELECT public.t_err('3.7 nadie inserta referidos a mano',
  public.t_val(:'a', format('INSERT INTO public.referrals(referrer_id, referred_id, status) VALUES (%L, %L, ''rewarded'') RETURNING id', :'a', :'c')), 'permission denied');
SELECT public.t_err('3.8 ni los borra',
  public.t_val(:'a', 'DELETE FROM public.referrals RETURNING id'), 'permission denied');
SELECT public.t_err('3.9 anon no lee referidos',
  public.t_anon('SELECT count(*)::text FROM public.referrals'), 'permission denied');
SELECT public.t_true('3.10 no quedan políticas de escritura en referrals',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'referrals' AND cmd <> 'SELECT'));
SELECT public.t_err('3.11 una persona no se refiere a sí misma ni con el servidor',
  public.t_sys(format('INSERT INTO public.referrals(referrer_id, referred_id) VALUES (%L, %L)', :'c', :'c')), 'referrals_not_self');

-- ═══ 4) Recompensa: solo el servidor, con mp_subscriptions ══════════════════════════════════════════════════════
SELECT public.t_err('4.1 un usuario no puede darse la recompensa',
  public.t_val(:'a', format('SELECT public.grant_referral_reward(%L)', :'b')), 'permission denied');
SELECT public.t_err('4.2 anon tampoco',
  public.t_anon(format('SELECT public.grant_referral_reward(%L)', :'b')), 'permission denied');
SELECT public.t_eq('4.3 sin pago del referido no hay recompensa',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'b')), 'not_subscribed');
-- Un plan pendiente o vencido no cuenta como pago.
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'b','essential_monthly','pending', NULL);
SELECT public.t_eq('4.4 un plan pendiente no cuenta',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'b')), 'not_subscribed');
UPDATE public.mp_subscriptions SET status = 'active', current_period_end = now() + interval '30 days' WHERE user_id = :'b';
SELECT public.q1(format('SELECT current_period_end::text FROM public.mp_subscriptions WHERE user_id = %L', :'a')) AS end_a \gset
SELECT public.t_eq('4.5 el referido pagó: recompensa',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'b')), 'rewarded');
SELECT public.t_eq('4.6 a quien refiere con plan vigente se le suma 1 mes desde su vencimiento',
  public.q1(format('SELECT (current_period_end = %L::timestamptz + interval ''1 month'')::text FROM public.mp_subscriptions WHERE user_id = %L', :'end_a', :'a')), 'true');
SELECT public.t_eq('4.7 conserva su plan',
  public.q1(format('SELECT plan FROM public.mp_subscriptions WHERE user_id = %L', :'a')), 'pro_monthly');
SELECT public.t_eq('4.8 la fila queda recompensada',
  public.q1(format('SELECT status || ''|'' || (reward_applied_at IS NOT NULL)::text FROM public.referrals WHERE referred_id = %L', :'b')), 'rewarded|true');
SELECT public.t_eq('4.9 aviso a quien refiere',
  public.q1(format('SELECT count(*)::text FROM public.notifications WHERE user_id = %L AND type = ''referral_reward''', :'a')), '1');
SELECT public.t_eq('4.10 es idempotente',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'b')), 'already_rewarded');
SELECT public.t_eq('4.11 y no suma otro mes',
  public.q1(format('SELECT (current_period_end = %L::timestamptz + interval ''1 month'')::text FROM public.mp_subscriptions WHERE user_id = %L', :'end_a', :'a')), 'true');
SELECT public.t_eq('4.12 sin referido no hay nada que dar',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'c')), 'no_referral');
-- e no tiene plan: g paga y e recibe 1 mes del Plan Esencial.
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'g','pro_monthly','approved', now() + interval '30 days');
SELECT public.t_eq('4.13 quien refiere sin plan también recibe su recompensa',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'g')), 'rewarded');
SELECT public.t_eq('4.14 queda con el Plan Esencial vigente',
  public.q1(format('SELECT public.plan_key_for(%L)', :'e')), 'essential_monthly');
SELECT public.t_true('4.15 por un mes desde hoy',
  (SELECT current_period_end BETWEEN now() + interval '1 month' - interval '1 minute' AND now() + interval '1 month' + interval '1 minute'
     FROM public.mp_subscriptions WHERE user_id = :'e'));
-- Plan vencido de quien refiere: se reemplaza por el mes de Esencial (no se suma a una fecha pasada).
UPDATE public.mp_subscriptions SET plan = 'pro_monthly', current_period_end = now() - interval '3 days' WHERE user_id = :'a';
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'d','essential_monthly','active', now() + interval '30 days');
SELECT public.t_eq('4.16 con el plan vencido, quien refiere también recibe la recompensa',
  public.t_run(NULL, 'service_role', format('SELECT public.grant_referral_reward(%L)', :'d')), 'rewarded');
SELECT public.t_true('4.17 y queda con un mes de Esencial desde hoy',
  (SELECT plan = 'essential_monthly' AND current_period_end > now() + interval '27 days' FROM public.mp_subscriptions WHERE user_id = :'a'));

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
