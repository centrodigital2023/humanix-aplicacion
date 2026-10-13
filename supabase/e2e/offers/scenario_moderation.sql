-- Escenario — moderación de ofertas sobre la réplica de producción.
-- Variables: M1 (20261012180000_offer_moderation.sql), HELPERS (../clinical_scope/helpers.sql)
\i :HELPERS

-- Texto que NO debería publicarse (pero hoy se publica).
CREATE FUNCTION public.t_su(q text) RETURNS text LANGUAGE plpgsql AS $$ DECLARE v text; BEGIN EXECUTE q INTO v; RETURN COALESCE(v, 'NULL'); EXCEPTION WHEN OTHERS THEN RETURN 'ERR[' || SQLSTATE || '] ' || SQLERRM; END $$;
CREATE FUNCTION public.ins_need(u uuid, care_type text, notes text) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_val(u, format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type, notes) VALUES (%L, now() + interval '2 days', now() + interval '2 days 1 hour', 15000, 'open', %L, %L) RETURNING 'OK'$q$, u, care_type, notes)) $$;
CREATE FUNCTION public.ins_offer(u uuid, ptype text, title text, descr text, spec text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_val(u, format($q$INSERT INTO public.job_offers(posted_by, poster_type, title, description, modality, amount, city, specialty_required, status) VALUES (%L, %L, %L, %L, 'hour', 20000, 'Bogotá', %L, 'open') RETURNING 'OK'$q$, u, ptype, title, descr, spec)) $$;
CREATE FUNCTION public.ins_slot(u uuid, note text) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_val(u, format($q$INSERT INTO public.availability_slots(user_id, starts_at, ends_at, status, note) VALUES (%L, now() + interval '3 days', now() + interval '3 days 1 hour', 'free', %L) RETURNING 'OK'$q$, u, note)) $$;

-- Código y pista del error (t_val solo devuelve el mensaje).
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

INSERT INTO public.profiles(user_id, full_name) VALUES (:'f1', 'Ana Gómez'), (:'p1', 'Pedro Pérez');
INSERT INTO public.professional_profiles(user_id) VALUES (:'p1');

-- ═══ ANTES (producción hoy) ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('0.1 antes: una familia publica una necesidad con lenguaje ofensivo', public.ins_need(:'f1', 'Adulto mayor', 'Hijueputa'), 'OK');
SELECT public.t_eq('0.2 antes: o con una venta de artículos', public.ins_need(:'f1', 'Vendo zapatos', NULL), 'OK');
SELECT public.t_eq('0.3 antes: o ajena al cuidado', public.ins_need(:'f1', 'Plomería', 'Arreglar el baño'), 'OK');
SELECT public.t_eq('0.4 antes: una familia publica una oferta de trabajo que no es de salud', public.ins_offer(:'f1', 'family', 'Se necesita plomero', 'Para arreglar un baño'), 'OK');
SELECT public.t_eq('0.5 antes: un profesional deja en su presentación un teléfono y una venta', public.t_val(:'p1', format($q$UPDATE public.professional_profiles SET bio = 'Vendo cosas, llama al 300 123 4567' WHERE user_id = %L RETURNING 'OK'$q$, :'p1')), 'OK');
DELETE FROM public.family_needs; DELETE FROM public.job_offers;
UPDATE public.professional_profiles SET bio = NULL;

\i :M1

-- ═══ Normalización ════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('1.1 sin tildes ni ñ, en minúsculas', public.hx_text_norm('  ¡¡ÁÉÍÓÚ Ñandú!! Acompañamiento 24/7 '), 'aeiou nandu acompanamiento 24 7');
SELECT public.t_eq('1.2 letras repetidas tres o más veces se reducen a una; dos se respetan', public.hx_text_norm('puuuuta mierdaaaa calle casa'), 'puta mierda calle casa');
SELECT public.t_eq('1.3 nulo y vacío', public.hx_text_norm(NULL) || '|' || public.hx_text_norm(''), '|');

-- ═══ El juez del texto ════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('2.1 ofensivo', public.hx_offer_text_issue('Eres una puta basura') || public.hx_offer_text_issue('HIJUEPUTAAAA') || public.hx_offer_text_issue('Servicios eróticos') || public.hx_offer_text_issue('Servicios sexuales a domicilio'), 'ruderuderuderude');
SELECT public.t_eq('2.2 «computadora» no es «puta»', coalesce(public.hx_offer_text_issue('Necesito una computadora para mi mamá'), 'ok'), 'ok');
SELECT public.t_eq('2.3 venta, compra y alquiler', public.hx_offer_text_issue('Vendo silla de ruedas') || '/' || public.hx_offer_text_issue('Se arrienda apartamento') || '/' || public.hx_offer_text_issue('Distribuimos artículos de aseo'), 'sale/sale/sale');
SELECT public.t_eq('2.4 artículos de aseo personal NO es una venta', coalesce(public.hx_offer_text_issue('El cuidador debe traer sus artículos de aseo personal'), 'ok'), 'ok');
SELECT public.t_eq('2.5 «promoción de la salud» no es una promoción comercial', coalesce(public.hx_offer_text_issue('Promoción de la salud en casa'), 'ok'), 'ok');
SELECT public.t_eq('2.6 salud y cuidado pasan cuando se exige', coalesce(public.hx_offer_text_issue('Acompañamiento de adulto mayor', true), 'ok') || '/' || coalesce(public.hx_offer_text_issue('Turno en la EPS', true), 'ok') || '/' || coalesce(public.hx_offer_text_issue('Curaciones y toma de signos vitales', true), 'ok'), 'ok/ok/ok');
SELECT public.t_eq('2.7 lo ajeno se rechaza solo cuando se exige', coalesce(public.hx_offer_text_issue('Clases de guitarra'), 'ok') || '/' || public.hx_offer_text_issue('Clases de guitarra', true), 'ok/offtopic');
SELECT public.t_eq('2.8 vacío no es ajeno a nada', coalesce(public.hx_offer_text_issue('', true), 'ok') || '/' || coalesce(public.hx_offer_text_issue(NULL, true), 'ok'), 'ok/ok');
SELECT public.t_eq('2.9 lo ofensivo y la venta van antes que lo ajeno', public.hx_offer_text_issue('Vendo cosas de mierda', true) || '/' || public.hx_offer_text_issue('Vendo una silla', true), 'rude/sale');

-- ═══ Necesidades de las familias ══════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('3.1 una necesidad de cuidado normal se publica', public.ins_need(:'f1', 'Adulto mayor', 'Ayuda con medicinas y acompañamiento'), 'OK');
SELECT public.t_eq('3.2 sin tipo ni nota también', public.ins_need(:'f1', NULL, NULL), 'OK');
SELECT public.t_err('3.3 con lenguaje ofensivo no', public.ins_need(:'f1', 'Adulto mayor', 'Hijueputa'), 'lenguaje ofensivo');
SELECT public.t_err('3.4 vender artículos no', public.ins_need(:'f1', 'Vendo zapatos', NULL), 'artículos');
SELECT public.t_err('3.5 ajena al cuidado no', public.ins_need(:'f1', 'Plomería', 'Arreglar el baño'), 'salud o cuidado');
SELECT public.t_err('3.6 con un teléfono no', public.ins_need(:'f1', 'Adulto mayor', 'Llámame al 300 123 4567'), 'teléfonos');
SELECT public.t_err('3.7 ni un correo', public.ins_need(:'f1', 'Adulto mayor', 'escríbeme a ana@correo.com'), 'teléfonos');
SELECT public.t_eq('3.8 la pista del error dice el motivo: ofensivo / venta / ajeno / contacto', public.t_hint(:'f1', format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now(), now() + interval '1 hour', 1, 'open', 'puta')$q$, :'f1')) || ' ' || public.t_hint(:'f1', format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now(), now() + interval '1 hour', 1, 'open', 'vendo zapatos')$q$, :'f1')) || ' ' || public.t_hint(:'f1', format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type) VALUES (%L, now(), now() + interval '1 hour', 1, 'open', 'clases de guitarra')$q$, :'f1')) || ' ' || public.t_hint(:'f1', format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type, notes) VALUES (%L, now(), now() + interval '1 hour', 1, 'open', 'adulto mayor', 'ana@correo.com')$q$, :'f1')), '23514/offer_rude 23514/offer_sale 23514/offer_offtopic 23514/offer_contact');
SELECT public.t_eq('3.9 el texto de las dos columnas se mira junto: el tipo de cuidado sostiene una nota genérica', public.ins_need(:'f1', 'Enfermería', 'turno de noche'), 'OK');
-- Solo lo que cambia
INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type, notes) VALUES (:'f2', now() + interval '5 days', now() + interval '5 days 1 hour', 15000, 'open', 'Plomería', 'texto antiguo que hoy no pasaría') RETURNING id AS old_need \gset
SELECT public.t_eq('3.10 una fila antigua puede actualizar otras columnas', public.t_val(:'f2', format($q$UPDATE public.family_needs SET hourly_rate = 16000 WHERE id = %L RETURNING 'OK'$q$, :'old_need')), 'OK');
SELECT public.t_eq('3.10b …aunque el cliente reenvíe las columnas de texto sin cambiarlas', public.t_val(:'f2', format($q$UPDATE public.family_needs SET care_type = care_type, notes = notes, hourly_rate = 17000 WHERE id = %L RETURNING 'OK'$q$, :'old_need')), 'OK');
SELECT public.t_err('3.11 pero no su texto, salvo que lo arregle', public.t_val(:'f2', format($q$UPDATE public.family_needs SET notes = 'vendo zapatos' WHERE id = %L RETURNING 'OK'$q$, :'old_need')), 'artículos');
SELECT public.t_eq('3.12 y lo arregla', public.t_val(:'f2', format($q$UPDATE public.family_needs SET care_type = 'Adulto mayor', notes = 'acompañamiento' WHERE id = %L RETURNING 'OK'$q$, :'old_need')), 'OK');
SELECT public.t_err('3.12b cambiar solo el tipo de cuidado también se revisa', public.t_val(:'f2', format($q$UPDATE public.family_needs SET care_type = 'vendo zapatos' WHERE id = %L RETURNING 'OK'$q$, :'old_need')), 'artículos');
SELECT public.t_eq('3.13 el servidor (sin sesión) no se bloquea', public.t_su(format($q$INSERT INTO public.family_needs(family_user_id, starts_at, ends_at, hourly_rate, status, care_type, notes) VALUES (%L, now(), now() + interval '1 hour', 1, 'open', 'Plomería', 'mierda') RETURNING 'OK'$q$, :'f2')), 'OK');

