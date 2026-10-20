-- Escenario — billetera y retiros. Variables: MIG, HELPERS, STUBS.
\i :HELPERS
\i :STUBS
SELECT public.t_true('0.1 antes: no existe la billetera', to_regclass('public.wallet_accounts') IS NULL);
SELECT public.t_eq('0.2 antes: quien crea la reserva elige el modo de pago', public.t_val(:'f1', format($q$INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount, payment_mode) VALUES (auth.uid(), %L, 'pending', now() + interval '20 days', 1, 1000000, 1000000, 'platform') RETURNING payment_mode$q$, :'p2')), 'platform');

\i :MIG

-- Billetera propia y lectura
SELECT public.t_eq('1.1 cada cuenta abre su billetera en cero', public.t_val(:'p1', 'SELECT balance_cents || ''/'' || pending_cents FROM public.get_or_create_wallet()') || ' ' || public.t_val(:'p1', format('SELECT balance_cents::text FROM public.get_or_create_wallet(%L)', :'p1')), '0/0 0');
SELECT public.t_eq('1.2 no se abre ni se lee la de otra cuenta', public.t_val(:'p2', format('SELECT balance_cents::text FROM public.get_or_create_wallet(%L)', :'p1')), 'ERR[42501] Solo puedes ver tu propia billetera');
SELECT public.t_true('1.3 sin sesión, nada', public.t_anon('SELECT balance_cents::text FROM public.get_or_create_wallet()') LIKE 'ERR[42501]%');

-- Nadie crea dinero desde el navegador
SELECT public.t_true('2.1 el dueño no edita su saldo', public.t_val(:'p1', 'UPDATE public.wallet_accounts SET balance_cents = 99999999 WHERE user_id = auth.uid() RETURNING 1') LIKE 'ERR[42501]%');
SELECT public.t_true('2.2 nadie se acredita con record_wallet_transaction', public.t_val(:'p1', $q$SELECT amount_cents::text FROM public.record_wallet_transaction(auth.uid(), 'adjustment', 100000000)$q$) LIKE 'ERR[42501]%'
  AND public.t_anon(format($q$SELECT amount_cents::text FROM public.record_wallet_transaction(%L, 'adjustment', 1)$q$, :'p1')) LIKE 'ERR[42501]%'
  AND public.t_val(:'sa', $q$SELECT amount_cents::text FROM public.record_wallet_transaction(auth.uid(), 'adjustment', 1)$q$) LIKE 'ERR[42501]%');
SELECT public.t_true('2.3 ni inserta movimientos o retiros a mano', public.t_val(:'p1', $q$INSERT INTO public.wallet_transactions(wallet_id, user_id, type, amount_cents, balance_after_cents) SELECT id, auth.uid(), 'adjustment', 1, 1 FROM public.wallet_accounts WHERE user_id = auth.uid() RETURNING 1$q$) LIKE 'ERR[42501]%'
  AND public.t_val(:'p1', $q$INSERT INTO public.payout_requests(user_id, wallet_id, amount_cents, method, destination) SELECT auth.uid(), id, 100, 'nequi', '{}' FROM public.wallet_accounts WHERE user_id = auth.uid() RETURNING 1$q$) LIKE 'ERR[42501]%');
SELECT public.t_eq('2.4 ni retira lo que no tiene', public.t_val(:'p1', $q$SELECT amount_cents::text FROM public.request_payout(100, 'nequi', '{"detail":"300"}')$q$), 'ERR[23514] Saldo disponible insuficiente');

-- Servicios: pago directo no acredita; intermediado sí, una vez
SELECT public.t_eq('3.1 la reserva creada desde el navegador nace con pago directo', public.t_val(:'f1', format($q$INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount, payment_mode) VALUES (auth.uid(), %L, 'pending', now() + interval '30 days', 1, 1000000, 1000000, 'platform') RETURNING payment_mode$q$, :'p1')), 'direct_to_professional');
UPDATE public.service_bookings SET status = 'in_progress' WHERE id = :'b1';
SELECT public.t_eq('3.2 completar un servicio con pago directo no acredita nada', public.t_val(:'f1', format($q$UPDATE public.service_bookings SET status = 'completed' WHERE id = %L RETURNING status$q$, :'b1')) || '/' || (SELECT count(*) FROM public.wallet_transactions)::text, 'completed/0');
SELECT public.t_val(:'sa', format($q$UPDATE public.service_bookings SET payment_mode = 'platform', status = 'in_progress' WHERE id = %L RETURNING payment_mode$q$, :'b3')) AS r \gset
SELECT public.t_val(:'i1', format($q$UPDATE public.service_bookings SET status = 'completed' WHERE id = %L RETURNING status$q$, :'b3')) AS r \gset
SELECT public.t_eq('3.3 uno intermediado por Humanix acredita el neto (12 %% de comisión en plan gratis)', :'r' || '/' || (SELECT balance_cents::text FROM public.wallet_accounts WHERE user_id = :'p1'), 'completed/7040000');
SELECT public.t_val(:'sa', format($q$UPDATE public.service_bookings SET status = 'in_progress' WHERE id = %L RETURNING 1$q$, :'b3')) AS r \gset
SELECT public.t_val(:'sa', format($q$UPDATE public.service_bookings SET status = 'completed' WHERE id = %L RETURNING 1$q$, :'b3')) AS r \gset
SELECT public.t_eq('3.4 y una sola vez', (SELECT balance_cents::text || '/' || count(*) FROM public.wallet_accounts w JOIN public.wallet_transactions t ON t.wallet_id = w.id WHERE w.user_id = :'p1' GROUP BY w.balance_cents), '7040000/1');

