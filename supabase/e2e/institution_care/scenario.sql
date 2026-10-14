-- Escenario — Pacientes y monitoreo clínico de la institución. Sobre la réplica de producción con lo anterior ya aplicado (incluido el
-- personal de la institución), como llegará a producción.
-- Variables: MIG (20261014100000_institution_care_core.sql), HELPERS (../clinical_scope/helpers.sql), VECTORS (news2_vectors.json)
\i :HELPERS

-- ── Ayudantes de este escenario ─────────────────────────────────────────────────────────────────────────────────
-- Ejecuta una consulta como un rol de la API y devuelve el valor, o «ERR[código|pista] mensaje» si falló.
CREATE FUNCTION public.t_call(u uuid, r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; h text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt INTO v; v := COALESCE(v, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS h = PG_EXCEPTION_HINT;
    v := 'ERR[' || SQLSTATE || '|' || COALESCE(h, '') || '] ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v;
END $$;
-- Ejecuta como superusuario (sin sesión) y devuelve «ok» o el error (para probar disparadores y restricciones).
CREATE FUNCTION public.t_sys(stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; h text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    EXECUTE stmt; v := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS h = PG_EXCEPTION_HINT;
    v := 'ERR[' || SQLSTATE || '|' || COALESCE(h, '') || '] ' || SQLERRM;
  END;
  RETURN v;
END $$;
-- Un campo de un resultado JSON (o «NOTJSON:…» si lo que llegó fue un error).
CREATE FUNCTION public.jget(res text, VARIADIC path text[]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN RETURN (res::jsonb) #>> path; EXCEPTION WHEN OTHERS THEN RETURN 'NOTJSON:' || left(res, 160); END $$;
-- Crea un paciente como la cuenta u; devuelve su id o el error.
CREATE FUNCTION public.t_pat(u uuid, data text, monitor boolean DEFAULT false, consent boolean DEFAULT true, kase text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  r := public.t_call(u, 'authenticated', format('SELECT public.inst_patient_create(%L::jsonb, %L::boolean, %L::boolean, %L::jsonb)::text',
                                                  data, consent, monitor, kase));
  RETURN CASE WHEN r LIKE 'ERR%' THEN r ELSE public.jget(r, 'patient', 'id') END;
END $$;
-- Registra signos vitales como la cuenta u.
CREATE FUNCTION public.t_vit(u uuid, pid text, data text) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_call(u, 'authenticated', format('SELECT public.inst_vitals_record(%L::uuid, %L::jsonb)::text', pid, data)) $$;
-- Llama una función con una expresión ya escrita, como la cuenta u.
CREATE FUNCTION public.t_rpc(u uuid, expr text) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_call(u, 'authenticated', 'SELECT (' || expr || ')::text') $$;
-- Un dispositivo (sin sesión) envía una lectura.
CREATE FUNCTION public.t_ing(code text, reading text) RETURNS text LANGUAGE sql AS $$
  SELECT public.t_call(NULL, 'anon', format('SELECT public.inst_device_ingest(%L, %L::jsonb)::text', code, reading)) $$;
CREATE FUNCTION public.t_n(q text) RETURNS text LANGUAGE plpgsql AS $$ DECLARE r text; BEGIN EXECUTE q INTO r; RETURN COALESCE(r, 'NULL'); END $$;

\set i3 '00000000-0000-0000-0000-0000000000b3'
\set i4 '00000000-0000-0000-0000-0000000000b4'
\set i5 '00000000-0000-0000-0000-0000000000b5'
\set i6 '00000000-0000-0000-0000-0000000000b6'
\set m1 '00000000-0000-0000-0000-0000000000e1'
\set m2 '00000000-0000-0000-0000-0000000000e2'
\set m3 '00000000-0000-0000-0000-0000000000e3'
\set m4 '00000000-0000-0000-0000-0000000000e4'
\set m5 '00000000-0000-0000-0000-0000000000e5'
\set m6 '00000000-0000-0000-0000-0000000000e6'

-- Cuentas: i3 sin plan (Free); i4, i5 e i6 con IPS Mejorado; el personal lo crea el servidor con la marca de personal.
INSERT INTO auth.users(id, email) VALUES (:'i3','i3@t.co'), (:'i4','i4@t.co'), (:'i5','i5@t.co'), (:'i6','i6@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES (:'i3','institution'), (:'i4','institution'), (:'i5','institution'), (:'i6','institution')
  ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (:'m1','staff.m1@humanix.lat','{"signup_kind":"institution_staff"}'), (:'m2','staff.m2@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m3','staff.m3@humanix.lat','{"signup_kind":"institution_staff"}'), (:'m4','staff.m4@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m5','staff.m5@humanix.lat','{"signup_kind":"institution_staff"}'), (:'m6','staff.m6@humanix.lat','{"signup_kind":"institution_staff"}');

SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city, phone) VALUES
  (:'i1','Clínica Norte','Bogotá','6011111111'), (:'i2','Hospital Sur','Medellín','6042222222'), (:'i3','Centro Libre','Cali','6023333333'),
  (:'i4','Clínica Premium','Bogotá','6014444444'), (:'i5','Clínica Efímera','Bogotá','6015555555'), (:'i6','Clínica Cifras','Bogotá','6016666666'),
  (:'p1','Laura Gómez Pérez','Bogotá','3001110001'), (:'p2','Camilo Ríos Soto','Bogotá','3001110002'), (:'f1','Ana Gómez','Bogotá','3101111111'),
  (:'m1','Marta Pacientes',NULL,NULL), (:'m2','Jorge Monitoreo',NULL,NULL), (:'m3','Sara Ofertas',NULL,NULL), (:'m4','Luis Suspendido',NULL,NULL),
  (:'m5','Elena Otra Institución',NULL,NULL), (:'m6','Rosa Premium',NULL,NULL)
  ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, city) VALUES
  (:'i3','Centro Libre','IPS','Cali'), (:'i4','Clínica Premium','Clínica','Bogotá'), (:'i5','Clínica Efímera','Clínica','Bogotá'),
  (:'i6','Clínica Cifras','Hospital','Bogotá')
  ON CONFLICT (user_id) DO NOTHING;
SET session_replication_role = origin;
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES
  (:'i1','institution_monthly','active', now() + interval '20 days'), (:'i2','institution_monthly','active', now() + interval '20 days'),
  (:'i4','institution_monthly','active', now() + interval '20 days'), (:'i5','institution_monthly','active', now() + interval '20 days'),
  (:'i6','institution_monthly','active', now() + interval '20 days');
INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules, status) VALUES
  (:'i1', :'m1', 'marta.pac',   'Marta Pacientes',  '{ofertas}', 'active'),
  (:'i1', :'m2', 'jorge.mon',   'Jorge Monitoreo',  '{ofertas}', 'active'),
  (:'i1', :'m3', 'sara.ofer',   'Sara Ofertas',     '{ofertas}', 'active'),
  (:'i1', :'m4', 'luis.susp',   'Luis Suspendido',  '{ofertas}', 'suspended'),
  (:'i2', :'m5', 'elena.otra',  'Elena Otra',       '{ofertas}', 'active'),
  (:'i4', :'m6', 'rosa.prem',   'Rosa Premium',     '{ofertas}', 'active');

-- ═══ 0) Antes de la migración ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('0.1 antes: no existen las tablas de pacientes', to_regclass('public.inst_patients') IS NULL AND to_regclass('public.inst_notes') IS NULL);
SELECT public.t_true('0.2 antes: el catálogo de módulos del personal tiene solo ofertas y talento', public.hx_staff_modules() = ARRAY['ofertas','talento']);
SELECT public.t_err('0.3 antes: no se puede dar el módulo pacientes al personal',
  public.t_sys(format('UPDATE public.institution_members SET modules = %L WHERE member_user_id = %L', '{pacientes}', :'m1')), 'check');

\i :MIG

-- El catálogo ya incluye los módulos nuevos: se le dan al personal.
UPDATE public.institution_members SET modules = '{pacientes}'              WHERE member_user_id = :'m1';
UPDATE public.institution_members SET modules = '{monitoreo}'              WHERE member_user_id = :'m2';
UPDATE public.institution_members SET modules = '{pacientes,monitoreo}'    WHERE member_user_id IN (:'m4', :'m5', :'m6');

-- ═══ A) Estructura, permisos y tiempo real ══════════════════════════════════════════════════════════════════════
SELECT public.t_true('A.1 el catálogo del personal ahora incluye pacientes y monitoreo',
  public.hx_staff_modules() = ARRAY['ofertas','talento','pacientes','monitoreo']);
SELECT public.t_true('A.2 las 10 tablas existen con RLS', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND c.relname IN ('inst_patients','inst_cases','inst_notes','inst_tasks','inst_obs','inst_alerts','inst_devices','inst_live','inst_events','inst_ingest_failures')
  AND c.relrowsecurity) = 10);
SELECT public.t_true('A.3 el visitante no tiene ningún privilegio sobre ninguna tabla', NOT EXISTS (
  SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'inst\_%'
   AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')));
SELECT public.t_true('A.4 el autenticado solo lee (nada de INSERT/UPDATE/DELETE/TRUNCATE) y no toca los intentos fallidos', NOT EXISTS (
  SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'inst\_%'
   AND has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  AND NOT has_table_privilege('authenticated', 'public.inst_ingest_failures', 'SELECT'));
SELECT public.t_true('A.5 el autenticado lee las 8 tablas de datos (los dispositivos, por columnas)',
  has_table_privilege('authenticated', 'public.inst_patients', 'SELECT') AND has_table_privilege('authenticated', 'public.inst_cases', 'SELECT')
  AND has_table_privilege('authenticated', 'public.inst_notes', 'SELECT') AND has_table_privilege('authenticated', 'public.inst_tasks', 'SELECT')
  AND has_table_privilege('authenticated', 'public.inst_obs', 'SELECT') AND has_table_privilege('authenticated', 'public.inst_alerts', 'SELECT')
  AND has_table_privilege('authenticated', 'public.inst_live', 'SELECT') AND has_table_privilege('authenticated', 'public.inst_events', 'SELECT')
  AND has_column_privilege('authenticated', 'public.inst_devices', 'label', 'SELECT'));
SELECT public.t_true('A.6 la huella del código del dispositivo no se lee por la API', NOT has_column_privilege('authenticated', 'public.inst_devices', 'code_hash', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.inst_devices', 'code_hash', 'SELECT'));
SELECT public.t_eq('A.7 solo estas funciones pueden llamarse con sesión',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'inst\_%' OR p.proname LIKE 'hx\_care\_%' OR p.proname LIKE 'hx\_inst\_%'
          OR p.proname IN ('hx_news2','hx_news2_band','hx_news2_interval_min','hx_text_ok','hx_name_ok','hx_text_array_ok','hx_alert_rank','hx_json_num','hx_json_texts','hx_ingest_ip_hash'))
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'hx_care_inst,inst_accepted_applications,inst_alert_ack,inst_alert_resolve,inst_care_overview,inst_case_close,inst_case_open,inst_case_rate,inst_case_update,inst_device_create,inst_device_ingest,inst_device_revoke,inst_escalate_due,inst_export_log,inst_handoff_commit,inst_monitoring_set,inst_note_add,inst_patient_create,inst_patient_discharge,inst_patient_set_scale,inst_patient_set_status,inst_patient_update,inst_task_add,inst_task_done,inst_verify_notes,inst_vitals_record');
SELECT public.t_eq('A.8 el visitante solo puede llamar a la ingesta de dispositivos',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'inst\_%' OR p.proname LIKE 'hx\_care\_%' OR p.proname LIKE 'hx\_inst\_%'
          OR p.proname IN ('hx_news2','hx_news2_band','hx_news2_interval_min','hx_text_ok','hx_name_ok','hx_text_array_ok','hx_alert_rank','hx_json_num','hx_json_texts','hx_ingest_ip_hash'))
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'inst_device_ingest');
SELECT public.t_true('A.9 todas las funciones nuevas son SECURITY DEFINER con ruta fija (salvo las puras)', NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'inst\_%' OR p.proname LIKE 'hx\_care\_%' OR p.proname LIKE 'hx\_inst\_%')
     AND p.proname NOT IN ('hx_inst_care_limits', 'hx_inst_note_payload')
     AND NOT (p.prosecdef AND p.proconfig::text LIKE '%search_path=public%')));
SELECT public.t_true('A.10 la publicación de tiempo real incluye pacientes, casos, tareas, alertas, lo último y la bitácora; no notas ni lecturas', (
  SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('inst_patients','inst_cases','inst_tasks','inst_alerts','inst_live','inst_events')) = 6
  AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('inst_notes','inst_obs','inst_devices','inst_ingest_failures')));
SELECT public.t_true('A.11 el personal puede tener los módulos nuevos y solo los del catálogo', (
  SELECT count(*) FROM public.institution_members WHERE modules && ARRAY['pacientes','monitoreo']) = 5
  AND public.t_sys(format('UPDATE public.institution_members SET modules = %L WHERE member_user_id = %L', '{pacientes,zzz}', :'m1')) LIKE 'ERR%');

-- ═══ B) NEWS2: la base puntúa igual que la pantalla (mismos vectores que src/lib/news2.test.ts) ══════════════════════
SELECT pg_read_file(:'VECTORS') AS vecjson \gset
SELECT public.t_true('B.1 hay más de 90 vectores', (SELECT count(*) FROM jsonb_array_elements(:'vecjson'::jsonb)) > 90);
WITH v AS (SELECT x.* FROM jsonb_to_recordset(:'vecjson'::jsonb) AS x(name text, input jsonb, expect jsonb)),
r AS (
  SELECT v.name, v.expect,
         public.hx_news2((v.input ->> 'rr')::numeric, (v.input ->> 'spo2')::numeric, (v.input ->> 'on_o2')::boolean, (v.input ->> 'sbp')::numeric,
                         (v.input ->> 'hr')::numeric, v.input ->> 'avpu', (v.input ->> 'temp_c')::numeric, (v.input ->> 'scale')::integer) AS got
    FROM v)
SELECT public.t_eq('B.2 ningún vector difiere en puntaje, máximo de un parámetro o medidos',
  (SELECT count(*)::text || COALESCE(' · ' || string_agg(name, ' | '), '') FROM r
    WHERE (got ->> 'score')::int <> (expect ->> 'score')::int OR (got ->> 'max_single')::int <> (expect ->> 'max_single')::int
       OR (got ->> 'measured')::int <> (expect ->> 'measured')::int), '0');
SELECT public.t_eq('B.3 bandas', (SELECT string_agg(public.hx_news2_band(s, m), ',' ORDER BY ord) FROM (VALUES (1,0,0),(2,4,2),(3,3,3),(4,4,3),(5,5,2),(6,6,3),(7,7,2),(8,20,3)) AS t(ord, s, m)),
  'low,low,low_medium,low_medium,medium,medium,high,high');
SELECT public.t_eq('B.4 minutos entre controles', (SELECT string_agg(public.hx_news2_interval_min(s, m)::text, ',' ORDER BY ord) FROM (VALUES (1,0,0),(2,2,2),(3,3,3),(4,5,2),(5,7,2),(6,12,3)) AS t(ord, s, m)),
  '720,360,60,60,15,15');
SELECT public.t_true('B.5 los límites del plan: Free (5 pacientes, 3 en monitoreo, sin extras) e IPS Mejorado (1000, 300, 300 dispositivos y todo)',
  public.hx_inst_care_limits('free') = '{"export": false, "handoff": false, "devices": 0, "patients": 5, "followups": false, "monitored": 3, "escalation": false}'::jsonb
  AND public.hx_inst_care_limits('institution_monthly') = '{"export": true, "handoff": true, "devices": 300, "patients": 1000, "followups": true, "monitored": 300, "escalation": true}'::jsonb
  AND public.hx_inst_care_limits('essential_monthly') = public.hx_inst_care_limits('free') AND public.hx_inst_care_limits(NULL) = public.hx_inst_care_limits('free'));

-- ═══ C) Quién entra: aislamiento entre instituciones, módulos del personal, planes y visitantes ═══════════════════
\set ana '{"full_name":"  Ana Lucía Pérez  ","document_type":"CC","document_number":"1020304050","birth_date":"1948-03-01","sex":"F","eps_name":"Sanitas","city":"Bogotá","address":"Cra 7 # 45-10","modality":"chronic","room":"201","conditions":["Hipertensión","Diabetes tipo 2","Hipertensión"," "],"allergies":["Penicilina"],"emergency_name":"Luis Pérez","emergency_phone":"300 123 4567","external_ref":"HC-0001"}'
SELECT public.t_pat(:'i1', :'ana') AS pa \gset
SELECT public.t_true('C.0 la institución 1 crea a Ana', :'pa' ~ '^[0-9a-f-]{36}$');
SELECT public.t_pat(:'i2', '{"full_name":"Bruno Otero"}') AS pb \gset
SELECT public.t_true('C.0b la institución 2 crea a Bruno', :'pb' ~ '^[0-9a-f-]{36}$');

SELECT public.t_eq('C.1 la dueña ve a su paciente', public.t_call(:'i1','authenticated','SELECT count(*)::text FROM public.inst_patients'), '1');
SELECT public.t_eq('C.2 la otra institución solo ve el suyo', public.t_call(:'i2','authenticated','SELECT count(*)::text FROM public.inst_patients'), '1');
SELECT public.t_eq('C.3 el personal con «pacientes» ve los de su institución', public.t_call(:'m1','authenticated','SELECT count(*)::text FROM public.inst_patients'), '1');
SELECT public.t_eq('C.4 el personal con «monitoreo» ve los de su institución', public.t_call(:'m2','authenticated','SELECT count(*)::text FROM public.inst_patients'), '1');
SELECT public.t_eq('C.5 el personal solo con «ofertas» no ve pacientes', public.t_call(:'m3','authenticated','SELECT count(*)::text FROM public.inst_patients'), '0');
SELECT public.t_eq('C.6 el personal suspendido no ve nada', public.t_call(:'m4','authenticated','SELECT count(*)::text FROM public.inst_patients'), '0');
SELECT public.t_eq('C.7 el personal de otra institución ve solo la suya', public.t_call(:'m5','authenticated','SELECT full_name FROM public.inst_patients'), 'Bruno Otero');
SELECT public.t_eq('C.8 familia, profesional, superadmin, RR. HH. y evaluador no ven pacientes',
  public.t_call(:'f1','authenticated','SELECT count(*)::text FROM public.inst_patients') || public.t_call(:'p1','authenticated','SELECT count(*)::text FROM public.inst_patients')
  || public.t_call(:'sa','authenticated','SELECT count(*)::text FROM public.inst_patients') || public.t_call(:'hr','authenticated','SELECT count(*)::text FROM public.inst_patients')
  || public.t_call(:'ev','authenticated','SELECT count(*)::text FROM public.inst_patients'), '00000');
SELECT public.t_err('C.9 el visitante no lee pacientes', public.t_anon('SELECT count(*) FROM public.inst_patients'), 'permission denied');
SELECT public.t_err('C.10 el visitante no lee notas ni lecturas', public.t_anon('SELECT count(*) FROM public.inst_notes') || public.t_anon('SELECT count(*) FROM public.inst_obs'), 'permission denied');
-- Lo que se ve de las demás tablas sigue el mismo alcance.
SELECT public.t_eq('C.11 el personal solo de ofertas no ve ninguna tabla de pacientes', (
  SELECT string_agg(t, ',') FROM unnest(ARRAY['inst_cases','inst_notes','inst_tasks','inst_obs','inst_alerts','inst_live','inst_events']) AS t
   WHERE public.t_call(:'m3','authenticated','SELECT count(*)::text FROM public.' || t) <> '0'), NULL);
-- Nadie escribe directo por la API.
SELECT public.t_err('C.12 insertar directo en pacientes', public.t_call(:'i1','authenticated', format('INSERT INTO public.inst_patients(institution_id, full_name, consent_confirmed_by, created_by) VALUES (%L, %L, %L, %L)', :'i1', 'X Y', :'i1', :'i1')), 'permission denied');
SELECT public.t_err('C.13 modificar directo un paciente', public.t_call(:'i1','authenticated', format('UPDATE public.inst_patients SET full_name = %L WHERE id = %L', 'Otro Nombre', :'pa')), 'permission denied');
SELECT public.t_err('C.14 borrar directo un paciente', public.t_call(:'i1','authenticated', format('DELETE FROM public.inst_patients WHERE id = %L', :'pa')), 'permission denied');
SELECT public.t_err('C.15 insertar directo una nota', public.t_call(:'i1','authenticated', format('INSERT INTO public.inst_notes(institution_id, patient_id, seq, kind, body, author_id, author_name, author_role, prev_hash, hash) VALUES (%L, %L, 99, %L, %L, %L, %L, %L, %L, %L)', :'i1', :'pa', 'evolution', 'nota falsa', :'i1', 'X', 'owner', 'a', 'b')), 'permission denied');
SELECT public.t_err('C.16 insertar directo un control', public.t_call(:'i1','authenticated', format('INSERT INTO public.inst_obs(institution_id, patient_id, hr) VALUES (%L, %L, 80)', :'i1', :'pa')), 'permission denied');
SELECT public.t_err('C.17 modificar directo una alerta', public.t_call(:'i1','authenticated', 'UPDATE public.inst_alerts SET status = ''resolved'''), 'permission denied');
SELECT public.t_err('C.18 leer la huella del código de un dispositivo', public.t_call(:'i1','authenticated', 'SELECT code_hash FROM public.inst_devices'), 'permission denied');
SELECT public.t_err('C.19 «SELECT *» de dispositivos tampoco (la pantalla pide columnas)', public.t_call(:'i1','authenticated', 'SELECT * FROM public.inst_devices'), 'permission denied');
SELECT public.t_err('C.20 intentos fallidos de ingesta: nadie los lee', public.t_call(:'i1','authenticated', 'SELECT * FROM public.inst_ingest_failures'), 'permission denied');
-- Las funciones: quién puede llamarlas.
SELECT public.t_err('C.21 una familia no crea pacientes', public.t_pat(:'f1', '{"full_name":"Intruso Uno"}'), 'forbidden');
SELECT public.t_err('C.22 un profesional no crea pacientes', public.t_pat(:'p1', '{"full_name":"Intruso Dos"}'), 'forbidden');
SELECT public.t_err('C.23 el superadmin tampoco (no hay acceso a datos de pacientes)', public.t_pat(:'sa', '{"full_name":"Intruso Tres"}'), 'forbidden');
SELECT public.t_err('C.24 personal solo de ofertas', public.t_pat(:'m3', '{"full_name":"Intruso Cuatro"}'), 'forbidden');
SELECT public.t_err('C.25 personal suspendido', public.t_pat(:'m4', '{"full_name":"Intruso Cinco"}'), 'forbidden');
SELECT public.t_err('C.26 el visitante no llama a las funciones de pacientes',
  public.t_call(NULL, 'anon', format('SELECT public.inst_patient_create(%L::jsonb, true)::text', '{"full_name":"Intruso Seis"}')), 'permission denied');
