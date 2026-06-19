-- Fix overly-broad RLS on service_checkins: the original "checkins_patient_read"
-- policy granted ANY user with role = 'family' read access to ALL patients'
-- check-in records (location, evidence, signatures), not just their own family
-- member's. Scope family access to bookings where they are the client.

DROP POLICY IF EXISTS "checkins_patient_read" ON public.service_checkins;

CREATE POLICY "checkins_patient_read"
  ON public.service_checkins FOR SELECT
  USING (
    patient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.service_bookings sb
      WHERE sb.id::text = service_checkins.booking_id
        AND sb.client_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('superadmin', 'institution')
    )
  );
