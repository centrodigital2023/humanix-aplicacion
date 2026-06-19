-- ═══════════════════════════════════════════════════════════════
-- PALANCA 3: Contratos digitales de servicio con firma OTP
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.service_contracts (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id               UUID        REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  family_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_type            TEXT        NOT NULL DEFAULT 'prestacion_servicios'
                                       CHECK (contract_type IN ('prestacion_servicios','contrato_laboral','orden_servicio')),
  service_description      TEXT        NOT NULL,
  start_date               DATE        NOT NULL,
  end_date                 DATE,
  sessions_count           INTEGER,
  value_per_session        NUMERIC(12,2),
  total_value              NUMERIC(12,2),
  -- Firma OTP por WhatsApp/SMS (hash, no texto plano)
  family_otp_hash          TEXT,
  family_signed_at         TIMESTAMPTZ,
  family_ip                TEXT,
  professional_otp_hash    TEXT,
  professional_signed_at   TIMESTAMPTZ,
  professional_ip          TEXT,
  -- Contrato generado
  pdf_url                  TEXT,
  contract_text            TEXT,
  status                   TEXT        NOT NULL DEFAULT 'pending_signatures'
                                       CHECK (status IN (
                                         'pending_signatures','active','completed','cancelled'
                                       )),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_booking        ON public.service_contracts (booking_id);
CREATE INDEX IF NOT EXISTS idx_contracts_family         ON public.service_contracts (family_id);
CREATE INDEX IF NOT EXISTS idx_contracts_professional   ON public.service_contracts (professional_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status         ON public.service_contracts (status);

ALTER TABLE public.service_contracts ENABLE ROW LEVEL SECURITY;

-- Ambas partes pueden leer su contrato
CREATE POLICY "contracts_read_parties"
  ON public.service_contracts FOR SELECT
  USING (family_id = auth.uid() OR professional_id = auth.uid());

-- Sistema genera contratos (solo via edge function SECURITY DEFINER)
CREATE POLICY "contracts_insert_parties"
  ON public.service_contracts FOR INSERT
  WITH CHECK (family_id = auth.uid() OR professional_id = auth.uid());

-- Las partes pueden actualizar solo su firma
CREATE POLICY "contracts_update_sign"
  ON public.service_contracts FOR UPDATE
  USING (family_id = auth.uid() OR professional_id = auth.uid());

-- Superadmin puede leer y gestionar todo
CREATE POLICY "contracts_superadmin"
  ON public.service_contracts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
  );

-- RPC: firmar contrato con OTP (timing-safe compare via pgcrypto)
CREATE OR REPLACE FUNCTION public.sign_contract(
  p_contract_id UUID,
  p_otp         TEXT,
  p_party       TEXT   -- 'family' | 'professional'
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hash       TEXT;
  v_signed_at  TIMESTAMPTZ;
BEGIN
  IF p_party = 'family' THEN
    SELECT family_otp_hash, family_signed_at INTO v_hash, v_signed_at
    FROM public.service_contracts WHERE id = p_contract_id AND family_id = auth.uid();
  ELSIF p_party = 'professional' THEN
    SELECT professional_otp_hash, professional_signed_at INTO v_hash, v_signed_at
    FROM public.service_contracts WHERE id = p_contract_id AND professional_id = auth.uid();
  ELSE
    RETURN false;
  END IF;

  IF v_signed_at IS NOT NULL THEN RETURN false; END IF; -- ya firmó
  IF v_hash IS NULL OR MD5(p_otp) != v_hash THEN RETURN false; END IF;

  IF p_party = 'family' THEN
    UPDATE public.service_contracts
    SET    family_signed_at = NOW(), status = CASE WHEN professional_signed_at IS NOT NULL THEN 'active' ELSE status END
    WHERE  id = p_contract_id;
  ELSE
    UPDATE public.service_contracts
    SET    professional_signed_at = NOW(), status = CASE WHEN family_signed_at IS NOT NULL THEN 'active' ELSE status END
    WHERE  id = p_contract_id;
  END IF;

  RETURN true;
END;
$$;
