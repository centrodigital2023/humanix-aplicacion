-- Escenario — Personal de la institución: cuentas propias con módulos, delegación de lectura (RLS) y de acciones (las funciones de ofertas y
-- postulaciones), auditoría y registro sin rol. Sobre la réplica de producción con lo anterior ya aplicado, como hoy en producción.
-- Variables: MIG (20261013120000_institution_members.sql), MIG2 (20261013130000_institution_staff_context.sql), HELPERS (../clinical_scope/helpers.sql), SIGNUP (20261012140000_restore_signup_trigger.sql)
\i :HELPERS

-- Ejecuta una sentencia SIN devolver filas (para probar escrituras «a ciegas» y ver qué pasó después).
CREATE FUNCTION public.t_exec(u uuid, r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt; v_res := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_res := 'ERR[' || SQLSTATE || '] ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

-- Ejecuta como superusuario (sin sesión) una sentencia y devuelve el error si lo hay (para probar disparadores y restricciones).
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

\set m1 '00000000-0000-0000-0000-0000000000e1'
\set m2 '00000000-0000-0000-0000-0000000000e2'
\set m3 '00000000-0000-0000-0000-0000000000e3'
\set m4 '00000000-0000-0000-0000-0000000000e4'
\set m5 '00000000-0000-0000-0000-0000000000e5'
\set pr3 '00000000-0000-0000-0000-0000000000a3'

-- Cuentas del personal (las crea el servidor con la marca de personal) y otro profesional.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (:'m1','staff.m1@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m2','staff.m2@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m3','staff.m3@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m4','staff.m4@humanix.lat','{"signup_kind":"institution_staff"}'),
  (:'m5','staff.m5@humanix.lat','{"signup_kind":"institution_staff"}');
INSERT INTO auth.users(id, email) VALUES (:'pr3','p3@t.co');
INSERT INTO public.user_roles(user_id, role) VALUES (:'pr3','professional');

-- Escena (con los disparadores de guarda apagados: solo para armarla).
SET session_replication_role = replica;
INSERT INTO public.profiles(user_id, full_name, city, phone) VALUES
  (:'i1','Clínica Norte','Bogotá','6011111111'), (:'i2','Hospital Sur','Medellín','6042222222'),
  (:'p1','Laura Gómez Pérez','Bogotá','3001110001'), (:'p2','Camilo Ríos Soto','Bogotá','3001110002'), (:'pr3','Diana Mora Cruz','Bogotá','3001110003'),
  (:'f1','Ana Gómez','Bogotá','3101111111'),
  (:'m1','Marta Coordinadora',NULL,NULL), (:'m2','Jorge Talento',NULL,NULL), (:'m3','Sara Suspendida',NULL,NULL), (:'m4','Luis Otra Institución',NULL,NULL), (:'m5','Elena Extra',NULL,NULL)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.institution_profiles(user_id, institution_name, institution_type, nit, city, address, verified, legal_representative_name, legal_representative_phone, lat, lng, visible_on_map) VALUES
  (:'i1','Clínica Norte','Clínica','900123456-7','Bogotá','Cra 15 # 100-20',true,'Ana María Duarte','3109998888',4.66,-74.04,true),
  (:'i2','Hospital Sur','Hospital','800765432-1','Medellín','Cl 10 # 40-20',true,'Pedro Gil','3101112222',6.24,-75.58,true)
  ON CONFLICT (user_id) DO UPDATE SET institution_name = EXCLUDED.institution_name, nit = EXCLUDED.nit, verified = true,
      legal_representative_name = EXCLUDED.legal_representative_name, legal_representative_phone = EXCLUDED.legal_representative_phone, lat = EXCLUDED.lat, lng = EXCLUDED.lng;
INSERT INTO public.professional_profiles(user_id, specialty, rethus_verified, verified, home_city, service_cities, published, available, blocked, avg_rating, total_jobs, trust_score, lat, lng) VALUES
  (:'p1','Auxiliar de enfermería',true,true,'Bogotá','{Bogotá}',true,true,false,4.8,12,82,4.61,-74.08),
  (:'p2','Auxiliar de enfermería',true,true,'Bogotá','{Bogotá}',true,true,false,4.5,5,70,4.62,-74.07),
  (:'pr3','Enfermería',true,false,'Bogotá','{Bogotá}',true,true,false,4.0,2,60,4.63,-74.06)
  ON CONFLICT (user_id) DO UPDATE SET published = true, available = true, blocked = false;
SET session_replication_role = origin;
-- Planes: i1 e i2 con «IPS Mejorado» (multi_user_roles); los demás, sin plan.
INSERT INTO public.mp_subscriptions(user_id, plan, status, current_period_end) VALUES
  (:'i1','institution_monthly','active', now() + interval '20 days'),
  (:'i2','institution_monthly','active', now() + interval '20 days'),
  (:'p1','essential_monthly','active', now() + interval '20 days');

-- ═══ 0) Antes de la migración ═══════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('0.1 antes: no existe la tabla del personal', to_regclass('public.institution_members') IS NULL);
SELECT public.t_true('0.2 antes: ninguna función de ofertas actúa por la institución', NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND pg_get_functiondef(p.oid) LIKE '%hx_acting_institution%'));

\i :MIG
\i :MIG2

-- ═══ A) La tabla y sus permisos ═════════════════════════════════════════════════════════════════════════════════
SELECT public.t_true('A.1 existe con RLS', to_regclass('public.institution_members') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.institution_members'::regclass));
SELECT public.t_true('A.2 anon sin privilegios; authenticated solo lee; nadie escribe por la API ni vacía la tabla',
  NOT has_table_privilege('anon', 'public.institution_members', 'SELECT')
  AND has_table_privilege('authenticated', 'public.institution_members', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.institution_members', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.institution_members', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.institution_members', 'DELETE') AND NOT has_table_privilege('authenticated', 'public.institution_members', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.institution_members', 'INSERT'));
SELECT public.t_eq('A.3 tres políticas de lectura (dueña, la propia persona y el personal de Humanix)',
  (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'institution_members'),
  'im_select_owner:SELECT,im_select_self:SELECT,im_select_staff:SELECT');
SELECT public.t_true('A.4 la auditoría: RLS, solo lectura para authenticated y nada para anon',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.institution_member_actions'::regclass)
  AND has_table_privilege('authenticated', 'public.institution_member_actions', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.institution_member_actions', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.institution_member_actions', 'SELECT'));
SELECT public.t_eq('A.5 el catálogo de módulos de esta versión', (SELECT array_to_string(public.hx_staff_modules(), ',')), 'ofertas,talento');
SELECT public.t_true('A.6 las funciones auxiliares: solo con sesión; las internas cerradas',
  has_function_privilege('authenticated', 'public.hx_acting_institution(uuid,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hx_acting_institution(uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.hx_member_can(uuid,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hx_member_can(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_member_guard()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.hx_member_clean_roles()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hx_log_member_action()', 'EXECUTE'));

SELECT public.t_true('A.7 my_staff_context: solo con sesión (nunca el visitante)',
  has_function_privilege('authenticated', 'public.my_staff_context()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.my_staff_context()', 'EXECUTE'));
SELECT public.t_true('A.8 la lista del equipo y su actividad se publican en Realtime',
  (SELECT count(*) = 2 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('institution_members', 'institution_member_actions')));
SELECT public.t_true('A.9 el personal ya no tiene política para leer el perfil de la institución (NIT, representante legal, dirección)',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'institution_profiles' AND policyname = 'inst_member_select'));
SELECT public.t_true('A.10 «último acceso» existe y empieza vacío', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'institution_members' AND column_name = 'last_seen_at')
  AND NOT EXISTS (SELECT 1 FROM public.institution_members WHERE last_seen_at IS NOT NULL));

