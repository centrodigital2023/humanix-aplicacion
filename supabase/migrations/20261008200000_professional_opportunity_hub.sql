-- ═══════════════════════════════════════════════════════════════════════════════
-- Hub de oportunidades del profesional
--   · Cierra la fuga de direcciones: ningún usuario autenticado puede leer family_needs ajenas.
--   · Lista segura de necesidades abiertas (sin dirección, nombre abreviado, notas sin datos de contacto).
--   · Desbloqueo auditado de dirección y WhatsApp (solo planes de pago, tras postularse, con cupo diario).
--   · Postulación a un turno (varias horas contiguas) y negociación acotada del valor.
--   · Reputación agregada de la familia para el profesional (mínimo 3 calificaciones).
--   · Alertas de oportunidades y notificaciones de propuestas.
-- Reglas del proyecto: tablas nuevas con GRANT + RLS en esta misma migración; roles solo en
-- public.user_roles (has_role / is_staff); estado del plan solo desde mp_subscriptions; los pagos
-- ocurren únicamente en la página web (los mensajes con datos de pago o contacto se rechazan).
-- Los espejos en TypeScript viven en src/lib/{opportunities,negotiation,familyReputation}.ts.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 0) Funciones puras ─────────────────────────────────────────────────────────

-- Misma lista y mismo orden que REDACTIONS en src/lib/opportunities.ts.
CREATE OR REPLACE FUNCTION public.redact_contact_info(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  t text := COALESCE(p_text, '');
BEGIN
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[contacto oculto]', 'g');
  t := regexp_replace(t, '(https?://|www\.)\S+', '[enlace oculto]', 'gi');
  t := regexp_replace(t, '(^|\s)@[A-Za-z0-9._]{3,}', '\1[contacto oculto]', 'g');
  t := regexp_replace(t, '\(\d{3}\)[ .-]?\d{3}[ .-]?\d{2,4}', '[contacto oculto]', 'g');
  t := regexp_replace(t, '\+?\d([ .-]?\d){6,}', '[contacto oculto]', 'g');
  t := regexp_replace(
    t,
    '(^|[^A-Za-z])(calle|cll|cl|carrera|cra|cr|kr|avenida|av|diagonal|diag|dg|transversal|tv|circular|autopista)\.?\s*\d+[a-z]?(\s+bis)?(\s+(sur|norte|este|oeste))?(\s*(#|no\.?|n°|nº)?\s*\d+[a-z]?(\s*[-–]\s*\d+)?)?',
    '\1[dirección oculta]', 'gi');
  t := regexp_replace(
    t,
    '(^|[^A-Za-z])(apto|apartamento|apt|torre|interior|int|bloque|manzana|mz|lote|oficina|piso|casa)\.?\s*(#|no\.?)?\s*\d+[a-z]?',
    '\1[dirección oculta]', 'gi');
  t := regexp_replace(
    t,
    '([Cc]onjunto|[Ee]dificio|[Uu]rbanizaci[oó]n|[Cc]ondominio|[Aa]grupaci[oó]n|[Uu]nidad [Rr]esidencial)(\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*){1,3}',
    '[dirección oculta]', 'g');
  RETURN t;
END;
$$;

-- «María G.»: primer nombre + inicial del último apellido; nunca expone un correo.
CREATE OR REPLACE FUNCTION public.short_display_name(p_full_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  parts text[] := regexp_split_to_array(btrim(COALESCE(p_full_name, '')), '\s+');
  n integer := COALESCE(array_length(parts, 1), 0);
BEGIN
  IF n = 0 OR parts[1] = '' OR position('@' IN parts[1]) > 0 THEN
    RETURN 'Familia';
  END IF;
  IF n = 1 THEN
    RETURN parts[1];
  END IF;
  RETURN parts[1] || ' ' || upper(left(parts[n], 1)) || '.';
END;
$$;

-- Mensajes entre partes: sin teléfonos, correos, enlaces, direcciones ni instrucciones de pago.
-- Los patrones de pago son los de supabase/functions/_shared/paymentGuard.ts.
CREATE OR REPLACE FUNCTION public.message_has_forbidden_content(p_text text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT p_text IS NOT NULL AND (
    public.redact_contact_info(p_text) IS DISTINCT FROM p_text
    OR p_text ~* '(mercado\s?pago|mpago\.la|init_point|checkout_url|payment_link|preference_id|(enlace|link|liga)\s+de\s+pago|transfiere|transferencia|consigna|n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente|(nequi|daviplata)\s*[:=]?\s*\d{7,}|llave\s+bre-?b|paga\s+(aqu[ií]|por\s+whatsapp))'
  );
$$;

-- Rango permitido para ofertar sobre la tarifa publicada: 0,8× a 2×, pasos de $500, con piso y techo
-- de plataforma. Espejo de rateBand() en src/lib/negotiation.ts.
CREATE OR REPLACE FUNCTION public.rate_band_min(p_posted integer)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    8000,
    (ceil((CASE WHEN p_posted > 0 THEN p_posted ELSE 8000 END)::numeric * 80 / 100 / 500) * 500)::integer
  );
$$;

CREATE OR REPLACE FUNCTION public.rate_band_max(p_posted integer)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    public.rate_band_min(p_posted),
    LEAST(250000, (floor((CASE WHEN p_posted > 0 THEN p_posted ELSE 8000 END)::numeric * 200 / 100 / 500) * 500)::integer)
  );
$$;

-- Cupo diario de desbloqueos de contacto por plan (espejo de REVEAL_DAILY_QUOTA en opportunities.ts).
CREATE OR REPLACE FUNCTION public.reveal_daily_quota(p_plan text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_plan
    WHEN 'essential_monthly'   THEN 15
    WHEN 'pro_monthly'         THEN 40
    WHEN 'institution_monthly' THEN 40
    ELSE 0
  END;
$$;

-- Plan vigente de un usuario según mp_subscriptions (solo escribe el webhook de pagos).
-- Uso interno: no se expone a la API para que nadie pueda consultar el plan de otra persona.
CREATE OR REPLACE FUNCTION public.plan_key_for(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT s.plan
      FROM public.mp_subscriptions s
     WHERE s.user_id = p_user
       AND s.status IN ('active', 'approved')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.plan IN ('essential_monthly', 'pro_monthly', 'institution_monthly')
     LIMIT 1
  ), 'free');
$$;

REVOKE ALL ON FUNCTION public.redact_contact_info(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.short_display_name(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_has_forbidden_content(text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rate_band_min(integer)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rate_band_max(integer)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reveal_daily_quota(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.plan_key_for(uuid)                   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_contact_info(text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.short_display_name(text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_has_forbidden_content(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_band_min(integer)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_band_max(integer)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reveal_daily_quota(text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_key_for(uuid)                  TO service_role;

-- ─── 1) Negociación: columnas y estados nuevos en slot_proposals ────────────────
-- Cada contraoferta es una fila nueva enlazada a la anterior (historial inmutable); la anterior
-- queda en estado 'countered'.
ALTER TABLE public.slot_proposals
  ADD COLUMN IF NOT EXISTS round_no           smallint    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_proposal_id uuid        REFERENCES public.slot_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_rate        integer,
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz;

CREATE INDEX IF NOT EXISTS idx_slot_proposals_expiry
  ON public.slot_proposals (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_slot_proposals_parent
  ON public.slot_proposals (parent_proposal_id) WHERE parent_proposal_id IS NOT NULL;

-- El estado puede ser texto con CHECK (linaje de 20260422190000) o enum (linaje Lovable): se admiten ambos.
DO $$
DECLARE
  v_is_enum boolean;
BEGIN
  SELECT (c.data_type = 'USER-DEFINED') INTO v_is_enum
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'slot_proposals' AND c.column_name = 'status';

  IF v_is_enum THEN
    ALTER TYPE public.slot_proposal_status ADD VALUE IF NOT EXISTS 'countered';
  ELSE
    ALTER TABLE public.slot_proposals DROP CONSTRAINT IF EXISTS slot_proposals_status_check;
    ALTER TABLE public.slot_proposals ADD CONSTRAINT slot_proposals_status_check
      CHECK (status IN ('pending','accepted','rejected','cancelled','expired','countered'));
  END IF;
END $$;

-- ─── 2) Privacidad de family_needs ──────────────────────────────────────────────
-- Sobrevivían políticas antiguas que dejaban a CUALQUIER usuario autenticado leer todas las
-- necesidades abiertas con dirección y notas. Desde ahora solo la familia dueña y el staff leen la
-- tabla; los profesionales usan list_open_family_needs() (sin dirección) y, con plan de pago,
-- reveal_opportunity_contact() (auditado).
DROP POLICY IF EXISTS "family_needs_select_public_open"   ON public.family_needs;
DROP POLICY IF EXISTS "family_needs_select_authenticated" ON public.family_needs;
DROP POLICY IF EXISTS fn_select_open_for_pros              ON public.family_needs;
DROP POLICY IF EXISTS fn_select_owner_or_staff             ON public.family_needs;
CREATE POLICY fn_select_owner_or_staff ON public.family_needs
  FOR SELECT TO authenticated
  USING (auth.uid() = family_user_id OR public.is_staff(auth.uid()));

-- ─── 3) Tablas nuevas ───────────────────────────────────────────────────────────

-- 3a) Auditoría de desbloqueos de contacto. La familia puede ver quién desbloqueó su contacto.
CREATE TABLE IF NOT EXISTS public.opportunity_contact_reveals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_need_id   uuid REFERENCES public.family_needs(id) ON DELETE SET NULL,
  plan             text NOT NULL,
  revealed_on      date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_pro_day ON public.opportunity_contact_reveals (professional_id, revealed_on);
CREATE INDEX IF NOT EXISTS idx_ocr_family  ON public.opportunity_contact_reveals (family_user_id, created_at DESC);
ALTER TABLE public.opportunity_contact_reveals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ocr_select_involved ON public.opportunity_contact_reveals;
CREATE POLICY ocr_select_involved ON public.opportunity_contact_reveals
  FOR SELECT TO authenticated
  USING (auth.uid() = professional_id OR auth.uid() = family_user_id OR public.is_staff(auth.uid()));
-- Sin políticas de escritura: solo reveal_opportunity_contact() inserta.
GRANT SELECT ON public.opportunity_contact_reveals TO authenticated;
GRANT ALL    ON public.opportunity_contact_reveals TO service_role;

-- 3b) Alertas del profesional (hasta 5).
CREATE TABLE IF NOT EXISTS public.opportunity_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Mi alerta' CHECK (char_length(name) BETWEEN 1 AND 60),
  cities           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(cities) <= 10),
  care_types       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(care_types) <= 10),
  min_rate         integer CHECK (min_rate IS NULL OR min_rate BETWEEN 0 AND 250000),
  urgent_only      boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_alerts_pro ON public.opportunity_alerts (professional_id) WHERE active;
ALTER TABLE public.opportunity_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oa_select_own ON public.opportunity_alerts;
CREATE POLICY oa_select_own ON public.opportunity_alerts
  FOR SELECT TO authenticated USING (auth.uid() = professional_id OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS oa_insert_own ON public.opportunity_alerts;
CREATE POLICY oa_insert_own ON public.opportunity_alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = professional_id AND public.has_role(auth.uid(), 'professional'::public.app_role));
DROP POLICY IF EXISTS oa_update_own ON public.opportunity_alerts;
CREATE POLICY oa_update_own ON public.opportunity_alerts
  FOR UPDATE TO authenticated USING (auth.uid() = professional_id) WITH CHECK (auth.uid() = professional_id);
DROP POLICY IF EXISTS oa_delete_own ON public.opportunity_alerts;
CREATE POLICY oa_delete_own ON public.opportunity_alerts
  FOR DELETE TO authenticated USING (auth.uid() = professional_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_alerts TO authenticated;
GRANT ALL ON public.opportunity_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.limit_opportunity_alerts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.opportunity_alerts a WHERE a.professional_id = NEW.professional_id) >= 5 THEN
    RAISE EXCEPTION 'Puedes tener hasta 5 alertas' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.limit_opportunity_alerts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_limit_opportunity_alerts ON public.opportunity_alerts;
CREATE TRIGGER trg_limit_opportunity_alerts
  BEFORE INSERT ON public.opportunity_alerts
  FOR EACH ROW EXECUTE FUNCTION public.limit_opportunity_alerts();

-- 3c) Antispam de alertas: una notificación por alerta y familia cada 6 h (solo el sistema escribe).
CREATE TABLE IF NOT EXISTS public.opportunity_alert_log (
  alert_id        uuid NOT NULL REFERENCES public.opportunity_alerts(id) ON DELETE CASCADE,
  family_user_id  uuid NOT NULL,
  notified_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, family_user_id)
);
ALTER TABLE public.opportunity_alert_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.opportunity_alert_log TO service_role;

-- ─── 4) Integridad de slot_proposals ────────────────────────────────────────────
-- Hasta hoy cualquiera de las dos partes podía insertar o editar propuestas con el valor y el
-- estado que quisiera por la API (incluido «accepted» o cambiar la tarifa ya enviada), lo que
-- dejaba el control de plan y la negociación en la interfaz solamente. Ahora el servidor decide:
-- los cambios de estado «serios» ocurren dentro de las funciones de abajo, que activan la bandera
-- local app.proposal_rpc (no se puede fijar desde la API).

