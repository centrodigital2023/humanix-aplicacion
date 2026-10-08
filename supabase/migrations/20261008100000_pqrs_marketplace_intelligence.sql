-- ═══════════════════════════════════════════════════════════════════════════
-- PQRS con intake seguro + inteligencia de mercado para superadmin
-- ═══════════════════════════════════════════════════════════════════════════

-- Utilidad: clave de ciudad sin tildes ni «D.C.» (misma lógica que cityKey() en el cliente).
CREATE OR REPLACE FUNCTION public.city_key(p_city text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    btrim(regexp_replace(
      lower(translate(coalesce(p_city, ''), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN')),
      '[^a-z0-9]+', ' ', 'g'
    )),
    '( d c| dc| distrito capital)$', '', 'g'
  ));
$$;

-- ─── 1) PQRS: el INSERT público deja de ser directo ──────────────────────────
-- Con WITH CHECK (user_id IS NULL) cualquiera podía insertar tickets con estado,
-- prioridad, resolución o asignación forjados y sin límite de frecuencia. Ahora el
-- único camino es la función pqrs-intake (service role), que valida y limita.
DROP POLICY IF EXISTS pqrs_insert_anyone ON public.pqrs_tickets;
DROP POLICY IF EXISTS pqrs_insert_authenticated_self ON public.pqrs_tickets;
DROP POLICY IF EXISTS pqrs_insert_anonymous ON public.pqrs_tickets;

ALTER TABLE public.pqrs_tickets
  ADD COLUMN IF NOT EXISTS radicado text,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS safety_level text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS safety_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.pqrs_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_reply_draft text,
  ADD COLUMN IF NOT EXISTS reply_draft_edited boolean,
  ADD COLUMN IF NOT EXISTS consent_data_processing boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pqrs_tickets_safety_level_check'
  ) THEN
    ALTER TABLE public.pqrs_tickets
      ADD CONSTRAINT pqrs_tickets_safety_level_check CHECK (safety_level IN ('none', 'review', 'critical'));
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.pqrs_radicado_seq;

-- Radicado para tickets existentes (los anteriores a esta migración).
UPDATE public.pqrs_tickets
   SET radicado = 'PQRS-' || to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
                  || lpad(nextval('public.pqrs_radicado_seq')::text, 6, '0')
 WHERE radicado IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pqrs_radicado ON public.pqrs_tickets (radicado) WHERE radicado IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pqrs_status_due ON public.pqrs_tickets (status, due_at);
CREATE INDEX IF NOT EXISTS idx_pqrs_contact_email ON public.pqrs_tickets (lower(contact_email));

