
-- 1. Geolocalización en ofertas
ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_job_offers_geo ON public.job_offers (lat, lng);
CREATE INDEX IF NOT EXISTS idx_job_offers_reserved ON public.job_offers (reserved_until);

-- 2. Geolocalización + disponibilidad en profesionales
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_city TEXT,
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pro_geo ON public.professional_profiles (lat, lng);
CREATE INDEX IF NOT EXISTS idx_pro_available ON public.professional_profiles (available);

-- 3. Agenda virtual
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','reserved','busy')),
  job_offer_id UUID REFERENCES public.job_offers(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slots_user ON public.availability_slots (user_id, starts_at);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slots_select_owner_or_staff"
ON public.availability_slots FOR SELECT
USING (auth.uid() = user_id OR public.is_staff(auth.uid()) OR status <> 'busy');

CREATE POLICY "slots_insert_owner"
ON public.availability_slots FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "slots_update_owner_or_staff"
ON public.availability_slots FOR UPDATE
USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "slots_delete_owner_or_staff"
ON public.availability_slots FOR DELETE
USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE TRIGGER trg_slots_updated
BEFORE UPDATE ON public.availability_slots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. CRM WhatsApp: contactos
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  phone TEXT NOT NULL,
  display_name TEXT,
  tag TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_owner ON public.whatsapp_contacts (owner_id, last_message_at DESC);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_contacts_owner_all"
ON public.whatsapp_contacts FOR ALL
USING (auth.uid() = owner_id OR public.is_staff(auth.uid()))
WITH CHECK (auth.uid() = owner_id OR public.is_staff(auth.uid()));

CREATE TRIGGER trg_wa_contacts_updated
BEFORE UPDATE ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. CRM WhatsApp: mensajes
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL,
  is_ai BOOLEAN NOT NULL DEFAULT false,
  wa_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_contact ON public.whatsapp_messages (contact_id, created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_msg_owner_all"
ON public.whatsapp_messages FOR ALL
USING (
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.whatsapp_contacts c
    WHERE c.id = whatsapp_messages.contact_id AND c.owner_id = auth.uid()
  )
)
WITH CHECK (
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.whatsapp_contacts c
    WHERE c.id = whatsapp_messages.contact_id AND c.owner_id = auth.uid()
  )
);

-- 6. Función para marcar oferta como tomada (15 días en azul)
CREATE OR REPLACE FUNCTION public.set_offer_reserved(_offer_id UUID, _professional_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_offers
  SET status = 'filled',
      reserved_until = now() + interval '15 days'
  WHERE id = _offer_id
    AND (posted_by = auth.uid() OR public.is_staff(auth.uid()));

  UPDATE public.professional_profiles
  SET reserved_until = now() + interval '15 days',
      available = false
  WHERE user_id = _professional_id;
END;
$$;

-- 7. Función helper para liberar reservas vencidas (puede llamarse desde un cron)
CREATE OR REPLACE FUNCTION public.release_expired_reservations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_offers
  SET status = 'closed', reserved_until = NULL
  WHERE status = 'filled' AND reserved_until IS NOT NULL AND reserved_until < now();

  UPDATE public.professional_profiles
  SET reserved_until = NULL, available = true
  WHERE reserved_until IS NOT NULL AND reserved_until < now();
END;
$$;
