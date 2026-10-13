-- Escenario — avisos de ofertas nuevas, negociación según el plan, postulantes en tarjetas, contacto y Trust Score, sobre la réplica
-- de producción (ya con la moderación aplicada).
-- Variables: M2 (20261012190000_offer_alerts_and_plans.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

-- ═══ Utilidades del escenario ══════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.t_su(q text) RETURNS text LANGUAGE plpgsql AS $$ DECLARE v text; BEGIN EXECUTE q INTO v; RETURN COALESCE(v, 'NULL'); EXCEPTION WHEN OTHERS THEN RETURN 'ERR[' || SQLSTATE || '] ' || SQLERRM; END $$;
-- Código y pista del error de una consulta hecha con la sesión de un usuario.
CREATE FUNCTION public.t_hint(u uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    RESET ROLE;
    RETURN SQLSTATE || '/' || COALESCE(v_hint, '');
  END;
END $$;

CREATE TABLE public.t_who (id uuid PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION public.t_mkuser(p_label text, p_role text, p_name text, p_city text DEFAULT NULL, p_phone text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, p_label || '@t.co');
  INSERT INTO public.user_roles(user_id, role) VALUES (v, p_role::public.app_role);
  INSERT INTO public.profiles(user_id, full_name, city, phone) VALUES (v, p_name, p_city, p_phone);
  INSERT INTO public.t_who VALUES (v, p_label);
  RETURN v;
END $$;
CREATE FUNCTION public.t_mkpro(p_label text, p_name text, p_home_city text, p_lat float8, p_lng float8, p_published boolean DEFAULT true,
                               p_available boolean DEFAULT true, p_blocked boolean DEFAULT false, p_phone text DEFAULT '3001234567',
                               p_trust integer DEFAULT 0, p_rethus boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := public.t_mkuser(p_label, 'professional', p_name, p_home_city, p_phone);
BEGIN
  INSERT INTO public.professional_profiles(user_id, home_city, lat, lng, published, available, blocked, specialty, years_experience, trust_score, rethus_verified)
  VALUES (v, p_home_city, p_lat, p_lng, p_published, p_available, p_blocked, 'Enfermería', 5, p_trust, p_rethus);
  RETURN v;
END $$;
CREATE FUNCTION public.t_mkfam(p_label text, p_name text, p_city text, p_lat float8, p_lng float8) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := public.t_mkuser(p_label, 'family', p_name, p_city);
BEGIN
  INSERT INTO public.family_profiles(user_id, default_lat, default_lng) VALUES (v, p_lat, p_lng);
  RETURN v;
END $$;
-- Una necesidad de la familia, publicada con su sesión: devuelve su id (o el error).
CREATE FUNCTION public.t_need(u uuid, p_care text DEFAULT 'Adulto mayor', p_rate integer DEFAULT 20000, p_days integer DEFAULT 2) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_val(u, format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now() + interval '%s days', now() + interval '%s days 1 hour', %s, 'open', %L) RETURNING id::text$q$, u, p_days, p_days, p_rate, p_care)) $$;
-- Quién recibió avisos de ese tipo y cuántos («pA:1,pG:2»).
CREATE FUNCTION public.t_notified(p_type text DEFAULT 'new_offer') RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(w.label || ':' || n.c, ',' ORDER BY w.label), '-')
    FROM (SELECT user_id, count(*) AS c FROM public.notifications WHERE type = p_type GROUP BY user_id) n
    JOIN public.t_who w ON w.id = n.user_id $$;

-- Cuentas de la prueba (las de los ayudantes no traen perfil).
INSERT INTO public.t_who VALUES (:'f1','f1'),(:'f2','f2'),(:'p1','p1'),(:'p2','p2'),(:'i1','i1'),(:'i2','i2');
INSERT INTO public.profiles(user_id, full_name, city, phone) VALUES
  (:'f1', 'Ana Gómez', 'Bogotá D.C.', NULL), (:'f2', 'Carlos Ruiz', 'Bogotá', NULL),
  (:'p1', 'Pedro Pérez', 'Bogotá', '3001110001'), (:'p2', 'Luisa Martínez', 'Bogotá', '3001110002'), (:'i1', 'Clínica del Norte', 'Bogotá', NULL);
INSERT INTO public.family_profiles(user_id, default_lat, default_lng) VALUES (:'f1', 4.7110, -74.0721), (:'f2', 4.7110, -74.0721);
-- p1 y p2 NO están publicados: son los profesionales de las negociaciones, no destinatarios de avisos.
INSERT INTO public.professional_profiles(user_id, home_city, lat, lng, published, available, specialty, years_experience) VALUES
  (:'p1', 'Bogotá', 4.7000, -74.0600, false, true, 'Enfermería', 8), (:'p2', 'Bogotá', 4.7050, -74.0650, false, true, 'Auxiliar de enfermería', 3);

-- Profesionales para los avisos. Bogotá: 4.7110, -74.0721. Soacha ≈ 21,7 km; Medellín ≈ 239 km; Cali ≈ 300 km.
-- misma ciudad, a 1,8 km
SELECT public.t_mkpro('pA', 'Andrea Torres',  'Bogotá',   4.7000, -74.0600, true, true, false, '3001234567', 82, true)  AS pa \gset
-- otra ciudad
SELECT public.t_mkpro('pB', 'Beatriz Mejía',  'Medellín', 6.2442, -75.5812)                                              AS pb \gset
-- no disponible
SELECT public.t_mkpro('pC', 'Camila Soto',    'Bogotá',   4.7040, -74.0640, true, false)                                 AS pc \gset
-- bloqueada
SELECT public.t_mkpro('pD', 'Diana Castro',   'Bogotá',   4.7060, -74.0660, true, true, true)                            AS pd \gset
-- con alerta propia
SELECT public.t_mkpro('pE', 'Elsa Prieto',    'Bogotá',   4.7200, -74.0800, true, true, false, '3001230005', 91)         AS pe \gset
-- sin publicar
SELECT public.t_mkpro('pF', 'Fabiola León',   'Bogotá',   4.7080, -74.0700, false)                                       AS pf \gset
-- otra ciudad, a 21,7 km, sin teléfono
SELECT public.t_mkpro('pG', 'Gloria Ortiz',   'Soacha',   4.5794, -74.2168, true, true, false, NULL)                     AS pg \gset
-- lejos
SELECT public.t_mkpro('pH', 'Helena Díaz',    'Cali',     3.4516, -76.5320)                                              AS ph \gset
-- sin coordenadas: atiende Bogotá
SELECT public.t_mkpro('pI', 'Irene Pardo',    'Tunja',    NULL, NULL, true, true, false, '3001230009', 55)               AS pi \gset
UPDATE public.professional_profiles SET service_cities = ARRAY['Bogotá'] WHERE user_id = :'pi';
-- sin ciudad ni coordenadas
SELECT public.t_mkpro('pJ', 'Julia Mora',     NULL,       NULL, NULL)                                                    AS pj \gset
INSERT INTO public.opportunity_alerts(professional_id, name) VALUES (:'pe', 'Todo Bogotá');                                              -- pE solo quiere sus alertas

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 5) AS n0 \gset
SELECT public.t_eq('0.1 antes: publicar una necesidad no avisa a ningún profesional cercano', public.t_notified('new_offer'), '-');
SELECT public.t_eq('0.2 antes: la alerta propia sí funciona (pE)', public.t_notified('opportunity_alert'), 'pE:1');
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, 'Hola, puedo ayudarte')$q$, :'n0')) AS pr0 \gset
SELECT public.t_true('0.3 antes: el profesional se postuló', :'pr0' !~ '^ERR');
SELECT public.t_true('0.4 antes: la familia del plan gratuito contraoferta sin plan', public.t_val(:'f1', format($q$SELECT public.counter_slot_proposal(%L, 24000, NULL)$q$, :'pr0')) !~ '^ERR');
DELETE FROM public.slot_proposals;
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, 'Hola')$q$, :'n0')) AS pr0b \gset
SELECT public.t_eq('0.5 antes: la familia del plan gratuito ve el nombre completo del profesional', public.t_val(:'f1', $q$SELECT peer_name FROM public.my_slot_proposals() LIMIT 1$q$), 'Pedro Pérez');
DELETE FROM public.slot_proposals; DELETE FROM public.family_needs; DELETE FROM public.notifications; DELETE FROM public.opportunity_alert_log;

\i :M2

-- ═══ Utilidades puras ═════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('1.1 Bogotá ↔ Chía ≈ 16,5 km', public.hx_distance_km(4.7110, -74.0721, 4.8587, -74.0586) BETWEEN 16 AND 17);
SELECT public.t_true('1.2 Bogotá ↔ Medellín ≈ 239 km', public.hx_distance_km(4.7110, -74.0721, 6.2442, -75.5812) BETWEEN 235 AND 245);
SELECT public.t_true('1.3 el mismo punto está a 0 km y la distancia es simétrica',
  public.hx_distance_km(4.7, -74.0, 4.7, -74.0) = 0 AND abs(public.hx_distance_km(4.71, -74.07, 6.24, -75.58) - public.hx_distance_km(6.24, -75.58, 4.71, -74.07)) < 1e-9);
SELECT public.t_true('1.4 sin alguna coordenada no hay distancia',
  public.hx_distance_km(NULL, -74.0, 4.7, -74.0) IS NULL AND public.hx_distance_km(4.7, -74.0, 4.7, NULL) IS NULL);
SELECT public.t_eq('1.5 rangos de cercanía', (SELECT string_agg(COALESCE(public.hx_distance_band(v)::text, 'N'), ',' ORDER BY i)
  FROM unnest(ARRAY[0, 2, 2.01, 5, 5.01, 10, 10.5, 20, 20.01, 50, 50.01, 300, NULL]::float8[]) WITH ORDINALITY AS u(v, i)), '2,2,5,5,10,10,20,20,50,50,100,100,N');
SELECT public.t_eq('1.6 niveles del Trust Score', (SELECT string_agg(public.hx_trust_level(s), ',' ORDER BY i)
  FROM unnest(ARRAY[NULL, 100, 85, 84, 70, 69, 50, 49, 0]::int[]) WITH ORDINALITY AS u(s, i)), 'unrated,excellent,excellent,high,high,medium,medium,building,building');
