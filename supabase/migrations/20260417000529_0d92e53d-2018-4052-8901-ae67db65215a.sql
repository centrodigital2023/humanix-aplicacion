-- ============= ENUMS =============
CREATE TYPE public.app_role AS ENUM ('professional', 'family', 'institution', 'superadmin', 'hr_staff', 'evaluator');
CREATE TYPE public.offer_modality AS ENUM ('hour', 'shift', 'month', 'package');
CREATE TYPE public.offer_status AS ENUM ('open', 'closed', 'filled');
CREATE TYPE public.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE public.poster_type AS ENUM ('family', 'institution');

-- ============= PROFILES =============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  city TEXT,
  avatar_url TEXT,
  bio TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============= USER ROLES =============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============= has_role security definer =============
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('superadmin','hr_staff','evaluator')
  )
$$;

-- ============= PROFESSIONAL PROFILES =============
CREATE TABLE public.professional_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  specialty TEXT,
  sub_specialties TEXT[] DEFAULT '{}',
  years_experience INTEGER DEFAULT 0,
  rethus_number TEXT,
  rethus_verified BOOLEAN DEFAULT false,
  certifications JSONB DEFAULT '[]'::jsonb,
  hourly_rate INTEGER,
  shift_rate INTEGER,
  monthly_rate INTEGER,
  availability JSONB DEFAULT '{}'::jsonb,
  service_cities TEXT[] DEFAULT '{}',
  languages TEXT[] DEFAULT '{Español}',
  trust_score INTEGER DEFAULT 0,
  ai_summary TEXT,
  ai_strengths TEXT[],
  ai_suggestions TEXT[],
  verified BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  total_jobs INTEGER DEFAULT 0,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;

-- ============= INSTITUTION PROFILES =============
CREATE TABLE public.institution_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_name TEXT NOT NULL,
  nit TEXT,
  institution_type TEXT,
  city TEXT,
  address TEXT,
  website TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.institution_profiles ENABLE ROW LEVEL SECURITY;

-- ============= JOB OFFERS =============
CREATE TABLE public.job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  posted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  poster_type public.poster_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  modality public.offer_modality NOT NULL,
  amount INTEGER NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  specialty_required TEXT,
  requirements TEXT[] DEFAULT '{}',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  shifts_count INTEGER DEFAULT 1,
  status public.offer_status NOT NULL DEFAULT 'open',
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.job_offers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_job_offers_status_city ON public.job_offers(status, city);

-- ============= APPLICATIONS =============
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_offer_id UUID NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT,
  proposed_amount INTEGER,
  status public.application_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_offer_id, professional_id)
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- ============= RATINGS =============
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rated_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rater_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_offer_id UUID REFERENCES public.job_offers(id) ON DELETE SET NULL,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stars BETWEEN 1 AND 5),
  CHECK (rated_user_id <> rater_user_id)
);
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- ============= STAFF INVITATIONS =============
CREATE TABLE public.staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role public.app_role NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  CHECK (role IN ('superadmin','hr_staff','evaluator'))
);
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- ============= updated_at trigger =============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pro_profiles_updated_at BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_inst_profiles_updated_at BEFORE UPDATE ON public.institution_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_job_offers_updated_at BEFORE UPDATE ON public.job_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_apps_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= handle_new_user trigger =============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.app_role;
  v_meta_role TEXT;
BEGIN
  -- profile
  INSERT INTO public.profiles (user_id, full_name, email, phone, city)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'city'
  );

  -- super admin auto-assign
  IF lower(NEW.email) = 'josefabian1212@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'superadmin')
      ON CONFLICT DO NOTHING;
  END IF;

  -- role from metadata
  v_meta_role := NEW.raw_user_meta_data->>'role';
  IF v_meta_role IN ('professional','family','institution') THEN
    v_role := v_meta_role::public.app_role;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
      ON CONFLICT DO NOTHING;

    -- create dependent profile shells
    IF v_role = 'professional' THEN
      INSERT INTO public.professional_profiles (user_id) VALUES (NEW.id)
        ON CONFLICT DO NOTHING;
    ELSIF v_role = 'institution' THEN
      INSERT INTO public.institution_profiles (user_id, institution_name)
      VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'institution_name','Institución'))
        ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    -- default to family if no role
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'family')
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============= avg rating trigger =============
CREATE OR REPLACE FUNCTION public.refresh_pro_avg_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID;
BEGIN
  v_uid := COALESCE(NEW.rated_user_id, OLD.rated_user_id);
  UPDATE public.professional_profiles
  SET avg_rating = COALESCE((
      SELECT ROUND(AVG(stars)::numeric, 2) FROM public.ratings WHERE rated_user_id = v_uid
    ), 0)
  WHERE user_id = v_uid;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refresh_avg_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_pro_avg_rating();

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- profiles
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "profiles_staff_all" ON public.profiles FOR ALL USING (public.is_staff(auth.uid()));

-- user_roles
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "user_roles_superadmin_all" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'superadmin'));

-- professional_profiles (public catalog)
CREATE POLICY "pro_select_all" ON public.professional_profiles FOR SELECT USING (true);
CREATE POLICY "pro_insert_self" ON public.professional_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pro_update_self" ON public.professional_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pro_staff_all" ON public.professional_profiles FOR ALL USING (public.is_staff(auth.uid()));

-- institution_profiles
CREATE POLICY "inst_select_all" ON public.institution_profiles FOR SELECT USING (true);
CREATE POLICY "inst_insert_self" ON public.institution_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inst_update_self" ON public.institution_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "inst_staff_all" ON public.institution_profiles FOR ALL USING (public.is_staff(auth.uid()));

-- job_offers
CREATE POLICY "offers_select_open_or_owner" ON public.job_offers FOR SELECT
  USING (status = 'open' OR posted_by = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "offers_insert_owner" ON public.job_offers FOR INSERT WITH CHECK (auth.uid() = posted_by);
CREATE POLICY "offers_update_owner" ON public.job_offers FOR UPDATE USING (auth.uid() = posted_by OR public.is_staff(auth.uid()));
CREATE POLICY "offers_delete_owner" ON public.job_offers FOR DELETE USING (auth.uid() = posted_by OR public.is_staff(auth.uid()));

-- applications
CREATE POLICY "apps_select_involved" ON public.applications FOR SELECT
  USING (
    professional_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = job_offer_id AND o.posted_by = auth.uid())
    OR public.is_staff(auth.uid())
  );
CREATE POLICY "apps_insert_pro" ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = professional_id AND public.has_role(auth.uid(),'professional'));
CREATE POLICY "apps_update_involved" ON public.applications FOR UPDATE
  USING (
    professional_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = job_offer_id AND o.posted_by = auth.uid())
    OR public.is_staff(auth.uid())
  );

-- ratings
CREATE POLICY "ratings_select_all" ON public.ratings FOR SELECT USING (true);
CREATE POLICY "ratings_insert_self" ON public.ratings FOR INSERT WITH CHECK (auth.uid() = rater_user_id);
CREATE POLICY "ratings_update_self" ON public.ratings FOR UPDATE USING (auth.uid() = rater_user_id);
CREATE POLICY "ratings_delete_self" ON public.ratings FOR DELETE USING (auth.uid() = rater_user_id OR public.is_staff(auth.uid()));

-- staff_invitations
CREATE POLICY "invites_superadmin_all" ON public.staff_invitations FOR ALL
  USING (public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'superadmin'));