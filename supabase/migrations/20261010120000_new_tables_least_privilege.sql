-- ═══════════════════════════════════════════════════════════════════════════════
-- Mínimo privilegio explícito para las tablas que crean las migraciones 20261008100000 → 20261010100000
--
-- En la base de Lovable Cloud los privilegios por defecto (pg_default_acl) conceden ALL a anon y authenticated sobre
-- toda tabla, secuencia y función nueva del esquema public. Las migraciones anteriores concedían lo necesario pero no
-- siempre retiraban lo heredado, así que la seguridad de estas tablas dependía solo de RLS. Aquí se fija, tabla por
-- tabla, el conjunto exacto (defensa en profundidad):
--   · anon: nada.
--   · authenticated: solo lo que sus políticas RLS usan (lecturas; escritura solo donde el producto la permite).
--   · service_role: todo (código de servidor).
-- Idempotente. Las tablas que no existan en un entorno se omiten.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('pqrs_ticket_events',          'SELECT'),                          -- el staff lee la bitácora; escribe el servidor
      ('pqrs_intake_attempts',        ''),                                -- solo servidor (límites por hash)
      ('opportunity_contact_reveals', 'SELECT'),                          -- auditoría: se escribe con la función de desbloqueo
      ('opportunity_alerts',          'SELECT, INSERT, UPDATE, DELETE'),  -- cada profesional gestiona sus alertas
      ('opportunity_alert_log',       ''),                                -- anti-spam interno
      ('job_offer_private',           'SELECT, INSERT, UPDATE'),          -- autor y staff (RLS)
      ('job_offer_shifts',            'SELECT, INSERT, UPDATE, DELETE'),  -- agenda de turnos del autor (RLS)
      ('application_events',          'SELECT'),                          -- historial: lo escribe el sistema
      ('smart_contracts',             'SELECT'),                          -- el contrato solo cambia con sus funciones
      ('smart_contract_shifts',       'SELECT'),
      ('smart_contract_signatures',   'SELECT'),
      ('smart_contract_events',       'SELECT'),
      ('offer_team_invites',          'SELECT'),                          -- las escribe invite_team_to_offer()
      ('booking_contact_reveals',     'SELECT'),                          -- las escribe get_booking_contact()
      ('care_kudos',                  'SELECT'),                          -- los escribe send_kudos()
      ('care_logs',                   'SELECT, INSERT')                   -- bitácora de solo-agregar
    ) AS v(tbl, privs)
  LOOP
    IF to_regclass('public.' || t.tbl) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tbl);
    IF t.privs <> '' THEN
      EXECUTE format('GRANT %s ON public.%I TO authenticated', t.privs, t.tbl);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t.tbl);
  END LOOP;
END $$;

-- Secuencias de esas tablas: nadie desde la API (el servidor las usa con service_role).
DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['pqrs_radicado_seq', 'pqrs_intake_attempts_id_seq', 'application_events_id_seq',
                           'smart_contract_events_id_seq', 'smart_contract_seq']
  LOOP
    IF to_regclass('public.' || s) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', s);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', s);
    END IF;
  END LOOP;
END $$;

-- Función de disparador: nadie la ejecuta directamente (el privilegio se comprueba al crear el disparador).
DO $$
BEGIN
  IF to_regprocedure('public.pqrs_before_insert()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pqrs_before_insert() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
