-- Cumplimiento de salud ocupacional (SG-SST) del profesional: habilita `HealthComplianceCard` en producción.
-- Reemplaza 20260606210000_health_compliance_sgsst.sql, que nunca se aplicó (docs/VERIFICACION_PLATAFORMA.md) y tenía estas
-- fallas:
--   1. El profesional podía borrarse su registro y escribir `status`, `auto_blocked` y `last_checked_at` a mano.
--   2. El cálculo solo corría al guardar: una vacuna que vencía sin que nadie tocara la fila nunca ocultaba al profesional.
--   3. Sin GRANT/REVOKE: con los privilegios por defecto de Supabase, anon tenía acceso a la tabla y a la función.
--   4. `ALTER PUBLICATION … ADD TABLE` no era idempotente.
-- Y una falla vieja que esta pieza necesita cerrada: en producción el profesional puede cambiar `blocked` de su propio perfil
-- (`pro_update_self` no lo protege y `guard_professional_trust_fields` no lo incluye). Con eso deshacía tanto el bloqueo de un
-- evaluador como el del SG-SST. Ahora `blocked`, `blocked_reason`, `blocked_at` y `blocked_by` solo los cambian el personal,
-- la clave de servicio o el propio cálculo del SG-SST.
--
-- Cómo queda: el profesional guarda sus fechas de vencimiento; la base calcula el estado. Si algo venció, el perfil se oculta
-- del mapa y del buscador (el mismo `blocked` que ya filtran) con un motivo propio, y vuelve a aparecer solo al renovar. Un
-- bloqueo de un evaluador nunca se levanta por esta vía. Un trabajo diario de pg_cron recalcula lo que vence sin que nadie
-- guarde. Idempotente.