-- ═══ B) Quién puede ser personal ════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, job_title, modules, status) VALUES
  (:'i1', :'m1', 'marta.coord', 'Marta Coordinadora', 'Coordinadora de turnos', '{ofertas}', 'active'),
  (:'i1', :'m2', 'jorge.talento', 'Jorge Talento', 'Selección', '{talento}', 'active'),
  (:'i1', :'m3', 'sara.susp', 'Sara Suspendida', NULL, '{ofertas,talento}', 'suspended'),
  (:'i2', :'m4', 'luis.otra', 'Luis Otra Institución', NULL, '{ofertas,talento}', 'active');
SELECT public.t_eq('B.1 las cuatro personas quedaron registradas', (SELECT count(*)::text FROM public.institution_members), '4');
SELECT public.t_err('B.2 una cuenta no puede ser su propio personal',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'auto.cuenta','Auto Cuenta','{ofertas}')$q$, :'i1', :'i1')), 'propio personal');
SELECT public.t_err('B.3 solo una institución tiene personal (una familia no)',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'fam.equipo','Fam Equipo','{ofertas}')$q$, :'f1', :'m5')), 'Solo una institución');
SELECT public.t_err('B.4 una cuenta con rol propio (profesional) no pasa a ser personal',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'pro.equipo','Pro Equipo','{ofertas}')$q$, :'i1', :'pr3')), 'ya tiene un rol');
SELECT public.t_err('B.5 la cuenta debe haberse creado como personal (marca de registro)',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'sin.marca','Sin Marca','{ofertas}')$q$, :'i1', :'p2')), 'ya tiene un rol');
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000e9', 'sinmarca@t.co');
SELECT public.t_err('B.5b ni una cuenta nueva sin la marca de personal',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,'00000000-0000-0000-0000-0000000000e9','sin.marca','Sin Marca','{ofertas}')$q$, :'i1')), 'debe crearse desde el panel');
SELECT public.t_err('B.6 el usuario tiene un formato fijo (minúsculas, sin espacios)',
  public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'Ana Perez','Ana Pérez','{ofertas}')$q$, :'i1', :'m5')), 'username');
SELECT public.t_err('B.7 solo módulos del catálogo', public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'elena.extra','Elena Extra','{pacientes}')$q$, :'i1', :'m5')), 'modules');
SELECT public.t_err('B.7b solo estados «active» o «suspended»', public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules, status) VALUES (%L,%L,'elena.extra','Elena Extra','{ofertas}','bloqueado')$q$, :'i1', :'m5')), 'status');
SELECT public.t_err('B.8 el usuario es único en toda la plataforma', public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'marta.coord','Otra Marta','{ofertas}')$q$, :'i2', :'m5')), 'duplicate key');
SELECT public.t_err('B.9 una cuenta pertenece a una sola institución', public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,%L,'marta.dos','Marta Dos','{ofertas}')$q$, :'i2', :'m1')), 'duplicate key');

-- El registro da por defecto el rol «familia» (y su perfil): al personal se le retira.
INSERT INTO public.user_roles(user_id, role) VALUES (:'m5', 'family');
INSERT INTO public.family_profiles(user_id) VALUES (:'m5') ON CONFLICT DO NOTHING;
SELECT public.t_eq('B.10 antes de registrarla, la cuenta tiene el rol por defecto', (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = :'m5'), 'family');
INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (:'i1', :'m5', 'elena.extra', 'Elena Extra', '{ofertas}');
SELECT public.t_eq('B.11 al registrarla como personal no queda ningún rol ni perfil de familia',
  (SELECT count(*) FROM public.user_roles WHERE user_id = :'m5')::text || '/' || (SELECT count(*) FROM public.family_profiles WHERE user_id = :'m5')::text, '0/0');
SELECT public.t_eq('B.12 los demás roles no se tocan (el profesional sigue siéndolo)', (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = :'pr3'), 'professional');

-- El tope: 10 por institución (i1 ya tiene 4: m1, m2, m3, m5).
DO $$
DECLARE k int; u uuid;
BEGIN
  FOR k IN 1..6 LOOP
    u := ('00000000-0000-0000-0000-00000000f0' || lpad(k::text, 2, '0'))::uuid;
    INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (u, 'bulk' || k || '@humanix.lat', '{"signup_kind":"institution_staff"}');
    INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules)
    VALUES ('00000000-0000-0000-0000-0000000000b1', u, 'bulk.' || k, 'Persona ' || k, '{talento}');
  END LOOP;
END $$;
SELECT public.t_eq('B.13 la institución llegó a 10', (SELECT count(*)::text FROM public.institution_members WHERE institution_id = :'i1'), '10');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-00000000f0ff', 'bulk11@humanix.lat', '{"signup_kind":"institution_staff"}');
SELECT public.t_err('B.14 la persona 11 se rechaza', public.t_sys(format($q$INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (%L,'00000000-0000-0000-0000-00000000f0ff','bulk.11','Persona 11','{talento}')$q$, :'i1')), 'hasta 10');
-- Se libera el cupo para el resto de las pruebas.
DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-00000000f0%';
SELECT public.t_eq('B.15 borrar la cuenta borra su fila (y libera el cupo)', (SELECT count(*)::text FROM public.institution_members WHERE institution_id = :'i1'), '4');
UPDATE public.institution_members SET institution_id = :'i2', member_user_id = :'m4', username = 'otro.usuario', created_at = '2000-01-01' WHERE username = 'marta.coord';
SELECT public.t_eq('B.16 de quién es, quién es y cómo entra no se cambian: solo módulos, estado y datos',
  (SELECT institution_id::text || '/' || member_user_id::text || '/' || username || '/' || (created_at > '2001-01-01')::text FROM public.institution_members WHERE display_name = 'Marta Coordinadora'),
  :'i1' || '/' || :'m1' || '/marta.coord/true');

