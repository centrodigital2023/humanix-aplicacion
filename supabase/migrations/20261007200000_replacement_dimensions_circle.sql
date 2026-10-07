-- ═══ 1) Reemplazo cuando un profesional cancela ═══════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_booking_cancelled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.notify_booking_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_booking_cancelled ON public.service_bookings;
CREATE TRIGGER trg_notify_booking_cancelled
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.notify_booking_cancelled();

CREATE OR REPLACE FUNCTION public.find_replacement_candidates(p_booking_id uuid)
RETURNS TABLE (
  user_id uuid, full_name text, avatar_url text, specialty text,
  hourly_rate integer, avg_rating numeric, total_jobs integer, is_favorite boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.find_replacement_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_replacement_candidates(uuid) TO authenticated;

-- ═══ 2) Calificación por dimensiones (bilateral, ligada a un servicio completado) ═
CREATE TABLE IF NOT EXISTS public.service_rating_dimensions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  rater_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rated_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rater_role  text NOT NULL CHECK (rater_role IN ('family','professional')),
  scores      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id)
);
CREATE INDEX IF NOT EXISTS idx_srd_rated ON public.service_rating_dimensions (rated_id, rater_role);
ALTER TABLE public.service_rating_dimensions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_rating_dimensions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.validate_rating_dimensions() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_validate_rating_dimensions ON public.service_rating_dimensions;
CREATE TRIGGER trg_validate_rating_dimensions
  BEFORE INSERT ON public.service_rating_dimensions
  FOR EACH ROW EXECUTE FUNCTION public.validate_rating_dimensions();

DROP POLICY IF EXISTS srd_insert_own ON public.service_rating_dimensions;
CREATE POLICY srd_insert_own ON public.service_rating_dimensions
  FOR INSERT WITH CHECK (auth.uid() = rater_id);
DROP POLICY IF EXISTS srd_select_involved ON public.service_rating_dimensions;
CREATE POLICY srd_select_involved ON public.service_rating_dimensions
  FOR SELECT USING (auth.uid() IN (rater_id, rated_id) OR public.is_staff(auth.uid()));

-- Promedios públicos por dimensión. No se muestran con menos de 3 calificaciones.
CREATE OR REPLACE FUNCTION public.professional_dimension_averages(p_user uuid)
RETURNS TABLE (dimension text, average numeric, ratings integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.key, ROUND(AVG((d.value)::numeric), 2), COUNT(*)::integer
  FROM public.service_rating_dimensions r,
       LATERAL jsonb_each_text(r.scores) AS d(key, value)
  WHERE r.rated_id = p_user AND r.rater_role = 'family'
  GROUP BY d.key
  HAVING COUNT(*) >= 3;
$$;
GRANT EXECUTE ON FUNCTION public.professional_dimension_averages(uuid) TO anon, authenticated;

-- ═══ 3) Círculo de cuidado con familiares ════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.care_circle_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email      text NOT NULL,
  member_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  relation           text,
  can_view_services  boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_circle_owner_email
  ON public.care_circle_members (owner_id, lower(invited_email));
ALTER TABLE public.care_circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ccm_owner_select ON public.care_circle_members;
CREATE POLICY ccm_owner_select ON public.care_circle_members
  FOR SELECT USING (
    auth.uid() = owner_id
    OR auth.uid() = member_id
    OR lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
DROP POLICY IF EXISTS ccm_owner_insert ON public.care_circle_members;
CREATE POLICY ccm_owner_insert ON public.care_circle_members
  FOR INSERT WITH CHECK (auth.uid() = owner_id AND status = 'invited' AND member_id IS NULL);
DROP POLICY IF EXISTS ccm_owner_delete ON public.care_circle_members;
CREATE POLICY ccm_owner_delete ON public.care_circle_members
  FOR DELETE USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.respond_circle_invitation(p_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.respond_circle_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_circle_invitation(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_circle_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.notify_circle_invitation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_circle_invitation ON public.care_circle_members;
CREATE TRIGGER trg_notify_circle_invitation
  AFTER INSERT ON public.care_circle_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_circle_invitation();

-- Los miembros aceptados pueden VER (no modificar) los servicios del titular.
DROP POLICY IF EXISTS bookings_select_circle ON public.service_bookings;
CREATE POLICY bookings_select_circle ON public.service_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.care_circle_members m
      WHERE m.owner_id = service_bookings.client_id
        AND m.member_id = auth.uid()
        AND m.status = 'accepted'
        AND m.can_view_services
    )
  );
