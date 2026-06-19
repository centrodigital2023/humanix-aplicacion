
DO $$ BEGIN
  CREATE TYPE public.family_need_status AS ENUM ('open','matched','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.slot_proposal_status AS ENUM ('pending','accepted','rejected','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.slot_proposal_proposed_by AS ENUM ('family','professional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- family_needs
CREATE TABLE IF NOT EXISTS public.family_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 20000,
  status public.family_need_status NOT NULL DEFAULT 'open',
  service_address TEXT,
  notes TEXT,
  care_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_needs_family_user_idx ON public.family_needs(family_user_id, starts_at);
CREATE INDEX IF NOT EXISTS family_needs_open_idx ON public.family_needs(status, starts_at) WHERE status = 'open';

ALTER TABLE public.family_needs ENABLE ROW LEVEL SECURITY;

-- slot_proposals
CREATE TABLE IF NOT EXISTS public.slot_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_user_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  family_need_id UUID REFERENCES public.family_needs(id) ON DELETE SET NULL,
  availability_slot_id UUID REFERENCES public.availability_slots(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 20000,
  proposed_by public.slot_proposal_proposed_by NOT NULL,
  status public.slot_proposal_status NOT NULL DEFAULT 'pending',
  message TEXT,
  decision_note TEXT,
  booking_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sp_family_idx ON public.slot_proposals(family_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sp_pro_idx ON public.slot_proposals(professional_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sp_need_idx ON public.slot_proposals(family_need_id);
CREATE INDEX IF NOT EXISTS sp_slot_idx ON public.slot_proposals(availability_slot_id);

ALTER TABLE public.slot_proposals ENABLE ROW LEVEL SECURITY;

-- family_needs policies
DROP POLICY IF EXISTS fn_select_owner_or_staff ON public.family_needs;
CREATE POLICY fn_select_owner_or_staff ON public.family_needs
  FOR SELECT TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS fn_select_open_for_pros ON public.family_needs;
CREATE POLICY fn_select_open_for_pros ON public.family_needs
  FOR SELECT TO authenticated
  USING (status = 'open' AND public.has_role(auth.uid(), 'professional'::public.app_role));

DROP POLICY IF EXISTS fn_insert_owner ON public.family_needs;
CREATE POLICY fn_insert_owner ON public.family_needs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = family_user_id);

DROP POLICY IF EXISTS fn_update_owner_or_staff ON public.family_needs;
CREATE POLICY fn_update_owner_or_staff ON public.family_needs
  FOR UPDATE TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()))
  WITH CHECK (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS fn_update_matched_by_pro ON public.family_needs;
CREATE POLICY fn_update_matched_by_pro ON public.family_needs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.slot_proposals sp
      WHERE sp.family_need_id = family_needs.id
        AND sp.professional_id = auth.uid()
        AND sp.status = 'accepted'
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS fn_delete_owner_or_staff ON public.family_needs;
CREATE POLICY fn_delete_owner_or_staff ON public.family_needs
  FOR DELETE TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS family_needs_updated_at ON public.family_needs;
CREATE TRIGGER family_needs_updated_at
  BEFORE UPDATE ON public.family_needs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- slot_proposals policies
DROP POLICY IF EXISTS sp_select_involved ON public.slot_proposals;
CREATE POLICY sp_select_involved ON public.slot_proposals
  FOR SELECT TO authenticated
  USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS sp_insert_self ON public.slot_proposals;
CREATE POLICY sp_insert_self ON public.slot_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    (proposed_by = 'family' AND auth.uid() = family_user_id)
    OR (proposed_by = 'professional' AND auth.uid() = professional_id)
  );

DROP POLICY IF EXISTS sp_update_involved ON public.slot_proposals;
CREATE POLICY sp_update_involved ON public.slot_proposals
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  )
  WITH CHECK (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS sp_delete_owner_or_staff ON public.slot_proposals;
CREATE POLICY sp_delete_owner_or_staff ON public.slot_proposals
  FOR DELETE TO authenticated
  USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP TRIGGER IF EXISTS slot_proposals_updated_at ON public.slot_proposals;
CREATE TRIGGER slot_proposals_updated_at
  BEFORE UPDATE ON public.slot_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.family_needs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_proposals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.family_needs REPLICA IDENTITY FULL;
ALTER TABLE public.slot_proposals REPLICA IDENTITY FULL;