SELECT public.t_err('C.27 ni a las internas', public.t_call(NULL, 'anon', format('SELECT public.hx_inst_escalate(%L::uuid)', :'i1')), 'permission denied');
SELECT public.t_err('C.28 ni la sesión las internas', public.t_call(:'i1', 'authenticated', format('SELECT public.hx_inst_escalate(%L::uuid)', :'i1')), 'permission denied');
SELECT public.t_err('C.29 ni el plan de otra institución', public.t_call(:'i1', 'authenticated', format('SELECT public.hx_care_plan(%L::uuid)', :'i2')), 'permission denied');
SELECT public.t_true('C.30 con «pacientes» crea un paciente; con «monitoreo» también (para ponerlo a monitorear)',
  public.t_pat(:'m1', '{"full_name":"Creado Por Pacientes"}') ~ '^[0-9a-f-]{36}$' AND public.t_pat(:'m2', '{"full_name":"Creado Por Monitoreo"}') ~ '^[0-9a-f-]{36}$');
SELECT public.t_err('C.31 pero «pacientes» solo no puede ponerlo en monitoreo al crearlo', public.t_pat(:'m1', '{"full_name":"Quiere Monitoreo"}', true), 'forbidden');
SELECT public.t_err('C.32 y «monitoreo» solo no abre casos al crearlo',
  public.t_pat(:'m2', '{"full_name":"Quiere Caso"}', false, true, '{"title":"Caso nuevo"}'), 'forbidden');
SELECT public.t_err('C.33 «pacientes» solo no registra signos vitales', public.t_vit(:'m1', :'pa', '{"hr":80}'), 'forbidden');
SELECT public.t_err('C.34 «monitoreo» solo no cambia los datos del paciente', public.t_rpc(:'m2', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'pa', '{"city":"Cali"}')), 'forbidden');
SELECT public.t_err('C.35 otra institución no toca al paciente (no existe para ella)', public.t_rpc(:'i2', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'pa', '{"city":"Cali"}')), 'not_found');
SELECT public.t_err('C.36 ni le abre un caso', public.t_rpc(:'i2', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"title":"Intruso"}')), 'not_found');
SELECT public.t_err('C.37 ni le agrega notas', public.t_rpc(:'i2', format('public.inst_note_add(%L::uuid, %L, %L)', :'pa', 'evolution', 'nota ajena')), 'not_found');
SELECT public.t_err('C.38 ni lo pone en monitoreo', public.t_rpc(:'i2', format('public.inst_monitoring_set(%L::uuid, true)', :'pa')), 'not_found');

-- El plan vence: el personal pierde el acceso (la delegación es del plan IPS Mejorado) y la dueña vuelve a los límites del plan Free.
SELECT public.t_pat(:'m6', '{"full_name":"Paciente De Rosa"}') AS pr6 \gset
SELECT public.t_true('C.39 con el plan vigente, el personal de la institución 4 crea y ve', :'pr6' ~ '^[0-9a-f-]{36}$');
UPDATE public.mp_subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = :'i4';
SELECT public.t_err('C.40 vencido el plan, el personal ya no entra', public.t_pat(:'m6', '{"full_name":"Tarde Para Rosa"}'), 'forbidden');
SELECT public.t_eq('C.41 y deja de ver los pacientes', public.t_call(:'m6','authenticated','SELECT count(*)::text FROM public.inst_patients'), '0');
SELECT public.t_eq('C.42 la dueña sigue viendo lo suyo (nunca se retiene la información)', public.t_call(:'i4','authenticated','SELECT count(*)::text FROM public.inst_patients'), '1');
SELECT public.t_eq('C.43 y su plan en el resumen es el Free', public.jget(public.t_rpc(:'i4','public.inst_care_overview()'), 'plan'), 'free');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = :'i4';
SELECT public.t_eq('C.44 renovado el plan, vuelve el IPS Mejorado', public.jget(public.t_rpc(:'i4','public.inst_care_overview()'), 'plan'), 'institution_monthly');

-- ═══ D) Planes: Free (5 pacientes, 3 en monitoreo, sin dispositivos ni extras) frente a IPS Mejorado ═════════════════
CREATE TABLE public._free_ids AS
  SELECT n, public.t_pat(:'i3', format('{"full_name":"Libre Paciente %s"}', n)) AS id FROM generate_series(1, 5) AS n;
SELECT public.t_eq('D.1 la institución Free crea sus 5 pacientes', (SELECT count(*)::text FROM public._free_ids WHERE id ~ '^[0-9a-f-]{36}$'), '5');
SELECT public.t_err('D.2 el sexto no entra', public.t_pat(:'i3', '{"full_name":"Libre Sexto"}'), 'patient_limit');
SELECT id AS fp1 FROM public._free_ids WHERE n = 1 \gset
SELECT id AS fp2 FROM public._free_ids WHERE n = 2 \gset
SELECT id AS fp3 FROM public._free_ids WHERE n = 3 \gset
SELECT id AS fp4 FROM public._free_ids WHERE n = 4 \gset
SELECT id AS fp5 FROM public._free_ids WHERE n = 5 \gset
SELECT public.t_true('D.3 tres pueden monitorearse', public.t_rpc(:'i3', format('public.inst_monitoring_set(%L::uuid, true)', :'fp1')) NOT LIKE 'ERR%'
  AND public.t_rpc(:'i3', format('public.inst_monitoring_set(%L::uuid, true)', :'fp2')) NOT LIKE 'ERR%'
  AND public.t_rpc(:'i3', format('public.inst_monitoring_set(%L::uuid, true)', :'fp3')) NOT LIKE 'ERR%');
SELECT public.t_err('D.4 el cuarto en monitoreo no', public.t_rpc(:'i3', format('public.inst_monitoring_set(%L::uuid, true)', :'fp4')), 'monitor_limit');
SELECT public.t_err('D.5 ni creándolo ya en monitoreo', public.t_pat(:'i3', '{"full_name":"Libre Con Monitoreo"}', true), 'patient_limit');
SELECT public.t_err('D.6 los dispositivos son del plan IPS Mejorado', public.t_rpc(:'i3', format('public.inst_device_create(%L::uuid, %L)', :'fp1', 'Reloj')), 'devices_plan');
SELECT public.t_err('D.7 el relevo guardado en la historia también', public.t_rpc(:'i3', format('public.inst_handoff_commit(%L::jsonb)', format('[{"patient_id":"%s","illness":"stable"}]', :'fp1'))), 'handoff_plan');
SELECT public.t_err('D.8 y exportar', public.t_rpc(:'i3', format('public.inst_export_log(%L::uuid, %L)', :'fp1', 'fhir')), 'export_plan');
SELECT public.jget(public.t_rpc(:'i3', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'fp1', '{"title":"Caso libre"}')), 'id') AS fcase \gset
SELECT public.t_eq('D.9 sin plan no se agendan seguimientos automáticos', (SELECT count(*)::text FROM public.inst_tasks WHERE case_id = :'fcase'::uuid), '0');
-- Las alertas se crean en todos los planes (la seguridad no se vende); el escalamiento sí es del plan.
SELECT public.t_vit(:'i3', :'fp1', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS fvit \gset
SELECT public.t_eq('D.10 Free: un paciente grave igual genera su alerta crítica', public.jget(:'fvit', 'alert', 'severity') || '/' || public.jget(:'fvit', 'alert', 'reason'), 'critical/news2_high');
UPDATE public.inst_alerts SET due_ack_at = now() - interval '1 minute' WHERE patient_id = :'fp1'::uuid;
SELECT public.t_eq('D.11 Free: el escalamiento no se hace', public.t_rpc(:'i3', 'public.inst_escalate_due()'), '0');
SELECT public.t_true('D.12 y la alerta sigue sin escalar', (SELECT escalated_at IS NULL AND escalation_level = 0 FROM public.inst_alerts WHERE patient_id = :'fp1'::uuid));
SELECT public.t_eq('D.13 Free: el resumen trae el plan, los límites y el uso', public.jget(public.t_rpc(:'i3','public.inst_care_overview()'), 'plan') || '/'
  || public.jget(public.t_rpc(:'i3','public.inst_care_overview()'), 'limits', 'patients') || '/' || public.jget(public.t_rpc(:'i3','public.inst_care_overview()'), 'usage', 'patients')
  || '/' || public.jget(public.t_rpc(:'i3','public.inst_care_overview()'), 'usage', 'monitored'), 'free/5/5/3');
-- Dar el alta libera un cupo; reactivar a alguien con el cupo lleno no se puede.
SELECT public.t_true('D.14 el alta libera el cupo', public.t_rpc(:'i3', format('public.inst_patient_discharge(%L::uuid, %L)', :'fp5', 'stable')) NOT LIKE 'ERR%'
  AND public.t_pat(:'i3', '{"full_name":"Libre Reemplazo"}') ~ '^[0-9a-f-]{36}$');
SELECT public.t_err('D.15 reactivar con el cupo lleno no se puede', public.t_rpc(:'i3', format('public.inst_patient_set_status(%L::uuid, %L)', :'fp5', 'active')), 'patient_limit');
SELECT public.t_true('D.16 el paciente con alta sigue visible para su institución', public.t_call(:'i3','authenticated', format('SELECT status FROM public.inst_patients WHERE id = %L', :'fp5')) = 'discharged');

-- ═══ E) Pacientes: registro, validación, aislamiento y cambios ══════════════════════════════════════════════════
SELECT public.t_eq('E.1 el nombre se guarda sin espacios sobrantes', (SELECT full_name FROM public.inst_patients WHERE id = :'pa'), 'Ana Lucía Pérez');
SELECT public.t_true('E.2 queda activo, sin monitoreo, con la modalidad y el consentimiento de quien lo registró',
  (SELECT status = 'active' AND NOT monitoring AND modality = 'chronic' AND consent_confirmed_by = :'i1'::uuid AND created_by = :'i1'::uuid
          AND consent_confirmed_at > now() - interval '1 minute' AND spo2_scale = 1 AND NOT family_updates_ok
     FROM public.inst_patients WHERE id = :'pa'));
SELECT public.t_eq('E.3 las listas se limpian (sin repetidos ni vacíos)', (SELECT array_to_string(ARRAY(SELECT unnest(conditions) ORDER BY 1), '|') FROM public.inst_patients WHERE id = :'pa'), 'Diabetes tipo 2|Hipertensión');
SELECT public.t_true('E.4 el teléfono y la referencia externa se guardan', (SELECT emergency_phone = '300 123 4567' AND external_ref = 'HC-0001' FROM public.inst_patients WHERE id = :'pa'));
SELECT public.t_true('E.5 la primera nota deja constancia del consentimiento (Ley 1581) y abre la cadena',
  (SELECT seq = 1 AND kind = 'coordination' AND author_id = :'i1'::uuid AND author_name = 'Clínica Norte' AND author_role = 'owner'
          AND prev_hash = repeat('0', 64) AND body LIKE '%Ley 1581%' FROM public.inst_notes WHERE patient_id = :'pa' ORDER BY seq LIMIT 1));
SELECT public.t_true('E.6 y queda la bitácora', (SELECT count(*) = 1 AND bool_and(actor_id = :'i1'::uuid AND actor_name = 'Clínica Norte') FROM public.inst_events WHERE patient_id = :'pa' AND kind = 'patient_created'));
SELECT public.t_err('E.7 sin confirmar el consentimiento no se registra', public.t_pat(:'i1', '{"full_name":"Sin Consentimiento"}', false, false), 'consent_required');
SELECT public.t_eq('E.8 y no queda ningún rastro', (SELECT count(*)::text FROM public.inst_patients WHERE full_name = 'Sin Consentimiento'), '0');
SELECT public.t_eq('E.9 la validación rechaza lo que no sirve', (
  SELECT string_agg(k, ',' ORDER BY k) FROM (VALUES
    ('nombre corto',     '{"full_name":"A"}'),
    ('nombre con marca', '{"full_name":"Ana <script>"}'),
    ('nombre con control', E'{"full_name":"Ana\\u0001 Pérez"}'),
    ('teléfono',         '{"full_name":"Tel Malo","emergency_phone":"abc"}'),
    ('nacimiento futuro', format('{"full_name":"Futuro Uno","birth_date":"%s"}', current_date + 1)),
    ('nacimiento lejano','{"full_name":"Futuro Dos","birth_date":"2999-01-01"}'),
    ('fecha imposible',  '{"full_name":"Fecha Mala","birth_date":"1950-13-45"}'),
    ('documento sin tipo','{"full_name":"Sin Tipo","document_number":"123456"}'),
    ('documento con espacio','{"full_name":"Doc Espacio","document_type":"CC","document_number":"12 34 56"}'),
    ('tipo de documento','{"full_name":"Tipo Malo","document_type":"XX","document_number":"123456"}'),
    ('modalidad',        '{"full_name":"Modo Malo","modality":"zzz"}'),
    ('sexo',             '{"full_name":"Sexo Malo","sex":"X"}'),
    ('condiciones no lista','{"full_name":"Lista Mala","conditions":"Hipertensión"}'),
    ('21 condiciones',   (SELECT format('{"full_name":"Muchas","conditions":%s}', jsonb_agg('c' || g)::text) FROM generate_series(1, 21) g)),
    ('condición larga',  format('{"full_name":"Larga","allergies":["%s"]}', repeat('x', 100))),
    ('estado de alta',   '{"full_name":"Alta Mal","status":"discharged"}'),
    ('booleano',         '{"full_name":"Bool Mal","family_updates_ok":"quizás"}'),
    ('no es objeto',     '[]')
  ) AS t(k, d) WHERE public.t_pat(:'i1', d) !~ 'invalid_data'), NULL);
SELECT public.t_err('E.10 sin datos', public.t_pat(:'i1', NULL), 'invalid_data');
SELECT public.t_eq('E.11 ninguno de esos se guardó', (SELECT count(*)::text FROM public.inst_patients WHERE institution_id = :'i1' AND full_name IN ('A','Tel Malo','Futuro Uno','Futuro Dos','Fecha Mala','Sin Tipo','Doc Espacio','Tipo Malo','Modo Malo','Sexo Malo','Lista Mala','Muchas','Larga','Alta Mal','Bool Mal')), '0');
SELECT public.t_err('E.12 el mismo documento en la misma institución', public.t_pat(:'i1', '{"full_name":"Otra Ana","document_type":"CC","document_number":"1020304050"}'), 'duplicate_document');
SELECT public.t_true('E.13 con otro tipo de documento sí, y en otra institución también',
  public.t_pat(:'i1', '{"full_name":"Ana CE","document_type":"CE","document_number":"1020304050"}') ~ '^[0-9a-f-]{36}$'
  AND public.t_pat(:'i2', '{"full_name":"Ana Otra Sede","document_type":"CC","document_number":"1020304050"}') ~ '^[0-9a-f-]{36}$');
SELECT id AS pace FROM public.inst_patients WHERE full_name = 'Ana CE' \gset
-- Cambios.
SELECT public.t_rpc(:'i1', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'pa', '{"city":"Medellín","conditions":["Asma"],"room":"","family_updates_ok":true}')) AS upd \gset
SELECT public.t_true('E.14 se cambia solo lo que viene', public.jget(:'upd','city') = 'Medellín' AND public.jget(:'upd','conditions') = '["Asma"]'
  AND public.jget(:'upd','room') IS NULL AND public.jget(:'upd','full_name') = 'Ana Lucía Pérez' AND public.jget(:'upd','family_updates_ok') = 'true'
  AND public.jget(:'upd','document_number') = '1020304050');
SELECT public.t_true('E.15 y la fecha de cambio avanza', (SELECT updated_at > created_at OR updated_at = created_at FROM public.inst_patients WHERE id = :'pa'));
SELECT public.t_true('E.16 en la bitácora queda qué campos cambiaron (sin sus valores)', (SELECT count(*) = 1 AND bool_and(data::text NOT LIKE '%Medellín%') FROM public.inst_events WHERE patient_id = :'pa' AND kind = 'patient_updated'));
SELECT public.t_err('E.17 no se cambia a un documento que ya existe', public.t_rpc(:'i1', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'pa', '{"document_type":"CE"}')), 'duplicate_document');
SELECT public.t_err('E.18 ni a un valor inválido', public.t_rpc(:'i1', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'pa', '{"emergency_phone":"x"}')), 'invalid_data');
SELECT public.t_err('E.19 ni sin datos', public.t_rpc(:'i1', format('public.inst_patient_update(%L::uuid, NULL)', :'pa')), 'invalid_data');
SELECT public.t_pat(:'i1', '{"full_name":"Inmutable Prueba"}') AS pim \gset
SELECT public.t_sys(format('UPDATE public.inst_patients SET consent_confirmed_by = %L, created_by = %L, institution_id = %L, created_at = %L, consent_confirmed_at = %L WHERE id = %L',
  :'f1', :'f1', :'i2', '2000-01-01', '2000-01-01', :'pim')) AS upd_im \gset
SELECT public.t_eq('E.20a el intento no da error: simplemente se ignora lo que no se puede cambiar', :'upd_im', 'ok');
SELECT public.t_true('E.20 quién lo registró, de quién es y su consentimiento no se reescriben (ni con acceso total)',
  (SELECT consent_confirmed_by = :'i1'::uuid AND created_by = :'i1'::uuid AND institution_id = :'i1'::uuid AND created_at > now() - interval '1 hour'
          AND consent_confirmed_at > now() - interval '1 hour' FROM public.inst_patients WHERE id = :'pim'::uuid));
-- Estados.
SELECT public.t_err('E.21 el alta tiene su propia acción', public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'discharged')), 'use_discharge');
SELECT public.t_err('E.22 un estado desconocido no', public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'zzz')), 'invalid_data');
SELECT public.t_eq('E.23 pasar a pausa', public.jget(public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'paused')), 'status'), 'paused');
SELECT public.t_eq('E.24 y volver a activo', public.jget(public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'active')), 'status'), 'active');
SELECT public.t_eq('E.25 pasa a pendiente', public.jget(public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'pending')), 'status'), 'pending');
SELECT public.t_err('E.25b y un pendiente no se monitorea', public.t_rpc(:'i1', format('public.inst_monitoring_set(%L::uuid, true)', :'pace')), 'patient_not_active');
SELECT public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'pace', 'active')) AS _y \gset
-- Escala 2 de saturación.
SELECT public.t_err('E.26 la escala 2 pide la indicación médica', public.t_rpc(:'i1', format('public.inst_patient_set_scale(%L::uuid, 2)', :'pa')), 'reason_required');
SELECT public.t_err('E.27 una escala que no existe', public.t_rpc(:'i1', format('public.inst_patient_set_scale(%L::uuid, 3)', :'pa')), 'invalid_data');
SELECT public.t_eq('E.28 con la indicación se cambia', public.jget(public.t_rpc(:'i1', format('public.inst_patient_set_scale(%L::uuid, 2, %L)', :'pa', 'EPOC con hipercapnia, indicación de neumología')), 'spo2_scale'), '2');
SELECT public.t_true('E.29 y queda en la historia con su motivo', (SELECT count(*) = 1 FROM public.inst_notes WHERE patient_id = :'pa' AND kind = 'evolution' AND body ILIKE '%escala%2%' AND body ILIKE '%neumología%'));
SELECT public.t_eq('E.30 volver a la escala 1 no pide motivo', public.jget(public.t_rpc(:'i1', format('public.inst_patient_set_scale(%L::uuid, 1)', :'pa')), 'spo2_scale'), '1');
SELECT public.t_true('E.31 «monitoreo» también puede cambiarla (la usa quien mide)', public.t_rpc(:'m2', format('public.inst_patient_set_scale(%L::uuid, 1)', :'pa')) NOT LIKE 'ERR%');

-- ═══ F) Casos: abrir (también desde una postulación aceptada), cambiar, cerrar y valorar ═══════════════════════════
SET session_replication_role = replica;
INSERT INTO public.job_offers(id, posted_by, poster_type, title, modality, amount, city, status) VALUES
  ('00000000-0000-0000-0000-00000000d001', :'i1', 'institution', 'Auxiliar de enfermería nocturno', 'shift', 120000, 'Bogotá', 'open'),
  ('00000000-0000-0000-0000-00000000d002', :'i1', 'institution', 'Enfermera jefe domiciliaria',      'shift', 150000, 'Bogotá', 'open'),
  ('00000000-0000-0000-0000-00000000d003', :'i2', 'institution', 'Terapeuta respiratorio',           'shift', 130000, 'Medellín', 'open'),
  ('00000000-0000-0000-0000-00000000d004', :'i3', 'institution', 'Cuidador de adulto mayor',         'shift',  90000, 'Cali', 'open');
INSERT INTO public.applications(id, job_offer_id, professional_id, status, proposed_amount) VALUES
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d001', :'p1', 'accepted', 115000),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000d002', :'p2', 'pending',  140000),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000d003', :'p1', 'accepted', 125000),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-00000000d004', :'p1', 'accepted',  88000),
  ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000d001', :'p2', 'rejected', 110000);
SET session_replication_role = origin;