-- Marca como vencidas las propuestas sin respuesta. Se llama desde las funciones y desde pg_cron.
CREATE OR REPLACE FUNCTION public.expire_stale_proposals()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('app.proposal_rpc', true);
  v_n    integer;
BEGIN
  PERFORM set_config('app.proposal_rpc', 'on', true);
  UPDATE public.slot_proposals
     SET status = 'expired', decision_note = COALESCE(decision_note, 'Venció sin respuesta')
   WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.proposal_rpc', COALESCE(v_prev, ''), true);
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_proposals_guard_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rpc    boolean := COALESCE(current_setting('app.proposal_rpc', true), '') = 'on';
  v_by     text    := NEW.proposed_by::text;
  v_posted integer;
BEGIN
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'El horario de la propuesta no es válido' USING ERRCODE = '23514';
  END IF;
  IF NEW.family_user_id = NEW.professional_id THEN
    RAISE EXCEPTION 'No puedes proponerte un servicio a ti mismo' USING ERRCODE = '23514';
  END IF;
  IF NEW.hourly_rate < 8000 OR NEW.hourly_rate > 250000 THEN
    RAISE EXCEPTION 'El valor por hora debe estar entre $8.000 y $250.000' USING ERRCODE = '23514';
  END IF;
  IF NEW.message IS NOT NULL AND public.message_has_forbidden_content(NEW.message) THEN
    RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje: el contacto se desbloquea desde tu plan y los pagos se hacen solo en la página web'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_rpc THEN
    -- Quien inserta por la API no decide la ronda, el enlace con otra oferta ni el estado inicial.
    NEW.round_no := 1;
    NEW.parent_proposal_id := NULL;
    IF NEW.status::text <> 'pending' THEN
      RAISE EXCEPTION 'Una propuesta nueva debe iniciar pendiente' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.slot_proposals sp
       WHERE sp.professional_id = NEW.professional_id
         AND sp.family_user_id  = NEW.family_user_id
         AND sp.status IN ('pending', 'accepted')
         AND sp.starts_at < NEW.ends_at AND sp.ends_at > NEW.starts_at
    ) THEN
      RAISE EXCEPTION 'Ya existe una propuesta activa para ese horario' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Tarifa publicada por la familia para esas horas (ponderada). Referencia de la negociación.
  IF NEW.posted_rate IS NULL THEN
    SELECT round(sum(fn.hourly_rate * h.hrs) / NULLIF(sum(h.hrs), 0))::integer
      INTO v_posted
      FROM public.family_needs fn
     CROSS JOIN LATERAL (SELECT EXTRACT(EPOCH FROM (fn.ends_at - fn.starts_at)) / 3600 AS hrs) h
     WHERE fn.family_user_id = NEW.family_user_id
       AND fn.starts_at >= NEW.starts_at AND fn.ends_at <= NEW.ends_at;
    NEW.posted_rate := COALESCE(v_posted, NEW.hourly_rate);
  END IF;

  -- Negociar el valor es una función de pago para el profesional (la familia no paga por negociar).
  IF v_by = 'professional' AND NOT v_rpc AND NEW.hourly_rate <> NEW.posted_rate THEN
    IF public.plan_key_for(NEW.professional_id) = 'free' THEN
      RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
        USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
    END IF;
    IF NEW.hourly_rate < public.rate_band_min(NEW.posted_rate)
       OR NEW.hourly_rate > public.rate_band_max(NEW.posted_rate) THEN
      RAISE EXCEPTION 'El valor por hora debe estar entre $% y $% para esta solicitud',
        public.rate_band_min(NEW.posted_rate), public.rate_band_max(NEW.posted_rate)
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := GREATEST(
      LEAST(now() + interval '72 hours', NEW.starts_at - interval '1 hour'),
      now() + interval '15 minutes'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_proposals_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rpc       boolean := COALESCE(current_setting('app.proposal_rpc', true), '') = 'on';
  v_uid       uuid    := auth.uid();
  v_proposer  uuid;
  v_recipient uuid;
BEGIN
  -- Sistema (service role), staff y las funciones de este archivo pueden todo.
  IF v_rpc OR v_uid IS NULL OR public.is_staff(v_uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.family_user_id      IS DISTINCT FROM OLD.family_user_id
     OR NEW.professional_id   IS DISTINCT FROM OLD.professional_id
     OR NEW.family_need_id    IS DISTINCT FROM OLD.family_need_id
     OR NEW.availability_slot_id IS DISTINCT FROM OLD.availability_slot_id
     OR NEW.starts_at         IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at           IS DISTINCT FROM OLD.ends_at
     OR NEW.hourly_rate       IS DISTINCT FROM OLD.hourly_rate
     OR NEW.proposed_by::text IS DISTINCT FROM OLD.proposed_by::text
     OR NEW.message           IS DISTINCT FROM OLD.message
     OR NEW.booking_id        IS DISTINCT FROM OLD.booking_id
     OR NEW.round_no          IS DISTINCT FROM OLD.round_no
     OR NEW.parent_proposal_id IS DISTINCT FROM OLD.parent_proposal_id
     OR NEW.posted_rate       IS DISTINCT FROM OLD.posted_rate
     OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'Una propuesta no se puede modificar: envía una contraoferta' USING ERRCODE = '42501';
  END IF;

  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    IF OLD.status::text <> 'pending' THEN
      RAISE EXCEPTION 'La propuesta ya no está activa' USING ERRCODE = '42501';
    END IF;
    v_proposer  := CASE WHEN OLD.proposed_by::text = 'professional' THEN OLD.professional_id ELSE OLD.family_user_id END;
    v_recipient := CASE WHEN OLD.proposed_by::text = 'professional' THEN OLD.family_user_id ELSE OLD.professional_id END;
    IF NOT (
         (NEW.status::text = 'cancelled' AND v_uid = v_proposer)
      OR (NEW.status::text = 'rejected'  AND v_uid = v_recipient)
    ) THEN
      -- «accepted» solo por accept_slot_proposal(); «countered» solo por counter_slot_proposal().
      RAISE EXCEPTION 'Cambio de estado no permitido' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.decision_note IS DISTINCT FROM OLD.decision_note
     AND NEW.decision_note IS NOT NULL
     AND public.message_has_forbidden_content(NEW.decision_note) THEN
    RAISE EXCEPTION 'No incluyas teléfonos, enlaces ni datos de pago en la nota' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.slot_proposals_guard_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.slot_proposals_guard_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_proposals()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_stale_proposals()      TO service_role;

DROP TRIGGER IF EXISTS trg_slot_proposals_guard_insert ON public.slot_proposals;
CREATE TRIGGER trg_slot_proposals_guard_insert
  BEFORE INSERT ON public.slot_proposals
  FOR EACH ROW EXECUTE FUNCTION public.slot_proposals_guard_insert();

DROP TRIGGER IF EXISTS trg_slot_proposals_guard_update ON public.slot_proposals;
CREATE TRIGGER trg_slot_proposals_guard_update
  BEFORE UPDATE ON public.slot_proposals
  FOR EACH ROW EXECUTE FUNCTION public.slot_proposals_guard_update();

-- ─── 5) Lectura segura para profesionales ───────────────────────────────────────

-- Necesidades abiertas SIN dirección: nombre abreviado, ciudad (del perfil), notas sin datos de
-- contacto y reputación agregada de la familia (≥ 3 calificaciones, o NULL).
CREATE OR REPLACE FUNCTION public.list_open_family_needs(p_limit integer DEFAULT 300)
RETURNS TABLE (
  id               uuid,
  family_user_id   uuid,
  display_name     text,
  city             text,
  care_type        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  hourly_rate      integer,
  notes_public     text,
  created_at       timestamptz,
  already_applied  boolean,
  family_stars     numeric,
  family_ratings   integer,
  family_completed integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden ver las solicitudes de las familias' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT fn.id,
         fn.family_user_id,
         public.short_display_name(pr.full_name),
         pr.city,
         fn.care_type,
         fn.starts_at,
         fn.ends_at,
         fn.hourly_rate,
         left(public.redact_contact_info(fn.notes), 280),
         fn.created_at,
         EXISTS (
           SELECT 1 FROM public.slot_proposals sp
            WHERE sp.professional_id = v_uid
              AND sp.family_user_id  = fn.family_user_id
              AND sp.status IN ('pending', 'accepted')
              AND (sp.expires_at IS NULL OR sp.expires_at > now())
              AND sp.starts_at <= fn.starts_at AND sp.ends_at >= fn.ends_at
         ),
         rep.stars,
         rep.n,
         done.n
    FROM public.family_needs fn
    LEFT JOIN public.profiles pr ON pr.user_id = fn.family_user_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) >= 3 THEN round(avg(sr.stars)::numeric, 2) END AS stars,
             count(*)::integer AS n
        FROM public.service_ratings sr WHERE sr.rated_id = fn.family_user_id
    ) rep ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n
        FROM public.service_bookings b WHERE b.client_id = fn.family_user_id AND b.status = 'completed'
    ) done ON true
   WHERE fn.status = 'open'
     AND fn.ends_at > now()
     AND fn.family_user_id <> v_uid
   ORDER BY fn.starts_at
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END;
$$;

