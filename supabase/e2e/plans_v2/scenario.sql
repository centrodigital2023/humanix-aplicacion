-- Escenario — Planes y precios de oct 2026 (20261023100000_plans_v2_pricing.sql) sobre la réplica de producción.
-- Comprueba: planes nuevos reconocidos como de pago, comisión del 10 % con la regla de los dos lados (profesional y quien
-- contrata), la comisión guardada en cada reserva y la acreditada al completar, créditos IA y cupos por plan, el tope del
-- círculo de cuidado y la prioridad de Pro/Premium en el directorio.
-- Variables: HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

\set p1 '00000000-0000-0000-0000-00000000b001'
\set p2 '00000000-0000-0000-0000-00000000b002'
\set p3 '00000000-0000-0000-0000-00000000b003'
\set f1 '00000000-0000-0000-0000-00000000c001'
\set f2 '00000000-0000-0000-0000-00000000c002'
\set f3 '00000000-0000-0000-0000-00000000c003'
\set f4 '00000000-0000-0000-0000-00000000c004'

INSERT INTO auth.users(id, email) VALUES
  (:'p1','p1@t.co'),(:'p2','p2@t.co'),(:'p3','p3@t.co'),(:'f1','f1@t.co'),(:'f2','f2@t.co'),(:'f3','f3@t.co'),(:'f4','f4@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'p1','professional'),(:'p2','professional'),(:'p3','professional'),
  (:'f1','family'),(:'f2','family'),(:'f3','family'),(:'f4','family');

SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city) VALUES
  (:'p1','Pía Free','Bogotá'),(:'p2','Pablo Pro','Bogotá'),(:'p3','Paula Premium','Bogotá'),
  (:'f1','Fabio Free','Bogotá'),(:'f2','Flor Familiar','Bogotá'),(:'f3','Fe Premium','Bogotá'),(:'f4','Fina Vencida','Bogotá');
-- Calificaciones: la de Free es la mejor, la de Premium la más baja.
INSERT INTO public.professional_profiles(user_id, specialty, hourly_rate, avg_rating, trust_score, service_cities, home_city,
    published, active, available, blocked) VALUES
  (:'p1','Enfermería',20000,4.6,70,'{Bogotá}','Bogotá',true,true,true,false),
  (:'p2','Enfermería',20000,4.3,70,'{Bogotá}','Bogotá',true,true,true,false),
  (:'p3','Enfermería',20000,4.0,70,'{Bogotá}','Bogotá',true,true,true,false);
SET session_replication_role = origin;

INSERT INTO public.mp_subscriptions(user_id, plan, amount, currency, status, current_period_end) VALUES
  (:'p2','pro_monthly',19900,'COP','active', now() + interval '20 days'),
  (:'p3','pro_premium_monthly',39900,'COP','active', now() + interval '20 days'),
  (:'f2','essential_monthly',9900,'COP','active', now() + interval '20 days'),
  (:'f3','family_premium_monthly',24900,'COP','approved', NULL),
  (:'f4','family_premium_monthly',24900,'COP','active', now() - interval '1 day');

-- 1) Planes nuevos = planes de pago
SELECT public.t_eq('plan_key_for: Pro', public.plan_key_for(:'p2'), 'pro_monthly');
SELECT public.t_eq('plan_key_for: Premium Profesional', public.plan_key_for(:'p3'), 'pro_premium_monthly');
SELECT public.t_eq('plan_key_for: Premium Familiar sin fecha de fin', public.plan_key_for(:'f3'), 'family_premium_monthly');
SELECT public.t_eq('plan_key_for: vencido es Free', public.plan_key_for(:'f4'), 'free');
SELECT public.t_eq('plan_tier_rank sube con el precio',
  (SELECT string_agg(public.plan_tier_rank(p)::text, ',' ORDER BY o)
     FROM unnest(ARRAY['free','essential_monthly','pro_monthly','family_premium_monthly','pro_premium_monthly','institution_monthly'])
     WITH ORDINALITY AS t(p, o)), '0,1,2,3,4,5');

-- 2) Comisión
SELECT public.t_eq('comisión: profesional Free', public.platform_commission_pct(:'p1')::text, '10');
SELECT public.t_eq('comisión: profesional Pro', public.platform_commission_pct(:'p2')::text, '0');
SELECT public.t_eq('comisión: profesional Premium', public.platform_commission_pct(:'p3')::text, '0');
SELECT public.t_eq('servicio: nadie paga plan → 10 %', public.booking_commission_pct(:'p1', :'f1')::text, '10');
SELECT public.t_eq('servicio: familia Familiar → sin comisión', public.booking_commission_pct(:'p1', :'f2')::text, '0');
SELECT public.t_eq('servicio: familia Premium → sin comisión', public.booking_commission_pct(:'p1', :'f3')::text, '0');
SELECT public.t_eq('servicio: plan vencido de la familia no cuenta', public.booking_commission_pct(:'p1', :'f4')::text, '10');
SELECT public.t_eq('servicio: profesional Pro → sin comisión', public.booking_commission_pct(:'p2', :'f1')::text, '0');
SELECT public.t_eq('quien contrata ve la comisión del servicio (Free)', public.t_val(:'f1', format('SELECT public.my_booking_commission_pct(%L)::text', :'p1')), '10');
SELECT public.t_eq('quien contrata ve la comisión del servicio (Familiar)', public.t_val(:'f2', format('SELECT public.my_booking_commission_pct(%L)::text', :'p1')), '0');
SELECT public.t_err('nadie consulta la regla de dos lados por otra persona', public.t_val(:'f1', format('SELECT public.booking_commission_pct(%L, %L)::text', :'p1', :'f2')), 'permission denied');

