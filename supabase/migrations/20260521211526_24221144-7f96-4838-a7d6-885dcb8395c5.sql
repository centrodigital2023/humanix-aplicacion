
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.testimonial_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.testimonial_role AS ENUM ('professional', 'family', 'institution');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.community_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role public.testimonial_role NOT NULL,
  author_city text,
  author_avatar_url text,
  content text NOT NULL CHECK (char_length(content) BETWEEN 20 AND 500),
  rating integer NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  trust_score_snapshot integer NOT NULL DEFAULT 0,
  plan_snapshot text,
  status public.testimonial_status NOT NULL DEFAULT 'pending',
  moderation_note text,
  moderated_by uuid,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ct_status_created ON public.community_testimonials (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_user ON public.community_testimonials (user_id);

ALTER TABLE public.community_testimonials ENABLE ROW LEVEL SECURITY;

-- Public read of published
DROP POLICY IF EXISTS ct_select_public ON public.community_testimonials;
CREATE POLICY ct_select_public ON public.community_testimonials
  FOR SELECT TO anon, authenticated
  USING (status = 'published' OR auth.uid() = user_id OR is_staff(auth.uid()));

-- Insert: only own row
DROP POLICY IF EXISTS ct_insert_self ON public.community_testimonials;
CREATE POLICY ct_insert_self ON public.community_testimonials
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Update: author can edit while pending, staff always
DROP POLICY IF EXISTS ct_update_owner_or_staff ON public.community_testimonials;
CREATE POLICY ct_update_owner_or_staff ON public.community_testimonials
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id AND status = 'pending') OR is_staff(auth.uid()))
  WITH CHECK ((auth.uid() = user_id AND status = 'pending') OR is_staff(auth.uid()));

-- Delete: author while pending, staff always
DROP POLICY IF EXISTS ct_delete_owner_or_staff ON public.community_testimonials;
CREATE POLICY ct_delete_owner_or_staff ON public.community_testimonials
  FOR DELETE TO authenticated
  USING ((auth.uid() = user_id AND status = 'pending') OR is_staff(auth.uid()));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_ct_updated_at ON public.community_testimonials;
CREATE TRIGGER trg_ct_updated_at
  BEFORE UPDATE ON public.community_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-publish if author has high trust score (>=70)
CREATE OR REPLACE FUNCTION public.community_testimonials_autopublish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND COALESCE(NEW.trust_score_snapshot, 0) >= 70 THEN
    NEW.status := 'published';
    NEW.moderated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ct_autopublish ON public.community_testimonials;
CREATE TRIGGER trg_ct_autopublish
  BEFORE INSERT ON public.community_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.community_testimonials_autopublish();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_testimonials;
