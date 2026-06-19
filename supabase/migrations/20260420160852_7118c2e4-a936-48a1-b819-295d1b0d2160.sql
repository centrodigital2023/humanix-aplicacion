ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by uuid;

ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by uuid;

-- Hide blocked professionals from public marketplace listings via a helper view-friendly index
CREATE INDEX IF NOT EXISTS idx_pro_blocked ON public.professional_profiles(blocked) WHERE blocked = true;
CREATE INDEX IF NOT EXISTS idx_offers_blocked ON public.job_offers(blocked) WHERE blocked = true;