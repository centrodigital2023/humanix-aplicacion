-- Reglas de quién mueve un turno (auditoría de punta a punta, 6 nov 2026). Idempotente. Va después de 20261106100000.
--
-- La política RLS `bookings_update_involved` deja que cualquiera de las dos partes actualice la fila y
-- `bookings_insert_client` deja que la familia la cree con las columnas que quiera. Las reglas de dinero ya las cuidan
-- los disparadores (guard_service_bookings_financials, hx_booking_commission), pero quedaban tres huecos:
--
--  1. Al CREAR el turno desde el navegador se podía mandar `paid_at` (el turno aparecía «🔒 Pago protegido» sin que
--     nadie hubiera pagado: el profesional trabajaba creyendo que el dinero estaba guardado) o un estado ya avanzado
--     (`completed`, `in_progress`…), con lo que se fabricaban turnos «terminados» que bajan el escalón de comisión del
--     profesional y alimentan reseñas y reputación. Ahora quien crea desde el navegador solo crea «pending» (o
--     «confirmed» desde las funciones de aceptar propuesta/postulación) y nunca con datos de pago o de avance.
--  2. La familia podía aceptar su propio pedido (pending → confirmed) o marcar «en camino» / «cuidando» por el
--     profesional. Ahora solo el profesional acepta, sale y empieza. Terminar y cancelar lo pueden hacer los dos (la
--     familia confirma el final; «Cuidando» no se cancela, ver hx_guard_cancel_in_progress).
--  3. Cualquiera de las partes podía cambiar la hora (`scheduled_at`) o la duración sin pasar por la propuesta de nueva
--     hora. Ahora la hora solo cambia cuando la otra parte acepta una propuesta abierta (hx_answer_reschedule) y la
--     duración no se cambia desde el navegador.
--
-- Además, la exoneración del primer turno (hasta $30.000) se aplicaba a TODOS los turnos que una pareja pidiera antes
-- de terminar el primero. Ahora se aplica una sola vez por pareja: si ya hay otro turno de la pareja sin cancelar que
-- la usó, el nuevo paga comisión normal. Espejo en src/lib/commissionMatrix.ts (`commissionQuote`).
--
-- El personal (is_staff) y el servidor (sin sesión: service_role, pg_cron) no tienen estas restricciones.

-- ─── 1) Crear un turno ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_guard_booking_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN RETURN NEW; END IF;
  -- accept_slot_proposal y accept_application crean el turno ya aceptado; desde el navegador siempre empieza «pending».
  IF NEW.status IS DISTINCT FROM 'pending' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
    NEW.status := 'pending';
  END IF;
  NEW.paid_at := NULL;
  NEW.charge_id := NULL;
  NEW.completed_at := NULL;
  NEW.started_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hx_guard_booking_insert() FROM PUBLIC, anon, authenticated;

-- «trg_guard_booking_insert» corre antes de trg_guard_booking_integrity y de trg_sb_* (orden alfabético).
DROP TRIGGER IF EXISTS trg_guard_booking_insert ON public.service_bookings;
CREATE TRIGGER trg_guard_booking_insert BEFORE INSERT ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_guard_booking_insert();

-- ─── 2) y 3) Quién avanza el turno y quién cambia la hora ────────────────────

CREATE OR REPLACE FUNCTION public.hx_guard_booking_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.is_staff(v_uid) THEN RETURN NEW; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('confirmed', 'in_route', 'in_progress')
     AND v_uid IS DISTINCT FROM OLD.professional_id THEN
    RAISE EXCEPTION '%', CASE NEW.status
        WHEN 'confirmed' THEN 'Solo el profesional puede aceptar este turno.'
        ELSE 'Solo el profesional puede marcar que va en camino o que empezó el turno.' END
      USING ERRCODE = '42501', HINT = 'booking_actor';
  END IF;

  IF NEW.duration_hours IS DISTINCT FROM OLD.duration_hours THEN
    RAISE EXCEPTION 'La duración del turno no se puede cambiar. Cancélalo y pide uno nuevo.'
      USING ERRCODE = '42501', HINT = 'booking_actor';
  END IF;

  -- La nueva hora solo entra cuando la otra parte acepta una propuesta abierta con esa misma hora.
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NOT EXISTS (
       SELECT 1 FROM public.booking_reschedule_requests r
        WHERE r.booking_id = OLD.id AND r.status = 'pending'
          AND r.proposed_at = NEW.scheduled_at AND r.requested_by IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'Para cambiar la hora, propón una nueva y espera que la otra parte la acepte.'
      USING ERRCODE = '42501', HINT = 'booking_actor';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hx_guard_booking_actor() FROM PUBLIC, anon, authenticated;

-- «trg_guard_booking_actor» corre antes de trg_guard_booking_integrity y del resto (orden alfabético).
DROP TRIGGER IF EXISTS trg_guard_booking_actor ON public.service_bookings;
CREATE TRIGGER trg_guard_booking_actor BEFORE UPDATE OF status, scheduled_at, duration_hours ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.hx_guard_booking_actor();

-- ─── 4) Primer turno exonerado: una sola vez por pareja ──────────────────────

CREATE OR REPLACE FUNCTION public.hx_first_shift_exempt(p_professional uuid, p_client uuid, p_fee integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_client IS NULL OR p_fee IS NULL OR p_fee <= 0 THEN 0
    WHEN EXISTS (SELECT 1 FROM public.service_bookings b
                  WHERE b.professional_id = p_professional AND b.client_id = p_client AND b.status = 'completed') THEN 0
    -- Otro turno de la pareja, aún abierto, ya usó la exoneración.
    WHEN EXISTS (SELECT 1 FROM public.service_bookings b
                  WHERE b.professional_id = p_professional AND b.client_id = p_client
                    AND b.status <> 'cancelled' AND COALESCE(b.commission_exempt_cop, 0) > 0) THEN 0
    WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_client AND u.created_at >= now() - interval '90 days') THEN 0
    ELSE LEAST(p_fee, 30000)
  END;
$$;
-- Igual que 20261104150000: solo la usan disparadores y funciones del servidor.
REVOKE ALL ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) TO service_role;