SELECT public.t_eq('1.7 cómo se nombra a un profesional', public.hx_pro_label('Pedro Pérez', true) || '|' || public.hx_pro_label('Pedro Pérez', false) || '|' || public.hx_pro_label('', true)
  || '|' || public.hx_pro_label(NULL, false) || '|' || public.hx_pro_label('ana@correo.com', false) || '|' || public.hx_pro_label('  Luisa   Martínez ', true), 'Pedro P.|Pedro Pérez|Profesional|Profesional|Profesional|Luisa M.');

-- ═══ Avisos de ofertas nuevas ═════════════════════════════════════════════════════════════════════════════════
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 2) AS n1 \gset
SELECT public.t_true('2.1 la necesidad se publicó', :'n1' !~ '^ERR');
SELECT public.t_eq('2.2 avisa a quien está en su ciudad, a menos de 30 km o la atiende por zona de servicio — y a nadie más', public.t_notified(), 'pA:1,pG:1,pI:1');
SELECT public.t_eq('2.3 la alerta propia de pE sigue funcionando, sin duplicarla con el aviso general', public.t_notified('opportunity_alert') || '/' || (SELECT count(*) FROM public.notifications WHERE user_id = :'pe' AND type = 'new_offer'), 'pE:1/0');
SELECT public.t_eq('2.4 el título', (SELECT title FROM public.notifications WHERE user_id = :'pa' AND type = 'new_offer'), 'Nueva oferta de una familia cerca de ti');
SELECT public.t_true('2.5 el texto dice qué, dónde, cuándo y cuánto', (SELECT body FROM public.notifications WHERE user_id = :'pa' AND type = 'new_offer') ~ '^Adulto mayor en Bogotá D\.C\. · desde \d\d/\d\d \d\d:\d\d · \$20\.000 por hora$');
SELECT public.t_true('2.6 sin nombres de la familia', (SELECT body FROM public.notifications WHERE user_id = :'pa' AND type = 'new_offer') !~* 'ana|gómez|gomez');
SELECT public.t_eq('2.7 lleva al panel del profesional y trae a quién y qué', (SELECT link || '|' || (meta->>'kind') || '|' || (meta->>'poster_id') || '|' || (meta->>'need_id') FROM public.notifications WHERE user_id = :'pa' AND type = 'new_offer'),
  '/dashboard/profesional|family_need|' || :'f1' || '|' || :'n1');
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 3) AS n1b \gset
SELECT public.t_eq('2.8 una segunda necesidad de la misma familia, enseguida, no vuelve a avisar (un aviso cada 6 horas por familia)', public.t_notified(), 'pA:1,pG:1,pI:1');
SELECT public.t_need(:'f2', 'Enfermería', 25000, 2) AS n2 \gset
SELECT public.t_eq('2.9 otra familia sí avisa', public.t_notified(), 'pA:2,pG:2,pI:2');
SELECT public.t_eq('2.10 la bitácora guarda un renglón por aviso', (SELECT count(*)::text FROM public.offer_notify_log), '6');
UPDATE public.offer_notify_log SET notified_at = now() - interval '7 hours' WHERE poster_id = :'f1';
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 4) AS n1c \gset
SELECT public.t_eq('2.11 pasadas las 6 horas, la familia vuelve a avisar', public.t_notified(), 'pA:3,pG:3,pI:3');

-- Tope diario por profesional: 10.
INSERT INTO public.offer_notify_log(professional_id, poster_id, kind) SELECT :'pa', :'t3', 'family_need' FROM generate_series(1, 7);   -- 3 + 7 = 10
SELECT public.t_mkfam('f3', 'Luz Rincón', 'Bogotá', 4.7110, -74.0721) AS f3 \gset
SELECT public.t_need(:'f3', 'Enfermería', 22000, 2) AS n3 \gset
SELECT public.t_eq('2.12 con 10 avisos en el día, a pA ya no le llegan más; a los demás sí', public.t_notified(), 'pA:3,pG:4,pI:4');

-- Sin ubicación, vencidas o cerradas no avisan; la necesidad se publica igual.
SELECT public.t_mkfam('f4', 'Sin Sitio', NULL, NULL, NULL) AS f4 \gset
SELECT public.t_need(:'f4', 'Enfermería', 22000, 2) AS n4 \gset
SELECT public.t_true('2.13 una familia sin ciudad ni coordenadas publica, pero no hay a quién decirle «cerca»', :'n4' !~ '^ERR' AND public.t_notified() = 'pA:3,pG:4,pI:4');
SELECT public.t_mkfam('f5', 'Fam Cinco', 'Bogotá', 4.7110, -74.0721) AS f5 \gset
SELECT public.t_su(format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now() + interval '2 days', now() + interval '2 days 1 hour', 20000, 'cancelled', 'Enfermería') RETURNING 'OK'$q$, :'f5')) AS dummy \gset
SELECT public.t_su(format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now() - interval '3 hours', now() - interval '2 hours', 20000, 'open', 'Enfermería') RETURNING 'OK'$q$, :'f5')) AS dummy2 \gset
SELECT public.t_eq('2.14 una necesidad cancelada o ya vencida no avisa', public.t_notified(), 'pA:3,pG:4,pI:4');

-- Ofertas de instituciones y de familias.
INSERT INTO public.institution_profiles(user_id, institution_name, nit, verified, chamber_of_commerce_number, lat, lng, created_at)
VALUES (:'i1', 'Clínica del Norte', '900123456', true, 'CC-123', 4.7110, -74.0721, now() - interval '540 days');
SELECT public.t_val(:'i1', $q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status) VALUES (auth.uid(), 'institution', 'Auxiliar de enfermería turno noche', 'Sede norte', 'hour', 25000, 'Bogotá', 'open') RETURNING id::text$q$) AS o1 \gset
SELECT public.t_true('2.15 la institución publica', :'o1' !~ '^ERR');
-- pA ya llegó a su tope de 10 avisos del día (2.12): la oferta de la institución avisa a los demás.
SELECT public.t_eq('2.16 y avisa a los profesionales cercanos que aún no llegaron a su tope diario', public.t_notified(), 'pA:3,pG:5,pI:5');
SELECT public.t_eq('2.17 el texto lleva el nombre de la institución, el cargo, la ciudad y el valor',
  (SELECT title || ' | ' || body || ' | ' || (meta->>'kind') || ' | ' || (meta->>'offer_id') FROM public.notifications WHERE user_id = :'pg' AND type = 'new_offer' AND meta->>'kind' = 'institution_offer'),
  'Nueva oferta de una institución cerca de ti | Clínica del Norte: Auxiliar de enfermería turno noche · Bogotá · $25.000 | institution_offer | ' || :'o1');
SELECT public.t_val(:'i1', $q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status) VALUES (auth.uid(), 'institution', 'Terapeuta respiratoria', 'Sede sur', 'hour', 30000, 'Bogotá', 'open') RETURNING id::text$q$) AS o1b \gset
SELECT public.t_eq('2.18 una segunda oferta de la misma institución enseguida no vuelve a avisar', public.t_notified(), 'pA:3,pG:5,pI:5');
SELECT public.t_su(format($q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status, blocked) VALUES (%L, 'institution', 'Oferta bloqueada', 'x', 'hour', 20000, 'Bogotá', 'open', true) RETURNING 'OK'$q$, :'i2')) AS dummy3 \gset
SELECT public.t_su(format($q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status) VALUES (%L, 'institution', 'Oferta cerrada', 'x', 'hour', 20000, 'Bogotá', 'closed') RETURNING 'OK'$q$, :'i2')) AS dummy4 \gset
SELECT public.t_eq('2.19 una oferta bloqueada o cerrada no avisa', public.t_notified(), 'pA:3,pG:5,pI:5');
SELECT public.t_val(:'f5', $q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status) VALUES (auth.uid(), 'family', 'Cuidadora para adulto mayor', 'Turnos de noche', 'hour', 18000, 'Bogotá', 'open') RETURNING id::text$q$) AS o2 \gset
SELECT public.t_eq('2.20 la oferta de trabajo de una familia avisa como familia', (SELECT title FROM public.notifications WHERE user_id = :'pg' AND type = 'new_offer' AND meta->>'kind' = 'family_offer'), 'Nueva oferta de una familia cerca de ti');

-- La alerta propia y el aviso general no se pisan.
UPDATE public.opportunity_alerts SET active = false WHERE professional_id = :'pe';
SELECT public.t_mkfam('f6', 'Fam Seis', 'Bogotá', 4.7110, -74.0721) AS f6 \gset
SELECT public.t_need(:'f6', 'Enfermería', 22000, 2) AS n6 \gset
SELECT public.t_eq('2.21 sin alertas propias activas, pE también recibe el aviso general', (SELECT count(*)::text FROM public.notifications WHERE user_id = :'pe' AND type = 'new_offer'), '1');

-- Un aviso que falla nunca impide publicar.
CREATE FUNCTION public.t_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'new_offer' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
CREATE TRIGGER t_boom BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_boom();
SELECT public.t_mkfam('f7', 'Fam Siete', 'Bogotá', 4.7110, -74.0721) AS f7 \gset
SELECT public.t_need(:'f7', 'Enfermería', 22000, 2) AS n7 \gset
SELECT public.t_true('2.22 si el aviso falla, la necesidad se publica igual', :'n7' !~ '^ERR' AND EXISTS (SELECT 1 FROM public.family_needs WHERE id = :'n7'::uuid));
DROP TRIGGER t_boom ON public.notifications;

