-- CRM tasks table
CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to UUID,
  created_by UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_tasks_staff_all ON public.crm_tasks FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_crm_tasks_upd BEFORE UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add social trust score column to professional_profiles
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS social_trust_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS social_trust_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS social_trust_updated_at TIMESTAMPTZ;

-- Add audience targeting + share counters to ad_banners
ALTER TABLE public.ad_banners
  ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_audience_match JSONB;

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pqrs_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_banners;