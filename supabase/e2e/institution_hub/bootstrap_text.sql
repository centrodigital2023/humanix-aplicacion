-- Variante A: family_needs / slot_proposals tal como los crea supabase/migrations/20260422190000 (+ endurecimientos posteriores).
\set ON_ERROR_STOP on

CREATE TABLE public.family_needs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_user_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 20000,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','cancelled','expired')),
  service_address TEXT, notes TEXT, care_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_family_needs_user ON public.family_needs (family_user_id, starts_at);
CREATE INDEX idx_family_needs_open ON public.family_needs (status, starts_at) WHERE status = 'open';
ALTER TABLE public.family_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_needs FORCE ROW LEVEL SECURITY;

-- Estado real de producción: conviven las políticas de ambos linajes de migraciones.
CREATE POLICY "family_needs_select_authenticated" ON public.family_needs FOR SELECT TO authenticated
  USING (status = 'open' OR auth.uid() = family_user_id OR public.is_staff(auth.uid()));
CREATE POLICY fn_select_owner_or_staff ON public.family_needs FOR SELECT TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));
CREATE POLICY fn_select_open_for_pros ON public.family_needs FOR SELECT TO authenticated
  USING (status = 'open' AND public.has_role(auth.uid(), 'professional'::public.app_role));
CREATE POLICY "family_needs_insert_self" ON public.family_needs FOR INSERT WITH CHECK (auth.uid() = family_user_id);
CREATE POLICY "family_needs_update_self" ON public.family_needs FOR UPDATE USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));
CREATE POLICY "family_needs_delete_self" ON public.family_needs FOR DELETE USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_needs TO authenticated;
CREATE TRIGGER trg_family_needs_updated BEFORE UPDATE ON public.family_needs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.slot_proposals (
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
  message TEXT, decision_note TEXT,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proposals_family ON public.slot_proposals (family_user_id, status);
CREATE INDEX idx_proposals_pro ON public.slot_proposals (professional_id, status);
CREATE INDEX idx_proposals_need ON public.slot_proposals (family_need_id);
ALTER TABLE public.slot_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY sp_select_involved ON public.slot_proposals FOR SELECT TO authenticated
  USING (auth.uid() = family_user_id OR auth.uid() = professional_id OR public.is_staff(auth.uid()));
CREATE POLICY sp_insert_self ON public.slot_proposals FOR INSERT TO authenticated
  WITH CHECK ((proposed_by = 'family' AND auth.uid() = family_user_id) OR (proposed_by = 'professional' AND auth.uid() = professional_id));
CREATE POLICY sp_update_involved ON public.slot_proposals FOR UPDATE TO authenticated
  USING (auth.uid() = family_user_id OR auth.uid() = professional_id OR public.is_staff(auth.uid()))
  WITH CHECK (auth.uid() = family_user_id OR auth.uid() = professional_id OR public.is_staff(auth.uid()));
CREATE POLICY sp_delete_owner_or_staff ON public.slot_proposals FOR DELETE TO authenticated
  USING (auth.uid() = family_user_id OR auth.uid() = professional_id OR public.is_staff(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_proposals TO authenticated;
CREATE TRIGGER trg_proposals_updated BEFORE UPDATE ON public.slot_proposals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
