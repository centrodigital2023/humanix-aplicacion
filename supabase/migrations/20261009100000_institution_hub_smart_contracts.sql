-- ═══════════════════════════════════════════════════════════════════════════════
-- Centro institucional (EPS / IPS / clínicas / hospitales / geriátricos) + contrato inteligente
--   · Cierra la fuga de direcciones de job_offers: la columna `address` era legible incluso por usuarios
--     anónimos. La dirección exacta y el teléfono pasan a job_offer_private y solo se ven con una reserva
--     aceptada o con plan de pago (tras postularse).
--   · Agenda de turnos por oferta (job_offer_shifts) visible para los profesionales sin dirección.
--   · Postulación y negociación del valor con candado de servidor. Antes `applications` dejaba que el propio
--     profesional se aceptara o fijara el valor por la API; ahora solo las funciones de abajo lo hacen.
--   · Aceptar una postulación crea las reservas (con la dirección), el contrato inteligente y los avisos.
--   · Desbloqueo de contacto auditado y con cupo (plan de pago), también para reservas ya confirmadas:
--     get_booking_contact ya no regala el teléfono a profesionales del plan Free.
--   · Contrato inteligente: términos congelados con hash, firma con aceptación explícita + identidad
--     validada (RETHUS / NIT) + segundo factor, cadena de eventos a prueba de manipulación y verificación
--     de integridad. La firma la registra únicamente código de servidor (service_role).
--   · El flujo anterior de service_contracts (no se podía firmar y dejaba falsificar filas) queda cerrado.
-- Reglas del proyecto: tablas nuevas con GRANT + RLS en esta misma migración; roles solo en
-- public.user_roles (has_role / is_staff); estado del plan solo desde mp_subscriptions; los pagos
-- ocurren únicamente en la página web (los mensajes con datos de pago o de contacto se rechazan).
-- Espejos en TypeScript: src/lib/{institutionOffers,institutionNegotiation,contractTemplate,
-- contractIdentity,coverage}.ts
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 0) Utilidades ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_sha256(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT encode(sha256(convert_to(COALESCE(p_text, ''), 'UTF8')), 'hex') $$;

-- «$180.000»
CREATE OR REPLACE FUNCTION public.hx_cop(p_amount numeric)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT '$' || replace(to_char(round(COALESCE(p_amount, 0)), 'FM999,999,999,999'), ',', '.') $$;

-- Una notificación fallida nunca debe impedir la operación que la origina.
CREATE OR REPLACE FUNCTION public.hx_notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (p_user, p_type, p_title, p_body, p_link);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hx_notify: %', SQLERRM;
END;
$$;

-- Rango permitido para ofertar sobre el valor publicado: 0,8× a 2×, pasos de $500, con piso y techo
-- según la modalidad (por hora / por turno / mensual / paquete). Espejo de offerBand() en
-- src/lib/institutionNegotiation.ts.
CREATE OR REPLACE FUNCTION public.offer_band_min(p_posted integer, p_modality text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    CASE p_modality WHEN 'hour' THEN 8000 WHEN 'shift' THEN 40000 WHEN 'month' THEN 500000 ELSE 50000 END,
    (ceil((CASE WHEN p_posted > 0 THEN p_posted ELSE 1 END)::numeric * 80 / 100 / 500) * 500)::integer
  );
$$;

CREATE OR REPLACE FUNCTION public.offer_band_max(p_posted integer, p_modality text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    public.offer_band_min(p_posted, p_modality),
    LEAST(
      CASE p_modality WHEN 'hour' THEN 250000 WHEN 'shift' THEN 3000000 WHEN 'month' THEN 30000000 ELSE 50000000 END,
      (floor((CASE WHEN p_posted > 0 THEN p_posted ELSE 1 END)::numeric * 200 / 100 / 500) * 500)::integer
    )
  );
$$;

REVOKE ALL ON FUNCTION public.hx_sha256(text)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_cop(numeric)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_notify(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.offer_band_min(integer, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.offer_band_max(integer, text)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_sha256(text)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_cop(numeric)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_notify(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.offer_band_min(integer, text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offer_band_max(integer, text)      TO authenticated, service_role;

-- ─── 1) job_offers: datos privados y nuevas columnas ────────────────────────────

ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS is_urgent    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_area text;

-- Los privilegios de lectura de job_offers son POR COLUMNA (20260520134043): las columnas nuevas
-- hay que concederlas explícitamente o la lectura de la tabla fallaría para los clientes.
GRANT SELECT (is_urgent, service_area) ON public.job_offers TO anon, authenticated;

-- La dirección exacta, el teléfono y las coordenadas exactas ya no viven en la oferta.
CREATE TABLE IF NOT EXISTS public.job_offer_private (
  job_offer_id  uuid PRIMARY KEY
                REFERENCES public.job_offers(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  address       text,
  contact_phone text,
  exact_lat     double precision,
  exact_lng     double precision,
  access_notes  text CHECK (access_notes IS NULL OR char_length(access_notes) <= 300),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_offer_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jop_select_owner ON public.job_offer_private;
CREATE POLICY jop_select_owner ON public.job_offer_private
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_offers o
                  WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
DROP POLICY IF EXISTS jop_insert_owner ON public.job_offer_private;
CREATE POLICY jop_insert_owner ON public.job_offer_private
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_offers o
                       WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
DROP POLICY IF EXISTS jop_update_owner ON public.job_offer_private;
CREATE POLICY jop_update_owner ON public.job_offer_private
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_offers o
                  WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_offers o
                       WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
GRANT SELECT, INSERT, UPDATE ON public.job_offer_private TO authenticated;
GRANT ALL ON public.job_offer_private TO service_role;

-- Cualquier escritura de address / contact_phone / coordenadas exactas en job_offers (incluidos los
-- formularios actuales) se traslada a job_offer_private. Las coordenadas de la oferta quedan
-- aproximadas (2 decimales ≈ 1 km) para que el mapa no delate la dirección.
CREATE OR REPLACE FUNCTION public.job_offers_capture_private()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_addr  text := NULLIF(btrim(COALESCE(NEW.address, '')), '');
  v_phone text := NULLIF(btrim(COALESCE(NEW.contact_phone, '')), '');
  v_xlat  double precision;
  v_xlng  double precision;
BEGIN
  -- Más de 2 decimales = coordenada exacta. Si ya vienen aproximadas no se pisan las exactas guardadas.
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL
     AND (abs(NEW.lat - round(NEW.lat::numeric, 2)) > 0.000001
          OR abs(NEW.lng - round(NEW.lng::numeric, 2)) > 0.000001) THEN
    v_xlat := NEW.lat;
    v_xlng := NEW.lng;
    NEW.lat := round(NEW.lat::numeric, 2);
    NEW.lng := round(NEW.lng::numeric, 2);
  END IF;

  IF v_addr IS NOT NULL OR v_phone IS NOT NULL OR v_xlat IS NOT NULL THEN
    -- La FK es DEFERRABLE INITIALLY DEFERRED: la oferta aún no existe cuando corre este disparador.
    INSERT INTO public.job_offer_private AS p (job_offer_id, address, contact_phone, exact_lat, exact_lng)
    VALUES (NEW.id, v_addr, v_phone, v_xlat, v_xlng)
    ON CONFLICT (job_offer_id) DO UPDATE SET
      address       = COALESCE(EXCLUDED.address, p.address),
      contact_phone = COALESCE(EXCLUDED.contact_phone, p.contact_phone),
      exact_lat     = COALESCE(EXCLUDED.exact_lat, p.exact_lat),
      exact_lng     = COALESCE(EXCLUDED.exact_lng, p.exact_lng),
      updated_at    = now();
  END IF;

  NEW.address := NULL;
  NEW.contact_phone := NULL;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.job_offers_capture_private() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_offers_capture_private ON public.job_offers;
CREATE TRIGGER trg_job_offers_capture_private
  BEFORE INSERT OR UPDATE OF address, contact_phone, lat, lng ON public.job_offers
  FOR EACH ROW EXECUTE FUNCTION public.job_offers_capture_private();

-- Migración de lo que ya estaba publicado: se conserva lo exacto en la tabla privada y se limpia la oferta.
INSERT INTO public.job_offer_private (job_offer_id, address, contact_phone, exact_lat, exact_lng)
SELECT id, NULLIF(btrim(address), ''), NULLIF(btrim(contact_phone), ''), lat, lng
  FROM public.job_offers
 WHERE address IS NOT NULL OR contact_phone IS NOT NULL OR lat IS NOT NULL OR lng IS NOT NULL
ON CONFLICT (job_offer_id) DO NOTHING;

UPDATE public.job_offers
   SET address = NULL,
       contact_phone = NULL,
       lat = round(lat::numeric, 2),
       lng = round(lng::numeric, 2)
 WHERE address IS NOT NULL OR contact_phone IS NOT NULL
    OR (lat IS NOT NULL AND abs(lat - round(lat::numeric, 2)) > 0.000001)
    OR (lng IS NOT NULL AND abs(lng - round(lng::numeric, 2)) > 0.000001);

-- ─── 2) Agenda de turnos de la oferta ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_offer_shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_offer_id  uuid NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  positions     smallint NOT NULL DEFAULT 1 CHECK (positions BETWEEN 1 AND 50),
  filled        smallint NOT NULL DEFAULT 0 CHECK (filled >= 0),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_offer_shifts_span CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '24 hours'),
  CONSTRAINT job_offer_shifts_filled CHECK (filled <= positions)
);
CREATE INDEX IF NOT EXISTS idx_jos_offer ON public.job_offer_shifts (job_offer_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_jos_open_start ON public.job_offer_shifts (starts_at) WHERE status = 'open';
ALTER TABLE public.job_offer_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jos_select ON public.job_offer_shifts;
CREATE POLICY jos_select ON public.job_offer_shifts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.job_offers o
             WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid())))
    OR EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_offer_id = job_offer_shifts.job_offer_id AND a.professional_id = auth.uid())
  );
DROP POLICY IF EXISTS jos_insert_owner ON public.job_offer_shifts;
CREATE POLICY jos_insert_owner ON public.job_offer_shifts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_offers o
                       WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
DROP POLICY IF EXISTS jos_update_owner ON public.job_offer_shifts;
CREATE POLICY jos_update_owner ON public.job_offer_shifts
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.job_offers o
                  WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_offers o
                       WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
DROP POLICY IF EXISTS jos_delete_owner ON public.job_offer_shifts;
CREATE POLICY jos_delete_owner ON public.job_offer_shifts
  FOR DELETE TO authenticated
  USING (filled = 0 AND EXISTS (SELECT 1 FROM public.job_offers o
                                 WHERE o.id = job_offer_id AND (o.posted_by = auth.uid() OR public.is_staff(auth.uid()))));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_offer_shifts TO authenticated;
GRANT ALL ON public.job_offer_shifts TO service_role;

-- Integridad de los turnos: quien publica no decide cuántos cupos están cubiertos.
CREATE OR REPLACE FUNCTION public.job_offer_shifts_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rpc boolean := COALESCE(current_setting('app.application_rpc', true), '') = 'on';
  v_uid uuid := auth.uid();
BEGIN
  IF v_rpc OR v_uid IS NULL OR public.is_staff(v_uid) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.filled := 0;
    NEW.status := 'open';
    IF NEW.starts_at < now() - interval '1 hour' THEN
      RAISE EXCEPTION 'El turno debe empezar en el futuro' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM public.job_offer_shifts s WHERE s.job_offer_id = NEW.job_offer_id) >= 60 THEN
      RAISE EXCEPTION 'Una oferta admite hasta 60 turnos' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.job_offer_id IS DISTINCT FROM OLD.job_offer_id OR NEW.filled IS DISTINCT FROM OLD.filled THEN
    RAISE EXCEPTION 'Los cupos cubiertos los actualiza el sistema' USING ERRCODE = '42501';
  END IF;
  IF OLD.filled > 0 AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at) THEN
    RAISE EXCEPTION 'Este turno ya tiene profesionales confirmados: no se puede cambiar el horario' USING ERRCODE = '23514';
  END IF;
  IF NEW.positions < OLD.filled THEN
    RAISE EXCEPTION 'No puedes dejar menos cupos que los ya cubiertos' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.filled = 0) THEN
      RAISE EXCEPTION 'Solo puedes cancelar turnos sin profesionales confirmados' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.filled >= NEW.positions AND NEW.status = 'open' THEN
    NEW.status := 'filled';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.job_offer_shifts_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_offer_shifts_guard ON public.job_offer_shifts;
CREATE TRIGGER trg_job_offer_shifts_guard
  BEFORE INSERT OR UPDATE ON public.job_offer_shifts
  FOR EACH ROW EXECUTE FUNCTION public.job_offer_shifts_guard();

-- Enlace reserva ↔ turno (para reabrir el cupo si el profesional cancela).
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS job_offer_shift_id uuid;
CREATE INDEX IF NOT EXISTS idx_service_bookings_offer_shift
  ON public.service_bookings (job_offer_shift_id) WHERE job_offer_shift_id IS NOT NULL;

-- ─── 3) applications: candado de servidor + negociación ─────────────────────────

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS posted_amount integer,
  ADD COLUMN IF NOT EXISTS agreed_amount integer,
  ADD COLUMN IF NOT EXISTS round_no      smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS awaiting      text NOT NULL DEFAULT 'institution',
  ADD COLUMN IF NOT EXISTS expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS shift_ids     uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS closed_reason text,
  ADD COLUMN IF NOT EXISTS accepted_at   timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_awaiting_chk') THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_awaiting_chk CHECK (awaiting IN ('institution', 'professional'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_applications_expiry
  ON public.applications (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_applications_pro_status
  ON public.applications (professional_id, status);

-- Quien venció o retiró su postulación puede volver a postularse: la unicidad aplica solo a las vigentes.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'applications' AND con.contype = 'u'
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
              FROM pg_attribute att
             WHERE att.attrelid = rel.oid AND att.attnum = ANY (con.conkey))
           = ARRAY['job_offer_id', 'professional_id']
  LOOP
    EXECUTE format('ALTER TABLE public.applications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_active
  ON public.applications (job_offer_id, professional_id) WHERE status IN ('pending', 'accepted');

-- Historial inmutable de cada postulación (solo escriben las funciones y disparadores de abajo).
CREATE TABLE IF NOT EXISTS public.application_events (
  id             bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  round_no       smallint NOT NULL DEFAULT 1,
  event          text NOT NULL CHECK (event IN ('applied', 'countered', 'accepted', 'declined', 'withdrawn', 'expired')),
  actor_id       uuid,
  actor_role     text CHECK (actor_role IS NULL OR actor_role IN ('institution', 'professional', 'system')),
  amount         integer,
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_events_app ON public.application_events (application_id, id);
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_events_select_involved ON public.application_events;
CREATE POLICY app_events_select_involved ON public.application_events
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.applications a
       WHERE a.id = application_id
         AND (a.professional_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.job_offers o WHERE o.id = a.job_offer_id AND o.posted_by = auth.uid()))
    )
  );
GRANT SELECT ON public.application_events TO authenticated;
GRANT ALL ON public.application_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.application_events_id_seq TO service_role;

-- 3a) Inserción: el estado, la ronda y el valor los decide el servidor.
CREATE OR REPLACE FUNCTION public.applications_guard_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rpc   boolean := COALESCE(current_setting('app.application_rpc', true), '') = 'on';
  v_uid   uuid := auth.uid();
  o       public.job_offers%ROWTYPE;
  v_first timestamptz;
  v_ids   uuid[];