-- ═══ C) Quién actúa ═════════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('C.1 con el módulo, el personal actúa como la institución', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'i1');
SELECT public.t_eq('C.2 sin el módulo, actúa como él mismo (y el resto lo rechaza)', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'talento')::text$q$), :'m1');
SELECT public.t_eq('C.3 un módulo que no existe tampoco', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'pacientes')::text$q$), :'m1');
SELECT public.t_eq('C.4 suspendido: actúa como él mismo', public.t_val(:'m3', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'m3');
SELECT public.t_eq('C.5 la institución misma y las demás cuentas no cambian', public.t_val(:'i1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$) || '/' || public.t_val(:'p1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'i1' || '/' || :'p1');
SELECT public.t_eq('C.6 no sirve para averiguar de quién es otra cuenta', public.t_val(:'f1', format($q$SELECT public.hx_acting_institution(%L::uuid, 'ofertas')::text$q$, :'m1')), :'m1');
SELECT public.t_err('C.7 sin sesión no se puede ni preguntar (la función no es pública)', public.t_anon($q$SELECT COALESCE(public.hx_acting_institution(NULL, 'ofertas')::text, 'NULL')$q$), 'permission denied');
SELECT public.t_eq('C.7b y con sesión pero sin uid propio, tampoco hay institución', public.t_val(:'m1', $q$SELECT COALESCE(public.hx_acting_institution(NULL, 'ofertas')::text, 'NULL')$q$), 'NULL');
SELECT public.t_eq('C.8 hx_member_can: sí para su institución y su módulo; no para otra, otro módulo o sin sesión',
  public.t_val(:'m1', format($q$SELECT public.hx_member_can(%L::uuid, 'ofertas')::text$q$, :'i1')) || '/' ||
  public.t_val(:'m1', format($q$SELECT public.hx_member_can(%L::uuid, 'ofertas')::text$q$, :'i2')) || '/' ||
  public.t_val(:'m1', format($q$SELECT public.hx_member_can(%L::uuid, 'talento')::text$q$, :'i1')) || '/' ||
  public.t_val(:'i1', format($q$SELECT public.hx_member_can(%L::uuid, 'ofertas')::text$q$, :'i1')), 'true/false/false/false');
-- El plan: «multi_user_roles» es de IPS Mejorado. Sin él, la delegación se apaga sola.
UPDATE public.mp_subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = :'i1';
SELECT public.t_eq('C.9 si la institución pierde el plan, el personal deja de actuar por ella', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'m1');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '20 days', plan = 'essential_monthly' WHERE user_id = :'i1';
SELECT public.t_eq('C.10 tampoco con un plan sin ese beneficio', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'m1');
UPDATE public.mp_subscriptions SET plan = 'institution_monthly' WHERE user_id = :'i1';
SELECT public.t_eq('C.11 al volver el plan, vuelve', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'i1');
-- Si la institución deja de serlo, tampoco.
DELETE FROM public.user_roles WHERE user_id = :'i2' AND role = 'institution';
SELECT public.t_eq('C.12 si la cuenta ya no es una institución, el personal no actúa por ella', public.t_val(:'m4', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'m4');
INSERT INTO public.user_roles(user_id, role) VALUES (:'i2', 'institution');
SELECT public.t_eq('C.13 al restablecerse, vuelve', public.t_val(:'m4', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'i2');

-- ═══ D) Lo que se ve: lectura por módulo ════════════════════════════════════════════════════════════════════════
-- Una oferta de cada institución, publicada por la propia institución (antes de delegar nada).
SELECT public.t_val(:'i1', $q$SELECT public.publish_institution_offer(jsonb_build_object(
  'title','Auxiliar de enfermería UCI – noches','description','Cubrimos noches en UCI adultos','modality','shift','amount',180000,'city','Bogotá',
  'specialty_required','Auxiliar de enfermería','is_urgent',true,
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '30 hours', 'ends_at', now() + interval '42 hours', 'positions', 1),
                              jsonb_build_object('starts_at', now() + interval '54 hours', 'ends_at', now() + interval '66 hours', 'positions', 1))))::text$q$) AS offer_i1 \gset
SELECT public.t_val(:'i2', $q$SELECT public.publish_institution_offer(jsonb_build_object(
  'title','Enfermería hospitalización – días','modality','shift','amount',200000,'city','Medellín','specialty_required','Enfermería',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '30 hours', 'ends_at', now() + interval '42 hours', 'positions', 1))))::text$q$) AS offer_i2 \gset
SELECT public.t_true('D.0 cada institución publicó su oferta', :'offer_i1' ~ '^[0-9a-f-]{36}$' AND :'offer_i2' ~ '^[0-9a-f-]{36}$');
-- Una oferta CERRADA de cada institución (las abiertas las ve cualquiera; el personal debe ver además las cerradas de la suya, no las de otra).
SET session_replication_role = replica;
INSERT INTO public.job_offers(posted_by, poster_type, title, modality, amount, city, status) VALUES
  (:'i1', 'institution', 'Oferta cerrada de la clínica', 'shift', 150000, 'Bogotá', 'closed'),
  (:'i2', 'institution', 'Oferta cerrada del hospital', 'shift', 150000, 'Medellín', 'closed');
SET session_replication_role = origin;
SELECT public.t_val(:'p1', format($q$SELECT public.apply_to_offer(%L::uuid, NULL, 'Tengo 5 años en UCI', NULL)::text$q$, :'offer_i1')) AS app1 \gset
SELECT public.t_val(:'p2', format($q$SELECT public.apply_to_offer(%L::uuid, NULL, 'Disponible esos turnos', NULL)::text$q$, :'offer_i1')) AS app2 \gset
SELECT public.t_val(:'pr3', format($q$SELECT public.apply_to_offer(%L::uuid, NULL, 'Me interesa', NULL)::text$q$, :'offer_i2')) AS app_i2 \gset
SELECT public.t_true('D.0b hay tres postulaciones', :'app1' ~ '^[0-9a-f-]{36}$' AND :'app2' ~ '^[0-9a-f-]{36}$' AND :'app_i2' ~ '^[0-9a-f-]{36}$');

SELECT public.t_eq('D.1 «ofertas»: ve las ofertas CERRADAS de su institución y no las de otra',
  public.t_val(:'m1', $q$SELECT COALESCE(string_agg(title, ' | ' ORDER BY title), 'ninguna') FROM public.job_offers WHERE status::text <> 'open'$q$), 'Oferta cerrada de la clínica');
SELECT public.t_eq('D.1b un profesional o una familia no ven ofertas cerradas de nadie',
  public.t_val(:'p2', $q$SELECT COALESCE(string_agg(title, ' | ' ORDER BY title), 'ninguna') FROM public.job_offers WHERE status::text <> 'open'$q$) || '/' ||
  public.t_val(:'f1', $q$SELECT COALESCE(string_agg(title, ' | ' ORDER BY title), 'ninguna') FROM public.job_offers WHERE status::text <> 'open'$q$), 'ninguna/ninguna');
SELECT public.t_eq('D.2 ve los turnos de sus ofertas', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.job_offer_shifts$q$), '2');
SELECT public.t_eq('D.3 ve las postulaciones a sus ofertas (las dos), no las de otra', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.applications$q$), '2');
SELECT public.t_eq('D.4 el personal NO lee la fila de la institución (NIT, representante legal, dirección); la dueña sí la suya',
  public.t_val(:'m1', $q$SELECT count(*)::text FROM public.institution_profiles$q$) || '/' || public.t_val(:'m2', $q$SELECT count(*)::text FROM public.institution_profiles$q$) || '/' ||
  public.t_val(:'i1', $q$SELECT count(*)::text FROM public.institution_profiles$q$), '0/0/1');
SELECT public.t_eq('D.5 el personal de la otra institución ve las cerradas de la suya y no las de la clínica',
  public.t_val(:'m4', $q$SELECT COALESCE(string_agg(title, ' | ' ORDER BY title), 'ninguna') FROM public.job_offers WHERE status::text <> 'open'$q$), 'Oferta cerrada del hospital');
