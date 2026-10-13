-- ═══════════════════════════════════════════════════════════════════════════════
-- PQRS: cada cuenta ve SUS solicitudes, sin ver el triaje interno (decisión pedida el 2026-10-12)
--
-- Pedido: la familia puede enviar PQRS desde su panel (llegan al superadmin) y seguir su estado.
--
-- Qué había. `pqrs_tickets` deja leer sus filas a su dueña (`user_id = auth.uid()`) con TODAS las columnas. La radicación con sesión ya
-- vincula la cuenta (`handleSubmit` en src/lib/pqrs.server.ts), así que esa dueña puede leer también lo que es de uso interno: el
-- borrador de respuesta con IA, la prioridad, el nivel de seguridad, la categoría, a quién se asignó. Y `anon` conservaba SELECT de
-- tabla (sin filas por RLS, pero sin motivo).
--
-- Qué hace.
--   • `my_pqrs_tickets(p_limit)`: las solicitudes de quien llama, solo con lo que le corresponde (radicado, tipo, asunto, estado, plazos
--     y la respuesta final). La aplicación usa esto y no la tabla.
--   • La lectura directa de la tabla queda solo para el personal (`pqrs_staff_all`, que ya existe): se retira la política de la dueña.
--   • `anon` pierde todo privilegio sobre la tabla (la radicación pública entra por el servidor con la llave de servicio).
--
-- Idempotente. Si la tabla no existe (base nueva sin la cadena de PQRS), no hace nada.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_pqrs$
BEGIN
  IF to_regclass('public.pqrs_tickets') IS NULL THEN
    RAISE NOTICE 'PQRS propias: no existe pqrs_tickets; no se hace nada';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.my_pqrs_tickets(p_limit integer DEFAULT 20)
    RETURNS TABLE (
      id uuid, radicado text, type text, subject text, status text, created_at timestamptz, due_at timestamptz,
      first_response_at timestamptz, resolved_at timestamptz, resolution text
    )
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
    #variable_conflict use_column
    DECLARE
      v_uid uuid := auth.uid();
    BEGIN
      IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
      END IF;
      RETURN QUERY
      SELECT t.id, t.radicado, t.type, t.subject, t.status, t.created_at, t.due_at, t.first_response_at, t.resolved_at, t.resolution
        FROM public.pqrs_tickets t
       WHERE t.user_id = v_uid
       ORDER BY t.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
    END
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.my_pqrs_tickets(integer) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_pqrs_tickets(integer) TO authenticated';

  -- La lectura directa es del personal; la dueña pasa por la función de arriba.
  EXECUTE 'DROP POLICY IF EXISTS pqrs_select_owner_or_staff ON public.pqrs_tickets';
  EXECUTE 'REVOKE ALL ON TABLE public.pqrs_tickets FROM anon';
END
$hx_pqrs$;

NOTIFY pgrst, 'reload schema';
