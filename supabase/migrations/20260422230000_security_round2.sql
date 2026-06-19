-- =========================================================================
-- Security hardening round 2
-- - service_ratings: antes SELECT público; ahora authenticated-only.
--   Motivo: el campo voice_url apunta a audio del usuario final y comment
--   puede incluir datos del paciente. Humanix puede seguir calculando
--   avg_rating vía la vista `professional_profiles.avg_rating` (ya público)
--   sin exponer las filas crudas al anon.
-- - pqrs_tickets: el INSERT queda abierto para anon (ok, es formulario
--   de contacto ciudadano), pero forzamos TO anon, authenticated para
--   que la política sea explícita.
-- - mp_payments: explicit TO authenticated.
-- =========================================================================

DROP POLICY IF EXISTS "service_ratings_select_all" ON public.service_ratings;
CREATE POLICY "service_ratings_select_authenticated"
  ON public.service_ratings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "pqrs_insert_anyone" ON public.pqrs_tickets;
CREATE POLICY "pqrs_insert_anyone" ON public.pqrs_tickets
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "mpp_select_self_or_staff" ON public.mp_payments;
CREATE POLICY "mpp_select_self_or_staff"
  ON public.mp_payments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
