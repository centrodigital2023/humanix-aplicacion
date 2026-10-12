\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- Ayudantes comunes de los escenarios de «datos clínicos por servicio». Cada comprobación se guarda en public._t.

CREATE TABLE public._t (n serial, ok boolean, name text, detail text);

-- Ejecuta una consulta como un rol de la API (authenticated / anon) con una sesión simulada (auth.uid()).
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

-- Cuántas filas de cada tabla clínica ve una cuenta. Una tabla que no existe en el entorno cuenta «-».
CREATE FUNCTION public.t_counts(u uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  parts text := '';
  spec  text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['alertas','clinical_alerts'],['partes','service_checkins'],['vitales','vital_signs'],
    ['umbrales','alert_thresholds'],['riesgo','patient_risk_scores'],['informes','clinical_reports']]
  LOOP
    parts := parts || CASE WHEN parts = '' THEN '' ELSE ' ' END || spec[1] || '=' ||
      CASE WHEN to_regclass('public.' || spec[2]) IS NULL THEN '-'
           ELSE public.t_val(u, 'SELECT count(*)::text FROM public.' || spec[2]) END;
  END LOOP;
  RETURN parts;
END $$;

-- Huella de las políticas y de los privilegios de las tablas clínicas (para comprobar que algo no cambió).
CREATE FUNCTION public.t_sig_policies() RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(md5(string_agg(tablename || '.' || policyname || '.' || cmd || '.' || COALESCE(qual,'') || '.' || COALESCE(with_check,'') || '.' || array_to_string(roles, ','), '|' ORDER BY tablename, policyname)), 'vacío')
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports') $$;
CREATE FUNCTION public.t_sig_acl() RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(md5(string_agg(c.relname || ':' || COALESCE(c.relacl::text, ''), '|' ORDER BY c.relname)), 'vacío')
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('vital_signs','alert_thresholds','clinical_alerts','service_checkins','patient_risk_scores','clinical_reports','eps_dashboard_metrics') $$;

-- Cuentas de la prueba.
\set f1 '00000000-0000-0000-0000-0000000000f1'
\set f2 '00000000-0000-0000-0000-0000000000f2'
\set p1 '00000000-0000-0000-0000-0000000000a1'
\set p2 '00000000-0000-0000-0000-0000000000a2'
\set i1 '00000000-0000-0000-0000-0000000000b1'
\set i2 '00000000-0000-0000-0000-0000000000b2'
\set t3 '00000000-0000-0000-0000-0000000000c3'
\set t4 '00000000-0000-0000-0000-0000000000c4'
\set sa '00000000-0000-0000-0000-00000000005a'
\set hr '00000000-0000-0000-0000-00000000005b'
\set ev '00000000-0000-0000-0000-00000000005c'

INSERT INTO auth.users(id, email) VALUES
  (:'f1','f1@t.co'),(:'f2','f2@t.co'),(:'p1','p1@t.co'),(:'p2','p2@t.co'),(:'i1','i1@t.co'),(:'i2','i2@t.co'),
  (:'t3','t3@t.co'),(:'t4','t4@t.co'),(:'sa','sa@t.co'),(:'hr','hr@t.co'),(:'ev','ev@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES
  (:'f1','family'),(:'f2','family'),(:'p1','professional'),(:'p2','professional'),(:'i1','institution'),(:'i2','institution'),
  (:'sa','superadmin'),(:'hr','hr_staff'),(:'ev','evaluator');

-- Cuatro servicios: B1 (familia 1 ↔ profesional 1), B2 (familia 2 ↔ profesional 2),
-- B3 (institución 1 ↔ profesional 1, paciente t3), B4 (institución 2 ↔ profesional 2, paciente t4).
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f1', :'p1', 'confirmed', now() + interval '1 day',  4, 20000, 80000) RETURNING id AS b1 \gset
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'f2', :'p2', 'confirmed', now() + interval '2 days', 4, 20000, 80000) RETURNING id AS b2 \gset
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'i1', :'p1', 'confirmed', now() + interval '3 days', 4, 20000, 80000) RETURNING id AS b3 \gset
INSERT INTO public.service_bookings(client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate, total_amount)
VALUES (:'i2', :'p2', 'confirmed', now() + interval '4 days', 4, 20000, 80000) RETURNING id AS b4 \gset