BEGIN
  SELECT * INTO o FROM public.job_offers WHERE id = NEW.job_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oferta no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Turnos que cubre la postulación: los elegidos o, si no se eligió, todos los abiertos.
  IF cardinality(COALESCE(NEW.shift_ids, '{}')) = 0 THEN
    SELECT COALESCE(array_agg(s.id ORDER BY s.starts_at), '{}') INTO v_ids
      FROM public.job_offer_shifts s
     WHERE s.job_offer_id = o.id AND s.status = 'open' AND s.filled < s.positions AND s.ends_at > now();
    NEW.shift_ids := v_ids;
  END IF;
  SELECT min(s.starts_at) INTO v_first FROM public.job_offer_shifts s WHERE s.id = ANY (NEW.shift_ids);

  -- Sistema (service role), staff y funciones internas: solo se completan valores por omisión.
  IF v_rpc OR v_uid IS NULL OR public.is_staff(v_uid) THEN
    NEW.posted_amount   := COALESCE(NEW.posted_amount, o.amount);
    NEW.proposed_amount := COALESCE(NEW.proposed_amount, NEW.posted_amount);
    NEW.expires_at      := COALESCE(NEW.expires_at,
      GREATEST(LEAST(now() + interval '72 hours', COALESCE(v_first - interval '1 hour', 'infinity')), now() + interval '15 minutes'));
    RETURN NEW;
  END IF;

  IF NEW.professional_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Solo puedes postularte con tu propia cuenta' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'professional'::public.app_role) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden postularse' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = v_uid AND pp.blocked) THEN
    RAISE EXCEPTION 'Tu cuenta está en revisión' USING ERRCODE = '42501';
  END IF;
  IF o.posted_by = v_uid THEN
    RAISE EXCEPTION 'No puedes postularte a tu propia oferta' USING ERRCODE = '23514';
  END IF;
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.applications a
              WHERE a.job_offer_id = o.id AND a.professional_id = v_uid AND a.status::text = 'rejected') THEN
    RAISE EXCEPTION 'La institución ya respondió a tu postulación a esta oferta' USING ERRCODE = '23514';
  END IF;

  -- Campos que solo el servidor fija.
  NEW.status := 'pending';
  NEW.round_no := 1;
  NEW.awaiting := 'institution';
  NEW.agreed_amount := NULL;
  NEW.accepted_at := NULL;
  NEW.closed_reason := NULL;
  NEW.decision_note := NULL;
  NEW.posted_amount := o.amount;
  NEW.proposed_amount := COALESCE(NEW.proposed_amount, o.amount);

  -- Los turnos elegidos deben ser de esta oferta, estar abiertos y tener cupo.
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.shift_ids) AS x(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.job_offer_shifts s
        WHERE s.id = x.id AND s.job_offer_id = o.id AND s.status = 'open'
          AND s.filled < s.positions AND s.ends_at > now())
  ) THEN
    RAISE EXCEPTION 'Alguno de los turnos ya no está disponible' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_offer_shifts s WHERE s.job_offer_id = o.id)
     AND cardinality(NEW.shift_ids) = 0 THEN
    RAISE EXCEPTION 'Esta oferta no tiene turnos abiertos' USING ERRCODE = '23514';
  END IF;

  -- Negociar el valor es una función de pago para el profesional.
  IF NEW.proposed_amount <> o.amount THEN
    IF public.plan_key_for(v_uid) = 'free' THEN
      RAISE EXCEPTION 'Negociar el valor está disponible desde el plan Esencial'
        USING ERRCODE = '42501', HINT = 'negotiate_rate_requires_plan';
    END IF;
    IF NEW.proposed_amount < public.offer_band_min(o.amount, o.modality::text)
       OR NEW.proposed_amount > public.offer_band_max(o.amount, o.modality::text) THEN
      RAISE EXCEPTION 'El valor debe estar entre % y % para esta oferta',
        public.hx_cop(public.offer_band_min(o.amount, o.modality::text)),
        public.hx_cop(public.offer_band_max(o.amount, o.modality::text))
        USING ERRCODE = '23514', HINT = 'rate_out_of_band';
    END IF;
  END IF;

  IF NEW.message IS NOT NULL THEN
    NEW.message := NULLIF(btrim(NEW.message), '');
    IF NEW.message IS NOT NULL THEN
      IF char_length(NEW.message) > 500 THEN
        RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
      END IF;
      IF public.message_has_forbidden_content(NEW.message) THEN
        RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje: el contacto se desbloquea desde tu plan y los pagos se hacen solo en la página web'
          USING ERRCODE = '23514', HINT = 'forbidden_content';
      END IF;
    END IF;
  END IF;

  IF cardinality(NEW.shift_ids) > 0 AND EXISTS (
    SELECT 1
      FROM public.job_offer_shifts s
      JOIN public.service_bookings b ON b.professional_id = v_uid
       AND b.status IN ('confirmed', 'in_route', 'in_progress')
       AND b.scheduled_at < s.ends_at
       AND b.scheduled_at + (b.duration_hours * interval '1 hour') > s.starts_at
     WHERE s.id = ANY (NEW.shift_ids)
  ) THEN
    RAISE EXCEPTION 'Ese horario se cruza con un servicio que ya tienes confirmado' USING ERRCODE = '23P01';
  END IF;

  IF (SELECT count(*) FROM public.applications a WHERE a.professional_id = v_uid AND a.status::text = 'pending') >= 30 THEN
    RAISE EXCEPTION 'Tienes demasiadas postulaciones pendientes: espera respuestas o retira alguna' USING ERRCODE = '23514';
  END IF;

  NEW.expires_at := GREATEST(
    LEAST(now() + interval '72 hours', COALESCE(v_first - interval '1 hour', 'infinity')),
    now() + interval '15 minutes');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.applications_guard_insert() FROM PUBLIC, anon, authenticated;

-- 3b) Actualización: los clientes solo pueden retirar (profesional) o rechazar (institución).
CREATE OR REPLACE FUNCTION public.applications_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rpc    boolean := COALESCE(current_setting('app.application_rpc', true), '') = 'on';
  v_uid    uuid := auth.uid();
  v_poster uuid;
BEGIN
  IF v_rpc OR v_uid IS NULL OR public.is_staff(v_uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.job_offer_id    IS DISTINCT FROM OLD.job_offer_id
     OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.proposed_amount IS DISTINCT FROM OLD.proposed_amount
     OR NEW.posted_amount   IS DISTINCT FROM OLD.posted_amount
     OR NEW.agreed_amount   IS DISTINCT FROM OLD.agreed_amount
     OR NEW.round_no        IS DISTINCT FROM OLD.round_no
     OR NEW.awaiting        IS DISTINCT FROM OLD.awaiting
     OR NEW.expires_at      IS DISTINCT FROM OLD.expires_at
     OR NEW.shift_ids       IS DISTINCT FROM OLD.shift_ids
     OR NEW.accepted_at     IS DISTINCT FROM OLD.accepted_at
     OR NEW.message         IS DISTINCT FROM OLD.message
     OR NEW.decision_note   IS DISTINCT FROM OLD.decision_note
     OR NEW.closed_reason   IS DISTINCT FROM OLD.closed_reason
  THEN
    RAISE EXCEPTION 'La postulación no se puede modificar: usa contraoferta, aceptar o rechazar'
      USING ERRCODE = '42501', HINT = 'use_application_rpc';
  END IF;

  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    IF OLD.status::text <> 'pending' THEN
      RAISE EXCEPTION 'La postulación ya no está activa' USING ERRCODE = '42501';
    END IF;
    SELECT o.posted_by INTO v_poster FROM public.job_offers o WHERE o.id = OLD.job_offer_id;
    IF NEW.status::text = 'withdrawn' AND v_uid = OLD.professional_id THEN
      NEW.closed_reason := 'professional_withdrew';
    ELSIF NEW.status::text = 'rejected' AND v_uid = v_poster THEN
      NEW.closed_reason := 'institution_declined';
    ELSE
      -- «accepted» solo por accept_application(); contraofertas solo por counter_application().
      RAISE EXCEPTION 'Cambio de estado no permitido: usa las acciones de la postulación'
        USING ERRCODE = '42501', HINT = 'use_application_rpc';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.applications_guard_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_applications_guard_insert ON public.applications;
CREATE TRIGGER trg_applications_guard_insert
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_guard_insert();

DROP TRIGGER IF EXISTS trg_applications_guard_update ON public.applications;
CREATE TRIGGER trg_applications_guard_update
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_guard_update();

-- 3c) Historial y avisos de cada cambio de la postulación.
CREATE OR REPLACE FUNCTION public.applications_after_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  o        public.job_offers%ROWTYPE;
  v_pro    text;
  v_inst   text;
  v_event  text;
  v_actor  text;
  v_to     uuid;
  v_title  text;
  v_body   text;
  v_link   text;
BEGIN
  SELECT * INTO o FROM public.job_offers WHERE id = NEW.job_offer_id;
  SELECT public.short_display_name(p.full_name) INTO v_pro FROM public.profiles p WHERE p.user_id = NEW.professional_id;
  SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), 'La institución')
    INTO v_inst FROM public.institution_profiles ip WHERE ip.user_id = o.posted_by;
  v_inst := COALESCE(v_inst, 'La institución');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_events (application_id, round_no, event, actor_id, actor_role, amount, message)
    VALUES (NEW.id, NEW.round_no, 'applied', NEW.professional_id, 'professional', NEW.proposed_amount, NEW.message);
    v_to := o.posted_by;
    v_title := 'Nueva postulación a «' || left(o.title, 60) || '»';
    v_body := COALESCE(v_pro, 'Un profesional') ||
      CASE WHEN NEW.proposed_amount IS DISTINCT FROM NEW.posted_amount
           THEN ' propone ' || public.hx_cop(NEW.proposed_amount) || ' (publicaste ' || public.hx_cop(NEW.posted_amount) || ').'
           ELSE ' acepta el valor publicado de ' || public.hx_cop(NEW.posted_amount) || '.' END ||
      ' Responde antes de que venza.';
    PERFORM public.hx_notify(v_to, 'application_received', v_title, v_body, '/dashboard/institucion');
    RETURN NEW;
  END IF;

  -- UPDATE OF status
  v_event := CASE NEW.status::text
               WHEN 'accepted'  THEN 'accepted'
               WHEN 'rejected'  THEN 'declined'
               WHEN 'withdrawn' THEN CASE WHEN NEW.closed_reason IN ('expired', 'offer_closed', 'overlapping_booking') THEN 'expired' ELSE 'withdrawn' END
               ELSE NULL END;
  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;
  v_actor := CASE
               WHEN NEW.closed_reason IN ('institution_declined') OR (v_event = 'accepted' AND NEW.awaiting = 'institution') THEN 'institution'
               WHEN NEW.closed_reason IN ('professional_withdrew', 'professional_declined_counter') OR (v_event = 'accepted' AND NEW.awaiting = 'professional') THEN 'professional'
               ELSE 'system' END;
  INSERT INTO public.application_events (application_id, round_no, event, actor_id, actor_role, amount, message)
  VALUES (NEW.id, NEW.round_no, v_event,
          CASE v_actor WHEN 'institution' THEN o.posted_by WHEN 'professional' THEN NEW.professional_id END,
          v_actor, COALESCE(NEW.agreed_amount, NEW.proposed_amount), COALESCE(NEW.decision_note, NEW.closed_reason));

  IF v_event = 'accepted' THEN
    RETURN NEW; -- los avisos de aceptación los envía accept_application() con el enlace a la reserva
  END IF;

  IF NEW.closed_reason IN ('institution_declined', 'offer_filled', 'offer_closed') THEN
    v_to := NEW.professional_id;
    v_link := '/dashboard/profesional';
    v_title := CASE NEW.closed_reason
                 WHEN 'institution_declined' THEN v_inst || ' no continuará con tu postulación'
                 WHEN 'offer_filled' THEN 'El turno ya fue cubierto'
                 ELSE 'La oferta se cerró' END;
    v_body := 'Hay más turnos abiertos que se ajustan a tu perfil.';
  ELSIF NEW.closed_reason IN ('professional_withdrew', 'professional_declined_counter') THEN
    v_to := o.posted_by;
    v_link := '/dashboard/institucion';
    v_title := COALESCE(v_pro, 'Un profesional') || ' retiró su postulación';
    v_body := 'Oferta «' || left(o.title, 60) || '».';
  ELSIF NEW.closed_reason = 'expired' THEN
    v_to := NEW.professional_id;
    v_link := '/dashboard/profesional';
    v_title := 'Tu postulación a «' || left(o.title, 60) || '» venció sin respuesta';
    v_body := 'Puedes volver a postularte si el turno sigue abierto.';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.hx_notify(v_to, 'application_' || NEW.status::text, v_title, v_body, v_link);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'applications_after_change: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.applications_after_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_applications_after_insert ON public.applications;
CREATE TRIGGER trg_applications_after_insert
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_after_change();

DROP TRIGGER IF EXISTS trg_applications_after_status ON public.applications;
CREATE TRIGGER trg_applications_after_status
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.applications_after_change();

-- Vencimiento de postulaciones sin respuesta. Se llama desde las funciones y desde pg_cron.
CREATE OR REPLACE FUNCTION public.expire_stale_applications()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('app.application_rpc', true);
  v_n    integer := 0;
  v_m    integer := 0;
BEGIN
  PERFORM set_config('app.application_rpc', 'on', true);
  UPDATE public.applications
     SET status = 'withdrawn', closed_reason = 'expired'
   WHERE status::text = 'pending' AND expires_at IS NOT NULL AND expires_at <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.applications a
     SET status = 'rejected', closed_reason = 'offer_closed'
    FROM public.job_offers o
   WHERE o.id = a.job_offer_id AND a.status::text = 'pending' AND o.status::text = 'closed';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);
  RETURN v_n + v_m;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_applications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_applications() TO service_role;

