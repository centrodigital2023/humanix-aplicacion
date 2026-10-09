-- ═══════════════════════════════════════════════════════════════════════════════
-- Prerrequisitos de «Contactar» y del chat en la base de Lovable Cloud
--
-- Al contrastar el repositorio con la base real (2026-10-09) aparecieron tres huecos que bloquean la comunicación
-- entre quien contrata y el profesional. Esta migración es aditiva e idempotente:
--
--  1. MENSAJES ROTOS: la tabla `conversations` tiene un disparador BEFORE UPDATE (`trg_conversations_updated_at`) que
--     asigna `NEW.updated_at`, pero la tabla no tiene esa columna. Cada mensaje nuevo ejecuta
--     `bump_conversation_last_message()` (UPDATE de la conversación) y falla con «record "new" has no field
--     "updated_at"»: ningún mensaje se podía enviar. Se agrega la columna que el disparador espera.
--  2. CHAT POR RESERVA: la función `get_or_create_booking_conversation` (usada por la tarjeta «Contactar» de la página
--     del servicio) y las columnas que necesita no existían (20260422030000 nunca se aplicó). Se restablecen, con una
--     comprobación más estricta: quien llama sin sesión nunca pasa (en la versión original `NULL <> id` no bloqueaba).
--  3. AUDITORÍA DE CONTACTO: `booking_contact_reveals` (tabla que escribe get_booking_contact, 20261009100000) no
--     existía, así que esa función habría fallado en cada llamada.
--
-- Todo con GRANT mínimo + RLS en esta misma migración (las tablas de producción heredan ALL para anon y authenticated).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1) conversations: columna que espera el disparador de «updated_at» ─────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── 2) conversations ancladas a una reserva ───────────────────────────────────
ALTER TABLE public.conversations
  ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.service_bookings(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_booking_id_unique
  ON public.conversations (booking_id)
  WHERE booking_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_origin_chk') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_origin_chk
      CHECK (application_id IS NOT NULL OR booking_id IS NOT NULL);
  END IF;
END $$;

-- Obtener o crear la conversación de una reserva ya confirmada (nunca antes: el contacto se abre al confirmar).
CREATE OR REPLACE FUNCTION public.get_or_create_booking_conversation(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_pro_id    uuid;
  v_status    text;
  v_conv_id   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT client_id, professional_id, status
    INTO v_client_id, v_pro_id, v_status
    FROM public.service_bookings
   WHERE id = _booking_id;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_client_id
     AND auth.uid() IS DISTINCT FROM v_pro_id
     AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('confirmed', 'in_route', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'booking_not_paid';
  END IF;

  -- 2a) Conversación existente de la reserva
  SELECT id INTO v_conv_id FROM public.conversations WHERE booking_id = _booking_id LIMIT 1;
  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;

  -- 2b) Conversación existente entre el mismo par (por postulación): se enlaza a la reserva
  SELECT id INTO v_conv_id
    FROM public.conversations
   WHERE poster_id = v_client_id
     AND professional_id = v_pro_id
     AND booking_id IS NULL
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_conv_id IS NOT NULL THEN
    UPDATE public.conversations SET booking_id = _booking_id WHERE id = v_conv_id AND booking_id IS NULL;
    RETURN v_conv_id;
  END IF;

  -- 2c) Crear una nueva (sin duplicar si dos llamadas coinciden)
  INSERT INTO public.conversations (booking_id, poster_id, professional_id)
  VALUES (_booking_id, v_client_id, v_pro_id)
  ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id FROM public.conversations WHERE booking_id = _booking_id LIMIT 1;
  END IF;
  RETURN v_conv_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_booking_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_booking_conversation(uuid) TO authenticated, service_role;

-- ─── 3) Auditoría: cada vez que alguien revela el contacto de la contraparte ────
CREATE TABLE IF NOT EXISTS public.booking_contact_reveals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  revealer_id uuid NOT NULL,
  channel     text NOT NULL DEFAULT 'whatsapp',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_contact_reveals_booking ON public.booking_contact_reveals (booking_id);

ALTER TABLE public.booking_contact_reveals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcr_self_select" ON public.booking_contact_reveals;
CREATE POLICY "bcr_self_select" ON public.booking_contact_reveals
  FOR SELECT USING (auth.uid() = revealer_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "bcr_staff_all" ON public.booking_contact_reveals;
CREATE POLICY "bcr_staff_all" ON public.booking_contact_reveals
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Solo lo escribe get_booking_contact() (SECURITY DEFINER): el cliente únicamente lee lo suyo.
REVOKE ALL ON public.booking_contact_reveals FROM anon, authenticated;
GRANT SELECT ON public.booking_contact_reveals TO authenticated;
GRANT ALL ON public.booking_contact_reveals TO service_role;