-- ═══ Ofertas de trabajo ═══════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('4.1 una familia publica una oferta de cuidado', public.ins_offer(:'f1', 'family', 'Cuidadora para adulto mayor', 'Turnos de noche'), 'OK');
SELECT public.t_err('4.2 de la familia, ajena al cuidado: no', public.ins_offer(:'f1', 'family', 'Se necesita plomero', 'Para arreglar un baño'), 'salud o cuidado');
SELECT public.t_err('4.3 de la familia, con venta: no', public.ins_offer(:'f1', 'family', 'Cuidadora', 'Vendo una cama hospitalaria'), 'artículos');
SELECT public.t_err('4.4 ofensiva: no', public.ins_offer(:'f1', 'family', 'Enfermera', 'no quiero a ninguna malparida'), 'lenguaje ofensivo');
SELECT public.t_eq('4.5 una institución publica «Turno nocturno» sin más (es una IPS: no se exige el tema)', public.ins_offer(:'i1', 'institution', 'Turno nocturno 12 h', 'Sede norte'), 'OK');
SELECT public.t_err('4.6 pero ni ella puede ofender', public.ins_offer(:'i1', 'institution', 'Turno nocturno', 'gente idiota no'), 'lenguaje ofensivo');
SELECT public.t_err('4.7 ni vender', public.ins_offer(:'i1', 'institution', 'Turno nocturno', 'se vende dotación'), 'artículos');
SELECT public.t_eq('4.8 la descripción de una institución puede llevar un teléfono (no se revisa el contacto)', public.ins_offer(:'i1', 'institution', 'Auxiliar de enfermería', 'Contacto: 601 555 1234'), 'OK');
SELECT public.t_eq('4.9 la especialidad requerida cuenta como texto de cuidado en la oferta de una familia', public.ins_offer(:'f1', 'family', 'Se necesita ayuda', 'por las noches', 'Auxiliar de enfermería'), 'OK');

