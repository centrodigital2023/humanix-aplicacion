-- Escenario: Nixon (profesional) recibe un turno de 24 h de una familia y otro de una EPS/IPS.
\set ON_ERROR_STOP 1
CREATE TEMP TABLE checks (name text, ok boolean, detail text);

\set fam   '''11111111-1111-1111-1111-111111111111'''
\set ips   '''22222222-2222-2222-2222-222222222222'''
\set nixon '''33333333-3333-3333-3333-333333333333'''
\set her   '''44444444-4444-4444-4444-444444444444'''

INSERT INTO public.user_roles VALUES (:fam, 'family'), (:ips, 'institution'), (:nixon, 'professional'), (:her, 'family');
INSERT INTO public.profiles VALUES (:nixon, 'Nixon Paz'), (:fam, 'Ana Ruiz');
INSERT INTO public.institution_profiles VALUES (:ips, 'IPS Buesaco');
INSERT INTO public.care_circle_members VALUES (:fam, :her, 'accepted', true);

-- 1) Configuración de Realtime
INSERT INTO checks
SELECT 'replica full: ' || c.relname, c.relreplident = 'f', c.relreplident::text
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('service_bookings', 'care_logs', 'job_offer_shifts', 'notifications');
INSERT INTO checks
SELECT 'publicada: ' || t, EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t), ''
  FROM unnest(ARRAY['service_bookings', 'notifications', 'care_logs', 'job_offers', 'job_offer_shifts', 'messages']) t;
INSERT INTO checks
SELECT 'un solo disparador de aviso tras repetir la migración',
       count(*) = 1, count(*)::text
  FROM pg_trigger WHERE tgname = 'trg_notify_direct_booking_request';

-- 2) Pedido de la familia: 24 h, $240.000, pago directo
INSERT INTO public.service_bookings (id, client_id, professional_id, duration_hours, total_amount)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', :fam, :nixon, 24, 240000);
INSERT INTO checks
SELECT 'aviso a Nixon (familia)',
       body = 'Una familia te pide un turno de 24 h por $240.000 (pago directo al terminar). Acéptalo para abrir el chat y la llamada.'
       AND meta ->> 'origin' = 'family' AND (meta ->> 'total_amount')::int = 240000
       AND link = '/servicio/aaaaaaaa-0000-0000-0000-000000000001',
       body || ' ' || meta::text
  FROM public.notifications WHERE user_id = :nixon AND type = 'booking_requested' AND meta ->> 'booking_id' = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 3) Pedido de la EPS/IPS
INSERT INTO public.service_bookings (id, client_id, professional_id, duration_hours, total_amount, payment_mode)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', :ips, :nixon, 12, 150000, 'platform');
INSERT INTO checks
SELECT 'aviso a Nixon (EPS/IPS)', body LIKE 'Una EPS/IPS te pide un turno de 12 h por $150.000 (pago por la plataforma).%'
       AND meta ->> 'origin' = 'institution', body
  FROM public.notifications WHERE user_id = :nixon AND meta ->> 'booking_id' = 'aaaaaaaa-0000-0000-0000-000000000002';

-- 4) Reserva que nace confirmada (postulación aceptada): sin aviso de solicitud
INSERT INTO public.service_bookings (id, client_id, professional_id, status, duration_hours, total_amount)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', :ips, :nixon, 'confirmed', 8, 80000);
INSERT INTO checks
SELECT 'sin aviso de solicitud si nace confirmada', count(*) = 0, count(*)::text
  FROM public.notifications WHERE meta ->> 'booking_id' = 'aaaaaaaa-0000-0000-0000-000000000003';

-- 5) Nixon acepta: la familia y su círculo se enteran
UPDATE public.service_bookings SET status = 'confirmed' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO checks
SELECT 'aceptado → familia', count(*) = 1 AND bool_and(title = 'Nixon P. aceptó el servicio'), string_agg(title, ',')
  FROM public.notifications WHERE user_id = :fam AND type = 'booking_accepted';
INSERT INTO checks
SELECT 'aceptado → círculo', count(*) = 1 AND bool_and(body = 'El servicio de tu familiar quedó confirmado.'), count(*)::text
  FROM public.notifications WHERE user_id = :her AND type = 'booking_accepted';

-- 6) En camino (y no se repite si el UPDATE no cambia el estado)
UPDATE public.service_bookings SET status = 'in_route' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE public.service_bookings SET status = 'in_route' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO checks
SELECT 'en camino → familia una vez', count(*) = 1, count(*)::text
  FROM public.notifications WHERE user_id = :fam AND type = 'professional_on_the_way';

-- 7) La EPS/IPS recibe lo mismo que la familia
UPDATE public.service_bookings SET status = 'confirmed' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
INSERT INTO checks
SELECT 'aceptado → EPS/IPS', count(*) = 1, count(*)::text
  FROM public.notifications WHERE user_id = :ips AND type = 'booking_accepted';

-- 8) Un aviso que falla no impide crear la reserva
ALTER TABLE public.notifications ADD CONSTRAINT no_booking_requested CHECK (type <> 'booking_requested') NOT VALID;
INSERT INTO public.service_bookings (id, client_id, professional_id, duration_hours, total_amount)
VALUES ('aaaaaaaa-0000-0000-0000-000000000004', :fam, :nixon, 4, 40000);
INSERT INTO checks
SELECT 'la reserva se crea aunque el aviso falle', count(*) = 1, count(*)::text
  FROM public.service_bookings WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004';

SELECT count(*) FILTER (WHERE ok) || '|' || count(*) FILTER (WHERE NOT ok OR ok IS NULL) || '|' || count(*) AS "pasaron|fallaron|total"
  FROM checks;
SELECT name, detail FROM checks WHERE NOT ok OR ok IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM checks WHERE NOT ok OR ok IS NULL) THEN RAISE EXCEPTION 'Hay comprobaciones fallidas'; END IF;
END $$;
