-- =========================================================================
-- RLS audit round 3 — cerrando residuales
--
-- Hallazgos:
--   1. `public.ratings` (tabla legacy del primer esquema) tenía política
--      `ratings_select_all USING (true)` sin scope de rol. Contiene
--      `comment` (texto libre del calificador) y liga `rater_user_id` +
--      `rated_user_id` con job_offer_id. Lo restringimos a participantes
--      y staff para no exponer comentarios y relaciones a anon.
--
--   2. `public.professional_profiles`: agregamos REVOKE por columna de
--      `email_contact`, `phone_contact`, `id_document` si existen (varios
--      esquemas legacy las nombran así). Silencioso si no existen.
--
--   3. `public.staff_invitations`: confirmamos que solo staff puede leer
--      (el token se redime vía función SECURITY DEFINER).
-- =========================================================================

-- 1. Ratings legacy: scope a participantes
DROP POLICY IF EXISTS "ratings_select_all" ON public.ratings;
CREATE POLICY "ratings_select_participants"
  ON public.ratings FOR SELECT
  TO authenticated
  USING (
    auth.uid() = rated_user_id
    OR auth.uid() = rater_user_id
    OR public.is_staff(auth.uid())
  );

-- 2. Refuerzos column-level en professional_profiles (idempotente).
DO $$
BEGIN
  EXECUTE 'REVOKE SELECT (whatsapp_number) ON public.professional_profiles FROM anon';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE SELECT (id_document) ON public.professional_profiles FROM anon';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- 3. Staff invitations: asegurar que SELECT solo es para staff. El token
--    se valida y consume vía redeem_staff_invitation() (SECURITY DEFINER).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='staff_invitations'
      AND policyname='invites_select_by_token'
  ) THEN
    EXECUTE 'DROP POLICY "invites_select_by_token" ON public.staff_invitations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='staff_invitations'
      AND policyname='invites_select_staff_only'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "invites_select_staff_only"
        ON public.staff_invitations FOR SELECT
        TO authenticated
        USING (public.is_staff(auth.uid()))
    $POL$;
  END IF;
END $$;

-- 4. Forzar RLS (FORCE) en tablas con datos sensibles. Protege contra
--    superusuarios que accidentalmente saltan RLS al correr funciones
--    `SECURITY DEFINER` que no son dueñas de las tablas.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'profiles','professional_profiles','family_documents',
      'professional_documents','mp_subscriptions','mp_payments',
      'service_bookings','service_ratings','slot_proposals',
      'family_needs','availability_slots','notifications',
      'audit_log','fraud_flags','profile_embeddings','offer_embeddings',
      'whatsapp_contacts','whatsapp_messages','staff_invitations',
      'booking_contact_reveals','user_consents','tracking_pings',
      'emergency_incidents','ratings'
    ]) AS tbl
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tbl);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $$;
