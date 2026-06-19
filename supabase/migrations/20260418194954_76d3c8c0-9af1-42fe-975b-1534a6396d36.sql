-- ============================================================
-- TANDA 1: Núcleo de gobernanza
-- ============================================================

-- ----------- AUDIT LOG -----------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  meta JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON public.audit_log(resource_type, resource_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_staff" ON public.audit_log
  FOR SELECT USING (public.is_staff(auth.uid()));

CREATE POLICY "audit_insert_authenticated" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Helper para registrar auditoría desde cualquier parte
CREATE OR REPLACE FUNCTION public.log_audit(
  _action TEXT,
  _resource_type TEXT DEFAULT NULL,
  _resource_id TEXT DEFAULT NULL,
  _severity TEXT DEFAULT 'info',
  _meta JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
  _email TEXT;
BEGIN
  SELECT email INTO _email FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  INSERT INTO public.audit_log (actor_id, actor_email, action, resource_type, resource_id, severity, meta)
  VALUES (auth.uid(), _email, _action, _resource_type, _resource_id, _severity, _meta)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- ----------- AD BANNERS -----------
CREATE TABLE IF NOT EXISTS public.ad_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url TEXT,
  cta_label TEXT,
  audience TEXT NOT NULL DEFAULT 'all', -- all, family, professional, institution
  position TEXT NOT NULL DEFAULT 'home_hero',
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  ai_score NUMERIC,
  ai_recommendation TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_banners_active ON public.ad_banners(active, audience, position);

ALTER TABLE public.ad_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ads_select_active_or_staff" ON public.ad_banners
  FOR SELECT USING (
    (active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now()))
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "ads_superadmin_all" ON public.ad_banners
  FOR ALL USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER ads_updated_at BEFORE UPDATE ON public.ad_banners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------- CRM CONTACTS -----------
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  city TEXT,
  source TEXT, -- web, whatsapp, referral, ad, manual
  segment TEXT, -- ia-classified: family, professional, institution, lead-hot, lead-warm, lead-cold
  tags TEXT[] DEFAULT '{}',
  lead_score INTEGER DEFAULT 0,
  ai_sentiment TEXT, -- positive, neutral, negative
  ai_summary TEXT,
  notes TEXT,
  linked_user_id UUID,
  last_contacted_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_segment ON public.crm_contacts(segment);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_score ON public.crm_contacts(lead_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contacts_email ON public.crm_contacts(lower(email)) WHERE email IS NOT NULL;

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_contacts_staff_all" ON public.crm_contacts
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER crm_contacts_updated_at BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------- CRM CAMPAIGNS -----------
CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email', -- email, whatsapp
  subject TEXT,
  content TEXT,
  segment_filter JSONB, -- { tags: [], segment: '', min_score: 0 }
  status TEXT NOT NULL DEFAULT 'draft', -- draft, scheduled, sending, sent, paused
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  ai_subject_suggestions JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaigns_staff_all" ON public.crm_campaigns
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER crm_campaigns_updated_at BEFORE UPDATE ON public.crm_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------- CRM INTERACTIONS -----------
CREATE TABLE IF NOT EXISTS public.crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- email, whatsapp, note, task, call_log
  direction TEXT, -- in, out
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'completed', -- pending, completed, failed
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  campaign_id UUID REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  meta JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_inter_contact ON public.crm_interactions(contact_id, created_at DESC);

ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_inter_staff_all" ON public.crm_interactions
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- ----------- PQRS TICKETS -----------
CREATE TABLE IF NOT EXISTS public.pqrs_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,
  type TEXT NOT NULL DEFAULT 'peticion', -- peticion, queja, reclamo, sugerencia, denuncia
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  ai_category TEXT, -- ia: facturacion, servicio, fraude, soporte, otro
  ai_priority TEXT, -- ia: low, medium, high, critical
  ai_sentiment TEXT,
  ai_summary TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open, in_progress, resolved, closed
  assigned_to UUID,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pqrs_status ON public.pqrs_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_priority ON public.pqrs_tickets(ai_priority);

ALTER TABLE public.pqrs_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pqrs_insert_anyone" ON public.pqrs_tickets
  FOR INSERT WITH CHECK (true);

CREATE POLICY "pqrs_select_owner_or_staff" ON public.pqrs_tickets
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "pqrs_staff_all" ON public.pqrs_tickets
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER pqrs_updated_at BEFORE UPDATE ON public.pqrs_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