-- ─── 4) Publicar ofertas con agenda de turnos ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.publish_institution_offer(p_offer jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid := auth.uid();
  v_title    text := NULLIF(btrim(COALESCE(p_offer ->> 'title', '')), '');
  v_desc     text := NULLIF(btrim(COALESCE(p_offer ->> 'description', '')), '');
  v_modality text := COALESCE(NULLIF(btrim(COALESCE(p_offer ->> 'modality', '')), ''), 'shift');
  v_city     text := NULLIF(btrim(COALESCE(p_offer ->> 'city', '')), '');
  v_spec     text := NULLIF(btrim(COALESCE(p_offer ->> 'specialty_required', '')), '');
  v_area     text := NULLIF(btrim(COALESCE(p_offer ->> 'service_area', '')), '');
  v_notes    text := NULLIF(btrim(COALESCE(p_offer ->> 'access_notes', '')), '');
  v_address  text := NULLIF(btrim(COALESCE(p_offer ->> 'address', '')), '');
  v_phone    text := NULLIF(btrim(COALESCE(p_offer ->> 'contact_phone', '')), '');
  v_shifts   jsonb := COALESCE(p_offer -> 'shifts', '[]'::jsonb);
  v_reqs     text[] := '{}';
  v_amount   integer;
  v_floor    integer;
  v_cap      integer;
  v_urgent   boolean := COALESCE((p_offer ->> 'is_urgent')::boolean, false);
  v_lat      double precision := NULLIF(p_offer ->> 'lat', '')::double precision;
  v_lng      double precision := NULLIF(p_offer ->> 'lng', '')::double precision;
  v_offer    uuid;
  s          jsonb;
  r          jsonb;
  v_start    timestamptz;
  v_end      timestamptz;
  v_pos      integer;
  v_min      timestamptz;
  v_max      timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'institution'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'Solo las instituciones pueden publicar turnos' USING ERRCODE = '42501';
  END IF;

  IF v_title IS NULL OR char_length(v_title) < 5 OR char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'El título debe tener entre 5 y 120 caracteres' USING ERRCODE = '23514';
  END IF;
  IF v_city IS NULL OR char_length(v_city) > 80 THEN
    RAISE EXCEPTION 'Indica la ciudad del servicio' USING ERRCODE = '23514';
  END IF;
  IF v_modality NOT IN ('hour', 'shift', 'month', 'package') THEN
    RAISE EXCEPTION 'Modalidad no válida' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_offer -> 'amount') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Indica el valor ofrecido' USING ERRCODE = '23514';
  END IF;
  v_amount := (p_offer ->> 'amount')::numeric::integer;
  v_floor := public.offer_band_min(1, v_modality);
  v_cap := CASE v_modality WHEN 'hour' THEN 250000 WHEN 'shift' THEN 3000000 WHEN 'month' THEN 30000000 ELSE 50000000 END;
  IF v_amount < v_floor OR v_amount > v_cap THEN
    RAISE EXCEPTION 'El valor debe estar entre % y % para esta modalidad', public.hx_cop(v_floor), public.hx_cop(v_cap)
      USING ERRCODE = '23514';
  END IF;

  -- Lo público de la oferta no puede llevar contacto: el teléfono y la dirección van en campos propios.
  IF v_desc IS NOT NULL AND (char_length(v_desc) > 2000 OR public.message_has_forbidden_content(v_desc)) THEN
    RAISE EXCEPTION 'La descripción no puede incluir teléfonos, correos, enlaces, direcciones ni datos de pago (máx. 2000 caracteres)'
      USING ERRCODE = '23514', HINT = 'forbidden_content';
  END IF;
  IF public.message_has_forbidden_content(v_title) OR (v_area IS NOT NULL AND public.message_has_forbidden_content(v_area)) THEN
    RAISE EXCEPTION 'El título y el servicio no pueden incluir datos de contacto' USING ERRCODE = '23514', HINT = 'forbidden_content';
  END IF;
  IF jsonb_typeof(p_offer -> 'requirements') = 'array' THEN
    IF jsonb_array_length(p_offer -> 'requirements') > 10 THEN
      RAISE EXCEPTION 'Máximo 10 requisitos' USING ERRCODE = '23514';
    END IF;
    FOR r IN SELECT * FROM jsonb_array_elements(p_offer -> 'requirements') LOOP
      IF jsonb_typeof(r) = 'string' AND NULLIF(btrim(r #>> '{}'), '') IS NOT NULL THEN
        IF char_length(r #>> '{}') > 120 OR public.message_has_forbidden_content(r #>> '{}') THEN
          RAISE EXCEPTION 'Los requisitos no pueden superar 120 caracteres ni incluir datos de contacto' USING ERRCODE = '23514';
        END IF;
        v_reqs := v_reqs || btrim(r #>> '{}');
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_shifts) <> 'array' OR jsonb_array_length(v_shifts) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Agrega entre 1 y 60 turnos' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM public.job_offers o
       WHERE o.posted_by = v_uid AND o.status::text = 'open') >= 50 THEN
    RAISE EXCEPTION 'Tienes demasiadas ofertas abiertas: cierra las que ya no necesites' USING ERRCODE = '23514';
  END IF;

  -- Validar todos los turnos antes de insertar nada.
  FOR s IN SELECT * FROM jsonb_array_elements(v_shifts) LOOP
    v_start := (s ->> 'starts_at')::timestamptz;
    v_end   := (s ->> 'ends_at')::timestamptz;
    v_pos   := COALESCE((s ->> 'positions')::integer, 1);
    IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start OR v_end - v_start > interval '24 hours' THEN
      RAISE EXCEPTION 'Cada turno debe tener una hora de inicio y de fin válidas (máximo 24 horas)' USING ERRCODE = '23514';
    END IF;
    IF v_start < now() - interval '1 hour' THEN
      RAISE EXCEPTION 'Los turnos deben empezar en el futuro' USING ERRCODE = '23514';
    END IF;
    IF v_pos NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'Cada turno admite entre 1 y 50 profesionales' USING ERRCODE = '23514';
    END IF;
    v_min := LEAST(COALESCE(v_min, v_start), v_start);
    v_max := GREATEST(COALESCE(v_max, v_end), v_end);
  END LOOP;

  INSERT INTO public.job_offers (
    posted_by, poster_type, title, description, modality, amount, city, specialty_required,
    requirements, start_date, end_date, shifts_count, status, is_urgent, service_area,
    address, contact_phone, lat, lng
  ) VALUES (
    v_uid, 'institution', v_title, v_desc, v_modality::public.offer_modality, v_amount, v_city, v_spec,
    v_reqs, v_min, v_max, jsonb_array_length(v_shifts), 'open', v_urgent, v_area,
    v_address, v_phone, v_lat, v_lng
  ) RETURNING id INTO v_offer;

  IF v_notes IS NOT NULL THEN
    INSERT INTO public.job_offer_private AS p (job_offer_id, access_notes)
    VALUES (v_offer, left(v_notes, 300))
    ON CONFLICT (job_offer_id) DO UPDATE SET access_notes = EXCLUDED.access_notes, updated_at = now();
  END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(v_shifts) LOOP
    INSERT INTO public.job_offer_shifts (job_offer_id, starts_at, ends_at, positions)
    VALUES (v_offer, (s ->> 'starts_at')::timestamptz, (s ->> 'ends_at')::timestamptz,
            COALESCE((s ->> 'positions')::integer, 1));
  END LOOP;

  PERFORM public.notify_offer_alerts(v_offer);
  RETURN v_offer;
END;
$$;

-- ─── 5) Lectura segura para profesionales ───────────────────────────────────────

-- Reputación agregada de una institución (los comentarios de texto NO se exponen). Mínimo 3 calificaciones.
CREATE OR REPLACE FUNCTION public.institution_reputation(p_institution uuid)
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
  IF NOT (v_uid = p_institution OR public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer, round(avg(sr.stars)::numeric, 2)
    INTO v_n, v_avg
    FROM public.service_ratings sr WHERE sr.rated_id = p_institution;
  SELECT count(*)::integer INTO v_done
    FROM public.service_bookings b WHERE b.client_id = p_institution AND b.status = 'completed';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('dimension', t.dimension, 'average', t.average, 'ratings', t.ratings)
                            ORDER BY t.dimension), '[]'::jsonb)
    INTO v_dims
    FROM (
      SELECT d.key AS dimension, round(avg(d.value::numeric), 2) AS average, count(*)::integer AS ratings
        FROM public.service_rating_dimensions r,
             LATERAL jsonb_each_text(r.scores) AS d(key, value)
       WHERE r.rated_id = p_institution AND r.rater_role = 'professional'
       GROUP BY d.key
      HAVING count(*) >= 3
    ) t;

  RETURN QUERY SELECT v_n, CASE WHEN v_n >= 3 THEN v_avg END, v_done, v_dims;
END;
$$;

-- Ofertas abiertas de instituciones SIN dirección ni teléfono. La agenda trae solo turnos con cupo.
CREATE OR REPLACE FUNCTION public.list_open_institution_offers(p_limit integer DEFAULT 200)
RETURNS TABLE (
  offer_id             uuid,
  institution_user_id  uuid,
  institution_name     text,
  institution_type     text,
  institution_verified boolean,
  title                text,
  description          text,
  city                 text,
  service_area         text,
  specialty_required   text,
  requirements         text[],
  modality             text,
  amount               integer,
  is_urgent            boolean,
  start_date           timestamptz,
  end_date             timestamptz,
  positions_total      integer,
  positions_filled     integer,
  shifts               jsonb,
  created_at           timestamptz,
  lat                  double precision,
  lng                  double precision,
  my_application_id    uuid,
  my_status            text,
  my_awaiting          text,
  my_amount            integer,
  rating_count         integer,
  rating_avg           numeric,
  completed_services   integer
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
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id,
         o.posted_by,
         COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Institución de salud'),
         ip.institution_type,
         COALESCE(ip.verified, false),
         o.title, o.description, o.city, o.service_area, o.specialty_required,
         COALESCE(o.requirements, '{}'::text[]),
         o.modality::text, o.amount, o.is_urgent,
         COALESCE(sh.first_start, o.start_date),
         COALESCE(sh.last_end, o.end_date),
         COALESCE(sh.pos_total, 0), COALESCE(sh.pos_filled, 0),
         COALESCE(sh.shifts, '[]'::jsonb),
         o.created_at, o.lat, o.lng,
         ma.id, ma.status::text, ma.awaiting, ma.proposed_amount,
         rt.n, CASE WHEN rt.n >= 3 THEN rt.avg END, cs.n
    FROM public.job_offers o
    LEFT JOIN public.institution_profiles ip ON ip.user_id = o.posted_by
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                                          'positions', s.positions, 'filled', s.filled)
                       ORDER BY s.starts_at)
               FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS shifts,
             min(s.starts_at) FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS first_start,
             max(s.ends_at)   FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) AS last_end,
             COALESCE(sum(s.positions) FILTER (WHERE s.status <> 'cancelled' AND s.ends_at > now()), 0)::integer AS pos_total,
             COALESCE(sum(s.filled)    FILTER (WHERE s.status <> 'cancelled' AND s.ends_at > now()), 0)::integer AS pos_filled,
             (count(*) FILTER (WHERE s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()))::integer AS open_n,
             (count(*) > 0) AS has_any
        FROM public.job_offer_shifts s WHERE s.job_offer_id = o.id
    ) sh ON true
    LEFT JOIN LATERAL (
      SELECT a.id, a.status, a.awaiting, a.proposed_amount
        FROM public.applications a
       WHERE a.job_offer_id = o.id AND a.professional_id = v_uid
       ORDER BY a.created_at DESC LIMIT 1
    ) ma ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n, round(avg(sr.stars)::numeric, 2) AS avg
        FROM public.service_ratings sr WHERE sr.rated_id = o.posted_by
    ) rt ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS n
        FROM public.service_bookings b WHERE b.client_id = o.posted_by AND b.status = 'completed'
    ) cs ON true
   WHERE o.poster_type::text = 'institution'
     AND o.status::text = 'open'
     AND NOT o.blocked
     AND o.posted_by <> v_uid
     AND (COALESCE(sh.open_n, 0) > 0 OR (NOT COALESCE(sh.has_any, false) AND (o.end_date IS NULL OR o.end_date > now())))
   ORDER BY o.is_urgent DESC, COALESCE(sh.first_start, o.start_date, o.created_at) ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 400);
END;
$$;

-- ─── 6) Postularse, contraofertar, aceptar y rechazar ───────────────────────────

-- Sin p_amount se acepta el valor publicado. Con otro valor se negocia (plan de pago, rango 0,8×–2×).
-- Toda la validación vive en applications_guard_insert(): aplica igual a quien inserte por la API.
CREATE OR REPLACE FUNCTION public.apply_to_offer(
  p_offer_id  uuid,
  p_amount    integer DEFAULT NULL,
  p_message   text    DEFAULT NULL,
  p_shift_ids uuid[]  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'professional'::public.app_role) THEN
    RAISE EXCEPTION 'Solo los profesionales pueden postularse' USING ERRCODE = '42501';
  END IF;
  PERFORM public.expire_stale_applications();

  IF NOT EXISTS (SELECT 1 FROM public.job_offers WHERE id = p_offer_id) THEN
    RAISE EXCEPTION 'Oferta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.applications a
              WHERE a.job_offer_id = p_offer_id AND a.professional_id = v_uid
                AND a.status::text IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'Ya te postulaste a esta oferta' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.applications (job_offer_id, professional_id, message, proposed_amount, shift_ids)
  VALUES (p_offer_id, v_uid, NULLIF(btrim(COALESCE(p_message, '')), ''), p_amount, COALESCE(p_shift_ids, '{}'::uuid[]))
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;

-- Contraoferta: responde quien tiene el turno de la negociación. Máximo 3 rondas en total (la 3 es
-- «última oferta»), cada oferta vence a las 24 h y el valor debe estar en el rango permitido. El
-- profesional necesita plan de pago para negociar; la institución no. Mientras la institución no
-- responda, el profesional puede cambiar su propia propuesta (sin gastar una ronda).
CREATE OR REPLACE FUNCTION public.counter_application(
  p_application_id uuid,
  p_amount         integer,
  p_message        text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_prev  text := current_setting('app.application_rpc', true);
  a       public.applications%ROWTYPE;
  o       public.job_offers%ROWTYPE;
  v_role   text;
  v_revise boolean := false;
  v_msg    text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_first  timestamptz;
  v_exp    timestamptz;
  v_name   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM public.expire_stale_applications();

  SELECT * INTO a FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id;
  IF a.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La postulación ya no está activa (%)', a.status::text USING ERRCODE = '23514';
  END IF;

  IF a.awaiting = 'institution' AND v_uid = o.posted_by THEN
    v_role := 'institution';
  ELSIF a.awaiting = 'professional' AND v_uid = a.professional_id THEN
    v_role := 'professional';
  ELSIF a.awaiting = 'institution' AND v_uid = a.professional_id THEN
    -- El profesional cambia SU propuesta mientras la institución no responde: no gasta una ronda.
    v_role := 'professional';
    v_revise := true;
  ELSE
    RAISE EXCEPTION 'Solo quien debe responder puede contraofertar' USING ERRCODE = '42501';
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
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;
  IF a.round_no >= 3 THEN
    RAISE EXCEPTION 'Esta es la última oferta: solo puedes aceptarla o rechazarla' USING ERRCODE = '23514', HINT = 'final_round';
  END IF;
  IF p_amount IS NULL
     OR p_amount < public.offer_band_min(a.posted_amount, o.modality::text)
     OR p_amount > public.offer_band_max(a.posted_amount, o.modality::text) THEN
    RAISE EXCEPTION 'El valor debe estar entre % y % para esta oferta',
      public.hx_cop(public.offer_band_min(a.posted_amount, o.modality::text)),
      public.hx_cop(public.offer_band_max(a.posted_amount, o.modality::text))
      USING ERRCODE = '23514', HINT = 'rate_out_of_band';
  END IF;
  IF p_amount = a.proposed_amount THEN
    RAISE EXCEPTION 'La contraoferta debe cambiar el valor; si estás de acuerdo, acepta' USING ERRCODE = '23514';
  END IF;
  IF v_msg IS NOT NULL THEN
    IF char_length(v_msg) > 500 THEN
      RAISE EXCEPTION 'El mensaje es demasiado largo (máximo 500 caracteres)' USING ERRCODE = '23514';
    END IF;
    IF public.message_has_forbidden_content(v_msg) THEN
      RAISE EXCEPTION 'No incluyas teléfonos, correos, enlaces ni datos de pago en el mensaje' USING ERRCODE = '23514', HINT = 'forbidden_content';
    END IF;
  END IF;

  SELECT min(s.starts_at) INTO v_first FROM public.job_offer_shifts s WHERE s.id = ANY (a.shift_ids);
  v_exp := GREATEST(
    LEAST(now() + CASE WHEN v_revise AND a.round_no <= 1 THEN interval '72 hours' ELSE interval '24 hours' END,
          COALESCE(v_first - interval '1 hour', 'infinity')),
    now() + interval '15 minutes');

  PERFORM set_config('app.application_rpc', 'on', true);
  IF v_revise THEN
    UPDATE public.applications SET proposed_amount = p_amount, expires_at = v_exp WHERE id = a.id;
  ELSE
    UPDATE public.applications
       SET proposed_amount = p_amount,
           round_no = a.round_no + 1,
           awaiting = CASE v_role WHEN 'institution' THEN 'professional' ELSE 'institution' END,
           expires_at = v_exp
     WHERE id = a.id;
  END IF;
  PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);

  INSERT INTO public.application_events (application_id, round_no, event, actor_id, actor_role, amount, message)
  VALUES (a.id, CASE WHEN v_revise THEN a.round_no ELSE a.round_no + 1 END, 'countered', v_uid, v_role, p_amount, v_msg);

  IF v_role = 'institution' THEN
    SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), 'La institución') INTO v_name
      FROM public.institution_profiles ip WHERE ip.user_id = o.posted_by;
    PERFORM public.hx_notify(a.professional_id, 'application_counter_offer',
      CASE WHEN a.round_no + 1 >= 3 THEN 'Última oferta recibida' ELSE 'Nueva contraoferta' END,
      COALESCE(v_name, 'La institución') || ' propone ' || public.hx_cop(p_amount) || ' para «' || left(o.title, 60) || '». Respóndela antes de que venza.',
      '/dashboard/profesional');
  ELSE
    SELECT public.short_display_name(p.full_name) INTO v_name FROM public.profiles p WHERE p.user_id = a.professional_id;
    PERFORM public.hx_notify(o.posted_by, 'application_counter_offer',
      CASE WHEN v_revise THEN 'Actualizaron una propuesta'
           WHEN a.round_no + 1 >= 3 THEN 'Última oferta recibida' ELSE 'Nueva contraoferta' END,
      COALESCE(v_name, 'El profesional') || CASE WHEN v_revise THEN ' ahora propone ' ELSE ' propone ' END ||
        public.hx_cop(p_amount) || ' para «' || left(o.title, 60) || '». Respóndela antes de que venza.',
      '/dashboard/institucion');
  END IF;
  RETURN CASE WHEN v_revise THEN a.round_no ELSE a.round_no + 1 END;
