-- 1) El cron RETHUS apuntaba a otro proyecto (rwllmouomrytejtbpxvn). Se reprograma
--    hacia el proyecto actual. Requiere el secreto de Vault 'rethus_cron_secret'.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('rethus-weekly-check');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'rethus-weekly-check',
  '0 9 * * 1',
  $cron$
  SELECT net.http_post(
    url     := 'https://ncyzoswhszhttdoxhqdh.supabase.co/functions/v1/rethus-weekly-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Rethus-Cron-Secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'rethus_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- 2) Disparadores de base de datos para care-alerts y clinical-alert-notify.
--    PASO MANUAL ÚNICO (el valor del secreto no se versiona):
--      select vault.create_secret('<secreto>', 'internal_webhook_secret');
--    y configurar el MISMO valor como INTERNAL_WEBHOOK_SECRET en Edge Functions.
--    Mientras el secreto no exista, el disparador no hace nada (no rompe los INSERT).
CREATE OR REPLACE FUNCTION public.notify_edge_function(fn_name text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'internal_webhook_secret';
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://ncyzoswhszhttdoxhqdh.supabase.co/functions/v1/' || fn_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body    := payload
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_edge_function(%) failed: %', fn_name, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_care_logs_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_alert THEN
    PERFORM public.notify_edge_function('care-alerts', jsonb_build_object('record', to_jsonb(NEW)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS care_logs_alert_webhook ON public.care_logs;
CREATE TRIGGER care_logs_alert_webhook
  AFTER INSERT ON public.care_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_care_logs_alert();

CREATE OR REPLACE FUNCTION public.trg_clinical_alerts_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_edge_function('clinical-alert-notify', jsonb_build_object('record', to_jsonb(NEW)));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinical_alerts_notify_webhook ON public.clinical_alerts;
CREATE TRIGGER clinical_alerts_notify_webhook
  AFTER INSERT ON public.clinical_alerts
  FOR EACH ROW EXECUTE FUNCTION public.trg_clinical_alerts_notify();