SELECT public.t_eq('D.6 el personal suspendido no ve nada de la institución (ni cerradas, ni postulaciones, ni perfil)',
  public.t_val(:'m3', $q$SELECT (SELECT count(*) FROM public.job_offers WHERE status::text <> 'open') || '/' || (SELECT count(*) FROM public.applications) || '/' || (SELECT count(*) FROM public.institution_profiles)$q$), '0/0/0');
SELECT public.t_eq('D.7 con solo «talento» no ve ofertas ni postulaciones',
  public.t_val(:'m2', $q$SELECT (SELECT count(*) FROM public.job_offers WHERE poster_type::text = 'institution' AND status::text <> 'open') || '/' || (SELECT count(*) FROM public.applications) || '/' || (SELECT count(*) FROM public.job_offer_shifts) || '/' || (SELECT count(*) FROM public.institution_profiles)$q$),
  '0/0/0/0');
SELECT public.t_eq('D.8 una familia y un profesional no ven postulaciones ajenas (nada cambió para ellos)',
  public.t_val(:'f1', $q$SELECT count(*)::text FROM public.applications$q$) || '/' || public.t_val(:'p2', $q$SELECT count(*)::text FROM public.applications$q$), '0/1');
SELECT public.t_eq('D.9 la institución dueña sigue viendo lo suyo', public.t_val(:'i1', $q$SELECT count(*)::text FROM public.applications$q$), '2');
SELECT public.t_eq('D.10 quien no es del equipo no ve el equipo de otro', public.t_val(:'i2', $q$SELECT count(*)::text FROM public.institution_members WHERE institution_id <> auth.uid()$q$) || '/' || public.t_val(:'p1', $q$SELECT count(*)::text FROM public.institution_members$q$), '0/0');
SELECT public.t_eq('D.11 la dueña ve a su equipo completo; cada persona, solo su fila',
  public.t_val(:'i1', $q$SELECT count(*)::text FROM public.institution_members$q$) || '/' || public.t_val(:'m1', $q$SELECT count(*)::text FROM public.institution_members$q$) || '/' || public.t_val(:'sa', $q$SELECT count(*)::text FROM public.institution_members$q$), '4/1/5');

SELECT public.t_eq('D.11b la persona suspendida sigue viendo su propia fila (para poder avisarle)', public.t_val(:'m3', $q$SELECT status FROM public.institution_members$q$), 'suspended');

-- Escrituras directas: el personal NO escribe por la API (solo por las funciones).
SELECT count(*) AS n_ofertas FROM public.job_offers \gset
SELECT public.t_err('D.12 no inserta ofertas por la API (a ciegas)', public.t_exec(:'m1', 'authenticated', format($q$INSERT INTO public.job_offers(posted_by, poster_type, title, modality, amount, city, status) VALUES (%L, 'institution', 'Oferta por la puerta de atrás', 'shift', 100000, 'Bogotá', 'open')$q$, :'i1')), 'row-level security');
SELECT public.t_exec(:'m1', 'authenticated', $q$UPDATE public.job_offers SET title = 'Cambiada' WHERE poster_type::text = 'institution'$q$) AS r13 \gset
SELECT public.t_eq('D.13 no modifica ofertas (0 filas afectadas)', :'r13' || '/' || (SELECT count(*) FROM public.job_offers WHERE title = 'Cambiada')::text, 'ok/0');
SELECT public.t_exec(:'m1', 'authenticated', $q$DELETE FROM public.job_offers WHERE poster_type::text = 'institution'$q$) AS r14 \gset
SELECT public.t_eq('D.14 no borra ofertas', :'r14' || '/' || (SELECT count(*) - :n_ofertas FROM public.job_offers)::text, 'ok/0');
SELECT public.t_exec(:'m1', 'authenticated', $q$UPDATE public.applications SET status = 'rejected'$q$) AS r15 \gset
SELECT public.t_eq('D.15 no cambia postulaciones directamente (ni siquiera a «rechazada»)', :'r15' || '/' || (SELECT count(*) FROM public.applications WHERE status::text <> 'pending')::text, 'ok/0');
SELECT public.t_exec(:'m1', 'authenticated', $q$UPDATE public.job_offer_shifts SET positions = 99$q$) AS r16 \gset
SELECT public.t_eq('D.16 no modifica los turnos', :'r16' || '/' || (SELECT count(*) FROM public.job_offer_shifts WHERE positions = 99)::text, 'ok/0');
SELECT public.t_err('D.17 no escribe en su propia fila ni en la tabla de auditoría', public.t_exec(:'m1', 'authenticated', $q$UPDATE public.institution_members SET modules = '{ofertas,talento}'$q$) || public.t_exec(:'m1', 'authenticated', $q$INSERT INTO public.institution_member_actions(institution_id, member_user_id, action, target_table) VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 'job_offers')$q$), 'permission denied');
SELECT public.t_eq('D.18 y su fila no cambió', (SELECT modules::text FROM public.institution_members WHERE member_user_id = :'m1'), '{ofertas}');

-- ═══ E) Acciones: las funciones de ofertas y postulaciones ═════════════════════════════════════════════════════
SELECT public.t_eq('E.1 la bandeja del personal con «ofertas» trae las postulaciones de su institución',
  public.t_val(:'m1', $q$SELECT string_agg(professional_name || ':' || status, ',' ORDER BY professional_name) FROM public.institution_application_inbox()$q$), 'Camilo Ríos Soto:pending,Laura Gómez Pérez:pending');
SELECT public.t_eq('E.2 la bandeja de la institución es la misma', public.t_val(:'i1', $q$SELECT count(*)::text FROM public.institution_application_inbox()$q$), '2');
SELECT public.t_err('E.3 sin el módulo «ofertas» la bandeja se rechaza', public.t_val(:'m2', $q$SELECT count(*)::text FROM public.institution_application_inbox()$q$), 'No autorizado');
SELECT public.t_err('E.4 suspendido también', public.t_val(:'m3', $q$SELECT count(*)::text FROM public.institution_application_inbox()$q$), 'No autorizado');
SELECT public.t_eq('E.5 otra institución solo ve la suya', public.t_val(:'m4', $q$SELECT string_agg(professional_name, ',') FROM public.institution_application_inbox()$q$), 'Diana Mora Cruz');
SELECT public.t_err('E.6 un profesional no usa la bandeja', public.t_val(:'p1', $q$SELECT count(*)::text FROM public.institution_application_inbox()$q$), 'No autorizado');

-- Publicar
SELECT public.t_val(:'m1', $q$SELECT public.publish_institution_offer(jsonb_build_object(
  'title','Enfermería jefe – fin de semana','description','Turno de fin de semana para la clínica','modality','shift','amount',220000,'city','Bogotá','specialty_required','Enfermería',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '80 hours', 'ends_at', now() + interval '92 hours', 'positions', 1))))::text$q$) AS offer_m1 \gset
SELECT public.t_true('E.7 el personal con «ofertas» publica un turno', :'offer_m1' ~ '^[0-9a-f-]{36}$');
SELECT public.t_eq('E.8 la oferta es de la INSTITUCIÓN (no de la persona) y de tipo institución',
  (SELECT posted_by::text || '/' || poster_type::text FROM public.job_offers WHERE id = :'offer_m1'::uuid), :'i1' || '/institution');