END;
$$;

-- Rechazar (institución) o retirar / rechazar la contraoferta (profesional).
CREATE OR REPLACE FUNCTION public.decline_application(p_application_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  v_prev text := current_setting('app.application_rpc', true);
  a      public.applications%ROWTYPE;
  o      public.job_offers%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO a FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id;
  IF a.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La postulación ya no está activa (%)', a.status::text USING ERRCODE = '23514';
  END IF;
  IF v_note IS NOT NULL AND (char_length(v_note) > 300 OR public.message_has_forbidden_content(v_note)) THEN
    RAISE EXCEPTION 'La nota no puede incluir datos de contacto ni de pago (máx. 300 caracteres)' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.application_rpc', 'on', true);
  IF v_uid = o.posted_by THEN
    UPDATE public.applications SET status = 'rejected', closed_reason = 'institution_declined', decision_note = v_note WHERE id = a.id;
  ELSIF v_uid = a.professional_id THEN
    UPDATE public.applications
       SET status = 'withdrawn',
           closed_reason = CASE WHEN a.awaiting = 'professional' THEN 'professional_declined_counter' ELSE 'professional_withdrew' END,
           decision_note = v_note
     WHERE id = a.id;
  ELSE
    PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);
    RAISE EXCEPTION 'No participas en esta postulación' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);
END;
$$;

-- Aceptar la postulación (la parte a la que le toca responder). Crea una reserva por turno con la
-- dirección del servicio, ocupa los cupos, cierra lo que quede inservible y genera el contrato.
-- p_shifts solo se usa en ofertas antiguas sin agenda: [{"starts_at": "...", "ends_at": "..."}].
CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid, p_shifts jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  v_prev      text := current_setting('app.application_rpc', true);
  a           public.applications%ROWTYPE;
  o           public.job_offers%ROWTYPE;
  sh          public.job_offer_shifts%ROWTYPE;
  v_role      text;
  v_ids       uuid[];
  v_new_ids   uuid[] := '{}';
  v_n         integer;
  v_agreed    integer;
  v_pct       numeric;
  v_hours     numeric;
  v_total     integer;
  v_rate      integer;
  v_fee       integer;
  v_address   text;
  v_lat       double precision;
  v_lng       double precision;
  v_booking   uuid;
  v_bookings  uuid[] := '{}';
  v_pairs     jsonb := '[]'::jsonb;
  v_contract  uuid;
  v_inst_name text;
  v_pro_name  text;
  e           jsonb;
  v_start     timestamptz;
  v_end       timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  PERFORM public.expire_stale_applications();

  SELECT * INTO a FROM public.applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id FOR UPDATE;
  IF a.status::text <> 'pending' THEN
    RAISE EXCEPTION 'La postulación ya no está disponible (%)', a.status::text USING ERRCODE = '23514';
  END IF;
  IF a.expires_at IS NOT NULL AND a.expires_at <= now() THEN
    RAISE EXCEPTION 'La oferta venció' USING ERRCODE = '23514';
  END IF;

  IF a.awaiting = 'institution' AND v_uid = o.posted_by THEN
    v_role := 'institution';
  ELSIF a.awaiting = 'professional' AND v_uid = a.professional_id THEN
    v_role := 'professional';
  ELSE
    RAISE EXCEPTION 'Solo quien debe responder puede aceptar' USING ERRCODE = '42501';
  END IF;
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = a.professional_id AND pp.blocked) THEN
    RAISE EXCEPTION 'La cuenta del profesional está en revisión' USING ERRCODE = '42501';
  END IF;

  -- Turnos que se confirman: los de la postulación (o todos los abiertos) o, en ofertas antiguas sin
  -- agenda, los que define la institución al aceptar.
  v_ids := a.shift_ids;
  IF COALESCE(cardinality(v_ids), 0) = 0 THEN
    SELECT COALESCE(array_agg(s.id ORDER BY s.starts_at), '{}') INTO v_ids
      FROM public.job_offer_shifts s
     WHERE s.job_offer_id = o.id AND s.status = 'open' AND s.filled < s.positions
       AND s.ends_at > now();
  END IF;
  IF COALESCE(cardinality(v_ids), 0) = 0 THEN
    IF v_role = 'institution' AND p_shifts IS NOT NULL AND jsonb_typeof(p_shifts) = 'array'
       AND jsonb_array_length(p_shifts) BETWEEN 1 AND 60 THEN
      PERFORM set_config('app.application_rpc', 'on', true);
      FOR e IN SELECT * FROM jsonb_array_elements(p_shifts) LOOP
        v_start := (e ->> 'starts_at')::timestamptz;
        v_end := (e ->> 'ends_at')::timestamptz;
        IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start OR v_end - v_start > interval '24 hours'
           OR v_start < now() - interval '1 hour' THEN
          PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);
          RAISE EXCEPTION 'Cada turno debe tener horas de inicio y fin válidas y estar en el futuro' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.job_offer_shifts (job_offer_id, starts_at, ends_at, positions)
        VALUES (o.id, v_start, v_end, 1) RETURNING id INTO v_booking;
        v_new_ids := v_new_ids || v_booking;
      END LOOP;
      PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);
      v_ids := v_new_ids;
      v_booking := NULL;
    ELSE
      RAISE EXCEPTION 'Define el horario del turno para poder aceptar' USING ERRCODE = '23514', HINT = 'shifts_required';
    END IF;
  END IF;

  PERFORM 1 FROM public.job_offer_shifts s WHERE s.id = ANY (v_ids) ORDER BY s.id FOR UPDATE;
  SELECT count(*) INTO v_n FROM public.job_offer_shifts s
   WHERE s.id = ANY (v_ids) AND s.job_offer_id = o.id AND s.status = 'open' AND s.filled < s.positions
     AND s.ends_at > now();
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Alguno de los turnos ya no tiene cupo' USING ERRCODE = '23514', HINT = 'shift_full';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.job_offer_shifts s
      JOIN public.service_bookings b ON b.professional_id = a.professional_id
       AND b.status IN ('confirmed', 'in_route', 'in_progress')
       AND b.scheduled_at < s.ends_at
       AND b.scheduled_at + (b.duration_hours * interval '1 hour') > s.starts_at
     WHERE s.id = ANY (v_ids)
  ) THEN
    RAISE EXCEPTION 'El profesional ya tiene un servicio confirmado en ese horario' USING ERRCODE = '23P01';
  END IF;

  v_agreed := a.proposed_amount;
  v_pct := public.platform_commission_pct(a.professional_id);

  SELECT NULLIF(btrim(p.address), ''), p.exact_lat, p.exact_lng
    INTO v_address, v_lat, v_lng FROM public.job_offer_private p WHERE p.job_offer_id = o.id;
  IF v_address IS NULL THEN
    SELECT NULLIF(btrim(ip.address), '') INTO v_address FROM public.institution_profiles ip WHERE ip.user_id = o.posted_by;
  END IF;

  PERFORM set_config('app.application_rpc', 'on', true);

  v_n := cardinality(v_ids);
  FOR sh IN SELECT * FROM public.job_offer_shifts s WHERE s.id = ANY (v_ids) ORDER BY s.starts_at LOOP
    v_hours := round(EXTRACT(EPOCH FROM (sh.ends_at - sh.starts_at)) / 3600.0, 2);
    IF o.modality::text = 'hour' THEN
      v_total := round(v_agreed * v_hours)::integer;
      v_rate  := v_agreed;
    ELSIF o.modality::text = 'shift' THEN
      v_total := v_agreed;
      v_rate  := round(v_agreed / v_hours)::integer;
    ELSE
      v_total := round(v_agreed::numeric / v_n)::integer;
      v_rate  := round(v_total / v_hours)::integer;
    END IF;
    v_fee := round(v_total * v_pct / 100.0)::integer;

    INSERT INTO public.service_bookings (
      client_id, professional_id, job_offer_id, application_id, job_offer_shift_id, status,
      scheduled_at, duration_hours, hourly_rate, total_amount, platform_fee_pct, platform_fee_amount,
      professional_payout, payment_mode, service_address, service_lat, service_lng
    ) VALUES (
      o.posted_by, a.professional_id, o.id, a.id, sh.id, 'confirmed',
      sh.starts_at, v_hours, v_rate, v_total, v_pct, v_fee,
      v_total - v_fee, 'pending', v_address, v_lat, v_lng
    ) RETURNING id INTO v_booking;
    v_bookings := v_bookings || v_booking;
    v_pairs := v_pairs || jsonb_build_array(jsonb_build_object(
      'shift_id', sh.id, 'booking_id', v_booking, 'starts_at', sh.starts_at, 'ends_at', sh.ends_at,
      'hours', v_hours, 'amount', v_total));

    UPDATE public.job_offer_shifts
       SET filled = filled + 1,
           status = CASE WHEN filled + 1 >= positions THEN 'filled' ELSE status END
     WHERE id = sh.id;

    INSERT INTO public.availability_slots (user_id, starts_at, ends_at, status)
    VALUES (a.professional_id, sh.starts_at, sh.ends_at, 'busy');
  END LOOP;

  UPDATE public.applications
     SET status = 'accepted', agreed_amount = v_agreed, accepted_at = now(), shift_ids = v_ids,
         expires_at = NULL, decision_note = NULL
   WHERE id = a.id;

  -- Otras postulaciones pendientes del mismo profesional que ahora se cruzan quedan sin efecto.
  UPDATE public.applications x
     SET status = 'withdrawn', closed_reason = 'overlapping_booking'
   WHERE x.professional_id = a.professional_id AND x.id <> a.id AND x.status::text = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.job_offer_shifts s1
        JOIN public.job_offer_shifts s2 ON s2.id = ANY (v_ids)
          AND s1.starts_at < s2.ends_at AND s1.ends_at > s2.starts_at
       WHERE s1.id = ANY (x.shift_ids));

  -- Postulaciones de otros profesionales cuyos turnos ya se llenaron.
  UPDATE public.applications x
     SET status = 'rejected', closed_reason = 'offer_filled'
   WHERE x.job_offer_id = o.id AND x.id <> a.id AND x.status::text = 'pending'
     AND cardinality(x.shift_ids) > 0
     AND NOT EXISTS (SELECT 1 FROM public.job_offer_shifts s
                      WHERE s.id = ANY (x.shift_ids) AND s.status = 'open' AND s.filled < s.positions);

  -- La oferta se cierra como cubierta cuando ya no queda ningún cupo abierto.
  IF NOT EXISTS (SELECT 1 FROM public.job_offer_shifts s
                  WHERE s.job_offer_id = o.id AND s.status = 'open' AND s.filled < s.positions AND s.ends_at > now()) THEN
    UPDATE public.job_offers SET status = 'filled' WHERE id = o.id;
  END IF;

  -- El contrato inteligente aplica a instituciones (identidad: NIT + representante legal verificados).
  -- Las ofertas de familias siguen su propio flujo y no generan un contrato que nadie podría firmar.
  IF o.poster_type::text = 'institution' THEN
    v_contract := public.create_contract_for_application(a.id, v_pairs);
  END IF;
  PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);

  SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), 'La institución') INTO v_inst_name
    FROM public.institution_profiles ip WHERE ip.user_id = o.posted_by;
  SELECT public.short_display_name(p.full_name) INTO v_pro_name FROM public.profiles p WHERE p.user_id = a.professional_id;

  PERFORM public.hx_notify(a.professional_id, 'application_accepted',
    '¡Te aceptaron en «' || left(o.title, 60) || '»!',
    COALESCE(v_inst_name, 'La institución') || ' confirmó ' || v_n || CASE WHEN v_n = 1 THEN ' turno' ELSE ' turnos' END ||
      ' a ' || public.hx_cop(v_agreed) || '.' ||
      CASE WHEN v_contract IS NOT NULL THEN ' Revisa y firma el contrato inteligente.' ELSE ' Coordina los detalles desde la reserva.' END,
    '/servicio/' || v_bookings[1]::text);
  PERFORM public.hx_notify(o.posted_by, 'booking_confirmed',
    'Reserva confirmada con ' || COALESCE(v_pro_name, 'el profesional'),
    v_n || CASE WHEN v_n = 1 THEN ' turno confirmado' ELSE ' turnos confirmados' END ||
      ' en «' || left(o.title, 60) || '».' ||
      CASE WHEN v_contract IS NOT NULL THEN ' El contrato está listo para firmar.' ELSE '' END,
    '/servicio/' || v_bookings[1]::text);

  RETURN jsonb_build_object('booking_ids', to_jsonb(v_bookings), 'contract_id', v_contract, 'agreed_amount', v_agreed, 'shifts', v_n);
END;
$$;

-- ─── 7) Desbloqueo de contacto (dirección, WhatsApp) con cupo diario ────────────

ALTER TABLE public.opportunity_contact_reveals
  ADD COLUMN IF NOT EXISTS job_offer_id     uuid REFERENCES public.job_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counterpart_kind text NOT NULL DEFAULT 'family';

-- Aplica plan, cupo diario (contrapartes distintas), auditoría y aviso a la contraparte.
-- Devuelve cuántos desbloqueos le quedan hoy. Uso interno de las funciones de abajo.
CREATE OR REPLACE FUNCTION public.consume_reveal_quota(p_pro uuid, p_counterpart uuid, p_offer uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_today   date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_plan    text := public.plan_key_for(p_pro);
  v_quota   integer := public.reveal_daily_quota(public.plan_key_for(p_pro));
  v_used    integer;
  v_already boolean;
  v_name    text;
  v_title   text;
  v_kind    text;
BEGIN
  IF v_quota = 0 THEN
    RAISE EXCEPTION 'Ver la dirección y el WhatsApp está disponible desde el plan Esencial'
      USING ERRCODE = '42501', HINT = 'plan_required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.opportunity_contact_reveals r
                  WHERE r.professional_id = p_pro AND r.family_user_id = p_counterpart AND r.revealed_on = v_today),
         (SELECT count(DISTINCT r.family_user_id)::integer FROM public.opportunity_contact_reveals r
           WHERE r.professional_id = p_pro AND r.revealed_on = v_today)
    INTO v_already, v_used;
  IF NOT v_already AND v_used >= v_quota THEN
    RAISE EXCEPTION 'Alcanzaste el límite diario de contactos desbloqueados (%)', v_quota
      USING ERRCODE = '42501', HINT = 'quota_exceeded';
  END IF;

  -- Una fila de auditoría por contraparte y día (repetir el desbloqueo no consume cupo ni vuelve a avisar).
  IF NOT v_already THEN
    SELECT CASE o.poster_type::text WHEN 'institution' THEN 'institution' ELSE 'family' END, o.title
      INTO v_kind, v_title FROM public.job_offers o WHERE o.id = p_offer;
    -- Reservas sin oferta (flujo de familias): el tipo sale del rol de la contraparte.
    v_kind := COALESCE(v_kind, CASE WHEN public.has_role(p_counterpart, 'institution'::public.app_role) THEN 'institution' ELSE 'family' END);
    INSERT INTO public.opportunity_contact_reveals (professional_id, family_user_id, plan, job_offer_id, counterpart_kind)
    VALUES (p_pro, p_counterpart, v_plan, p_offer, v_kind);
    SELECT public.short_display_name(p.full_name) INTO v_name FROM public.profiles p WHERE p.user_id = p_pro;
    PERFORM public.hx_notify(p_counterpart, 'contact_revealed', 'Un profesional desbloqueó tu contacto',
      COALESCE(v_name, 'Un profesional') || ' vio los datos de contacto' ||
        CASE WHEN v_title IS NOT NULL THEN ' de «' || left(v_title, 60) || '»' ELSE '' END || ' para coordinar el servicio.',
      CASE WHEN v_kind = 'institution' THEN '/dashboard/institucion' ELSE '/dashboard/familia' END);
  END IF;
  RETURN GREATEST(v_quota - v_used - CASE WHEN v_already THEN 0 ELSE 1 END, 0);
END;
$$;

