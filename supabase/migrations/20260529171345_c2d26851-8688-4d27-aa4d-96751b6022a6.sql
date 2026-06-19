
ALTER TABLE public.institution_profiles
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS visible_on_map boolean NOT NULL DEFAULT true;

ALTER TABLE public.family_profiles
  ADD COLUMN IF NOT EXISTS visible_on_map boolean NOT NULL DEFAULT true;

-- Allow authenticated users to read minimal location data for the live marketplace map.
-- Professional, family and institution coordinates are needed to render dots, like Uber.
DROP POLICY IF EXISTS prof_select_map_public ON public.professional_profiles;
CREATE POLICY prof_select_map_public ON public.professional_profiles
  FOR SELECT TO authenticated
  USING (available = true AND published = true AND blocked = false);

DROP POLICY IF EXISTS fam_select_map_public ON public.family_profiles;
CREATE POLICY fam_select_map_public ON public.family_profiles
  FOR SELECT TO authenticated
  USING (visible_on_map = true AND default_lat IS NOT NULL AND default_lng IS NOT NULL);

DROP POLICY IF EXISTS inst_select_map_public ON public.institution_profiles;
CREATE POLICY inst_select_map_public ON public.institution_profiles
  FOR SELECT TO authenticated
  USING (visible_on_map = true AND lat IS NOT NULL AND lng IS NOT NULL);