SELECT public.t_eq('F.1 la institución ve solo SUS postulaciones aceptadas sin caso', public.t_call(:'i1','authenticated','SELECT string_agg(application_id::text, '','') FROM public.inst_accepted_applications()'), '00000000-0000-0000-0000-00000000aa01');
SELECT public.t_eq('F.2 con el plan, el profesional aparece con su nombre completo', public.t_call(:'i1','authenticated','SELECT professional_label FROM public.inst_accepted_applications()'), 'Laura Gómez Pérez');
SELECT public.t_eq('F.3 sin plan, abreviado', public.t_call(:'i3','authenticated','SELECT professional_label FROM public.inst_accepted_applications()'), public.hx_pro_label('Laura Gómez Pérez', true));
SELECT public.t_true('F.4 el personal con «pacientes» las ve; el de «monitoreo» solo, no',
  public.t_call(:'m1','authenticated','SELECT count(*)::text FROM public.inst_accepted_applications()') = '1'
  AND public.t_call(:'m2','authenticated','SELECT count(*)::text FROM public.inst_accepted_applications()') LIKE 'ERR%forbidden%');

SELECT public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa',
  jsonb_build_object('title','Cuidado domiciliario post-alta','care_type','nursing','priority','high','summary','Curaciones y control de glucemia','target_end_at', now() + interval '30 days')::text)) AS c1 \gset
SELECT public.jget(:'c1', 'id') AS cid \gset
SELECT public.t_true('F.5 el caso nace activo con sus datos', public.jget(:'c1','status') = 'active' AND public.jget(:'c1','care_type') = 'nursing'
  AND public.jget(:'c1','priority') = 'high' AND public.jget(:'c1','patient_id') = :'pa' AND public.jget(:'c1','created_by') = :'i1'
  AND public.jget(:'c1','summary') = 'Curaciones y control de glucemia' AND public.jget(:'c1','closed_at') IS NULL);
SELECT public.t_true('F.6 con el plan se agendan 3 seguimientos: llamada al día, revisión a la semana y la experiencia al cierre',
  (SELECT count(*) = 3 AND count(*) FILTER (WHERE kind = 'call') = 1 AND count(*) FILTER (WHERE kind = 'followup') = 2 AND bool_and(source = 'auto_followup' AND status = 'open')
          AND count(*) FILTER (WHERE abs(extract(epoch FROM due_at - (now() + interval '1 day'))) < 120) = 1
          AND count(*) FILTER (WHERE abs(extract(epoch FROM due_at - (now() + interval '7 days'))) < 120) = 1
          AND count(*) FILTER (WHERE abs(extract(epoch FROM due_at - (now() + interval '30 days'))) < 120) = 1
     FROM public.inst_tasks WHERE case_id = :'cid'::uuid));
SELECT public.t_eq('F.7 y queda la bitácora', (SELECT count(*)::text FROM public.inst_events WHERE case_id = :'cid'::uuid AND kind = 'case_opened'), '1');
SELECT public.t_true('F.8 no se valida: ' || k, public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', d)) ~ 'invalid_data')
  FROM (VALUES ('título corto','{"title":"ab"}'), ('tipo de cuidado','{"title":"Caso válido","care_type":"zzz"}'), ('prioridad','{"title":"Caso válido","priority":"zzz"}'),
               ('cierre en el pasado', jsonb_build_object('title','Caso válido','target_end_at', now() - interval '3 days')::text),
               ('estado completado','{"title":"Caso válido","status":"completed"}'), ('no es objeto','[]'),
               ('postulación mal escrita','{"title":"Caso válido","application_id":"no-es-uuid"}')) AS t(k, d);
-- Desde una postulación aceptada.
SELECT public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pace', '{"application_id":"00000000-0000-0000-0000-00000000aa01"}')) AS c2 \gset
SELECT public.jget(:'c2', 'id') AS cid2 \gset
SELECT public.t_true('F.9 toma el título de la oferta y el profesional de la postulación',
  public.jget(:'c2','title') = 'Auxiliar de enfermería nocturno' AND public.jget(:'c2','professional_id') = :'p1' AND public.jget(:'c2','professional_label') = 'Laura Gómez Pérez'
  AND public.jget(:'c2','application_id') = '00000000-0000-0000-0000-00000000aa01');
SELECT public.t_eq('F.10 y la postulación sale de la lista de pendientes', public.t_call(:'i1','authenticated','SELECT count(*)::text FROM public.inst_accepted_applications()'), '0');
SELECT public.t_err('F.11 una postulación no abre dos casos', public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"application_id":"00000000-0000-0000-0000-00000000aa01"}')), 'application_used');
SELECT public.t_err('F.12 una postulación pendiente no sirve', public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"application_id":"00000000-0000-0000-0000-00000000aa02"}')), 'application_invalid');
SELECT public.t_err('F.13 ni una rechazada', public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"application_id":"00000000-0000-0000-0000-00000000aa05"}')), 'application_invalid');
SELECT public.t_err('F.14 ni la de otra institución', public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"application_id":"00000000-0000-0000-0000-00000000aa03"}')), 'application_invalid');
SELECT public.t_err('F.15 ni un paciente con el alta', public.t_rpc(:'i3', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'fp5', '{"title":"Caso tardío"}')), 'patient_discharged');
-- Cambios.
SELECT public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"title":"Cuidado domiciliario intensivo","priority":"urgent","status":"pending"}')) AS cu \gset
SELECT public.t_true('F.16 se cambia título, prioridad y estado', public.jget(:'cu','priority') = 'urgent' AND public.jget(:'cu','status') = 'pending'
  AND (SELECT title = 'Cuidado domiciliario intensivo' AND status = 'pending' FROM public.inst_cases WHERE id = :'cid'::uuid));
SELECT public.t_err('F.17 para cerrar hay una acción propia', public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"status":"completed"}')), 'use_close');
SELECT public.t_true('F.18 el profesional de una postulación no se cambia a mano', public.jget(public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid2', '{"professional_label":"Otra Persona"}')), 'professional_label') = 'Laura Gómez Pérez');
SELECT public.t_true('F.19 en un caso sin postulación sí', public.jget(public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"professional_label":"Enfermera externa"}')), 'professional_label') = 'Enfermera externa');
SELECT public.t_err('F.20 un valor inválido no pasa', public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"priority":"zzz"}')), 'invalid_data');
SELECT public.t_err('F.21 otra institución no lo ve', public.t_rpc(:'i2', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"title":"Intruso"}')), 'not_found');
SELECT public.t_err('F.22 «monitoreo» solo no cambia casos', public.t_rpc(:'m2', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"title":"Intruso"}')), 'forbidden');
SELECT public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid', '{"status":"active"}')) AS _z \gset
-- Cierre con valoración.
SELECT public.t_err('F.23 una valoración de 0 no pasa y el caso sigue abierto', public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L, %L, 0)', :'cid2', 'completed', 'recovered')), 'invalid_data');
SELECT public.t_err('F.24 ni una de 6', public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L, %L, 6)', :'cid2', 'completed', 'recovered')), 'invalid_data');
SELECT public.t_err('F.25 ni valorar un caso cancelado', public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L, %L, 4)', :'cid2', 'cancelled', 'withdrawn')), 'invalid_data');
SELECT public.t_eq('F.26 y el caso sigue activo tras esos intentos', (SELECT status FROM public.inst_cases WHERE id = :'cid2'::uuid), 'active');
SELECT public.t_err('F.27 el estado de cierre es completado o cancelado', public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L)', :'cid2', 'active')), 'invalid_data');
SELECT public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L, %L, 5, %L, %L)', :'cid2', 'completed', 'recovered', 'family', 'Excelente atención de principio a fin')) AS cl \gset
SELECT public.t_true('F.28 se cierra completado con desenlace, valoración y quién valoró',
  public.jget(:'cl','status') = 'completed' AND public.jget(:'cl','outcome') = 'recovered' AND public.jget(:'cl','satisfaction') = '5' AND public.jget(:'cl','satisfaction_by') = 'family'
  AND public.jget(:'cl','satisfaction_note') = 'Excelente atención de principio a fin' AND public.jget(:'cl','closed_at') IS NOT NULL);
SELECT public.t_true('F.29 sus tareas abiertas se dan por omitidas y se agenda la llamada a los 7 días del cierre',
  (SELECT count(*) FILTER (WHERE source = 'auto_followup' AND status = 'skipped') = 2
      AND count(*) FILTER (WHERE title = 'Llamada de seguimiento a los 7 días del cierre' AND status = 'open' AND kind = 'call'
                            AND abs(extract(epoch FROM due_at - (now() + interval '7 days'))) < 120) = 1
      AND count(*) FILTER (WHERE status = 'open') = 1 FROM public.inst_tasks WHERE case_id = :'cid2'::uuid));
SELECT public.t_true('F.30 queda una nota en la historia y la bitácora', (SELECT count(*) = 1 FROM public.inst_notes WHERE case_id = :'cid2'::uuid AND body LIKE '%cerrado como completado%')
  AND (SELECT count(*) = 1 FROM public.inst_events WHERE case_id = :'cid2'::uuid AND kind = 'case_closed' AND (data ->> 'rated')::boolean));
SELECT public.t_err('F.31 un caso cerrado no se cierra de nuevo', public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L)', :'cid2', 'cancelled')), 'case_closed');
SELECT public.t_err('F.32 ni se modifica', public.t_rpc(:'i1', format('public.inst_case_update(%L::uuid, %L::jsonb)', :'cid2', '{"title":"Reabierto"}')), 'case_closed');
SELECT public.t_err('F.33 ni se reabre ni con acceso total', public.t_sys(format('UPDATE public.inst_cases SET status = %L WHERE id = %L', 'active', :'cid2')), 'case_closed');
SELECT public.t_rpc(:'i1', format('public.inst_case_close(%L::uuid, %L)', :'cid', 'cancelled')) AS cx \gset
SELECT public.t_true('F.34 cancelado sin desenlace queda «retiro» y sin valoración', public.jget(:'cx','status') = 'cancelled' AND public.jget(:'cx','outcome') = 'withdrawn' AND public.jget(:'cx','satisfaction') IS NULL
  AND public.jget(:'cx','closed_at') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inst_tasks WHERE case_id = :'cid'::uuid AND status = 'open'));
-- Valoración posterior.
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_case_rate(%L::uuid, 4, %L, %L)', :'cid2', 'patient', 'Muy amables')), 'satisfaction_by') AS who \gset
SELECT public.t_true('F.35 un caso completado se puede valorar después (y la valoración se actualiza)', :'who' = 'patient' AND (SELECT satisfaction = 4 AND satisfaction_note = 'Muy amables' FROM public.inst_cases WHERE id = :'cid2'::uuid));
SELECT public.t_err('F.36 uno cancelado no', public.t_rpc(:'i1', format('public.inst_case_rate(%L::uuid, 4)', :'cid')), 'invalid_data');
SELECT public.t_err('F.37 una nota de 9 estrellas no', public.t_rpc(:'i1', format('public.inst_case_rate(%L::uuid, 9)', :'cid2')), 'invalid_data');
SELECT public.t_err('F.38 otra institución no valora', public.t_rpc(:'i2', format('public.inst_case_rate(%L::uuid, 1)', :'cid2')), 'not_found');
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'pa', '{"title":"Caso activo para pruebas"}')), 'id') AS cid3 \gset
SELECT public.t_err('F.39 una valoración en un caso activo se rechaza aunque se intente con acceso total', public.t_sys(format('UPDATE public.inst_cases SET satisfaction = 3 WHERE id = %L', :'cid3')), 'check constraint');
SELECT public.t_err('F.39b ni al crearlo', public.t_sys(format('INSERT INTO public.inst_cases(institution_id, patient_id, title, created_by, satisfaction) VALUES (%L, %L, %L, %L, 3)', :'i1', :'pa', 'Caso con nota', :'i1')), 'check constraint');
SELECT public.t_err('F.40 un caso no puede ser de un paciente de otra institución', public.t_sys(format('INSERT INTO public.inst_cases(institution_id, patient_id, title) VALUES (%L, %L, %L)', :'i1', :'pb', 'Caso cruzado')), 'patient_mismatch');

-- ═══ G) Notas: cadena inalterable, correcciones y manipulación ════════════════════════════════════════════════════
SELECT public.t_pat(:'i1', '{"full_name":"Nota Prueba","birth_date":"1960-05-05"}') AS gp \gset
SELECT public.t_true('G.1 se agregan notas de cada tipo y la secuencia sigue',
  public.jget(public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', 'Evoluciona favorablemente, sin fiebre.')), 'seq') = '2'
  AND public.jget(public.t_rpc(:'m1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'coordination', 'Se confirmó la visita de mañana.')), 'seq') = '3'
  AND public.jget(public.t_rpc(:'m2', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'nursing', 'Curación realizada, herida limpia.')), 'seq') = '4'
  AND public.jget(public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'family', 'La hija pidió informe por WhatsApp.')), 'seq') = '5'
  AND public.jget(public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'incident', 'Caída leve sin lesión, se notificó al médico.')), 'seq') = '6');
SELECT public.t_true('G.2 quedan firmadas por quien las escribió, con el rol y el nombre de ese momento',
  (SELECT count(*) FILTER (WHERE seq = 3 AND author_id = :'m1'::uuid AND author_name = 'Marta Pacientes' AND author_role = 'member') = 1
      AND count(*) FILTER (WHERE seq = 4 AND author_id = :'m2'::uuid AND author_name = 'Jorge Monitoreo' AND author_role = 'member') = 1
      AND count(*) FILTER (WHERE seq = 2 AND author_id = :'i1'::uuid AND author_role = 'owner') = 1 FROM public.inst_notes WHERE patient_id = :'gp'::uuid));
SELECT public.t_true('G.3 cada nota lleva la firma de la anterior y su propia firma se recalcula igual',
  (SELECT bool_and(seq = rn AND prev_hash = COALESCE(prev_h, repeat('0', 64))
                   AND hash = public.hx_sha256(public.hx_inst_note_payload(prev_hash, seq, patient_id, author_id, kind, created_at, body, vitals)))
     FROM (SELECT n.*, row_number() OVER (ORDER BY n.seq) AS rn, lag(n.hash) OVER (ORDER BY n.seq) AS prev_h
             FROM public.inst_notes n WHERE n.patient_id = :'gp'::uuid) x));
SELECT public.t_true('G.4 la verificación da la cadena por íntegra', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok') = 'true'
  AND public.jget(public.t_rpc(:'m2', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'checked') = '6');
SELECT public.t_err('G.5 el tipo «relevo» solo lo escribe el relevo de turno', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'handoff', 'Relevo falso')), 'invalid_data');
SELECT public.t_err('G.6 un tipo desconocido no', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'zzz', 'nota')), 'invalid_data');
SELECT public.t_err('G.7 una nota no se edita (ni con acceso total)', public.t_sys(format('UPDATE public.inst_notes SET body = %L WHERE patient_id = %L AND seq = 2', 'adulterada', :'gp')), 'note_immutable');
SELECT public.t_err('G.8 ni se borra', public.t_sys(format('DELETE FROM public.inst_notes WHERE patient_id = %L AND seq = 2', :'gp')), 'note_immutable');
SELECT public.t_err('G.9 ni siquiera su firma', public.t_sys(format('UPDATE public.inst_notes SET hash = %L WHERE patient_id = %L AND seq = 2', repeat('a', 64), :'gp')), 'note_immutable');
SELECT public.t_err('G.10 por la API tampoco', public.t_call(:'i1','authenticated', format('UPDATE public.inst_notes SET body = %L WHERE patient_id = %L', 'x', :'gp')) || public.t_call(:'i1','authenticated', format('DELETE FROM public.inst_notes WHERE patient_id = %L', :'gp')), 'permission denied');
-- Si alguien con acceso a la base apagara el candado y reescribiera una nota, la verificación lo delata.
SELECT body AS body3 FROM public.inst_notes WHERE patient_id = :'gp'::uuid AND seq = 3 \gset
ALTER TABLE public.inst_notes DISABLE TRIGGER trg_inst_note_lock;
UPDATE public.inst_notes SET body = 'Nota reescrita a escondidas.' WHERE patient_id = :'gp'::uuid AND seq = 3;
ALTER TABLE public.inst_notes ENABLE TRIGGER trg_inst_note_lock;
SELECT public.t_true('G.11 una nota reescrita rompe la cadena y se sabe cuál', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok') = 'false'
  AND public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'first_bad_seq') = '3');
ALTER TABLE public.inst_notes DISABLE TRIGGER trg_inst_note_lock;
UPDATE public.inst_notes SET body = :'body3' WHERE patient_id = :'gp'::uuid AND seq = 3;
UPDATE public.inst_notes SET prev_hash = repeat('b', 64) WHERE patient_id = :'gp'::uuid AND seq = 5;
ALTER TABLE public.inst_notes ENABLE TRIGGER trg_inst_note_lock;
SELECT public.t_true('G.12 un eslabón cambiado también', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'first_bad_seq') = '5');
SELECT public.t_eq('G.13 (se restablece) y la cadena vuelve a verificar', (
  SELECT CASE WHEN public.t_sys(format('ALTER TABLE public.inst_notes DISABLE TRIGGER trg_inst_note_lock')) = 'ok' THEN 'x' END) , 'x');
UPDATE public.inst_notes SET prev_hash = (SELECT hash FROM public.inst_notes p WHERE p.patient_id = :'gp'::uuid AND p.seq = 4) WHERE patient_id = :'gp'::uuid AND seq = 5;
ALTER TABLE public.inst_notes ENABLE TRIGGER trg_inst_note_lock;
SELECT public.t_true('G.14 restablecida', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok') = 'true');
-- Qué más delata la verificación (con el candado apagado solo para armar la escena; cada cambio se deshace).
CREATE FUNCTION public.t_tamper(pid uuid, nseq int, who uuid, setexpr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; saved public.inst_notes;
BEGIN
  SELECT * INTO saved FROM public.inst_notes n WHERE n.patient_id = pid AND n.seq = nseq;
  ALTER TABLE public.inst_notes DISABLE TRIGGER trg_inst_note_lock;
  EXECUTE format('UPDATE public.inst_notes SET %s WHERE patient_id = %L AND seq = %s', setexpr, pid, nseq);
  ALTER TABLE public.inst_notes ENABLE TRIGGER trg_inst_note_lock;
  r := public.jget(public.t_call(who, 'authenticated', format('SELECT public.inst_verify_notes(%L::uuid)::text', pid)), 'first_bad_seq');
  ALTER TABLE public.inst_notes DISABLE TRIGGER trg_inst_note_lock;
  UPDATE public.inst_notes SET author_id = saved.author_id, kind = saved.kind, body = saved.body, vitals = saved.vitals, created_at = saved.created_at,
         prev_hash = saved.prev_hash, hash = saved.hash WHERE id = saved.id;
  ALTER TABLE public.inst_notes ENABLE TRIGGER trg_inst_note_lock;
  RETURN COALESCE(r, 'íntegra');
END $$;
SELECT public.t_eq('G.14b cambiar el texto de una nota', public.t_tamper(:'gp'::uuid, 2, :'i1'::uuid, 'body = ''otro texto'''), '2');
SELECT public.t_eq('G.14c cambiar quién la escribió', public.t_tamper(:'gp'::uuid, 2, :'i1'::uuid, format('author_id = %L', :'f1')), '2');
SELECT public.t_eq('G.14d cambiar su tipo', public.t_tamper(:'gp'::uuid, 2, :'i1'::uuid, 'kind = ''family'''), '2');
SELECT public.t_eq('G.14e cambiar su fecha', public.t_tamper(:'gp'::uuid, 2, :'i1'::uuid, 'created_at = created_at + interval ''1 second'''), '2');
SELECT public.t_eq('G.14f agregarle signos que no tenía', public.t_tamper(:'gp'::uuid, 2, :'i1'::uuid, 'vitals = ''{"hr": 1}''::jsonb'), '2');
SELECT public.t_eq('G.14g reescribir una nota Y su propia firma: se delata en la siguiente, que ya no enlaza', public.t_tamper(:'gp'::uuid, 4, :'i1'::uuid,
  'body = ''Reescrita'', hash = public.hx_sha256(public.hx_inst_note_payload(prev_hash, seq, patient_id, author_id, kind, created_at, ''Reescrita'', vitals))'), '5');
SELECT public.t_eq('G.14h tras todo eso, la cadena original quedó intacta', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok'), 'true');
-- Correcciones.
SELECT id AS nid2 FROM public.inst_notes WHERE patient_id = :'gp'::uuid AND seq = 2 \gset
SELECT id AS nida FROM public.inst_notes WHERE patient_id = :'pa'::uuid AND seq = 1 \gset
SELECT public.t_err('G.15 una corrección debe decir cuál nota corrige', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'correction', 'Corrijo algo')), 'invalid_data');
SELECT public.t_err('G.16 y solo las correcciones lo dicen', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, NULL, NULL, %L::uuid)', :'gp', 'evolution', 'No es corrección', :'nid2')), 'invalid_data');
SELECT public.t_err('G.17 la nota corregida es del mismo paciente', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, NULL, NULL, %L::uuid)', :'gp', 'correction', 'Corrección cruzada', :'nida')), 'note_mismatch');
SELECT public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, NULL, NULL, %L::uuid)', :'gp', 'correction', 'Corrección: no hubo fiebre, la temperatura fue 37,1.', :'nid2')) AS corr \gset
SELECT public.t_true('G.18 la corrección es una nota nueva que apunta a la original', public.jget(:'corr','seq') = '7' AND public.jget(:'corr','corrects_note_id') = :'nid2' AND public.jget(:'corr','kind') = 'correction'
  AND (SELECT body FROM public.inst_notes WHERE id = :'nid2'::uuid) = 'Evoluciona favorablemente, sin fiebre.');
