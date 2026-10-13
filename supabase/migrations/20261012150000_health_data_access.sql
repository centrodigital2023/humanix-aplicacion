-- ═══════════════════════════════════════════════════════════════════════════════
-- Datos de salud: quién los lee, quién los modifica y qué privilegios sobran (decisiones pedidas el 2026-10-12)
--
-- Cierra, sobre la base real, cuatro observaciones que quedaron abiertas tras 20261012100000_clinical_data_scope.sql:
--
--   1. RR. HH. y evaluadores leían datos de salud. `is_staff()` incluye `hr_staff` y `evaluator`; las políticas de
--      `clinical_alerts`, `vital_signs_readings` y `wearable_connections` (con el código de emparejamiento del dispositivo)
--      lo usaban. `care_logs` ya se había corregido con el mismo criterio (20261010100000). Pasa a solo superadmin.
--   2. La institución y la familia no podían leer las alertas de SUS propios servicios: la política de lectura admitía al
--      paciente, al profesional del servicio y al staff, pero no a quien contrató. Ahora lo admite (solo sus reservas).
--   3. `anon` conservaba ALL (privilegios por defecto de Supabase) sobre `vital_signs_readings` y `wearable_connections`,
--      protegidas solo por RLS. Se retira, y a `authenticated` solo se le dejan los privilegios de datos que ya tenía.
--   4. (Hallazgo al revisar) Cualquier cuenta podía insertar una lectura de signos vitales a nombre de otra familia con solo
--      escribirse como `recorded_by`. Ahora quien registra a nombre de otro debe ser su profesional (reserva vigente).
--
-- Además, las alertas ya no se pueden reescribir: quien las atiende solo puede cambiar el estado y las notas (privilegio por
-- columna), y un disparador pone él mismo quién y cuándo (no se puede atender a nombre de otro ni reabrir una alerta).
--
-- Idempotente; donde una tabla o política no existe, no hace nada. Nunca añade privilegios de datos.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_health$
DECLARE
  super  constant text := $s$public.has_role(auth.uid(), 'superadmin'::public.app_role)$s$;
  t      text;
  kept   text;
  d      record;
