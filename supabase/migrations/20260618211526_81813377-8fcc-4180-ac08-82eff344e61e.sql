CREATE TABLE IF NOT EXISTS public.wearable_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT        NOT NULL
                                CHECK (provider IN (
                                  'apple_healthkit',
                                  'google_health_connect',
                                  'garmin',
                                  'fitbit',
                                  'oura',
                                  'whoop',
                                  'polar',
                                  'samsung_health'
                                )),
  external_user_id  TEXT        NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  device_name       TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'disconnected', 'error')),
  last_synced_at    TIMESTAMPTZ,
  last_error        TEXT,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, provider),
  UNIQUE (provider, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_wearable_connections_patient ON public.wearable_connections (patient_id);
CREATE INDEX IF NOT EXISTS idx_wearable_connections_lookup  ON public.wearable_connections (provider, external_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wearable_connections TO authenticated;
GRANT ALL ON public.wearable_connections TO service_role;

ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wearable_connections_select_own"
  ON public.wearable_connections FOR SELECT
  TO authenticated
  USING (
    patient_id = auth.uid()
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "wearable_connections_insert_own"
  ON public.wearable_connections FOR INSERT
  TO authenticated
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "wearable_connections_update_own"
  ON public.wearable_connections FOR UPDATE
  TO authenticated
  USING (patient_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (patient_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "wearable_connections_delete_own"
  ON public.wearable_connections FOR DELETE
  TO authenticated
  USING (patient_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_wearable_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wearable_connections_updated_at ON public.wearable_connections;
CREATE TRIGGER trg_wearable_connections_updated_at
  BEFORE UPDATE ON public.wearable_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_wearable_connections_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wearable_connections'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.wearable_connections';
  END IF;
END $$;