SELECT public.t_err('G.19 el caso de la nota es de ese paciente', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, %L::uuid)', :'gp', 'evolution', 'Con caso ajeno', :'cid')), 'case_mismatch');
SELECT public.t_true('G.20 con un caso propio sí', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, %L::uuid)', :'pa', 'evolution', 'Nota ligada al caso', :'cid3')) NOT LIKE 'ERR%');
SELECT public.t_eq('G.21 el texto: una letra, vacío o 4001 caracteres no',
  (SELECT string_agg(k, ',') FROM (VALUES ('una letra','a'), ('vacía','   '), ('larga', repeat('x', 4001)), ('control', E'texto con \x01 control')) AS t(k, b)
    WHERE public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', b)) !~ 'invalid_data'), NULL);
SELECT public.t_true('G.22 4000 caracteres exactos sí; con saltos de línea y tabulaciones también',
  public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', repeat('x', 4000))) NOT LIKE 'ERR%'
  AND public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', E'Línea uno\n\tLínea dos con tabulación')) NOT LIKE 'ERR%');
SELECT public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, NULL, %L::jsonb)', :'gp', 'nursing', 'Signos de la ronda', '{"hr":80,"spo2":"98","evil":"x","news2":2,"temp_c":36.8}')) AS nv \gset
SELECT public.t_eq('G.23 los signos adjuntos se limpian: solo números de la lista', (SELECT vitals::text FROM public.inst_notes WHERE id = public.jget(:'nv','id')::uuid), '{"hr": 80, "news2": 2, "temp_c": 36.8}');
SELECT public.t_err('G.24 pero deben ser un objeto', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L, NULL, %L::jsonb)', :'gp', 'nursing', 'Signos mal', '[1,2]')), 'invalid_data');
SELECT public.t_err('G.25 el personal solo de ofertas no escribe', public.t_rpc(:'m3', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', 'Intruso')), 'forbidden');
SELECT public.t_err('G.26 otra institución no escribe en una historia ajena', public.t_rpc(:'i2', format('public.inst_note_add(%L::uuid, %L, %L)', :'gp', 'evolution', 'Intruso')), 'not_found');
SELECT public.t_err('G.27 ni verifica', public.t_rpc(:'i2', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'not_found');
SELECT max(seq) AS m0 FROM public.inst_notes WHERE patient_id = :'gp'::uuid \gset
SELECT public.t_call(:'i1', 'authenticated', format('SELECT (public.inst_note_add(%L::uuid, %L, %L)->>%L)::int + (public.inst_note_add(%L::uuid, %L, %L)->>%L)::int', :'gp', 'evolution', 'Primera a la vez', 'seq', :'gp', 'evolution', 'Segunda a la vez', 'seq')) AS sumseq \gset
SELECT public.t_eq('G.28 dos notas en la misma transacción reciben secuencias distintas y seguidas', :'sumseq', (2 * :m0 + 3)::text);
SELECT public.t_true('G.29 la cadena sigue íntegra tras todo eso', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok') = 'true');
-- Borrar al paciente o a la institución (cascada) sí se puede: los candados son contra el borrado de una nota suelta.
SELECT public.t_pat(:'i5', '{"full_name":"Efímero Uno"}') AS e1 \gset
SELECT public.t_rpc(:'i5', format('public.inst_note_add(%L::uuid, %L, %L)', :'e1', 'evolution', 'Nota que se irá con el paciente')) AS _n \gset
SELECT public.t_true('G.30 el paciente tiene notas', (SELECT count(*) FROM public.inst_notes WHERE patient_id = :'e1'::uuid) = 2);
SELECT public.t_eq('G.31 al borrar al paciente se van sus notas, casos y registros', public.t_sys(format('DELETE FROM public.inst_patients WHERE id = %L', :'e1')), 'ok');
SELECT public.t_eq('G.32 sin dejar huérfanos', (SELECT count(*)::text FROM public.inst_notes WHERE patient_id = :'e1'::uuid) || (SELECT count(*)::text FROM public.inst_events WHERE patient_id = :'e1'::uuid), '00');
SELECT public.t_pat(:'i5', '{"full_name":"Efímero Dos"}', true) AS e2 \gset
SELECT public.t_rpc(:'i5', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'e2', '{"title":"Caso efímero"}')) AS _c \gset
SELECT public.t_vit(:'i5', :'e2', '{"hr":135,"rr":30,"spo2":90,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS _v \gset
SELECT public.t_true('G.33 la institución efímera tiene de todo', (SELECT count(*) FROM public.inst_notes WHERE institution_id = :'i5'::uuid) >= 1
  AND (SELECT count(*) FROM public.inst_obs WHERE institution_id = :'i5'::uuid) = 1 AND (SELECT count(*) FROM public.inst_alerts WHERE institution_id = :'i5'::uuid) = 1
  AND (SELECT count(*) FROM public.inst_live WHERE institution_id = :'i5'::uuid) = 1);
DELETE FROM public.institution_profiles WHERE user_id = :'i5'::uuid;
SELECT public.t_eq('G.34 al borrar la cuenta de la institución se va todo', public.t_sys(format('DELETE FROM auth.users WHERE id = %L', :'i5')), 'ok');
SELECT public.t_eq('G.35 y no queda nada suyo', (SELECT count(*)::text FROM public.inst_patients WHERE institution_id = :'i5'::uuid) || (SELECT count(*)::text FROM public.inst_notes WHERE institution_id = :'i5'::uuid)
  || (SELECT count(*)::text FROM public.inst_obs WHERE institution_id = :'i5'::uuid) || (SELECT count(*)::text FROM public.inst_alerts WHERE institution_id = :'i5'::uuid)
  || (SELECT count(*)::text FROM public.inst_cases WHERE institution_id = :'i5'::uuid) || (SELECT count(*)::text FROM public.inst_events WHERE institution_id = :'i5'::uuid), '000000');

-- ═══ H) Tareas ═══════════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_rpc(:'m1', format('public.inst_task_add(%L::uuid, %L, %L)', :'gp', 'Llamar a la familia con el resultado', 'call')) AS tk \gset
SELECT public.jget(:'tk', 'id') AS tkid \gset
SELECT public.t_true('H.1 una tarea nueva queda abierta, para mañana, con quién la creó', public.jget(:'tk','status') = 'open' AND public.jget(:'tk','kind') = 'call' AND public.jget(:'tk','source') = 'manual'
  AND public.jget(:'tk','created_by') = :'m1' AND abs(extract(epoch FROM (public.jget(:'tk','due_at')::timestamptz - (now() + interval '1 day')))) < 120);
SELECT public.t_true('H.2 «monitoreo» también agrega tareas (rondas, controles)', public.t_rpc(:'m2', format('public.inst_task_add(%L::uuid, %L, %L, now() + interval %L)', :'gp', 'Ronda de signos de las 6 pm', 'obs_round', '3 hours')) NOT LIKE 'ERR%');
SELECT public.t_err('H.3 el personal solo de ofertas no', public.t_rpc(:'m3', format('public.inst_task_add(%L::uuid, %L)', :'gp', 'Intruso')), 'forbidden');
SELECT public.t_err('H.4 una institución ajena tampoco', public.t_rpc(:'i2', format('public.inst_task_add(%L::uuid, %L)', :'gp', 'Intruso')), 'not_found');
SELECT public.t_eq('H.5 título corto o tipo desconocido no', (SELECT string_agg(k, ',') FROM (VALUES ('título','ab',NULL), ('tipo','Tarea con tipo malo','zzz')) AS t(k, ti, ki)
    WHERE public.t_rpc(:'i1', format('public.inst_task_add(%L::uuid, %L, COALESCE(%L, %L))', :'gp', ti, ki, 'other')) !~ 'invalid_data'), NULL);
SELECT public.t_err('H.6 el caso es del paciente', public.t_rpc(:'i1', format('public.inst_task_add(%L::uuid, %L, %L, NULL, %L::uuid)', :'gp', 'Tarea con caso ajeno', 'other', :'cid')), 'case_mismatch');
SELECT public.t_err('H.7 un paciente con el alta no tiene tareas nuevas', public.t_rpc(:'i3', format('public.inst_task_add(%L::uuid, %L)', :'fp5', 'Tarea tardía')), 'patient_discharged');
SELECT public.t_rpc(:'i1', format('public.inst_task_done(%L::uuid)', :'tkid')) AS td \gset
SELECT public.t_true('H.8 se marca hecha con quién y cuándo', public.jget(:'td','status') = 'done' AND public.jget(:'td','completed_by') = :'i1' AND public.jget(:'td','completed_at') IS NOT NULL
  AND public.jget(:'td','completed_name') = 'Clínica Norte');
SELECT public.t_rpc(:'m1', format('public.inst_task_done(%L::uuid)', :'tkid')) AS td2 \gset
SELECT public.t_true('H.9 marcarla de nuevo no falla ni duplica (dos personas a la vez)', public.jget(:'td2','completed_by') = :'i1'
  AND (SELECT count(*) = 1 FROM public.inst_events WHERE kind = 'task_done' AND patient_id = :'gp'::uuid AND (data ->> 'kind') = 'call'));
SELECT public.t_true('H.10 se puede omitir', public.jget(public.t_rpc(:'i1', format('public.inst_task_done(%L::uuid, %L)', (SELECT id FROM public.inst_tasks WHERE patient_id = :'gp'::uuid AND status = 'open' LIMIT 1), 'skipped')), 'status') = 'skipped');
SELECT public.t_err('H.11 un estado raro no', public.t_rpc(:'i1', format('public.inst_task_done(%L::uuid, %L)', :'tkid', 'zzz')), 'invalid_data');
SELECT public.t_err('H.12 una tarea ajena no existe', public.t_rpc(:'i2', format('public.inst_task_done(%L::uuid)', :'tkid')), 'not_found');
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_task_add(%L::uuid, %L)', :'gp', 'Tarea abierta para probar el aislamiento')), 'id') AS tk_open \gset
SELECT public.t_err('H.12b una tarea ABIERTA de otra institución tampoco se completa', public.t_rpc(:'i2', format('public.inst_task_done(%L::uuid)', :'tk_open')), 'not_found');
SELECT public.t_eq('H.12c y sigue abierta', (SELECT status FROM public.inst_tasks WHERE id = :'tk_open'::uuid), 'open');
SELECT public.t_err('H.13 y quien no es del módulo, no', public.t_rpc(:'m3', format('public.inst_task_done(%L::uuid)', :'tkid')), 'forbidden');

-- ═══ I) Monitoreo: signos vitales, NEWS2 calculado en la base y alertas ═══════════════════════════════════════════
SELECT public.t_pat(:'i1', '{"full_name":"Mario Monitoreo","birth_date":"1950-02-02","modality":"hospital"}', true) AS mp \gset
SELECT public.t_true('I.1 registrado ya en monitoreo: monitoreado y con su primer control pendiente desde ya',
  (SELECT p.monitoring AND p.monitoring_since IS NOT NULL AND l.next_obs_due_at <= now() AND l.last_obs_at IS NULL AND l.last_news2 IS NULL
     FROM public.inst_patients p JOIN public.inst_live l ON l.patient_id = p.id WHERE p.id = :'mp'::uuid));
SELECT public.t_eq('I.2 sin controles registrados, el paciente no tiene puntaje', public.t_call(:'i1','authenticated', format('SELECT last_news2::text FROM public.inst_live WHERE patient_id = %L', :'mp')), 'NULL');
SELECT public.t_vit(:'i1', :'mp', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"dbp":80,"temp_c":36.8,"avpu":"A","on_o2":false,"pain":2,"note":"Control de rutina"}') AS v1 \gset
SELECT public.t_true('I.3 un control normal da NEWS2 0, banda baja, 7 parámetros y ninguna alerta',
  public.jget(:'v1','obs','news2') = '0' AND public.jget(:'v1','obs','band') = 'low' AND public.jget(:'v1','obs','news2_measured') = '7' AND public.jget(:'v1','obs','applicable') = 'true'
  AND public.jget(:'v1','alert') IS NULL AND public.jget(:'v1','obs','source') = 'manual' AND public.jget(:'v1','obs','recorded_by') = :'i1'
  AND public.jget(:'v1','obs','recorded_by_name') = 'Clínica Norte' AND public.jget(:'v1','obs','pain') = '2');
SELECT public.t_true('I.4 lo último del paciente se actualiza: puntaje, banda, valores y el próximo control a las 12 h',
  (SELECT l.last_news2 = 0 AND l.last_band = 'low' AND l.last_obs_source = 'manual' AND l.last_device_at IS NULL
          AND l.last_vitals @> '{"hr":72,"rr":16,"spo2":98,"sbp":120,"dbp":80,"avpu":"A","pain":2,"on_o2":false}'::jsonb AND (l.last_vitals ->> 'temp_c')::numeric = 36.8
          AND abs(extract(epoch FROM l.next_obs_due_at - (l.last_obs_at + interval '12 hours'))) < 1
     FROM public.inst_live l WHERE l.patient_id = :'mp'::uuid));
SELECT public.t_true('I.5 queda la bitácora del control (puntaje y banda, sin los valores)', (SELECT count(*) = 1 AND bool_and(data @> '{"news2":0,"band":"low","source":"manual"}'::jsonb AND NOT data ? 'hr')
  FROM public.inst_events WHERE patient_id = :'mp'::uuid AND kind = 'obs_recorded'));
-- Control parcial: lo que no se midió toma el último valor conocido de las 12 h anteriores.
SELECT public.t_vit(:'m2', :'mp', '{"hr":118}') AS v2 \gset
SELECT public.t_true('I.6 un control parcial arrastra lo último conocido y lo dice', public.jget(:'v2','obs','news2') = '2' AND public.jget(:'v2','obs','news2_measured') = '7'
  AND public.jget(:'v2','obs','band') = 'low' AND (public.jget(:'v2','obs','news2_input')::jsonb -> 'carried') @> '["rr","spo2","on_o2","sbp","avpu","temp_c"]'::jsonb
  AND jsonb_array_length((public.jget(:'v2','obs','news2_input')::jsonb) -> 'carried') = 6 AND public.jget(:'v2','obs','news2_input', 'hr') = '118'
  AND public.jget(:'v2','obs','recorded_by_name') = 'Jorge Monitoreo' AND public.jget(:'v2','alert') IS NULL);
SELECT public.t_true('I.7 el próximo control se pide a las 6 h (puntaje 2) y los valores arrastrados se ven en lo último del paciente',
  (SELECT l.last_news2 = 2 AND (l.last_vitals ->> 'hr')::int = 118 AND (l.last_vitals ->> 'sbp')::int = 120
          AND abs(extract(epoch FROM l.next_obs_due_at - (l.last_obs_at + interval '6 hours'))) < 1 FROM public.inst_live l WHERE l.patient_id = :'mp'::uuid));
-- Ventana de 12 horas.
SELECT public.t_pat(:'i1', '{"full_name":"Ventana Veinte"}', true) AS w20 \gset
SELECT public.t_pat(:'i1', '{"full_name":"Ventana Once"}', true) AS w11 \gset
SELECT public.t_vit(:'i1', :'w20', jsonb_build_object('rr',22,'recorded_at', now() - interval '20 hours')::text) AS _a \gset
SELECT public.t_vit(:'i1', :'w11', jsonb_build_object('rr',22,'recorded_at', now() - interval '11 hours')::text) AS _b \gset
SELECT public.t_vit(:'i1', :'w20', '{"hr":72}') AS vw20 \gset
SELECT public.t_vit(:'i1', :'w11', '{"hr":72}') AS vw11 \gset
SELECT public.t_true('I.8 de hace 20 h no se arrastra: solo cuenta lo medido ahora', public.jget(:'vw20','obs','news2') = '0' AND public.jget(:'vw20','obs','news2_measured') = '1');
SELECT public.t_true('I.9 de hace 11 h sí', public.jget(:'vw11','obs','news2') = '2' AND public.jget(:'vw11','obs','news2_measured') = '2'
  AND (public.jget(:'vw11','obs','news2_input')::jsonb -> 'carried') @> '["rr"]'::jsonb);
-- Arrastre de TODOS los parámetros: un control con solo la temperatura hereda el resto.
SELECT public.t_pat(:'i1', '{"full_name":"Arrastre Total","birth_date":"1950-01-01"}', true) AS cr \gset
SELECT public.t_vit(:'i1', :'cr', jsonb_build_object('rr',22,'spo2',94,'on_o2',false,'sbp',105,'hr',105,'avpu','A','temp_c',38.5,'recorded_at', now() - interval '1 hour')::text) AS _cr0 \gset
SELECT public.t_vit(:'i1', :'cr', '{"temp_c":36.8}') AS vcr \gset
SELECT public.t_true('I.9b un control con solo la temperatura hereda los otros seis: 2+1+1+1 = 5, medidos 7, y dice cuáles arrastró',
  public.jget(:'vcr','obs','news2') = '5' AND public.jget(:'vcr','obs','news2_measured') = '7' AND public.jget(:'vcr','obs','band') = 'medium'
  AND (public.jget(:'vcr','obs','news2_input')::jsonb -> 'carried') @> '["rr","spo2","on_o2","sbp","hr","avpu"]'::jsonb
  AND jsonb_array_length((public.jget(:'vcr','obs','news2_input')::jsonb) -> 'carried') = 6);
-- Hora del control.
SELECT public.t_pat(:'i1', '{"full_name":"Hora Del Control"}', true) AS hc \gset
SELECT public.t_err('I.10 un control en el futuro no', public.t_vit(:'i1', :'hc', jsonb_build_object('hr',70,'recorded_at', now() + interval '1 hour')::text), 'future_time');
SELECT public.t_err('I.11 ni de hace más de 48 horas', public.t_vit(:'i1', :'hc', jsonb_build_object('hr',70,'recorded_at', now() - interval '49 hours')::text), 'too_old');
SELECT public.t_true('I.12 de hace 47 horas sí (cargar lo que se tomó en papel)', public.t_vit(:'i1', :'hc', jsonb_build_object('hr',70,'recorded_at', now() - interval '47 hours')::text) NOT LIKE 'ERR%');
SELECT public.t_err('I.13 una hora que no es hora', public.t_vit(:'i1', :'hc', '{"hr":70,"recorded_at":"ayer en la tarde"}'), 'invalid_data');
-- Qué se rechaza.
SELECT public.t_err('I.14 un control sin ningún valor', public.t_vit(:'i1', :'hc', '{}'), 'empty_vitals');
SELECT public.t_err('I.15 solo una nota no es un control', public.t_vit(:'i1', :'hc', '{"note":"solo una nota"}'), 'empty_vitals');
SELECT public.t_err('I.16 los textos en lugar de números se ignoran: queda vacío', public.t_vit(:'i1', :'hc', '{"hr":"80"}'), 'empty_vitals');
SELECT public.t_true('I.17 un dolor de 0 es un valor', public.t_vit(:'i1', :'hc', '{"pain":0}') NOT LIKE 'ERR%');
SELECT public.t_err('I.18 no es un objeto', public.t_vit(:'i1', :'hc', '[70]'), 'invalid_data');
SELECT count(*) AS nobs_hc FROM public.inst_obs WHERE patient_id = :'hc'::uuid \gset
SELECT public.t_true('I.19 fuera de rango no se acepta: ' || k, public.t_vit(:'i1', :'hc', d) ~ 'invalid_data')
  FROM (VALUES ('pulso 500','{"hr":500}'), ('pulso 10','{"hr":10}'), ('saturación 101','{"spo2":101}'), ('saturación 40','{"spo2":40}'), ('respiración 3','{"rr":3}'), ('respiración 80','{"rr":80}'),
               ('sistólica 20','{"sbp":20}'), ('sistólica 400','{"sbp":400}'), ('diastólica 300','{"dbp":300}'), ('temperatura 50','{"temp_c":50}'), ('temperatura 10','{"temp_c":10}'),
               ('conciencia Z','{"avpu":"Z"}'), ('dolor 11','{"pain":11}'), ('número gigante','{"hr":1e12}')) AS t(k, d);
SELECT public.t_eq('I.20 y ninguno de esos se guardó', (SELECT count(*)::text FROM public.inst_obs WHERE patient_id = :'hc'::uuid), (:'nobs_hc'::int)::text);
SELECT public.t_err('I.21 un paciente que no está en monitoreo', public.t_vit(:'i1', :'pa', '{"hr":70}'), 'not_monitored');
SELECT public.t_err('I.22 uno con el alta tampoco', public.t_vit(:'i3', :'fp5', '{"hr":70}'), 'not_monitored');
SELECT public.t_err('I.23 uno de otra institución no existe', public.t_vit(:'i2', :'mp', '{"hr":70}'), 'not_found');
-- Edad: NEWS2 es para personas de 16 años o más.
SELECT public.t_pat(:'i1', jsonb_build_object('full_name','Justo Dieciséis','birth_date', (current_date - interval '16 years')::date)::text, true) AS a16 \gset
SELECT public.t_pat(:'i1', jsonb_build_object('full_name','Casi Dieciséis','birth_date', (current_date - interval '16 years' + interval '1 day')::date)::text, true) AS a15 \gset
SELECT public.t_pat(:'i1', '{"full_name":"Sin Fecha De Nacimiento"}', true) AS anb \gset
SELECT public.t_vit(:'i1', :'a16', '{"hr":135}') AS va16 \gset
SELECT public.t_vit(:'i1', :'a15', '{"hr":135,"rr":30,"spo2":90}') AS va15 \gset
SELECT public.t_vit(:'i1', :'anb', '{"hr":72}') AS vanb \gset
SELECT public.t_true('I.24 con 16 años cumplidos hoy se puntúa', public.jget(:'va16','obs','applicable') = 'true' AND public.jget(:'va16','obs','news2') = '3');
SELECT public.t_true('I.25 a un día de cumplirlos no: sin puntaje, sin banda y sin alertas de NEWS2', public.jget(:'va15','obs','applicable') = 'false' AND public.jget(:'va15','obs','news2') IS NULL
  AND public.jget(:'va15','obs','band') IS NULL AND public.jget(:'va15','obs','news2_input') IS NULL AND public.jget(:'va15','alert') IS NULL);
SELECT public.t_true('I.26 sin fecha de nacimiento se asume adulta', public.jget(:'vanb','obs','applicable') = 'true' AND public.jget(:'vanb','obs','news2') = '0');
SELECT public.t_true('I.27 en el menor, lo último queda sin puntaje pero con sus valores', (SELECT l.last_news2 IS NULL AND l.last_band IS NULL AND (l.last_vitals ->> 'hr')::int = 135 FROM public.inst_live l WHERE l.patient_id = :'a15'::uuid));
SELECT public.t_eq('I.28 una caída del menor sí alerta (no depende del NEWS2)', public.jget(public.t_vit(:'i1', :'a15', '{"fall":true,"hr":90}'), 'alert', 'reason'), 'fall');
-- Escala 2 de saturación.
SELECT public.t_pat(:'i1', '{"full_name":"Escala Dos","birth_date":"1948-01-01"}', true) AS sc2 \gset
SELECT public.t_pat(:'i1', '{"full_name":"Escala Uno","birth_date":"1948-01-01"}', true) AS sc1 \gset
SELECT public.t_rpc(:'i1', format('public.inst_patient_set_scale(%L::uuid, 2, %L)', :'sc2', 'EPOC con hipercapnia, indicación de neumología')) AS _s2 \gset
SELECT public.t_vit(:'i1', :'sc2', '{"rr":16,"spo2":90,"on_o2":false,"sbp":120,"hr":72,"avpu":"A","temp_c":36.8}') AS vsc2 \gset
SELECT public.t_vit(:'i1', :'sc1', '{"rr":16,"spo2":90,"on_o2":false,"sbp":120,"hr":72,"avpu":"A","temp_c":36.8}') AS vsc1 \gset
SELECT public.t_true('I.29 con 90 % de saturación: escala 2 → 0 puntos (meta 88–92 %); escala 1 → 3', public.jget(:'vsc2','obs','news2') = '0' AND public.jget(:'vsc2','obs','news2_input','scale') = '2'
  AND public.jget(:'vsc1','obs','news2') = '3' AND public.jget(:'vsc1','obs','news2_input','scale') = '1');
SELECT public.t_eq('I.30 escala 2 con oxígeno y 95 %: 2 por la saturación y 2 por el oxígeno', public.jget(public.t_vit(:'i1', :'sc2', '{"spo2":95,"on_o2":true}'), 'obs', 'news2'), '4');

-- Alertas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
SELECT public.t_pat(:'i1', '{"full_name":"Helena Pulso","birth_date":"1945-08-08"}', true) AS hp \gset
SELECT count(*) AS n_i1_0 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert' \gset
SELECT count(*) AS n_m2_0 FROM public.notifications WHERE user_id = :'m2'::uuid AND type = 'inst_alert' \gset
SELECT public.t_vit(:'i1', :'hp', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS vhp \gset
SELECT public.t_true('I.31 un puntaje de 15 abre una alerta crítica de NEWS2 alto',
  public.jget(:'vhp','obs','news2') = '15' AND public.jget(:'vhp','obs','band') = 'high' AND public.jget(:'vhp','alert','severity') = 'critical' AND public.jget(:'vhp','alert','reason') = 'news2_high'
  AND public.jget(:'vhp','alert','status') = 'open' AND public.jget(:'vhp','alert','occurrences') = '1' AND public.jget(:'vhp','alert','news2') = '15'
  AND public.jget(:'vhp','alert','obs_id') = public.jget(:'vhp','obs','id') AND public.jget(:'vhp','alert','message') LIKE '%NEWS2 15%');
SELECT public.t_true('I.32 el plazo para atenderla es de 10 minutos exactos', (SELECT due_ack_at - opened_at = interval '10 minutes' FROM public.inst_alerts WHERE patient_id = :'hp'::uuid AND reason = 'news2_high'));
SELECT public.t_true('I.33 avisa a la institución y al personal con «monitoreo» (uno cada uno), con el nombre abreviado y sin más datos',
  (SELECT count(*) FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert') = :'n_i1_0'::int + 1
  AND (SELECT count(*) FROM public.notifications WHERE user_id = :'m2'::uuid AND type = 'inst_alert') = :'n_m2_0'::int + 1
  AND (SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert' AND title = 'Alerta crítica · NEWS2 15'
         AND body LIKE public.short_display_name('Helena Pulso') || ' · %' AND body NOT LIKE '%1945%' AND link = '/dashboard/institucion?tab=monitoreo')
  AND (SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'m2'::uuid AND type = 'inst_alert' AND title = 'Alerta crítica · NEWS2 15' AND link = '/dashboard/equipo?tab=monitoreo'));
SELECT public.t_true('I.34 y a nadie más: ni «pacientes», ni «ofertas», ni el suspendido, ni otras instituciones',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'inst_alert' AND user_id IN (:'m1'::uuid, :'m3'::uuid, :'m4'::uuid, :'m5'::uuid, :'i2'::uuid, :'f1'::uuid, :'p1'::uuid)));
SELECT public.t_vit(:'i1', :'hp', '{"hr":136}') AS vhp2 \gset
SELECT public.t_true('I.35 si sigue igual no se abre otra: suma una ocurrencia a la misma y no avisa de nuevo',
  public.jget(:'vhp2','alert','occurrences') = '2' AND public.jget(:'vhp2','alert','id') = public.jget(:'vhp','alert','id')
  AND (SELECT count(*) FROM public.inst_alerts WHERE patient_id = :'hp'::uuid AND status <> 'resolved') = 1
  AND (SELECT count(*) FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert') = :'n_i1_0'::int + 1);
SELECT public.t_true('I.36 el índice impide dos abiertas del mismo motivo aunque se intente a la fuerza', public.t_sys(format('INSERT INTO public.inst_alerts(institution_id, patient_id, severity, reason, message, due_ack_at) VALUES (%L, %L, %L, %L, %L, now())', :'i1', :'hp', 'critical', 'news2_high', 'doble')) LIKE '%inst_alerts_open_uq%');
-- Reconocer y resolver.
SELECT public.jget(:'vhp','alert','id') AS ahp \gset
SELECT public.t_err('I.37 solo «monitoreo» reconoce alertas', public.t_rpc(:'m1', format('public.inst_alert_ack(%L::uuid)', :'ahp')), 'forbidden');
SELECT public.t_err('I.38 una alerta ajena no existe', public.t_rpc(:'i2', format('public.inst_alert_ack(%L::uuid)', :'ahp')), 'not_found');
SELECT public.t_err('I.39 ni una inventada', public.t_rpc(:'i1', format('public.inst_alert_ack(%L::uuid)', '11111111-1111-1111-1111-111111111111')), 'not_found');
SELECT public.t_err('I.40 la nota larga no', public.t_rpc(:'i1', format('public.inst_alert_ack(%L::uuid, %L)', :'ahp', repeat('x', 301))), 'invalid_data');
SELECT public.t_rpc(:'m2', format('public.inst_alert_ack(%L::uuid, %L)', :'ahp', 'Voy para allá')) AS ack1 \gset
SELECT public.t_true('I.41 reconocida: queda quién, cuándo y su nota', public.jget(:'ack1','status') = 'acknowledged' AND public.jget(:'ack1','acked_by') = :'m2' AND public.jget(:'ack1','acked_by_name') = 'Jorge Monitoreo'
  AND public.jget(:'ack1','ack_note') = 'Voy para allá' AND public.jget(:'ack1','acked_at') IS NOT NULL);
SELECT public.t_true('I.42 y la bitácora dice si fue a tiempo', (SELECT count(*) = 1 AND bool_and((data ->> 'on_time')::boolean AND data ->> 'severity' = 'critical') FROM public.inst_events WHERE kind = 'alert_ack' AND patient_id = :'hp'::uuid));
SELECT public.t_rpc(:'i1', format('public.inst_alert_ack(%L::uuid, %L)', :'ahp', 'Otra persona')) AS ack2 \gset
SELECT public.t_true('I.43 reconocerla otra vez no cambia nada ni falla', public.jget(:'ack2','acked_by') = :'m2' AND public.jget(:'ack2','ack_note') = 'Voy para allá'
  AND (SELECT count(*) = 1 FROM public.inst_events WHERE kind = 'alert_ack' AND patient_id = :'hp'::uuid));
SELECT public.t_err('I.44 resolver pide cómo se resolvió', public.t_rpc(:'i1', format('public.inst_alert_resolve(%L::uuid, %L)', :'ahp', 'zzz')), 'invalid_data');
SELECT public.t_rpc(:'i1', format('public.inst_alert_resolve(%L::uuid, %L, %L)', :'ahp', 'treated', 'Se trasladó y se estabilizó')) AS rs \gset
SELECT public.t_true('I.45 resuelta: queda quién, cómo y su nota', public.jget(:'rs','status') = 'resolved' AND public.jget(:'rs','resolution') = 'treated' AND public.jget(:'rs','resolved_by') = :'i1'
  AND public.jget(:'rs','resolved_by_name') = 'Clínica Norte' AND public.jget(:'rs','resolve_note') = 'Se trasladó y se estabilizó' AND public.jget(:'rs','acked_by') = :'m2');
SELECT public.t_true('I.46 resolverla de nuevo o reconocerla ya resuelta no cambia nada', public.jget(public.t_rpc(:'m2', format('public.inst_alert_resolve(%L::uuid, %L)', :'ahp', 'false_alarm')), 'resolution') = 'treated'
  AND public.jget(public.t_rpc(:'m2', format('public.inst_alert_ack(%L::uuid)', :'ahp')), 'status') = 'resolved');
SELECT public.t_vit(:'i1', :'hp', '{"hr":137}') AS vhp3 \gset
SELECT public.t_true('I.47 si vuelve a empeorar, se abre una alerta NUEVA y se avisa otra vez', public.jget(:'vhp3','alert','id') <> :'ahp' AND public.jget(:'vhp3','alert','status') = 'open'
  AND public.jget(:'vhp3','alert','occurrences') = '1' AND (SELECT count(*) FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert') = :'n_i1_0'::int + 2);
-- Resolver sin haberla reconocido: queda reconocida por quien la resolvió.
SELECT public.t_rpc(:'m2', format('public.inst_alert_resolve(%L::uuid, %L)', public.jget(:'vhp3','alert','id'), 'false_alarm')) AS rs2 \gset
SELECT public.t_true('I.48 resolverla directo también deja constancia de quién la vio', public.jget(:'rs2','resolution') = 'false_alarm' AND public.jget(:'rs2','acked_by') = :'m2' AND public.jget(:'rs2','acked_at') IS NOT NULL);

-- Urgente y luego crítica: la menor queda reemplazada; con la crítica abierta, un puntaje menor no abre otra.
SELECT public.t_pat(:'i1', '{"full_name":"Sara Supera","birth_date":"1950-01-01"}', true) AS sp \gset
SELECT public.t_vit(:'i1', :'sp', '{"rr":22,"hr":105,"sbp":105,"temp_c":38.5,"spo2":95,"avpu":"A","on_o2":false}') AS vsp1 \gset
SELECT public.t_true('I.49 NEWS2 6 es banda media: alerta urgente con 30 minutos', public.jget(:'vsp1','obs','news2') = '6' AND public.jget(:'vsp1','obs','band') = 'medium'
  AND public.jget(:'vsp1','alert','severity') = 'urgent' AND public.jget(:'vsp1','alert','reason') = 'news2_medium'
  AND (SELECT due_ack_at - opened_at = interval '30 minutes' FROM public.inst_alerts WHERE patient_id = :'sp'::uuid AND reason = 'news2_medium'));
SELECT public.t_true('I.50 y avisa («Alerta urgente · NEWS2 6»)', (SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert' AND title = 'Alerta urgente · NEWS2 6'
  AND body LIKE public.short_display_name('Sara Supera') || ' · %'));
SELECT public.t_vit(:'i1', :'sp', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C"}') AS vsp2 \gset
SELECT public.t_true('I.51 al subir a crítica, la urgente queda reemplazada por el sistema', public.jget(:'vsp2','alert','reason') = 'news2_high'
  AND (SELECT count(*) = 1 AND bool_and(resolution = 'auto' AND resolved_by_name = 'Sistema' AND resolve_note = 'Reemplazada por una alerta de mayor gravedad')
         FROM public.inst_alerts WHERE patient_id = :'sp'::uuid AND reason = 'news2_medium' AND status = 'resolved')
  AND (SELECT count(*) = 1 FROM public.inst_alerts WHERE patient_id = :'sp'::uuid AND status <> 'resolved'));
SELECT public.t_vit(:'i1', :'sp', '{"rr":22,"hr":105,"sbp":105,"temp_c":38.5,"spo2":95,"avpu":"A","on_o2":false}') AS vsp3 \gset
SELECT public.t_true('I.52 con la crítica abierta, un puntaje menor no abre otra', public.jget(:'vsp3','obs','news2') = '6' AND public.jget(:'vsp3','alert','reason') = 'news2_high'
  AND (SELECT count(*) = 1 FROM public.inst_alerts WHERE patient_id = :'sp'::uuid AND status <> 'resolved') AND (SELECT count(*) = 2 FROM public.inst_alerts WHERE patient_id = :'sp'::uuid));
-- Un solo parámetro con 3 puntos: atención (2 h), sin aviso.
SELECT public.t_pat(:'i1', '{"full_name":"Tomás Tres","birth_date":"1955-01-01"}', true) AS s3 \gset
SELECT public.t_vit(:'i1', :'s3', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"temp_c":36.8,"avpu":"A","on_o2":false}') AS _s3a \gset
SELECT count(*) AS n_i1_1 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert' \gset
SELECT public.t_vit(:'i1', :'s3', '{"hr":135}') AS vs3 \gset
SELECT public.t_true('I.53 un solo parámetro con 3 puntos: banda «atención», alerta de 2 h', public.jget(:'vs3','obs','news2') = '3' AND public.jget(:'vs3','obs','band') = 'low_medium'
  AND public.jget(:'vs3','alert','severity') = 'warn' AND public.jget(:'vs3','alert','reason') = 'news2_single'
  AND (SELECT due_ack_at - opened_at = interval '2 hours' FROM public.inst_alerts WHERE patient_id = :'s3'::uuid AND status <> 'resolved'));
SELECT public.t_eq('I.54 las de atención no generan avisos (evitar la fatiga de alarmas): se ven en el tablero', (SELECT count(*)::text FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert'), :'n_i1_1');
-- Empeoramiento rápido (≥ 3 puntos en menos de 6 h) sin llegar a las bandas altas.
SELECT public.t_pat(:'i1', '{"full_name":"Dora Deterioro","birth_date":"1952-01-01"}', true) AS dp \gset
SELECT public.t_vit(:'i1', :'dp', jsonb_build_object('hr',72,'rr',16,'spo2',98,'sbp',120,'temp_c',36.8,'avpu','A','on_o2',false,'recorded_at', now() - interval '1 hour')::text) AS _d0 \gset
SELECT public.t_vit(:'i1', :'dp', '{"rr":22}') AS vdp0 \gset
SELECT public.t_true('I.55 subir 2 puntos no alerta', public.jget(:'vdp0','obs','news2') = '2' AND public.jget(:'vdp0','alert') IS NULL);
SELECT public.t_vit(:'i1', :'dp', '{"hr":105}') AS vdp \gset
SELECT public.t_true('I.56 subir 3 en menos de 6 h sí (de 0 a 3 con ningún parámetro en 3): alerta de deterioro', public.jget(:'vdp','obs','news2') = '3' AND public.jget(:'vdp','obs','band') = 'low'
  AND public.jget(:'vdp','alert','reason') = 'deterioration' AND public.jget(:'vdp','alert','severity') = 'warn' AND public.jget(:'vdp','alert','message') LIKE '%subió 3 puntos%de 0 a 3%');
-- Subir solo 2 puntos (de 1 a 3) no es deterioro; y la comparación es con las últimas 6 horas, no con ayer.
SELECT public.t_pat(:'i1', '{"full_name":"Dos Puntos","birth_date":"1952-01-01"}', true) AS d2 \gset
SELECT public.t_vit(:'i1', :'d2', jsonb_build_object('hr',100,'rr',16,'spo2',98,'sbp',120,'temp_c',36.8,'avpu','A','on_o2',false,'recorded_at', now() - interval '1 hour')::text) AS _d2a \gset
SELECT public.t_vit(:'i1', :'d2', '{"rr":22}') AS vd2 \gset
SELECT public.t_true('I.56b de 1 a 3 (dos puntos) no alerta', public.jget(:'vd2','obs','news2') = '3' AND public.jget(:'vd2','alert') IS NULL);
SELECT public.t_pat(:'i1', '{"full_name":"Ocho Horas","birth_date":"1952-01-01"}', true) AS d8 \gset
SELECT public.t_vit(:'i1', :'d8', jsonb_build_object('hr',72,'rr',16,'spo2',98,'sbp',120,'temp_c',36.8,'avpu','A','on_o2',false,'recorded_at', now() - interval '8 hours')::text) AS _d8a \gset
SELECT public.t_vit(:'i1', :'d8', '{"rr":22,"hr":105}') AS vd8 \gset
SELECT public.t_true('I.56c y si el punto de partida es de hace 8 horas, ya no cuenta para el deterioro', public.jget(:'vd8','obs','news2') = '3' AND public.jget(:'vd8','alert') IS NULL);
-- Caída.
SELECT public.t_pat(:'i1', '{"full_name":"Carlos Caída","birth_date":"1940-01-01"}', true) AS fl \gset
SELECT public.t_vit(:'i1', :'fl', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"temp_c":36.8,"avpu":"A","on_o2":false}') AS _f0 \gset
SELECT public.t_vit(:'i1', :'fl', '{"fall":true,"hr":88}') AS vfl \gset
SELECT public.t_true('I.57 una caída reportada abre una alerta urgente propia, aunque el puntaje sea 0', public.jget(:'vfl','obs','news2') = '0' AND public.jget(:'vfl','obs','fall') = 'true'
  AND public.jget(:'vfl','alert','reason') = 'fall' AND public.jget(:'vfl','alert','severity') = 'urgent'
  AND (SELECT due_ack_at - opened_at = interval '30 minutes' FROM public.inst_alerts WHERE patient_id = :'fl'::uuid AND reason = 'fall'));

-- Cierre automático ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) reconocida: dos controles seguidos en «estable» (con 10 min o más entre ellos) la cierran sola.
SELECT public.t_pat(:'i1', '{"full_name":"Aída Auto","birth_date":"1947-01-01"}', true) AS ap \gset
SELECT public.t_vit(:'i1', :'ap', jsonb_build_object('rr',30,'spo2',90,'hr',135,'sbp',85,'avpu','C','temp_c',36.5,'on_o2',false,'recorded_at', now() - interval '3 hours')::text) AS vap \gset
SELECT public.t_rpc(:'m2', format('public.inst_alert_ack(%L::uuid)', public.jget(:'vap','alert','id'))) AS _ap_ack \gset
SELECT public.t_vit(:'i1', :'ap', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '2 hours')::text) AS _ap1 \gset
SELECT public.t_eq('I.58 tras UN control estable, la reconocida sigue abierta', (SELECT status FROM public.inst_alerts WHERE patient_id = :'ap'::uuid), 'acknowledged');
SELECT public.t_vit(:'i1', :'ap', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '1 hour')::text) AS _ap2 \gset
SELECT public.t_true('I.59 tras DOS, se cierra sola con el motivo y el sistema como autor', (SELECT status = 'resolved' AND resolution = 'auto' AND resolved_by_name = 'Sistema'
  AND resolve_note = 'El puntaje volvió a la normalidad en dos controles seguidos' AND acked_by = :'m2'::uuid FROM public.inst_alerts WHERE patient_id = :'ap'::uuid));
-- (b) crítica sin reconocer: NO se cierra sola.
SELECT public.t_pat(:'i1', '{"full_name":"Úrsula Urgente","birth_date":"1947-01-01"}', true) AS up \gset
SELECT public.t_vit(:'i1', :'up', jsonb_build_object('rr',30,'spo2',90,'hr',135,'sbp',85,'avpu','C','temp_c',36.5,'on_o2',false,'recorded_at', now() - interval '3 hours')::text) AS _up0 \gset
SELECT public.t_vit(:'i1', :'up', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '2 hours')::text) AS _up1 \gset
SELECT public.t_vit(:'i1', :'up', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '1 hour')::text) AS _up2 \gset
SELECT public.t_true('I.60 una crítica que nadie vio no se cierra sola: alguien tiene que verla', (SELECT status = 'open' AND resolved_at IS NULL FROM public.inst_alerts WHERE patient_id = :'up'::uuid));
-- (c) de atención (warn): sí, aunque nadie la haya visto.
SELECT public.t_pat(:'i1', '{"full_name":"Wendy Warn","birth_date":"1947-01-01"}', true) AS wp \gset
SELECT public.t_vit(:'i1', :'wp', jsonb_build_object('rr',16,'spo2',98,'hr',135,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '3 hours')::text) AS vwp0 \gset
SELECT public.t_vit(:'i1', :'wp', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '2 hours')::text) AS _wp1 \gset
SELECT public.t_vit(:'i1', :'wp', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '1 hour')::text) AS _wp2 \gset
SELECT public.t_true('I.61 las de atención sin ver se cierran solas tras dos controles estables', public.jget(:'vwp0','alert','severity') = 'warn' AND (SELECT status = 'resolved' AND resolution = 'auto' FROM public.inst_alerts WHERE patient_id = :'wp'::uuid));
-- (d) la caída no se cierra sola.
SELECT public.t_vit(:'i1', :'fl', '{"hr":72}') AS _fl1 \gset
SELECT public.t_vit(:'i1', :'fl', jsonb_build_object('hr',72,'rr',16,'recorded_at', now() + interval '2 minutes')::text) AS _fl2 \gset
SELECT public.t_true('I.62 la caída tampoco: requiere constancia de que alguien la atendió', (SELECT status = 'open' FROM public.inst_alerts WHERE patient_id = :'fl'::uuid AND reason = 'fall'));
-- (e) controles seguidos con menos de 10 minutos de separación no cuentan como «dos».
SELECT public.t_pat(:'i1', '{"full_name":"Rafa Rápido","birth_date":"1947-01-01"}', true) AS rp \gset
SELECT public.t_vit(:'i1', :'rp', jsonb_build_object('rr',16,'spo2',98,'hr',135,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '40 minutes')::text) AS _rp0 \gset
SELECT public.t_vit(:'i1', :'rp', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '35 minutes')::text) AS _rp1 \gset
SELECT public.t_vit(:'i1', :'rp', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '31 minutes')::text) AS _rp2 \gset
SELECT public.t_true('I.63 tres controles estables en 5 minutos no bastan: sigue abierta', (SELECT status = 'open' FROM public.inst_alerts WHERE patient_id = :'rp'::uuid));
SELECT public.t_vit(:'i1', :'rp', jsonb_build_object('rr',16,'spo2',98,'hr',72,'sbp',120,'avpu','A','temp_c',36.8,'on_o2',false,'recorded_at', now() - interval '10 minutes')::text) AS _rp3 \gset
SELECT public.t_true('I.64 con uno 10 minutos después, ya se cierra', (SELECT status = 'resolved' AND resolution = 'auto' FROM public.inst_alerts WHERE patient_id = :'rp'::uuid));
-- Un control atrasado no pisa lo último.
SELECT public.t_pat(:'i1', '{"full_name":"Lía Lectura","birth_date":"1947-01-01"}', true) AS lp \gset
SELECT public.t_vit(:'i1', :'lp', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"avpu":"A","temp_c":36.8,"on_o2":false}') AS _lp1 \gset
SELECT public.t_vit(:'i1', :'lp', jsonb_build_object('hr',140,'recorded_at', now() - interval '2 hours')::text) AS _lp2 \gset
SELECT public.t_true('I.65 cargar un control de hace 2 horas no pisa lo último del paciente', (SELECT last_vitals ->> 'hr' = '72' AND last_news2 = 0 FROM public.inst_live WHERE patient_id = :'lp'::uuid)
  AND (SELECT count(*) = 2 FROM public.inst_obs WHERE patient_id = :'lp'::uuid));

-- ═══ J) Escalamiento: alertas sin atender a tiempo ═════════════════════════════════════════════════════════════════
SELECT public.t_pat(:'i1', '{"full_name":"Elisa Escala","birth_date":"1946-01-01"}', true) AS ep \gset
SELECT public.t_vit(:'i1', :'ep', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS vep \gset
SELECT public.jget(:'vep','alert','id') AS aep \gset
SELECT public.t_eq('J.1 antes de vencer el plazo no se escala', public.t_rpc(:'m2', 'public.inst_escalate_due()'), '0');
UPDATE public.inst_alerts SET due_ack_at = now() - interval '1 minute' WHERE id = :'aep'::uuid;
SELECT count(*) AS esc_i1_0 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert_escalated' \gset
SELECT public.t_eq('J.2 vencido el plazo, la pantalla pide escalar y se escala una', public.t_rpc(:'m2', 'public.inst_escalate_due()'), '1');
SELECT public.t_true('J.3 la alerta queda escalada y se avisa a la institución y al personal con «monitoreo»',
  (SELECT escalated_at IS NOT NULL AND escalation_level = 1 AND status = 'open' FROM public.inst_alerts WHERE id = :'aep'::uuid)
  AND (SELECT count(*) FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert_escalated') = :'esc_i1_0'::int + 1
  AND (SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'m2'::uuid AND type = 'inst_alert_escalated' AND title = 'Alerta sin atender'
         AND body LIKE public.short_display_name('Elisa Escala') || ' · pasó el plazo de atención (%min).')
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'inst_alert_escalated' AND user_id IN (:'m1'::uuid, :'m3'::uuid, :'m4'::uuid, :'m5'::uuid, :'i2'::uuid)));
SELECT public.t_err('J.3b otra institución no puede resolver una alerta abierta ajena', public.t_rpc(:'i2', format('public.inst_alert_resolve(%L::uuid, %L)', :'aep', 'treated')), 'not_found');
SELECT public.t_eq('J.3c y sigue abierta y sin reconocer', (SELECT status || '/' || COALESCE(acked_by::text, 'nadie') FROM public.inst_alerts WHERE id = :'aep'::uuid), 'open/nadie');
SELECT public.t_eq('J.4 no se escala dos veces', public.t_rpc(:'i1', 'public.inst_escalate_due()'), '0');
SELECT public.t_true('J.5 queda en la bitácora', (SELECT count(*) = 1 FROM public.inst_events WHERE kind = 'alert_escalated' AND patient_id = :'ep'::uuid AND (data ->> 'alert') = :'aep'));
-- Lo reconocido, lo de atención y lo resuelto no se escalan.
SELECT public.t_pat(:'i1', '{"full_name":"Tulio Tarde","birth_date":"1946-01-01"}', true) AS tp \gset
SELECT public.t_vit(:'i1', :'tp', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS vtp \gset
SELECT public.t_rpc(:'m2', format('public.inst_alert_ack(%L::uuid)', public.jget(:'vtp','alert','id'))) AS _tp_ack \gset
UPDATE public.inst_alerts SET due_ack_at = now() - interval '1 minute' WHERE patient_id = :'tp'::uuid;
UPDATE public.inst_alerts SET due_ack_at = now() - interval '1 minute' WHERE id = public.jget(:'vs3','alert','id')::uuid;
SELECT public.t_eq('J.6 una alerta ya reconocida, una de atención o una resuelta no se escalan', public.t_rpc(:'i1', 'public.inst_escalate_due()'), '0');
-- Se revisa también cuando entra un control (no hace falta que alguien tenga la pantalla abierta).
SELECT public.t_pat(:'i1', '{"full_name":"Olga Oportuna","birth_date":"1946-01-01"}', true) AS op \gset
SELECT public.t_vit(:'i1', :'op', '{"rr":22,"hr":105,"sbp":105,"temp_c":38.5,"spo2":95,"avpu":"A","on_o2":false}') AS vop \gset
UPDATE public.inst_alerts SET due_ack_at = now() - interval '5 minutes' WHERE patient_id = :'op'::uuid;
SELECT public.t_vit(:'m2', :'lp', '{"hr":73}') AS _trig \gset
SELECT public.t_true('J.7 un control de otro paciente dispara la revisión y la vencida se escala', (SELECT escalated_at IS NOT NULL FROM public.inst_alerts WHERE patient_id = :'op'::uuid));
SELECT public.t_err('J.8 solo quien tiene «monitoreo» pide escalar', public.t_rpc(:'m1', 'public.inst_escalate_due()') || public.t_rpc(:'f1', 'public.inst_escalate_due()'), 'forbidden');

-- Revisión de todas las instituciones a la vez (lo que corre cada minuto con pg_cron).
SELECT public.t_pat(:'i4', '{"full_name":"Paciente Cuatro","birth_date":"1950-01-01"}', true) AS p4 \gset
SELECT public.t_vit(:'i4', :'p4', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS v4 \gset
SELECT public.t_pat(:'i1', '{"full_name":"Paciente Uno Global","birth_date":"1950-01-01"}', true) AS p1g \gset
SELECT public.t_vit(:'i1', :'p1g', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS v1g \gset
UPDATE public.inst_alerts SET due_ack_at = now() - interval '2 minutes' WHERE id IN (public.jget(:'v4','alert','id')::uuid, public.jget(:'v1g','alert','id')::uuid);
SELECT public.t_eq('J.9 la revisión global escala las vencidas de todas las instituciones', public.hx_inst_escalate_all()::text, '2');
SELECT public.t_true('J.10 cada alerta queda escalada y avisa a su propia institución (y a nadie más)',
  (SELECT count(*) = 2 AND bool_and(escalation_level = 1) FROM public.inst_alerts WHERE id IN (public.jget(:'v4','alert','id')::uuid, public.jget(:'v1g','alert','id')::uuid))
  AND (SELECT count(*) >= 1 FROM public.notifications WHERE user_id = :'i4'::uuid AND type = 'inst_alert_escalated' AND body LIKE public.short_display_name('Paciente Cuatro') || '%')
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'inst_alert_escalated' AND body LIKE public.short_display_name('Paciente Cuatro') || '%'));
SELECT public.t_eq('J.11 y una segunda pasada no repite nada', public.hx_inst_escalate_all()::text, '0');
SELECT public.t_err('J.12 la revisión global no se llama desde la API', public.t_call(:'i1', 'authenticated', 'SELECT public.hx_inst_escalate_all()::text') || public.t_call(NULL, 'anon', 'SELECT public.hx_inst_purge_all()::text'), 'permission denied');
SELECT public.t_true('J.13 existe el índice que la hace barata', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'inst_alerts_due_idx' AND indexdef LIKE '%WHERE%escalated_at IS NULL%'));

-- ═══ K) Dispositivos: emparejar, ingesta pública con frenos, límites del plan y revocación ═════════════════════════
SELECT public.t_pat(:'i1', '{"full_name":"Dora Dispositivo","birth_date":"1950-04-04"}', true) AS dv \gset
SELECT public.t_rpc(:'m2', format('public.inst_device_create(%L::uuid, %L, %L)', :'dv', 'Reloj Samsung', 'smartwatch')) AS dc1 \gset
SELECT public.jget(:'dc1', 'code') AS code1, public.jget(:'dc1', 'device', 'id') AS did1 \gset
SELECT public.t_true('K.1 el código se entrega UNA vez: formato fijo de 35 caracteres y el dispositivo sin su huella', :'code1' ~ '^hx_[0-9a-f]{32}$'
  AND public.jget(:'dc1','device','code_hash') IS NULL AND public.jget(:'dc1','device','code_hint') = right(:'code1', 4) AND public.jget(:'dc1','device','status') = 'active'
  AND public.jget(:'dc1','device','created_by') = :'m2' AND public.jget(:'dc1','device','label') = 'Reloj Samsung' AND public.jget(:'dc1','code') IS NOT NULL);
SELECT public.t_true('K.2 en la base solo queda la huella (SHA-256), nunca el código', (SELECT code_hash = public.hx_sha256(:'code1') AND code_hash <> :'code1' AND code_hint = right(:'code1', 4) FROM public.inst_devices WHERE id = :'did1'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.inst_devices WHERE code_hash = :'code1' OR code_hint = :'code1' OR label = :'code1')
  AND NOT EXISTS (SELECT 1 FROM public.inst_events WHERE data::text LIKE '%' || :'code1' || '%'));
SELECT public.t_true('K.3 la lista que ve la pantalla trae las columnas permitidas, sin la huella', public.t_call(:'i1','authenticated', format('SELECT label || %L || code_hint || %L || status FROM public.inst_devices WHERE id = %L', '/', '/', :'did1')) = 'Reloj Samsung/' || right(:'code1', 4) || '/active');
SELECT public.t_err('K.4 «pacientes» solo no empareja dispositivos', public.t_rpc(:'m1', format('public.inst_device_create(%L::uuid, %L)', :'dv', 'Intruso')), 'forbidden');
SELECT public.t_err('K.5 una institución ajena no existe', public.t_rpc(:'i2', format('public.inst_device_create(%L::uuid, %L)', :'dv', 'Intruso')), 'not_found');
SELECT public.t_err('K.6 el paciente debe estar en monitoreo', public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'pa', 'Sin monitoreo')), 'not_monitored');
SELECT public.t_err('K.7 nombre muy corto', public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'dv', 'a')), 'invalid_data');
SELECT public.t_err('K.8 tipo desconocido', public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L, %L)', :'dv', 'Aparato raro', 'zzz')), 'invalid_data');
-- Tope del plan: 300 dispositivos activos.
INSERT INTO public.inst_devices(institution_id, patient_id, label, code_hash, code_hint, created_by)
  SELECT :'i1'::uuid, :'dv'::uuid, 'Relleno ' || g, public.hx_sha256('relleno' || g), 'xxxx', :'i1'::uuid FROM generate_series(1, 299) AS g;
