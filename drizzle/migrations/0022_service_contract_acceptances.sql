CREATE TABLE IF NOT EXISTS public.service_contract_acceptances (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid        NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL,
  party         text        NOT NULL CHECK (party IN ('client', 'professional')),
  terms_version text        NOT NULL,
  text_sha256   text        NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  key_terms     jsonb       NOT NULL,
  consents      text[]      NOT NULL DEFAULT '{}',
  ip            text,
  user_agent    text,
  accepted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sca_booking ON public.service_contract_acceptances (booking_id, accepted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sca_same_terms
  ON public.service_contract_acceptances (booking_id, party, terms_version, text_sha256);
ALTER TABLE public.service_contract_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_contract_acceptances FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.service_contract_acceptances TO service_role;
GRANT SELECT ON public.service_contract_acceptances TO authenticated;
DROP POLICY IF EXISTS sca_staff_read ON public.service_contract_acceptances;
CREATE POLICY sca_staff_read ON public.service_contract_acceptances
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.hx_sca_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'La aceptación de un contrato no se puede modificar.' USING ERRCODE = '42501';
END
$$;
DROP TRIGGER IF EXISTS trg_sca_immutable ON public.service_contract_acceptances;
CREATE TRIGGER trg_sca_immutable BEFORE UPDATE ON public.service_contract_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.hx_sca_immutable();

CREATE OR REPLACE FUNCTION public.hx_request_ip()
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  h   jsonb;
  ip  text;
  xff text[];
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    h := NULL;
  END;
  ip := NULLIF(btrim(COALESCE(h ->> 'cf-connecting-ip', '')), '');
  IF ip IS NULL THEN
    xff := string_to_array(COALESCE(h ->> 'x-forwarded-for', ''), ',');
    IF array_length(xff, 1) IS NOT NULL THEN
      ip := NULLIF(btrim(xff[array_length(xff, 1)]), '');
    END IF;
  END IF;
  RETURN left(ip, 64);
END
$$;
REVOKE EXECUTE ON FUNCTION public.hx_request_ip() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hx_accept_service_contract(
  p_booking_id  uuid,
  p_version     text,
  p_text_sha256 text,
  p_consents    text[],
  p_user_agent  text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  b       public.service_bookings%ROWTYPE;
  v_party text;
  v_terms jsonb;
  v_at    timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  v_party := CASE WHEN v_uid = b.client_id THEN 'client'
                  WHEN v_uid = b.professional_id THEN 'professional' END;
  IF v_party IS NULL THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;
  IF b.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF p_version IS DISTINCT FROM 'hx-cuidado-v1' THEN
    RETURN jsonb_build_object('result', 'invalid_version');
  END IF;
  IF p_text_sha256 IS NULL OR p_text_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('result', 'invalid_hash');
  END IF;
  IF p_consents IS NULL OR NOT (p_consents @> ARRAY['contract', 'health_data']) THEN
    RETURN jsonb_build_object('result', 'consent_required');
  END IF;

  v_terms := jsonb_build_object(
    'scheduled_at',   to_jsonb(b.scheduled_at),
    'duration_hours', b.duration_hours,
    'total_amount',   b.total_amount,
    'payment_method', CASE WHEN b.payment_method = 'CASH' THEN 'CASH' ELSE 'DIGITAL_BREB' END,
    'hourly_rate',    b.hourly_rate,
    'platform_fee_pct', b.platform_fee_pct,
    'client_id',      b.client_id,
    'professional_id', b.professional_id,
    'status',         b.status
  );

  INSERT INTO public.service_contract_acceptances
    (booking_id, user_id, party, terms_version, text_sha256, key_terms, consents, ip, user_agent)
  VALUES
    (b.id, v_uid, v_party, p_version, p_text_sha256, v_terms,
     ARRAY(SELECT DISTINCT unnest(p_consents) ORDER BY 1), public.hx_request_ip(), left(p_user_agent, 300))
  ON CONFLICT (booking_id, party, terms_version, text_sha256) DO NOTHING
  RETURNING accepted_at INTO v_at;

  IF v_at IS NULL THEN
    RETURN jsonb_build_object('result', 'already_accepted');
  END IF;

  BEGIN
    PERFORM public.hx_notify(
      CASE WHEN v_party = 'client' THEN b.professional_id ELSE b.client_id END,
      'service_contract_accepted',
      'Contrato aceptado',
      CASE WHEN v_party = 'client' THEN 'Quien te contrató aceptó el acuerdo de cuidado.'
           ELSE 'El profesional aceptó el acuerdo de cuidado.' END,
      '/servicio/' || b.id::text);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  RETURN jsonb_build_object('result', 'accepted', 'accepted_at', v_at);
END
$$;
REVOKE ALL ON FUNCTION public.hx_accept_service_contract(uuid, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_accept_service_contract(uuid, text, text, text[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hx_service_contract_status(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b     public.service_bookings%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_uid IS NULL
     OR NOT (v_uid IN (b.client_id, b.professional_id) OR public.is_staff(v_uid)) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'party', a.party,
             'user_id', a.user_id,
             'terms_version', a.terms_version,
             'text_sha256', a.text_sha256,
             'accepted_at', a.accepted_at,
             'key_terms', a.key_terms,
             'ip', CASE WHEN a.user_id = v_uid THEN a.ip END,
             'user_agent', CASE WHEN a.user_id = v_uid THEN a.user_agent END
           ) ORDER BY a.accepted_at DESC)
      FROM public.service_contract_acceptances a
     WHERE a.booking_id = p_booking_id), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.hx_service_contract_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_service_contract_status(uuid) TO authenticated;