-- ─── 1. Proteger el bloqueo del perfil ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_professional_block_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sin sesión (auth.uid() nulo) es el servidor: SQL directo, pg_cron, migraciones.
  IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' OR public.is_staff(auth.uid())
     OR current_setting('hx.sgsst_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.blocked        := OLD.blocked;
  NEW.blocked_reason := OLD.blocked_reason;
  NEW.blocked_at     := OLD.blocked_at;
  NEW.blocked_by     := OLD.blocked_by;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_professional_block_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_professional_block_fields ON public.professional_profiles;
CREATE TRIGGER trg_guard_professional_block_fields
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_block_fields();

-- Un perfil nuevo creado desde el navegador no nace bloqueado ni desbloqueado a voluntad: nace sin bloqueo.
CREATE OR REPLACE FUNCTION public.guard_professional_block_fields_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role' OR public.is_staff(auth.uid()) OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.blocked := false; NEW.blocked_reason := NULL; NEW.blocked_at := NULL; NEW.blocked_by := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_professional_block_fields_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_professional_block_fields_insert ON public.professional_profiles;
CREATE TRIGGER trg_guard_professional_block_fields_insert
  BEFORE INSERT ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_block_fields_insert();

-- ─── 2. Tabla ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_compliance (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id            uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  vacuna_hepatitis_b_expires date,
  vacuna_tetano_expires      date,
  examen_ocupacional_expires date,
  curso_bioseguridad_expires date,
  poliza_rc_expires          date,
  primeros_auxilios_expires  date,
  status                     text        NOT NULL DEFAULT 'incomplete'
                                         CHECK (status IN ('compliant', 'expiring_soon', 'expired', 'incomplete')),
  auto_blocked               boolean     NOT NULL DEFAULT false,
  last_checked_at            timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_compliance_status ON public.health_compliance (status);

ALTER TABLE public.health_compliance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_compliance FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.health_compliance TO authenticated;
GRANT ALL ON public.health_compliance TO service_role;

DROP POLICY IF EXISTS "health_compliance_owner" ON public.health_compliance;
DROP POLICY IF EXISTS health_compliance_read ON public.health_compliance;
CREATE POLICY health_compliance_read ON public.health_compliance FOR SELECT TO authenticated
  USING (professional_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS health_compliance_insert_own ON public.health_compliance;
CREATE POLICY health_compliance_insert_own ON public.health_compliance FOR INSERT TO authenticated
  WITH CHECK (professional_id = auth.uid() AND public.has_role(auth.uid(), 'professional'::public.app_role));
DROP POLICY IF EXISTS health_compliance_update_own ON public.health_compliance;
CREATE POLICY health_compliance_update_own ON public.health_compliance FOR UPDATE TO authenticated
  USING (professional_id = auth.uid()) WITH CHECK (professional_id = auth.uid());

-- ─── 3. Cálculo del estado y bloqueo automático ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.health_compliance_status(r public.health_compliance, p_today date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM unnest(d) x WHERE x IS NOT NULL AND x < p_today) THEN 'expired'
    WHEN EXISTS (SELECT 1 FROM unnest(d) x WHERE x IS NOT NULL AND x < p_today + 30) THEN 'expiring_soon'
    WHEN EXISTS (SELECT 1 FROM unnest(d) x WHERE x IS NULL) THEN 'incomplete'
    ELSE 'compliant' END
  FROM (SELECT ARRAY[r.vacuna_hepatitis_b_expires, r.vacuna_tetano_expires, r.examen_ocupacional_expires,
                     r.curso_bioseguridad_expires, r.poliza_rc_expires, r.primeros_auxilios_expires] AS d) s
$$;
REVOKE ALL ON FUNCTION public.health_compliance_status(public.health_compliance, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.health_compliance_status(public.health_compliance, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_health_compliance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reason constant text := 'Documentos de salud ocupacional (SG-SST) vencidos — actualízalos en tu panel para volver a aparecer en búsquedas';
  v_was    boolean := (TG_OP = 'UPDATE' AND OLD.auto_blocked);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.professional_id := OLD.professional_id;
    NEW.created_at      := OLD.created_at;
  ELSE
    NEW.created_at := now();
  END IF;
  NEW.status          := public.health_compliance_status(NEW, current_date);
  NEW.last_checked_at := now();
  NEW.updated_at      := now();
  NEW.auto_blocked    := v_was;  -- nunca lo decide quien escribe la fila

  PERFORM set_config('hx.sgsst_sync', 'on', true);
  IF NEW.status = 'expired' AND NOT v_was THEN
    -- Solo se marca como bloqueo del SG-SST si el perfil no estaba ya bloqueado por otra razón.
    UPDATE public.professional_profiles
       SET blocked = true, blocked_reason = v_reason, blocked_at = now(), blocked_by = NULL
     WHERE user_id = NEW.professional_id AND NOT COALESCE(blocked, false);
    NEW.auto_blocked := FOUND;
  ELSIF NEW.status <> 'expired' AND v_was THEN
    UPDATE public.professional_profiles
       SET blocked = false, blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL
     WHERE user_id = NEW.professional_id AND blocked AND blocked_reason = v_reason;
    NEW.auto_blocked := false;
  END IF;
  PERFORM set_config('hx.sgsst_sync', 'off', true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_health_compliance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_health_compliance ON public.health_compliance;
CREATE TRIGGER trg_sync_health_compliance
  BEFORE INSERT OR UPDATE ON public.health_compliance
  FOR EACH ROW EXECUTE FUNCTION public.sync_health_compliance();

-- Recalcula las filas cuyo estado cambió solo por el paso de los días. La corre pg_cron a diario; nadie más.
CREATE OR REPLACE FUNCTION public.refresh_health_compliance()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.health_compliance h SET updated_at = now()
   WHERE h.status IS DISTINCT FROM public.health_compliance_status(h, current_date);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.refresh_health_compliance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_health_compliance() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hx-refresh-health-compliance';
    PERFORM cron.schedule('hx-refresh-health-compliance', '7 5 * * *', 'SELECT public.refresh_health_compliance()');
  END IF;
END $$;

-- ─── 4. Realtime (la tarjeta escucha su propia fila) ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'health_compliance') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.health_compliance;
  END IF;
END $$;
