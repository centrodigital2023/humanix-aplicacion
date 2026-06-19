-- ══════════════════════════════════════════════════════════════════
-- public_comments: comentarios de usuarios para la página de inicio,
-- con flujo de moderación por superadmin.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.public_comments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content          TEXT        NOT NULL CHECK (char_length(content) BETWEEN 10 AND 500),
  photo_url        TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT        CHECK (char_length(rejection_reason) <= 300),
  moderated_by     UUID        REFERENCES auth.users(id),
  moderated_at     TIMESTAMPTZ,
  show_in_homepage BOOLEAN     NOT NULL DEFAULT false,
  stars            INTEGER     CHECK (stars BETWEEN 1 AND 5),
  -- snapshot del autor al momento de publicar
  author_name      TEXT,
  author_role      TEXT        CHECK (author_role IN ('professional','family','institution')),
  author_city      TEXT,
  trust_score_snap INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS public_comments_user_id_idx    ON public.public_comments (user_id);
CREATE INDEX IF NOT EXISTS public_comments_status_idx     ON public.public_comments (status);
CREATE INDEX IF NOT EXISTS public_comments_homepage_idx   ON public.public_comments (show_in_homepage, created_at DESC)
  WHERE show_in_homepage = true;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_public_comments_updated_at ON public.public_comments;
CREATE TRIGGER trg_public_comments_updated_at
  BEFORE UPDATE ON public.public_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.public_comments ENABLE ROW LEVEL SECURITY;

-- Lectura homepage: solo aprobados
CREATE POLICY "comments_read_approved"
  ON public.public_comments FOR SELECT
  USING (status = 'approved' AND show_in_homepage = true);

-- Lectura propia: el usuario ve todos sus comentarios
CREATE POLICY "comments_read_own"
  ON public.public_comments FOR SELECT
  USING (user_id = auth.uid());

-- Lectura superadmin: ve todo
CREATE POLICY "comments_read_superadmin"
  ON public.public_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- Inserción: solo autenticados
CREATE POLICY "comments_insert"
  ON public.public_comments FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Actualización: autor puede editar solo si está pending
CREATE POLICY "comments_update_own_pending"
  ON public.public_comments FOR UPDATE
  USING (user_id = auth.uid() AND status = 'pending');

-- Actualización superadmin: puede aprobar/rechazar
CREATE POLICY "comments_update_superadmin"
  ON public.public_comments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- Eliminación: autor o superadmin
CREATE POLICY "comments_delete"
  ON public.public_comments FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- RPC: superadmin aprueba/rechaza comentario
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.moderate_comment(
  p_comment_id      UUID,
  p_action          TEXT,  -- 'approve' | 'reject'
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'superadmin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo superadmin puede moderar comentarios';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.public_comments
    SET    status           = 'approved',
           show_in_homepage = true,
           moderated_by     = auth.uid(),
           moderated_at     = NOW()
    WHERE  id = p_comment_id;
  ELSIF p_action = 'reject' THEN
    UPDATE public.public_comments
    SET    status           = 'rejected',
           show_in_homepage = false,
           rejection_reason = p_rejection_reason,
           moderated_by     = auth.uid(),
           moderated_at     = NOW()
    WHERE  id = p_comment_id;
  ELSE
    RAISE EXCEPTION 'Acción inválida: use approve o reject';
  END IF;
END;
$$;