-- 3) La reserva guarda la comisión y el neto; al completarla se acredita con esa comisión
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount, payment_mode)
VALUES (:'f1', :'p1', 'confirmed', now() + interval '1 day', 5, 20000, 100000, 'platform'),
       (:'f2', :'p1', 'confirmed', now() + interval '2 day', 5, 20000, 100000, 'platform');
SELECT public.t_eq('reserva Free/Free: 10 % y comisión de 10.000',
  (SELECT platform_fee_pct::int || '|' || platform_fee_amount FROM public.service_bookings WHERE client_id = :'f1'), '10|10000');
SELECT public.t_eq('reserva con familia Familiar: 0 %',
  (SELECT platform_fee_pct::int || '|' || platform_fee_amount FROM public.service_bookings WHERE client_id = :'f2'), '0|0');
UPDATE public.service_bookings SET status = 'in_progress', started_at = now() WHERE professional_id = :'p1';
UPDATE public.service_bookings SET status = 'completed', completed_at = now() WHERE professional_id = :'p1';
SELECT public.t_eq('neto acreditado: 90.000 y 100.000 (en centavos)',
  (SELECT string_agg(amount_cents::text, ',' ORDER BY amount_cents) FROM public.wallet_transactions
    WHERE user_id = :'p1' AND type = 'service_earning'), '9000000,10000000');

-- 4) Cupos por plan
SELECT public.t_eq('créditos IA por plan',
  public.ai_credits_monthly_allowance(:'p1') || ',' || public.ai_credits_monthly_allowance(:'f2') || ',' ||
  public.ai_credits_monthly_allowance(:'f3') || ',' || public.ai_credits_monthly_allowance(:'p2') || ',' ||
  public.ai_credits_monthly_allowance(:'p3'), '30,150,300,400,1000');
SELECT public.t_eq('desbloqueos de contacto por día',
  public.reveal_daily_quota('free') || ',' || public.reveal_daily_quota('essential_monthly') || ',' ||
  public.reveal_daily_quota('family_premium_monthly') || ',' || public.reveal_daily_quota('pro_monthly') || ',' ||
  public.reveal_daily_quota('pro_premium_monthly'), '0,15,40,40,80');

-- 5) Círculo de cuidado
SELECT public.t_eq('Free: invita a 1 persona',
  public.t_val(:'f1', format('INSERT INTO public.care_circle_members(owner_id, invited_email) VALUES (%L, %L) RETURNING %L', :'f1', 'a@t.co', 'ok')), 'ok');
SELECT public.t_err('Free: la segunda invitación pide plan',
  public.t_val(:'f1', format('INSERT INTO public.care_circle_members(owner_id, invited_email) VALUES (%L, %L) RETURNING %L', :'f1', 'b@t.co', 'ok')), 'círculo de cuidado');
SELECT public.t_eq('Free: el panel ve 1 de 1',
  public.t_val(:'f1', 'SELECT used || ''/'' || circle_limit FROM public.my_circle_quota()'), '1/1');
UPDATE public.care_circle_members SET status = 'declined' WHERE owner_id = :'f1';
SELECT public.t_eq('Free: una invitación rechazada libera el cupo',
  public.t_val(:'f1', format('INSERT INTO public.care_circle_members(owner_id, invited_email) VALUES (%L, %L) RETURNING %L', :'f1', 'c@t.co', 'ok')), 'ok');
SELECT public.t_eq('Premium Familiar: invita a varias personas',
  (SELECT string_agg(public.t_val(:'f3', format('INSERT INTO public.care_circle_members(owner_id, invited_email) VALUES (%L, %L) RETURNING %L', :'f3', 'm' || g || '@t.co', 'ok')), ',')
     FROM generate_series(1, 4) g), 'ok,ok,ok,ok');
SELECT public.t_eq('Premium Familiar: el panel ve 4 de 10',
  public.t_val(:'f3', 'SELECT used || ''/'' || circle_limit FROM public.my_circle_quota()'), '4/10');

-- 6) Directorio: Premium (+1) y Pro (+0,5) antes que Free con mejor calificación
SELECT public.t_eq('directorio: Premium, Pro y luego Free',
  public.t_val(:'f1', 'SELECT string_agg(full_name, '','' ORDER BY ord) FROM (SELECT full_name, row_number() OVER () AS ord FROM public.public_professionals(p_specialty => ''Enfermería'')) x'),
  'Paula Premium,Pablo Pro,Pía Free');
SELECT public.t_eq('directorio: el visitante ve el mismo orden',
  public.t_anon('SELECT string_agg(full_name, '','' ORDER BY ord) FROM (SELECT full_name, row_number() OVER () AS ord FROM public.public_professionals(p_specialty => ''Enfermería'')) x'),
  'Paula P.,Pablo P.,Pía F.');
SELECT public.t_eq('badge destacado: solo Premium Profesional',
  public.t_anon(format('SELECT string_agg(user_id::text, '','') FROM public.featured_professionals(ARRAY[%L, %L, %L]::uuid[])', :'p1', :'p2', :'p3')), :'p3');
SELECT public.t_err('el plan de otra persona no se consulta directo',
  public.t_val(:'f1', format('SELECT public.plan_key_for(%L)', :'p3')), 'permission denied');

\pset tuples_only on
SELECT n || ' ' || CASE WHEN ok THEN 'ok  ' ELSE 'FALLA' END || ' ' || name || CASE WHEN ok THEN '' ELSE ' — ' || detail END FROM public._t ORDER BY n;
SELECT count(*) || '|' || count(*) FILTER (WHERE NOT ok) || '|' || count(*) FILTER (WHERE ok) FROM public._t;