SELECT public.t_err('K.9 el dispositivo 301 no entra', public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'dv', 'Uno de más')), 'device_limit');
DELETE FROM public.inst_devices WHERE label LIKE 'Relleno %';
-- Ingesta (sin sesión).
SELECT public.t_ing(:'code1', '{"hr":75,"spo2":97,"rr":15,"sbp":118,"dbp":76,"temp_c":36.7}') AS ing1 \gset
SELECT public.t_true('K.10 una lectura válida responde solo «ok» (no devuelve datos de salud)', :'ing1'::jsonb = '{"ok": true}'::jsonb);
SELECT public.t_true('K.11 queda como lectura de dispositivo con su puntaje y sin persona asociada',
  (SELECT o.source = 'device' AND o.device_id = :'did1'::uuid AND o.recorded_by IS NULL AND o.recorded_by_name = 'Reloj Samsung' AND o.hr = 75 AND o.rr = 15 AND o.spo2 = 97 AND o.sbp = 118
          AND o.dbp = 76 AND o.temp_c = 36.7 AND o.news2 = 0 AND o.band = 'low' AND o.news2_measured = 5 FROM public.inst_obs o WHERE o.patient_id = :'dv'::uuid AND o.source = 'device'));
SELECT public.t_true('K.12 lo último del paciente marca «en línea» y el dispositivo su última lectura',
  (SELECT l.last_device_at > now() - interval '1 minute' AND l.last_obs_source = 'device' FROM public.inst_live l WHERE l.patient_id = :'dv'::uuid)
  AND (SELECT last_ingest_at > now() - interval '1 minute' FROM public.inst_devices WHERE id = :'did1'::uuid));
