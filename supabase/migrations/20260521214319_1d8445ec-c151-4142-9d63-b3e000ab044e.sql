-- ============================================================
-- 1. Auth: handle_new_user
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. updated_at on every table that has it
-- ============================================================
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'profiles','professional_profiles','family_profiles','institution_profiles',
    'professional_documents','family_documents','professional_references',
    'job_offers','applications','conversations',
    'availability_slots','family_needs','slot_proposals',
    'profile_embeddings','offer_embeddings',
    'ad_banners','mp_payments','mp_subscriptions',
    'crm_contacts','crm_campaigns','crm_tasks',
    'pqrs_tickets','community_testimonials','service_bookings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- 3. applications -> conversations
-- ============================================================
DROP TRIGGER IF EXISTS trg_applications_create_conversation ON public.applications;
CREATE TRIGGER trg_applications_create_conversation
AFTER UPDATE ON public.applications
FOR EACH ROW
WHEN (NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM NEW.status))
EXECUTE FUNCTION public.create_conversation_on_accept();

-- Make sure conversations.application_id is unique so ON CONFLICT works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='conversations_application_id_key'
  ) THEN
    BEGIN
      ALTER TABLE public.conversations
        ADD CONSTRAINT conversations_application_id_key UNIQUE (application_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- ============================================================
-- 4. messages -> bump conversation
-- ============================================================
DROP TRIGGER IF EXISTS trg_messages_bump_conversation ON public.messages;
CREATE TRIGGER trg_messages_bump_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_last_message();

-- ============================================================
-- 5. community_testimonials autopublish
-- ============================================================
DROP TRIGGER IF EXISTS trg_ct_autopublish ON public.community_testimonials;
CREATE TRIGGER trg_ct_autopublish
BEFORE INSERT ON public.community_testimonials
FOR EACH ROW EXECUTE FUNCTION public.community_testimonials_autopublish();

-- ============================================================
-- 6. professional_profiles guard publish
-- ============================================================
DROP TRIGGER IF EXISTS trg_pro_guard_publish ON public.professional_profiles;
CREATE TRIGGER trg_pro_guard_publish
BEFORE UPDATE ON public.professional_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_professional_publish();

-- ============================================================
-- 7. service_bookings compute fee
-- ============================================================
DROP TRIGGER IF EXISTS trg_sb_compute_fee ON public.service_bookings;
CREATE TRIGGER trg_sb_compute_fee
BEFORE INSERT OR UPDATE OF total_amount, platform_fee_pct ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.compute_platform_fee();

-- ============================================================
-- 8. ratings -> refresh avg
-- ============================================================
DROP TRIGGER IF EXISTS trg_ratings_refresh_avg ON public.ratings;
CREATE TRIGGER trg_ratings_refresh_avg
AFTER INSERT OR UPDATE OR DELETE ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.refresh_pro_avg_rating();

-- ============================================================
-- 9. Tighten family_needs UPDATE policy (was WITH CHECK true)
-- ============================================================
DROP POLICY IF EXISTS fn_update_matched_by_pro ON public.family_needs;
CREATE POLICY fn_update_matched_by_pro
ON public.family_needs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.slot_proposals sp
    WHERE sp.family_need_id = family_needs.id
      AND sp.professional_id = auth.uid()
      AND sp.status = 'accepted'
  )
)
WITH CHECK (
  status = 'matched'
  AND EXISTS (
    SELECT 1 FROM public.slot_proposals sp
    WHERE sp.family_need_id = family_needs.id
      AND sp.professional_id = auth.uid()
      AND sp.status = 'accepted'
  )
);
