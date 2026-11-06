-- Ofertas y turnos tomados desaparecen en vivo para los demás profesionales (6 nov 2026).
-- Va después de 20261105200000_wompi_payments.sql. Idempotente. No crea tablas ni cambia RLS ni permisos de tablas.
--
-- Diagnóstico (lectura en producción, 6 nov 2026):
--   1. Al publicar una oferta (job_offers) o una necesidad de familia (family_needs) la base avisa a hasta 200 profesionales
--      cercanos (`hx_notify_nearby_professionals`, tipo `new_offer`) y, en plan B, al equipo de confianza
--      (`invite_team_core`, tipos `team_invite` / `team_invite_urgent`). Cuando un profesional toma la oferta
--      (`accept_application` la deja en «filled») o la familia acepta una propuesta (`accept_slot_proposal` deja la
--      necesidad en «matched»), esos avisos seguían sin leer en la campana y en la alerta flotante de todos los demás.
--   2. `accept_slot_proposal` bloquea solo la propuesta que se acepta. Si dos propuestas distintas de la misma familia se
--      aceptan a la vez (por ejemplo, la familia le propuso el mismo horario a dos profesionales y ambos tocan «Aceptar»),
--      las dos transacciones avanzan, y una termina en un interbloqueo («deadlock detected») en lugar de un mensaje claro.
--
-- Cambios:
--   1. `hx_retire_offer_notifications`: marca como leídos y «retirados» (`meta.retired`) los avisos de esa oferta o
--      necesidad. Es un UPDATE: `notifications` ya está en la publicación de Realtime con REPLICA IDENTITY FULL, así que
--      cada profesional recibe su propio cambio (RLS: solo sus filas) y la pantalla quita el aviso al instante.
--      Se llama desde disparadores cuando la oferta deja de estar abierta (tomada, cerrada, bloqueada o borrada) y cuando la
--      necesidad deja de estar abierta.
--   2. `invite_team_core` guarda `meta.offer_id` en sus avisos (antes no había forma de saber de qué oferta eran).
--      Los avisos antiguos sin `meta` se reconocen por la invitación: se crean en la misma transacción, mismo `created_at`.
--   3. `accept_slot_proposal`: un candado por familia serializa las aceptaciones; si la necesidad ya se cubrió o la
--      propuesta se canceló porque otro tomó el horario, responde «Este horario ya fue tomado».
--      El resto de la función es igual a la de producción del 6 nov 2026.

-- ─── 1) Retirar avisos de una oferta o necesidad que ya no está abierta ──────────

CREATE INDEX IF NOT EXISTS idx_notifications_offer_ref
  ON public.notifications ((meta ->> 'offer_id'))
  WHERE type IN ('new_offer', 'team_invite', 'team_invite_urgent');

CREATE INDEX IF NOT EXISTS idx_notifications_need_ref
  ON public.notifications ((meta ->> 'need_id'))
  WHERE type = 'new_offer';