SELECT public.t_eq('K.13 las lecturas automáticas no llenan la bitácora', (SELECT count(*)::text FROM public.inst_events WHERE patient_id = :'dv'::uuid AND kind = 'obs_recorded'), '0');
SELECT public.t_ing(:'code1', '{"hr":76}') AS ing2 \gset
SELECT public.t_true('K.14 otra lectura enseguida se frena: máximo una por minuto', :'ing2'::jsonb = '{"ok": true, "throttled": true}'::jsonb AND (SELECT count(*) = 1 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device'));
SELECT public.t_ing(:'code1', '{"hr":77,"fall":true}') AS ing3 \gset
SELECT public.t_true('K.15 pero una caída siempre pasa y alerta', :'ing3'::jsonb = '{"ok": true}'::jsonb AND (SELECT count(*) = 2 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device')
  AND (SELECT count(*) = 1 FROM public.inst_alerts WHERE patient_id = :'dv'::uuid AND reason = 'fall' AND severity = 'urgent'));
UPDATE public.inst_devices SET last_ingest_at = now() - interval '2 minutes' WHERE id = :'did1'::uuid;
SELECT public.t_true('K.16 pasado el minuto, vuelve a aceptar', public.t_ing(:'code1', '{"hr":78}')::jsonb = '{"ok": true}'::jsonb);
-- Códigos que no sirven.
SELECT count(*) AS nf0 FROM public.inst_ingest_failures \gset
SELECT public.t_eq('K.17 un código bien formado pero inventado', public.t_ing('hx_' || replace(gen_random_uuid()::text, '-', ''), '{"hr":70}'), '{"ok": false, "error": "invalid_code"}');
SELECT public.t_true('K.18 los mal formados tampoco', public.t_ing('hola', '{"hr":70}') LIKE '%invalid_code%' AND public.t_ing('', '{"hr":70}') LIKE '%invalid_code%'
  AND public.t_ing('hx_XYZ', '{"hr":70}') LIKE '%invalid_code%' AND public.t_ing(NULL, '{"hr":70}') LIKE '%invalid_code%' AND public.t_ing(upper(:'code1'), '{"hr":70}') LIKE '%invalid_code%');
SELECT public.t_eq('K.19 cada intento fallido deja una huella de quien llama (nunca la IP)', (SELECT (count(*) - :'nf0'::int)::text FROM public.inst_ingest_failures), '6');
SELECT public.t_true('K.20 y esa huella no contiene ninguna IP', NOT EXISTS (SELECT 1 FROM public.inst_ingest_failures WHERE ip_hash !~ '^[0-9a-f]{64}$'));
-- Lecturas con basura.
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_ing(:'code1', '{"hr":"abc","spo2":250,"temp_c":36.5,"rr":null}') AS ing4 \gset
SELECT public.t_true('K.21 un valor imposible se descarta y el resto se conserva', :'ing4'::jsonb = '{"ok": true}'::jsonb
  AND (SELECT hr IS NULL AND spo2 IS NULL AND rr IS NULL AND temp_c = 36.5 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' ORDER BY created_at DESC, id LIMIT 1));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_eq('K.22 si todo es imposible, no hay lectura', public.t_ing(:'code1', '{"hr":0,"rr":0,"spo2":10,"sbp":1,"temp_c":99}'), '{"ok": false, "error": "empty_reading"}');
SELECT public.t_true('K.23 lo que no es un objeto, tampoco', public.t_ing(:'code1', '[]') LIKE '%invalid_reading%' AND public.t_ing(:'code1', '"x"') LIKE '%invalid_reading%' AND public.t_ing(:'code1', '5') LIKE '%invalid_reading%'
  AND public.t_call(NULL, 'anon', format('SELECT public.inst_device_ingest(%L, NULL)::text', :'code1')) LIKE '%invalid_reading%');
SELECT public.t_ing(:'code1', '{"hr":72.6}') AS _r \gset
SELECT public.t_eq('K.24 los decimales se redondean como en el NEWS2', (SELECT hr::text FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' ORDER BY created_at DESC, id LIMIT 1), '73');
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_ing(:'code1', '{"hr":80,"recorded_at":"2999-01-01T00:00:00Z"}') AS _f \gset
SELECT public.t_true('K.25 una hora en el futuro se reemplaza por la de ahora', (SELECT abs(extract(epoch FROM recorded_at - now())) < 60 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' ORDER BY created_at DESC, id LIMIT 1));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_ing(:'code1', '{"hr":81,"recorded_at":"no es una fecha"}') AS _g \gset
SELECT public.t_true('K.26 una hora que no es hora también', (SELECT abs(extract(epoch FROM recorded_at - now())) < 60 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' ORDER BY created_at DESC, id LIMIT 1));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_ing(:'code1', jsonb_build_object('hr', 82, 'recorded_at', (now() - interval '30 minutes'))::text) AS _h \gset
SELECT public.t_true('K.27 una de hace 30 minutos se guarda con su hora (el dispositivo sincroniza tarde)', (SELECT abs(extract(epoch FROM recorded_at - (now() - interval '30 minutes'))) < 60 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' AND hr = 82));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_ing(:'code1', jsonb_build_object('hr', 83, 'recorded_at', (now() - interval '3 hours'))::text) AS _i \gset
SELECT public.t_true('K.28 una de hace 3 horas no se acepta con esa hora: se toma como de ahora', (SELECT abs(extract(epoch FROM recorded_at - now())) < 60 FROM public.inst_obs WHERE patient_id = :'dv'::uuid AND source = 'device' AND hr = 83));
-- Persistencia: una alerta de «atención» exige dos lecturas seguidas del dispositivo; una crítica no.
SELECT public.t_pat(:'i1', '{"full_name":"Pablo Persistente","birth_date":"1950-04-04"}', true) AS pp \gset
SELECT public.t_vit(:'i1', :'pp', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"temp_c":36.8,"avpu":"A","on_o2":false}') AS _pp0 \gset
SELECT public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'pp', 'Pulsera de Pablo')) AS dcp \gset
SELECT public.jget(:'dcp','code') AS codep, public.jget(:'dcp','device','id') AS didp \gset
SELECT public.t_ing(:'codep', '{"hr":135}') AS _p1 \gset
SELECT public.t_true('K.29 una primera lectura con un parámetro en 3 puntos no alerta (puede ser el aparato)', (SELECT count(*) = 0 FROM public.inst_alerts WHERE patient_id = :'pp'::uuid)
  AND (SELECT news2 = 3 AND band = 'low_medium' FROM public.inst_obs WHERE patient_id = :'pp'::uuid AND source = 'device'));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'didp'::uuid;
SELECT public.t_ing(:'codep', '{"hr":136}') AS _p2 \gset
SELECT public.t_true('K.30 la segunda, dentro de 30 minutos, sí', (SELECT count(*) = 1 AND bool_and(reason = 'news2_single' AND severity = 'warn') FROM public.inst_alerts WHERE patient_id = :'pp'::uuid));
SELECT public.t_pat(:'i1', '{"full_name":"Cristina Crítica","birth_date":"1950-04-04"}', true) AS cp \gset
SELECT public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'cp', 'Monitor de Cristina')) AS dcc \gset
SELECT public.jget(:'dcc','code') AS codec \gset
SELECT public.t_ing(:'codec', '{"hr":135,"rr":30,"spo2":90,"sbp":85}') AS _c1 \gset
SELECT public.t_true('K.31 una lectura crítica del dispositivo alerta de inmediato', (SELECT count(*) = 1 AND bool_and(reason = 'news2_high' AND severity = 'critical') FROM public.inst_alerts WHERE patient_id = :'cp'::uuid));
-- Frenos por fallos repetidos (por huella de IP).
SELECT public.hx_ingest_ip_hash() AS iph0 \gset
INSERT INTO public.inst_ingest_failures(scope, ip_hash) SELECT 'device', :'iph0' FROM generate_series(1, 20);
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_eq('K.32 tras 20 fallos en 10 minutos, quien llama queda frenado (aun con un código válido)', public.t_ing(:'code1', '{"hr":70}'), '{"ok": false, "error": "rate_limited"}');
SELECT public.t_eq('K.33 y otra procedencia no se ve afectada', (SELECT set_config('request.headers', '{"cf-connecting-ip":"203.0.113.77"}', true) || public.t_ing(:'code1', '{"hr":70}')), '{"cf-connecting-ip":"203.0.113.77"}{"ok": true}');
DELETE FROM public.inst_ingest_failures;
SELECT public.t_true('K.34 pasados los intentos, vuelve a aceptar', (SELECT public.t_ing(:'codec', '{"hr":70}') LIKE '%"ok"%'));
SELECT public.t_true('K.35 la huella depende de quien llama y no es su IP',
  (SELECT set_config('request.headers', '{"cf-connecting-ip":"198.51.100.1"}', true) IS NOT NULL AND public.hx_ingest_ip_hash() NOT LIKE '%198.51.100.1%' AND public.hx_ingest_ip_hash() ~ '^[0-9a-f]{64}$'));
SELECT set_config('request.headers', '{"cf-connecting-ip":"198.51.100.1"}', false), public.hx_ingest_ip_hash() AS h_a \gset
SELECT set_config('request.headers', '{"cf-connecting-ip":"198.51.100.2"}', false), public.hx_ingest_ip_hash() AS h_b \gset
SELECT set_config('request.headers', '{"cf-connecting-ip":"198.51.100.1","x-forwarded-for":"9.9.9.9, 8.8.8.8"}', false), public.hx_ingest_ip_hash() AS h_c \gset
SELECT set_config('request.headers', '{"x-forwarded-for":"6.6.6.6, 198.51.100.1"}', false), public.hx_ingest_ip_hash() AS h_d \gset
SELECT set_config('request.headers', '', false), public.hx_ingest_ip_hash() AS h_e \gset
SELECT public.t_true('K.36 misma procedencia = misma huella; distinta = otra', :'h_a' <> :'h_b' AND :'h_a' = :'h_c');
SELECT public.t_true('K.37 sin cabecera de Cloudflare se usa el último valor del reenvío (el que agrega el proxy cercano, no el que escribe el cliente)', :'h_d' = :'h_a');
SELECT public.t_true('K.38 sin ninguna cabecera, un grupo común', :'h_e' = public.hx_sha256('hx-ingest|sin-ip'));
SELECT set_config('request.headers', '', false);
-- Plan vencido: los dispositivos se pausan (y se le dice a quien envía).
UPDATE public.mp_subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = :'i1';
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_eq('K.39 sin plan vigente la ingesta responde «plan»', public.t_ing(:'code1', '{"hr":70}'), '{"ok": false, "error": "plan"}');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = :'i1';
SELECT public.t_true('K.40 con el plan renovado, vuelve a funcionar', public.t_ing(:'code1', '{"hr":70}')::jsonb = '{"ok": true}'::jsonb);
-- Revocar.
SELECT public.t_err('K.41 «pacientes» solo no revoca', public.t_rpc(:'m1', format('public.inst_device_revoke(%L::uuid)', :'did1')), 'forbidden');
SELECT public.t_err('K.42 otra institución no revoca el ajeno', public.t_rpc(:'i2', format('public.inst_device_revoke(%L::uuid)', :'did1')), 'not_found');
SELECT public.t_rpc(:'m2', format('public.inst_device_revoke(%L::uuid)', :'did1')) AS rv \gset
SELECT public.t_true('K.43 revocado: queda la fecha y sin la huella', public.jget(:'rv','status') = 'revoked' AND public.jget(:'rv','revoked_at') IS NOT NULL AND public.jget(:'rv','code_hash') IS NULL);
SELECT public.t_rpc(:'m2', format('public.inst_device_revoke(%L::uuid)', :'did1')) AS rv2 \gset
SELECT public.t_true('K.44 revocar de nuevo no falla ni repite la bitácora', public.jget(:'rv2','status') = 'revoked'
  AND (SELECT count(*) = 1 FROM public.inst_events WHERE kind = 'device_revoked' AND patient_id = :'dv'::uuid));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE id = :'did1'::uuid;
SELECT public.t_eq('K.45 con un código revocado ya no entra nada', public.t_ing(:'code1', '{"hr":70}'), '{"ok": false, "error": "invalid_code"}');
SELECT public.t_err('K.46 un dispositivo revocado no se reactiva (ni con acceso total)', public.t_sys(format('UPDATE public.inst_devices SET status = %L WHERE id = %L', 'active', :'did1')), 'device_revoked');
SELECT public.t_sys(format('UPDATE public.inst_devices SET code_hash = %L, code_hint = %L, patient_id = %L WHERE id = %L', repeat('0', 64), 'zzzz', :'dv', :'didp')) AS upd_dev \gset
SELECT public.t_eq('K.47a el intento no da error: se ignora lo que no se puede cambiar', :'upd_dev', 'ok');
SELECT public.t_true('K.47 la huella del código, su pista y el paciente no se cambian (ni con acceso total)', (SELECT code_hash = public.hx_sha256(:'codep') AND code_hint = right(:'codep', 4) AND patient_id = :'pp'::uuid
  FROM public.inst_devices WHERE id = :'didp'::uuid));
-- El paciente fuera de monitoreo: el dispositivo ya no aporta.
SELECT public.t_rpc(:'i1', format('public.inst_monitoring_set(%L::uuid, false)', :'cp')) AS _off \gset
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE patient_id = :'cp'::uuid;
SELECT public.t_eq('K.48 fuera de monitoreo, el dispositivo responde «no monitoreado»', public.t_ing(:'codec', '{"hr":70}'), '{"ok": false, "error": "not_monitored"}');
SELECT public.t_rpc(:'i1', format('public.inst_monitoring_set(%L::uuid, true)', :'cp')) AS _on \gset
SELECT public.t_true('K.49 y al volver, sigue valiendo', public.t_ing(:'codec', '{"hr":70}')::jsonb = '{"ok": true}'::jsonb);
-- Limpieza de lecturas viejas.
-- (la guarda no admite controles de más de 48 h: la escena se arma sin disparadores)
SET session_replication_role = replica;
INSERT INTO public.inst_obs(institution_id, patient_id, recorded_at, source, hr, device_id) VALUES
  (:'i1', :'pp', now() - interval '31 days', 'device', 80, :'didp'::uuid), (:'i1', :'pp', now() - interval '32 days', 'device', 81, :'didp'::uuid),
  (:'i1', :'pp', now() - interval '40 days', 'manual', 82, NULL), (:'i1', :'pp', now() - interval '5 days', 'device', 83, :'didp'::uuid),
  (:'i2', :'pb', now() - interval '40 days', 'device', 90, NULL);
SET session_replication_role = origin;
SELECT public.t_eq('K.50 la limpieza borra las lecturas de dispositivo de más de 30 días', public.hx_inst_purge_device_obs(:'i1')::text, '2');
SELECT public.t_true('K.50b y no toca a otras instituciones', (SELECT count(*) = 1 FROM public.inst_obs WHERE institution_id = :'i2'::uuid AND source = 'device' AND recorded_at < now() - interval '30 days'));
SELECT public.t_true('K.51 y deja los controles manuales (aunque sean viejos) y las lecturas recientes',
  (SELECT count(*) FILTER (WHERE source = 'manual' AND recorded_at < now() - interval '30 days') = 1
      AND count(*) FILTER (WHERE source = 'device' AND recorded_at < now() - interval '30 days') = 0
      AND count(*) FILTER (WHERE source = 'device' AND recorded_at BETWEEN now() - interval '6 days' AND now() - interval '4 days') = 1 FROM public.inst_obs WHERE patient_id = :'pp'::uuid));
INSERT INTO public.inst_ingest_failures(scope, ip_hash, at) VALUES ('device', repeat('a', 64), now() - interval '2 days'), ('device', repeat('b', 64), now() - interval '3 days'), ('device', repeat('c', 64), now());
SELECT public.t_eq('K.52 los intentos fallidos de más de un día se borran, los de hoy no', public.hx_inst_purge_failures()::text || '/' || (SELECT count(*)::text FROM public.inst_ingest_failures WHERE ip_hash = repeat('c', 64)), '2/1');
DELETE FROM public.inst_ingest_failures;

INSERT INTO public.inst_ingest_failures(scope, ip_hash, at) VALUES ('device', repeat('d', 64), now() - interval '2 days');
SET session_replication_role = replica;
INSERT INTO public.inst_obs(institution_id, patient_id, recorded_at, source, hr, device_id) VALUES (:'i1', :'pp', now() - interval '35 days', 'device', 84, :'didp'::uuid);
SET session_replication_role = origin;
SELECT public.t_eq('K.53 la limpieza de todas las instituciones borra el intento viejo y las lecturas de más de 30 días de cada una', public.hx_inst_purge_all()::text, '3');
SELECT public.t_eq('K.54 y no queda nada viejo', (SELECT count(*)::text FROM public.inst_obs WHERE source = 'device' AND recorded_at < now() - interval '30 days')
  || (SELECT count(*)::text FROM public.inst_ingest_failures WHERE at < now() - interval '1 day'), '00');
DELETE FROM public.inst_ingest_failures;

-- ═══ L) Relevo de turno, exportación y cifras del resumen ═════════════════════════════════════════════════════════
SELECT count(*) AS nh0 FROM public.inst_notes WHERE institution_id = :'i1'::uuid AND kind = 'handoff' \gset
SELECT public.t_rpc(:'m1', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(
  jsonb_build_object('patient_id', :'mp', 'illness', 'stable', 'summary', 'Sin novedades, tolera la dieta', 'actions', 'Control de signos a las 18:00', 'contingency', 'Si SpO2 < 92 %, llamar al médico de turno'),
  jsonb_build_object('patient_id', :'hp', 'illness', 'unstable', 'summary', 'Puntaje alto en la madrugada'))::text)) AS ho \gset
SELECT public.t_true('L.1 el relevo guarda una nota por paciente en su historia (el personal con «pacientes» puede)', public.jget(:'ho','ok') = 'true' AND public.jget(:'ho','saved') = '2'
  AND (SELECT count(*) = :'nh0'::int + 2 FROM public.inst_notes WHERE institution_id = :'i1'::uuid AND kind = 'handoff'));
SELECT public.t_true('L.2 con el formato I-PASS: gravedad, resumen, acciones y qué hacer si cambia (— si falta)',
  (SELECT count(*) FILTER (WHERE body LIKE E'Relevo de turno (I-PASS) · Estable\nResumen: Sin novedades, tolera la dieta\nAcciones: Control de signos a las 18:00\nSi cambia: Si SpO2 < 92 %, llamar al médico de turno') = 1
      AND count(*) FILTER (WHERE body = E'Relevo de turno (I-PASS) · Inestable\nResumen: Puntaje alto en la madrugada\nAcciones: —\nSi cambia: —') = 1
      AND bool_and(author_id = :'m1'::uuid AND author_role = 'member') FROM public.inst_notes WHERE institution_id = :'i1'::uuid AND kind = 'handoff'));
SELECT public.t_true('L.3 y la cadena de cada una sigue íntegra', public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'mp')), 'ok') = 'true' AND public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'hp')), 'ok') = 'true');
SELECT public.t_true('L.4 queda en la bitácora cuántos pacientes (sin sus datos)', (SELECT count(*) = 1 AND bool_and(patient_id IS NULL AND data = '{"patients": 2}'::jsonb) FROM public.inst_events WHERE kind = 'handoff_committed'));
SELECT public.t_err('L.6 sin gravedad no se guarda', public.t_rpc(:'i1', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(jsonb_build_object('patient_id', :'mp'))::text)), 'invalid_data');
SELECT public.t_err('L.7 un texto de más de 600 caracteres no', public.t_rpc(:'i1', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(jsonb_build_object('patient_id', :'mp', 'illness', 'stable', 'summary', repeat('x', 601)))::text)), 'invalid_data');
SELECT public.t_err('L.8 una lista vacía no', public.t_rpc(:'i1', 'public.inst_handoff_commit(''[]''::jsonb)'), 'invalid_data');
SELECT public.t_err('L.9 ni algo que no es una lista', public.t_rpc(:'i1', 'public.inst_handoff_commit(''{"a":1}''::jsonb)'), 'invalid_data');
SELECT public.t_err('L.10 ni más de 150 pacientes', public.t_rpc(:'i1', format('public.inst_handoff_commit(%L::jsonb)', (SELECT jsonb_agg(jsonb_build_object('patient_id', :'mp', 'illness', 'stable')) FROM generate_series(1, 151))::text)), 'invalid_data');
SELECT count(*) AS nh1 FROM public.inst_notes WHERE institution_id = :'i1'::uuid AND kind = 'handoff' \gset
SELECT public.t_err('L.11 con un paciente ajeno falla todo el relevo', public.t_rpc(:'i1', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(
  jsonb_build_object('patient_id', :'mp', 'illness', 'stable'), jsonb_build_object('patient_id', :'pb', 'illness', 'stable'))::text)), 'not_found');
