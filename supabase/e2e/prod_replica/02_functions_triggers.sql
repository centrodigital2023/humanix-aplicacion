-- 02: funciones y disparadores existentes en producción (pg_get_functiondef / pg_get_triggerdef, 2026-10-09).
-- Se omiten las que no intervienen en las migraciones recientes (wearables, staff, CRM…).
-- match_professionals_for_offer es un sustituto vacío: la real usa pgvector (embeddings), que no se instala aquí.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('superadmin','hr_staff','evaluator')
  )
$function$;

CREATE OR REPLACE FUNCTION public.log_audit(_action text, _resource_type text DEFAULT NULL::text, _resource_id text DEFAULT NULL::text, _severity text DEFAULT 'info'::text, _meta jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_plan TEXT; v_status TEXT; v_period_end TIMESTAMPTZ;
BEGIN
  SELECT plan, status, current_period_end INTO v_plan, v_status, v_period_end
  FROM public.mp_subscriptions WHERE user_id = p_user_id;
  IF v_plan IS NOT NULL AND v_status IN ('active','approved')
     AND (v_period_end IS NULL OR v_period_end > now())
     AND v_plan IN ('essential_monthly','pro_monthly','institution_monthly') THEN
    RETURN 0;
  END IF;
  RETURN 12;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_booking_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_end timestamptz;
BEGIN
  IF NEW.client_id = NEW.professional_id THEN
    RAISE EXCEPTION 'No puedes contratarte a ti mismo' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_staff(auth.uid())
     AND OLD.status IN ('pending','confirmed','in_route','in_progress','completed','cancelled')
  THEN
    IF NOT (
         (OLD.status = 'pending'     AND NEW.status IN ('confirmed','cancelled'))
      OR (OLD.status = 'confirmed'   AND NEW.status IN ('in_route','in_progress','cancelled'))
      OR (OLD.status = 'in_route'    AND NEW.status IN ('in_progress','cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status IN ('completed','cancelled'))
    ) THEN
      RAISE EXCEPTION 'Transición de estado no permitida: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('pending','confirmed','in_route','in_progress')
     AND (
       TG_OP = 'INSERT'
       OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
       OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
       OR NEW.status IS DISTINCT FROM OLD.status
     )
  THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.professional_id::text));
    v_end := NEW.scheduled_at + (NEW.duration_hours * interval '1 hour');
    IF EXISTS (
      SELECT 1 FROM public.service_bookings b
      WHERE b.professional_id = NEW.professional_id
        AND b.id <> NEW.id
        AND b.status IN ('confirmed','in_route','in_progress')
        AND b.scheduled_at < v_end
        AND b.scheduled_at + (b.duration_hours * interval '1 hour') > NEW.scheduled_at
    ) THEN
      RAISE EXCEPTION 'El profesional ya tiene un servicio en ese horario' USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_service_bookings_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Financial / pricing fields: only staff may change.
  NEW.total_amount         := OLD.total_amount;
  NEW.hourly_rate          := OLD.hourly_rate;
  NEW.platform_fee_amount  := OLD.platform_fee_amount;
  NEW.platform_fee_pct     := OLD.platform_fee_pct;
  NEW.professional_payout  := OLD.professional_payout;
  NEW.payment_mode         := OLD.payment_mode;

  -- Identity fields must not be re-pointed by participants.
  NEW.client_id            := OLD.client_id;
  NEW.professional_id      := OLD.professional_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_platform_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.platform_fee_amount := ROUND(NEW.total_amount * NEW.platform_fee_pct / 100.0)::INTEGER;
  NEW.professional_payout := NEW.total_amount - NEW.platform_fee_amount;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_booking_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  uuid := auth.uid();
  v_target uuid;
  v_by_pro boolean;
BEGIN
  v_by_pro := (v_actor IS NOT NULL AND v_actor = NEW.professional_id);
  v_target := CASE WHEN v_by_pro THEN NEW.client_id ELSE NEW.professional_id END;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_target,
    'booking_cancelled',
    CASE WHEN v_by_pro THEN 'Tu profesional canceló el servicio' ELSE 'Se canceló un servicio' END,
    CASE WHEN v_by_pro
      THEN 'Puedes buscar un reemplazo disponible para el mismo horario desde el detalle del servicio.'
      ELSE 'El servicio programado fue cancelado.' END,
    '/servicio/' || NEW.id::text
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_conversation_on_accept()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_circle_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user uuid; v_name text;
BEGIN
  SELECT user_id INTO v_user FROM public.profiles WHERE lower(email) = lower(NEW.invited_email) LIMIT 1;
  IF v_user IS NOT NULL THEN
    SELECT COALESCE(full_name, email) INTO v_name FROM public.profiles WHERE user_id = NEW.owner_id;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_user, 'care_circle_invite', 'Te invitaron a un círculo de cuidado',
            COALESCE(v_name, 'Un familiar') || ' quiere que veas el estado de sus servicios.', '/dashboard/familia');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_circle_invitation(p_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.care_circle_members
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         member_id = CASE WHEN p_accept THEN auth.uid() ELSE NULL END,
         accepted_at = CASE WHEN p_accept THEN now() ELSE NULL END
   WHERE id = p_id
     AND status = 'invited'
     AND lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitación no encontrada' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_professional_publish()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow staff to do whatever
  IF public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Allow if the RPC set the bypass flag for this transaction
  IF current_setting('app.allow_publish', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Block flipping published from false -> true outside the RPC
  IF COALESCE(NEW.published, false) = true
     AND COALESCE(OLD.published, false) = false THEN
    RAISE EXCEPTION 'Publicación bloqueada: debes usar publish_profile() tras la validación IA.';
  END IF;

  -- Also block users from advancing published_at by themselves
  IF NEW.published_at IS DISTINCT FROM OLD.published_at
     AND COALESCE(NEW.published, false) = true THEN
    NEW.published_at := OLD.published_at;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_professional_trust_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role' OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.verification_status := OLD.verification_status;
  NEW.rethus_checked_at   := OLD.rethus_checked_at;
  NEW.rethus_verified     := OLD.rethus_verified;
  NEW.verified            := OLD.verified;
  NEW.trust_score         := OLD.trust_score;
  NEW.avg_rating          := OLD.avg_rating;
  NEW.total_jobs          := OLD.total_jobs;
  NEW.user_id             := OLD.user_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.assign_free_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.user_id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.refresh_pro_avg_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID;
BEGIN
  v_uid := COALESCE(NEW.rated_user_id, OLD.rated_user_id);
  UPDATE public.professional_profiles
  SET avg_rating = COALESCE((
      SELECT ROUND(AVG(stars)::numeric, 2) FROM public.ratings WHERE rated_user_id = v_uid
    ), 0)
  WHERE user_id = v_uid;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_rating_dimensions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b public.service_bookings%ROWTYPE;
  v_keys text[];
  k text;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = NEW.booking_id;
  IF NOT FOUND OR b.status <> 'completed' THEN
    RAISE EXCEPTION 'Solo se puede calificar un servicio completado';
  END IF;
  IF NEW.rater_id = b.client_id AND NEW.rated_id = b.professional_id THEN
    NEW.rater_role := 'family';
    v_keys := ARRAY['punctuality','treatment','compliance','communication'];
  ELSIF NEW.rater_id = b.professional_id AND NEW.rated_id = b.client_id THEN
    NEW.rater_role := 'professional';
    v_keys := ARRAY['clarity','treatment','payment','environment'];
  ELSE
    RAISE EXCEPTION 'No participaste en este servicio' USING ERRCODE = '42501';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.scores) AS key)
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_keys) AS x) THEN
    RAISE EXCEPTION 'Dimensiones inválidas';
  END IF;
  FOREACH k IN ARRAY v_keys LOOP
    IF jsonb_typeof(NEW.scores -> k) <> 'number'
       OR (NEW.scores ->> k)::numeric NOT BETWEEN 1 AND 5
       OR (NEW.scores ->> k)::numeric <> trunc((NEW.scores ->> k)::numeric) THEN
      RAISE EXCEPTION 'Cada dimensión debe ser un entero de 1 a 5';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.professional_dimension_averages(p_user uuid)
 RETURNS TABLE(dimension text, average numeric, ratings integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.key, ROUND(AVG((d.value)::numeric), 2), COUNT(*)::integer
  FROM public.service_rating_dimensions r,
       LATERAL jsonb_each_text(r.scores) AS d(key, value)
  WHERE r.rated_id = p_user AND r.rater_role = 'family'
  GROUP BY d.key
  HAVING COUNT(*) >= 3;
$function$;

CREATE OR REPLACE FUNCTION public.accept_slot_proposal(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  p         public.slot_proposals%ROWTYPE;
  v_hours   integer;
  v_total   integer;
  v_pct     numeric;
  v_fee     integer;
  v_booking uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO p FROM public.slot_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta no encontrada';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'La propuesta ya no está disponible (%)', p.status;
  END IF;
  IF NOT (
       (p.proposed_by = 'family'       AND p.professional_id = v_uid)
    OR (p.proposed_by = 'professional' AND p.family_user_id  = v_uid)
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
  INSERT INTO public.service_bookings (
    client_id, professional_id, status, scheduled_at, duration_hours, hourly_rate,
    total_amount, platform_fee_pct, platform_fee_amount, professional_payout, payment_mode
  ) VALUES (
    p.family_user_id, p.professional_id, 'confirmed', p.starts_at, v_hours, p.hourly_rate,
    v_total, v_pct, v_fee, v_total - v_fee, 'pending'
  ) RETURNING id INTO v_booking;
  UPDATE public.slot_proposals
     SET status = 'accepted', booking_id = v_booking, updated_at = now()
   WHERE id = p.id;
  IF p.availability_slot_id IS NOT NULL THEN
    UPDATE public.availability_slots SET status = 'busy' WHERE id = p.availability_slot_id;
  ELSE
    INSERT INTO public.availability_slots (user_id, starts_at, ends_at, status)
    VALUES (p.professional_id, p.starts_at, p.ends_at, 'busy');
  END IF;
  IF p.family_need_id IS NOT NULL THEN
    UPDATE public.family_needs SET status = 'matched' WHERE id = p.family_need_id;
  END IF;
  UPDATE public.slot_proposals
     SET status = 'cancelled', decision_note = 'Horario ya cubierto', updated_at = now()
   WHERE status = 'pending'
     AND id <> p.id
     AND (
          (p.family_need_id IS NOT NULL AND family_need_id = p.family_need_id)
       OR (professional_id = p.professional_id AND starts_at < p.ends_at AND ends_at > p.starts_at)
     );
  RETURN v_booking;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_replacement_candidates(p_booking_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, specialty text, hourly_rate integer, avg_rating numeric, total_jobs integer, is_favorite boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b     public.service_bookings%ROWTYPE;
  v_end timestamptz;
BEGIN
  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR auth.uid() IS NULL OR b.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Solo se buscan reemplazos para servicios cancelados';
  END IF;
  v_end := b.scheduled_at + (b.duration_hours * interval '1 hour');

  RETURN QUERY
  SELECT pp.user_id, pr.full_name, COALESCE(pp.avatar_url, pr.avatar_url), pp.specialty,
         pp.hourly_rate, pp.avg_rating, pp.total_jobs, (f.professional_id IS NOT NULL)
  FROM public.professional_profiles pp
  JOIN public.profiles pr ON pr.user_id = pp.user_id
  LEFT JOIN public.care_favorites f
         ON f.client_id = b.client_id AND f.professional_id = pp.user_id
  WHERE pp.published AND pp.active AND pp.available AND NOT COALESCE(pp.blocked, false)
    AND pp.user_id NOT IN (b.client_id, b.professional_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.service_bookings o
      WHERE o.professional_id = pp.user_id
        AND o.status IN ('confirmed','in_route','in_progress')
        AND o.scheduled_at < v_end
        AND o.scheduled_at + (o.duration_hours * interval '1 hour') > b.scheduled_at
    )
  ORDER BY (f.professional_id IS NOT NULL) DESC, pp.avg_rating DESC NULLS LAST, pp.total_jobs DESC NULLS LAST
  LIMIT 10;
END;
$function$;

-- Sustituto: la función real usa pgvector (offer_embeddings / profile_embeddings).
CREATE OR REPLACE FUNCTION public.match_professionals_for_offer(_offer_id uuid, _match_count integer DEFAULT 10, _min_similarity double precision DEFAULT 0.5)
 RETURNS TABLE(user_id uuid, similarity double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULL::uuid, NULL::double precision WHERE false;
$function$;

-- ─── Disparadores ───────────────────────────────────────────────────────────────
-- «updated_at» en todas las tablas que lo tienen
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['applications','availability_slots','conversations','family_needs','family_profiles','institution_profiles','job_offers','mp_subscriptions','pqrs_tickets','professional_profiles','profiles','service_bookings','slot_proposals','subscriptions'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
  END LOOP;
END $$;

CREATE TRIGGER trg_applications_create_conversation AFTER UPDATE ON public.applications FOR EACH ROW WHEN (((new.status = 'accepted'::application_status) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION create_conversation_on_accept();
CREATE TRIGGER trg_apps_create_conv AFTER INSERT OR UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION create_conversation_on_accept();
CREATE TRIGGER trg_notify_circle_invitation AFTER INSERT ON public.care_circle_members FOR EACH ROW EXECUTE FUNCTION notify_circle_invitation();
CREATE TRIGGER trg_messages_bump AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION bump_conversation_last_message();
CREATE TRIGGER trg_guard_professional_publish BEFORE UPDATE ON public.professional_profiles FOR EACH ROW EXECUTE FUNCTION guard_professional_publish();
CREATE TRIGGER trg_guard_professional_trust_fields BEFORE UPDATE ON public.professional_profiles FOR EACH ROW EXECUTE FUNCTION guard_professional_trust_fields();
CREATE TRIGGER trg_pro_guard_publish BEFORE UPDATE ON public.professional_profiles FOR EACH ROW EXECUTE FUNCTION guard_professional_publish();
CREATE TRIGGER trg_profile_free_sub AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION assign_free_subscription();
CREATE TRIGGER trg_ratings_refresh_avg AFTER INSERT OR DELETE OR UPDATE ON public.ratings FOR EACH ROW EXECUTE FUNCTION refresh_pro_avg_rating();
CREATE TRIGGER trg_guard_booking_integrity BEFORE INSERT OR UPDATE ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_integrity();
CREATE TRIGGER trg_guard_service_bookings_financials BEFORE UPDATE ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION guard_service_bookings_financials();
CREATE TRIGGER trg_notify_booking_cancelled AFTER UPDATE OF status ON public.service_bookings FOR EACH ROW WHEN (((new.status = 'cancelled'::text) AND (old.status IS DISTINCT FROM 'cancelled'::text))) EXECUTE FUNCTION notify_booking_cancelled();
CREATE TRIGGER trg_sb_compute_fee BEFORE INSERT OR UPDATE OF total_amount, platform_fee_pct ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION compute_platform_fee();
CREATE TRIGGER trg_validate_rating_dimensions BEFORE INSERT ON public.service_rating_dimensions FOR EACH ROW EXECUTE FUNCTION validate_rating_dimensions();