-- Reputación agregada de una familia (los comentarios de texto NO se exponen).
CREATE OR REPLACE FUNCTION public.family_reputation(p_family uuid)
RETURNS TABLE (ratings_count integer, stars_avg numeric, completed_services integer, dimensions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  v_n    integer;
  v_avg  numeric;
  v_done integer;
  v_dims jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (v_uid = p_family OR public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer, round(avg(sr.stars)::numeric, 2)
    INTO v_n, v_avg
    FROM public.service_ratings sr WHERE sr.rated_id = p_family;
  SELECT count(*)::integer INTO v_done
    FROM public.service_bookings b WHERE b.client_id = p_family AND b.status = 'completed';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('dimension', t.dimension, 'average', t.average, 'ratings', t.ratings)
                            ORDER BY t.dimension), '[]'::jsonb)
    INTO v_dims
    FROM (
      SELECT d.key AS dimension, round(avg(d.value::numeric), 2) AS average, count(*)::integer AS ratings
        FROM public.service_rating_dimensions r,
             LATERAL jsonb_each_text(r.scores) AS d(key, value)
       WHERE r.rated_id = p_family AND r.rater_role = 'professional'
       GROUP BY d.key
      HAVING count(*) >= 3
    ) t;

  RETURN QUERY SELECT v_n, CASE WHEN v_n >= 3 THEN v_avg END, v_done, v_dims;
