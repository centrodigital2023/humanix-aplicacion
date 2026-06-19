
-- service_ratings: restrict SELECT to participants + staff
DROP POLICY IF EXISTS service_ratings_select_all ON public.service_ratings;
CREATE POLICY service_ratings_select_participants
ON public.service_ratings
FOR SELECT
USING (
  auth.uid() = rater_id
  OR auth.uid() = rated_id
  OR public.is_staff(auth.uid())
);

-- institution_profiles: restrict SELECT to owner + staff
DROP POLICY IF EXISTS inst_select_authenticated ON public.institution_profiles;
CREATE POLICY inst_select_owner_or_staff
ON public.institution_profiles
FOR SELECT
USING (
  auth.uid() = user_id
  OR public.is_staff(auth.uid())
);

-- availability_slots: restrict SELECT to owner + staff
DROP POLICY IF EXISTS slots_select_owner_or_staff ON public.availability_slots;
CREATE POLICY slots_select_owner_or_staff
ON public.availability_slots
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_staff(auth.uid())
);