SELECT public.t_eq('E.9 el turno quedó con su agenda', (SELECT count(*)::text FROM public.job_offer_shifts WHERE job_offer_id = :'offer_m1'::uuid), '1');
SELECT public.t_err('E.10 con solo «talento» no publica', public.t_val(:'m2', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'Solo las instituciones');
SELECT public.t_err('E.11 suspendido no publica', public.t_val(:'m3', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'Solo las instituciones');
SELECT public.t_err('E.12 las reglas de siempre siguen: valor fuera de rango', public.t_val(:'m1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"hour","amount":500,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'valor debe estar entre');
SELECT public.t_err('E.13 y la moderación: teléfono en la descripción', public.t_val(:'m1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","description":"Llamar al 3001234567","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'no puede incluir teléfonos');
SELECT public.t_err('E.14 un profesional no publica (nada cambió)', public.t_val(:'p1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'Solo las instituciones');

-- Responder postulaciones
SELECT public.t_err('E.15 el personal de OTRA institución no acepta postulaciones ajenas', public.t_val(:'m4', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')), 'Solo quien debe responder');
SELECT public.t_err('E.16 con solo «talento» no acepta', public.t_val(:'m2', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')), 'Solo quien debe responder');
SELECT public.t_err('E.17 suspendido no acepta', public.t_val(:'m3', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')), 'Solo quien debe responder');
SELECT public.t_err('E.18 el profesional no se acepta a sí mismo', public.t_val(:'p1', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')), 'Solo quien debe responder');
SELECT public.t_err('E.19 el personal de otra institución no rechaza postulaciones ajenas', public.t_val(:'m4', format($q$SELECT public.decline_application(%L::uuid, NULL)::text$q$, :'app1')), 'No participas');
SELECT public.t_err('E.20 ni contraoferta', public.t_val(:'m4', format($q$SELECT public.counter_application(%L::uuid, 190000, NULL)::text$q$, :'app1')), 'Solo quien debe responder');

SELECT public.t_eq('E.21 el personal contraoferta (ronda 2) como la institución', public.t_val(:'m1', format($q$SELECT public.counter_application(%L::uuid, 190000, 'Podemos pagar 190.000 por turno')::text$q$, :'app1')), '2');
SELECT public.t_eq('E.22 quedó a la espera del profesional', (SELECT awaiting || '/' || proposed_amount || '/' || round_no FROM public.applications WHERE id = :'app1'::uuid), 'professional/190000/2');
SELECT public.t_eq('E.23 el evento lo registra la institución (actor)', (SELECT count(*)::text FROM public.application_events WHERE application_id = :'app1'::uuid AND event = 'countered' AND actor_id = :'i1'::uuid AND actor_role = 'institution'), '1');
SELECT public.t_err('E.24 el personal no puede contraofertar dos veces seguidas', public.t_val(:'m1', format($q$SELECT public.counter_application(%L::uuid, 185000, NULL)::text$q$, :'app1')), 'Solo quien debe responder');
SELECT public.t_eq('E.25 el profesional responde con su contraoferta (ronda 3)', public.t_val(:'p1', format($q$SELECT public.counter_application(%L::uuid, 185000, NULL)::text$q$, :'app1')), '3');

SELECT public.t_val(:'m1', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')) AS accept1 \gset
SELECT public.t_true('E.26 el personal acepta la postulación', :'accept1' NOT LIKE 'ERR%');
SELECT public.t_eq('E.27 la reserva es de la INSTITUCIÓN (cliente) y del profesional correcto',
  (SELECT DISTINCT client_id::text || '/' || professional_id::text FROM public.service_bookings WHERE application_id = :'app1'::uuid), :'i1' || '/' || :'p1');
SELECT public.t_eq('E.28 valor acordado y estado', (SELECT status::text || '/' || agreed_amount FROM public.applications WHERE id = :'app1'::uuid), 'accepted/185000');
SELECT public.t_eq('E.29 se generó el contrato de la institución', (SELECT count(*)::text FROM public.smart_contracts WHERE application_id = :'app1'::uuid), '1');
SELECT public.t_eq('E.30 la institución (no la persona) recibió el aviso de la reserva', (SELECT count(*)::text FROM public.notifications WHERE user_id = :'i1'::uuid AND type = 'booking_confirmed'), '1');
SELECT public.t_eq('E.31 la persona del equipo no recibe avisos de la institución', (SELECT count(*)::text FROM public.notifications WHERE user_id = :'m1'::uuid), '0');
SELECT public.t_err('E.32 no se acepta dos veces', public.t_val(:'m1', format($q$SELECT public.accept_application(%L::uuid, NULL)::text$q$, :'app1')), 'ya no está disponible');

SELECT public.t_eq('E.33 la bandeja del personal muestra la aceptada con su contrato', public.t_val(:'m1', format($q$SELECT status || '/' || (contract_id IS NOT NULL)::text FROM public.institution_application_inbox() WHERE application_id = %L$q$, :'app1')), 'accepted/true');
SELECT public.t_eq('E.33b al llenarse la oferta, las demás postulaciones se cierran solas (como siempre)', (SELECT status::text || '/' || closed_reason FROM public.applications WHERE id = :'app2'::uuid), 'rejected/offer_filled');
SELECT public.t_val(:'p2', format($q$SELECT public.apply_to_offer(%L::uuid, NULL, 'Puedo el fin de semana', NULL)::text$q$, :'offer_m1')) AS app4 \gset
SELECT public.t_eq('E.34 el personal rechaza una postulación con nota', public.t_exec(:'m1', 'authenticated', format($q$SELECT public.decline_application(%L::uuid, 'No encaja con el presupuesto')$q$, :'app4')), 'ok');
SELECT public.t_eq('E.35 rechazada por la institución con su nota', (SELECT status::text || '/' || closed_reason || '/' || decision_note FROM public.applications WHERE id = :'app4'::uuid), 'rejected/institution_declined/No encaja con el presupuesto');
SELECT public.t_err('E.35b el personal de la clínica no rechaza postulaciones del hospital', public.t_val(:'m1', format($q$SELECT public.decline_application(%L::uuid, NULL)::text$q$, :'app_i2')), 'No participas');
-- El profesional retira su postulación con la misma función (sin cambios para quien no es del equipo).
SELECT public.t_val(:'pr3', format($q$SELECT public.apply_to_offer(%L::uuid, NULL, 'Otra postulación', NULL)::text$q$, :'offer_m1')) AS app3 \gset
SELECT public.t_eq('E.36 el profesional sigue retirando su postulación como siempre', public.t_exec(:'pr3', 'authenticated', format($q$SELECT public.decline_application(%L::uuid, NULL)$q$, :'app3')), 'ok');
SELECT public.t_eq('E.37 retirada por el profesional', (SELECT status::text || '/' || closed_reason FROM public.applications WHERE id = :'app3'::uuid), 'withdrawn/professional_withdrew');

SELECT public.t_eq('E.38 invitar al equipo de confianza a una oferta abierta: el personal con «ofertas» puede', public.t_val(:'m1', format($q$SELECT public.invite_team_to_offer(%L::uuid)::text$q$, :'offer_m1')), '0');
SELECT public.t_err('E.39 el personal de otra institución no', public.t_val(:'m4', format($q$SELECT public.invite_team_to_offer(%L::uuid)::text$q$, :'offer_m1')), 'No autorizado');
SELECT public.t_err('E.40 con solo «talento» no', public.t_val(:'m2', format($q$SELECT public.invite_team_to_offer(%L::uuid)::text$q$, :'offer_m1')), 'No autorizado');

-- Lo que NO se delega: contratos, pagos, perfil de la institución, otros equipos.
SELECT public.t_eq('E.41 el personal no ve el contrato ni la dirección privada: no hay política de lectura para él',
  public.t_val(:'m1', $q$SELECT (SELECT count(*) FROM public.smart_contracts) || '/' || (SELECT count(*) FROM public.job_offer_private)$q$), '0/0');
SELECT public.t_exec(:'m1', 'authenticated', $q$UPDATE public.institution_profiles SET institution_name = 'Hackeada'$q$) AS r42 \gset
SELECT public.t_eq('E.42 no cambia el perfil de la institución', :'r42' || '/' || (SELECT count(*) FROM public.institution_profiles WHERE institution_name = 'Hackeada')::text, 'ok/0');

-- Con el plan vencido, las acciones también se apagan.
UPDATE public.mp_subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = :'i1';
SELECT public.t_err('E.43 sin el plan de la institución, el personal ya no publica', public.t_val(:'m1', $q$SELECT public.publish_institution_offer('{"title":"Oferta de prueba","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb)::text$q$), 'Solo las instituciones');
SELECT public.t_eq('E.44 ni ve las ofertas por la API', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.job_offers WHERE poster_type::text = 'institution' AND status::text <> 'open'$q$), '0');
SELECT public.t_eq('E.45 la institución sí sigue publicando (su plan no es lo que limita sus funciones)', public.t_val(:'i1', $q$SELECT (public.publish_institution_offer('{"title":"Oferta propia sin plan","modality":"shift","amount":150000,"city":"Bogotá","shifts":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T16:00:00Z"}]}'::jsonb) IS NOT NULL)::text$q$), 'true');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = :'i1';

-- ═══ F) Quién hizo qué ═════════════════════════════════════════════════════════════════════════════════════════
SELECT public.t_eq('F.1 la auditoría registra lo que hizo el personal (y solo eso)',
  (SELECT string_agg(action, ',' ORDER BY id) FROM public.institution_member_actions),
  'offer_published,application_countered,application_accepted,application_rejected,offer_updated,application_rejected');
SELECT public.t_eq('F.2 con la persona y la institución correctas',
  (SELECT count(*)::text FROM public.institution_member_actions WHERE member_user_id = :'m1'::uuid AND institution_id = :'i1'::uuid AND member_name = 'Marta Coordinadora'), '6');
SELECT public.t_eq('F.3 lo que hace la dueña, un profesional o el sistema no se registra como del equipo',
  (SELECT count(*)::text FROM public.institution_member_actions WHERE member_user_id <> :'m1'::uuid), '0');
SELECT public.t_eq('F.4 la dueña lee su auditoría; la otra institución, el personal y las familias no',
  public.t_val(:'i1', $q$SELECT count(*)::text FROM public.institution_member_actions$q$) || '/' || public.t_val(:'i2', $q$SELECT count(*)::text FROM public.institution_member_actions$q$) || '/' ||
  public.t_val(:'m1', $q$SELECT count(*)::text FROM public.institution_member_actions$q$) || '/' || public.t_val(:'f1', $q$SELECT count(*)::text FROM public.institution_member_actions$q$) || '/' ||
  public.t_val(:'sa', $q$SELECT count(*)::text FROM public.institution_member_actions$q$), '6/0/0/0/6');

-- Si registrar falla, la acción se hace igual (la auditoría nunca frena el trabajo).
ALTER TABLE public.institution_member_actions ADD CONSTRAINT zz_prueba_falla CHECK (action <> 'offer_published') NOT VALID;
SELECT public.t_val(:'m1', $q$SELECT public.publish_institution_offer(jsonb_build_object(
  'title','Cuidador nocturno – prueba de auditoría','modality','shift','amount',160000,'city','Bogotá','specialty_required','Cuidador',
  'shifts', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '100 hours', 'ends_at', now() + interval '108 hours', 'positions', 1))))::text$q$) AS offer_m1b \gset
ALTER TABLE public.institution_member_actions DROP CONSTRAINT zz_prueba_falla;
SELECT public.t_true('F.5 si el registro falla, la oferta se publica igual', :'offer_m1b' ~ '^[0-9a-f-]{36}$' AND EXISTS (SELECT 1 FROM public.job_offers WHERE id = :'offer_m1b'::uuid));
SELECT public.t_eq('F.6 y esa no quedó en la auditoría (el resto sí)', (SELECT count(*)::text FROM public.institution_member_actions WHERE action = 'offer_published'), '1');

-- ═══ G) El registro de cuentas ═════════════════════════════════════════════════════════════════════════════════
\i :SIGNUP
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000000d1','nuevo.staff@humanix.lat','{"signup_kind":"institution_staff","full_name":"Nuevo Personal"}'),
  ('00000000-0000-0000-0000-0000000000d2','nueva.familia@t.co','{"full_name":"Nueva Familia"}'),
  ('00000000-0000-0000-0000-0000000000d3','nuevo.pro@t.co','{"role":"professional","full_name":"Nuevo Pro"}'),
  ('00000000-0000-0000-0000-0000000000d4','nueva.inst@t.co','{"role":"institution","institution_name":"IPS Nueva","full_name":"IPS Nueva"}');
SELECT public.t_eq('G.1 el personal nuevo recibe perfil, nunca un rol ni un perfil de familia',
  (SELECT count(*) FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d1')::text || '/' ||
  (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000d1')::text || '/' ||
  (SELECT count(*) FROM public.family_profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d1')::text, '1/0/0');
SELECT public.t_eq('G.2 una cuenta cualquiera sigue recibiendo «familia» por defecto',
  (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000d2') || '/' || (SELECT count(*) FROM public.family_profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d2')::text, 'family/1');
SELECT public.t_eq('G.3 un profesional sigue recibiendo su rol y su perfil',
  (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000d3') || '/' || (SELECT count(*) FROM public.professional_profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d3')::text, 'professional/1');
SELECT public.t_eq('G.4 una institución sigue recibiendo su rol y su perfil',
  (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000d4') || '/' || (SELECT institution_name FROM public.institution_profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d4'), 'institution/IPS Nueva');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000d5','casi.staff@t.co','{"signup_kind":"institution_staffs"}');
SELECT public.t_eq('G.5b una marca que solo se parece no quita el rol por defecto', (SELECT string_agg(role::text, ',') FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000d5'), 'family');
-- Ese personal nuevo ya puede registrarse como tal (la cuenta pasó por el registro y no tiene roles).
INSERT INTO public.institution_members(institution_id, member_user_id, username, display_name, modules) VALUES (:'i1', '00000000-0000-0000-0000-0000000000d1', 'nuevo.staff', 'Nuevo Personal', '{ofertas,talento}');
SELECT public.t_eq('G.6 y queda como personal de la institución', (SELECT institution_id::text FROM public.institution_members WHERE username = 'nuevo.staff'), :'i1');

-- ═══ H) Módulo «talento»: la lista de ofertas de profesionales ═════════════════════════════════════════════════
INSERT INTO public.user_roles(user_id, role) SELECT :'p1', 'professional' WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = :'p1' AND role = 'professional');
SELECT public.t_val(:'p1', $q$INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (auth.uid(), 'Auxiliar de enfermería para cuidado domiciliario', 'Cuidado de pacientes en casa', 'Auxiliar', 'hour', 20000, 'Bogotá') RETURNING id$q$) AS so1 \gset
SELECT public.t_eq('H.1 el personal con «talento» ve las ofertas de los profesionales', public.t_val(:'m2', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), '1');
SELECT public.t_eq('H.2 con la cercanía medida desde la sede de SU institución (sin ubicación de familia)', public.t_val(:'m2', $q$SELECT COALESCE(t.distance_band_km::text, 'sin') FROM public.list_open_service_offers() t$q$), '10');
SELECT public.t_err('H.3 con solo «ofertas» no', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), 'Solo las familias y las instituciones');
SELECT public.t_err('H.4 suspendido no', public.t_val(:'m3', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), 'Solo las familias y las instituciones');
SELECT public.t_eq('H.5 la institución y la familia siguen igual', public.t_val(:'i1', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$) || '/' || public.t_val(:'f1', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), '1/1');
SELECT public.t_err('H.6 otro profesional no', public.t_val(:'p2', $q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), 'Solo las familias y las instituciones');
SELECT public.t_err('H.7 sin sesión no', public.t_anon($q$SELECT count(*)::text FROM public.list_open_service_offers()$q$), 'permission denied');
SELECT public.t_eq('H.8 la lista no trae teléfono ni dirección', (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters
  WHERE specific_schema = 'public' AND specific_name LIKE 'list\_open\_service\_offers%' ESCAPE '\' AND parameter_mode = 'OUT' AND parameter_name ~* '(phone|address|telefono|direccion|email)'), NULL);

-- Defensa en profundidad: aunque una descripción antigua traiga un teléfono (se inserta saltando la moderación), la lista lo oculta.
SET session_replication_role = replica;
INSERT INTO public.professional_service_offers(professional_id, title, description, specialty, modality, amount, city)
  VALUES (:'p2', 'Cuidado de adultos mayores', 'Escríbeme al 3001234567 para coordinar', 'Auxiliar', 'hour', 18000, 'Bogotá');
SET session_replication_role = origin;
SELECT public.t_eq('H.9 la lista del personal muestra las dos ofertas pero sin el teléfono de la descripción',
  public.t_val(:'m2', $q$SELECT count(*)::text || '/' || count(*) FILTER (WHERE t.description ~ '3001234567')::text FROM public.list_open_service_offers() t$q$), '2/0');

-- ═══ I) Las funciones parchadas conservan todo lo demás ═══════════════════════════════════════════════════════
SELECT public.t_true('I.1 las seis funciones actúan por la institución y siguen siendo SECURITY DEFINER con search_path fijo',
  (SELECT count(*) = 6 AND bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public%' AND pg_get_functiondef(p.oid) LIKE '%hx_acting_institution(auth.uid(), ''ofertas'')%')
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('publish_institution_offer','accept_application','decline_application','counter_application','institution_application_inbox','invite_team_to_offer')));
SELECT public.t_true('I.2 y siguen con los mismos permisos (solo cuentas con sesión; nunca anon)',
  (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('publish_institution_offer','accept_application','decline_application','counter_application','institution_application_inbox','invite_team_to_offer')));
SELECT public.t_true('I.3 ninguna otra función cambió de forma: las del profesional no actúan por la institución',
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('apply_to_offer','reveal_offer_contact','my_offer_applications','list_open_institution_offers','my_smart_contracts','record_contract_signature')
              AND pg_get_functiondef(p.oid) LIKE '%hx_acting_institution%'));
SELECT public.t_eq('I.4 los disparadores de guarda y auditoría están una vez cada uno',
  (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgname IN ('trg_member_guard','trg_member_clean_roles','trg_member_audit_offers','trg_member_audit_apps') AND NOT tgisinternal),
  'trg_member_audit_apps,trg_member_audit_offers,trg_member_clean_roles,trg_member_guard');

-- ═══ M) Contexto de la persona del equipo ═══════════════════════════════════════════════════════════════════
SELECT public.t_eq('M.1 la persona con «ofertas» recibe su contexto: institución, ciudad, usuario, módulos, estado y plan',
  public.t_val(:'m1', format($q$SELECT institution_name || '/' || institution_city || '/' || username || '/' || modules::text || '/' || status || '/' || plan_active::text || '/' || (institution_id = %L)::text FROM public.my_staff_context()$q$, :'i1')),
  'Clínica Norte/Bogotá/marta.coord/{ofertas}/active/true/true');
SELECT public.t_eq('M.2 la persona suspendida recibe su fila (para avisarle) pero sin ciudad y con el plan en falso',
  public.t_val(:'m3', $q$SELECT institution_name || '/' || COALESCE(institution_city, 'sin') || '/' || username || '/' || status || '/' || plan_active::text FROM public.my_staff_context()$q$),
  'Clínica Norte/sin/sara.susp/suspended/false');
SELECT public.t_eq('M.3 cada persona recibe solo su fila', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) || '/' || public.t_val(:'m2', $q$SELECT username FROM public.my_staff_context()$q$), '1/jorge.talento');
SELECT public.t_eq('M.4 quien no es del equipo no recibe nada (institución, profesional, familia, personal de Humanix)',
  public.t_val(:'i1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) || '/' || public.t_val(:'p1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) || '/' ||
  public.t_val(:'f1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) || '/' || public.t_val(:'sa', $q$SELECT count(*)::text FROM public.my_staff_context()$q$), '0/0/0/0');
SELECT public.t_err('M.5 el visitante no la llama', public.t_anon($q$SELECT count(*)::text FROM public.my_staff_context()$q$), 'permission denied');
SELECT public.t_err('M.5b y una sesión sin identidad tampoco', public.t_val(NULL, $q$SELECT count(*)::text FROM public.my_staff_context()$q$), 'No autenticado');

UPDATE public.mp_subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = :'i1';
SELECT public.t_eq('M.6 sin el plan vigente de la institución, el contexto lo dice (plan_active en falso)', public.t_val(:'m1', $q$SELECT plan_active::text FROM public.my_staff_context()$q$), 'false');
UPDATE public.mp_subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = :'i1';
SELECT public.t_eq('M.6b al volver el plan, vuelve', public.t_val(:'m1', $q$SELECT plan_active::text FROM public.my_staff_context()$q$), 'true');
DELETE FROM public.user_roles WHERE user_id = :'i1' AND role = 'institution';
SELECT public.t_eq('M.7 si la cuenta ya no es una institución, tampoco', public.t_val(:'m1', $q$SELECT plan_active::text FROM public.my_staff_context()$q$), 'false');
INSERT INTO public.user_roles(user_id, role) VALUES (:'i1', 'institution');

UPDATE public.institution_profiles SET institution_name = '   ' WHERE user_id = :'i1';
SELECT public.t_eq('M.8 sin nombre de institución, un texto neutro', public.t_val(:'m1', $q$SELECT institution_name FROM public.my_staff_context()$q$), 'Tu institución');
UPDATE public.institution_profiles SET institution_name = 'Clínica Norte' WHERE user_id = :'i1';

-- Último acceso: se anota al entrar y como mucho cada 10 minutos; la persona suspendida no lo toca.
SELECT public.t_eq('M.9 al entrar queda anotado el último acceso (y la institución lo lee)',
  public.t_val(:'i1', $q$SELECT (last_seen_at IS NOT NULL)::text FROM public.institution_members WHERE username = 'marta.coord'$q$), 'true');
UPDATE public.institution_members SET last_seen_at = now() - interval '1 minute' WHERE username = 'marta.coord';
SELECT public.t_val(:'m1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) AS touched1 \gset
SELECT public.t_true('M.10 si entró hace menos de 10 minutos, no se vuelve a anotar', (SELECT now() - last_seen_at BETWEEN interval '50 seconds' AND interval '5 minutes' FROM public.institution_members WHERE username = 'marta.coord'));
UPDATE public.institution_members SET last_seen_at = now() - interval '20 minutes' WHERE username = 'marta.coord';
SELECT public.t_val(:'m1', $q$SELECT count(*)::text FROM public.my_staff_context()$q$) AS touched2 \gset
SELECT public.t_true('M.11 si pasaron más de 10 minutos, se anota de nuevo', (SELECT now() - last_seen_at < interval '1 minute' FROM public.institution_members WHERE username = 'marta.coord'));
SELECT public.t_eq('M.12 la persona suspendida no deja «último acceso»', (SELECT COALESCE(last_seen_at::text, 'nunca') FROM public.institution_members WHERE username = 'sara.susp'), 'nunca');
SELECT public.t_eq('M.13 la persona con solo «talento» también lo deja y no ve el de otras',
  public.t_val(:'m2', $q$SELECT (SELECT (last_seen_at IS NOT NULL)::text FROM public.institution_members WHERE username = 'jorge.talento') || '/' || (SELECT count(*)::text FROM public.institution_members)$q$), 'true/1');

-- ═══ J) Segunda pasada ════════════════════════════════════════════════════════════════════════════════════════
SELECT (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND (p.proname IN ('publish_institution_offer','accept_application','decline_application','counter_application','institution_application_inbox','invite_team_to_offer',
            'handle_new_user','list_open_service_offers','hx_acting_institution','hx_member_can','hx_member_guard','hx_member_clean_roles','hx_log_member_action','hx_staff_modules','my_staff_context'))) AS sig_fn,
       (SELECT md5(string_agg(tablename || policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY tablename, policyname)) FROM pg_policies
          WHERE tablename IN ('institution_members','institution_member_actions') OR policyname IN ('jo_member_select','jos_member_select','apps_member_select','inst_member_select')) AS sig_pol,
       (SELECT count(*) FROM public.institution_members) AS sig_rows,
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\_member\_%' AND NOT tgisinternal) AS sig_trg \gset
\i :MIG
\i :MIG2
SELECT public.t_eq('J.1 la segunda pasada no cambia las funciones ni sus permisos', (SELECT md5(string_agg(md5(pg_get_functiondef(p.oid)) || COALESCE(p.proacl::text, ''), '|' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND (p.proname IN ('publish_institution_offer','accept_application','decline_application','counter_application','institution_application_inbox','invite_team_to_offer',
            'handle_new_user','list_open_service_offers','hx_acting_institution','hx_member_can','hx_member_guard','hx_member_clean_roles','hx_log_member_action','hx_staff_modules','my_staff_context'))), :'sig_fn');
SELECT public.t_eq('J.2 ni las políticas', (SELECT md5(string_agg(tablename || policyname || cmd || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY tablename, policyname)) FROM pg_policies
          WHERE tablename IN ('institution_members','institution_member_actions') OR policyname IN ('jo_member_select','jos_member_select','apps_member_select','inst_member_select')), :'sig_pol');
SELECT public.t_eq('J.3 ni los datos', (SELECT count(*)::text FROM public.institution_members), :'sig_rows');
SELECT public.t_eq('J.4 ni duplica disparadores', (SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg\_member\_%' AND NOT tgisinternal), :'sig_trg');
SELECT public.t_eq('J.5 las funciones siguen funcionando tras la segunda pasada', public.t_val(:'m1', $q$SELECT count(*)::text FROM public.institution_application_inbox()$q$), '4');

-- ═══ K) Borrados ═══════════════════════════════════════════════════════════════════════════════════════════════
DELETE FROM auth.users WHERE id = :'m4';
SELECT public.t_eq('K.1 borrar la cuenta de una persona borra su fila', (SELECT count(*)::text FROM public.institution_members WHERE username = 'luis.otra'), '0');
SELECT public.t_eq('K.2 la auditoría se conserva aunque se borre a la persona', (SELECT count(*)::text FROM public.institution_member_actions WHERE member_user_id = :'m1'::uuid), '6');
SELECT count(*) AS n_antes_inst FROM public.institution_members WHERE institution_id = :'i1' \gset
DELETE FROM public.user_roles WHERE user_id = :'i1' AND role = 'institution';
SELECT public.t_eq('K.3 sin el rol de institución nadie del equipo actúa por ella', public.t_val(:'m1', $q$SELECT public.hx_acting_institution(auth.uid(), 'ofertas')::text$q$), :'m1');
INSERT INTO public.user_roles(user_id, role) VALUES (:'i1', 'institution');

-- ═══ L) Si una función cambió de forma, la migración se detiene y no deja nada a medias ═════════════════════════
SELECT pg_read_file(:'MIG') AS migsql \gset
-- invite_team_to_offer vuelve a su forma original y gana un segundo uso de auth.uid(): ya no se puede parchar con seguridad.
DO $t$
DECLARE d text := pg_get_functiondef('public.invite_team_to_offer(uuid)'::regprocedure);
BEGIN
  d := replace(d, 'public.hx_acting_institution(auth.uid(), ''ofertas'')', 'auth.uid()');
  d := regexp_replace(d, 'BEGIN', E'BEGIN\n  PERFORM auth.uid();');
  EXECUTE d;
END $t$;
SELECT public.t_err('L.1 con una función de otra forma, la migración se detiene', public.t_sys(:'migsql'), 'no tiene la forma esperada');
SELECT public.t_true('L.2 y no se parchó nada a medias: la función sigue sin delegar', (SELECT pg_get_functiondef('public.invite_team_to_offer(uuid)'::regprocedure) NOT LIKE '%hx_acting_institution%'));
-- Se restablece la forma original y todo vuelve a funcionar.
DO $t$
DECLARE d text := pg_get_functiondef('public.invite_team_to_offer(uuid)'::regprocedure);
BEGIN
  EXECUTE replace(d, E'BEGIN\n  PERFORM auth.uid();', 'BEGIN');
END $t$;
\i :MIG
\i :MIG2
SELECT public.t_true('L.3 restablecida, la migración vuelve a aplicarse y la función delega', (SELECT pg_get_functiondef('public.invite_team_to_offer(uuid)'::regprocedure) LIKE '%hx_acting_institution(auth.uid(), ''ofertas'')%'));

\pset tuples_only off
SELECT count(*) FILTER (WHERE ok) AS pasaron, count(*) FILTER (WHERE NOT ok) AS fallaron, count(*) AS total FROM public._t;
SELECT n, name, detail FROM public._t WHERE NOT ok ORDER BY n;
