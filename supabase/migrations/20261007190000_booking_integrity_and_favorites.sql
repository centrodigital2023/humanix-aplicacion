-- 1) Integridad de reservas: sin auto-contratación, sin doble reserva, transiciones válidas.
CREATE OR REPLACE FUNCTION public.guard_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end timestamptz;
BEGIN
  IF NEW.client_id = NEW.professional_id THEN
    RAISE EXCEPTION 'No puedes contratarte a ti mismo' USING ERRCODE = '23514';
  END IF;

  -- Máquina de estados (el staff puede corregir cualquier estado).
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

  -- Doble reserva del mismo profesional.
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
$$;
REVOKE EXECUTE ON FUNCTION public.guard_booking_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_integrity ON public.service_bookings;
CREATE TRIGGER trg_guard_booking_integrity
  BEFORE INSERT OR UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_integrity();

-- 2) Aceptar una propuesta de horario de forma atómica y autorizada.
--    Solo la parte que RECIBE la propuesta puede aceptarla; precio y comisión se
--    calculan en el servidor. Corrige: el profesional no podía aceptar propuestas
--    de la familia (RLS exigía client_id = auth.uid()) y el proponente podía
--    aceptar su propia propuesta.
CREATE OR REPLACE FUNCTION public.accept_slot_proposal(p_proposal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.accept_slot_proposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_slot_proposal(uuid) TO authenticated;

-- 3) Favoritos de confianza (professional_bookmarks apunta a profiles(id) y no es usable
--    con auth.uid(); esta tabla usa los ids de auth.users).
CREATE TABLE IF NOT EXISTS public.care_favorites (
  client_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, professional_id),
  CHECK (client_id <> professional_id)
);
ALTER TABLE public.care_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS care_favorites_own ON public.care_favorites;
CREATE POLICY care_favorites_own ON public.care_favorites
  FOR ALL USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);
