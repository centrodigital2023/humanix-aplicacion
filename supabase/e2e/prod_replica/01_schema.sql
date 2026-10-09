-- 01: tipos, tablas, restricciones, índices únicos y RLS (estructura real de producción, 2026-10-09).
\set ON_ERROR_STOP on

CREATE TYPE public.app_role AS ENUM ('professional','family','institution','superadmin','hr_staff','evaluator');
CREATE TYPE public.application_status AS ENUM ('pending','accepted','rejected','withdrawn');
CREATE TYPE public.family_need_status AS ENUM ('open','matched','cancelled','expired');
CREATE TYPE public.offer_modality AS ENUM ('hour','shift','month','package');
CREATE TYPE public.offer_status AS ENUM ('open','closed','filled');
CREATE TYPE public.poster_type AS ENUM ('family','institution');
CREATE TYPE public.slot_proposal_proposed_by AS ENUM ('family','professional');
CREATE TYPE public.slot_proposal_status AS ENUM ('pending','accepted','rejected','cancelled','expired');
CREATE TYPE public.subscription_plan AS ENUM ('free','pro','family','institution');
CREATE TYPE public.subscription_status AS ENUM ('active','cancelled','past_due','trialing');

CREATE TABLE public.applications (id uuid NOT NULL DEFAULT gen_random_uuid(), job_offer_id uuid NOT NULL, professional_id uuid NOT NULL, message text, proposed_amount integer, status application_status NOT NULL DEFAULT 'pending'::application_status, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.audit_log (id uuid NOT NULL DEFAULT gen_random_uuid(), actor_id uuid, actor_email text, action text NOT NULL, resource_type text, resource_id text, severity text NOT NULL DEFAULT 'info'::text, meta jsonb, ip_address text, user_agent text, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.availability_slots (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, starts_at timestamp with time zone NOT NULL, ends_at timestamp with time zone NOT NULL, status text NOT NULL DEFAULT 'free'::text, job_offer_id uuid, note text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.care_circle_members (id uuid NOT NULL DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, invited_email text NOT NULL, member_id uuid, relation text, can_view_services boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'invited'::text, created_at timestamp with time zone NOT NULL DEFAULT now(), accepted_at timestamp with time zone);
CREATE TABLE public.care_favorites (client_id uuid NOT NULL, professional_id uuid NOT NULL, note text, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.care_logs (id uuid NOT NULL DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, professional_id uuid NOT NULL, patient_name text, event_type text NOT NULL, description text NOT NULL, vital_systolic integer, vital_diastolic integer, vital_heart_rate integer, vital_temperature numeric(4,1), vital_oxygen integer, photo_url text, is_alert boolean NOT NULL DEFAULT false, alert_reason text, notified_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.conversations (id uuid NOT NULL DEFAULT gen_random_uuid(), application_id uuid NOT NULL, poster_id uuid NOT NULL, professional_id uuid NOT NULL, last_message_at timestamp with time zone NOT NULL DEFAULT now(), created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.emergency_incidents (id uuid NOT NULL DEFAULT gen_random_uuid(), booking_id uuid, triggered_by uuid NOT NULL, incident_type text NOT NULL DEFAULT 'panic'::text, lat double precision, lng double precision, notes text, resolved boolean NOT NULL DEFAULT false, resolved_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.family_needs (id uuid NOT NULL DEFAULT gen_random_uuid(), family_user_id uuid NOT NULL, starts_at timestamp with time zone NOT NULL, ends_at timestamp with time zone NOT NULL, hourly_rate integer NOT NULL DEFAULT 20000, status family_need_status NOT NULL DEFAULT 'open'::family_need_status, service_address text, notes text, care_type text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.family_profiles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, id_number text, id_doc_url text, patient_relation text, patient_name text, patient_age integer, default_address text, default_lat double precision, default_lng double precision, emergency_contact_name text, emergency_contact_phone text, habeas_data_accepted boolean NOT NULL DEFAULT false, habeas_data_accepted_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), patient_summary text, visible_on_map boolean NOT NULL DEFAULT true, whatsapp text);
CREATE TABLE public.institution_profiles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, institution_name text NOT NULL, nit text, institution_type text, city text, address text, website text, verified boolean DEFAULT false, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), chamber_of_commerce_number text, chamber_of_commerce_date date, legal_representative_name text, legal_representative_email text, legal_representative_phone text, compliance_notes text, compliance_fuid boolean NOT NULL DEFAULT false, lat double precision, lng double precision, visible_on_map boolean NOT NULL DEFAULT true);
CREATE TABLE public.job_offers (id uuid NOT NULL DEFAULT gen_random_uuid(), posted_by uuid NOT NULL, poster_type poster_type NOT NULL, title text NOT NULL, description text, modality offer_modality NOT NULL, amount integer NOT NULL, city text NOT NULL, address text, specialty_required text, requirements text[] DEFAULT '{}'::text[], start_date timestamp with time zone, end_date timestamp with time zone, shifts_count integer DEFAULT 1, status offer_status NOT NULL DEFAULT 'open'::offer_status, contact_phone text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), lat double precision, lng double precision, reserved_until timestamp with time zone, blocked boolean NOT NULL DEFAULT false, blocked_reason text, blocked_at timestamp with time zone, blocked_by uuid);
CREATE TABLE public.messages (id uuid NOT NULL DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL, sender_id uuid NOT NULL, content text NOT NULL, is_ai_suggestion boolean NOT NULL DEFAULT false, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.mp_subscriptions (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, plan text NOT NULL DEFAULT 'pro_monthly'::text, amount integer NOT NULL DEFAULT 49900, currency text NOT NULL DEFAULT 'COP'::text, mp_preapproval_id text, mp_payer_email text, status text NOT NULL DEFAULT 'pending'::text, current_period_end timestamp with time zone, next_payment_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL, title text NOT NULL, body text, link text, meta jsonb, channel text NOT NULL DEFAULT 'in_app'::text, read_at timestamp with time zone, sent_via_wa boolean NOT NULL DEFAULT false, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.pqrs_tickets (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, contact_email text, contact_phone text, contact_name text, type text NOT NULL DEFAULT 'peticion'::text, subject text NOT NULL, description text NOT NULL, ai_category text, ai_priority text, ai_sentiment text, ai_summary text, status text NOT NULL DEFAULT 'open'::text, assigned_to uuid, resolution text, resolved_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.professional_profiles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, specialty text, sub_specialties text[] DEFAULT '{}'::text[], years_experience integer DEFAULT 0, rethus_number text, rethus_verified boolean DEFAULT false, certifications jsonb DEFAULT '[]'::jsonb, hourly_rate integer, shift_rate integer, monthly_rate integer, availability jsonb DEFAULT '{}'::jsonb, service_cities text[] DEFAULT '{}'::text[], languages text[] DEFAULT '{Español}'::text[], trust_score integer DEFAULT 0, ai_summary text, ai_strengths text[], ai_suggestions text[], verified boolean DEFAULT false, active boolean DEFAULT true, total_jobs integer DEFAULT 0, avg_rating numeric(3,2) DEFAULT 0, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), avatar_url text, bio text, work_experience jsonb DEFAULT '[]'::jsonb, ai_preapproved boolean DEFAULT false, lat double precision, lng double precision, home_city text, available boolean NOT NULL DEFAULT true, reserved_until timestamp with time zone, published boolean NOT NULL DEFAULT false, published_at timestamp with time zone, last_validation_id uuid, social_trust_score integer DEFAULT 0, social_trust_breakdown jsonb, social_trust_updated_at timestamp with time zone, blocked boolean NOT NULL DEFAULT false, blocked_reason text, blocked_at timestamp with time zone, blocked_by uuid, gender text, data_consent_at timestamp with time zone, verification_status text NOT NULL DEFAULT 'unverified'::text, rethus_checked_at timestamp with time zone);
CREATE TABLE public.profiles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, full_name text, phone text, city text, avatar_url text, bio text, email text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.ratings (id uuid NOT NULL DEFAULT gen_random_uuid(), rated_user_id uuid NOT NULL, rater_user_id uuid NOT NULL, job_offer_id uuid, stars integer NOT NULL, comment text, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.service_bookings (id uuid NOT NULL DEFAULT gen_random_uuid(), client_id uuid NOT NULL, professional_id uuid NOT NULL, job_offer_id uuid, status text NOT NULL DEFAULT 'pending'::text, scheduled_at timestamp with time zone NOT NULL, duration_hours numeric(5,2) NOT NULL DEFAULT 1, hourly_rate integer NOT NULL, total_amount integer NOT NULL, service_address text, service_lat double precision, service_lng double precision, notes text, emergency_phone text, started_at timestamp with time zone, arrived_at timestamp with time zone, completed_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), platform_fee_pct numeric(5,2) NOT NULL DEFAULT 0, platform_fee_amount integer NOT NULL DEFAULT 0, professional_payout integer NOT NULL DEFAULT 0, payment_mode text NOT NULL DEFAULT 'direct_to_professional'::text, application_id uuid);
CREATE TABLE public.service_rating_dimensions (id uuid NOT NULL DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, rater_id uuid NOT NULL, rated_id uuid NOT NULL, rater_role text NOT NULL, scores jsonb NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.service_ratings (id uuid NOT NULL DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, rater_id uuid NOT NULL, rated_id uuid NOT NULL, stars integer NOT NULL, comment text, voice_url text, voice_transcript text, ai_sentiment text, ai_sentiment_score numeric(3,2), ai_alert boolean NOT NULL DEFAULT false, ai_summary text, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.slot_proposals (id uuid NOT NULL DEFAULT gen_random_uuid(), family_user_id uuid NOT NULL, professional_id uuid NOT NULL, family_need_id uuid, availability_slot_id uuid, starts_at timestamp with time zone NOT NULL, ends_at timestamp with time zone NOT NULL, hourly_rate integer NOT NULL DEFAULT 20000, proposed_by slot_proposal_proposed_by NOT NULL, status slot_proposal_status NOT NULL DEFAULT 'pending'::slot_proposal_status, message text, decision_note text, booking_id uuid, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.subscriptions (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, plan subscription_plan NOT NULL DEFAULT 'free'::subscription_plan, status subscription_status NOT NULL DEFAULT 'active'::subscription_status, stripe_customer_id text, stripe_subscription_id text, current_period_end timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.tracking_pings (id uuid NOT NULL DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, professional_id uuid NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, accuracy_m double precision, speed_mps double precision, heading double precision, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.user_roles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role app_role NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now());

-- Claves primarias
ALTER TABLE applications ADD CONSTRAINT applications_pkey PRIMARY KEY (id);
ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE availability_slots ADD CONSTRAINT availability_slots_pkey PRIMARY KEY (id);
ALTER TABLE care_circle_members ADD CONSTRAINT care_circle_members_pkey PRIMARY KEY (id);
ALTER TABLE care_favorites ADD CONSTRAINT care_favorites_pkey PRIMARY KEY (client_id, professional_id);
ALTER TABLE care_logs ADD CONSTRAINT care_logs_pkey PRIMARY KEY (id);
ALTER TABLE conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE emergency_incidents ADD CONSTRAINT emergency_incidents_pkey PRIMARY KEY (id);
ALTER TABLE family_needs ADD CONSTRAINT family_needs_pkey PRIMARY KEY (id);
ALTER TABLE family_profiles ADD CONSTRAINT family_profiles_pkey PRIMARY KEY (id);
ALTER TABLE institution_profiles ADD CONSTRAINT institution_profiles_pkey PRIMARY KEY (id);
ALTER TABLE job_offers ADD CONSTRAINT job_offers_pkey PRIMARY KEY (id);
ALTER TABLE messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE mp_subscriptions ADD CONSTRAINT mp_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE pqrs_tickets ADD CONSTRAINT pqrs_tickets_pkey PRIMARY KEY (id);
ALTER TABLE professional_profiles ADD CONSTRAINT professional_profiles_pkey PRIMARY KEY (id);
ALTER TABLE profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ratings ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);
ALTER TABLE service_bookings ADD CONSTRAINT service_bookings_pkey PRIMARY KEY (id);
ALTER TABLE service_rating_dimensions ADD CONSTRAINT service_rating_dimensions_pkey PRIMARY KEY (id);
ALTER TABLE service_ratings ADD CONSTRAINT service_ratings_pkey PRIMARY KEY (id);
ALTER TABLE slot_proposals ADD CONSTRAINT slot_proposals_pkey PRIMARY KEY (id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE tracking_pings ADD CONSTRAINT tracking_pings_pkey PRIMARY KEY (id);
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

-- Únicas
ALTER TABLE applications ADD CONSTRAINT applications_job_offer_id_professional_id_key UNIQUE (job_offer_id, professional_id);
ALTER TABLE conversations ADD CONSTRAINT conversations_application_id_key UNIQUE (application_id);
ALTER TABLE family_profiles ADD CONSTRAINT family_profiles_user_id_key UNIQUE (user_id);
ALTER TABLE institution_profiles ADD CONSTRAINT institution_profiles_user_id_key UNIQUE (user_id);
ALTER TABLE mp_subscriptions ADD CONSTRAINT mp_subscriptions_user_id_key UNIQUE (user_id);
ALTER TABLE professional_profiles ADD CONSTRAINT professional_profiles_user_id_key UNIQUE (user_id);
ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
ALTER TABLE service_rating_dimensions ADD CONSTRAINT service_rating_dimensions_booking_id_rater_id_key UNIQUE (booking_id, rater_id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);
ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

-- Comprobaciones
ALTER TABLE availability_slots ADD CONSTRAINT availability_slots_status_check CHECK ((status = ANY (ARRAY['free'::text, 'reserved'::text, 'busy'::text])));
ALTER TABLE care_circle_members ADD CONSTRAINT care_circle_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'accepted'::text, 'declined'::text])));
ALTER TABLE care_favorites ADD CONSTRAINT care_favorites_check CHECK ((client_id <> professional_id));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 800)));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_event_type_check CHECK ((event_type = ANY (ARRAY['arrival'::text, 'medication'::text, 'vital_signs'::text, 'meal'::text, 'activity'::text, 'note'::text, 'incident'::text, 'departure'::text])));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_vital_diastolic_check CHECK (((vital_diastolic >= 30) AND (vital_diastolic <= 150)));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_vital_heart_rate_check CHECK (((vital_heart_rate >= 20) AND (vital_heart_rate <= 300)));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_vital_oxygen_check CHECK (((vital_oxygen >= 50) AND (vital_oxygen <= 100)));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_vital_systolic_check CHECK (((vital_systolic >= 50) AND (vital_systolic <= 250)));
ALTER TABLE care_logs ADD CONSTRAINT care_logs_vital_temperature_check CHECK (((vital_temperature >= (30)::numeric) AND (vital_temperature <= (45)::numeric)));
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (((length(content) >= 1) AND (length(content) <= 4000)));
ALTER TABLE ratings ADD CONSTRAINT ratings_check CHECK ((rated_user_id <> rater_user_id));
ALTER TABLE ratings ADD CONSTRAINT ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)));
ALTER TABLE service_rating_dimensions ADD CONSTRAINT service_rating_dimensions_rater_role_check CHECK ((rater_role = ANY (ARRAY['family'::text, 'professional'::text])));
ALTER TABLE service_ratings ADD CONSTRAINT service_ratings_ai_sentiment_check CHECK ((ai_sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])));
ALTER TABLE service_ratings ADD CONSTRAINT service_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)));

