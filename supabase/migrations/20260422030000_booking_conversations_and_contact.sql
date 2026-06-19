-- =============================================================
-- Booking conversations + contact reveal (post-payment only)
-- =============================================================
-- Permite a la familia/institución comunicarse con el profesional
-- por WhatsApp o por la bandeja interna SOLO cuando el booking ya
-- fue aceptado/pagado (status != 'pending' & != 'cancelled').
-- =============================================================

-- 1) Permitir conversaciones ancladas a un booking (además de applications)
ALTER TABLE public.conversations
  ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.service_bookings(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_booking_id_unique
  ON public.conversations(booking_id)
  WHERE booking_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_origin_chk'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_origin_chk
      CHECK (application_id IS NOT NULL OR booking_id IS NOT NULL);
  END IF;
END $$;

-- 2) RPC: obtener o crear conversación ligada a un booking pagado
CREATE OR REPLACE FUNCTION public.get_or_create_booking_conversation(_booking_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id UUID;
  v_pro_id UUID;
  v_status TEXT;
  v_conv_id UUID;
BEGIN
  SELECT client_id, professional_id, status
    INTO v_client_id, v_pro_id, v_status
    FROM public.service_bookings
   WHERE id = _booking_id;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF auth.uid() <> v_client_id
     AND auth.uid() <> v_pro_id
     AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_status NOT IN ('confirmed', 'in_route', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'booking_not_paid';
  END IF;

  -- 2a) Conversación existente por booking
  SELECT id INTO v_conv_id
    FROM public.conversations
   WHERE booking_id = _booking_id
   LIMIT 1;
  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;

  -- 2b) Conversación existente por aplicación entre el mismo par
  SELECT id INTO v_conv_id
    FROM public.conversations
   WHERE poster_id = v_client_id
     AND professional_id = v_pro_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    -- Enlazar booking para futuras lecturas
    UPDATE public.conversations
       SET booking_id = _booking_id
     WHERE id = v_conv_id
       AND booking_id IS NULL;
    RETURN v_conv_id;
  END IF;

  -- 2c) Crear nueva
  INSERT INTO public.conversations (booking_id, poster_id, professional_id)
  VALUES (_booking_id, v_client_id, v_pro_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_booking_conversation(UUID) TO authenticated;

-- 3) Tabla de auditoría: cada vez que alguien revela el teléfono del peer
CREATE TABLE IF NOT EXISTS public.booking_contact_reveals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  revealer_id UUID NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_contact_reveals_booking
  ON public.booking_contact_reveals(booking_id);

ALTER TABLE public.booking_contact_reveals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bcr_self_select"
  ON public.booking_contact_reveals FOR SELECT
  USING (auth.uid() = revealer_id OR public.is_staff(auth.uid()));

CREATE POLICY "bcr_staff_all"
  ON public.booking_contact_reveals FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- 4) RPC: devolver teléfono + nombre del peer SOLO si el booking ya está pagado
CREATE OR REPLACE FUNCTION public.get_booking_contact(_booking_id UUID)
RETURNS TABLE(
  peer_id UUID,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  is_professional BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id UUID;
  v_pro_id UUID;
  v_status TEXT;
  v_peer_id UUID;
  v_is_pro BOOLEAN;
BEGIN
  SELECT client_id, professional_id, status
    INTO v_client_id, v_pro_id, v_status
    FROM public.service_bookings
   WHERE id = _booking_id;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF auth.uid() <> v_client_id
     AND auth.uid() <> v_pro_id
     AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_status NOT IN ('confirmed', 'in_route', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'booking_not_paid';
  END IF;

  IF auth.uid() = v_client_id THEN
    v_peer_id := v_pro_id;
    v_is_pro := TRUE;
  ELSE
    v_peer_id := v_client_id;
    v_is_pro := FALSE;
  END IF;

  -- Auditoría
  INSERT INTO public.booking_contact_reveals (booking_id, revealer_id, channel)
  VALUES (_booking_id, auth.uid(), 'contact_fetch');

  RETURN QUERY
    SELECT p.user_id, p.full_name, p.phone, p.avatar_url, v_is_pro
      FROM public.profiles p
     WHERE p.user_id = v_peer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_contact(UUID) TO authenticated;