SELECT public.t_eq('L.12 y no queda guardado ni el primero (todo o nada)', (SELECT count(*)::text FROM public.inst_notes WHERE institution_id = :'i1'::uuid AND kind = 'handoff'), :'nh1');
SELECT public.t_err('L.13 el personal solo de ofertas no', public.t_rpc(:'m3', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(jsonb_build_object('patient_id', :'mp', 'illness', 'stable'))::text)), 'forbidden');
-- Exportación.
SELECT public.t_eq('L.14 exportar deja constancia del formato (no del contenido)', public.t_rpc(:'m2', format('public.inst_export_log(%L::uuid, %L)', :'mp', 'fhir')), '');
SELECT public.t_true('L.15 en la bitácora', (SELECT count(*) = 1 AND bool_and(data = '{"format": "fhir"}'::jsonb AND actor_id = :'m2'::uuid) FROM public.inst_events WHERE kind = 'export' AND patient_id = :'mp'::uuid));
SELECT public.t_err('L.16 un formato desconocido no', public.t_rpc(:'i1', format('public.inst_export_log(%L::uuid, %L)', :'mp', 'pdf')), 'invalid_data');
SELECT public.t_err('L.17 uno de otra institución no', public.t_rpc(:'i2', format('public.inst_export_log(%L::uuid, %L)', :'mp', 'csv')), 'not_found');
SELECT public.t_err('L.18 el personal solo de ofertas no', public.t_rpc(:'m3', format('public.inst_export_log(%L::uuid, %L)', :'mp', 'csv')), 'forbidden');

-- Cifras con una institución limpia (i6): todo lo que cuenta el resumen sale de aquí, calculado en la base.
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Activo Uno","birth_date":"1950-01-01"}', true) AS ca \gset
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Activo Dos","birth_date":"1950-01-01"}', true) AS cb \gset
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Vencido","birth_date":"1950-01-01"}', true) AS cf \gset
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Pausa"}') AS cc \gset
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Alta"}') AS cd \gset
SELECT public.t_pat(:'i6', '{"full_name":"Cifras Pendiente","status":"pending"}') AS ce \gset
SELECT public.t_rpc(:'i6', format('public.inst_patient_set_status(%L::uuid, %L)', :'cc', 'paused')) AS _cc \gset
SELECT public.t_rpc(:'i6', format('public.inst_patient_discharge(%L::uuid, %L)', :'cd', 'stable')) AS _cd \gset
-- Casos: 1 activo, 1 pendiente, 3 completados (2 valorados: 5 y 4), 1 cancelado.
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'ca', '{"title":"Caso activo"}')), 'id') AS k_act \gset
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'ca', '{"title":"Caso pendiente","status":"pending"}')), 'id') AS k_pen \gset
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'cb', '{"title":"Completado cinco"}')), 'id') AS k_c5 \gset
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'cb', '{"title":"Completado cuatro"}')), 'id') AS k_c4 \gset
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'cb', '{"title":"Completado sin valorar"}')), 'id') AS k_c0 \gset
SELECT public.jget(public.t_rpc(:'i6', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'cb', '{"title":"Cancelado"}')), 'id') AS k_can \gset
SELECT public.t_rpc(:'i6', format('public.inst_case_close(%L::uuid, %L, %L, 5, %L)', :'k_c5', 'completed', 'recovered', 'patient')) AS _k1 \gset
SELECT public.t_rpc(:'i6', format('public.inst_case_close(%L::uuid, %L, %L, 4, %L)', :'k_c4', 'completed', 'stable', 'family')) AS _k2 \gset
SELECT public.t_rpc(:'i6', format('public.inst_case_close(%L::uuid, %L)', :'k_c0', 'completed')) AS _k3 \gset
SELECT public.t_rpc(:'i6', format('public.inst_case_close(%L::uuid, %L)', :'k_can', 'cancelled')) AS _k4 \gset
-- Un dispositivo en línea; un control medio (alerta urgente abierta); uno vencido.
SELECT public.t_rpc(:'i6', format('public.inst_device_create(%L::uuid, %L)', :'ca', 'Reloj de Cifras')) AS dcf \gset
SELECT public.jget(:'dcf','code') AS codef \gset
SELECT public.t_ing(:'codef', '{"hr":72,"rr":16,"spo2":98,"sbp":120,"temp_c":36.8}') AS _if \gset
SELECT public.t_vit(:'i6', :'cb', '{"rr":22,"hr":105,"sbp":105,"temp_c":38.5,"spo2":95,"avpu":"A","on_o2":false}') AS _vb \gset
-- Historial de alertas para la racha y los tiempos de respuesta (cerradas, con constancia de cuándo se vieron).
INSERT INTO public.inst_alerts(institution_id, patient_id, severity, reason, news2, message, status, opened_at, due_ack_at, acked_at, resolved_at, resolution, last_seen_at) VALUES
  (:'i6', :'ca', 'urgent',   'news2_medium', 6,  'x', 'resolved', now() - interval '50 hours', now() - interval '50 hours' + interval '30 minutes', now() - interval '50 hours' + interval '40 minutes', now() - interval '49 hours', 'treated', now()),
  (:'i6', :'ca', 'critical', 'news2_high',   9,  'x', 'resolved', now() - interval '40 hours', now() - interval '40 hours' + interval '10 minutes', now() - interval '40 hours' + interval '3 minutes',  now() - interval '39 hours', 'treated', now()),
  (:'i6', :'ca', 'urgent',   'news2_medium', 5,  'x', 'resolved', now() - interval '30 hours', now() - interval '30 hours' + interval '30 minutes', now() - interval '30 hours' + interval '6 minutes',  now() - interval '29 hours', 'treated', now()),
  (:'i6', :'ca', 'critical', 'news2_high',   8,  'x', 'resolved', now() - interval '20 hours', now() - interval '20 hours' + interval '10 minutes', now() - interval '20 hours' + interval '9 minutes',  now() - interval '19 hours', 'treated', now()),
  (:'i6', :'ca', 'warn',     'news2_single', 3,  'x', 'resolved', now() - interval '10 hours', now() - interval '10 hours' + interval '2 hours',    now() - interval '10 hours' + interval '1 minute',   now() - interval '9 hours',  'treated', now());
SELECT public.jget(public.t_rpc(:'i6', 'public.inst_care_overview()'), 'ontime_streak') AS streak1 \gset
SELECT public.t_eq('L.19 racha: 3 alertas urgentes o críticas seguidas atendidas a tiempo (la anterior se pasó; las de atención no cuentan)', :'streak1', '3');
UPDATE public.inst_live SET last_device_at = now() - interval '30 minutes' WHERE patient_id = :'cb'::uuid;
SELECT public.t_rpc(:'i6', 'public.inst_care_overview()') AS ov \gset
SELECT public.t_true('L.20 pacientes: 6 en total, 5 sin alta (1 pendiente, 3 activos, 1 en pausa) y 1 con alta; 3 monitoreados',
  public.jget(:'ov','patients','total') = '6' AND public.jget(:'ov','patients','open') = '5' AND public.jget(:'ov','patients','pending') = '1' AND public.jget(:'ov','patients','active') = '3'
  AND public.jget(:'ov','patients','paused') = '1' AND public.jget(:'ov','patients','discharged') = '1' AND public.jget(:'ov','patients','monitored') = '3');
SELECT public.t_true('L.21 casos: 1 activo, 1 pendiente, 3 completados (2 valorados), 1 cancelado; promedio 4,5',
  public.jget(:'ov','cases','active') = '1' AND public.jget(:'ov','cases','pending') = '1' AND public.jget(:'ov','cases','completed') = '3' AND public.jget(:'ov','cases','cancelled') = '1'
  AND public.jget(:'ov','cases','rated') = '2' AND (public.jget(:'ov','cases','avg_satisfaction'))::numeric = 4.5);
SELECT public.t_true('L.22 el uso del plan y sus límites', public.jget(:'ov','plan') = 'institution_monthly' AND public.jget(:'ov','usage','patients') = '5' AND public.jget(:'ov','usage','monitored') = '3'
  AND public.jget(:'ov','usage','devices') = '1' AND public.jget(:'ov','limits','patients') = '1000' AND public.jget(:'ov','limits','monitored') = '300' AND public.jget(:'ov','limits','devices') = '300'
  AND public.jget(:'ov','limits','escalation') = 'true');
SELECT public.t_true('L.23 monitoreo: 3 en total, 1 en línea (el que acaba de hablar; el de hace 30 min no), 1 con el control vencido (el que no tiene ninguno), 1 de riesgo medio o alto',
  public.jget(:'ov','monitoring','total') = '3' AND public.jget(:'ov','monitoring','online') = '1' AND public.jget(:'ov','monitoring','overdue') = '1' AND public.jget(:'ov','monitoring','high_risk') = '1');
SELECT public.t_true('L.24 alertas: 1 abierta sin ver (urgente), ninguna crítica ni vencida',
  public.jget(:'ov','alerts','open') = '1' AND public.jget(:'ov','alerts','unacked') = '1' AND public.jget(:'ov','alerts','critical') = '0' AND public.jget(:'ov','alerts','overdue') = '0');
SELECT public.t_eq('L.25 tareas: las abiertas y las vencidas coinciden con la cuenta directa', public.jget(:'ov','tasks','open') || '/' || public.jget(:'ov','tasks','overdue'),
  (SELECT count(*) FILTER (WHERE status = 'open')::text || '/' || count(*) FILTER (WHERE status = 'open' AND due_at < now())::text FROM public.inst_tasks WHERE institution_id = :'i6'::uuid));
SELECT public.t_true('L.26 impacto de la semana: controles, lecturas, alertas, a tiempo y mediana de respuesta',
  public.jget(:'ov','impact','manual_controls') = '1' AND public.jget(:'ov','impact','device_readings') = '1' AND public.jget(:'ov','impact','alerts') = '6'
  AND public.jget(:'ov','impact','alerts_on_time') = '4' AND public.jget(:'ov','impact','median_ack_seconds') = '360' AND public.jget(:'ov','impact','cases_completed') = '3');
SELECT public.t_eq('L.27 notas de la semana: coincide con la cuenta directa', public.jget(:'ov','impact','notes'), (SELECT count(*)::text FROM public.inst_notes WHERE institution_id = :'i6'::uuid));
-- Marcar tareas hechas suma a la semana; una alerta urgente que se pasó del plazo corta la racha.
SELECT public.t_rpc(:'i6', format('public.inst_task_done(%L::uuid)', (SELECT id FROM public.inst_tasks WHERE institution_id = :'i6'::uuid AND status = 'open' ORDER BY due_at LIMIT 1))) AS _td1 \gset
SELECT public.t_rpc(:'i6', format('public.inst_task_done(%L::uuid)', (SELECT id FROM public.inst_tasks WHERE institution_id = :'i6'::uuid AND status = 'open' ORDER BY due_at LIMIT 1))) AS _td2 \gset
SELECT public.t_eq('L.28 tareas hechas esta semana', public.jget(public.t_rpc(:'i6', 'public.inst_care_overview()'), 'impact', 'tasks_done'), '2');
INSERT INTO public.inst_alerts(institution_id, patient_id, severity, reason, news2, message, status, opened_at, due_ack_at) VALUES
  (:'i6', :'ca', 'urgent', 'news2_medium', 6, 'x', 'open', now() - interval '1 hour', now() - interval '30 minutes');