-- ═══ Disponibilidad y presentación del profesional ════════════════════════════════════════════════════════════
SELECT public.t_eq('5.1 el profesional publica su disponibilidad con una nota normal', public.ins_slot(:'p1', 'Disponible para turnos de noche en el norte'), 'OK');
SELECT public.t_err('5.2 con una venta no', public.ins_slot(:'p1', 'Vendo productos de belleza'), 'artículos');
SELECT public.t_err('5.3 con su teléfono no', public.ins_slot(:'p1', 'Llámame al 300 123 4567'), 'teléfonos');
SELECT public.t_err('5.4 ofensiva no', public.ins_slot(:'p1', 'puta vida'), 'lenguaje ofensivo');
SELECT public.t_eq('5.5 una disponibilidad sin nota es normal', public.ins_slot(:'p1', NULL), 'OK');
SELECT public.t_eq('5.6 la presentación del profesional normal pasa', public.t_val(:'p1', format($q$UPDATE public.professional_profiles SET bio = 'Enfermera jefe con 10 años de experiencia' WHERE user_id = %L RETURNING 'OK'$q$, :'p1')), 'OK');
SELECT public.t_err('5.7 con venta no', public.t_val(:'p1', format($q$UPDATE public.professional_profiles SET bio = 'Vendo suplementos' WHERE user_id = %L RETURNING 'OK'$q$, :'p1')), 'artículos');
SELECT public.t_err('5.8 con un enlace tampoco', public.t_val(:'p1', format($q$UPDATE public.professional_profiles SET bio = 'Mi página: www.mipagina.com' WHERE user_id = %L RETURNING 'OK'$q$, :'p1')), 'teléfonos');
SELECT public.t_eq('5.9 cambiar otra columna del perfil no vuelve a juzgar la presentación', public.t_val(:'p1', format($q$UPDATE public.professional_profiles SET hourly_rate = 25000 WHERE user_id = %L RETURNING 'OK'$q$, :'p1')), 'OK');
SELECT public.t_eq('5.10 la presentación general (profiles.bio) de cualquier usuario sigue las mismas reglas: normal pasa', public.t_val(:'f1', format($q$UPDATE public.profiles SET bio = 'Familia de Bogotá' WHERE user_id = %L RETURNING 'OK'$q$, :'f1')), 'OK');
SELECT public.t_err('5.11 …y una venta no', public.t_val(:'f1', format($q$UPDATE public.profiles SET bio = 'Vendo mi carro' WHERE user_id = %L RETURNING 'OK'$q$, :'f1')), 'artículos');