-- Perfiles que NO deben recibir avisos aunque estén publicados en la ciudad: inactivos, sin rol de profesional, y quien publica.
DELETE FROM public.notifications; DELETE FROM public.offer_notify_log;
UPDATE public.opportunity_alerts SET active = false WHERE professional_id = :'pe';
SELECT public.t_mkpro('pK', 'Karen Gil', 'Bogotá', 4.7010, -74.0610) AS pk \gset
UPDATE public.professional_profiles SET active = false WHERE user_id = :'pk';
SELECT public.t_mkuser('pM', 'family', 'Marta Lis', 'Bogotá') AS pm \gset
INSERT INTO public.professional_profiles(user_id, home_city, lat, lng, published, available, specialty) VALUES (:'pm', 'Bogotá', 4.7020, -74.0620, true, true, 'Enfermería');
SELECT public.t_mkpro('pL', 'Laura Peña', 'Bogotá', 4.7030, -74.0630) AS pl \gset
INSERT INTO public.user_roles(user_id, role) VALUES (:'pl', 'family');
INSERT INTO public.family_profiles(user_id, default_lat, default_lng) VALUES (:'pl', 4.7030, -74.0630);
SELECT public.t_need(:'pl', 'Enfermería', 22000, 2) AS n9 \gset
SELECT public.t_eq('2.22b ni un perfil inactivo, ni uno sin rol de profesional, ni quien publica su propia necesidad (aunque también sea profesional) reciben el aviso', public.t_notified(), 'pA:1,pE:1,pG:1,pI:1');
UPDATE public.professional_profiles SET published = false WHERE user_id = :'pl';

-- Tope de 200 por oferta, los más cercanos primero.
DELETE FROM public.notifications; DELETE FROM public.offer_notify_log;
INSERT INTO auth.users(id, email) SELECT md5('x' || i)::uuid, 'x' || i || '@t.co' FROM generate_series(1, 210) i;
INSERT INTO public.user_roles(user_id, role) SELECT md5('x' || i)::uuid, 'professional' FROM generate_series(1, 210) i;
INSERT INTO public.profiles(user_id, full_name, city) SELECT md5('x' || i)::uuid, 'Extra ' || i, 'Bogotá' FROM generate_series(1, 210) i;
INSERT INTO public.professional_profiles(user_id, home_city, lat, lng, published, available)
  SELECT md5('x' || i)::uuid, 'Bogotá', 4.7110 + i * 0.0012, -74.0721, true, true FROM generate_series(1, 210) i;
INSERT INTO public.t_who SELECT md5('x' || i)::uuid, 'x' || lpad(i::text, 3, '0') FROM generate_series(1, 210) i;
SELECT public.t_mkfam('f8', 'Fam Ocho', 'Bogotá', 4.7110, -74.0721) AS f8 \gset
SELECT public.t_need(:'f8', 'Enfermería', 22000, 2) AS n8 \gset
SELECT public.t_eq('2.23 máximo 200 avisos por oferta', (SELECT count(*)::text FROM public.notifications WHERE type = 'new_offer'), '200');
SELECT public.t_eq('2.24 entran los más cercanos y quedan fuera los más lejanos y los que no tienen coordenadas',
  (SELECT count(*) FILTER (WHERE user_id = md5('x1')::uuid)::text || '/' || count(*) FILTER (WHERE user_id = md5('x210')::uuid)::text || '/' || count(*) FILTER (WHERE user_id = :'pi')::text FROM public.notifications WHERE type = 'new_offer'), '1/0/0');
SELECT public.t_eq('2.25 quedan fuera exactamente los 13 extras más lejanos (de 213 candidatos con distancia, entran 200); pA (a 1,8 km) y pG (a 21,7 km) entran',
  (SELECT count(*)::text || '/' || min(w.label) FROM public.t_who w WHERE w.label LIKE 'x%' AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = w.id AND n.type = 'new_offer'))
  || '/' || (SELECT count(*) FROM public.notifications WHERE user_id IN (:'pa', :'pg') AND type = 'new_offer'), '13/x198/2');
DELETE FROM public.professional_profiles WHERE user_id IN (SELECT md5('x' || i)::uuid FROM generate_series(1, 210) i);
DELETE FROM public.t_who WHERE label LIKE 'x%';
DELETE FROM public.profiles WHERE user_id IN (SELECT md5('x' || i)::uuid FROM generate_series(1, 210) i);
DELETE FROM public.user_roles WHERE user_id IN (SELECT md5('x' || i)::uuid FROM generate_series(1, 210) i);
DELETE FROM auth.users WHERE id IN (SELECT md5('x' || i)::uuid FROM generate_series(1, 210) i);
DELETE FROM public.notifications; DELETE FROM public.offer_notify_log;

-- Seguridad de las piezas nuevas.
SELECT public.t_true('2.26 los clientes no leen ni escriben la bitácora de avisos',
  public.t_val(:'f1', 'SELECT count(*)::text FROM public.offer_notify_log') LIKE 'ERR[42501]%' AND public.t_anon('SELECT count(*)::text FROM public.offer_notify_log') LIKE 'ERR[42501]%'
  AND public.t_val(:'f1', format($q$INSERT INTO public.offer_notify_log(professional_id, poster_id, kind) VALUES (%L, %L, 'x') RETURNING 'OK'$q$, :'pa', :'f1')) LIKE 'ERR[42501]%');
SELECT public.t_true('2.27 la bitácora y los reveles tienen RLS', (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.offer_notify_log'::regclass, 'public.applicant_contact_reveals'::regclass)));
SELECT public.t_true('2.28 las piezas internas no se llaman desde la API',
  NOT has_function_privilege('authenticated', 'public.hx_notify_nearby_professionals(text, uuid, text, double precision, double precision, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.hx_notify_nearby_professionals(text, uuid, text, double precision, double precision, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_trust_calc(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.trg_family_need_notify_pros()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.trg_job_offer_notify_pros()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_reveal_pro_contact(uuid, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.hx_reveal_pro_contact(uuid, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_distance_km(double precision, double precision, double precision, double precision)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_pro_label(text, boolean)', 'EXECUTE'));
SELECT public.t_true('2.29 lo que usa la aplicación: con sesión sí, sin sesión no',
  has_function_privilege('authenticated', 'public.get_trust_score(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.get_trust_score(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.family_applicants(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.family_applicants(integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reveal_applicant_contact(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.reveal_applicant_contact(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reveal_application_contact(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.reveal_application_contact(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.family_offer_applicants(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.family_offer_applicants(integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.counter_application(uuid, integer, text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.counter_application(uuid, integer, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_open_family_needs(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.list_open_institution_offers(integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.list_open_family_offers(integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.list_open_family_offers(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.counter_slot_proposal(uuid, integer, text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.my_slot_proposals(integer)', 'EXECUTE'));
SELECT public.t_eq('2.30 un disparador de aviso por tabla, por fila y después de insertar',
  (SELECT string_agg(c.relname || ':' || t.tgname || ':' || (t.tgtype & 1) || ':' || (t.tgtype & 4), ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'trg\_%\_notify\_pros' ESCAPE '\'),
  'family_needs:trg_family_needs_notify_pros:1:4,job_offers:trg_job_offers_notify_pros:1:4');

-- ═══ Negociar el valor según el plan ══════════════════════════════════════════════════════════════════════════
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 5) AS nn \gset
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, 'Hola, puedo ayudarte')$q$, :'nn')) AS pr1 \gset
SELECT public.t_true('3.1 el profesional se postuló al valor publicado (gratis)', :'pr1' !~ '^ERR');
SELECT public.t_eq('3.2 la familia del plan gratuito no puede contraofertar: pide el plan Esencial', public.t_hint(:'f1', format($q$SELECT public.counter_slot_proposal(%L, 24000, NULL)$q$, :'pr1')), '42501/negotiate_rate_requires_plan');
SELECT public.t_eq('3.3 …y la propuesta quedó como estaba', (SELECT status::text || '/' || round_no FROM public.slot_proposals WHERE id = :'pr1'::uuid), 'pending/1');
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'f1', 'essential_monthly', 'active', now() + interval '20 days');
SELECT public.t_val(:'f1', format($q$SELECT public.counter_slot_proposal(%L, 24000, 'Te propongo un poco más')$q$, :'pr1')) AS pr2 \gset
SELECT public.t_true('3.4 con el plan Esencial, la familia contraoferta', :'pr2' !~ '^ERR');
SELECT public.t_eq('3.5 la ronda sube, la anterior queda contraofertada y la nueva es de la familia', (SELECT string_agg(status::text || '/' || round_no || '/' || proposed_by::text || '/' || hourly_rate, ',' ORDER BY round_no) FROM public.slot_proposals WHERE id IN (:'pr1'::uuid, :'pr2'::uuid)), 'countered/1/professional/20000,pending/2/family/24000');
SELECT public.t_eq('3.6 el profesional del plan gratuito sigue sin poder contraofertar', public.t_hint(:'p1', format($q$SELECT public.counter_slot_proposal(%L, 22000, NULL)$q$, :'pr2')), '42501/negotiate_rate_requires_plan');
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'p1', 'essential_monthly', 'active', now() + interval '20 days');
SELECT public.t_val(:'p1', format($q$SELECT public.counter_slot_proposal(%L, 22000, NULL)$q$, :'pr2')) AS pr3 \gset
SELECT public.t_true('3.7 con el plan Esencial, el profesional contraoferta', :'pr3' !~ '^ERR');
SELECT public.t_err('3.8 tercera ronda: ya no se contraoferta, ni la familia con plan', public.t_val(:'f1', format($q$SELECT public.counter_slot_proposal(%L, 21000, NULL)$q$, :'pr3')), 'última oferta');
SELECT public.t_err('3.9 quien envió la oferta no puede contraofertarla', public.t_val(:'p1', format($q$SELECT public.counter_slot_proposal(%L, 21000, NULL)$q$, :'pr3')), 'Solo quien recibe');
SELECT public.t_true('3.10 aceptar la última oferta sí, y crea la reserva', public.t_val(:'f1', format($q$SELECT public.accept_slot_proposal(%L)$q$, :'pr3')) !~ '^ERR');
-- Aceptar y rechazar son gratis para la familia del plan gratuito.
SELECT public.t_need(:'f2', 'Enfermería', 20000, 6) AS nn2 \gset
SELECT public.t_val(:'p2', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, NULL)$q$, :'nn2')) AS pr4 \gset
SELECT public.t_true('3.11 la familia del plan gratuito acepta sin plan', public.t_val(:'f2', format($q$SELECT public.accept_slot_proposal(%L)$q$, :'pr4')) !~ '^ERR');
SELECT public.t_need(:'f2', 'Enfermería', 20000, 7) AS nn3 \gset
SELECT public.t_val(:'p2', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, NULL)$q$, :'nn3')) AS pr5 \gset
SELECT public.t_eq('3.12 …y rechaza sin plan', public.t_val(:'f2', format($q$UPDATE public.slot_proposals SET status = 'rejected' WHERE id = %L RETURNING status::text$q$, :'pr5')), 'rejected');
SELECT public.t_true('3.13 sin sesión no se contraoferta', public.t_anon(format($q$SELECT public.counter_slot_proposal(%L, 24000, NULL)$q$, :'pr5')) LIKE 'ERR[42501]%');