END;
$$;

-- Referencia de mercado para negociar: percentiles del valor por hora de los servicios acordados en
-- los últimos 180 días (de la ciudad de la familia si se indica). Con menos de 5 servicios devuelve
-- NULL en los percentiles: no se muestra un «mercado» inventado con muestras pequeñas.
CREATE OR REPLACE FUNCTION public.market_rate_stats(p_city text DEFAULT NULL)
RETURNS TABLE (n integer, p25 integer, median integer, p75 integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT b.hourly_rate
      FROM public.service_bookings b
      LEFT JOIN public.profiles pr ON pr.user_id = b.client_id
     WHERE b.status IN ('confirmed', 'in_route', 'in_progress', 'completed')
       AND b.created_at >= now() - interval '180 days'
       AND b.hourly_rate > 0
       AND (NULLIF(btrim(COALESCE(p_city, '')), '') IS NULL OR public.city_key(pr.city) = public.city_key(p_city))
  )
  SELECT count(*)::integer,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.25) WITHIN GROUP (ORDER BY hourly_rate))::integer END,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY hourly_rate))::integer END,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.75) WITHIN GROUP (ORDER BY hourly_rate))::integer END
    FROM s;
END;
$$;

-- Bandeja de propuestas del usuario con el nombre de la contraparte ya resuelto: el profesional ve a
-- la familia abreviada («María R.»); la familia ve el nombre y la foto del profesional. Reemplaza las
-- consultas directas a profiles, que no resolvían los nombres (usaban profiles.id en vez de user_id).
CREATE OR REPLACE FUNCTION public.my_slot_proposals(p_limit integer DEFAULT 60)
RETURNS TABLE (
  id                 uuid,
  family_user_id     uuid,
  professional_id    uuid,
  family_need_id     uuid,
  starts_at          timestamptz,
  ends_at            timestamptz,
  hourly_rate        integer,
  proposed_by        text,
  status             text,
  message            text,
  decision_note      text,
  booking_id         uuid,
  created_at         timestamptz,
  round_no           integer,
  parent_proposal_id uuid,
  posted_rate        integer,
  expires_at         timestamptz,
  peer_id            uuid,
  peer_name          text,
  peer_avatar        text,
  peer_city          text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.family_user_id, sp.professional_id, sp.family_need_id, sp.starts_at, sp.ends_at,
         sp.hourly_rate, sp.proposed_by::text, sp.status::text, sp.message, sp.decision_note, sp.booking_id,
         sp.created_at, sp.round_no::integer, sp.parent_proposal_id, sp.posted_rate, sp.expires_at,
         peer.user_id,
         CASE WHEN sp.professional_id = v_uid THEN public.short_display_name(peer.full_name)
              ELSE COALESCE(NULLIF(btrim(peer.full_name), ''), 'Profesional') END,
         CASE WHEN sp.professional_id = v_uid THEN NULL
              ELSE COALESCE(pp.avatar_url, peer.avatar_url) END,
         peer.city
    FROM public.slot_proposals sp
    LEFT JOIN public.profiles peer
           ON peer.user_id = CASE WHEN sp.professional_id = v_uid THEN sp.family_user_id ELSE sp.professional_id END
    LEFT JOIN public.professional_profiles pp ON pp.user_id = sp.professional_id AND sp.family_user_id = v_uid
   WHERE sp.family_user_id = v_uid OR sp.professional_id = v_uid
   ORDER BY sp.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END;
$$;

-- ─── 6) Desbloqueo auditado de dirección y WhatsApp ─────────────────────────────
-- Requisitos: plan de pago vigente (mp_subscriptions), estar postulado a esa familia y no superar el
-- cupo diario de familias distintas. Cada desbloqueo queda registrado y la familia es notificada.
-- Para permitir desbloquear sin postularse, cambia v_require_application a false.
CREATE OR REPLACE FUNCTION public.reveal_opportunity_contact(p_need_id uuid)
RETURNS TABLE (
  full_name     text,
  whatsapp      text,
  phone         text,
  address       text,
  city          text,
  revealed_at   timestamptz,
  reveals_left  integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid                 uuid := auth.uid();
  v_require_application constant boolean := true;
  v_today               date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_need                public.family_needs%ROWTYPE;
  v_plan                text;
  v_quota               integer;
  v_used                integer;
  v_already             boolean;
  v_pro_name            text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'professional'::public.app_role) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden desbloquear contactos' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_need FROM public.family_needs WHERE id = p_need_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_need.family_user_id = v_uid THEN
    RAISE EXCEPTION 'Es tu propia solicitud' USING ERRCODE = '23514';
  END IF;

  v_plan  := public.plan_key_for(v_uid);
  v_quota := public.reveal_daily_quota(v_plan);
  IF v_quota = 0 THEN
    RAISE EXCEPTION 'Ver la dirección y el WhatsApp está disponible desde el plan Esencial'
      USING ERRCODE = '42501', HINT = 'plan_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.slot_proposals sp
     WHERE sp.professional_id = v_uid AND sp.family_user_id = v_need.family_user_id
       AND sp.status = 'accepted'
  ) THEN
    IF v_need.status::text <> 'open' THEN
      RAISE EXCEPTION 'Esta solicitud ya fue cubierta' USING ERRCODE = '23514';
    END IF;
    IF v_require_application AND NOT EXISTS (
      SELECT 1 FROM public.slot_proposals sp
       WHERE sp.professional_id = v_uid AND sp.family_user_id = v_need.family_user_id
         AND sp.status = 'pending'
         AND (sp.expires_at IS NULL OR sp.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'Postúlate primero a esta solicitud para desbloquear el contacto'
        USING ERRCODE = '42501', HINT = 'application_required';
    END IF;
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.opportunity_contact_reveals r
            WHERE r.professional_id = v_uid AND r.family_user_id = v_need.family_user_id AND r.revealed_on = v_today
         ),
         (SELECT count(DISTINCT r.family_user_id)::integer
            FROM public.opportunity_contact_reveals r
           WHERE r.professional_id = v_uid AND r.revealed_on = v_today)
    INTO v_already, v_used;
  IF NOT v_already AND v_used >= v_quota THEN
    RAISE EXCEPTION 'Alcanzaste el límite diario de contactos desbloqueados (%)', v_quota
      USING ERRCODE = '42501', HINT = 'quota_exceeded';
  END IF;

  INSERT INTO public.opportunity_contact_reveals (professional_id, family_user_id, family_need_id, plan)
  VALUES (v_uid, v_need.family_user_id, v_need.id, v_plan);

  IF NOT v_already THEN
    SELECT public.short_display_name(p.full_name) INTO v_pro_name FROM public.profiles p WHERE p.user_id = v_uid;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_need.family_user_id, 'contact_revealed', 'Un profesional desbloqueó tu contacto',
            COALESCE(v_pro_name, 'Un profesional') || ' vio los datos de contacto de tu solicitud para coordinar el servicio.',
            '/dashboard/familia');
  END IF;

  RETURN QUERY
  SELECT pr.full_name,
         COALESCE(NULLIF(btrim(fp.whatsapp), ''), NULLIF(btrim(pr.phone), '')),
         NULLIF(btrim(pr.phone), ''),
         COALESCE(NULLIF(btrim(v_need.service_address), ''), NULLIF(btrim(fp.default_address), '')),
         pr.city,
         now(),
         GREATEST(v_quota - v_used - CASE WHEN v_already THEN 0 ELSE 1 END, 0)
    FROM (SELECT 1) one
    LEFT JOIN public.profiles pr ON pr.user_id = v_need.family_user_id
    LEFT JOIN public.family_profiles fp ON fp.user_id = v_need.family_user_id;
