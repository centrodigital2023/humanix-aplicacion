-- ═══════════════════════════════════════════════════════════════════════════════
-- Datos clínicos: las reglas «por rol» pasan a ser «por servicio» (hallazgo #97 de AUDIT_REPORT.md)
--
-- Qué arregla. `20260606100000_clinical_monitoring.sql` (y la corrección parcial `20260606130000`) crearon políticas
-- que abren TODOS los registros según el rol de la cuenta, no según el servicio al que pertenece cada registro:
--
--     tabla                  política                       quién leía/escribía de más
--     ---------------------  -----------------------------  ---------------------------------------------------
--     clinical_alerts        clinical_alerts_read           cualquier institución
--     clinical_alerts        clinical_alerts_update         cualquier institución (¡modificar cualquier alerta!)
--     patient_risk_scores    risk_scores_read               cualquier profesional o institución
--     service_checkins       checkins_patient_read          cualquier institución (ubicación, evidencias, firma)
--     vital_signs            vital_signs_patient_select     cualquier institución
--     alert_thresholds       alert_thresholds_owner         cualquier institución (leer y modificar)
--     clinical_reports       clinical_reports_read          cualquier profesional o institución
--
-- Cómo queda. Cada política se reemplaza por la relación real con el servicio:
--     el propio paciente · el profesional del servicio · quien contrató el servicio · el superadmin.
-- Lo legítimo se conserva (la institución sigue viendo lo de SUS servicios; la familia, lo de los suyos); desaparece solo
-- el acceso a los de los demás. HR y evaluadores no entran: es un dato de salud (mismo criterio que `care_logs_read`
-- en 20261010100000_care_loop.sql).
--
-- Producción (revisada el 2026-10-12): estas tablas NO existen allí, salvo `clinical_alerts`, que creó otra cadena
-- (drizzle/migrations/0007) con políticas que ya eran estrechas. Por eso esta migración está escrita para ser segura en
-- cualquier entorno:
--   · donde la tabla no existe, no hace nada;
--   · una política solo se reemplaza si sigue siendo la «por rol» (su expresión nombra los roles institution,
--     professional o family); las que ya son estrechas no se tocan, así que NUNCA añade lectores;
--   · es idempotente: una segunda pasada no cambia nada;
--   · si queda en estas tablas alguna política «por rol» que no conoce, falla (y se deshace) en vez de dar una falsa
--     tranquilidad.
-- En producción su único efecto es retirar privilegios que nadie usa de `clinical_alerts` (ver el punto 2).
--
-- Además (defensa en profundidad, como 20261010120000_new_tables_least_privilege.sql):
--   2) anon no necesita nada de estas tablas, y authenticated no necesita TRUNCATE (que ignora RLS), REFERENCES, TRIGGER
--      ni MAINTAIN (PostgreSQL 17+). Sus privilegios de datos (SELECT/INSERT/UPDATE/DELETE) se dejan tal cual estaban:
--      los gobierna RLS y esta migración nunca añade ninguno.
--   3) La vista `eps_dashboard_metrics` se creó sin `security_invoker`: corría con los permisos de su dueño, saltándose
--      RLS, y con los privilegios por defecto de Supabase la podía leer hasta anon. Pasa a `security_invoker`.
--   4) `create_default_thresholds` es SECURITY DEFINER y la podía llamar cualquiera: solo la usa el servidor.
--      Las dos funciones SECURITY DEFINER de este módulo fijan su search_path.
--
-- Decisión pendiente (NO incluida, porque AFLOJA producción y necesita aprobación expresa): que la institución y la
-- familia lean las alertas de los servicios que ellas contrataron. Está descrito en docs/PANELES_PREMIUM.md.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_scope$
DECLARE
  d          record;
  is_wide    boolean;
  using_s    text;
  fixed      int := 0;
  leftovers  text;
  t          text;
  kept       text;
  tables     constant text[] := ARRAY['vital_signs', 'alert_thresholds', 'clinical_alerts', 'service_checkins',
                                      'patient_risk_scores', 'clinical_reports'];
  -- Nombra un rol de la plataforma entre comillas: así se reconoce una política «por rol».
  wide_re    constant text := '''(institution|professional|family)''::';
  super      constant text := $s$public.has_role(auth.uid(), 'superadmin'::public.app_role)$s$;
  -- Relación real con el servicio: el profesional asignado o quien lo contrató.
  by_booking constant text := $s$EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = {t}.booking_id AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid()))$s$;
  -- `service_checkins.booking_id` es texto.
  by_client  constant text := $s$EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id::text = {t}.booking_id AND sb.client_id = auth.uid())$s$;
BEGIN
  -- ── 1) Políticas: de «por rol» a «por servicio» ─────────────────────────────
  FOR d IN
    SELECT * FROM (VALUES
      ('vital_signs',         'vital_signs_patient_select', 'r', 'SELECT',
         'patient_id = auth.uid() OR ' || by_booking || ' OR ' || super),
      ('alert_thresholds',    'alert_thresholds_owner',     '*', 'ALL',
         'patient_id = auth.uid() OR ' || super),
      ('clinical_alerts',     'clinical_alerts_read',       'r', 'SELECT',
         'patient_id = auth.uid() OR ' || by_booking || ' OR ' || super),
      ('clinical_alerts',     'clinical_alerts_update',     'w', 'UPDATE',
         'patient_id = auth.uid() OR ' || by_booking || ' OR ' || super),
      ('service_checkins',    'checkins_patient_read',      'r', 'SELECT',
         'patient_id = auth.uid() OR ' || by_client || ' OR ' || super),
      ('patient_risk_scores', 'risk_scores_read',           'r', 'SELECT',
         'patient_id = auth.uid() OR ' || by_booking || ' OR ' || super),
      ('clinical_reports',    'clinical_reports_read',      'r', 'SELECT',
         'patient_id = auth.uid() OR ' || by_booking || ' OR ' || super)
    ) AS v(tbl, pol, cmd_code, cmd, using_sql)
  LOOP
    IF to_regclass('public.' || d.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = to_regclass('public.' || d.tbl)
         AND p.polname = d.pol
         AND p.polcmd::text = d.cmd_code
         AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ wide_re
    ) INTO is_wide;
    IF NOT is_wide THEN
      CONTINUE;
    END IF;

    using_s := replace(d.using_sql, '{t}', d.tbl);
    EXECUTE format('DROP POLICY %I ON public.%I', d.pol, d.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (%s)%s',
      d.pol, d.tbl, d.cmd, using_s,
      CASE WHEN d.cmd IN ('UPDATE', 'ALL') THEN format(' WITH CHECK (%s)', using_s) ELSE '' END
    );
    fixed := fixed + 1;
    RAISE NOTICE 'acotada: %.%', d.tbl, d.pol;
  END LOOP;

  -- Si queda alguna política «por rol» que esta migración no conoce, no se da por cerrado el hallazgo.
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname) INTO leftovers
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY (tables)
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ wide_re;
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'Quedan políticas por rol en tablas clínicas que esta migración no reconoce: %. Revísalas a mano.', leftovers;
  END IF;

  -- ── 2) Privilegios: lo que nadie usa, fuera ─────────────────────────────────
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    -- authenticated conserva exactamente los privilegios de datos que ya tenía (nunca se le añade ninguno) y pierde el
    -- resto: TRUNCATE, REFERENCES, TRIGGER y, en PostgreSQL 17+, MAINTAIN.
    SELECT string_agg(p, ', ' ORDER BY p) INTO kept
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
     WHERE has_table_privilege('authenticated', 'public.' || t, p);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    IF kept IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO authenticated', kept, t);
    END IF;
  END LOOP;

  -- ── 3) La vista del portal EPS respeta RLS de quien la consulta ─────────────
  IF to_regclass('public.eps_dashboard_metrics') IS NOT NULL THEN
    IF current_setting('server_version_num')::int >= 150000 THEN
      EXECUTE 'ALTER VIEW public.eps_dashboard_metrics SET (security_invoker = true)';
      EXECUTE 'REVOKE ALL ON public.eps_dashboard_metrics FROM anon';
    ELSE
      -- Sin security_invoker (PostgreSQL < 15) no hay forma de que la vista respete RLS: solo el servidor la lee.
      EXECUTE 'REVOKE ALL ON public.eps_dashboard_metrics FROM anon, authenticated';
    END IF;
  END IF;

  -- ── 4) Funciones SECURITY DEFINER del módulo ────────────────────────────────
  IF to_regprocedure('public.create_default_thresholds(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_default_thresholds(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_default_thresholds(uuid) TO service_role';
    EXECUTE 'ALTER FUNCTION public.create_default_thresholds(uuid) SET search_path = public';
  END IF;
  IF to_regprocedure('public.evaluate_vital_alert()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.evaluate_vital_alert() SET search_path = public';
  END IF;

  RAISE NOTICE 'datos clínicos: % política(s) acotada(s)', fixed;
END
$hx_scope$;