-- Dirección y contacto de la oferta para el profesional que ya se postuló (o fue aceptado).
CREATE OR REPLACE FUNCTION public.reveal_offer_contact(p_application_id uuid)
RETURNS TABLE (
  counterpart_name text,
  whatsapp         text,
  phone            text,
  address          text,
  access_notes     text,
  city             text,
  revealed_at      timestamptz,
  reveals_left     integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  a      public.applications%ROWTYPE;
  o      public.job_offers%ROWTYPE;
  v_left integer;
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

  SELECT * INTO a FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND OR a.professional_id <> v_uid THEN
    RAISE EXCEPTION 'Postúlate primero a esta oferta para desbloquear el contacto'
      USING ERRCODE = '42501', HINT = 'application_required';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id;
  IF a.status::text NOT IN ('pending', 'accepted')
     OR (a.status::text = 'pending' AND a.expires_at IS NOT NULL AND a.expires_at <= now()) THEN
    RAISE EXCEPTION 'Tu postulación ya no está vigente' USING ERRCODE = '42501', HINT = 'application_required';
  END IF;

  v_left := public.consume_reveal_quota(v_uid, o.posted_by, o.id);

  RETURN QUERY
  SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), pr.full_name, 'Institución'),
         COALESCE(NULLIF(btrim(priv.contact_phone), ''), NULLIF(btrim(pr.phone), ''), NULLIF(btrim(ip.legal_representative_phone), '')),
         COALESCE(NULLIF(btrim(priv.contact_phone), ''), NULLIF(btrim(pr.phone), ''), NULLIF(btrim(ip.legal_representative_phone), '')),
         COALESCE(NULLIF(btrim(priv.address), ''), NULLIF(btrim(ip.address), '')),
         priv.access_notes,
         COALESCE(o.city, ip.city, pr.city),
         now(),
         v_left
    FROM (SELECT 1) one
    LEFT JOIN public.profiles pr ON pr.user_id = o.posted_by
    LEFT JOIN public.institution_profiles ip ON ip.user_id = o.posted_by
    LEFT JOIN public.job_offer_private priv ON priv.job_offer_id = o.id;
END;
$$;

-- Contacto de la contraparte de una reserva. ANTES cualquier profesional con reserva confirmada recibía el
-- teléfono del cliente sin importar su plan; ahora el profesional necesita plan de pago y cupo (el cliente,
-- que contrata, sigue pudiendo ver el contacto de quien contrató).
CREATE OR REPLACE FUNCTION public.get_booking_contact(_booking_id uuid)
RETURNS TABLE(
  peer_id uuid,
  full_name text,
  phone text,
  avatar_url text,
  is_professional boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_pro_id    uuid;
  v_status    text;
  v_offer_id  uuid;
  v_peer_id   uuid;
  v_is_pro    boolean;
BEGIN
  SELECT b.client_id, b.professional_id, b.status, b.job_offer_id
    INTO v_client_id, v_pro_id, v_status, v_offer_id
    FROM public.service_bookings b WHERE b.id = _booking_id;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_client_id AND auth.uid() IS DISTINCT FROM v_pro_id
     AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_status NOT IN ('confirmed', 'in_route', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'booking_not_paid';
  END IF;

  IF auth.uid() = v_client_id THEN
    v_peer_id := v_pro_id;
    v_is_pro := TRUE;
  ELSE
    v_peer_id := v_client_id;
    v_is_pro := FALSE;
    IF auth.uid() = v_pro_id AND NOT public.is_staff(auth.uid()) THEN
      PERFORM public.consume_reveal_quota(v_pro_id, v_client_id, v_offer_id);
    END IF;
  END IF;

  INSERT INTO public.booking_contact_reveals (booking_id, revealer_id, channel)
  VALUES (_booking_id, auth.uid(), 'contact_fetch');

  RETURN QUERY
    SELECT p.user_id, p.full_name,
           CASE WHEN v_is_pro THEN p.phone
                ELSE COALESCE(NULLIF(btrim(priv.contact_phone), ''), p.phone) END,
           p.avatar_url, v_is_pro
      FROM public.profiles p
      LEFT JOIN public.job_offer_private priv ON priv.job_offer_id = v_offer_id
     WHERE p.user_id = v_peer_id;
END;
$$;

-- ─── 8) Bandejas con la contraparte ya resuelta ─────────────────────────────────

-- Postulaciones del profesional con institución, turnos y estado del contrato.
CREATE OR REPLACE FUNCTION public.my_offer_applications(p_limit integer DEFAULT 60)
RETURNS TABLE (
  application_id    uuid,
  job_offer_id      uuid,
  offer_title       text,
  institution_name  text,
  institution_id    uuid,
  city              text,
  modality          text,
  posted_amount     integer,
  proposed_amount   integer,
  agreed_amount     integer,
  status            text,
  awaiting          text,
  round_no          integer,
  expires_at        timestamptz,
  created_at        timestamptz,
  accepted_at       timestamptz,
  closed_reason     text,
  shifts            jsonb,
  booking_ids       uuid[],
  contract_id       uuid,
  contract_status   text,
  i_signed          boolean,
  other_signed      boolean
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
  PERFORM public.expire_stale_applications();

  RETURN QUERY
  SELECT a.id, a.job_offer_id, o.title,
         COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Institución de salud'),
         o.posted_by, o.city, o.modality::text,
         a.posted_amount, a.proposed_amount, a.agreed_amount, a.status::text, a.awaiting, a.round_no::integer,
         a.expires_at, a.created_at, a.accepted_at, a.closed_reason,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at) ORDER BY s.starts_at)
                     FROM public.job_offer_shifts s WHERE s.id = ANY (a.shift_ids)), '[]'::jsonb),
         COALESCE((SELECT array_agg(b.id ORDER BY b.scheduled_at) FROM public.service_bookings b WHERE b.application_id = a.id), '{}'::uuid[]),
         sc.id, sc.status,
         EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = sc.id AND g.signer_id = v_uid),
         EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = sc.id AND g.signer_id <> v_uid)
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    LEFT JOIN public.institution_profiles ip ON ip.user_id = o.posted_by
    LEFT JOIN public.smart_contracts sc ON sc.application_id = a.id
   WHERE a.professional_id = v_uid
   ORDER BY (a.status::text = 'pending') DESC, a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END;
$$;

-- Buzón de la institución: postulantes con señales de confianza. Primero lo que espera su respuesta.
CREATE OR REPLACE FUNCTION public.institution_application_inbox(p_limit integer DEFAULT 80)
RETURNS TABLE (
  application_id      uuid,
  job_offer_id        uuid,
  offer_title         text,
  modality            text,
  posted_amount       integer,
  proposed_amount     integer,
  agreed_amount       integer,
  status              text,
  awaiting            text,
  round_no            integer,
  expires_at          timestamptz,
  message             text,
  created_at          timestamptz,
  accepted_at         timestamptz,
  closed_reason       text,
  shifts              jsonb,
  professional_id     uuid,
  professional_name   text,
  professional_avatar text,
  professional_city   text,
  specialty           text,
  years_experience    integer,
  rethus_verified     boolean,
  profile_verified    boolean,
  avg_rating          numeric,
  total_jobs          integer,
  jobs_with_me        integer,
  contract_id         uuid,
  contract_status     text
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
  IF NOT (public.has_role(v_uid, 'institution'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.expire_stale_applications();

  RETURN QUERY
  SELECT a.id, a.job_offer_id, o.title, o.modality::text,
         a.posted_amount, a.proposed_amount, a.agreed_amount, a.status::text, a.awaiting, a.round_no::integer,
         a.expires_at, a.message, a.created_at, a.accepted_at, a.closed_reason,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at) ORDER BY s.starts_at)
                     FROM public.job_offer_shifts s WHERE s.id = ANY (a.shift_ids)), '[]'::jsonb),
         a.professional_id, pr.full_name, COALESCE(pp.avatar_url, pr.avatar_url), pr.city,
         pp.specialty, pp.years_experience::integer,
         COALESCE(pp.rethus_verified, false), COALESCE(pp.verified, false),
         pp.avg_rating, pp.total_jobs::integer,
         (SELECT count(*)::integer FROM public.service_bookings b
           WHERE b.client_id = o.posted_by AND b.professional_id = a.professional_id AND b.status = 'completed'),
         sc.id, sc.status
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    LEFT JOIN public.profiles pr ON pr.user_id = a.professional_id
    LEFT JOIN public.professional_profiles pp ON pp.user_id = a.professional_id
    LEFT JOIN public.smart_contracts sc ON sc.application_id = a.id
   WHERE o.posted_by = v_uid OR public.is_staff(v_uid)
   ORDER BY (a.status::text = 'pending' AND a.awaiting = 'institution') DESC,
            CASE WHEN a.status::text = 'pending' THEN a.created_at END ASC NULLS LAST,
            a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 300);
END;
$$;

-- Oferta de talento cerca de una oferta: solo conteos, y nunca con muestras menores a 5 personas.
CREATE OR REPLACE FUNCTION public.market_supply_snapshot(p_city text DEFAULT NULL, p_specialty text DEFAULT NULL)
RETURNS TABLE (professionals integer, rethus_verified integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  v_city text := public.city_key(p_city);
  v_spec text := lower(NULLIF(btrim(COALESCE(p_specialty, '')), ''));
  v_n    integer;
  v_v    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'institution'::public.app_role) OR public.is_staff(v_uid)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer, count(*) FILTER (WHERE pp.rethus_verified)::integer
    INTO v_n, v_v
    FROM public.professional_profiles pp
   WHERE pp.published AND COALESCE(pp.active, true) AND NOT pp.blocked AND pp.available
     AND (v_city = '' OR public.city_key(pp.home_city) = v_city
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(pp.service_cities, '{}'::text[])) AS c WHERE public.city_key(c) = v_city))
     AND (v_spec IS NULL OR lower(COALESCE(pp.specialty, '')) LIKE '%' || v_spec || '%'
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(pp.sub_specialties, '{}'::text[])) AS t WHERE lower(t) LIKE '%' || v_spec || '%'));

  RETURN QUERY SELECT CASE WHEN v_n >= 5 THEN v_n END, CASE WHEN v_n >= 5 THEN v_v END;
END;
$$;

-- ─── 9) Alertas, aviso en vivo y reapertura de cupos ────────────────────────────

-- Notifica a profesionales cuyas alertas coinciden con una oferta nueva. Una notificación por alerta y
-- institución cada 6 h. Nunca bloquea la publicación.
CREATE OR REPLACE FUNCTION public.notify_offer_alerts(p_offer uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  o       public.job_offers%ROWTYPE;
  v_hay   text;
  v_hours numeric;
  v_hourly numeric;
  v_first timestamptz;
  v_sent  integer := 0;
  r       record;
BEGIN
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer;
  IF NOT FOUND OR o.status::text <> 'open' OR o.poster_type::text <> 'institution' THEN
    RETURN 0;
  END IF;

  SELECT min(s.starts_at), avg(EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 3600.0)
    INTO v_first, v_hours FROM public.job_offer_shifts s WHERE s.job_offer_id = o.id AND s.status = 'open';
  v_hourly := CASE o.modality::text
                WHEN 'hour' THEN o.amount
                WHEN 'shift' THEN CASE WHEN COALESCE(v_hours, 0) > 0 THEN o.amount / v_hours END
                ELSE NULL END;
  v_hay := lower(translate(COALESCE(o.title, '') || ' ' || COALESCE(o.specialty_required, '') || ' ' ||
                           COALESCE(o.service_area, '') || ' ' || COALESCE(o.description, ''),
                           'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));

  FOR r IN
    SELECT a.id, a.professional_id, a.name
      FROM public.opportunity_alerts a
     WHERE a.active
       AND a.professional_id <> o.posted_by
       AND (cardinality(a.cities) = 0
            OR public.city_key(o.city) IN (SELECT public.city_key(c) FROM unnest(a.cities) AS c))
       AND (cardinality(a.care_types) = 0
            OR EXISTS (SELECT 1 FROM unnest(a.care_types) AS t
                        WHERE position(lower(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) IN v_hay) > 0))
       AND (a.min_rate IS NULL OR v_hourly IS NULL OR v_hourly >= a.min_rate)
       AND (NOT a.urgent_only OR o.is_urgent OR v_first <= now() + interval '6 hours')
       AND public.has_role(a.professional_id, 'professional'::public.app_role)
     LIMIT 100
  LOOP
    INSERT INTO public.opportunity_alert_log AS l (alert_id, family_user_id, notified_at)
    VALUES (r.id, o.posted_by, now())
    ON CONFLICT (alert_id, family_user_id) DO UPDATE SET notified_at = now()
      WHERE l.notified_at < now() - interval '6 hours';
    IF FOUND THEN
      PERFORM public.hx_notify(r.professional_id, 'opportunity_alert', 'Nuevo turno: ' || r.name,
        left(o.title, 80) || ' en ' || o.city || ' · ' || public.hx_cop(o.amount) ||
          CASE o.modality::text WHEN 'hour' THEN ' por hora' WHEN 'shift' THEN ' por turno' ELSE '' END ||
          CASE WHEN o.is_urgent THEN ' · URGENTE' ELSE '' END,
        '/dashboard/profesional');
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN v_sent;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_offer_alerts: %', SQLERRM;
  RETURN v_sent;
END;
$$;

-- Aviso «hay cambios» (sin datos) en el mismo canal privado que usa la agenda de familias.
CREATE OR REPLACE FUNCTION public.ping_open_offers()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'offers_changed', 'open_needs_ping', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ping_open_offers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_offers_ping ON public.job_offers;
CREATE TRIGGER trg_job_offers_ping
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.job_offers
  FOR EACH STATEMENT EXECUTE FUNCTION public.ping_open_offers();
DROP TRIGGER IF EXISTS trg_job_offer_shifts_ping ON public.job_offer_shifts;
CREATE TRIGGER trg_job_offer_shifts_ping
  AFTER INSERT OR UPDATE OR DELETE ON public.job_offer_shifts
  FOR EACH STATEMENT EXECUTE FUNCTION public.ping_open_offers();

-- Si una reserva ligada a un turno se cancela, el cupo vuelve a abrirse y la otra parte se entera.
-- Si se completa o se cancela, el contrato (si existe) refleja el estado de ese turno.
CREATE OR REPLACE FUNCTION public.bookings_sync_offer_and_contract()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev    text := current_setting('app.application_rpc', true);
  v_uid     uuid := auth.uid();
  s         public.job_offer_shifts%ROWTYPE;
  v_title   text;
  v_by_pro  boolean;
  v_cid     uuid;
  v_total   integer;
  v_done    integer;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.job_offer_shift_id IS NOT NULL THEN
    PERFORM set_config('app.application_rpc', 'on', true);
    UPDATE public.job_offer_shifts
       SET filled = GREATEST(filled - 1, 0),
           status = CASE WHEN status = 'filled' THEN 'open' ELSE status END
     WHERE id = NEW.job_offer_shift_id
    RETURNING * INTO s;
    IF FOUND AND s.status = 'open' AND s.ends_at > now() THEN
      UPDATE public.job_offers
         SET status = 'open',
             is_urgent = CASE WHEN s.starts_at <= now() + interval '48 hours' THEN true ELSE is_urgent END
       WHERE id = NEW.job_offer_id AND status::text = 'filled';
    END IF;
    PERFORM set_config('app.application_rpc', COALESCE(v_prev, ''), true);

    SELECT o.title INTO v_title FROM public.job_offers o WHERE o.id = NEW.job_offer_id;
    v_by_pro := (v_uid IS NOT NULL AND v_uid = NEW.professional_id);
    IF v_by_pro THEN
      PERFORM public.hx_notify(NEW.client_id, 'shift_cancelled_by_professional', 'Se canceló un turno: busca reemplazo',
        'El profesional canceló su turno en «' || left(COALESCE(v_title, 'tu oferta'), 60) || '». El cupo volvió a abrirse' ||
          CASE WHEN s.starts_at <= now() + interval '48 hours' THEN ' como urgente' ELSE '' END || '.',
        '/dashboard/institucion');
    ELSIF v_uid IS NOT NULL AND v_uid = NEW.client_id THEN
      PERFORM public.hx_notify(NEW.professional_id, 'shift_cancelled_by_institution', 'La institución canceló un turno',
        'El turno en «' || left(COALESCE(v_title, 'la oferta'), 60) || '» fue cancelado. Hay más turnos abiertos para ti.',
        '/dashboard/profesional');
    END IF;
  END IF;

  IF NEW.status IN ('cancelled', 'completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT scs.contract_id INTO v_cid FROM public.smart_contract_shifts scs WHERE scs.booking_id = NEW.id;
    IF v_cid IS NOT NULL THEN
      PERFORM set_config('app.contract_rpc', 'on', true);
      UPDATE public.smart_contract_shifts
         SET status = CASE NEW.status WHEN 'completed' THEN 'completed' ELSE 'cancelled' END
       WHERE booking_id = NEW.id;
      PERFORM public.append_contract_event(v_cid, 'shift_' || NEW.status, v_uid, NULL,
                                           jsonb_build_object('booking_id', NEW.id));
      SELECT count(*), count(*) FILTER (WHERE status = 'completed')
        INTO v_total, v_done FROM public.smart_contract_shifts WHERE contract_id = v_cid AND status <> 'cancelled';
      IF v_total > 0 AND v_total = v_done THEN
        UPDATE public.smart_contracts SET status = 'completed', closed_at = now()
         WHERE id = v_cid AND status = 'active';
      END IF;
      PERFORM set_config('app.contract_rpc', '', true);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Esta sincronización nunca debe impedir cambiar el estado de una reserva.
  RAISE WARNING 'bookings_sync_offer_and_contract: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bookings_sync_offer_and_contract() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bookings_sync_offer_and_contract ON public.service_bookings;
CREATE TRIGGER trg_bookings_sync_offer_and_contract
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'completed'))
  EXECUTE FUNCTION public.bookings_sync_offer_and_contract();

-- ─── 10) Contrato inteligente ───────────────────────────────────────────────────
-- Los términos se congelan con un hash (SHA-256) al crearse. Cada firma exige: cuenta autenticada +
-- identidad verificada (RETHUS del profesional; NIT y verificación de la institución) + segundo factor
-- reciente + aceptación explícita de las cláusulas + el mismo hash que vieron las partes. La firma la
-- registra únicamente código de servidor (record_contract_signature es solo service_role). Cada cambio
-- queda en una cadena de eventos encadenados por hash: cualquier alteración posterior se detecta con
-- verify_contract_integrity(). Marco: Ley 527 de 1999 y Decreto 2364 de 2012 (firma electrónica).
-- Las referencias a usuarios no llevan FK a propósito: el contrato es un registro que se conserva aunque
-- se elimine la cuenta (los datos personales del contrato quedan solo como parte del texto firmado).

CREATE SEQUENCE IF NOT EXISTS public.smart_contract_seq;

CREATE TABLE IF NOT EXISTS public.smart_contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no         text NOT NULL UNIQUE,
  application_id      uuid UNIQUE REFERENCES public.applications(id) ON DELETE SET NULL,
  job_offer_id        uuid REFERENCES public.job_offers(id) ON DELETE SET NULL,
  institution_user_id uuid NOT NULL,
  professional_id     uuid NOT NULL,
  version             smallint NOT NULL DEFAULT 1,
  template_version    text NOT NULL,
  status              text NOT NULL DEFAULT 'pending_signature'
                      CHECK (status IN ('pending_signature', 'partially_signed', 'active', 'completed', 'declined', 'cancelled', 'expired')),
  terms               jsonb NOT NULL,
  terms_hash          text NOT NULL,
  total_amount        integer NOT NULL CHECK (total_amount >= 0),
  signature_deadline  timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  activated_at        timestamptz,
  closed_at           timestamptz,
  CONSTRAINT smart_contracts_distinct_parties CHECK (institution_user_id <> professional_id)
);
CREATE INDEX IF NOT EXISTS idx_sc_institution ON public.smart_contracts (institution_user_id, status);
CREATE INDEX IF NOT EXISTS idx_sc_professional ON public.smart_contracts (professional_id, status);
ALTER TABLE public.smart_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sc_select_parties ON public.smart_contracts;
CREATE POLICY sc_select_parties ON public.smart_contracts
  FOR SELECT TO authenticated
  USING (auth.uid() IN (institution_user_id, professional_id) OR public.is_staff(auth.uid()));