END;
$$;

-- ─── 7) Postularse a un turno y negociar ────────────────────────────────────────

-- Une varias horas contiguas de UNA familia en una sola propuesta. Sin p_rate se acepta la tarifa
-- publicada (promedio ponderado por horas); con otro valor se negocia (plan de pago, rango 0,8×–2×).
CREATE OR REPLACE FUNCTION public.apply_to_family_need(
  p_need_ids uuid[],
  p_rate     integer DEFAULT NULL,
  p_message  text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid := auth.uid();
  v_ids      uuid[];
  v_n        integer;
  v_found    integer;
  v_families integer;
  v_family   uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_hours    numeric;
  v_posted   integer;
  v_rate     integer;
  v_msg      text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_new      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'professional'::public.app_role) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden postularse' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;

  PERFORM public.expire_stale_proposals();

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(COALESCE(p_need_ids, '{}'::uuid[])) AS x;
  v_n := COALESCE(cardinality(v_ids), 0);
  IF v_n = 0 OR v_n > 168 THEN
    RAISE EXCEPTION 'Selecciona entre 1 y 168 horas' USING ERRCODE = '23514';
  END IF;

  -- Serializa postulaciones simultáneas sobre las mismas horas.
  PERFORM 1 FROM public.family_needs WHERE id = ANY (v_ids) FOR UPDATE;

  SELECT count(*)::integer,
         count(DISTINCT fn.family_user_id)::integer,
         (array_agg(fn.family_user_id))[1],
         min(fn.starts_at),
         max(fn.ends_at),
         COALESCE(sum(EXTRACT(EPOCH FROM (fn.ends_at - fn.starts_at)) / 3600), 0),
         round(sum(fn.hourly_rate * EXTRACT(EPOCH FROM (fn.ends_at - fn.starts_at)) / 3600)
               / NULLIF(sum(EXTRACT(EPOCH FROM (fn.ends_at - fn.starts_at)) / 3600), 0))::integer
    INTO v_found, v_families, v_family, v_start, v_end, v_hours, v_posted
    FROM public.family_needs fn
   WHERE fn.id = ANY (v_ids) AND fn.status = 'open' AND fn.ends_at > now();

  IF v_found <> v_n THEN
    RAISE EXCEPTION 'Alguna de las horas ya no está disponible' USING ERRCODE = '23514';
  END IF;
  IF v_families <> 1 THEN
    RAISE EXCEPTION 'Todas las horas deben ser de la misma familia' USING ERRCODE = '23514';
  END IF;
  IF v_family = v_uid THEN
    RAISE EXCEPTION 'No puedes postularte a tu propia solicitud' USING ERRCODE = '23514';
  END IF;
  -- Sin huecos ni solapes: la suma de horas debe igualar la ventana completa.
  IF abs(v_hours - EXTRACT(EPOCH FROM (v_end - v_start)) / 3600) > 0.001 THEN
    RAISE EXCEPTION 'Las horas deben ser consecutivas' USING ERRCODE = '23514';
  END IF;

  v_rate := COALESCE(p_rate, v_posted);
  IF v_rate <> v_posted THEN
    IF public.plan_key_for(v_uid) = 'free' THEN
      RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
        USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
    END IF;
    IF v_rate < public.rate_band_min(v_posted) OR v_rate > public.rate_band_max(v_posted) THEN
      RAISE EXCEPTION 'El valor por hora debe estar entre $% y $% para esta solicitud',
        public.rate_band_min(v_posted), public.rate_band_max(v_posted) USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 500 THEN
      RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje: el contacto se desbloquea desde tu plan y los pagos se hacen solo en la página web'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.professional_id = v_uid
       AND b.status IN ('confirmed', 'in_route', 'in_progress')
       AND b.scheduled_at < v_end
       AND b.scheduled_at + (b.duration_hours * interval '1 hour') > v_start
  ) THEN
    RAISE EXCEPTION 'Ese horario se cruza con un servicio que ya tienes confirmado' USING ERRCODE = '23P01';
  END IF;

  IF (SELECT count(*) FROM public.slot_proposals sp
       WHERE sp.professional_id = v_uid AND sp.status = 'pending' AND sp.proposed_by = 'professional') >= 30 THEN
    RAISE EXCEPTION 'Tienes demasiadas postulaciones pendientes: espera respuestas o retira alguna' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.slot_proposals (
    family_user_id, professional_id, family_need_id, starts_at, ends_at, hourly_rate,
    proposed_by, status, message, round_no, posted_rate, expires_at
  ) VALUES (
    v_family, v_uid, (SELECT id FROM public.family_needs WHERE id = ANY (v_ids) ORDER BY starts_at LIMIT 1),
    v_start, v_end, v_rate,
    'professional', 'pending', v_msg, 1, v_posted,
    GREATEST(LEAST(now() + interval '72 hours', v_start - interval '1 hour'), now() + interval '15 minutes')
  ) RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

