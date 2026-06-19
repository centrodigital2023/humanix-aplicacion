-- ══════════════════════════════════════════════════════════════════
-- Ratings bidireccional: familia→profesional, institución→profesional,
-- profesional→familia, profesional→institución.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ratings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id           UUID        REFERENCES public.bookings(id) ON DELETE SET NULL,
  stars                INTEGER     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment              TEXT        CHECK (char_length(comment) <= 300),
  is_anonymous         BOOLEAN     NOT NULL DEFAULT false,
  punctuality_stars    INTEGER     CHECK (punctuality_stars BETWEEN 1 AND 5),
  communication_stars  INTEGER     CHECK (communication_stars BETWEEN 1 AND 5),
  professionalism_stars INTEGER    CHECK (professionalism_stars BETWEEN 1 AND 5),
  response_text        TEXT        CHECK (char_length(response_text) <= 300),
  response_at          TIMESTAMPTZ,
  -- moderación
  status               TEXT        NOT NULL DEFAULT 'published'
                                   CHECK (status IN ('published', 'flagged', 'removed')),
  flagged_reason       TEXT,
  moderated_by         UUID        REFERENCES auth.users(id),
  moderated_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reviewer_id, reviewed_id, booking_id)
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS ratings_reviewed_id_idx  ON public.ratings (reviewed_id);
CREATE INDEX IF NOT EXISTS ratings_reviewer_id_idx  ON public.ratings (reviewer_id);
CREATE INDEX IF NOT EXISTS ratings_booking_id_idx   ON public.ratings (booking_id);
CREATE INDEX IF NOT EXISTS ratings_status_idx       ON public.ratings (status);
CREATE INDEX IF NOT EXISTS ratings_created_at_idx   ON public.ratings (created_at DESC);

-- ──────────────────────────────────────────────────────────────────
-- Vista materializada: resumen de calificaciones por usuario
-- ──────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_rating_summary AS
SELECT
  reviewed_id,
  COUNT(*)                                              AS total_reviews,
  ROUND(AVG(stars)::numeric, 1)                        AS avg_stars,
  ROUND(AVG(punctuality_stars)::numeric, 1)            AS avg_punctuality,
  ROUND(AVG(communication_stars)::numeric, 1)          AS avg_communication,
  ROUND(AVG(professionalism_stars)::numeric, 1)        AS avg_professionalism,
  COUNT(*) FILTER (WHERE stars = 5)                    AS five_star_count,
  COUNT(*) FILTER (WHERE stars = 4)                    AS four_star_count,
  COUNT(*) FILTER (WHERE stars = 3)                    AS three_star_count,
  COUNT(*) FILTER (WHERE stars = 2)                    AS two_star_count,
  COUNT(*) FILTER (WHERE stars = 1)                    AS one_star_count
FROM public.ratings
WHERE status = 'published'
GROUP BY reviewed_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS user_rating_summary_idx
  ON public.user_rating_summary (reviewed_id);

-- Función para refrescar la vista tras cada INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.refresh_user_rating_summary()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_rating_summary;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_rating_summary ON public.ratings;
CREATE TRIGGER trg_refresh_rating_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_user_rating_summary();

-- ──────────────────────────────────────────────────────────────────
-- RLS — Row Level Security
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Lectura: calificaciones publicadas son públicas
CREATE POLICY "ratings_read_published"
  ON public.ratings FOR SELECT
  USING (status = 'published');

-- Lectura: el propio revisor puede ver sus calificaciones (cualquier estado)
CREATE POLICY "ratings_read_own"
  ON public.ratings FOR SELECT
  USING (reviewer_id = auth.uid());

-- Inserción: solo usuarios autenticados pueden calificar
CREATE POLICY "ratings_insert"
  ON public.ratings FOR INSERT
  WITH CHECK (reviewer_id = auth.uid());

-- Actualización: solo el calificado puede añadir respuesta, o el revisor puede
-- actualizar si aún no hay respuesta (primeras 24h — lógica en app)
CREATE POLICY "ratings_update_response"
  ON public.ratings FOR UPDATE
  USING (
    reviewed_id = auth.uid()            -- el calificado responde
    OR reviewer_id = auth.uid()         -- el revisor puede editar (lógica en app)
    OR EXISTS (                         -- superadmin modera
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- Eliminación: solo superadmin
CREATE POLICY "ratings_delete_superadmin"
  ON public.ratings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- Función RPC: enviar respuesta a una calificación
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_to_rating(
  p_rating_id  UUID,
  p_response   TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF char_length(p_response) > 300 THEN
    RAISE EXCEPTION 'La respuesta no puede superar 300 caracteres';
  END IF;
  UPDATE public.ratings
  SET    response_text = p_response,
         response_at   = NOW()
  WHERE  id = p_rating_id
    AND  reviewed_id = auth.uid()
    AND  response_text IS NULL; -- solo 1 respuesta
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado o la calificación ya tiene respuesta';
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────
-- Función RPC: reportar una calificación
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.flag_rating(
  p_rating_id UUID,
  p_reason    TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.ratings
  SET    status        = 'flagged',
         flagged_reason = p_reason
  WHERE  id = p_rating_id;
END;
$$;