-- Claves foráneas (en producción solo existen estas; service_bookings, care_logs y otras NO tienen FK)
ALTER TABLE applications ADD CONSTRAINT applications_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE institution_profiles ADD CONSTRAINT institution_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE job_offers ADD CONSTRAINT job_offers_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE professional_profiles ADD CONSTRAINT professional_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ratings ADD CONSTRAINT ratings_rated_user_id_fkey FOREIGN KEY (rated_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ratings ADD CONSTRAINT ratings_rater_user_id_fkey FOREIGN KEY (rater_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Índices únicos fuera de restricciones
CREATE UNIQUE INDEX uq_care_circle_owner_email ON public.care_circle_members USING btree (owner_id, lower(invited_email));
CREATE UNIQUE INDEX idx_service_ratings_unique ON public.service_ratings USING btree (booking_id, rater_id);
CREATE INDEX idx_service_bookings_application_id ON public.service_bookings USING btree (application_id);
CREATE INDEX idx_bookings_pro ON public.service_bookings USING btree (professional_id, status);
CREATE INDEX idx_bookings_client ON public.service_bookings USING btree (client_id, status);
CREATE INDEX idx_care_logs_booking ON public.care_logs USING btree (booking_id, created_at DESC);

-- RLS activada en todas
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['applications','audit_log','availability_slots','care_circle_members','care_favorites','care_logs','conversations','emergency_incidents','family_needs','family_profiles','institution_profiles','job_offers','messages','mp_subscriptions','notifications','pqrs_tickets','professional_profiles','profiles','ratings','service_bookings','service_rating_dimensions','service_ratings','slot_proposals','subscriptions','tracking_pings','user_roles'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
