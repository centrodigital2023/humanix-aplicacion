-- 1) Activar pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Tabla profile_embeddings
CREATE TABLE IF NOT EXISTS public.profile_embeddings (
  user_id UUID PRIMARY KEY,
  embedding vector(768),
  source_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY pe_select_owner_or_staff ON public.profile_embeddings
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY pe_upsert_owner ON public.profile_embeddings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY pe_update_owner ON public.profile_embeddings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY pe_staff_all ON public.profile_embeddings
  FOR ALL USING (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS profile_embeddings_ivf
  ON public.profile_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3) Tabla offer_embeddings
CREATE TABLE IF NOT EXISTS public.offer_embeddings (
  offer_id UUID PRIMARY KEY REFERENCES public.job_offers(id) ON DELETE CASCADE,
  embedding vector(768),
  source_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.offer_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY oe_select_open_or_owner ON public.offer_embeddings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.job_offers o
      WHERE o.id = offer_embeddings.offer_id
        AND (o.status = 'open' OR o.posted_by = auth.uid() OR public.is_staff(auth.uid()))
    )
  );
CREATE POLICY oe_upsert_owner ON public.offer_embeddings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = offer_embeddings.offer_id AND o.posted_by = auth.uid())
  );
CREATE POLICY oe_update_owner ON public.offer_embeddings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = offer_embeddings.offer_id AND o.posted_by = auth.uid())
    OR public.is_staff(auth.uid())
  );
CREATE POLICY oe_staff_all ON public.offer_embeddings
  FOR ALL USING (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS offer_embeddings_ivf
  ON public.offer_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4) Conversations + Messages
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  poster_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(application_id)
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_select_participants ON public.conversations
  FOR SELECT USING (
    auth.uid() = poster_id OR auth.uid() = professional_id OR public.is_staff(auth.uid())
  );
CREATE POLICY conv_insert_participants ON public.conversations
  FOR INSERT WITH CHECK (
    auth.uid() = poster_id OR auth.uid() = professional_id
  );
CREATE POLICY conv_update_participants ON public.conversations
  FOR UPDATE USING (
    auth.uid() = poster_id OR auth.uid() = professional_id OR public.is_staff(auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  is_ai_suggestion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY msg_select_participants ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (auth.uid() = c.poster_id OR auth.uid() = c.professional_id OR public.is_staff(auth.uid()))
    )
  );
CREATE POLICY msg_insert_sender ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (auth.uid() = c.poster_id OR auth.uid() = c.professional_id)
    )
  );

CREATE INDEX IF NOT EXISTS messages_conv_created_idx
  ON public.messages (conversation_id, created_at DESC);

-- Trigger para actualizar last_message_at
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_messages_bump ON public.messages;
CREATE TRIGGER trg_messages_bump AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_last_message();

-- Realtime
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- Trigger: al aceptar una aplicación, crear conversation
CREATE OR REPLACE FUNCTION public.create_conversation_on_accept()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_poster UUID;
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    SELECT posted_by INTO v_poster FROM public.job_offers WHERE id = NEW.job_offer_id;
    IF v_poster IS NOT NULL THEN
      INSERT INTO public.conversations (application_id, poster_id, professional_id)
      VALUES (NEW.id, v_poster, NEW.professional_id)
      ON CONFLICT (application_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apps_create_conv ON public.applications;
CREATE TRIGGER trg_apps_create_conv AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.create_conversation_on_accept();

-- 5) Subscriptions
CREATE TYPE public.subscription_plan AS ENUM ('free','pro','family','institution');
CREATE TYPE public.subscription_status AS ENUM ('active','cancelled','past_due','trialing');

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  plan public.subscription_plan NOT NULL DEFAULT 'free',
  status public.subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sub_select_self_or_staff ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY sub_staff_all ON public.subscriptions
  FOR ALL USING (public.is_staff(auth.uid()));

-- 6) AI Credits Ledger
CREATE TABLE IF NOT EXISTS public.ai_credits_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  feature TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 1,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_credits_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY aic_select_self_or_staff ON public.ai_credits_ledger
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY aic_staff_all ON public.ai_credits_ledger
  FOR ALL USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS aic_user_created_idx ON public.ai_credits_ledger (user_id, created_at DESC);

-- 7) Fraud flags
CREATE TYPE public.fraud_severity AS ENUM ('low','medium','high','critical');
CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  severity public.fraud_severity NOT NULL DEFAULT 'medium',
  meta JSONB,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY ff_staff_all ON public.fraud_flags
  FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 8) Función RPC para semantic match (server-side)
CREATE OR REPLACE FUNCTION public.match_professionals_for_offer(
  _offer_id UUID,
  _match_count INTEGER DEFAULT 10,
  _min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (user_id UUID, similarity FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pe.user_id,
         1 - (pe.embedding <=> oe.embedding) AS similarity
  FROM public.offer_embeddings oe
  CROSS JOIN public.profile_embeddings pe
  JOIN public.professional_profiles pp ON pp.user_id = pe.user_id AND pp.active = true
  WHERE oe.offer_id = _offer_id
    AND (1 - (pe.embedding <=> oe.embedding)) >= _min_similarity
  ORDER BY pe.embedding <=> oe.embedding ASC
  LIMIT _match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_offers_for_professional(
  _user_id UUID,
  _match_count INTEGER DEFAULT 10,
  _min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (offer_id UUID, similarity FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oe.offer_id,
         1 - (oe.embedding <=> pe.embedding) AS similarity
  FROM public.profile_embeddings pe
  CROSS JOIN public.offer_embeddings oe
  JOIN public.job_offers o ON o.id = oe.offer_id AND o.status = 'open'
  WHERE pe.user_id = _user_id
    AND (1 - (oe.embedding <=> pe.embedding)) >= _min_similarity
  ORDER BY oe.embedding <=> pe.embedding ASC
  LIMIT _match_count;
$$;

-- 9) Trigger updated_at en subscriptions
DROP TRIGGER IF EXISTS trg_sub_updated ON public.subscriptions;
CREATE TRIGGER trg_sub_updated BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10) Trigger: al crear profile, asignar suscripción free
CREATE OR REPLACE FUNCTION public.assign_free_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.user_id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profile_free_sub ON public.profiles;
CREATE TRIGGER trg_profile_free_sub AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_free_subscription();