GRANT SELECT ON public.smart_contracts TO authenticated;
GRANT ALL ON public.smart_contracts TO service_role;

CREATE TABLE IF NOT EXISTS public.smart_contract_shifts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NOT NULL REFERENCES public.smart_contracts(id) ON DELETE CASCADE,
  shift_no            smallint NOT NULL,
  job_offer_shift_id  uuid,
  booking_id          uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  hours               numeric(5, 2) NOT NULL,
  amount              integer NOT NULL,
  status              text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  UNIQUE (contract_id, shift_no)
);
CREATE INDEX IF NOT EXISTS idx_scs_booking ON public.smart_contract_shifts (booking_id) WHERE booking_id IS NOT NULL;
ALTER TABLE public.smart_contract_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scs_select_parties ON public.smart_contract_shifts;
CREATE POLICY scs_select_parties ON public.smart_contract_shifts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.smart_contracts c
                  WHERE c.id = contract_id
                    AND (auth.uid() IN (c.institution_user_id, c.professional_id) OR public.is_staff(auth.uid()))));
GRANT SELECT ON public.smart_contract_shifts TO authenticated;
GRANT ALL ON public.smart_contract_shifts TO service_role;

CREATE TABLE IF NOT EXISTS public.smart_contract_signatures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid NOT NULL REFERENCES public.smart_contracts(id) ON DELETE CASCADE,
  party             text NOT NULL CHECK (party IN ('institution', 'professional')),
  signer_id         uuid NOT NULL,
  signer_name       text NOT NULL,
  signer_identity   text NOT NULL,
  identity_method   text NOT NULL,
  identity_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms_hash        text NOT NULL,
  body_hash         text NOT NULL,
  accepted_clauses  text[] NOT NULL,
  step_up           jsonb NOT NULL,
  ip_hash           text,
  user_agent        text,
  signed_at         timestamptz NOT NULL DEFAULT now(),
  signature_hash    text NOT NULL,
  UNIQUE (contract_id, party)
);
ALTER TABLE public.smart_contract_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scsig_select_parties ON public.smart_contract_signatures;
CREATE POLICY scsig_select_parties ON public.smart_contract_signatures
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.smart_contracts c
                  WHERE c.id = contract_id
                    AND (auth.uid() IN (c.institution_user_id, c.professional_id) OR public.is_staff(auth.uid()))));
GRANT SELECT ON public.smart_contract_signatures TO authenticated;
GRANT ALL ON public.smart_contract_signatures TO service_role;

CREATE TABLE IF NOT EXISTS public.smart_contract_events (
  id          bigserial PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES public.smart_contracts(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  event       text NOT NULL,
  actor_id    uuid,
  actor_role  text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   text NOT NULL,
  hash        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (contract_id, seq)
);
ALTER TABLE public.smart_contract_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sce_select_parties ON public.smart_contract_events;
CREATE POLICY sce_select_parties ON public.smart_contract_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.smart_contracts c
                  WHERE c.id = contract_id
                    AND (auth.uid() IN (c.institution_user_id, c.professional_id) OR public.is_staff(auth.uid()))));
GRANT SELECT ON public.smart_contract_events TO authenticated;
GRANT ALL ON public.smart_contract_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_contract_events_id_seq TO service_role;

