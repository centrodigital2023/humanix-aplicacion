-- Tarea 1: Documento de experiencia laboral
ALTER TYPE public.doc_type ADD VALUE IF NOT EXISTS 'work_experience';

-- Tarea 3: Tablas faltantes para soportar todo el flujo

-- 3.1 Validación holística del perfil profesional (resultado de IA cruzando formulario + documentos + referencias)
CREATE TABLE IF NOT EXISTS public.profile_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_publishable boolean NOT NULL DEFAULT false,
  score numeric,
  critical_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_summary text,
  validated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_validations_user ON public.profile_validations(user_id, validated_at DESC);
ALTER TABLE public.profile_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pv_select_owner_or_staff" ON public.profile_validations FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "pv_insert_owner_or_staff" ON public.profile_validations FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "pv_staff_all" ON public.profile_validations FOR ALL USING (public.is_staff(auth.uid()));

-- 3.2 Estado de publicación del perfil profesional
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_validation_id uuid REFERENCES public.profile_validations(id) ON DELETE SET NULL;

-- 3.3 Pagos Mercado Pago (suscripción mensual del profesional a Humanix)
CREATE TYPE public.mp_payment_status AS ENUM ('pending','approved','rejected','cancelled','refunded','in_process');

CREATE TABLE IF NOT EXISTS public.mp_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'pro_monthly',
  amount integer NOT NULL DEFAULT 49900,
  currency text NOT NULL DEFAULT 'COP',
  mp_preapproval_id text,
  mp_payer_email text,
  status text NOT NULL DEFAULT 'pending',
  current_period_end timestamptz,
  next_payment_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mp_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mps_select_self_or_staff" ON public.mp_subscriptions FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "mps_staff_all" ON public.mp_subscriptions FOR ALL USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mp_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subscription_id uuid REFERENCES public.mp_subscriptions(id) ON DELETE SET NULL,
  mp_payment_id text UNIQUE,
  mp_preference_id text,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'COP',
  status public.mp_payment_status NOT NULL DEFAULT 'pending',
  description text,
  raw_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mp_payments_user ON public.mp_payments(user_id, created_at DESC);
ALTER TABLE public.mp_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mpp_select_self_or_staff" ON public.mp_payments FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "mpp_staff_all" ON public.mp_payments FOR ALL USING (public.is_staff(auth.uid()));

-- 3.4 Notificaciones (centro de notificaciones para familia/profesional + WhatsApp)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  meta jsonb,
  channel text NOT NULL DEFAULT 'in_app',
  read_at timestamptz,
  sent_via_wa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_select_self_or_staff" ON public.notifications FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "notif_update_self" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notif_staff_all" ON public.notifications FOR ALL USING (public.is_staff(auth.uid()));

-- 3.5 Vincular contactos de WhatsApp con usuarios registrados (para el bot tiempo real)
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS linked_user_id uuid,
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

-- 3.6 Updated_at triggers
CREATE TRIGGER trg_mp_subs_updated BEFORE UPDATE ON public.mp_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mp_payments_updated BEFORE UPDATE ON public.mp_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3.7 Realtime para notificaciones, mensajes WA y validaciones
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profile_validations;