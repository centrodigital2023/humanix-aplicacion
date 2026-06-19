
-- 1. Remove anon access to profiles via published professionals
DROP POLICY IF EXISTS public_read_published_pros ON public.profiles;

-- 2. mp_payments: explicit INSERT policy scoped to self
DROP POLICY IF EXISTS mpp_insert_self ON public.mp_payments;
CREATE POLICY mpp_insert_self ON public.mp_payments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 3. ratings: restrict SELECT to involved parties or staff
DROP POLICY IF EXISTS ratings_select_authenticated ON public.ratings;
CREATE POLICY ratings_select_involved ON public.ratings
  FOR SELECT TO authenticated
  USING (
    auth.uid() = rater_user_id
    OR auth.uid() = rated_user_id
    OR public.is_staff(auth.uid())
  );