-- Hash de un evento: encadena con el anterior. Lo usan el disparador y el verificador.
CREATE OR REPLACE FUNCTION public.contract_event_hash(
  p_prev text, p_seq integer, p_event text, p_actor uuid, p_role text, p_data jsonb, p_at timestamptz
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT public.hx_sha256(
    p_prev || '|' || p_seq::text || '|' || p_event || '|' || COALESCE(p_actor::text, '') || '|' ||
    COALESCE(p_role, '') || '|' || COALESCE(p_data, '{}'::jsonb)::text || '|' ||
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE OR REPLACE FUNCTION public.contract_signature_hash(
  p_contract uuid, p_party text, p_signer uuid, p_terms_hash text, p_body_hash text, p_at timestamptz, p_step_up jsonb
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT public.hx_sha256(
    p_contract::text || '|' || p_party || '|' || p_signer::text || '|' || p_terms_hash || '|' || p_body_hash || '|' ||
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_step_up::text)
$$;

CREATE OR REPLACE FUNCTION public.smart_contract_events_chain()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seq  integer;
  v_prev text;
BEGIN
  SELECT e.seq, e.hash INTO v_seq, v_prev
    FROM public.smart_contract_events e WHERE e.contract_id = NEW.contract_id ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN
    v_seq := 0;
    v_prev := 'GENESIS:' || NEW.contract_id::text;
  END IF;
  NEW.seq := v_seq + 1;
  NEW.prev_hash := v_prev;
  NEW.created_at := clock_timestamp();
  NEW.hash := public.contract_event_hash(NEW.prev_hash, NEW.seq, NEW.event, NEW.actor_id, NEW.actor_role, NEW.data, NEW.created_at);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.smart_contract_events_chain() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_smart_contract_events_chain ON public.smart_contract_events;
CREATE TRIGGER trg_smart_contract_events_chain
  BEFORE INSERT ON public.smart_contract_events
  FOR EACH ROW EXECUTE FUNCTION public.smart_contract_events_chain();

-- Firmas y eventos son inmutables (ni siquiera el service role las edita o borra).
CREATE OR REPLACE FUNCTION public.smart_contract_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Los registros del contrato son inmutables' USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.smart_contract_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_smart_contract_events_immutable ON public.smart_contract_events;
CREATE TRIGGER trg_smart_contract_events_immutable
  BEFORE UPDATE OR DELETE ON public.smart_contract_events
  FOR EACH ROW EXECUTE FUNCTION public.smart_contract_immutable();
DROP TRIGGER IF EXISTS trg_smart_contract_signatures_immutable ON public.smart_contract_signatures;
CREATE TRIGGER trg_smart_contract_signatures_immutable
  BEFORE UPDATE OR DELETE ON public.smart_contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.smart_contract_immutable();

-- El contrato solo cambia a través de las funciones de este archivo (bandera local app.contract_rpc),
-- nunca se borra, y con una firma registrada sus términos y partes no se tocan.
CREATE OR REPLACE FUNCTION public.smart_contracts_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un contrato no se elimina' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(current_setting('app.contract_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El contrato solo se modifica con las acciones del contrato' USING ERRCODE = '42501';
  END IF;
  IF NEW.institution_user_id IS DISTINCT FROM OLD.institution_user_id
     OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.contract_no IS DISTINCT FROM OLD.contract_no
     OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    RAISE EXCEPTION 'Las partes del contrato no se pueden cambiar' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = OLD.id)
     AND (NEW.terms IS DISTINCT FROM OLD.terms OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash
          OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.version IS DISTINCT FROM OLD.version) THEN
    RAISE EXCEPTION 'El contrato ya tiene firmas: sus términos no se pueden cambiar' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.smart_contracts_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_smart_contracts_guard ON public.smart_contracts;
CREATE TRIGGER trg_smart_contracts_guard
  BEFORE UPDATE OR DELETE ON public.smart_contracts
  FOR EACH ROW EXECUTE FUNCTION public.smart_contracts_guard();

CREATE OR REPLACE FUNCTION public.append_contract_event(
  p_contract uuid, p_event text, p_actor uuid, p_role text, p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.smart_contracts WHERE id = p_contract FOR UPDATE;
  INSERT INTO public.smart_contract_events (contract_id, seq, event, actor_id, actor_role, data, prev_hash, hash)
  VALUES (p_contract, 0, p_event, p_actor, p_role, COALESCE(p_data, '{}'::jsonb), '', '');
END;
$$;

-- Condiciones por defecto (editables por la institución mientras nadie haya firmado).
CREATE OR REPLACE FUNCTION public.default_contract_conditions()
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'cancellation_notice_hours', 12,
    'institution_late_cancel_pct', 50,
    'tolerance_minutes', 15,
    'checkin_required', true,
    'biosafety_provided', true,
    'confidentiality', true,
    'replacement_duty', true,
    'extra', NULL
  )
$$;

-- Crea el contrato de una postulación aceptada (idempotente). p_pairs: [{shift_id, booking_id, starts_at,
-- ends_at, hours, amount}]. Uso interno de accept_application().
CREATE OR REPLACE FUNCTION public.create_contract_for_application(p_application_id uuid, p_pairs jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  a          public.applications%ROWTYPE;
  o          public.job_offers%ROWTYPE;
  ip         public.institution_profiles%ROWTYPE;
  pp         public.professional_profiles%ROWTYPE;
  v_id       uuid;
  v_inst     text;
  v_pro      text;
  v_addr     text;
  v_shifts   jsonb;
  v_total    integer;
  v_pct      numeric;
  v_first    timestamptz;
  v_deadline timestamptz;
  v_terms    jsonb;
  v_no       text;
  x          jsonb;
  n          integer := 0;
BEGIN
  SELECT * INTO a FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postulación no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT c.id INTO v_id FROM public.smart_contracts c WHERE c.application_id = a.id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = a.job_offer_id;
  SELECT * INTO ip FROM public.institution_profiles WHERE user_id = o.posted_by;
  SELECT * INTO pp FROM public.professional_profiles WHERE user_id = a.professional_id;
  SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), pr.full_name, 'Institución') INTO v_inst
    FROM (SELECT 1) one LEFT JOIN public.profiles pr ON pr.user_id = o.posted_by;
  SELECT pr.full_name INTO v_pro FROM public.profiles pr WHERE pr.user_id = a.professional_id;
  SELECT COALESCE(NULLIF(btrim(p.address), ''), NULLIF(btrim(ip.address), '')) INTO v_addr
    FROM (SELECT 1) one LEFT JOIN public.job_offer_private p ON p.job_offer_id = o.id;

  SELECT jsonb_agg(jsonb_build_object(
           'no', t.rn, 'starts_at', t.e ->> 'starts_at', 'ends_at', t.e ->> 'ends_at',
           'hours', (t.e ->> 'hours')::numeric, 'amount', (t.e ->> 'amount')::integer) ORDER BY t.rn),
         sum((t.e ->> 'amount')::integer)::integer,
         min((t.e ->> 'starts_at')::timestamptz)
    INTO v_shifts, v_total, v_first
    FROM (SELECT row_number() OVER (ORDER BY (e ->> 'starts_at')::timestamptz) AS rn, e
            FROM jsonb_array_elements(p_pairs) AS e) t;
  IF v_shifts IS NULL THEN
    RAISE EXCEPTION 'El contrato necesita al menos un turno' USING ERRCODE = '23514';
  END IF;

  v_pct := public.platform_commission_pct(a.professional_id);
  v_deadline := GREATEST(now() + interval '30 minutes',
                         LEAST(now() + interval '72 hours', v_first - interval '30 minutes'));
  v_no := 'HX-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-' ||
          lpad(nextval('public.smart_contract_seq')::text, 6, '0');

  v_terms := jsonb_build_object(
    'template', 'humanix-shift-v1',
    'version', 1,
    'contract_no', v_no,
    'parties', jsonb_build_object(
      'institution', jsonb_build_object(
        'user_id', o.posted_by, 'name', v_inst, 'type', ip.institution_type, 'nit', ip.nit,
        'legal_representative', ip.legal_representative_name, 'city', COALESCE(ip.city, o.city),
        'verified', COALESCE(ip.verified, false)),
      'professional', jsonb_build_object(
        'user_id', a.professional_id, 'name', v_pro, 'specialty', pp.specialty,
        'rethus_number', pp.rethus_number, 'rethus_verified', COALESCE(pp.rethus_verified, false))),
    'object', jsonb_build_object(
      'title', o.title, 'description', o.description, 'specialty', o.specialty_required,
      'service_area', o.service_area, 'city', o.city, 'address', v_addr,
      'modality', o.modality::text, 'requirements', to_jsonb(COALESCE(o.requirements, '{}'::text[]))),
    'shifts', v_shifts,
    'economics', jsonb_build_object(
      'agreed_amount', a.proposed_amount, 'posted_amount', a.posted_amount, 'modality', o.modality::text,
      'currency', 'COP', 'total_amount', v_total, 'commission_pct', v_pct,
      'professional_net', v_total - round(v_total * v_pct / 100.0)::integer,
      'payment_channel', 'platform_web_only'),
    'conditions', public.default_contract_conditions(),
    'legal', jsonb_build_object(
      'signature_deadline', v_deadline, 'governing_law', 'CO', 'esign_agreement', true,
      'data_protection', 'ley_1581_2012', 'dispute', 'conciliacion_pqrs'),
    'required_clauses', jsonb_build_array('contract', 'credentials', 'confidentiality', 'esign'),
    'generated_at', now());

  INSERT INTO public.smart_contracts (
    contract_no, application_id, job_offer_id, institution_user_id, professional_id, template_version,
    status, terms, terms_hash, total_amount, signature_deadline
  ) VALUES (
    v_no, a.id, o.id, o.posted_by, a.professional_id, 'humanix-shift-v1',
    'pending_signature', v_terms, public.hx_sha256(v_terms::text), v_total, v_deadline
  ) RETURNING id INTO v_id;

  FOR x IN SELECT * FROM jsonb_array_elements(p_pairs) AS e ORDER BY (e ->> 'starts_at')::timestamptz LOOP
    n := n + 1;
    INSERT INTO public.smart_contract_shifts (contract_id, shift_no, job_offer_shift_id, booking_id, starts_at, ends_at, hours, amount)
    VALUES (v_id, n, (x ->> 'shift_id')::uuid, (x ->> 'booking_id')::uuid,
            (x ->> 'starts_at')::timestamptz, (x ->> 'ends_at')::timestamptz,
            (x ->> 'hours')::numeric, (x ->> 'amount')::integer);
  END LOOP;

  PERFORM public.append_contract_event(v_id, 'created', o.posted_by, 'institution',
    jsonb_build_object('terms_hash', public.hx_sha256(v_terms::text), 'template', 'humanix-shift-v1', 'version', 1));
  RETURN v_id;
END;
$$;

-- Condiciones editables por la institución mientras nadie haya firmado. Cambia la versión y el hash.
CREATE OR REPLACE FUNCTION public.update_contract_conditions(p_contract_id uuid, p_conditions jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_prev  text := current_setting('app.contract_rpc', true);
  c       public.smart_contracts%ROWTYPE;
  v_cond  jsonb;
  v_terms jsonb;
  v_hash  text;
  v_key   text;
  v_val   jsonb;
  v_extra text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO c FROM public.smart_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid <> c.institution_user_id THEN
    RAISE EXCEPTION 'Solo la institución puede ajustar las condiciones' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'pending_signature' OR EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = c.id) THEN
    RAISE EXCEPTION 'El contrato ya tiene firmas: no se puede modificar' USING ERRCODE = '23514', HINT = 'contract_locked';
  END IF;
  IF jsonb_typeof(p_conditions) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Condiciones no válidas' USING ERRCODE = '23514';
  END IF;

  v_cond := c.terms -> 'conditions';
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_conditions) LOOP
    IF v_key = 'cancellation_notice_hours' THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::numeric NOT IN (0, 2, 6, 12, 24, 48) THEN
        RAISE EXCEPTION 'Aviso de cancelación: 0, 2, 6, 12, 24 o 48 horas' USING ERRCODE = '23514';
      END IF;
    ELSIF v_key = 'institution_late_cancel_pct' THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::numeric NOT BETWEEN 0 AND 100
         OR (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) THEN
        RAISE EXCEPTION 'El porcentaje por cancelación tardía debe ser un entero entre 0 y 100' USING ERRCODE = '23514';
      END IF;
    ELSIF v_key = 'tolerance_minutes' THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::numeric NOT BETWEEN 0 AND 60
         OR (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) THEN
        RAISE EXCEPTION 'La tolerancia de llegada debe ser un entero entre 0 y 60 minutos' USING ERRCODE = '23514';
      END IF;
    ELSIF v_key IN ('checkin_required', 'biosafety_provided', 'confidentiality', 'replacement_duty') THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION 'La condición % debe ser sí o no', v_key USING ERRCODE = '23514';
      END IF;
    ELSIF v_key = 'extra' THEN
      IF jsonb_typeof(v_val) = 'null' THEN
        NULL;
      ELSIF jsonb_typeof(v_val) = 'string' THEN
        v_extra := NULLIF(btrim(v_val #>> '{}'), '');
        IF v_extra IS NOT NULL AND (char_length(v_extra) > 600 OR public.message_has_forbidden_content(v_extra)) THEN
          RAISE EXCEPTION 'Las condiciones adicionales no pueden superar 600 caracteres ni incluir teléfonos, enlaces, direcciones o datos de pago'
            USING ERRCODE = '23514', HINT = 'forbidden_content';
        END IF;
        v_val := COALESCE(to_jsonb(v_extra), 'null'::jsonb);
      ELSE
        RAISE EXCEPTION 'Condiciones adicionales no válidas' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Condición desconocida: %', v_key USING ERRCODE = '23514';
    END IF;
    v_cond := jsonb_set(v_cond, ARRAY[v_key], v_val, true);
  END LOOP;

  v_terms := jsonb_set(jsonb_set(jsonb_set(c.terms, '{conditions}', v_cond, true),
                                 '{version}', to_jsonb(c.version + 1), true),
                       '{generated_at}', to_jsonb(now()), true);
  v_hash := public.hx_sha256(v_terms::text);

  PERFORM set_config('app.contract_rpc', 'on', true);
  UPDATE public.smart_contracts
     SET terms = v_terms, terms_hash = v_hash, version = c.version + 1
   WHERE id = c.id;
  PERFORM public.append_contract_event(c.id, 'conditions_updated', v_uid, 'institution',
    jsonb_build_object('terms_hash', v_hash, 'version', c.version + 1));
  PERFORM set_config('app.contract_rpc', COALESCE(v_prev, ''), true);

  PERFORM public.hx_notify(c.professional_id, 'contract_updated', 'El contrato cambió: vuelve a revisarlo',
    'La institución ajustó las condiciones del contrato ' || c.contract_no || ' (versión ' || (c.version + 1) || ').',
    '/servicio/' || COALESCE((SELECT scs.booking_id::text FROM public.smart_contract_shifts scs
                               WHERE scs.contract_id = c.id ORDER BY scs.shift_no LIMIT 1), ''));
  RETURN v_hash;
END;
$$;

-- Rechazar el contrato antes de que esté activo (cualquiera de las dos partes). No cancela las reservas:
-- eso se hace con las acciones de la reserva; el rechazo queda registrado y la otra parte se entera.
CREATE OR REPLACE FUNCTION public.decline_contract(p_contract_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  v_prev   text := current_setting('app.contract_rpc', true);
  c        public.smart_contracts%ROWTYPE;
  v_role   text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_other  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO c FROM public.smart_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid = c.institution_user_id THEN
    v_role := 'institution';
    v_other := c.professional_id;
  ELSIF v_uid = c.professional_id THEN
    v_role := 'professional';
    v_other := c.institution_user_id;
  ELSE
    RAISE EXCEPTION 'No participas en este contrato' USING ERRCODE = '42501';
  END IF;
  IF c.status NOT IN ('pending_signature', 'partially_signed') THEN
    RAISE EXCEPTION 'El contrato ya no admite cambios (%)', c.status USING ERRCODE = '23514';
  END IF;
  IF v_reason IS NOT NULL AND (char_length(v_reason) > 300 OR public.message_has_forbidden_content(v_reason)) THEN
    RAISE EXCEPTION 'El motivo no puede incluir datos de contacto ni de pago (máx. 300 caracteres)' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.contract_rpc', 'on', true);
  UPDATE public.smart_contracts SET status = 'declined', closed_at = now() WHERE id = c.id;
  PERFORM public.append_contract_event(c.id, 'declined', v_uid, v_role, jsonb_build_object('reason', v_reason));
  PERFORM set_config('app.contract_rpc', COALESCE(v_prev, ''), true);

  PERFORM public.hx_notify(v_other, 'contract_declined', 'El contrato fue rechazado',
    'La otra parte no aceptó el contrato ' || c.contract_no || '. Escríbele por el chat para aclarar las condiciones.',
    '/servicio/' || COALESCE((SELECT scs.booking_id::text FROM public.smart_contract_shifts scs
                               WHERE scs.contract_id = c.id ORDER BY scs.shift_no LIMIT 1), ''));
END;
$$;

-- ¿Puede esta persona firmar? Devuelve cada verificación para mostrar qué falta. Identidad:
--   profesional → RETHUS verificado (o verificación de perfil por el equipo) y nombre en el perfil;
--   institución → verificada por el equipo, con NIT y representante legal.
CREATE OR REPLACE FUNCTION public.contract_signer_readiness(p_contract_id uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  c         public.smart_contracts%ROWTYPE;
  v_party   text;
  v_checks  jsonb := '[]'::jsonb;
  v_name    text;
  v_signed  boolean;
  pp        public.professional_profiles%ROWTYPE;
  ip        public.institution_profiles%ROWTYPE;
  v_open    boolean;
BEGIN
  IF v_uid IS NOT NULL AND v_uid <> p_user AND NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.smart_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado' USING ERRCODE = 'P0002';
  END IF;
  v_party := CASE WHEN p_user = c.institution_user_id THEN 'institution'
                  WHEN p_user = c.professional_id THEN 'professional' END;
  IF v_party IS NULL THEN
    RAISE EXCEPTION 'No participas en este contrato' USING ERRCODE = '42501';
  END IF;

  v_open := c.status IN ('pending_signature', 'partially_signed') AND c.signature_deadline > now();
  v_signed := EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = c.id AND g.signer_id = p_user);
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object('id', 'contract_open', 'ok', v_open),
    jsonb_build_object('id', 'not_signed_yet', 'ok', NOT v_signed));

  SELECT NULLIF(btrim(pr.full_name), '') INTO v_name FROM public.profiles pr WHERE pr.user_id = p_user;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('id', 'full_name', 'ok', v_name IS NOT NULL));

  IF v_party = 'professional' THEN
    SELECT * INTO pp FROM public.professional_profiles WHERE user_id = p_user;
    v_checks := v_checks || jsonb_build_array(
      jsonb_build_object('id', 'rethus', 'ok', COALESCE(pp.rethus_verified, false) OR COALESCE(pp.verified, false)),
      jsonb_build_object('id', 'not_blocked', 'ok', NOT COALESCE(pp.blocked, false)));
  ELSE
    SELECT * INTO ip FROM public.institution_profiles WHERE user_id = p_user;
    v_checks := v_checks || jsonb_build_array(
      jsonb_build_object('id', 'institution_verified', 'ok', COALESCE(ip.verified, false)),
      jsonb_build_object('id', 'nit', 'ok', NULLIF(btrim(COALESCE(ip.nit, '')), '') IS NOT NULL),
      jsonb_build_object('id', 'legal_representative', 'ok', NULLIF(btrim(COALESCE(ip.legal_representative_name, '')), '') IS NOT NULL));
  END IF;

  RETURN jsonb_build_object(
    'party', v_party,
    'ready', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) AS k WHERE NOT (k ->> 'ok')::boolean),
    'checks', v_checks,
    'missing', COALESCE((SELECT jsonb_agg(k ->> 'id') FROM jsonb_array_elements(v_checks) AS k WHERE NOT (k ->> 'ok')::boolean), '[]'::jsonb));
END;
$$;

-- Registra la firma. SOLO service_role: el servidor ya verificó el segundo factor reciente (OTP) y que lo
-- firmado es el mismo texto que vio la persona (body_hash). Aquí se vuelve a validar todo lo demás.
CREATE OR REPLACE FUNCTION public.record_contract_signature(
  p_contract_id      uuid,
  p_signer_id        uuid,
  p_terms_hash       text,
  p_body_hash        text,
  p_accepted_clauses text[],
  p_step_up          jsonb,
  p_ip_hash          text,
  p_user_agent       text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_prev    text := current_setting('app.contract_rpc', true);
  c         public.smart_contracts%ROWTYPE;
  v_party   text;
  v_ready   jsonb;
  v_name    text;
  v_ident   text;
  v_method  text;
  v_evid    jsonb;
  v_at      timestamptz := clock_timestamp();
  v_hash    text;
  v_status  text;
  v_other   uuid;
  v_step_at timestamptz;
  v_first_booking text;
  pp        public.professional_profiles%ROWTYPE;
  ip        public.institution_profiles%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.smart_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado' USING ERRCODE = 'P0002';
  END IF;
  v_party := CASE WHEN p_signer_id = c.institution_user_id THEN 'institution'
                  WHEN p_signer_id = c.professional_id THEN 'professional' END;
  IF v_party IS NULL THEN
    RAISE EXCEPTION 'No participas en este contrato' USING ERRCODE = '42501';
  END IF;

  IF c.status NOT IN ('pending_signature', 'partially_signed') THEN
    RAISE EXCEPTION 'El contrato ya no admite firmas (%)', c.status USING ERRCODE = '23514', HINT = 'contract_closed';
  END IF;
  IF c.signature_deadline <= now() THEN
    -- expire_stale_contracts() (tarea programada) marca el contrato como vencido.
    RAISE EXCEPTION 'El plazo para firmar venció' USING ERRCODE = '23514', HINT = 'contract_expired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = c.id AND g.signer_id = p_signer_id) THEN
    RAISE EXCEPTION 'Ya firmaste este contrato' USING ERRCODE = '23505';
  END IF;
  IF p_terms_hash IS DISTINCT FROM c.terms_hash THEN
    RAISE EXCEPTION 'El contrato cambió desde que lo abriste: vuelve a revisarlo' USING ERRCODE = '23514', HINT = 'terms_changed';
  END IF;
  IF p_body_hash IS NULL OR p_body_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Falta la huella del texto firmado' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.terms -> 'required_clauses') AS req
              WHERE req <> ALL (COALESCE(p_accepted_clauses, '{}'::text[]))) THEN
    RAISE EXCEPTION 'Debes aceptar de forma explícita todas las declaraciones' USING ERRCODE = '23514', HINT = 'clauses_required';
  END IF;

  IF p_step_up IS NULL OR p_step_up ->> 'method' IS NULL OR p_step_up ->> 'authenticated_at' IS NULL THEN
    RAISE EXCEPTION 'Falta la verificación de segundo factor' USING ERRCODE = '42501', HINT = 'step_up_required';
  END IF;
  v_step_at := (p_step_up ->> 'authenticated_at')::timestamptz;
  IF v_step_at < now() - interval '15 minutes' OR v_step_at > now() + interval '2 minutes' THEN
    RAISE EXCEPTION 'La verificación de segundo factor venció: solicita un código nuevo' USING ERRCODE = '42501', HINT = 'step_up_required';
  END IF;

  v_ready := public.contract_signer_readiness(c.id, p_signer_id);
  IF NOT (v_ready ->> 'ready')::boolean THEN
    RAISE EXCEPTION 'Tu identidad aún no está validada: %', v_ready ->> 'missing'
      USING ERRCODE = '42501', HINT = 'identity_not_verified';
  END IF;

  IF v_party = 'professional' THEN
    SELECT * INTO pp FROM public.professional_profiles WHERE user_id = p_signer_id;
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.user_id = p_signer_id;
    v_ident := 'RETHUS ' || COALESCE(NULLIF(btrim(pp.rethus_number), ''), 'verificado') ||
               COALESCE(' · ' || NULLIF(btrim(pp.specialty), ''), '');
    v_method := 'rethus_verified+' || (p_step_up ->> 'method');
    v_evid := jsonb_build_object('rethus_verified', COALESCE(pp.rethus_verified, false),
                                 'profile_verified', COALESCE(pp.verified, false),
                                 'rethus_number', pp.rethus_number, 'rethus_checked_at', pp.rethus_checked_at);
  ELSE
    SELECT * INTO ip FROM public.institution_profiles WHERE user_id = p_signer_id;
    v_name := COALESCE(NULLIF(btrim(ip.legal_representative_name), ''), ip.institution_name);
    v_ident := 'NIT ' || ip.nit || ' · ' || COALESCE(ip.institution_name, '');
    v_method := 'institution_verified+' || (p_step_up ->> 'method');
    v_evid := jsonb_build_object('institution_verified', COALESCE(ip.verified, false), 'nit', ip.nit,
                                 'legal_representative', ip.legal_representative_name);
  END IF;

  v_hash := public.contract_signature_hash(c.id, v_party, p_signer_id, p_terms_hash, p_body_hash, v_at, p_step_up);
  INSERT INTO public.smart_contract_signatures (
    contract_id, party, signer_id, signer_name, signer_identity, identity_method, identity_evidence,
    terms_hash, body_hash, accepted_clauses, step_up, ip_hash, user_agent, signed_at, signature_hash
  ) VALUES (
    c.id, v_party, p_signer_id, COALESCE(v_name, 'Firmante'), v_ident, v_method, v_evid,
    p_terms_hash, p_body_hash, p_accepted_clauses, p_step_up, p_ip_hash, left(p_user_agent, 200), v_at, v_hash
  );

  v_status := CASE WHEN (SELECT count(*) FROM public.smart_contract_signatures g WHERE g.contract_id = c.id) >= 2
                   THEN 'active' ELSE 'partially_signed' END;
  PERFORM set_config('app.contract_rpc', 'on', true);
  UPDATE public.smart_contracts
     SET status = v_status, activated_at = CASE WHEN v_status = 'active' THEN now() ELSE activated_at END
   WHERE id = c.id;
  PERFORM public.append_contract_event(c.id, 'signed', p_signer_id, v_party,
    jsonb_build_object('signature_hash', v_hash, 'body_hash', p_body_hash, 'step_up_method', p_step_up ->> 'method'));
  IF v_status = 'active' THEN
    PERFORM public.append_contract_event(c.id, 'activated', NULL, 'system', jsonb_build_object('terms_hash', c.terms_hash));
  END IF;
  PERFORM set_config('app.contract_rpc', COALESCE(v_prev, ''), true);

  v_other := CASE v_party WHEN 'institution' THEN c.professional_id ELSE c.institution_user_id END;
  SELECT scs.booking_id::text INTO v_first_booking
    FROM public.smart_contract_shifts scs WHERE scs.contract_id = c.id ORDER BY scs.shift_no LIMIT 1;
  IF v_status = 'active' THEN
    PERFORM public.hx_notify(c.institution_user_id, 'contract_active', 'Contrato firmado por ambas partes',
      'El contrato ' || c.contract_no || ' ya está vigente.', '/servicio/' || COALESCE(v_first_booking, ''));
    PERFORM public.hx_notify(c.professional_id, 'contract_active', 'Contrato firmado por ambas partes',
      'El contrato ' || c.contract_no || ' ya está vigente.', '/servicio/' || COALESCE(v_first_booking, ''));
  ELSE
    PERFORM public.hx_notify(v_other, 'contract_signature_pending', 'Falta tu firma en el contrato',
      COALESCE(v_name, 'La otra parte') || ' ya firmó el contrato ' || c.contract_no || '. Revísalo y fírmalo.',
      '/servicio/' || COALESCE(v_first_booking, ''));
  END IF;

  RETURN jsonb_build_object('status', v_status, 'party', v_party, 'signed_at', v_at,
                            'signature_hash', v_hash, 'fully_signed', v_status = 'active');
