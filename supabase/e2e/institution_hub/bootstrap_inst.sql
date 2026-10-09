-- Estado de producción de las tablas institucionales justo antes de 20261009100000.
\set ON_ERROR_STOP on

CREATE TYPE public.offer_modality AS ENUM ('hour', 'shift', 'month', 'package');
CREATE TYPE public.offer_status AS ENUM ('open', 'closed', 'filled');
CREATE TYPE public.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE public.poster_type AS ENUM ('family', 'institution');

ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rethus_number text,
  ADD COLUMN IF NOT EXISTS rethus_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_score numeric DEFAULT 0;

CREATE TABLE public.institution_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_name text NOT NULL, institution_type text, nit text, city text, address text, website text,
  verified boolean DEFAULT false,
  legal_representative_name text, legal_representative_email text, legal_representative_phone text,
  lat double precision, lng double precision, visible_on_map boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.institution_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY inst_select_owner_or_staff ON public.institution_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
GRANT SELECT ON public.institution_profiles TO authenticated;

CREATE TABLE public.job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  poster_type public.poster_type NOT NULL,
  title TEXT NOT NULL, description TEXT,
  modality public.offer_modality NOT NULL,
  amount INTEGER NOT NULL,
  city TEXT NOT NULL, address TEXT, specialty_required TEXT,
  requirements TEXT[] DEFAULT '{}',
  start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
  shifts_count INTEGER DEFAULT 1,
  status public.offer_status NOT NULL DEFAULT 'open',
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, reserved_until TIMESTAMPTZ,
  blocked boolean NOT NULL DEFAULT false, blocked_reason text, blocked_at timestamptz, blocked_by uuid
);
ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_job_offers_status_city ON public.job_offers(status, city);
CREATE POLICY "offers_select_open_authenticated_or_owner" ON public.job_offers FOR SELECT TO authenticated
  USING (status = 'open'::public.offer_status OR posted_by = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "offers_insert_owner" ON public.job_offers FOR INSERT WITH CHECK (auth.uid() = posted_by);
CREATE POLICY "offers_update_owner" ON public.job_offers FOR UPDATE USING (auth.uid() = posted_by OR public.is_staff(auth.uid()));
CREATE POLICY "offers_delete_owner" ON public.job_offers FOR DELETE USING (auth.uid() = posted_by OR public.is_staff(auth.uid()));
CREATE TRIGGER trg_job_offers_updated_at BEFORE UPDATE ON public.job_offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- 20260520134043: privilegios de lectura POR COLUMNA (contact_phone y motivos de bloqueo no se conceden).
REVOKE SELECT ON public.job_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, posted_by, poster_type, title, description, modality, amount, city, address,
  specialty_required, requirements, start_date, end_date, shifts_count, status,
  created_at, updated_at, lat, lng, reserved_until, blocked) ON public.job_offers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.job_offers TO authenticated;

CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_offer_id UUID NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT, proposed_amount INTEGER,
  status public.application_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_offer_id, professional_id)
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apps_select_involved" ON public.applications FOR SELECT
  USING (professional_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = job_offer_id AND o.posted_by = auth.uid())
    OR public.is_staff(auth.uid()));
CREATE POLICY "apps_insert_pro" ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = professional_id AND public.has_role(auth.uid(), 'professional'));
CREATE POLICY "apps_update_involved" ON public.applications FOR UPDATE
  USING (professional_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = job_offer_id AND o.posted_by = auth.uid())
    OR public.is_staff(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.applications TO authenticated;
CREATE TRIGGER trg_apps_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS application_id uuid;

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  poster_id UUID NOT NULL, professional_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_message_at TIMESTAMPTZ
);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_application_id_key UNIQUE (application_id);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.create_conversation_on_accept()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_poster UUID;
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    SELECT posted_by INTO v_poster FROM public.job_offers WHERE id = NEW.job_offer_id;
    IF v_poster IS NOT NULL THEN
      INSERT INTO public.conversations (application_id, poster_id, professional_id)
      VALUES (NEW.id, v_poster, NEW.professional_id)
      ON CONFLICT (application_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_apps_create_conv AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.create_conversation_on_accept();
CREATE TRIGGER trg_applications_create_conversation AFTER UPDATE ON public.applications
  FOR EACH ROW WHEN (NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.create_conversation_on_accept();

-- 20260422030000: contacto de reservas (sin control de plan: es lo que 20261009100000 corrige).
CREATE TABLE public.booking_contact_reveals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  revealer_id UUID NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_contact_reveals ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.get_booking_contact(_booking_id UUID)
RETURNS TABLE(peer_id UUID, full_name TEXT, phone TEXT, avatar_url TEXT, is_professional BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client_id UUID; v_pro_id UUID; v_status TEXT; v_peer_id UUID; v_is_pro BOOLEAN;
BEGIN
  SELECT client_id, professional_id, status INTO v_client_id, v_pro_id, v_status FROM public.service_bookings WHERE id = _booking_id;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF auth.uid() <> v_client_id AND auth.uid() <> v_pro_id AND NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_status NOT IN ('confirmed', 'in_route', 'in_progress', 'completed') THEN RAISE EXCEPTION 'booking_not_paid'; END IF;
  IF auth.uid() = v_client_id THEN v_peer_id := v_pro_id; v_is_pro := TRUE; ELSE v_peer_id := v_client_id; v_is_pro := FALSE; END IF;
  INSERT INTO public.booking_contact_reveals (booking_id, revealer_id, channel) VALUES (_booking_id, auth.uid(), 'contact_fetch');
  RETURN QUERY SELECT p.user_id, p.full_name, p.phone, p.avatar_url, v_is_pro FROM public.profiles p WHERE p.user_id = v_peer_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_booking_contact(UUID) TO authenticated;

-- Flujo de contratos anterior, tal cual está en el repositorio.
\i /home/user/humanix-aplicacion/supabase/migrations/20260606000002_service_contracts.sql

-- 20260418145902: las partes de una reserva pueden actualizarla (la máquina de estados la vigila guard_booking_integrity).
CREATE POLICY bookings_update_involved ON public.service_bookings FOR UPDATE TO authenticated
  USING (auth.uid() IN (client_id, professional_id) OR public.is_staff(auth.uid()));
GRANT UPDATE ON public.service_bookings TO authenticated;
GRANT INSERT ON public.service_rating_dimensions TO authenticated;

-- En producción las tablas heredan privilegios por defecto de Supabase; el arnés los concede a mano.
GRANT SELECT ON public.care_circle_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_contracts TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