-- ═══ Nombres según el plan ════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_need(:'f2', 'Enfermería', 20000, 8) AS nn4 \gset
SELECT public.t_val(:'p2', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, NULL)$q$, :'nn4')) AS pr6 \gset
SELECT public.t_eq('4.1 la familia del plan gratuito ve «Luisa M.»', public.t_val(:'f2', format($q$SELECT peer_name FROM public.my_slot_proposals() WHERE id = %L$q$, :'pr6')), 'Luisa M.');
SELECT public.t_need(:'f1', 'Adulto mayor', 20000, 9) AS nn5 \gset
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_family_need(ARRAY[%L::uuid], NULL, NULL)$q$, :'nn5')) AS pr7 \gset
SELECT public.t_eq('4.2 la familia con plan Esencial ve el nombre completo', public.t_val(:'f1', format($q$SELECT peer_name FROM public.my_slot_proposals() WHERE id = %L$q$, :'pr7')), 'Pedro Pérez');
SELECT public.t_eq('4.3 el profesional sigue viendo a la familia abreviada', public.t_val(:'p1', format($q$SELECT peer_name FROM public.my_slot_proposals() WHERE id = %L$q$, :'pr7')), 'Ana G.');
SELECT public.t_eq('4.4 la foto del profesional solo viaja hacia la familia', public.t_val(:'p1', format($q$SELECT COALESCE(peer_avatar, 'nulo') FROM public.my_slot_proposals() WHERE id = %L$q$, :'pr7')), 'nulo');