CREATE OR REPLACE FUNCTION public.pqrs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.radicado IS NULL THEN
    NEW.radicado := 'PQRS-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
                    || lpad(nextval('public.pqrs_radicado_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pqrs_before_insert ON public.pqrs_tickets;
CREATE TRIGGER trg_pqrs_before_insert
  BEFORE INSERT ON public.pqrs_tickets
  FOR EACH ROW EXECUTE FUNCTION public.pqrs_before_insert();

-- Bitácora inmutable de cada ticket (quién asignó, cambió el estado, fusionó o respondió).
CREATE TABLE IF NOT EXISTS public.pqrs_ticket_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.pqrs_tickets(id) ON DELETE CASCADE,
  actor_id    uuid,
  event_type  text NOT NULL,
  from_value  text,
  to_value    text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pqrs_events_ticket ON public.pqrs_ticket_events (ticket_id, created_at DESC);
ALTER TABLE public.pqrs_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqrs_events_staff_read ON public.pqrs_ticket_events;
CREATE POLICY pqrs_events_staff_read ON public.pqrs_ticket_events
  FOR SELECT USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.pqrs_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
    INSERT INTO public.pqrs_ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    VALUES (NEW.id, v_actor, 'assigned', OLD.assigned_to::text, NEW.assigned_to::text);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.pqrs_ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    VALUES (NEW.id, v_actor, 'status_changed', OLD.status, NEW.status);
    IF NEW.status IN ('resolved', 'closed') AND NEW.resolved_at IS NULL THEN
      NEW.resolved_at := now();
    ELSIF NEW.status IN ('open', 'in_progress') THEN
      NEW.resolved_at := NULL;
    END IF;
  END IF;

  -- Primera acción del equipo: el ticket pasa de «abierto» o se guarda una respuesta.
  IF NEW.first_response_at IS NULL AND (
       (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('in_progress', 'resolved', 'closed'))
    OR (NEW.resolution IS DISTINCT FROM OLD.resolution AND btrim(coalesce(NEW.resolution, '')) <> '')
  ) THEN
    NEW.first_response_at := now();
  END IF;

  IF NEW.duplicate_of IS DISTINCT FROM OLD.duplicate_of AND NEW.duplicate_of IS NOT NULL THEN
    INSERT INTO public.pqrs_ticket_events (ticket_id, actor_id, event_type, to_value)
    VALUES (NEW.id, v_actor, 'merged', NEW.duplicate_of::text);
  END IF;

  IF NEW.resolution IS DISTINCT FROM OLD.resolution AND btrim(coalesce(NEW.resolution, '')) <> '' THEN
    INSERT INTO public.pqrs_ticket_events (ticket_id, actor_id, event_type, meta)
    VALUES (NEW.id, v_actor, 'resolution_saved',
            jsonb_build_object('draft_used', NEW.ai_reply_draft IS NOT NULL, 'draft_edited', NEW.reply_draft_edited));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pqrs_before_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pqrs_before_update ON public.pqrs_tickets;
CREATE TRIGGER trg_pqrs_before_update
  BEFORE UPDATE ON public.pqrs_tickets
  FOR EACH ROW EXECUTE FUNCTION public.pqrs_before_update();

-- Límite de frecuencia del formulario público. Solo hashes: nunca IP ni correo en claro.
CREATE TABLE IF NOT EXISTS public.pqrs_intake_attempts (
  id            bigserial PRIMARY KEY,
  ip_hash       text NOT NULL,
  contact_hash  text,
  action        text NOT NULL DEFAULT 'create',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pqrs_attempts_ip ON public.pqrs_intake_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_attempts_contact ON public.pqrs_intake_attempts (contact_hash, created_at DESC);
ALTER TABLE public.pqrs_intake_attempts ENABLE ROW LEVEL SECURITY; -- sin políticas: solo service role

-- ─── 2) Mercado: ofertas bloqueadas dejan de verse ───────────────────────────
-- El flag `blocked` solo se respetaba en la página de detalle; el listado /buscar
-- seguía mostrando las ofertas bloqueadas.
DROP POLICY IF EXISTS "offers_select_open_authenticated_or_owner" ON public.job_offers;
CREATE POLICY "offers_select_open_authenticated_or_owner"
  ON public.job_offers
  FOR SELECT
  TO authenticated
  USING (
    (status = 'open'::public.offer_status AND NOT COALESCE(blocked, false))
    OR posted_by = auth.uid()
    OR public.is_staff(auth.uid())
  );

-- ─── 3) RPCs de inteligencia de mercado (solo staff) ─────────────────────────

-- Oferta (ofertas abiertas) vs. demanda (profesionales disponibles) por ciudad.
CREATE OR REPLACE FUNCTION public.marketplace_city_balance()
RETURNS TABLE (
  city_key text,
  city_label text,
  open_offers integer,
  offers_30d integer,
  professionals_published integer,
  professionals_available integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH offers AS (
    SELECT public.city_key(o.city) AS k,
           MIN(o.city) AS label,
           COUNT(*) FILTER (WHERE o.status = 'open' AND NOT COALESCE(o.blocked, false)) AS open_n,
           COUNT(*) FILTER (WHERE o.created_at > now() - interval '30 days') AS recent_n
    FROM public.job_offers o
    GROUP BY 1
  ),
  pros AS (
    SELECT s.k,
           COUNT(DISTINCT s.uid) AS published_n,
           COUNT(DISTINCT s.uid) FILTER (WHERE s.avail) AS available_n
    FROM (
      SELECT pp.user_id AS uid,
             public.city_key(c) AS k,
             (pp.available AND pp.active) AS avail
      FROM public.professional_profiles pp
      CROSS JOIN LATERAL unnest(
        array_remove(array_cat(coalesce(pp.service_cities, '{}'::text[]), ARRAY[pp.home_city]), NULL)
      ) AS c
      WHERE pp.published AND NOT COALESCE(pp.blocked, false)
    ) s
    GROUP BY s.k
  )
  SELECT COALESCE(o.k, p.k),
         COALESCE(o.label, initcap(p.k)),
         COALESCE(o.open_n, 0)::integer,
         COALESCE(o.recent_n, 0)::integer,
         COALESCE(p.published_n, 0)::integer,
         COALESCE(p.available_n, 0)::integer
  FROM offers o
  FULL OUTER JOIN pros p ON p.k = o.k
  WHERE COALESCE(o.k, p.k) <> ''
  ORDER BY 3 DESC, 6 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.marketplace_city_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_city_balance() TO authenticated;

-- Profesionales sugeridos para una oferta: similitud semántica (si la oferta tiene embedding)
-- combinada con reglas (especialidad, zona, disponibilidad, RETHUS, calificación).
-- Devuelve nombres y señales, no solo identificadores, para poder explicar cada sugerencia.
CREATE OR REPLACE FUNCTION public.suggest_professionals_for_offer(p_offer_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  specialty text,
  home_city text,
  hourly_rate integer,
  avg_rating numeric,
  total_jobs integer,
  rethus_verified boolean,
  available boolean,
  matches_specialty boolean,
  serves_city boolean,
  similarity double precision,
  rule_score integer,
  final_score integer,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  o     public.job_offers%ROWTYPE;
  v_key text;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oferta no encontrada';
  END IF;
  v_key := public.city_key(o.city);

  RETURN QUERY
  WITH sem AS (
    SELECT m.user_id AS uid, m.similarity AS sim
    FROM public.match_professionals_for_offer(p_offer_id, 100, 0.0) m
  ),
  cand AS (
    SELECT pp.user_id AS uid,
           pr.full_name AS fname,
           COALESCE(pp.avatar_url, pr.avatar_url) AS av,
           pp.specialty AS spec,
           pp.sub_specialties AS subspec,
           pp.home_city AS hcity,
           pp.service_cities AS scities,
           pp.hourly_rate AS rate,
           pp.avg_rating AS rating,
           pp.total_jobs AS jobs,
           COALESCE(pp.rethus_verified, false) AS rethus,
           COALESCE(pp.available, false) AS avail,
           sem.sim
    FROM public.professional_profiles pp
    JOIN public.profiles pr ON pr.user_id = pp.user_id
    LEFT JOIN sem ON sem.uid = pp.user_id
    WHERE pp.published AND pp.active AND NOT COALESCE(pp.blocked, false)
  ),
  flagged AS (
    SELECT c.*,
           COALESCE(o.specialty_required IS NOT NULL AND btrim(o.specialty_required) <> '' AND (
              COALESCE(c.spec ILIKE '%' || o.specialty_required || '%', false)
              OR EXISTS (
                SELECT 1 FROM unnest(coalesce(c.subspec, '{}'::text[])) x
                WHERE x ILIKE '%' || o.specialty_required || '%'
              )
           ), false) AS spec_ok,
           COALESCE(v_key <> '' AND (
              public.city_key(c.hcity) = v_key
              OR EXISTS (SELECT 1 FROM unnest(coalesce(c.scities, '{}'::text[])) x WHERE public.city_key(x) = v_key)
           ), false) AS city_ok
    FROM cand c
  ),
  scored AS (
    SELECT f.*,
           (CASE WHEN f.spec_ok THEN 40 ELSE 0 END
            + CASE WHEN f.city_ok THEN 25 ELSE 0 END
            + CASE WHEN f.avail THEN 10 ELSE 0 END
            + CASE WHEN f.rethus THEN 10 ELSE 0 END
            + LEAST(10, ROUND(COALESCE(f.rating, 0) * 2))::integer) AS rscore
    FROM flagged f
  )
  SELECT s.uid, s.fname, s.av, s.spec, s.hcity, s.rate, s.rating, s.jobs, s.rethus, s.avail,
         s.spec_ok, s.city_ok, s.sim, s.rscore,
         LEAST(100, ROUND(s.rscore * 0.6 + COALESCE(s.sim, 0) * 100 * 0.4))::integer,
         CASE WHEN s.sim IS NOT NULL THEN 'embedding+reglas' ELSE 'reglas' END
  FROM scored s
  WHERE s.rscore >= 25 OR COALESCE(s.sim, 0) >= 0.5
  ORDER BY 15 DESC, s.rating DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 25));
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_professionals_for_offer(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_professionals_for_offer(uuid, integer) TO authenticated;

-- Invitar a profesionales sugeridos: notificación interna, sin repetir ni saturar.
CREATE OR REPLACE FUNCTION public.invite_matching_professionals(p_offer_id uuid, p_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o       public.job_offers%ROWTYPE;
  v_id    uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oferta no encontrada';
  END IF;
  IF o.status <> 'open' OR COALESCE(o.blocked, false) THEN
    RAISE EXCEPTION 'La oferta no está disponible para invitaciones';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL OR array_length(p_user_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Invita entre 1 y 10 profesionales';
  END IF;

  FOREACH v_id IN ARRAY p_user_ids LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.professional_profiles pp
      WHERE pp.user_id = v_id AND pp.published AND pp.active AND NOT COALESCE(pp.blocked, false)
    );
    -- No repetir la invitación para la misma oferta.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = v_id AND n.type = 'offer_invite' AND n.meta ->> 'offer_id' = p_offer_id::text
    );
    -- No saturar: máximo 3 invitaciones por profesional cada 24 h.
    CONTINUE WHEN (
      SELECT COUNT(*) FROM public.notifications n
      WHERE n.user_id = v_id AND n.type = 'offer_invite' AND n.created_at > now() - interval '24 hours'
    ) >= 3;

    INSERT INTO public.notifications (user_id, type, title, body, link, meta)
    VALUES (
      v_id, 'offer_invite', 'Una oferta encaja con tu perfil',
      o.title || ' · ' || o.city || ' · $' || to_char(o.amount, 'FM999G999G999'),
      '/oferta/' || o.id::text,
      jsonb_build_object('offer_id', p_offer_id, 'source', 'staff_match')
    );
    v_count := v_count + 1;
  END LOOP;

  PERFORM public.log_audit('offer.invite', 'job_offers', p_offer_id::text, 'info', jsonb_build_object('invited', v_count));
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.invite_matching_professionals(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_matching_professionals(uuid, uuid[]) TO authenticated;

-- Moderación de ofertas con motivo, aviso al autor y auditoría.
CREATE OR REPLACE FUNCTION public.moderate_offer(p_offer_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.job_offers%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'hr_staff')) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oferta no encontrada';
  END IF;

  IF p_action = 'block' THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
      RAISE EXCEPTION 'Indica el motivo del bloqueo (mínimo 5 caracteres)';
    END IF;
    UPDATE public.job_offers
       SET blocked = true, blocked_reason = left(btrim(p_reason), 500), blocked_at = now(), blocked_by = auth.uid()
     WHERE id = p_offer_id;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (o.posted_by, 'offer_blocked', 'Tu oferta fue retirada para revisión',
            'Motivo: ' || left(btrim(p_reason), 300) || '. Escríbenos desde Contacto indicando el título de la oferta.', '/contacto');
    PERFORM public.log_audit('offer.block', 'job_offers', p_offer_id::text, 'warn', jsonb_build_object('reason', left(btrim(p_reason), 200)));
  ELSIF p_action = 'unblock' THEN
    UPDATE public.job_offers
       SET blocked = false, blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL
     WHERE id = p_offer_id;
    PERFORM public.log_audit('offer.unblock', 'job_offers', p_offer_id::text, 'info', '{}'::jsonb);
  ELSIF p_action = 'close' THEN
    UPDATE public.job_offers SET status = 'closed' WHERE id = p_offer_id;
    PERFORM public.log_audit('offer.close', 'job_offers', p_offer_id::text, 'info', '{}'::jsonb);
  ELSE
    RAISE EXCEPTION 'Acción no válida';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_offer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_offer(uuid, text, text) TO authenticated;
