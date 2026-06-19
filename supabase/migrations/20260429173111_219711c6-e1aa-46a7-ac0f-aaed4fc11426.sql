-- 1. Remove staff-only tables from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_contacts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_campaigns;
ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_tasks;
ALTER PUBLICATION supabase_realtime DROP TABLE public.pqrs_tickets;

-- 2. Tighten availability_slots: require authentication for non-busy visibility
DROP POLICY IF EXISTS slots_select_owner_or_staff ON public.availability_slots;

CREATE POLICY slots_select_owner_or_staff
ON public.availability_slots
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_staff(auth.uid())
  OR status <> 'busy'
);