-- Retiros
SELECT public.t_val(:'p1', $q$SELECT id::text FROM public.request_payout(4000000, 'nequi', '{"detail":"3001234567"}')$q$) AS po1 \gset
SELECT public.t_eq('4.1 pedir un retiro mueve el monto a pendiente', (SELECT balance_cents || '/' || pending_cents FROM public.wallet_accounts WHERE user_id = :'p1'), '3040000/4000000');
SELECT public.t_eq('4.2 no se pide más de lo disponible', public.t_val(:'p1', $q$SELECT 1::text FROM public.request_payout(3040001, 'nequi', '{"detail":"x"}')$q$), 'ERR[23514] Saldo disponible insuficiente');
SELECT public.t_true('4.3 método o destino inválidos no entran', public.t_val(:'p1', $q$SELECT 1::text FROM public.request_payout(1, 'bitcoin', '{"detail":"x"}')$q$) LIKE 'ERR[22023]%'
  AND public.t_val(:'p1', $q$SELECT 1::text FROM public.request_payout(1, 'nequi', '"texto"')$q$) LIKE 'ERR[22023]%'
  AND public.t_val(:'p1', format($q$SELECT 1::text FROM public.request_payout(1, 'nequi', jsonb_build_object('d', %L))$q$, repeat('x', 600))) LIKE 'ERR[22023]%');
SELECT public.t_eq('4.4 el dueño no resuelve su propio retiro', public.t_val(:'p1', format($q$SELECT status FROM public.resolve_payout(%L, 'completed')$q$, :'po1')), 'ERR[42501] Solo el personal resuelve retiros');
SELECT public.t_val(:'sa', format($q$SELECT status FROM public.resolve_payout(%L, 'failed', NULL, 'Cuenta inexistente')$q$, :'po1')) AS r \gset
SELECT public.t_eq('4.5 el personal lo marca fallido y el dinero vuelve', :'r' || '/' || (SELECT balance_cents || '/' || pending_cents FROM public.wallet_accounts WHERE user_id = :'p1'), 'failed/7040000/0');
SELECT public.t_eq('4.6 un retiro resuelto no se resuelve otra vez', public.t_val(:'sa', format($q$SELECT status FROM public.resolve_payout(%L, 'completed')$q$, :'po1')), 'ERR[23514] Este retiro ya está failed');
SELECT public.t_val(:'p1', $q$SELECT id::text FROM public.request_payout(1000000, 'daviplata', '{"detail":"3001234567"}')$q$) AS po2 \gset
SELECT public.t_val(:'sa', format($q$SELECT status FROM public.resolve_payout(%L, 'completed', 'REF-1')$q$, :'po2')) AS r \gset
SELECT public.t_eq('4.7 completado: sale de pendiente', :'r' || '/' || (SELECT balance_cents || '/' || pending_cents FROM public.wallet_accounts WHERE user_id = :'p1'), 'completed/6040000/0');
SELECT public.t_eq('4.8 el libro cuadra con el saldo', (SELECT sum(amount_cents)::text FROM public.wallet_transactions WHERE user_id = :'p1'), '6040000');
SELECT public.t_eq('4.9 cada quien ve solo lo suyo', public.t_val(:'p1', 'SELECT count(*)::text FROM public.wallet_transactions') || '/' || public.t_val(:'p2', 'SELECT count(*)::text FROM public.wallet_transactions') || '/' || public.t_val(:'sa', 'SELECT count(*)::text FROM public.payout_requests') || '/' || public.t_val(:'p2', 'SELECT count(*)::text FROM public.payout_requests'), '4/0/2/0');
SELECT public.t_true('4.10 anon sin privilegios sobre las tablas', NOT has_table_privilege('anon', 'public.wallet_accounts', 'SELECT') AND NOT has_table_privilege('anon', 'public.wallet_transactions', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.wallet_accounts', 'UPDATE'));

SELECT (SELECT md5(string_agg(tablename || policyname || cmd || COALESCE(qual, ''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE tablename IN ('wallet_accounts', 'payout_requests', 'wallet_transactions'))
  || (SELECT string_agg(COALESCE(relacl::text, ''), '|' ORDER BY relname) FROM pg_class WHERE relname IN ('wallet_accounts', 'payout_requests', 'wallet_transactions') AND relnamespace = 'public'::regnamespace)
  || (SELECT sum(balance_cents)::text FROM public.wallet_accounts) AS sig \gset
\i :MIG
SELECT public.t_eq('5.1 segunda pasada: mismas políticas, privilegios y saldos', (SELECT md5(string_agg(tablename || policyname || cmd || COALESCE(qual, ''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE tablename IN ('wallet_accounts', 'payout_requests', 'wallet_transactions'))
  || (SELECT string_agg(COALESCE(relacl::text, ''), '|' ORDER BY relname) FROM pg_class WHERE relname IN ('wallet_accounts', 'payout_requests', 'wallet_transactions') AND relnamespace = 'public'::regnamespace)
  || (SELECT sum(balance_cents)::text FROM public.wallet_accounts), :'sig');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
