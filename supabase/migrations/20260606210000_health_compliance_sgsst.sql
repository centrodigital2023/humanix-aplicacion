-- ═══════════════════════════════════════════════════════════════════════════
-- SG-SST · BILLETERA DE SALUD OCUPACIONAL
-- Vencimientos de las 6 piezas de cumplimiento ocupacional que un profesional
-- de salud a domicilio debe mantener vigentes (vacunas, examen ocupacional,
-- curso de bioseguridad, póliza de responsabilidad civil, primeros auxilios).
-- Cuando algo vence, el profesional se oculta automáticamente del mapa/buscador
-- (igual que un bloqueo del evaluador) hasta que renueve — y vuelve a aparecer
-- solo. No toca bloqueos manuales: usa `auto_blocked` + el texto del motivo
-- para distinguir "lo bloqueó el SG-SST" de "lo bloqueó un evaluador".
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.health_compliance (
  id                                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id                       UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  vacuna_hepatitis_b_expires            DATE,
  vacuna_tetano_expires                 DATE,
  examen_ocupacional_expires            DATE,
  curso_bioseguridad_expires            DATE,
  poliza_rc_expires                     DATE,
  primeros_auxilios_expires             DATE,
  status                                TEXT        NOT NULL DEFAULT 'incomplete'
                                                    CHECK (status IN ('compliant', 'expiring_soon', 'expired', 'incomplete')),
  auto_blocked                          BOOLEAN     NOT NULL DEFAULT false,
  last_checked_at                       TIMESTAMPTZ,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_compliance_status ON public.health_compliance (status);

ALTER TABLE public.health_compliance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_compliance_owner"
  ON public.health_compliance FOR ALL
  USING (professional_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (professional_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- Trigger: recalcular status y, si corresponde, ocultar/restaurar al
-- profesional del mapa público (professional_profiles.blocked, el mismo flag
-- que ya filtra public_professionals_safe y prof_select_map_public).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_health_compliance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today            DATE := CURRENT_DATE;
  v_dates            DATE[];
  v_has_null         BOOLEAN;
  v_has_expired      BOOLEAN;
  v_has_expiring     BOOLEAN;
  v_was_auto_blocked BOOLEAN;
BEGIN
  v_was_auto_blocked := (TG_OP = 'UPDATE' AND OLD.auto_blocked);

  v_dates := ARRAY[
    NEW.vacuna_hepatitis_b_expires,
    NEW.vacuna_tetano_expires,
    NEW.examen_ocupacional_expires,
    NEW.curso_bioseguridad_expires,
    NEW.poliza_rc_expires,
    NEW.primeros_auxilios_expires
  ];

  SELECT
    EXISTS (SELECT 1 FROM unnest(v_dates) d WHERE d IS NULL),
    EXISTS (SELECT 1 FROM unnest(v_dates) d WHERE d IS NOT NULL AND d < v_today),
    EXISTS (SELECT 1 FROM unnest(v_dates) d WHERE d IS NOT NULL AND d >= v_today AND d < v_today + INTERVAL '30 days')
  INTO v_has_null, v_has_expired, v_has_expiring;

  NEW.status := CASE
    WHEN v_has_expired  THEN 'expired'
    WHEN v_has_expiring THEN 'expiring_soon'
    WHEN v_has_null     THEN 'incomplete'
    ELSE 'compliant'
  END;
  NEW.last_checked_at := NOW();
  NEW.updated_at := NOW();

  IF NEW.status = 'expired' AND NOT v_was_auto_blocked THEN
    UPDATE public.professional_profiles
    SET blocked = true,
        blocked_reason = 'Documentos de salud ocupacional (SG-SST) vencidos — actualízalos en tu panel para volver a aparecer en búsquedas',
        blocked_at = NOW()
    WHERE user_id = NEW.professional_id AND blocked = false;
    NEW.auto_blocked := true;
  ELSIF NEW.status <> 'expired' AND v_was_auto_blocked THEN
    UPDATE public.professional_profiles
    SET blocked = false, blocked_reason = NULL, blocked_at = NULL
    WHERE user_id = NEW.professional_id
      AND blocked = true
      AND blocked_reason LIKE 'Documentos de salud ocupacional%';
    NEW.auto_blocked := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_health_compliance ON public.health_compliance;
CREATE TRIGGER trg_sync_health_compliance
  BEFORE INSERT OR UPDATE ON public.health_compliance
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_health_compliance();

ALTER PUBLICATION supabase_realtime ADD TABLE public.health_compliance;