SELECT public.t_true('L.29 una alerta sin ver pasado el plazo corta la racha y cuenta como vencida', public.jget(public.t_rpc(:'i6', 'public.inst_care_overview()'), 'ontime_streak') = '0'
  AND public.jget(public.t_rpc(:'i6', 'public.inst_care_overview()'), 'alerts', 'overdue') = '1');
SELECT public.t_true('L.30 el resumen lo ven el personal con «pacientes» o con «monitoreo»', public.t_call(:'m1','authenticated','SELECT (public.inst_care_overview())->>''plan''') = 'institution_monthly'
  AND public.t_call(:'m2','authenticated','SELECT (public.inst_care_overview())->>''plan''') = 'institution_monthly');
SELECT public.t_err('L.31 y nadie más', public.t_call(:'m3','authenticated','SELECT public.inst_care_overview()::text') || public.t_call(:'f1','authenticated','SELECT public.inst_care_overview()::text')
  || public.t_call(:'sa','authenticated','SELECT public.inst_care_overview()::text'), 'forbidden');
SELECT public.t_err('L.32 ni el visitante', public.t_call(NULL, 'anon', 'SELECT public.inst_care_overview()::text'), 'permission denied');
SELECT public.t_true('L.33 otra institución ve sus propias cifras, no las de i6', public.jget(public.t_rpc(:'i2', 'public.inst_care_overview()'), 'patients', 'total') = '2'
  AND public.jget(public.t_rpc(:'i6', 'public.inst_care_overview()'), 'patients', 'total') = '6');

-- ═══ M) Alta: todo o nada, y la reactivación ════════════════════════════════════════════════════════════════════════
SELECT public.t_pat(:'i1', '{"full_name":"Dario Alta","birth_date":"1951-01-01"}', true) AS dc \gset
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'dc', '{"title":"Caso uno del alta"}')), 'id') AS dk1 \gset
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'dc', '{"title":"Caso dos del alta","status":"pending"}')), 'id') AS dk2 \gset
SELECT public.t_rpc(:'i1', format('public.inst_task_add(%L::uuid, %L)', :'dc', 'Tarea manual pendiente')) AS _dt \gset
SELECT public.t_vit(:'i1', :'dc', '{"rr":30,"spo2":90,"hr":135,"sbp":85,"avpu":"C","temp_c":36.5,"on_o2":false}') AS vdc \gset
SELECT public.t_vit(:'i1', :'dc', '{"fall":true}') AS _dfall \gset
SELECT public.t_rpc(:'i1', format('public.inst_device_create(%L::uuid, %L)', :'dc', 'Reloj de Darío')) AS ddv \gset
SELECT public.jget(:'ddv','code') AS dcode \gset
SELECT public.t_true('M.1 antes del alta: 2 casos abiertos, tareas abiertas, 2 alertas abiertas, 1 dispositivo activo y en monitoreo',
  (SELECT count(*) = 2 FROM public.inst_cases WHERE patient_id = :'dc'::uuid AND status IN ('active','pending')) AND (SELECT count(*) > 3 FROM public.inst_tasks WHERE patient_id = :'dc'::uuid AND status = 'open')
  AND (SELECT count(*) = 2 FROM public.inst_alerts WHERE patient_id = :'dc'::uuid AND status <> 'resolved') AND (SELECT count(*) = 1 FROM public.inst_devices WHERE patient_id = :'dc'::uuid AND status = 'active')
  AND (SELECT monitoring FROM public.inst_patients WHERE id = :'dc'::uuid));
SELECT public.t_err('M.2 un desenlace que no existe', public.t_rpc(:'i1', format('public.inst_patient_discharge(%L::uuid, %L)', :'dc', 'zzz')), 'invalid_data');
SELECT public.t_err('M.3 una nota de más de 500 caracteres', public.t_rpc(:'i1', format('public.inst_patient_discharge(%L::uuid, %L, %L)', :'dc', 'referred', repeat('x', 501))), 'invalid_data');
SELECT public.t_err('M.4 «monitoreo» solo no da altas', public.t_rpc(:'m2', format('public.inst_patient_discharge(%L::uuid, %L)', :'dc', 'referred')), 'forbidden');
SELECT public.t_err('M.5 otra institución no existe', public.t_rpc(:'i2', format('public.inst_patient_discharge(%L::uuid, %L)', :'dc', 'referred')), 'not_found');
SELECT public.t_rpc(:'m1', format('public.inst_patient_discharge(%L::uuid, %L, %L)', :'dc', 'referred', 'Remitido a UCI')) AS dis \gset
SELECT public.t_true('M.6 el alta deja al paciente sin monitoreo y con fecha', public.jget(:'dis','status') = 'discharged' AND public.jget(:'dis','monitoring') = 'false' AND public.jget(:'dis','discharged_at') IS NOT NULL
  AND public.jget(:'dis','monitoring_since') IS NULL);
SELECT public.t_true('M.7 cierra los casos con el desenlace', (SELECT count(*) = 2 AND bool_and(status = 'completed' AND outcome = 'referred' AND closed_at IS NOT NULL) FROM public.inst_cases WHERE patient_id = :'dc'::uuid));
SELECT public.t_true('M.8 da por omitidas las tareas', (SELECT count(*) > 3 AND bool_and(status = 'skipped') FROM public.inst_tasks WHERE patient_id = :'dc'::uuid));
SELECT public.t_true('M.9 resuelve las alertas con constancia', (SELECT count(*) = 2 AND bool_and(status = 'resolved' AND resolution = 'other' AND resolve_note = 'Alta del paciente' AND resolved_by = :'m1'::uuid) FROM public.inst_alerts WHERE patient_id = :'dc'::uuid));
SELECT public.t_true('M.10 revoca los dispositivos', (SELECT count(*) = 1 AND bool_and(status = 'revoked' AND revoked_at IS NOT NULL) FROM public.inst_devices WHERE patient_id = :'dc'::uuid));
SELECT public.t_true('M.11 deja la nota en la historia y la bitácora', (SELECT count(*) = 1 FROM public.inst_notes WHERE patient_id = :'dc'::uuid AND body = 'Alta del paciente (remitido a otro servicio). Remitido a UCI')
  AND (SELECT count(*) = 1 FROM public.inst_events WHERE patient_id = :'dc'::uuid AND kind = 'patient_discharged' AND data = '{"outcome": "referred", "cases_closed": 2}'::jsonb));
SELECT public.t_rpc(:'i1', format('public.inst_patient_discharge(%L::uuid, %L)', :'dc', 'stable')) AS dis2 \gset
SELECT public.t_true('M.12 darla de nuevo no repite nada', public.jget(:'dis2','status') = 'discharged'
  AND (SELECT count(*) = 1 FROM public.inst_notes WHERE patient_id = :'dc'::uuid AND body LIKE 'Alta del paciente%') AND (SELECT count(*) = 1 FROM public.inst_events WHERE patient_id = :'dc'::uuid AND kind = 'patient_discharged'));
UPDATE public.inst_devices SET last_ingest_at = NULL WHERE patient_id = :'dc'::uuid;
SELECT public.t_eq('M.13 el dispositivo del alta ya no sirve', public.t_ing(:'dcode', '{"hr":70}'), '{"ok": false, "error": "invalid_code"}');
SELECT public.t_err('M.14 ya no se registran signos', public.t_vit(:'i1', :'dc', '{"hr":70}'), 'not_monitored');
SELECT public.t_err('M.15 ni se cambian sus datos', public.t_rpc(:'i1', format('public.inst_patient_update(%L::uuid, %L::jsonb)', :'dc', '{"city":"Cali"}')), 'patient_discharged');
SELECT public.t_err('M.16 ni se abren casos', public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'dc', '{"title":"Tarde"}')), 'patient_discharged');
SELECT public.t_err('M.17 ni se monitorea', public.t_rpc(:'i1', format('public.inst_monitoring_set(%L::uuid, true)', :'dc')), 'patient_not_active');
SELECT public.t_true('M.18 las notas sí se pueden agregar después (correcciones, trámites)', public.t_rpc(:'i1', format('public.inst_note_add(%L::uuid, %L, %L)', :'dc', 'coordination', 'Se entregó la epicrisis a la familia.')) NOT LIKE 'ERR%');
SELECT public.t_rpc(:'i1', format('public.inst_patient_set_status(%L::uuid, %L)', :'dc', 'active')) AS react \gset
SELECT public.t_true('M.19 reactivar lo deja activo, sin fecha de alta y sin monitoreo', public.jget(:'react','status') = 'active' AND public.jget(:'react','discharged_at') IS NULL AND public.jget(:'react','monitoring') = 'false');
SELECT public.t_true('M.20 y se puede volver a monitorear', public.jget(public.t_rpc(:'i1', format('public.inst_monitoring_set(%L::uuid, true)', :'dc')), 'monitoring') = 'true');
-- «Retiro» cancela los casos.
SELECT public.t_pat(:'i1', '{"full_name":"Wilma Retiro"}') AS dw \gset
SELECT public.jget(public.t_rpc(:'i1', format('public.inst_case_open(%L::uuid, %L::jsonb)', :'dw', '{"title":"Caso de retiro"}')), 'id') AS dwk \gset
SELECT public.t_rpc(:'i1', format('public.inst_patient_discharge(%L::uuid, %L)', :'dw', 'withdrawn')) AS _dw \gset
SELECT public.t_true('M.21 un retiro cancela los casos abiertos con ese desenlace', (SELECT status = 'cancelled' AND outcome = 'withdrawn' FROM public.inst_cases WHERE id = :'dwk'::uuid));
SELECT public.t_rpc(:'i1', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(jsonb_build_object('patient_id', :'dw', 'illness', 'stable'))::text)) AS ho2 \gset
SELECT public.t_true('M.22 en el relevo, un paciente con el alta se omite (no se le agregan notas)', public.jget(:'ho2','saved') = '0'
  AND (SELECT count(*) = 0 FROM public.inst_notes WHERE patient_id = :'dw'::uuid AND kind = 'handoff'));
SELECT public.t_err('M.23 el plan Free no guarda relevos aunque el paciente exista', public.t_rpc(:'i3', format('public.inst_handoff_commit(%L::jsonb)', jsonb_build_array(jsonb_build_object('patient_id', :'fp1', 'illness', 'stable'))::text)), 'handoff_plan');

-- ═══ Q) Programación con pg_cron (simulado: solo importa qué le pide la migración) ═════════════════════════════════
CREATE SCHEMA cron;
CREATE TABLE cron.calls (n serial, fn text, name text, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.calls(fn, name, schedule, command) VALUES ('schedule', job_name, schedule, command) RETURNING n::bigint $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN INSERT INTO cron.calls(fn, name) VALUES ('unschedule', job_name); RETURN true; END $$;
\i :MIG
SELECT public.t_eq('Q.1 la migración pide cancelar y programar la revisión de alertas cada minuto', (SELECT string_agg(fn || ':' || name || COALESCE(':' || schedule || ':' || command, ''), ' | ' ORDER BY n) FROM cron.calls),
  'unschedule:inst-escalate-alerts | unschedule:inst-purge-telemetry | schedule:inst-escalate-alerts:* * * * *:SELECT public.hx_inst_escalate_all() | schedule:inst-purge-telemetry:17 3 * * *:SELECT public.hx_inst_purge_all()');
-- Si pg_cron falla, la migración no se cae.
DROP FUNCTION cron.schedule(text, text, text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pg_cron no puede programar'; END $$;
SELECT public.t_eq('Q.2 si pg_cron falla, la migración sigue (queda el modo oportunista)', public.t_sys(pg_read_file(:'MIG')), 'ok');
DROP SCHEMA cron CASCADE;

-- ═══ N) Reaplicar la migración no cambia nada (ni los datos) ═════════════════════════════════════════════════════════
CREATE FUNCTION public.t_sig() RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat_ws('||',
    (SELECT string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '|' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND (p.proname LIKE 'inst\_%' OR p.proname LIKE 'hx\_care\_%' OR p.proname LIKE 'hx\_inst\_%'
            OR p.proname IN ('hx_news2','hx_news2_band','hx_news2_interval_min','hx_text_ok','hx_name_ok','hx_text_array_ok','hx_alert_rank','hx_json_num','hx_json_texts','hx_ingest_ip_hash','hx_staff_modules'))),
    (SELECT string_agg(policyname || tablename || cmd || coalesce(qual, '') || array_to_string(roles, ','), '|' ORDER BY tablename, policyname) FROM pg_policies WHERE tablename LIKE 'inst\_%'),
    (SELECT string_agg(c.relname || coalesce(c.relacl::text, ''), '|' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'inst\_%' AND c.relkind IN ('r', 'S')),
    (SELECT string_agg(a.attname || coalesce(a.attacl::text, ''), '|' ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = 'public.inst_devices'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL),
    (SELECT string_agg(pg_get_triggerdef(t.oid), '|' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid::regclass::text LIKE 'public.inst\_%' AND NOT t.tgisinternal),
    (SELECT string_agg(pg_get_constraintdef(k.oid), '|' ORDER BY k.conrelid::regclass::text, k.conname) FROM pg_constraint k WHERE k.conrelid::regclass::text LIKE 'public.inst\_%'),
    (SELECT string_agg(indexdef, '|' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'inst\_%'),
    (SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename LIKE 'inst\_%'))) $$;
CREATE FUNCTION public.t_rows() RETURNS text LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM public.inst_patients) || '/' || (SELECT count(*) FROM public.inst_cases) || '/' || (SELECT count(*) FROM public.inst_notes) || '/' || (SELECT count(*) FROM public.inst_tasks)
      || '/' || (SELECT count(*) FROM public.inst_obs) || '/' || (SELECT count(*) FROM public.inst_alerts) || '/' || (SELECT count(*) FROM public.inst_devices) || '/' || (SELECT count(*) FROM public.inst_live)
      || '/' || (SELECT count(*) FROM public.inst_events) $$;
SELECT public.t_sig() AS sig0, public.t_rows() AS rows0 \gset
\i :MIG
SELECT public.t_eq('N.1 reaplicada, funciones, permisos, políticas, disparadores, restricciones, índices y tiempo real son idénticos', public.t_sig(), :'sig0');
SELECT public.t_eq('N.2 y no se pierde ni se duplica ningún dato', public.t_rows(), :'rows0');
SELECT public.t_true('N.3 todo sigue funcionando', public.jget(public.t_rpc(:'i1', 'public.inst_care_overview()'), 'plan') = 'institution_monthly'
  AND public.t_pat(:'i1', '{"full_name":"Paciente Tras Reaplicar"}') ~ '^[0-9a-f-]{36}$' AND public.jget(public.t_rpc(:'i1', format('public.inst_verify_notes(%L::uuid)', :'gp')), 'ok') = 'true');
SELECT public.t_true('N.4 y el catálogo del personal sigue completo', public.hx_staff_modules() = ARRAY['ofertas','talento','pacientes','monitoreo']);

-- ═══ W) Freno a la ingesta pública de los relojes (20261014110000) ═════════════════════════════════════════════════
-- Producción tiene estas tablas y la función original; la réplica no las trae. Se arman con las definiciones de producción.
CREATE TABLE IF NOT EXISTS public.vital_signs_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_user_id uuid NOT NULL, patient_label text, reading_type text NOT NULL, value numeric NOT NULL,
  value_secondary numeric, unit text, severity text NOT NULL DEFAULT 'normal', source text NOT NULL DEFAULT 'manual', recorded_by uuid, notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL, provider text NOT NULL, external_user_id text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  device_name text, status text NOT NULL DEFAULT 'active', last_synced_at timestamptz, last_error text, connected_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
\i :WORIG
INSERT INTO public.wearable_connections(patient_id, provider, external_user_id, status) VALUES
  (:'f1', 'samsung_health', 'WCODEACTIVE0001', 'active'), (:'f2', 'samsung_health', 'WCODEPAUSED0002', 'paused');
SELECT public.t_true('W.1 antes: el visitante puede llamar a la función original', has_function_privilege('anon', 'public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE'));
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'NOEXISTE0000')::text$q$) AS w_before_a \gset
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEPAUSED0002')::text$q$) AS w_before_b \gset
SELECT public.t_true('W.2 antes: la respuesta distingue «no existe» de «inactiva» (permite averiguar qué códigos existen)', :'w_before_a' <> :'w_before_b' AND :'w_before_a' LIKE '%no encontrado%' AND :'w_before_b' LIKE '%no está activa%');
SELECT pg_get_function_arguments('public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure) AS args_orig \gset

\i :MIG2

SELECT public.t_true('W.3 después: la función original es interna (solo la llave de servicio)',
  NOT has_function_privilege('anon', 'public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE'));
SELECT public.t_true('W.4 y la puerta, con el mismo nombre, la pueden llamar los relojes y las cuentas', has_function_privilege('anon', 'public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)', 'EXECUTE'));
SELECT public.t_eq('W.5 con los mismos parámetros y valores por defecto (los atajos existentes siguen funcionando)',
  pg_get_function_arguments('public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure), :'args_orig');
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', heart_rate => 72, spo2 => 97)::text$q$) AS w_ok \gset
SELECT public.t_true('W.6 un código válido funciona igual que antes (llamada con parámetros por nombre, como PostgREST)', :'w_ok'::jsonb = '{"ok": true, "inserted": 2}'::jsonb
  AND (SELECT count(*) = 2 AND count(*) FILTER (WHERE reading_type = 'heart_rate' AND value = 72) = 1 AND count(*) FILTER (WHERE reading_type = 'spo2' AND value = 97) = 1 FROM public.vital_signs_readings WHERE family_user_id = :'f1'::uuid));
SELECT public.t_eq('W.7 la conexión queda con su última sincronización', (SELECT (last_synced_at > now() - interval '1 minute')::text FROM public.wearable_connections WHERE external_user_id = 'WCODEACTIVE0001'), 'true');
SELECT count(*) AS wf0 FROM public.inst_ingest_failures WHERE scope = 'wearable' \gset
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'NOEXISTE0000', heart_rate => 70)::text$q$) AS w_a \gset
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEPAUSED0002', heart_rate => 70)::text$q$) AS w_b \gset
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', p_provider => 'garmin', heart_rate => 70)::text$q$) AS w_c \gset
SELECT public.t_true('W.8 «no existe», «inactiva» y «otro proveedor» responden exactamente lo mismo (sin pistas)', :'w_a' = :'w_b' AND :'w_b' = :'w_c'
  AND :'w_a'::jsonb = '{"ok": false, "error": "Código de emparejamiento no válido o conexión inactiva"}'::jsonb);
SELECT public.t_true('W.9 cada intento fallido deja una huella (no se guarda ninguna lectura)', (SELECT count(*) FROM public.inst_ingest_failures WHERE scope = 'wearable') = :'wf0'::int + 3
  AND (SELECT count(*) = 2 FROM public.vital_signs_readings));
SELECT public.t_true('W.10 los aciertos no cuentan como fallos', (SELECT count(*) FROM public.inst_ingest_failures WHERE scope = 'wearable') = :'wf0'::int + 3);
INSERT INTO public.inst_ingest_failures(scope, ip_hash) SELECT 'device', public.hx_ingest_ip_hash() FROM generate_series(1, 30);
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', heart_rate => 71)::text$q$) AS w_dev \gset
SELECT public.t_true('W.11 los fallos de dispositivos de la institución no frenan a un reloj de familia (cada uno con su alcance)', :'w_dev'::jsonb = '{"ok": true, "inserted": 1}'::jsonb);
INSERT INTO public.inst_ingest_failures(scope, ip_hash) SELECT 'wearable', public.hx_ingest_ip_hash() FROM generate_series(1, 20);
SELECT public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', heart_rate => 72)::text$q$) AS w_blocked \gset
SELECT public.t_true('W.12 tras 20 fallos en 10 minutos, quien llama queda frenado aun con un código válido, y no se guarda la lectura',
  :'w_blocked'::jsonb = '{"ok": false, "error": "Demasiados intentos. Espera unos minutos."}'::jsonb AND (SELECT count(*) = 3 FROM public.vital_signs_readings));
SELECT public.t_true('W.13 otra procedencia no se ve afectada', (SELECT set_config('request.headers', '{"cf-connecting-ip":"203.0.113.50"}', true) IS NOT NULL
  AND public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', heart_rate => 73)::text$q$)::jsonb = '{"ok": true, "inserted": 1}'::jsonb));
DELETE FROM public.inst_ingest_failures;
SELECT public.t_true('W.14 sin fallos recientes vuelve a aceptar', public.t_call(NULL, 'anon', $q$SELECT public.wearable_ingest_by_pairing_code(pairing_code => 'WCODEACTIVE0001', heart_rate => 74)::text$q$)::jsonb = '{"ok": true, "inserted": 1}'::jsonb);
-- Reaplicar no cambia nada.
SELECT md5(pg_get_functiondef('public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure)
  || pg_get_functiondef('public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure)
  || COALESCE((SELECT string_agg(proacl::text, '|' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'wearable_ingest%'), '')) AS wsig0 \gset
\i :MIG2
SELECT public.t_eq('W.15 reaplicada, las dos funciones y sus permisos quedan idénticos', md5(pg_get_functiondef('public.wearable_ingest_by_pairing_code(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure)
  || pg_get_functiondef('public.wearable_ingest_by_pairing_code_core(text, text, integer, integer, integer, numeric, integer, integer, timestamptz, text, text)'::regprocedure)
  || COALESCE((SELECT string_agg(proacl::text, '|' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'wearable_ingest%'), '')), :'wsig0');
SELECT public.t_eq('W.16 y hay exactamente una puerta y una interna', (SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'wearable_ingest%'), '2');

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
