-- ═══════════════════════════════════════════════════════════════════════════════
-- Alertas SOS para quien las atiende (decisión pedida el 2026-10-12)
--
-- Con 20261012160000 un SOS avisa dentro de la app y queda en `clinical_alerts`. Falta el otro lado: que el círculo de cuidado,
-- el profesional con servicio vigente y la institución VEAN las alertas abiertas, sepan quién las pidió, y las atiendan («ya voy»,
-- resuelta, falsa alarma) con los privilegios por columna y el disparador que ya existen.
--
--   • `my_sos_alerts(p_limit)`: las alertas SOS de los últimos 7 días que quien llama puede ver (exactamente las que dejan ver
--     las políticas: usa `hx_can_access_alert`), con el nombre CORTO de la persona («Ana R.») y de quien la atendió, sin abrir
--     `profiles`. Primero las activas.
--   • `clinical_alerts` entra en la publicación `supabase_realtime`: la lista se actualiza sola cuando alguien atiende una alerta.
--     Realtime respeta RLS (cada suscriptor solo recibe las filas que `hx_can_access_alert` le permite).
--
-- Idempotente. Si faltan las tablas o las funciones de la migración anterior, no hace nada.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $hx_feed$
BEGIN
  IF to_regclass('public.clinical_alerts') IS NULL
     OR to_regprocedure('public.hx_can_access_alert(uuid, uuid, text)') IS NULL
     OR to_regprocedure('public.party_display_name(uuid)') IS NULL THEN
    RAISE NOTICE 'Alertas SOS: faltan clinical_alerts, hx_can_access_alert o party_display_name; no se hace nada';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.my_sos_alerts(p_limit integer DEFAULT 20)
    RETURNS TABLE (
      id                   uuid,
      patient_id           uuid,
      patient_name         text,
      triggered_by_name    text,
      status               text,
      lat                  double precision,
      lng                  double precision,
      created_at           timestamptz,
      acknowledged_by_name text,
      acknowledged_at      timestamptz,
      resolved_at          timestamptz,
      notified_whatsapp    boolean,
      inapp_notified       integer,
      mine                 boolean
    )
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT a.id,
             a.patient_id,
             public.party_display_name(a.patient_id),
             CASE WHEN a.triggered_by IS NOT NULL AND a.triggered_by <> a.patient_id
                  THEN public.party_display_name(a.triggered_by) END,
             a.status,
             a.lat,
             a.lng,
             a.created_at,
             CASE WHEN a.acknowledged_by IS NOT NULL THEN public.party_display_name(a.acknowledged_by) END,
             a.acknowledged_at,
             a.resolved_at,
             a.notified_whatsapp,
             a.inapp_notified,
             a.patient_id = auth.uid()
        FROM public.clinical_alerts a
       WHERE auth.uid() IS NOT NULL
         AND a.alert_type = 'sos_manual'
         AND a.created_at > now() - interval '7 days'
         AND public.hx_can_access_alert(a.patient_id, a.booking_id, a.alert_type)
       ORDER BY (a.status = 'active') DESC, a.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    $fn$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.my_sos_alerts(integer) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_sos_alerts(integer) TO authenticated';

  -- Tiempo real: la tabla entra en la publicación (si existe y aún no está). Un fallo se avisa sin abortar.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clinical_alerts') THEN
    BEGIN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.clinical_alerts';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo publicar public.clinical_alerts: %', SQLERRM;
    END;
  END IF;
END
$hx_feed$;
