-- ═══════════════════════════════════════════════════════════════
-- PALANCA 4: Bitácora asistencial en tiempo real
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.care_logs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           UUID        NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  professional_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_name         TEXT,
  event_type           TEXT        NOT NULL
                                   CHECK (event_type IN (
                                     'arrival','medication','vital_signs','meal',
                                     'activity','note','incident','departure'
                                   )),
  description          TEXT        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 800),
  -- Signos vitales (opcionales)
  vital_systolic       INTEGER     CHECK (vital_systolic BETWEEN 50 AND 250),
  vital_diastolic      INTEGER     CHECK (vital_diastolic BETWEEN 30 AND 150),
  vital_heart_rate     INTEGER     CHECK (vital_heart_rate BETWEEN 20 AND 300),
  vital_temperature    NUMERIC(4,1) CHECK (vital_temperature BETWEEN 30 AND 45),
  vital_oxygen         INTEGER     CHECK (vital_oxygen BETWEEN 50 AND 100),
  -- Foto adjunta (URL en storage)
  photo_url            TEXT,
  -- Alertas
  is_alert             BOOLEAN     NOT NULL DEFAULT false,
  alert_reason         TEXT,
  -- Notificación enviada por WhatsApp
  notified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_care_logs_booking    ON public.care_logs (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_logs_pro        ON public.care_logs (professional_id);
CREATE INDEX IF NOT EXISTS idx_care_logs_alert      ON public.care_logs (is_alert) WHERE is_alert = true;

ALTER TABLE public.care_logs ENABLE ROW LEVEL SECURITY;

-- Profesional del turno puede insertar y leer sus propios registros
CREATE POLICY "care_logs_professional_insert"
  ON public.care_logs FOR INSERT
  WITH CHECK (professional_id = auth.uid());

CREATE POLICY "care_logs_professional_read"
  ON public.care_logs FOR SELECT
  USING (professional_id = auth.uid());

-- Cliente de la reserva puede leer la bitácora de su turno
CREATE POLICY "care_logs_client_read"
  ON public.care_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.service_bookings sb
      WHERE sb.id = booking_id AND sb.client_id = auth.uid()
    )
  );

-- Superadmin puede leer todo
CREATE POLICY "care_logs_superadmin_read"
  ON public.care_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
  );

-- Función para obtener resumen del turno
CREATE OR REPLACE FUNCTION public.get_care_summary(p_booking_id UUID)
RETURNS TABLE (
  event_count      INTEGER,
  has_vitals       BOOLEAN,
  has_incident     BOOLEAN,
  last_event_at    TIMESTAMPTZ,
  arrival_at       TIMESTAMPTZ,
  departure_at     TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    COUNT(*)::INTEGER,
    BOOL_OR(event_type = 'vital_signs'),
    BOOL_OR(event_type = 'incident'),
    MAX(created_at),
    MIN(created_at) FILTER (WHERE event_type = 'arrival'),
    MAX(created_at) FILTER (WHERE event_type = 'departure')
  FROM public.care_logs
  WHERE booking_id = p_booking_id;
$$;
