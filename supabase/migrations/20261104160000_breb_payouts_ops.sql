-- Operación de la cola `payouts` (pago manual al profesional desde el panel de Firux).
--
-- 1. Cuando el profesional guarda o cambia su llave Bre-B, sus pagos en espera (`needs_key`, `queued`) toman la llave
--    nueva y quedan `queued`. Antes un pago `needs_key` se quedaba sin llave para siempre.
-- 2. hx_mark_payout: el equipo marca un pago como `paid` (con la referencia de Firux) o `failed` (con el motivo). Solo
--    service_role (el servidor verifica antes que quien marca sea staff). Avisa al profesional.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.hx_payout_key_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.payouts
     SET key_type = NEW.key_type, key_value = NEW.key_value, status = 'queued', updated_at = now()
   WHERE professional_id = NEW.user_id AND status IN ('needs_key', 'queued', 'failed');
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.hx_payout_key_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payout_key_sync ON public.professional_payout_keys;
CREATE TRIGGER trg_payout_key_sync
  AFTER INSERT OR UPDATE OF key_type, key_value ON public.professional_payout_keys
  FOR EACH ROW EXECUTE FUNCTION public.hx_payout_key_sync();

CREATE OR REPLACE FUNCTION public.hx_mark_payout(p_payout uuid, p_status text, p_ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record;
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN RETURN 'invalid_status'; END IF;
  SELECT * INTO p FROM public.payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p.status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p_status = 'paid' AND (p.status = 'needs_key' OR p.key_value IS NULL) THEN RETURN 'needs_key'; END IF;

  UPDATE public.payouts
     SET status = p_status,
         provider_ref = CASE WHEN p_status = 'paid' THEN left(NULLIF(trim(p_ref), ''), 120) ELSE provider_ref END,
         error_code = CASE WHEN p_status = 'failed' THEN left(COALESCE(NULLIF(trim(p_ref), ''), 'failed'), 120) ELSE NULL END,
         updated_at = now()
   WHERE id = p.id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (p.professional_id,
          CASE WHEN p_status = 'paid' THEN 'payout_paid' ELSE 'payout_failed' END,
          CASE WHEN p_status = 'paid' THEN '💸 Te enviamos tu pago' ELSE 'No pudimos enviarte tu pago' END,
          CASE WHEN p_status = 'paid'
            THEN format('Enviamos %s a tu llave Bre-B.', public.hx_cop(p.amount_cop))
            ELSE 'Revisa que tu llave Bre-B esté bien escrita. Cuando la corrijas, te lo enviamos de nuevo.' END,
          '/dashboard/profesional');
  RETURN p_status;
END $function$;

REVOKE ALL ON FUNCTION public.hx_mark_payout(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_mark_payout(uuid, text, text) TO service_role;