BEGIN
  -- ── 1+2) clinical_alerts: lectura y atención ────────────────────────────────
  IF to_regclass('public.clinical_alerts') IS NOT NULL THEN
    DROP POLICY IF EXISTS clinical_alerts_read ON public.clinical_alerts;
    EXECUTE format($f$
      CREATE POLICY clinical_alerts_read ON public.clinical_alerts FOR SELECT TO authenticated
      USING (patient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.service_bookings sb
                      WHERE sb.id = clinical_alerts.booking_id AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid()))
          OR %s)$f$, super);

    -- Atender: el paciente, el profesional del servicio, quien contrató y el superadmin (antes solo paciente y staff).
    DROP POLICY IF EXISTS clinical_alerts_update ON public.clinical_alerts;
    DROP POLICY IF EXISTS clinical_alerts_ack ON public.clinical_alerts;
    EXECUTE format($f$
      CREATE POLICY clinical_alerts_ack ON public.clinical_alerts FOR UPDATE TO authenticated
      USING (patient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.service_bookings sb
                      WHERE sb.id = clinical_alerts.booking_id AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid()))
          OR %1$s)
      WITH CHECK (patient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.service_bookings sb
                      WHERE sb.id = clinical_alerts.booking_id AND (sb.professional_id = auth.uid() OR sb.client_id = auth.uid()))
          OR %1$s)$f$, super);

  END IF;

  -- ── 1+4) vital_signs_readings y 1) wearable_connections: políticas existentes, sin is_staff ──────────────────
  -- (tabla, política, cláusula, expresión): si la política no existe en este entorno se omite.
  FOR d IN
    SELECT * FROM (VALUES
      ('vital_signs_readings', 'vs_select_owner_or_recorder_or_staff', 'USING',
         'auth.uid() = family_user_id OR auth.uid() = recorded_by OR ' || super),
      ('vital_signs_readings', 'vs_update_owner_or_staff', 'USING',
         'auth.uid() = family_user_id OR ' || super),
      ('vital_signs_readings', 'vs_delete_owner_or_staff', 'USING',
         'auth.uid() = family_user_id OR ' || super),
      -- Registrar: la propia familia, su profesional con reserva vigente (a su nombre) o el superadmin.
      ('vital_signs_readings', 'vs_insert_owner_or_pro', 'WITH CHECK',
         'auth.uid() = family_user_id OR (auth.uid() = recorded_by AND EXISTS (SELECT 1 FROM public.service_bookings b '
         || 'WHERE b.professional_id = auth.uid() AND b.client_id = vital_signs_readings.family_user_id '
         || 'AND b.status::text IN (''confirmed'', ''in_progress'', ''completed''))) OR ' || super),
      ('wearable_connections', 'wearable_connections_select_own', 'USING', 'patient_id = auth.uid() OR ' || super),
      ('wearable_connections', 'wearable_connections_delete_own', 'USING', 'patient_id = auth.uid() OR ' || super),
      ('wearable_connections', 'wearable_connections_update_own', 'BOTH', 'patient_id = auth.uid() OR ' || super)
    ) AS v(tbl, pol, clause, expr)
  LOOP
    IF to_regclass('public.' || d.tbl) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = d.tbl AND policyname = d.pol) THEN
      CONTINUE;
    END IF;
    IF d.clause = 'BOTH' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', d.pol, d.tbl, d.expr, d.expr);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I %s (%s)', d.pol, d.tbl, d.clause, d.expr);
    END IF;
  END LOOP;

  -- ── 3) Privilegios: anon fuera; authenticated conserva solo los de datos que ya tenía ──
  FOREACH t IN ARRAY ARRAY['vital_signs_readings', 'wearable_connections', 'clinical_alerts']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    -- authenticated conserva solo los privilegios de datos que ya tenía; en clinical_alerts el UPDATE se concede por columnas.
    SELECT string_agg(p, ', ' ORDER BY p) INTO kept
      FROM unnest(CASE WHEN t = 'clinical_alerts' THEN ARRAY['SELECT', 'INSERT', 'DELETE']
                       ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] END) AS p
     WHERE has_table_privilege('authenticated', 'public.' || t, p);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    IF kept IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO authenticated', kept, t);
    END IF;
  END LOOP;

  -- Solo estado y notas: el valor, el tipo y la gravedad de una alerta no se reescriben desde la API.
  IF to_regclass('public.clinical_alerts') IS NOT NULL THEN
    EXECUTE 'GRANT UPDATE (status, notes, acknowledged_by, acknowledged_at, resolved_at) ON public.clinical_alerts TO authenticated';
  END IF;
END
$hx_health$;

-- ── Atender una alerta: el sistema pone quién y cuándo; no se reabre ─────────────────────────────────────
DO $hx_guard$
BEGIN
  IF to_regclass('public.clinical_alerts') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.clinical_alerts_guard_ack()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
    BEGIN
      -- El servidor (service_role, sin sesión) actualiza lo que necesite: los avisos enviados, por ejemplo.
      IF auth.uid() IS NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status IN ('resolved', 'false_positive') THEN
          RAISE EXCEPTION 'Una alerta cerrada no se reabre' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'active' THEN
          RAISE EXCEPTION 'Una alerta atendida no vuelve a estar activa' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'acknowledged' THEN
          NEW.acknowledged_by := auth.uid();
          NEW.acknowledged_at := now();
        ELSE
          NEW.resolved_at := now();
          IF NEW.acknowledged_by IS NULL THEN
            NEW.acknowledged_by := auth.uid();
            NEW.acknowledged_at := now();
          END IF;
        END IF;
      ELSE
        -- Sin cambio de estado no se tocan quién ni cuándo.
        NEW.acknowledged_by := OLD.acknowledged_by;
        NEW.acknowledged_at := OLD.acknowledged_at;
        NEW.resolved_at := OLD.resolved_at;
      END IF;
      RETURN NEW;
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.clinical_alerts_guard_ack() FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_clinical_alerts_guard_ack ON public.clinical_alerts';
  EXECUTE 'CREATE TRIGGER trg_clinical_alerts_guard_ack BEFORE UPDATE ON public.clinical_alerts
           FOR EACH ROW EXECUTE FUNCTION public.clinical_alerts_guard_ack()';
END
$hx_guard$;
