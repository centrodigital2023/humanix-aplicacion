-- Escenario — Referidos donde ya se aplicó el diseño anterior (20260606000001): la migración conserva los códigos compartidos,
-- quita las filas que solo guardaban el código y las repeticiones, retira las políticas y la función inseguras.
-- Variables: OLD (20260606000001_referrals.sql), MIG (20261020150000_referrals_security.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

\set l1 '00000000-0000-0000-0000-0000000002a1'
\set l2 '00000000-0000-0000-0000-0000000002a2'
\set l3 '00000000-0000-0000-0000-0000000002a3'
\set l4 '00000000-0000-0000-0000-0000000002a4'
INSERT INTO auth.users(id, email, created_at) VALUES
  (:'l1','l1@t.co', now() - interval '100 days'), (:'l2','l2@t.co', now() - interval '100 days'),
  (:'l3','l3@t.co', now() - interval '100 days'), (:'l4','l4@t.co', now());

\i :OLD
-- Datos con el diseño anterior: l1 solo tiene su fila-código; el código de l2 lo «consumió» l3, que además quedó
-- referido por segunda vez con otra fila de l1 (el diseño anterior lo permitía).
INSERT INTO public.referrals(referrer_id, referred_email, code, created_at) VALUES (:'l1', '', 'AAAA1111', now() - interval '9 days');
INSERT INTO public.referrals(referrer_id, referred_email, referred_id, code, status, created_at) VALUES
  (:'l2', 'l3@t.co', :'l3', 'BBBB2222', 'registered', now() - interval '8 days'),
  (:'l1', '',        :'l3', 'CCCC3333', 'registered', now() - interval '7 days');
SELECT public.t_true('0.1 antes: existe la función que recibía el id de otra persona', to_regprocedure('public.apply_referral_code(text, uuid)') IS NOT NULL);

\i :MIG
\i :MIG

SELECT public.t_eq('1.1 cada quien conserva su primer código (los enlaces ya compartidos siguen sirviendo)',
  public.q1('SELECT string_agg(code, '','' ORDER BY code) FROM public.referral_codes'), 'AAAA1111,BBBB2222');
SELECT public.t_eq('1.2 desaparecen las filas que solo guardaban el código',
  public.q1('SELECT count(*)::text FROM public.referrals WHERE referred_id IS NULL'), '0');
SELECT public.t_eq('1.3 una persona referida queda una sola vez (la más antigua)',
  public.q1(format('SELECT string_agg(referrer_id::text, '','') FROM public.referrals WHERE referred_id = %L', :'l3')), :'l2');
SELECT public.t_true('1.4 ya no existe la función insegura', to_regprocedure('public.apply_referral_code(text, uuid)') IS NULL);
SELECT public.t_true('1.5 ya no existen las políticas de escritura', NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'referrals' AND cmd <> 'SELECT'));
SELECT public.t_eq('1.6 el código conservado sirve para una cuenta nueva',
  public.t_val(:'l4', 'SELECT public.apply_referral_code(''AAAA1111'')'), 'applied');
SELECT public.t_eq('1.7 el código del dueño sigue siendo el mismo',
  public.t_val(:'l1', format('SELECT public.get_or_create_referral_code(%L)', :'l1')), 'AAAA1111');
SELECT public.t_err('1.8 quien refiere ya no edita sus filas',
  public.t_val(:'l2', 'UPDATE public.referrals SET status = ''rewarded'' RETURNING status'), 'permission denied');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
