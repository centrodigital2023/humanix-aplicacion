-- GRANTs explícitos para las tablas de PQRS creadas en 20261008100000 (la Data API exige GRANT y RLS).
-- · pqrs_ticket_events: el staff la lee desde el panel (política pqrs_events_staff_read); solo el servidor escribe.
-- · pqrs_intake_attempts: sin políticas ni acceso de clientes; solo el servidor (límites por hash).
-- · service_role: las funciones de servidor de src/lib/pqrs.functions.ts radican y consultan con el service role.
-- Con guardas por si alguna tabla aún no existe en un entorno.
DO $$
BEGIN
  IF to_regclass('public.pqrs_ticket_events') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.pqrs_ticket_events TO authenticated';
    EXECUTE 'GRANT ALL ON public.pqrs_ticket_events TO service_role';
  END IF;
  IF to_regclass('public.pqrs_intake_attempts') IS NOT NULL THEN
    EXECUTE 'GRANT ALL ON public.pqrs_intake_attempts TO service_role';
  END IF;
  IF to_regclass('public.pqrs_tickets') IS NOT NULL THEN
    EXECUTE 'GRANT ALL ON public.pqrs_tickets TO service_role';
  END IF;
END $$;