CREATE OR REPLACE FUNCTION public.hx_retire_offer_notifications(p_offer uuid, p_need uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tag jsonb := jsonb_build_object('retired', COALESCE(p_reason, 'closed'), 'retired_at', now());
  v_n   integer := 0;
  v_m   integer := 0;
BEGIN
  IF p_offer IS NOT NULL THEN
    UPDATE public.notifications n
       SET read_at = COALESCE(n.read_at, now()),
           meta    = COALESCE(n.meta, '{}'::jsonb) || v_tag
     WHERE n.type IN ('new_offer', 'team_invite', 'team_invite_urgent')
       AND n.meta ->> 'offer_id' = p_offer::text
       AND NOT (n.meta ? 'retired');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- Invitaciones de equipo anteriores a esta migración (sin meta): misma transacción que la invitación.
    UPDATE public.notifications n
       SET read_at = COALESCE(n.read_at, now()),
           meta    = jsonb_build_object('offer_id', p_offer) || v_tag
      FROM public.offer_team_invites i
     WHERE i.job_offer_id = p_offer
       AND n.user_id = i.professional_id
       AND n.type IN ('team_invite', 'team_invite_urgent')
       AND n.created_at = i.created_at
       AND n.meta IS NULL;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    v_n := v_n + v_m;
  END IF;

  IF p_need IS NOT NULL THEN
    UPDATE public.notifications n
       SET read_at = COALESCE(n.read_at, now()),
           meta    = COALESCE(n.meta, '{}'::jsonb) || v_tag
     WHERE n.type = 'new_offer'
       AND n.meta ->> 'need_id' = p_need::text
       AND NOT (n.meta ? 'retired');
    GET DIAGNOSTICS v_m = ROW_COUNT;
    v_n := v_n + v_m;
  END IF;
  RETURN v_n;
END
$$;

REVOKE ALL ON FUNCTION public.hx_retire_offer_notifications(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_retire_offer_notifications(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_job_offers_retire_notifications()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.hx_retire_offer_notifications(
    OLD.id, NULL,
    CASE
      WHEN TG_OP = 'DELETE' THEN 'deleted'
      WHEN NEW.status::text = 'filled' THEN 'taken'
      ELSE 'closed'
    END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_job_offers_retire_notifications: %', SQLERRM;   -- nunca impide tomar ni cerrar una oferta
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_job_offers_retire_notifications ON public.job_offers;
CREATE TRIGGER trg_job_offers_retire_notifications
  AFTER UPDATE OF status, blocked ON public.job_offers
  FOR EACH ROW
  WHEN (OLD.status::text = 'open' AND NOT COALESCE(OLD.blocked, false)
        AND (NEW.status::text <> 'open' OR COALESCE(NEW.blocked, false)))
  EXECUTE FUNCTION public.trg_job_offers_retire_notifications();

DROP TRIGGER IF EXISTS trg_job_offers_retire_notifications_del ON public.job_offers;
CREATE TRIGGER trg_job_offers_retire_notifications_del
  AFTER DELETE ON public.job_offers
  FOR EACH ROW
  WHEN (OLD.status::text = 'open')
  EXECUTE FUNCTION public.trg_job_offers_retire_notifications();

CREATE OR REPLACE FUNCTION public.trg_family_needs_retire_notifications()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.hx_retire_offer_notifications(
    NULL, OLD.id,
    CASE
      WHEN TG_OP = 'DELETE' THEN 'deleted'
      WHEN NEW.status::text = 'matched' THEN 'taken'
      ELSE 'closed'
    END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_family_needs_retire_notifications: %', SQLERRM;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_family_needs_retire_notifications ON public.family_needs;
CREATE TRIGGER trg_family_needs_retire_notifications
  AFTER UPDATE OF status ON public.family_needs
  FOR EACH ROW
  WHEN (OLD.status::text = 'open' AND NEW.status::text <> 'open')
  EXECUTE FUNCTION public.trg_family_needs_retire_notifications();

DROP TRIGGER IF EXISTS trg_family_needs_retire_notifications_del ON public.family_needs;
CREATE TRIGGER trg_family_needs_retire_notifications_del
  AFTER DELETE ON public.family_needs
  FOR EACH ROW
  WHEN (OLD.status::text = 'open')
  EXECUTE FUNCTION public.trg_family_needs_retire_notifications();

REVOKE ALL ON FUNCTION public.trg_job_offers_retire_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_family_needs_retire_notifications() FROM PUBLIC, anon, authenticated;

-- Avisos que ya quedaron viejos: ofertas y necesidades que hoy no están abiertas.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT (n.meta ->> 'offer_id')::uuid AS id
      FROM public.notifications n
      JOIN public.job_offers o ON o.id::text = n.meta ->> 'offer_id'
     WHERE n.type IN ('new_offer', 'team_invite', 'team_invite_urgent')
       AND NOT (n.meta ? 'retired')
       AND (o.status::text <> 'open' OR COALESCE(o.blocked, false))
  LOOP
    PERFORM public.hx_retire_offer_notifications(r.id, NULL, 'closed');
  END LOOP;
  FOR r IN
    SELECT DISTINCT (n.meta ->> 'need_id')::uuid AS id
      FROM public.notifications n
      JOIN public.family_needs f ON f.id::text = n.meta ->> 'need_id'
     WHERE n.type = 'new_offer'
       AND NOT (n.meta ? 'retired')
       AND f.status::text <> 'open'
  LOOP
    PERFORM public.hx_retire_offer_notifications(NULL, r.id, 'closed');
  END LOOP;
END $$;

-- ─── 2) Invitaciones de equipo con referencia a la oferta ─────────────────────────

CREATE OR REPLACE FUNCTION public.invite_team_core(p_offer uuid, p_inviter uuid, p_exclude uuid DEFAULT NULL::uuid, p_auto boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  o      public.job_offers%ROWTYPE;
  v_name text;
  v_n    integer := 0;
  r      record;
BEGIN
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer;
  IF NOT FOUND OR o.posted_by <> p_inviter OR o.blocked OR o.status::text <> 'open' THEN
    RETURN 0;
  END IF;
  v_name := public.party_display_name(p_inviter);

  FOR r IN
    SELECT f.professional_id
      FROM public.care_favorites f
      JOIN public.professional_profiles pp ON pp.user_id = f.professional_id
     WHERE f.client_id = p_inviter
       AND f.professional_id IS DISTINCT FROM p_exclude
       AND NOT COALESCE(pp.blocked, false)
       AND NOT EXISTS (SELECT 1 FROM public.applications a
                        WHERE a.job_offer_id = o.id AND a.professional_id = f.professional_id)
       AND NOT EXISTS (SELECT 1 FROM public.offer_team_invites i
                        WHERE i.job_offer_id = o.id AND i.professional_id = f.professional_id)
     ORDER BY f.created_at
     LIMIT 25
  LOOP
    INSERT INTO public.offer_team_invites (job_offer_id, professional_id, invited_by)
    VALUES (o.id, r.professional_id, p_inviter)
    ON CONFLICT DO NOTHING;
    BEGIN
      IF p_auto THEN
        INSERT INTO public.notifications (user_id, type, title, body, link, meta)
        VALUES (r.professional_id, 'team_invite_urgent',
          v_name || ' confía en ti: se liberó un turno',
          'Eres de su equipo de confianza. «' || left(o.title, 60) || '» (' || COALESCE(o.city, 'tu ciudad') ||
            ') quedó disponible: postúlate antes que nadie.',
          '/dashboard/profesional',
          jsonb_build_object('kind', 'team_invite', 'offer_id', o.id, 'poster_id', p_inviter));
      ELSE
        INSERT INTO public.notifications (user_id, type, title, body, link, meta)
        VALUES (r.professional_id, 'team_invite',
          v_name || ' te invita a postularte',
          'Ya trabajaron juntos y quieren contar contigo en «' || left(o.title, 60) || '» (' || COALESCE(o.city, 'tu ciudad') ||
            '). Revisa el turno y postúlate desde tu agenda.',
          '/dashboard/profesional',
          jsonb_build_object('kind', 'team_invite', 'offer_id', o.id, 'poster_id', p_inviter));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'invite_team_core: %', SQLERRM;   -- igual que hx_notify: un aviso fallido no impide invitar
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ─── 3) Aceptar una propuesta de horario sin carreras ────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_slot_proposal(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  p         public.slot_proposals%ROWTYPE;
  v_family  uuid;
  v_hours   integer;
  v_total   integer;
  v_pct     numeric;
  v_fee     integer;
  v_booking uuid;
  v_address text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM set_config('app.proposal_rpc', 'on', true);

  -- Una aceptación a la vez por familia: la segunda espera, y al seguir ya ve la propuesta cancelada o la necesidad cubierta.
  SELECT sp.family_user_id INTO v_family FROM public.slot_proposals sp WHERE sp.id = p_proposal_id;
  IF v_family IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('hx_family_take:' || v_family::text));
  END IF;

  SELECT * INTO p FROM public.slot_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta no encontrada';
  END IF;
  IF p.status::text = 'cancelled' AND p.decision_note = 'Horario ya cubierto' THEN
    RAISE EXCEPTION 'Este horario ya fue tomado' USING ERRCODE = '23514', HINT = 'slot_taken';
  END IF;
  IF p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La propuesta ya no está disponible (%)', p.status::text;
  END IF;
  IF p.family_need_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.family_needs fn WHERE fn.id = p.family_need_id AND fn.status::text <> 'open') THEN
    RAISE EXCEPTION 'Este horario ya fue tomado' USING ERRCODE = '23514', HINT = 'slot_taken';
  END IF;
  IF p.expires_at IS NOT NULL AND p.expires_at <= now() THEN
    RAISE EXCEPTION 'La oferta venció' USING ERRCODE = '23514';
  END IF;
  IF NOT (
       (p.proposed_by::text = 'family'       AND p.professional_id = v_uid)
    OR (p.proposed_by::text = 'professional' AND p.family_user_id  = v_uid)
  ) THEN
    RAISE EXCEPTION 'Solo quien recibe la propuesta puede aceptarla' USING ERRCODE = '42501';
  END IF;
  IF p.ends_at <= p.starts_at OR p.starts_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'El horario de la propuesta ya no es válido';
  END IF;

  v_hours := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (p.ends_at - p.starts_at)) / 3600)::integer);
  v_total := p.hourly_rate * v_hours;
  v_pct   := public.platform_commission_pct(p.professional_id);
  v_fee   := ROUND(v_total * v_pct / 100.0)::integer;

  v_address := COALESCE(
    (SELECT NULLIF(btrim(fn.service_address), '') FROM public.family_needs fn WHERE fn.id = p.family_need_id),
    (SELECT NULLIF(btrim(fp.default_address), '') FROM public.family_profiles fp WHERE fp.user_id = p.family_user_id)
  );

  INSERT INTO public.service_bookings (
    client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate,
    total_amount, platform_fee_pct, platform_fee_amount, professional_payout, payment_mode, service_address
  ) VALUES (
    p.family_user_id, p.professional_id, 'confirmed', p.starts_at, v_hours, p.hourly_rate,
    v_total, v_pct, v_fee, v_total - v_fee, 'pending', v_address
  ) RETURNING id INTO v_booking;

  UPDATE public.slot_proposals
     SET status = 'accepted', booking_id = v_booking
   WHERE id = p.id;

  IF p.availability_slot_id IS NOT NULL THEN
    UPDATE public.availability_slots SET status = 'busy' WHERE id = p.availability_slot_id;
  ELSE
    INSERT INTO public.availability_slots (user_id, starts_at, ends_at, status)
    VALUES (p.professional_id, p.starts_at, p.ends_at, 'busy');
  END IF;

  -- Todas las horas abiertas de esa familia dentro del turno quedan cubiertas.
  UPDATE public.family_needs
     SET status = 'matched'
   WHERE status = 'open'
     AND (
          id = p.family_need_id
       OR (family_user_id = p.family_user_id AND starts_at >= p.starts_at AND ends_at <= p.ends_at)
     );

  UPDATE public.slot_proposals
     SET status = 'cancelled', decision_note = 'Horario ya cubierto'
   WHERE status = 'pending'
     AND id <> p.id
     AND (
          (p.family_need_id IS NOT NULL AND family_need_id = p.family_need_id)
       OR (professional_id = p.professional_id AND starts_at < p.ends_at AND ends_at > p.starts_at)
       OR (family_user_id = p.family_user_id AND starts_at >= p.starts_at AND ends_at <= p.ends_at)
     );

  RETURN v_booking;
END;
$function$;