-- Contraoferta: la parte que RECIBE la oferta propone otro valor. Máximo 3 rondas en total (la
-- ronda 3 es «última oferta»), cada oferta vence a las 24 h y el valor debe estar en el rango
-- permitido. El profesional necesita plan de pago para contraofertar; la familia no.
CREATE OR REPLACE FUNCTION public.counter_slot_proposal(
  p_proposal_id uuid,
  p_rate        integer,
  p_message     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  p        public.slot_proposals%ROWTYPE;
  v_role   text;
  v_posted integer;
  v_msg    text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_exp    timestamptz;
  v_new    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM set_config('app.proposal_rpc', 'on', true);
  PERFORM public.expire_stale_proposals();

  SELECT * INTO p FROM public.slot_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La propuesta ya no está disponible (%)', p.status::text;
  END IF;

  IF p.proposed_by::text = 'professional' AND p.family_user_id = v_uid THEN
    v_role := 'family';
  ELSIF p.proposed_by::text = 'family' AND p.professional_id = v_uid THEN
    v_role := 'professional';
  ELSE
    RAISE EXCEPTION 'Solo quien recibe la oferta puede contraofertar' USING ERRCODE = '42501';
  END IF;

  IF p.round_no >= 3 THEN
    RAISE EXCEPTION 'Esta es la última oferta: solo puedes aceptarla o rechazarla' USING ERRCODE = '23514';
  END IF;
  IF p.starts_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'El horario de la propuesta ya pasó' USING ERRCODE = '23514';
  END IF;
  IF v_role = 'professional' THEN
    IF public.plan_key_for(v_uid) = 'free' THEN
      RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
        USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
    END IF;
    IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
      RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_posted := COALESCE(p.posted_rate, p.hourly_rate);
  IF p_rate IS NULL OR p_rate < public.rate_band_min(v_posted) OR p_rate > public.rate_band_max(v_posted) THEN
    RAISE EXCEPTION 'El valor por hora debe estar entre $% y $% para esta solicitud',
      public.rate_band_min(v_posted), public.rate_band_max(v_posted) USING ERRCODE = '23514';
  END IF;
  IF p_rate = p.hourly_rate THEN
    RAISE EXCEPTION 'La contraoferta debe cambiar el valor; si estás de acuerdo, acepta la oferta' USING ERRCODE = '23514';
  END IF;

  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 500 THEN
      RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_exp := GREATEST(LEAST(now() + interval '24 hours', p.starts_at - interval '1 hour'), now() + interval '15 minutes');

  UPDATE public.slot_proposals
     SET status = 'countered', decision_note = 'Contraoferta enviada'
   WHERE id = p.id;

  -- Dos ramas con literales: el tipo de proposed_by puede ser texto o enum según el linaje de migraciones.
  IF v_role = 'family' THEN
    INSERT INTO public.slot_proposals (
      family_user_id, professional_id, family_need_id, availability_slot_id, starts_at, ends_at, hourly_rate,
      proposed_by, status, message, round_no, parent_proposal_id, posted_rate, expires_at
    ) VALUES (
      p.family_user_id, p.professional_id, p.family_need_id, p.availability_slot_id, p.starts_at, p.ends_at, p_rate,
      'family', 'pending', v_msg, p.round_no + 1, p.id, v_posted, v_exp
    ) RETURNING id INTO v_new;
  ELSE
    INSERT INTO public.slot_proposals (
      family_user_id, professional_id, family_need_id, availability_slot_id, starts_at, ends_at, hourly_rate,
      proposed_by, status, message, round_no, parent_proposal_id, posted_rate, expires_at
    ) VALUES (
      p.family_user_id, p.professional_id, p.family_need_id, p.availability_slot_id, p.starts_at, p.ends_at, p_rate,
      'professional', 'pending', v_msg, p.round_no + 1, p.id, v_posted, v_exp
    ) RETURNING id INTO v_new;
  END IF;

  RETURN v_new;
END;
$$;

-- ─── 8) Aceptar una propuesta (reemplaza la versión de 20261007190000) ──────────
-- Cambios: respeta el vencimiento, cubre TODAS las horas de la familia dentro del turno (antes solo
-- la primera), cancela las propuestas de otros profesionales que quedan dentro del mismo turno y
-- copia la dirección del servicio a la reserva para que el profesional sepa a dónde ir.
CREATE OR REPLACE FUNCTION public.accept_slot_proposal(p_proposal_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  p         public.slot_proposals%ROWTYPE;
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

  SELECT * INTO p FROM public.slot_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta no encontrada';
  END IF;
  IF p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La propuesta ya no está disponible (%)', p.status::text;
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
$$;

-- ─── 9) Notificaciones de propuestas ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_slot_proposal_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_by     text;
  v_to     uuid;
  v_title  text;
  v_body   text;
  v_link   text;
  v_type   text;
  v_rate   text;
