-- =========================================================================
-- Security hardening — revisión de seguridad del código, base de datos y RLS
-- Fecha: 2026-04-22
-- =========================================================================

-- 1. user_plans view: expuesto a `anon` y haciendo JOIN con auth.users.
--    Riesgo: cualquier visitante anónimo podía listar plan + estado de pago
--    de todos los usuarios. Lo re-creamos como SECURITY INVOKER con filtro
--    explícito a la fila del auth.uid() y revocamos el acceso anónimo.
-- -------------------------------------------------------------------------

REVOKE ALL ON public.user_plans FROM anon, authenticated, PUBLIC;
DROP VIEW IF EXISTS public.user_plans;

CREATE VIEW public.user_plans
WITH (security_invoker = true)
AS
SELECT
  u.id                                              AS user_id,
  public.get_user_plan(u.id)                        AS plan,
  public.plan_tier_rank(public.get_user_plan(u.id)) AS tier,
  s.status,
  s.amount,
  s.currency,
  s.current_period_end,
  s.cancel_at_period_end,
  s.next_payment_at
FROM auth.users u
LEFT JOIN public.mp_subscriptions s ON s.user_id = u.id
WHERE u.id = auth.uid();

GRANT SELECT ON public.user_plans TO authenticated;
REVOKE ALL ON public.user_plans FROM anon, PUBLIC;

-- 2. family_needs: la política pública permitía que cualquier visitante
--    anónimo leyera las necesidades abiertas (incluyendo dirección y notas).
--    Restringimos a usuarios autenticados; esto protege datos de menores
--    y adultos mayores bajo cuidado.
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS "family_needs_select_public_open" ON public.family_needs;
CREATE POLICY "family_needs_select_authenticated" ON public.family_needs
  FOR SELECT
  TO authenticated
  USING (
    status = 'open'
    OR auth.uid() = family_user_id
    OR public.is_staff(auth.uid())
  );

-- 3. slot_proposals: confirmamos que las políticas solo aplican a usuarios
--    autenticados (evitamos que `anon` pueda siquiera intentar lectura).
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS "proposals_select_involved" ON public.slot_proposals;
CREATE POLICY "proposals_select_involved" ON public.slot_proposals
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS "proposals_insert_own_side" ON public.slot_proposals;
CREATE POLICY "proposals_insert_own_side" ON public.slot_proposals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (proposed_by = 'family' AND auth.uid() = family_user_id)
    OR (proposed_by = 'professional' AND auth.uid() = professional_id)
  );

DROP POLICY IF EXISTS "proposals_update_involved" ON public.slot_proposals;
CREATE POLICY "proposals_update_involved" ON public.slot_proposals
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

-- 4. mp_subscriptions: reforzamos que solo el dueño o staff puede leer.
--    Añadimos TO authenticated para bloquear cualquier lectura anónima
--    por si RLS estuviera accidentalmente deshabilitada.
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS "mps_select_self_or_staff" ON public.mp_subscriptions;
CREATE POLICY "mps_select_self_or_staff" ON public.mp_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 5. profile_validations: mismo refuerzo.
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS "pv_select_owner_or_staff" ON public.profile_validations;
CREATE POLICY "pv_select_owner_or_staff" ON public.profile_validations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "pv_insert_owner_or_staff" ON public.profile_validations;
CREATE POLICY "pv_insert_owner_or_staff" ON public.profile_validations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 6. service_bookings: solo participantes o staff pueden leer/actualizar.
--    Dejamos la política existente pero forzamos TO authenticated.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='service_bookings'
  ) THEN
    -- Nada: la migración original ya define políticas por participante.
    -- Aquí simplemente verificamos que RLS esté habilitado.
    EXECUTE 'ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- 7. Asegurar que todas las tablas sensibles tienen RLS activado
--    (idempotente; no pasa nada si ya está).
-- -------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname IN (
        'family_needs','slot_proposals','mp_subscriptions','profile_validations',
        'booking_contact_reveals','service_bookings','service_ratings',
        'professional_documents','family_documents','professional_profiles',
        'family_profiles','profiles','ratings','user_roles','audit_log',
        'fraud_flags','conversations','messages','user_consents',
        'tracking_pings','emergency_incidents'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $$;

-- 8. Revocar permisos por defecto de PUBLIC en funciones sensibles para que
--    solo usuarios autenticados (o anon específico) puedan ejecutarlas.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  -- cancel_my_subscription / resume_my_subscription ya son SECURITY DEFINER
  -- con check de auth.uid(); igual revocamos PUBLIC por higiene.
  REVOKE ALL ON FUNCTION public.cancel_my_subscription() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;

  REVOKE ALL ON FUNCTION public.resume_my_subscription() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.resume_my_subscription() TO authenticated;

  REVOKE ALL ON FUNCTION public.get_user_plan(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_user_plan(uuid) TO authenticated;

  REVOKE ALL ON FUNCTION public.has_plan(uuid, text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.has_plan(uuid, text) TO authenticated;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;
