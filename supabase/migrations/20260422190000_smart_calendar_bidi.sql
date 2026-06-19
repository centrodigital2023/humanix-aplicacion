-- =============================================================
-- Calendario inteligente bidireccional: familias marcan
-- necesidades (azul), profesionales se postulan; profesionales
-- publican disponibilidad (verde), familias contratan.
-- La parte contraria acepta o rechaza la propuesta, y cuando
-- se acepta queda reservado en tiempo real para todos.
-- =============================================================

-- ========== FAMILY_NEEDS ==========
CREATE TABLE IF NOT EXISTS public.family_needs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_user_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 20000,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','cancelled','expired')),
  service_address TEXT,
  notes TEXT,
  care_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_needs_user ON public.family_needs (family_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_family_needs_open ON public.family_needs (status, starts_at) WHERE status = 'open';

ALTER TABLE public.family_needs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_needs_select_public_open" ON public.family_needs;
CREATE POLICY "family_needs_select_public_open" ON public.family_needs
  FOR SELECT USING (
    status = 'open'
    OR auth.uid() = family_user_id
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS "family_needs_insert_self" ON public.family_needs;
CREATE POLICY "family_needs_insert_self" ON public.family_needs
  FOR INSERT WITH CHECK (auth.uid() = family_user_id);

DROP POLICY IF EXISTS "family_needs_update_self" ON public.family_needs;
CREATE POLICY "family_needs_update_self" ON public.family_needs
  FOR UPDATE USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "family_needs_delete_self" ON public.family_needs;
CREATE POLICY "family_needs_delete_self" ON public.family_needs
  FOR DELETE USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_family_needs_updated ON public.family_needs;
CREATE TRIGGER trg_family_needs_updated
BEFORE UPDATE ON public.family_needs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== SLOT_PROPOSALS ==========
CREATE TABLE IF NOT EXISTS public.slot_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_user_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  family_need_id UUID REFERENCES public.family_needs(id) ON DELETE SET NULL,
  availability_slot_id UUID REFERENCES public.availability_slots(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 20000,
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('family','professional')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled','expired')),
  message TEXT,
  decision_note TEXT,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_family ON public.slot_proposals (family_user_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_pro ON public.slot_proposals (professional_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_need ON public.slot_proposals (family_need_id);

ALTER TABLE public.slot_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposals_select_involved" ON public.slot_proposals;
CREATE POLICY "proposals_select_involved" ON public.slot_proposals
  FOR SELECT USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS "proposals_insert_own_side" ON public.slot_proposals;
CREATE POLICY "proposals_insert_own_side" ON public.slot_proposals
  FOR INSERT WITH CHECK (
    (proposed_by = 'family' AND auth.uid() = family_user_id)
    OR (proposed_by = 'professional' AND auth.uid() = professional_id)
  );

DROP POLICY IF EXISTS "proposals_update_involved" ON public.slot_proposals;
CREATE POLICY "proposals_update_involved" ON public.slot_proposals
  FOR UPDATE USING (
    auth.uid() = family_user_id
    OR auth.uid() = professional_id
    OR public.is_staff(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_proposals_updated ON public.slot_proposals;
CREATE TRIGGER trg_proposals_updated
BEFORE UPDATE ON public.slot_proposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== REALTIME ==========
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.family_needs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_proposals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_slots;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