-- ═══ Postulantes de la familia, en tarjetas ═══════════════════════════════════════════════════════════════════
SELECT public.t_mkfam('fE', 'Elena Vargas', 'Bogotá', 4.7110, -74.0721) AS fe \gset
SELECT public.t_mkfam('fF', 'Felipe Rojas', 'Bogotá', 4.7110, -74.0721) AS ff \gset
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'fe', 'essential_monthly', 'active', now() + interval '10 days');
-- Fixtures directos (sin disparadores): propuestas en todos los estados, con estrellas y servicios del profesional.
SET session_replication_role = replica;
INSERT INTO public.slot_proposals(id, family_user_id, professional_id, starts_at, ends_at, hourly_rate, proposed_by, status, message, round_no, posted_rate, expires_at, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000aa01', :'fe', :'pa', now() + interval '10 days', now() + interval '10 days 4 hours', 21000, 'professional', 'pending',  'Tengo experiencia con adultos mayores', 1, 20000, now() + interval '3 days', now() - interval '1 hour',  now()),
  ('00000000-0000-0000-0000-00000000aa02', :'fe', :'pe', now() + interval '11 days', now() + interval '11 days 4 hours', 22000, 'professional', 'pending',  NULL, 3, 20000, now() + interval '3 days', now() - interval '2 hours', now()),
  ('00000000-0000-0000-0000-00000000aa03', :'fe', :'pg', now() + interval '12 days', now() + interval '12 days 4 hours', 20000, 'professional', 'countered', NULL, 1, 20000, now() + interval '3 days', now() - interval '5 hours', now()),
  ('00000000-0000-0000-0000-00000000aa04', :'fe', :'pg', now() + interval '12 days', now() + interval '12 days 4 hours', 19000, 'family',       'pending',  NULL, 2, 20000, now() + interval '1 day',  now() - interval '30 minutes', now()),
  ('00000000-0000-0000-0000-00000000aa05', :'fe', :'pi', now() + interval '13 days', now() + interval '13 days 4 hours', 20000, 'professional', 'accepted', NULL, 1, 20000, now() + interval '3 days', now() - interval '3 hours', now()),
  ('00000000-0000-0000-0000-00000000aa06', :'fe', :'pb', now() + interval '14 days', now() + interval '14 days 4 hours', 20000, 'professional', 'pending',  NULL, 1, 20000, now() - interval '1 hour', now() - interval '4 hours', now()),
  ('00000000-0000-0000-0000-00000000aa07', :'fe', :'ph', now() + interval '15 days', now() + interval '15 days 4 hours', 20000, 'professional', 'rejected', NULL, 1, 20000, now() + interval '3 days', now() - interval '4 hours', now()),
  ('00000000-0000-0000-0000-00000000aa08', :'fe', :'pc', now() + interval '16 days', now() + interval '16 days 4 hours', 20000, 'professional', 'countered', NULL, 1, 20000, now() + interval '3 days', now() - interval '4 hours', now()),
  ('00000000-0000-0000-0000-00000000aa09', :'fe', :'pd', now() + interval '17 days', now() + interval '17 days 4 hours', 20000, 'professional', 'pending',  NULL, 1, 20000, now() + interval '3 days', now() - interval '4 hours', now()),
  ('00000000-0000-0000-0000-00000000aa0a', :'fe', :'pj', now() + interval '18 days', now() + interval '18 days 4 hours', 20000, 'professional', 'accepted', NULL, 1, 20000, now() + interval '3 days', now() - interval '20 days', now() - interval '20 days'),
  ('00000000-0000-0000-0000-00000000aa0b', :'ff', :'pa', now() + interval '10 days', now() + interval '10 days 4 hours', 21000, 'professional', 'pending',  NULL, 1, 20000, now() + interval '3 days', now() - interval '1 hour',  now());
INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (:'b1', :'f1', :'pa', 4), (:'b1', :'f2', :'pa', 5), (:'b1', :'i1', :'pa', 5);
INSERT INTO public.ratings(rated_user_id, rater_user_id, stars) VALUES (:'pg', :'f1', 5), (:'pg', :'f2', 3), (:'pi', :'f1', 5);
SET session_replication_role = origin;

SELECT public.t_eq('5.1 la familia con plan Esencial ve a sus postulantes vigentes, en este orden: los que esperan su respuesta primero',
  public.t_val(:'fe', $q$SELECT string_agg(display_name, ',' ORDER BY ord) FROM (SELECT display_name, row_number() OVER () AS ord FROM public.family_applicants()) t$q$),
  'Andrea Torres,Elsa Prieto,Gloria Ortiz,Irene Pardo');
SELECT public.t_eq('5.2 de quién es el turno', public.t_val(:'fe', $q$SELECT string_agg(awaiting, ',') FROM public.family_applicants()$q$), 'family,family,professional,done');
SELECT public.t_eq('5.3 puede negociar solo si el plan lo permite, es su turno y no es la última ronda', public.t_val(:'fe', $q$SELECT string_agg(can_negotiate::text, ',') FROM public.family_applicants()$q$), 'true,false,false,false');
SELECT public.t_eq('5.4 cercanía por rangos (1,8 km → 2; 1,4 km → 2; 21,7 km → 50; sin coordenadas → nada)', public.t_val(:'fe', $q$SELECT string_agg(COALESCE(distance_band_km::text, 'N'), ',') FROM public.family_applicants()$q$), '2,2,50,N');
SELECT public.t_eq('5.5 estrellas: 3 del servicio (4,5,5); ninguna; 2 del sistema anterior (5 y 3); 1 (5)',
  public.t_val(:'fe', $q$SELECT string_agg(COALESCE(stars_avg::text, 'N') || '/' || COALESCE(ratings_count::text, '0'), ',') FROM public.family_applicants()$q$), '4.67/3,N/0,4.00/2,5.00/1');
SELECT public.t_eq('5.6 Trust Score del profesional: el de la validación con IA, o nada si no se ha validado',
  public.t_val(:'fe', $q$SELECT string_agg(COALESCE(trust_score::text, 'N') || '/' || trust_level, ',') FROM public.family_applicants()$q$), '82/high,91/excellent,N/unrated,55/medium');
SELECT public.t_eq('5.7 valor propuesto, valor publicado y total estimado (4 horas)', public.t_val(:'fe', $q$SELECT hourly_rate || '/' || posted_rate || '/' || hours || '/' || estimated_total FROM public.family_applicants() LIMIT 1$q$), '21000/20000/4.00/84000');
SELECT public.t_eq('5.8 RETHUS verificado y ciudad', public.t_val(:'fe', $q$SELECT rethus_verified::text || '/' || city FROM public.family_applicants() LIMIT 1$q$), 'true/Bogotá');
SELECT public.t_eq('5.9 vencidas, rechazadas, contraofertadas, de profesionales bloqueados y aceptadas hace más de 14 días no aparecen', public.t_val(:'fe', $q$SELECT count(*)::text FROM public.family_applicants()$q$), '4');
SELECT public.t_eq('5.10 plan y cupo de contactos del plan Esencial', public.t_val(:'fe', $q$SELECT plan_key || '/' || can_reveal || '/' || reveals_left FROM public.family_applicants() LIMIT 1$q$), 'essential_monthly/true/15');
SELECT public.t_eq('5.11 la familia del plan gratuito ve el nombre abreviado, no puede negociar ni desbloquear el contacto',
  public.t_val(:'ff', $q$SELECT display_name || '/' || name_is_short || '/' || can_negotiate || '/' || can_reveal || '/' || reveals_left || '/' || plan_key FROM public.family_applicants()$q$), 'Andrea T./true/false/false/0/free');
SELECT public.t_eq('5.12 cada familia ve solo lo suyo', public.t_val(:'f2', $q$SELECT count(*)::text FROM public.family_applicants() WHERE professional_id = (SELECT professional_id FROM public.slot_proposals WHERE id = '00000000-0000-0000-0000-00000000aa01')$q$), '0');
SELECT public.t_eq('5.13 un profesional no tiene postulantes: su lista, como familia, va vacía', public.t_val(:'pa', $q$SELECT count(*)::text FROM public.family_applicants()$q$), '0');
SELECT public.t_eq('5.14 la función no devuelve coordenadas, teléfono, correo ni nombre completo de columnas sensibles',
  (SELECT count(*)::text FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'family\_applicants%' ESCAPE '\' AND parameter_mode = 'OUT' AND parameter_name IN ('lat', 'lng', 'phone', 'email', 'whatsapp', 'full_name', 'address')), '0');
SELECT public.t_true('5.15 sin sesión no se llama', public.t_anon('SELECT count(*)::text FROM public.family_applicants()') LIKE 'ERR[42501]%');

-- ═══ Contacto del postulante ══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('6.1 la familia del plan gratuito no desbloquea contactos', public.t_hint(:'ff', $q$SELECT public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa0b')$q$), '42501/plan_required');
SELECT public.t_eq('6.2 con plan Esencial: nombre completo, teléfono y WhatsApp, y quedan 14', public.t_val(:'fe', $q$SELECT full_name || '/' || phone || '/' || whatsapp || '/' || reveals_left FROM public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa01')$q$), 'Andrea Torres/3001234567/3001234567/14');
SELECT public.t_eq('6.3 repetirlo el mismo día no gasta cupo ni vuelve a avisar', public.t_val(:'fe', $q$SELECT reveals_left::text FROM public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa01')$q$) || '/' || (SELECT count(*) FROM public.notifications WHERE user_id = :'pa' AND type = 'contact_revealed') || '/' || (SELECT count(*) FROM public.applicant_contact_reveals), '14/1/1');
SELECT public.t_true('6.4 se avisa al profesional, sin pagos por WhatsApp', (SELECT title FROM public.notifications WHERE user_id = :'pa' AND type = 'contact_revealed') = 'Una familia desbloqueó tu contacto'
  AND (SELECT body FROM public.notifications WHERE user_id = :'pa' AND type = 'contact_revealed') LIKE 'Elena V. vio tus datos de contacto%solo en la página web%');
SELECT public.t_eq('6.5 un profesional sin teléfono registrado: no hay nada que desbloquear, no gasta cupo ni avisa', public.t_val(:'fe', $q$SELECT COALESCE(phone, 'sin') || '/' || reveals_left FROM public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa04')$q$) || '/' || (SELECT count(*) FROM public.notifications WHERE user_id = :'pg' AND type = 'contact_revealed'), 'sin/14/0');
SELECT public.t_eq('6.6 la postulación de otra familia no es suya', public.t_hint(:'f2', $q$SELECT public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa01')$q$), 'P0002/');
SELECT public.t_eq('6.7 una postulación vencida, rechazada o aceptada hace mucho ya no está vigente', public.t_hint(:'fe', $q$SELECT public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa06')$q$) || ' ' || public.t_hint(:'fe', $q$SELECT public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa07')$q$), '42501/proposal_not_active 42501/proposal_not_active');
SELECT public.t_true('6.8 sin sesión no se desbloquea', public.t_anon($q$SELECT * FROM public.reveal_applicant_contact('00000000-0000-0000-0000-00000000aa01')$q$) LIKE 'ERR[42501]%');
SELECT public.t_eq('6.9 la familia ve sus propias filas de auditoría y nadie más las ve', public.t_val(:'fe', 'SELECT count(*)::text FROM public.applicant_contact_reveals') || '/' || public.t_val(:'f2', 'SELECT count(*)::text FROM public.applicant_contact_reveals') || '/' || public.t_val(:'pa', 'SELECT count(*)::text FROM public.applicant_contact_reveals'), '1/0/0');
SELECT public.t_true('6.10 ni siquiera la familia escribe en esa tabla', public.t_val(:'fe', format($q$INSERT INTO public.applicant_contact_reveals(family_user_id, professional_id, plan, revealed_on) VALUES (%L, %L, 'essential_monthly', current_date) RETURNING 'OK'$q$, :'fe', :'pe')) LIKE 'ERR[42501]%');
SELECT public.t_eq('6.11 la tarjeta marca el contacto ya desbloqueado y el cupo que queda', public.t_val(:'fe', $q$SELECT contact_unlocked::text || '/' || reveals_left FROM public.family_applicants() WHERE display_name = 'Andrea Torres'$q$), 'true/14');

-- Cupo diario: 15 profesionales distintos con el plan Esencial.
SELECT public.t_mkfam('fQ', 'Quintero Familia', 'Bogotá', 4.7110, -74.0721) AS fq \gset
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'fq', 'essential_monthly', 'active', now() + interval '10 days');
DO $$ BEGIN
  FOR i IN 1..16 LOOP
    PERFORM public.t_mkpro('q' || lpad(i::text, 2, '0'), 'Pro Q' || i, 'Bogotá', NULL, NULL, false, true, false, '30055500' || lpad(i::text, 2, '0'));
  END LOOP;
END $$;
SET session_replication_role = replica;
INSERT INTO public.slot_proposals(family_user_id, professional_id, starts_at, ends_at, hourly_rate, proposed_by, status, round_no, posted_rate, expires_at, created_at)
  SELECT :'fq', w.id, now() + interval '20 days' + (row_number() OVER (ORDER BY w.label)) * interval '1 day', now() + interval '20 days 2 hours' + (row_number() OVER (ORDER BY w.label)) * interval '1 day', 20000, 'professional', 'pending', 1, 20000, now() + interval '3 days',
         now() - (row_number() OVER (ORDER BY w.label)) * interval '1 minute'
    FROM public.t_who w WHERE w.label LIKE 'q__';
SET session_replication_role = origin;
SELECT public.t_eq('6.12 los 15 primeros se desbloquean',
  (SELECT count(*) FILTER (WHERE public.t_val(:'fq', format($q$SELECT reveals_left::text FROM public.reveal_applicant_contact(%L)$q$, sp.id)) !~ '^ERR')::text
     FROM (SELECT sp.id FROM public.slot_proposals sp JOIN public.t_who w ON w.id = sp.professional_id WHERE sp.family_user_id = :'fq' ORDER BY w.label LIMIT 15) sp), '15');
SELECT public.t_eq('6.13 el 16.º llega al límite diario', public.t_hint(:'fq', format($q$SELECT public.reveal_applicant_contact(%L)$q$, (SELECT sp.id FROM public.slot_proposals sp JOIN public.t_who w ON w.id = sp.professional_id WHERE sp.family_user_id = :'fq' ORDER BY w.label DESC LIMIT 1))), '42501/quota_exceeded');
SELECT public.t_eq('6.14 uno ya desbloqueado se puede volver a abrir aunque el cupo esté agotado', public.t_val(:'fq', format($q$SELECT reveals_left::text FROM public.reveal_applicant_contact(%L)$q$, (SELECT sp.id FROM public.slot_proposals sp JOIN public.t_who w ON w.id = sp.professional_id WHERE sp.family_user_id = :'fq' ORDER BY w.label LIMIT 1))), '0');
SELECT public.t_eq('6.15 la lista dice que no quedan', public.t_val(:'fq', $q$SELECT string_agg(DISTINCT reveals_left::text, ',') FROM public.family_applicants()$q$) || '/' || public.t_val(:'fq', $q$SELECT count(*) FILTER (WHERE contact_unlocked)::text FROM public.family_applicants()$q$), '0/15');
UPDATE public.applicant_contact_reveals SET revealed_on = revealed_on - 1 WHERE family_user_id = :'fq';
SELECT public.t_eq('6.16 al día siguiente el cupo se renueva', public.t_val(:'fq', $q$SELECT string_agg(DISTINCT reveals_left::text, ',') FROM public.family_applicants()$q$), '15');

-- ═══ Postulaciones a las ofertas de trabajo de la familia ═════════════════════════════════════════════════════
SELECT public.t_mkfam('fA', 'Alicia Rey', 'Bogotá', 4.7110, -74.0721) AS fa \gset
SELECT public.t_mkfam('fB', 'Beto Cruz', 'Bogotá', 4.7110, -74.0721) AS fb \gset
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'fa', 'essential_monthly', 'active', now() + interval '10 days');
SET session_replication_role = replica;
INSERT INTO public.job_offers(id, posted_by, poster_type, title, description, modality, amount, city, status, start_date, end_date) VALUES
  ('00000000-0000-0000-0000-00000000bb01', :'fa', 'family', 'Cuidadora de noche', 'Turnos de noche', 'hour', 18000, 'Bogotá', 'open', now() + interval '9 days', now() + interval '9 days 8 hours'),
  ('00000000-0000-0000-0000-00000000bb02', :'fb', 'family', 'Enfermera por horas', 'Mañanas', 'hour', 18000, 'Bogotá', 'open', now() + interval '9 days', now() + interval '9 days 8 hours');
INSERT INTO public.applications(id, job_offer_id, professional_id, message, proposed_amount, status, posted_amount, round_no, awaiting, expires_at, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000bb01', :'pa', 'Tengo experiencia nocturna', 19000, 'pending',  18000, 1, 'institution', now() + interval '3 days', now() - interval '1 hour', now()),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-00000000bb01', :'pe', NULL, 17000, 'pending',  18000, 2, 'professional', now() + interval '1 day',  now() - interval '2 hours', now()),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-00000000bb01', :'pi', NULL, 18000, 'accepted', 18000, 1, 'institution', NULL,                      now() - interval '4 hours', now()),
  ('00000000-0000-0000-0000-00000000cc04', '00000000-0000-0000-0000-00000000bb01', :'pb', NULL, 18000, 'pending',  18000, 1, 'institution', now() - interval '1 hour',  now() - interval '5 hours', now()),
  ('00000000-0000-0000-0000-00000000cc05', '00000000-0000-0000-0000-00000000bb01', :'ph', NULL, 18000, 'rejected', 18000, 1, 'institution', NULL,                      now() - interval '5 hours', now()),
  ('00000000-0000-0000-0000-00000000cc06', '00000000-0000-0000-0000-00000000bb01', :'pd', NULL, 18000, 'pending',  18000, 1, 'institution', now() + interval '3 days', now() - interval '6 hours', now()),
  ('00000000-0000-0000-0000-00000000cc07', '00000000-0000-0000-0000-00000000bb01', :'pc', NULL, 19500, 'pending',  18000, 3, 'institution', now() + interval '1 day',  now() - interval '3 hours', now()),
  ('00000000-0000-0000-0000-00000000cc08', '00000000-0000-0000-0000-00000000bb02', :'pa', NULL, 18000, 'pending',  18000, 1, 'institution', now() + interval '3 days', now() - interval '1 hour', now()),
  ('00000000-0000-0000-0000-00000000cc09', :'o1',                                    :'pe', NULL, 26000, 'pending',  25000, 1, 'institution', now() + interval '3 days', now() - interval '1 hour', now()),
  ('00000000-0000-0000-0000-00000000cc10', '00000000-0000-0000-0000-00000000bb01', :'pj', NULL, 18000, 'accepted', 18000, 1, 'institution', NULL,                      now() - interval '20 days', now() - interval '20 days');
SET session_replication_role = origin;

SELECT public.t_eq('6b.1 la familia con plan Esencial ve las postulaciones vigentes a su oferta: primero las que esperan su respuesta',
  public.t_val(:'fa', $q$SELECT string_agg(display_name, ',') FROM public.family_offer_applicants()$q$), 'Andrea Torres,Camila Soto,Elsa Prieto,Irene Pardo');
SELECT public.t_eq('6b.2 de quién es el turno y si puede negociar (última ronda y turno del profesional, no)',
  public.t_val(:'fa', $q$SELECT string_agg(awaiting || '/' || can_negotiate, ',') FROM public.family_offer_applicants()$q$), 'family/true,family/false,professional/false,done/false');
SELECT public.t_eq('6b.3 valor publicado, propuesto, ronda y la oferta a la que responde',
  public.t_val(:'fa', $q$SELECT posted_amount || '/' || proposed_amount || '/' || round_no || '/' || offer_title || '/' || modality || '/' || has_shifts FROM public.family_offer_applicants() LIMIT 1$q$), '18000/19000/1/Cuidadora de noche/hour/false');
SELECT public.t_eq('6b.4 cercanía, estrellas y Trust Score como en las otras tarjetas',
  public.t_val(:'fa', $q$SELECT COALESCE(distance_band_km::text, 'N') || '/' || COALESCE(stars_avg::text, 'N') || '/' || ratings_count || '/' || COALESCE(trust_score::text, 'N') || '/' || trust_level FROM public.family_offer_applicants() LIMIT 1$q$), '2/4.67/3/82/high');
SELECT public.t_eq('6b.5 vencidas, rechazadas, de profesionales bloqueados y aceptadas hace más de 14 días no aparecen', public.t_val(:'fa', $q$SELECT count(*)::text FROM public.family_offer_applicants()$q$), '4');
SELECT public.t_eq('6b.6 la familia del plan gratuito ve el nombre abreviado, no negocia ni desbloquea contactos',
  public.t_val(:'fb', $q$SELECT display_name || '/' || name_is_short || '/' || can_negotiate || '/' || can_reveal || '/' || reveals_left || '/' || plan_key FROM public.family_offer_applicants()$q$), 'Andrea T./true/false/false/0/free');
SELECT public.t_eq('6b.7 cada familia ve solo las postulaciones a SUS ofertas', public.t_val(:'fb', $q$SELECT count(*)::text FROM public.family_offer_applicants()$q$) || '/' || public.t_val(:'f1', $q$SELECT count(*)::text FROM public.family_offer_applicants()$q$) || '/' || public.t_val(:'pa', $q$SELECT count(*)::text FROM public.family_offer_applicants()$q$), '1/0/0');
SELECT public.t_eq('6b.8 la función no devuelve coordenadas ni teléfonos', (SELECT count(*)::text FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'family\_offer\_applicants%' ESCAPE '\' AND parameter_mode = 'OUT' AND parameter_name IN ('lat', 'lng', 'phone', 'email', 'whatsapp', 'full_name', 'address')), '0');
SELECT public.t_true('6b.9 sin sesión no se llama', public.t_anon('SELECT count(*)::text FROM public.family_offer_applicants()') LIKE 'ERR[42501]%');

-- Contraoferta: la familia del plan gratuito no; con plan Esencial sí; las instituciones, como siempre, sin plan.
SELECT public.t_eq('6b.10 la familia del plan gratuito no contraoferta una postulación', public.t_hint(:'fb', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc08', 17500, NULL)$q$), '42501/negotiate_rate_requires_plan');
SELECT public.t_val(:'fa', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc01', 17500, NULL)::text$q$) AS r611 \gset
SELECT public.t_eq('6b.11 con plan Esencial sí: la ronda sube y el turno pasa al profesional', :'r611' || '/' || (SELECT proposed_amount || '/' || awaiting || '/' || round_no FROM public.applications WHERE id = '00000000-0000-0000-0000-00000000cc01'), '2/17500/professional/2');
SELECT public.t_eq('6b.12 el aviso al profesional nombra a la familia y lo lleva a su panel', (SELECT body || ' | ' || link FROM public.notifications WHERE user_id = :'pa' AND type = 'application_counter_offer'), 'Alicia R. propone $17.500 para «Cuidadora de noche». Respóndela antes de que venza. | /dashboard/profesional');
SELECT public.t_eq('6b.13 el profesional del plan gratuito sigue sin contraofertar', public.t_hint(:'pa', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc01', 18500, NULL)$q$), '42501/negotiate_rate_requires_plan');
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES (:'pa', 'essential_monthly', 'active', now() + interval '10 days');
SELECT public.t_val(:'pa', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc01', 18500, NULL)::text$q$) AS r614 \gset
SELECT public.t_eq('6b.14 con plan Esencial, el profesional contraoferta y la familia recibe el aviso en SU panel', :'r614' || '/' || (SELECT body || ' | ' || link FROM public.notifications WHERE user_id = :'fa' AND type = 'application_counter_offer'), '3/Andrea T. propone $18.500 para «Cuidadora de noche». Respóndela antes de que venza. | /dashboard/familia');
SELECT public.t_err('6b.15 en la última ronda ya solo se acepta o se rechaza', public.t_val(:'fa', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc01', 18000, NULL)::text$q$), 'última oferta');
SELECT public.t_val(:'i1', $q$SELECT public.counter_application('00000000-0000-0000-0000-00000000cc09', 24000, NULL)::text$q$) AS r616 \gset
SELECT public.t_eq('6b.16 una institución del plan gratuito sigue negociando sin plan, con su nombre en el aviso', :'r616' || '/' || (SELECT body || ' | ' || link FROM public.notifications WHERE user_id = :'pe' AND type = 'application_counter_offer'), '2/Clínica del Norte propone $24.000 para «Auxiliar de enfermería turno noche». Respóndela antes de que venza. | /dashboard/profesional');

-- Contacto de quien se postuló a la oferta.
SELECT public.t_eq('6b.17 la familia del plan gratuito no desbloquea el contacto', public.t_hint(:'fb', $q$SELECT public.reveal_application_contact('00000000-0000-0000-0000-00000000cc08')$q$), '42501/plan_required');
SELECT public.t_eq('6b.18 con plan Esencial: nombre completo y WhatsApp; quedan 14', public.t_val(:'fa', $q$SELECT full_name || '/' || whatsapp || '/' || reveals_left FROM public.reveal_application_contact('00000000-0000-0000-0000-00000000cc01')$q$), 'Andrea Torres/3001234567/14');
SELECT public.t_eq('6b.19 la auditoría guarda de qué postulación salió', (SELECT (application_id = '00000000-0000-0000-0000-00000000cc01')::text || '/' || COALESCE(proposal_id::text, 'sin') FROM public.applicant_contact_reveals WHERE family_user_id = :'fa'), 'true/sin');
SELECT public.t_eq('6b.20 repetirlo no gasta cupo', public.t_val(:'fa', $q$SELECT reveals_left::text FROM public.reveal_application_contact('00000000-0000-0000-0000-00000000cc01')$q$), '14');
SELECT public.t_eq('6b.21 la postulación de otra familia no es suya', public.t_hint(:'fb', $q$SELECT public.reveal_application_contact('00000000-0000-0000-0000-00000000cc01')$q$), 'P0002/');
SELECT public.t_eq('6b.22 vencida o rechazada, ya no está vigente', public.t_hint(:'fa', $q$SELECT public.reveal_application_contact('00000000-0000-0000-0000-00000000cc04')$q$) || ' ' || public.t_hint(:'fa', $q$SELECT public.reveal_application_contact('00000000-0000-0000-0000-00000000cc05')$q$), '42501/proposal_not_active 42501/proposal_not_active');
SELECT public.t_true('6b.23 sin sesión no se desbloquea', public.t_anon($q$SELECT * FROM public.reveal_application_contact('00000000-0000-0000-0000-00000000cc01')$q$) LIKE 'ERR[42501]%');
SELECT public.t_eq('6b.24 el cupo del día es uno solo, venga de horas o de ofertas: un profesional ya visto no vuelve a gastar', public.t_val(:'fa', $q$SELECT string_agg(DISTINCT reveals_left::text, ',') FROM public.family_offer_applicants()$q$), '14');
SELECT public.t_eq('6b.25 la tarjeta marca el contacto ya desbloqueado', public.t_val(:'fa', $q$SELECT contact_unlocked::text FROM public.family_offer_applicants() WHERE display_name = 'Andrea Torres'$q$), 'true');

-- Aceptar y rechazar siguen siendo gratis y funcionan con una oferta de familia sin agenda.
SELECT public.t_eq('6b.26 aceptar una oferta sin horario pide el horario', public.t_hint(:'fa', $q$SELECT public.accept_application('00000000-0000-0000-0000-00000000cc07')$q$), '23514/shifts_required');
SELECT public.t_val(:'fb', $q$SELECT public.decline_application('00000000-0000-0000-0000-00000000cc08', 'No es el perfil')::text$q$) AS r627 \gset
SELECT public.t_true('6b.27 la familia del plan gratuito rechaza sin plan', :'r627' !~ '^ERR' AND (SELECT status::text FROM public.applications WHERE id = '00000000-0000-0000-0000-00000000cc08') = 'rejected');
SELECT public.t_val(:'fa', format($q$SELECT (public.accept_application('00000000-0000-0000-0000-00000000cc07', %L::jsonb)->>'shifts')$q$,
  jsonb_build_array(jsonb_build_object('starts_at', (now() + interval '9 days')::text, 'ends_at', (now() + interval '9 days 6 hours')::text))::text)) AS r628 \gset
SELECT public.t_eq('6b.28 y acepta con el horario que define: se crea la reserva', :'r628' || '/' || (SELECT count(*)::text FROM public.service_bookings WHERE client_id = :'fa' AND professional_id = :'pc'), '1/1');

-- ═══ Trust Score ══════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_mkfam('fT', 'Teresa Nieto', 'Bogotá', 4.7110, -74.0721) AS ft \gset
SELECT public.t_eq('7.1 una familia nueva, sin nada: 30, en construcción y sin datos suficientes', (SELECT score || '/' || level || '/' || enough_data || '/' || COALESCE(stars_avg::text, 'N') FROM public.hx_trust_calc(:'ft', 'family')), '30/building/false/N');
UPDATE public.family_profiles SET habeas_data_accepted = true, id_number = '1020304050', id_doc_url = 'https://example.test/doc.pdf', created_at = now() - interval '540 days' WHERE user_id = :'ft';
SET session_replication_role = replica;
INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) SELECT :'b2', w.id, :'ft', s FROM (VALUES ('pA', 4), ('pB', 4), ('pC', 4), ('pE', 5), ('pG', 4)) v(lbl, s) JOIN public.t_who w ON w.label = v.lbl;
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  SELECT :'ft', :'p1', 'completed', now() - (n * interval '3 days'), 2, 20000, 40000 FROM generate_series(1, 4) n;
SET session_replication_role = origin;
SELECT public.t_eq('7.2 identidad (15) + antigüedad (5) + 5 estrellas de 4,2 (28) + 4 servicios (6) = 84, nivel alto',
  (SELECT score || '/' || level || '/' || enough_data || '/' || verified || '/' || stars_avg || '/' || ratings_count || '/' || completed_services || '/' || (components = '{"base": 30, "ratings": 28, "services": 6, "identity": 15, "seniority": 5, "adjustments": 0}'::jsonb) FROM public.hx_trust_calc(:'ft', 'family')),
  '84/high/true/true/4.20/5/4/true');
SELECT public.t_mkfam('fT2', 'Dos Estrellas', 'Bogotá', 4.7110, -74.0721) AS ft2 \gset
SET session_replication_role = replica;
INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) VALUES (:'b4', :'pa', :'ft2', 5), (:'b4', :'pb', :'ft2', 5);
SET session_replication_role = origin;
SELECT public.t_eq('7.3 con menos de 3 calificaciones las estrellas no cuentan (ni suben ni bajan) y se dice que faltan datos', (SELECT score || '/' || enough_data || '/' || COALESCE(stars_avg::text, 'N') || '/' || ratings_count FROM public.hx_trust_calc(:'ft2', 'family')), '30/false/N/2');
-- Alertas de fraude sin resolver: restan sin decir el motivo.
SELECT public.t_eq('7.4 sin la tabla de alertas de fraude el cálculo sigue (base nueva)', (SELECT score::text FROM public.hx_trust_calc(:'ft', 'family')), '84');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fraud_severity') THEN CREATE TYPE public.fraud_severity AS ENUM ('low', 'medium', 'high', 'critical'); END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, reason text NOT NULL, severity public.fraud_severity NOT NULL DEFAULT 'medium', meta jsonb, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.fraud_flags(user_id, reason, severity) VALUES (:'ft', 'documento sospechoso', 'high');
SELECT public.t_eq('7.5 una alerta alta sin resolver resta 20: 64, nivel medio', (SELECT score || '/' || level FROM public.hx_trust_calc(:'ft', 'family')), '64/medium');
INSERT INTO public.fraud_flags(user_id, reason, severity) VALUES (:'ft', 'a', 'low'), (:'ft', 'b', 'medium');
SELECT public.t_eq('7.6 baja (3) y media (8) también restan: 84 − 31 = 53', (SELECT score::text FROM public.hx_trust_calc(:'ft', 'family')), '53');
UPDATE public.fraud_flags SET resolved = true WHERE user_id = :'ft';
SELECT public.t_eq('7.7 resueltas, no restan', (SELECT score::text FROM public.hx_trust_calc(:'ft', 'family')), '84');
INSERT INTO public.fraud_flags(user_id, reason, severity) VALUES (:'ft', 'c', 'critical'), (:'ft', 'd', 'high');
SELECT public.t_eq('7.8 el castigo tiene tope de 50: 34, en construcción', (SELECT score || '/' || level FROM public.hx_trust_calc(:'ft', 'family')), '34/building');
UPDATE public.fraud_flags SET resolved = true WHERE user_id = :'ft';
-- Institución.
SELECT public.t_mkuser('iT', 'institution', 'Hospital Central', 'Bogotá') AS it \gset
INSERT INTO public.institution_profiles(user_id, institution_name, nit, verified, chamber_of_commerce_number, lat, lng, created_at) VALUES (:'it', 'Hospital Central', '800111222', true, 'CC-999', 4.7110, -74.0721, now() - interval '540 days');
SET session_replication_role = replica;
INSERT INTO public.service_ratings(booking_id, rater_id, rated_id, stars) SELECT :'b3', w.id, :'it', 5 FROM public.t_who w WHERE w.label IN ('pA', 'pB', 'pC');
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
  SELECT :'it', :'p2', 'completed', now() - (n * interval '3 days'), 2, 20000, 40000 FROM generate_series(1, 12) n;
SET session_replication_role = origin;
SELECT public.t_eq('7.9 una institución verificada, con NIT y cámara de comercio, 3 calificaciones de 5 y 12 servicios: 100, excelente (el tope de servicios es 10)',
  (SELECT score || '/' || level || '/' || verified || '/' || (components = '{"base": 30, "ratings": 35, "services": 15, "identity": 15, "seniority": 5, "adjustments": 0}'::jsonb) FROM public.hx_trust_calc(:'it', 'institution')), '100/excellent/true/true');
SELECT public.t_eq('7.10 una institución sin perfil de institución: 30', (SELECT score::text FROM public.hx_trust_calc(:'i2', 'institution')), '30');
-- Profesional.
SELECT public.t_eq('7.11 el del profesional es el de la validación con IA; sus estrellas, las de sus servicios', (SELECT score || '/' || level || '/' || source || '/' || verified || '/' || stars_avg || '/' || ratings_count FROM public.hx_trust_calc(:'pa')), '82/high/ai_validation/true/4.67/3');
SELECT public.t_eq('7.12 sin validar: sin número', (SELECT COALESCE(score::text, 'N') || '/' || level FROM public.hx_trust_calc(:'pg')), 'N/unrated');
SELECT public.t_eq('7.13 quien no tiene rol de familia, institución o profesional no tiene puntaje', (SELECT count(*)::text FROM public.hx_trust_calc(:'sa')) || '/' || (SELECT count(*)::text FROM public.hx_trust_calc(NULL)), '0/0');
-- Quién puede preguntar.
SELECT public.t_eq('7.14 una familia ve el suyo, con desglose', public.t_val(:'ft', format($q$SELECT score || '/' || (components IS NOT NULL) FROM public.get_trust_score(%L)$q$, :'ft')), '84/true');
SELECT public.t_err('7.15 …pero no el de otra familia', public.t_val(:'ft', format($q$SELECT score FROM public.get_trust_score(%L)$q$, :'f2')), 'No autorizado');
SELECT public.t_eq('7.16 …ni el de una institución', public.t_hint(:'ft', format($q$SELECT score FROM public.get_trust_score(%L)$q$, :'it')), '42501/');
SELECT public.t_eq('7.17 el de un profesional lo ve cualquier cuenta con sesión, sin desglose', public.t_val(:'ft', format($q$SELECT score || '/' || (components IS NULL) FROM public.get_trust_score(%L)$q$, :'pa')) || ' ' || public.t_val(:'i1', format($q$SELECT score FROM public.get_trust_score(%L)$q$, :'pa')), '82/true 82');
SELECT public.t_eq('7.18 un profesional ve el de la familia y el de la institución, sin desglose', public.t_val(:'pa', format($q$SELECT score || '/' || (components IS NULL) FROM public.get_trust_score(%L)$q$, :'ft')) || ' ' || public.t_val(:'pa', format($q$SELECT score || '/' || (components IS NULL) FROM public.get_trust_score(%L)$q$, :'it')), '84/true 100/true');
SELECT public.t_err('7.19 una institución no ve el de una familia', public.t_val(:'i1', format($q$SELECT score FROM public.get_trust_score(%L)$q$, :'ft')), 'No autorizado');
SELECT public.t_eq('7.20 el personal ve todo, con desglose', public.t_val(:'sa', format($q$SELECT score || '/' || (components IS NOT NULL) FROM public.get_trust_score(%L)$q$, :'ft')), '84/true');
SELECT public.t_true('7.21 sin sesión no hay Trust Score', public.t_anon(format($q$SELECT score FROM public.get_trust_score(%L)$q$, :'pa')) LIKE 'ERR[42501]%');
SELECT public.t_eq('7.22 de alguien inexistente no devuelve filas', public.t_val(:'pa', $q$SELECT count(*)::text FROM public.get_trust_score('00000000-0000-0000-0000-0000000000ee')$q$), '0');
INSERT INTO public.fraud_flags(user_id, reason, severity) VALUES (:'ft', 'e', 'high');
SELECT public.t_eq('7.23 un ajuste por alerta se ve en el desglose propio pero un tercero solo ve el puntaje', public.t_val(:'ft', format($q$SELECT (components->>'adjustments') FROM public.get_trust_score(%L)$q$, :'ft')) || '/' || public.t_val(:'pa', format($q$SELECT score || '/' || (components IS NULL) FROM public.get_trust_score(%L)$q$, :'ft')), '-20/64/true');
UPDATE public.fraud_flags SET resolved = true WHERE user_id = :'ft';

-- ═══ Listas del profesional ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_need(:'ft', 'Adulto mayor', 23000, 3) AS nt \gset
SELECT public.t_eq('8.1 la lista de necesidades trae el Trust Score de la familia y la cercanía por rangos',
  public.t_val(:'pa', format($q$SELECT family_trust || '/' || family_trust_level || '/' || family_trust_enough || '/' || family_verified || '/' || distance_band_km FROM public.list_open_family_needs() WHERE id = %L$q$, :'nt')), '84/high/true/true/2');
SELECT public.t_eq('8.2 …y lo anterior sigue igual (nombre abreviado, estrellas, servicios)',
  public.t_val(:'pa', format($q$SELECT display_name || '/' || family_stars || '/' || family_ratings || '/' || family_completed || '/' || already_applied FROM public.list_open_family_needs() WHERE id = %L$q$, :'nt')), 'Teresa N./4.20/5/4/false');
SELECT public.t_eq('8.3 una familia nueva sin datos: 30 y sin datos suficientes', public.t_val(:'pa', format($q$SELECT family_trust || '/' || family_trust_enough FROM public.list_open_family_needs() WHERE id = %L$q$, :'n8')), '30/false');
SELECT public.t_err('8.4 una familia no ve las necesidades de otras', public.t_val(:'f1', 'SELECT count(*) FROM public.list_open_family_needs()'), 'Solo los profesionales');
SELECT public.t_err('8.5 un profesional bloqueado tampoco', public.t_val(:'pd', 'SELECT count(*) FROM public.list_open_family_needs()'), 'en revisión');
SELECT public.t_true('8.6 sin sesión no se llama', public.t_anon('SELECT count(*) FROM public.list_open_family_needs()') LIKE 'ERR[42501]%');
SELECT public.t_val(:'it', $q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, status) VALUES (auth.uid(), 'institution', 'Enfermera jefe urgencias', 'Turno rotativo', 'hour', 32000, 'Bogotá', 'open') RETURNING id::text$q$) AS oit \gset
SELECT public.t_eq('8.7 la lista de ofertas de instituciones trae su Trust Score y la cercanía',
  public.t_val(:'pa', format($q$SELECT institution_trust || '/' || institution_trust_level || '/' || institution_trust_enough || '/' || distance_band_km || '/' || institution_name || '/' || rating_count || '/' || rating_avg || '/' || completed_services FROM public.list_open_institution_offers() WHERE offer_id = %L$q$, :'oit')),
  '100/excellent/true/2/Hospital Central/3/5.00/12');
SELECT public.t_eq('8.8 una institución verificada pero sin historial: 30 + 15 de identidad + 5 de antigüedad = 50, sin datos suficientes', public.t_val(:'pa', format($q$SELECT institution_trust || '/' || institution_trust_enough FROM public.list_open_institution_offers() WHERE offer_id = %L$q$, :'o1')), '50/false');
SELECT public.t_err('8.9 solo los profesionales ven ofertas de instituciones', public.t_val(:'f1', 'SELECT count(*) FROM public.list_open_institution_offers()'), 'No autorizado');
SELECT public.t_true('8.10 sin sesión no se llama', public.t_anon('SELECT count(*) FROM public.list_open_institution_offers()') LIKE 'ERR[42501]%');

-- Ofertas de trabajo de familias, vistas por el profesional.
SET session_replication_role = replica;
INSERT INTO public.job_offers(id, posted_by, poster_type, title, description, modality, amount, city, status, start_date, end_date, created_at) VALUES
  ('00000000-0000-0000-0000-00000000dd01', :'ft', 'family', 'Acompañamiento nocturno', 'Adulto mayor con Alzheimer. Escribe al 300 123 4567 o a ana@correo.com', 'hour', 20000, 'Bogotá', 'open', now() + interval '12 days', now() + interval '12 days 8 hours', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000dd02', :'ft', 'family', 'Oferta bloqueada de familia', 'x', 'hour', 20000, 'Bogotá', 'open', now() + interval '12 days', now() + interval '12 days 8 hours', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-00000000dd03', :'ft', 'family', 'Oferta de familia cerrada', 'x', 'hour', 20000, 'Bogotá', 'closed', now() + interval '12 days', now() + interval '12 days 8 hours', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-00000000dd04', :'ft', 'family', 'Oferta de familia vencida', 'x', 'hour', 20000, 'Bogotá', 'open', now() - interval '3 days', now() - interval '2 days', now() - interval '4 hours');
UPDATE public.job_offers SET blocked = true WHERE id = '00000000-0000-0000-0000-00000000dd02';
INSERT INTO public.applications(job_offer_id, professional_id, status, posted_amount, proposed_amount) VALUES ('00000000-0000-0000-0000-00000000dd01', :'pa', 'pending', 20000, 20000);
SET session_replication_role = origin;
SELECT public.t_eq('8.11 la lista de ofertas de familias trae solo las abiertas, vigentes y no bloqueadas, con quién ofrece abreviado y su Trust Score',
  public.t_val(:'pa', format($q$SELECT count(*) FILTER (WHERE offer_id = %L)::text || '/' || max(display_name) || '/' || max(family_trust) || '/' || max(family_trust_level) || '/' || bool_or(family_trust_enough) || '/' || bool_or(family_verified) FROM public.list_open_family_offers() WHERE family_user_id = %L$q$, '00000000-0000-0000-0000-00000000dd01', :'ft')), '1/Teresa N./84/high/true/true');
SELECT public.t_eq('8.12 …y nada más de esa familia (bloqueada, cerrada y vencida quedan fuera)', public.t_val(:'pa', format($q$SELECT count(*)::text FROM public.list_open_family_offers() WHERE family_user_id = %L$q$, :'ft')), '1');
SELECT public.t_eq('8.13 el teléfono y el correo del texto no viajan', (public.t_val(:'pa', $q$SELECT description FROM public.list_open_family_offers() WHERE offer_id = '00000000-0000-0000-0000-00000000dd01'$q$) !~ '300 123|ana@correo')::text, 'true');
SELECT public.t_eq('8.14 cercanía, estrellas y la postulación propia',
  public.t_val(:'pa', $q$SELECT distance_band_km || '/' || family_stars || '/' || family_ratings || '/' || family_completed || '/' || my_status FROM public.list_open_family_offers() WHERE offer_id = '00000000-0000-0000-0000-00000000dd01'$q$), '2/4.20/5/4/pending');
SELECT public.t_eq('8.15 las ofertas de instituciones no aparecen aquí', public.t_val(:'pa', $q$SELECT count(*)::text FROM public.list_open_family_offers() WHERE title = 'Auxiliar de enfermería turno noche'$q$), '0');
SELECT public.t_err('8.16 una familia no ve las ofertas de otras', public.t_val(:'f1', 'SELECT count(*) FROM public.list_open_family_offers()'), 'Solo los profesionales');
SELECT public.t_err('8.17 un profesional bloqueado tampoco', public.t_val(:'pd', 'SELECT count(*) FROM public.list_open_family_offers()'), 'en revisión');
SELECT public.t_true('8.18 sin sesión no se llama', public.t_anon('SELECT count(*) FROM public.list_open_family_offers()') LIKE 'ERR[42501]%');

-- ═══ Estabilidad ══════════════════════════════════════════════════════════════════════════════════════════════
SELECT count(*)::text AS n_rev FROM public.applicant_contact_reveals \gset
SELECT md5(string_agg(proname || pg_get_functiondef(oid) || COALESCE(proacl::text, ''), '|' ORDER BY proname || pg_get_function_identity_arguments(oid))) AS sig_fn
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('hx_distance_km', 'hx_distance_band', 'hx_trust_level', 'hx_pro_label', 'hx_trust_calc', 'get_trust_score', 'hx_notify_nearby_professionals', 'trg_family_need_notify_pros',
                   'trg_job_offer_notify_pros', 'counter_slot_proposal', 'my_slot_proposals', 'reveal_applicant_contact', 'family_applicants', 'list_open_family_needs', 'list_open_institution_offers',
                   'counter_application', 'hx_reveal_pro_contact', 'reveal_application_contact', 'family_offer_applicants', 'list_open_family_offers') \gset
SELECT (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgname LIKE 'trg\_%\_notify\_pros' ESCAPE '\') AS sig_trg,
       (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'applicant_contact_reveals') AS sig_pol,
       (SELECT md5(string_agg(c.relname || COALESCE(c.relacl::text, ''), '|' ORDER BY c.relname)) FROM pg_class c WHERE c.relname IN ('offer_notify_log', 'applicant_contact_reveals') AND c.relnamespace = 'public'::regnamespace) AS sig_acl \gset
\i :M2
SELECT public.t_eq('9.1 la segunda pasada no cambia las funciones ni sus permisos', (SELECT md5(string_agg(proname || pg_get_functiondef(oid) || COALESCE(proacl::text, ''), '|' ORDER BY proname || pg_get_function_identity_arguments(oid)))
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('hx_distance_km', 'hx_distance_band', 'hx_trust_level', 'hx_pro_label', 'hx_trust_calc', 'get_trust_score', 'hx_notify_nearby_professionals', 'trg_family_need_notify_pros',
                   'trg_job_offer_notify_pros', 'counter_slot_proposal', 'my_slot_proposals', 'reveal_applicant_contact', 'family_applicants', 'list_open_family_needs', 'list_open_institution_offers',
                   'counter_application', 'hx_reveal_pro_contact', 'reveal_application_contact', 'family_offer_applicants', 'list_open_family_offers')), :'sig_fn');
SELECT public.t_eq('9.2 ni los disparadores', (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgname LIKE 'trg\_%\_notify\_pros' ESCAPE '\'), :'sig_trg');
SELECT public.t_eq('9.3 ni las políticas', (SELECT md5(string_agg(policyname || cmd || COALESCE(qual, ''), '|' ORDER BY policyname)) FROM pg_policies WHERE tablename = 'applicant_contact_reveals'), :'sig_pol');
SELECT public.t_eq('9.4 ni los privilegios de las tablas nuevas', (SELECT md5(string_agg(c.relname || COALESCE(c.relacl::text, ''), '|' ORDER BY c.relname)) FROM pg_class c WHERE c.relname IN ('offer_notify_log', 'applicant_contact_reveals') AND c.relnamespace = 'public'::regnamespace), :'sig_acl');
SELECT public.t_eq('9.5 los datos siguen donde estaban', (SELECT count(*)::text FROM public.applicant_contact_reveals), :'n_rev');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
