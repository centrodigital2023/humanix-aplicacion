-- Observabilidad de funciones backend + idempotencia de webhooks de pago.
-- No se guardan payloads clínicos completos ni secretos: solo metadatos.

CREATE TABLE IF NOT EXISTS public.function_execution_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  TEXT NOT NULL,
  trigger_type   TEXT NOT NULL CHECK (trigger_type IN ('webhook','cron','db_trigger','frontend','internal')),
  execution_id   TEXT,
  status         TEXT NOT NULL CHECK (status IN ('success','error','rejected','duplicate','blocked')),
  duration_ms    INTEGER,
  error_code     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fn_logs_name_time ON public.function_execution_logs (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fn_logs_status_time ON public.function_execution_logs (status, created_at DESC);
ALTER TABLE public.function_execution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fn_logs_superadmin_read ON public.function_execution_logs;
CREATE POLICY fn_logs_superadmin_read ON public.function_execution_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'superadmin'));

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL,
  external_event_id  TEXT NOT NULL,
  event_type         TEXT,
  signature_valid    BOOLEAN NOT NULL DEFAULT false,
  processed          BOOLEAN NOT NULL DEFAULT false,
  payload_hash       TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  error_code         TEXT,
  UNIQUE (provider, external_event_id)
);
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_events_superadmin_read ON public.payment_webhook_events;
CREATE POLICY pay_events_superadmin_read ON public.payment_webhook_events
  FOR SELECT USING (public.has_role(auth.uid(), 'superadmin'));

-- Un pago de Mercado Pago solo puede acreditar créditos una vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_credit_topups_mp_payment
  ON public.ai_credit_topups (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
