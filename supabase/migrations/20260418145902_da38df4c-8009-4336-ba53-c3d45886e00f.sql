
-- 1. CONSENTIMIENTOS (Habeas Data Ley 1581)
CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  consent_type TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  ip_address TEXT,
  user_agent TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents(user_id, consent_type);
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consents_select_self_or_staff" ON public.user_consents
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "consents_insert_self" ON public.user_consents
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "consents_update_self" ON public.user_consents
  FOR UPDATE USING (auth.uid() = user_id);

-- 2. RESERVAS DE SERVICIO (booking entre familia/IPS y profesional)
CREATE TABLE IF NOT EXISTS public.service_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  job_offer_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_hours NUMERIC(5,2) NOT NULL DEFAULT 1,
  hourly_rate INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  service_address TEXT,
  service_lat DOUBLE PRECISION,
  service_lng DOUBLE PRECISION,
  notes TEXT,
  emergency_phone TEXT,
  started_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON public.service_bookings(client_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_pro ON public.service_bookings(professional_id, status);
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_select_involved" ON public.service_bookings
  FOR SELECT USING (
    auth.uid() = client_id OR auth.uid() = professional_id OR public.is_staff(auth.uid())
  );
CREATE POLICY "bookings_insert_client" ON public.service_bookings
  FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "bookings_update_involved" ON public.service_bookings
  FOR UPDATE USING (
    auth.uid() = client_id OR auth.uid() = professional_id OR public.is_staff(auth.uid())
  );
CREATE TRIGGER set_bookings_updated_at BEFORE UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. PINGS DE TRACKING EN VIVO (geolocalización del profesional)
CREATE TABLE IF NOT EXISTS public.tracking_pings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tracking_booking ON public.tracking_pings(booking_id, created_at DESC);
ALTER TABLE public.tracking_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tracking_insert_pro" ON public.tracking_pings
  FOR INSERT WITH CHECK (
    auth.uid() = professional_id AND EXISTS (
      SELECT 1 FROM public.service_bookings b
      WHERE b.id = tracking_pings.booking_id AND b.professional_id = auth.uid()
    )
  );
CREATE POLICY "tracking_select_involved" ON public.tracking_pings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.service_bookings b
      WHERE b.id = tracking_pings.booking_id
      AND (b.client_id = auth.uid() OR b.professional_id = auth.uid() OR public.is_staff(auth.uid()))
    )
  );

-- 4. VALORACIONES POST-SERVICIO (con voz + sentimiento IA)
CREATE TABLE IF NOT EXISTS public.service_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL,
  rated_id UUID NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  voice_url TEXT,
  voice_transcript TEXT,
  ai_sentiment TEXT CHECK (ai_sentiment IN ('positive','neutral','negative')),
  ai_sentiment_score NUMERIC(3,2),
  ai_alert BOOLEAN NOT NULL DEFAULT false,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_ratings_rated ON public.service_ratings(rated_id);
CREATE INDEX IF NOT EXISTS idx_service_ratings_alert ON public.service_ratings(ai_alert) WHERE ai_alert = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_ratings_unique ON public.service_ratings(booking_id, rater_id);
ALTER TABLE public.service_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_ratings_insert_rater" ON public.service_ratings
  FOR INSERT WITH CHECK (auth.uid() = rater_id);
CREATE POLICY "service_ratings_select_all" ON public.service_ratings
  FOR SELECT USING (true);
CREATE POLICY "service_ratings_update_self" ON public.service_ratings
  FOR UPDATE USING (auth.uid() = rater_id OR public.is_staff(auth.uid()));

-- 5. INCIDENTES DE EMERGENCIA (botón pánico)
CREATE TABLE IF NOT EXISTS public.emergency_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  triggered_by UUID NOT NULL,
  incident_type TEXT NOT NULL DEFAULT 'panic',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.emergency_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emergency_insert_self" ON public.emergency_incidents
  FOR INSERT WITH CHECK (auth.uid() = triggered_by);
CREATE POLICY "emergency_select_involved" ON public.emergency_incidents
  FOR SELECT USING (
    auth.uid() = triggered_by OR public.is_staff(auth.uid()) OR (
      booking_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.service_bookings b
        WHERE b.id = emergency_incidents.booking_id
        AND (b.client_id = auth.uid() OR b.professional_id = auth.uid())
      )
    )
  );
CREATE POLICY "emergency_staff_all" ON public.emergency_incidents
  FOR ALL USING (public.is_staff(auth.uid()));

-- 6. STORAGE BUCKET para audios de valoración
INSERT INTO storage.buckets (id, name, public)
VALUES ('rating-voice', 'rating-voice', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "rating_voice_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'rating-voice');
CREATE POLICY "rating_voice_self_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rating-voice' AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "rating_voice_self_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rating-voice' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 7. REALTIME para tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.tracking_pings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