-- ═══ Seguridad y estabilidad ══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('6.1 el disparador no se llama desde la API', NOT has_function_privilege('authenticated', 'public.hx_offer_guard()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hx_offer_guard()', 'EXECUTE'));
SELECT public.t_eq('6.2 hay un disparador en cada tabla', public.q1($$SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'trg\_%\_moderation' ESCAPE '\'$$), 'availability_slots,family_needs,job_offers,professional_profiles,profiles');
SELECT public.t_eq('6.3 el superadmin al bloquear una oferta (otra columna) no se frena por el texto antiguo', public.t_su(format($q$UPDATE public.job_offers SET blocked = true, blocked_reason = 'revisión' WHERE posted_by = %L RETURNING 'OK'$q$, :'i1')), 'OK');
SELECT md5(string_agg(proname || pg_get_functiondef(oid), '|' ORDER BY proname)) AS sig_fn, (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgname LIKE 'trg\_%\_moderation' ESCAPE '\') AS sig_trg
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('hx_text_norm', 'hx_offer_text_issue', 'hx_offer_guard') \gset
\i :M1
SELECT public.t_eq('6.4 la segunda pasada no cambia las funciones', (SELECT md5(string_agg(proname || pg_get_functiondef(oid), '|' ORDER BY proname)) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('hx_text_norm', 'hx_offer_text_issue', 'hx_offer_guard')), :'sig_fn');
SELECT public.t_eq('6.5 ni los disparadores', (SELECT md5(string_agg(tgname || pg_get_triggerdef(oid), '|' ORDER BY tgname)) FROM pg_trigger WHERE tgname LIKE 'trg\_%\_moderation' ESCAPE '\'), :'sig_trg');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
