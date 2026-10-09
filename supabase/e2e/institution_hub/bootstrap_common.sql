-- Esquema mínimo tipo Supabase/Lovable para probar migraciones de verdad (solo pruebas locales).
-- Sin ALTER DEFAULT PRIVILEGES a propósito: los proyectos nuevos exigen GRANT explícito en cada tabla.
\set ON_ERROR_STOP on

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS realtime;
GRANT USAGE ON SCHEMA public, auth, realtime, extensions TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE TABLE public._realtime_log (id bigserial PRIMARY KEY, payload jsonb, event text, topic text, private boolean);
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._realtime_log(payload, event, topic, private) VALUES ($1, $2, $3, $4) $$;

CREATE TABLE realtime.messages (id bigserial PRIMARY KEY, topic text, extension text, payload jsonb, private boolean);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic', true), '') $$;

CREATE TYPE public.app_role AS ENUM ('superadmin','hr_staff','evaluator','professional','family','institution');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('superadmin','hr_staff','evaluator')) $$;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, phone text, city text, avatar_url text, bio text, email text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_self ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
GRANT SELECT ON public.profiles TO authenticated;

CREATE TABLE public.professional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  specialty text, sub_specialties text[] DEFAULT '{}', years_experience integer DEFAULT 0,
  rethus_verified boolean DEFAULT false, hourly_rate integer, service_cities text[] DEFAULT '{}',
  home_city text, available boolean NOT NULL DEFAULT true, active boolean DEFAULT true,
  published boolean NOT NULL DEFAULT false, blocked boolean NOT NULL DEFAULT false,
  avg_rating numeric(3,2) DEFAULT 0, total_jobs integer DEFAULT 0, avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_self ON public.professional_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.professional_profiles TO authenticated;

CREATE TABLE public.family_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  id_number text, whatsapp text, default_address text, default_lat double precision, default_lng double precision,
  visible_on_map boolean NOT NULL DEFAULT true, trust_score numeric DEFAULT 0, total_hires integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.family_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY fp_self ON public.family_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.family_profiles TO authenticated;

CREATE TABLE public.mp_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'pro_monthly', amount integer NOT NULL DEFAULT 49900, currency text NOT NULL DEFAULT 'COP',
  status text NOT NULL DEFAULT 'pending', current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mp_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY mps_select_self_or_staff ON public.mp_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
GRANT SELECT ON public.mp_subscriptions TO authenticated;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, title text NOT NULL,
  body text, link text, meta jsonb, channel text NOT NULL DEFAULT 'in_app', read_at timestamptz,
  sent_via_wa boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_own ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.notifications TO authenticated;

CREATE TABLE public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'free'
);
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY slots_own ON public.availability_slots FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.availability_slots TO authenticated;

CREATE TABLE public.service_bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL, professional_id uuid NOT NULL, job_offer_id uuid,
  status text NOT NULL DEFAULT 'pending', scheduled_at timestamptz NOT NULL,
  duration_hours numeric(5,2) NOT NULL DEFAULT 1, hourly_rate integer NOT NULL, total_amount integer NOT NULL,
  service_address text, service_lat double precision, service_lng double precision, notes text, emergency_phone text,
  started_at timestamptz, arrived_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  payment_mode text NOT NULL DEFAULT 'direct_to_professional',
  platform_fee_pct numeric, platform_fee_amount integer, professional_payout integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sb_involved ON public.service_bookings FOR SELECT TO authenticated
  USING (auth.uid() IN (client_id, professional_id) OR public.is_staff(auth.uid()));
GRANT SELECT ON public.service_bookings TO authenticated;

CREATE TABLE public.service_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL, rated_id uuid NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5), comment text, voice_url text, voice_transcript text,
  ai_sentiment text, ai_sentiment_score numeric(3,2), ai_alert boolean NOT NULL DEFAULT false, ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_ratings_insert_rater ON public.service_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = rater_id);
CREATE POLICY service_ratings_select_participants ON public.service_ratings FOR SELECT TO authenticated
  USING (auth.uid() = rater_id OR auth.uid() = rated_id OR public.is_staff(auth.uid()));
GRANT SELECT, INSERT ON public.service_ratings TO authenticated;

\i real_functions.sql