BEGIN
  v_by := NEW.proposed_by::text;
  IF TG_OP = 'INSERT' THEN
    v_to   := CASE WHEN v_by = 'professional' THEN NEW.family_user_id ELSE NEW.professional_id END;
    v_link := CASE WHEN v_by = 'professional' THEN '/dashboard/familia' ELSE '/dashboard/profesional' END;
    v_rate := '$' || replace(to_char(NEW.hourly_rate, 'FM999,999,999'), ',', '.');
    IF NEW.round_no > 1 THEN
      v_type  := 'slot_counter_offer';
      v_title := CASE WHEN NEW.round_no >= 3 THEN 'Última oferta recibida' ELSE 'Nueva contraoferta' END;
      v_body  := 'La otra parte propone ' || v_rate || ' por hora. Respóndela antes de que venza.';
    ELSE
      v_type  := 'slot_proposal_received';
      v_title := CASE WHEN v_by = 'professional' THEN 'Un profesional se postuló a tu solicitud' ELSE 'Una familia te propuso un servicio' END;
      v_body  := 'Valor propuesto: ' || v_rate || ' por hora. Revisa los detalles y responde.';
    END IF;
  ELSIF NEW.status::text IN ('accepted', 'rejected')
        OR (NEW.status::text = 'cancelled' AND NEW.decision_note = 'Horario ya cubierto') THEN
    v_to   := CASE WHEN v_by = 'professional' THEN NEW.professional_id ELSE NEW.family_user_id END;
    v_type := 'slot_proposal_' || NEW.status::text;
    v_link := CASE WHEN NEW.status::text = 'accepted' AND NEW.booking_id IS NOT NULL
                   THEN '/servicio/' || NEW.booking_id::text
                   ELSE CASE WHEN v_by = 'professional' THEN '/dashboard/profesional' ELSE '/dashboard/familia' END END;
    v_title := CASE NEW.status::text
                 WHEN 'accepted' THEN 'Tu propuesta fue aceptada'
                 WHEN 'rejected' THEN 'Tu propuesta no fue aceptada'
                 ELSE 'Ese horario ya fue cubierto' END;
    v_body := CASE NEW.status::text
                WHEN 'accepted' THEN 'Se creó la reserva. Coordina los detalles desde el servicio.'
                WHEN 'rejected' THEN 'Puedes seguir buscando otras solicitudes disponibles.'
                ELSE 'Otra propuesta cubrió estas horas. Hay más solicitudes abiertas para ti.' END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (v_to, v_type, v_title, v_body, v_link);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Una notificación fallida nunca debe impedir la propuesta.
  RAISE WARNING 'notify_slot_proposal_event: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_slot_proposal_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_slot_proposal_insert ON public.slot_proposals;
