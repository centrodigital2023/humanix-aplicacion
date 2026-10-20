-- Respuestas y reportes de calificaciones: habilita `respond_to_rating` y `flag_rating` (los llama `RatingList`) sobre
-- `service_ratings`, la tabla de calificaciones que la app ya usa en producción. Reemplaza
-- 20260605200000_ratings_bidirectional.sql, que nunca se aplicó y no puede aplicarse: crea otra `ratings` con columnas que
-- chocan con la de producción, referencia `public.bookings` (no existe) y modera con `profiles.role` (los roles viven en
-- `user_roles`). Sus RPC eran SECURITY DEFINER sin search_path y `flag_rating` dejaba a cualquiera marcar cualquier reseña.
--
-- Y cierra dos fallas de producción que esta pieza necesita cerradas, porque las calificaciones alimentan el promedio y la
-- confianza (`hx_trust_calc`, `social-trust-score`):
--   1. `service_ratings_insert_rater` solo exige `rater_id = auth.uid()`: cualquier cuenta podía calificar a cualquier
--      persona con un `booking_id` inventado. Ahora solo califican las dos partes de un servicio COMPLETADO, una a la otra
--      (lo mismo que ya exige `validate_rating_dimensions` para las dimensiones).
--   2. `service_ratings_update_self` deja al autor cambiar cualquier columna: tras calificar podía mover la reseña a otra
--      persona u otro servicio. Ahora la reserva, el autor y el calificado no cambian; el autor sí puede corregir sus
--      estrellas y su comentario, como hasta hoy.
-- Moderación: un reporte no oculta nada (si no, el profesional escondería sus reseñas malas); el personal decide con
-- `moderate_rating`: se mantiene, o se retira (se borra, y queda en audit_log), así sale de todos los promedios. Idempotente.

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_ratings
  ADD COLUMN IF NOT EXISTS response_text  text,
  ADD COLUMN IF NOT EXISTS response_at    timestamptz,
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS flagged_reason text,
  ADD COLUMN IF NOT EXISTS flagged_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flagged_at     timestamptz,
  ADD COLUMN IF NOT EXISTS moderated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at   timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_ratings_status_check') THEN
    ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_status_check CHECK (status IN ('published', 'flagged'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_ratings_response_len') THEN
    ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_response_len
      CHECK (response_text IS NULL OR char_length(response_text) BETWEEN 1 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_ratings_flag_len') THEN
    ALTER TABLE public.service_ratings ADD CONSTRAINT service_ratings_flag_len
      CHECK (flagged_reason IS NULL OR char_length(flagged_reason) <= 300);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_service_ratings_flagged ON public.service_ratings (flagged_at) WHERE status = 'flagged';

-- ─── 2. Quién califica a quién ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hx_can_rate(p_booking uuid, p_rated uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND auth.uid() <> p_rated AND EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.id = p_booking AND b.status::text = 'completed'
       AND ((b.client_id = auth.uid() AND b.professional_id = p_rated)
         OR (b.professional_id = auth.uid() AND b.client_id = p_rated)))
$$;
REVOKE ALL ON FUNCTION public.hx_can_rate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_can_rate(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS service_ratings_insert_rater ON public.service_ratings;
CREATE POLICY service_ratings_insert_rater ON public.service_ratings FOR INSERT TO authenticated
  WITH CHECK (rater_id = auth.uid() AND public.hx_can_rate(booking_id, rated_id));

-- ─── 3. Lo que el navegador no escribe ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_service_ratings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR current_setting('hx.rating_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'published';
    NEW.response_text := NULL; NEW.response_at := NULL;
    NEW.flagged_reason := NULL; NEW.flagged_by := NULL; NEW.flagged_at := NULL;
    NEW.moderated_by := NULL; NEW.moderated_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  NEW.booking_id     := OLD.booking_id;
  NEW.rater_id       := OLD.rater_id;
  NEW.rated_id       := OLD.rated_id;
  NEW.created_at     := OLD.created_at;
  NEW.response_text  := OLD.response_text;
  NEW.response_at    := OLD.response_at;
  NEW.status         := OLD.status;
  NEW.flagged_reason := OLD.flagged_reason;
  NEW.flagged_by     := OLD.flagged_by;
  NEW.flagged_at     := OLD.flagged_at;
  NEW.moderated_by   := OLD.moderated_by;
  NEW.moderated_at   := OLD.moderated_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_service_ratings() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_service_ratings ON public.service_ratings;
CREATE TRIGGER trg_guard_service_ratings BEFORE INSERT OR UPDATE ON public.service_ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_ratings();

-- ─── 4. Responder (una vez, solo el calificado) ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_to_rating(p_rating_id uuid, p_response text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text := btrim(coalesce(p_response, ''));
  v_n    integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión' USING ERRCODE = '42501'; END IF;
  IF char_length(v_text) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'La respuesta debe tener entre 1 y 300 caracteres' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('hx.rating_rpc', 'on', true);
  UPDATE public.service_ratings SET response_text = v_text, response_at = now()
   WHERE id = p_rating_id AND rated_id = auth.uid() AND response_text IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('hx.rating_rpc', 'off', true);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No autorizado o la calificación ya tiene respuesta' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.respond_to_rating(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_rating(uuid, text) TO authenticated, service_role;

-- ─── 5. Reportar (el calificado) y moderar (el personal) ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.flag_rating(p_rating_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('hx.rating_rpc', 'on', true);
  UPDATE public.service_ratings
     SET status = 'flagged', flagged_by = auth.uid(), flagged_at = now(),
         flagged_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300)
   WHERE id = p_rating_id AND rated_id = auth.uid() AND status = 'published' AND moderated_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('hx.rating_rpc', 'off', true);
  IF v_n = 0 AND NOT EXISTS (SELECT 1 FROM public.service_ratings WHERE id = p_rating_id AND rated_id = auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.flag_rating(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_rating(uuid, text) TO authenticated, service_role;

-- p_keep = true: la reseña se queda (y ya no se puede volver a reportar). false: se retira (borrado + audit_log).
CREATE OR REPLACE FUNCTION public.moderate_rating(p_rating_id uuid, p_keep boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.service_ratings;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Solo el personal modera reseñas' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.service_ratings WHERE id = p_rating_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La reseña no existe' USING ERRCODE = 'P0002'; END IF;
  IF p_keep THEN
    PERFORM set_config('hx.rating_rpc', 'on', true);
    UPDATE public.service_ratings SET status = 'published', moderated_by = auth.uid(), moderated_at = now() WHERE id = p_rating_id;
    PERFORM set_config('hx.rating_rpc', 'off', true);
  ELSE
    DELETE FROM public.service_rating_dimensions WHERE booking_id = r.booking_id AND rater_id = r.rater_id;
    DELETE FROM public.service_ratings WHERE id = p_rating_id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, resource_type, resource_id, severity, meta)
  VALUES (auth.uid(), CASE WHEN p_keep THEN 'rating_kept' ELSE 'rating_removed' END, 'service_rating', p_rating_id::text,
          CASE WHEN p_keep THEN 'info' ELSE 'warning' END,
          jsonb_build_object('note', left(p_note, 500), 'booking_id', r.booking_id, 'rater_id', r.rater_id, 'rated_id', r.rated_id,
                             'stars', r.stars, 'comment', r.comment, 'flagged_reason', r.flagged_reason));
END $$;
REVOKE ALL ON FUNCTION public.moderate_rating(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_rating(uuid, boolean, text) TO authenticated, service_role;