END;
$$;

-- Verificación de integridad: recalcula el hash de los términos, la cadena de eventos y cada firma.
CREATE OR REPLACE FUNCTION public.verify_contract_integrity(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  c           public.smart_contracts%ROWTYPE;
  e           record;
  g           record;
  v_prev      text;
  v_expect    text;
  v_terms_ok  boolean;
  v_events_ok boolean := true;
  v_sigs_ok   boolean := true;
  v_failed    integer;
  v_n         integer := 0;
  v_last_terms text;
BEGIN
  SELECT * INTO c FROM public.smart_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NOT NULL AND v_uid NOT IN (c.institution_user_id, c.professional_id) AND NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  v_terms_ok := public.hx_sha256(c.terms::text) = c.terms_hash;
  v_prev := 'GENESIS:' || c.id::text;
  FOR e IN SELECT * FROM public.smart_contract_events ev WHERE ev.contract_id = c.id ORDER BY ev.seq LOOP
    v_n := v_n + 1;
    v_expect := public.contract_event_hash(v_prev, e.seq, e.event, e.actor_id, e.actor_role, e.data, e.created_at);
    IF e.prev_hash <> v_prev OR e.hash <> v_expect OR e.seq <> v_n THEN
      v_events_ok := false;
      v_failed := COALESCE(v_failed, e.seq);
    END IF;
    IF e.event IN ('created', 'conditions_updated') THEN
      v_last_terms := e.data ->> 'terms_hash';
    END IF;
    v_prev := e.hash;
  END LOOP;
  IF v_last_terms IS DISTINCT FROM c.terms_hash THEN
    v_events_ok := false;
  END IF;

  FOR g IN SELECT * FROM public.smart_contract_signatures sg WHERE sg.contract_id = c.id LOOP
    IF g.signature_hash <> public.contract_signature_hash(c.id, g.party, g.signer_id, g.terms_hash, g.body_hash, g.signed_at, g.step_up)
       OR g.terms_hash <> c.terms_hash THEN
      v_sigs_ok := false;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_terms_ok AND v_events_ok AND v_sigs_ok,
    'terms_hash_ok', v_terms_ok, 'events_ok', v_events_ok, 'signatures_ok', v_sigs_ok,
    'event_count', v_n, 'failed_at', v_failed, 'terms_hash', c.terms_hash,
    'checked_at', now());
END;
$$;

-- Contratos de la persona con la contraparte ya resuelta.
CREATE OR REPLACE FUNCTION public.my_smart_contracts(p_limit integer DEFAULT 60)
RETURNS TABLE (
  contract_id      uuid,
  contract_no      text,
  status           text,
  total_amount     integer,
  version          integer,
  signature_deadline timestamptz,
  created_at       timestamptz,
  my_party         text,
  counterpart_name text,
  offer_title      text,
  first_shift      timestamptz,
  shifts           integer,
  first_booking_id uuid,
  i_signed         boolean,
  other_signed     boolean
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
  SELECT c.id, c.contract_no, c.status, c.total_amount, c.version::integer, c.signature_deadline, c.created_at,
         CASE WHEN v_uid = c.institution_user_id THEN 'institution' ELSE 'professional' END,
         CASE WHEN v_uid = c.institution_user_id THEN COALESCE(NULLIF(btrim(c.terms #>> '{parties,professional,name}'), ''), 'Profesional')
              ELSE COALESCE(NULLIF(btrim(c.terms #>> '{parties,institution,name}'), ''), 'Institución') END,
         c.terms #>> '{object,title}',
         (SELECT min(s.starts_at) FROM public.smart_contract_shifts s WHERE s.contract_id = c.id AND s.status <> 'cancelled'),
         (SELECT count(*)::integer FROM public.smart_contract_shifts s WHERE s.contract_id = c.id),
         (SELECT s.booking_id FROM public.smart_contract_shifts s WHERE s.contract_id = c.id ORDER BY s.shift_no LIMIT 1),
         EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = c.id AND g.signer_id = v_uid),
         EXISTS (SELECT 1 FROM public.smart_contract_signatures g WHERE g.contract_id = c.id AND g.signer_id <> v_uid)
    FROM public.smart_contracts c
   WHERE c.institution_user_id = v_uid OR c.professional_id = v_uid
   ORDER BY (c.status IN ('pending_signature', 'partially_signed')) DESC, c.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_contracts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('app.contract_rpc', true);
  r      record;
  v_n    integer := 0;
BEGIN
  PERFORM set_config('app.contract_rpc', 'on', true);
  FOR r IN SELECT id FROM public.smart_contracts
            WHERE status IN ('pending_signature', 'partially_signed') AND signature_deadline <= now()
              FOR UPDATE LOOP
    UPDATE public.smart_contracts SET status = 'expired', closed_at = now() WHERE id = r.id;
    PERFORM public.append_contract_event(r.id, 'expired', NULL, 'system', '{}'::jsonb);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('app.contract_rpc', COALESCE(v_prev, ''), true);
  RETURN v_n;
END;
$$;

-- ─── 11) Flujo de contratos anterior (service_contracts) ────────────────────────
-- Estaba roto y era inseguro: sign_contract comparaba MD5(código) contra un hash SHA-256 con sal que no
-- se guardaba (nadie podía firmar), y las políticas dejaban a cada parte insertar y editar CUALQUIER
-- columna de su fila (incluidas las firmas y el estado). Se cierra la escritura desde el cliente; las filas
-- existentes se conservan para consulta.
DO $$
BEGIN
  IF to_regclass('public.service_contracts') IS NOT NULL THEN
    DROP POLICY IF EXISTS contracts_insert_parties ON public.service_contracts;
    DROP POLICY IF EXISTS contracts_update_sign ON public.service_contracts;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sign_contract(p_contract_id uuid, p_otp text, p_party text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Este flujo de firma fue reemplazado por el contrato inteligente. Abre la reserva y firma desde allí.'
    USING ERRCODE = '0A000', HINT = 'use_smart_contract';
END;
$$;

-- ─── 12) Permisos de las funciones ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.publish_institution_offer(jsonb)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.institution_reputation(uuid)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_open_institution_offers(integer)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_to_offer(uuid, integer, text, uuid[])             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counter_application(uuid, integer, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_application(uuid, text)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_application(uuid, jsonb)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reveal_offer_contact(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_booking_contact(uuid)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_offer_applications(integer)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.institution_application_inbox(integer)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.market_supply_snapshot(text, text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_contract_conditions(uuid, jsonb)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_contract(uuid, text)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_signer_readiness(uuid, uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_contract_integrity(uuid)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_smart_contracts(integer)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_contract_conditions()                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_contract(uuid, text, text)                         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_institution_offer(jsonb)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.institution_reputation(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_institution_offers(integer)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_offer(uuid, integer, text, uuid[])          TO authenticated;
GRANT EXECUTE ON FUNCTION public.counter_application(uuid, integer, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_application(uuid, text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application(uuid, jsonb)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_offer_contact(uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_contact(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_offer_applications(integer)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.institution_application_inbox(integer)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.market_supply_snapshot(text, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_contract_conditions(uuid, jsonb)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_contract(uuid, text)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.contract_signer_readiness(uuid, uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_contract_integrity(uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_smart_contracts(integer)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_contract_conditions()                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sign_contract(uuid, text, text)                      TO authenticated;

-- Defensa en profundidad: si el proyecto concede privilegios por defecto a anon/authenticated sobre las
-- tablas nuevas, aquí se retiran. Las tablas con registros del sistema nunca se escriben desde el cliente
-- (el contrato y su historial solo cambian con las funciones de este archivo).
REVOKE ALL ON public.job_offer_private, public.job_offer_shifts, public.application_events,
              public.smart_contracts, public.smart_contract_shifts, public.smart_contract_signatures,
              public.smart_contract_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.application_events, public.smart_contracts,
              public.smart_contract_shifts, public.smart_contract_signatures, public.smart_contract_events
  FROM authenticated;
REVOKE TRUNCATE ON public.job_offer_private, public.job_offer_shifts FROM authenticated;
REVOKE ALL ON SEQUENCE public.smart_contract_seq, public.smart_contract_events_id_seq, public.application_events_id_seq
  FROM anon, authenticated;

-- Solo código de servidor (service_role) o funciones internas:
REVOKE ALL ON FUNCTION public.notify_offer_alerts(uuid)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_reveal_quota(uuid, uuid, uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_contract_for_application(uuid, jsonb)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_contract_event(uuid, text, uuid, text, jsonb)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_contract_signature(uuid, uuid, text, text, text[], jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_contracts()                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_event_hash(text, integer, text, uuid, text, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_signature_hash(uuid, text, uuid, text, text, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_offer_alerts(uuid)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_reveal_quota(uuid, uuid, uuid)               TO service_role;
GRANT EXECUTE ON FUNCTION public.create_contract_for_application(uuid, jsonb)         TO service_role;
GRANT EXECUTE ON FUNCTION public.append_contract_event(uuid, text, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_contract_signature(uuid, uuid, text, text, text[], jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_contracts()                             TO service_role;
GRANT EXECUTE ON FUNCTION public.contract_event_hash(text, integer, text, uuid, text, jsonb, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_signature_hash(uuid, text, uuid, text, text, timestamptz, jsonb) TO authenticated, service_role;

-- ─── 13) Vencimientos automáticos (si pg_cron está disponible) ──────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('expire-stale-applications');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('expire-stale-contracts');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('expire-stale-applications', '*/15 * * * *', 'SELECT public.expire_stale_applications()');
    PERFORM cron.schedule('expire-stale-contracts', '*/30 * * * *', 'SELECT public.expire_stale_contracts()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo programar los vencimientos: %', SQLERRM;
END $$;

-- ─── 14) Actualización en vivo de los paneles ───────────────────────────────────
-- Realtime respeta RLS: cada parte solo recibe los cambios de sus propios contratos y turnos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.smart_contracts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.job_offer_shifts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo publicar las tablas nuevas en Realtime: %', SQLERRM;
END $$;

-- ─── 15) Equipo de confianza: invitar primero a quienes ya trabajaron contigo ───
-- Un aviso personal («la Clínica X te invita a postularte») convierte mucho más que una alerta genérica y
-- premia a los profesionales que ya demostraron su trabajo. Solo quien publicó la oferta puede invitar, solo
-- a sus favoritos (care_favorites), una sola vez por oferta y profesional, y nunca a quien ya se postuló.
CREATE TABLE IF NOT EXISTS public.offer_team_invites (
  job_offer_id    uuid NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_offer_id, professional_id)
);
CREATE INDEX IF NOT EXISTS idx_offer_team_invites_pro ON public.offer_team_invites (professional_id, created_at DESC);
ALTER TABLE public.offer_team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offer_team_invites_select ON public.offer_team_invites;
CREATE POLICY offer_team_invites_select ON public.offer_team_invites
  FOR SELECT TO authenticated
  USING (invited_by = auth.uid() OR professional_id = auth.uid() OR public.is_staff(auth.uid()));

-- Las invitaciones solo las escribe invite_team_to_offer(): sin INSERT/UPDATE/DELETE desde el cliente.
GRANT SELECT ON public.offer_team_invites TO authenticated;
GRANT ALL ON public.offer_team_invites TO service_role;
REVOKE ALL ON public.offer_team_invites FROM anon;

CREATE OR REPLACE FUNCTION public.invite_team_to_offer(p_offer_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  uuid := auth.uid();
  o      public.job_offers%ROWTYPE;
  v_name text;
  v_n    integer := 0;
  r      record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO o FROM public.job_offers WHERE id = p_offer_id;
  IF NOT FOUND OR o.posted_by <> v_uid THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF o.blocked OR o.status::text <> 'open' THEN
    RAISE EXCEPTION 'La oferta ya no está abierta' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Una institución') INTO v_name
    FROM public.institution_profiles ip WHERE ip.user_id = v_uid;
  v_name := COALESCE(v_name, 'Una institución');

  FOR r IN
    SELECT f.professional_id
      FROM public.care_favorites f
      JOIN public.professional_profiles pp ON pp.user_id = f.professional_id
     WHERE f.client_id = v_uid
       AND NOT COALESCE(pp.blocked, false)
       AND NOT EXISTS (SELECT 1 FROM public.applications a
                        WHERE a.job_offer_id = o.id AND a.professional_id = f.professional_id)
       AND NOT EXISTS (SELECT 1 FROM public.offer_team_invites i
                        WHERE i.job_offer_id = o.id AND i.professional_id = f.professional_id)
     ORDER BY f.created_at
     LIMIT 25
  LOOP
    INSERT INTO public.offer_team_invites (job_offer_id, professional_id, invited_by)
    VALUES (o.id, r.professional_id, v_uid)
    ON CONFLICT DO NOTHING;
    PERFORM public.hx_notify(r.professional_id, 'team_invite',
      v_name || ' te invita a postularte',
      'Ya trabajaron juntos y quieren contar contigo en «' || left(o.title, 60) || '» (' || COALESCE(o.city, 'tu ciudad') ||
        '). Revisa el turno y postúlate desde tu agenda.',
      '/dashboard/profesional');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.invite_team_to_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_team_to_offer(uuid) TO authenticated;