CREATE TRIGGER trg_notify_slot_proposal_insert
  AFTER INSERT ON public.slot_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_slot_proposal_event();

DROP TRIGGER IF EXISTS trg_notify_slot_proposal_status ON public.slot_proposals;
CREATE TRIGGER trg_notify_slot_proposal_status
  AFTER UPDATE OF status ON public.slot_proposals
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.notify_slot_proposal_event();

-- ─── 10) Alertas de oportunidades y actualización en vivo ───────────────────────

-- Notifica a los profesionales cuyas alertas coinciden con una hora nueva. Una notificación por
-- alerta y familia cada 6 h (la familia marca hora por hora). Nunca bloquea el INSERT.
CREATE OR REPLACE FUNCTION public.notify_opportunity_alerts()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_city text;
  v_hay  text;
  r      record;
BEGIN
  IF NEW.status::text <> 'open' OR NEW.ends_at <= now() THEN
    RETURN NEW;
  END IF;

  SELECT p.city INTO v_city FROM public.profiles p WHERE p.user_id = NEW.family_user_id;
  v_hay := lower(translate(COALESCE(NEW.care_type, '') || ' ' || COALESCE(NEW.notes, ''),
                           'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));

  FOR r IN
    SELECT a.id, a.professional_id, a.name
      FROM public.opportunity_alerts a
     WHERE a.active
       AND a.professional_id <> NEW.family_user_id
       AND (cardinality(a.cities) = 0
            OR public.city_key(v_city) IN (SELECT public.city_key(c) FROM unnest(a.cities) AS c))
       AND (cardinality(a.care_types) = 0
            OR EXISTS (SELECT 1 FROM unnest(a.care_types) AS t
                        WHERE position(lower(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) IN v_hay) > 0))
       AND (a.min_rate IS NULL OR NEW.hourly_rate >= a.min_rate)
       AND (NOT a.urgent_only
            OR NEW.starts_at <= now() + interval '6 hours'
            OR (NEW.starts_at AT TIME ZONE 'America/Bogota')::date <= (now() AT TIME ZONE 'America/Bogota')::date)
       AND public.has_role(a.professional_id, 'professional'::public.app_role)
     LIMIT 50
  LOOP
    INSERT INTO public.opportunity_alert_log AS l (alert_id, family_user_id, notified_at)
    VALUES (r.id, NEW.family_user_id, now())
    ON CONFLICT (alert_id, family_user_id) DO UPDATE SET notified_at = now()
      WHERE l.notified_at < now() - interval '6 hours';
    IF FOUND THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.professional_id, 'opportunity_alert', 'Nueva oportunidad: ' || r.name,
              'Hay horas nuevas en ' || COALESCE(v_city, 'tu zona') || ' que coinciden con tu alerta.',
              '/dashboard/profesional');
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_opportunity_alerts: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_opportunity_alerts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_opportunity_alerts ON public.family_needs;
CREATE TRIGGER trg_notify_opportunity_alerts
  AFTER INSERT ON public.family_needs
  FOR EACH ROW EXECUTE FUNCTION public.notify_opportunity_alerts();

-- Aviso en vivo «hay cambios» (sin datos) para que el panel del profesional recargue su lista por el
-- RPC seguro: los profesionales ya no pueden suscribirse a cambios de la tabla family_needs.
-- El canal es privado y solo lo reciben profesionales y staff (política sobre realtime.messages).
CREATE OR REPLACE FUNCTION public.ping_open_needs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'changed', 'open_needs_ping', true);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- realtime.send puede no existir en entornos antiguos: el panel igual carga al abrirse.
  END;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ping_open_needs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_family_needs_ping ON public.family_needs;
CREATE TRIGGER trg_family_needs_ping
  AFTER INSERT OR UPDATE OR DELETE ON public.family_needs
  FOR EACH STATEMENT EXECUTE FUNCTION public.ping_open_needs();

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS open_needs_ping_for_pros ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY open_needs_ping_for_pros ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.topic() = 'open_needs_ping'
          AND (public.has_role(auth.uid(), 'professional'::public.app_role) OR public.is_staff(auth.uid()))
        )
    $p$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo crear la política de realtime para open_needs_ping: %', SQLERRM;
END $$;

-- ─── 11) Comentarios de calificaciones sin datos de contacto ────────────────────
-- Los comentarios los ven solo la persona calificada y el staff. Para evitar que se use la
-- calificación como canal para saltarse la plataforma, se limpian teléfonos, enlaces y direcciones
-- (no se rechaza la calificación: se sustituye el dato).
CREATE OR REPLACE FUNCTION public.sanitize_rating_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.comment IS NOT NULL THEN
    NEW.comment := left(public.redact_contact_info(NEW.comment), 500);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sanitize_rating_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sanitize_rating_comment ON public.service_ratings;
CREATE TRIGGER trg_sanitize_rating_comment
  BEFORE INSERT OR UPDATE OF comment ON public.service_ratings
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_rating_comment();

-- ─── 12) Permisos de las funciones públicas ─────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_open_family_needs(integer)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.family_reputation(uuid)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.market_rate_stats(text)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_slot_proposals(integer)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reveal_opportunity_contact(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_to_family_need(uuid[], integer, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counter_slot_proposal(uuid, integer, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_slot_proposal(uuid)                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_family_needs(integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.family_reputation(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_rate_stats(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_slot_proposals(integer)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_opportunity_contact(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_family_need(uuid[], integer, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.counter_slot_proposal(uuid, integer, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_slot_proposal(uuid)                   TO authenticated;

-- ─── 13) Vencimiento automático (si pg_cron está disponible) ────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('expire-stale-proposals');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('expire-stale-proposals', '*/15 * * * *', 'SELECT public.expire_stale_proposals()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo programar expire-stale-proposals: %', SQLERRM;
END $$;
