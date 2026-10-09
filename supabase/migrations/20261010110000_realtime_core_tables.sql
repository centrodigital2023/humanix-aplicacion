-- ═══════════════════════════════════════════════════════════════════════════════
-- Realtime: publicar las tablas que escuchan las pantallas de familia, profesional e institución.
--
-- Las pantallas se suscriben con «postgres_changes» (parte del turno en vivo, aviso de nuevo servicio,
-- estado de la reserva, chat, propuestas, postulaciones, plan, contratos…). Eso solo funciona si la tabla
-- pertenece a la publicación `supabase_realtime`. En la base de Lovable Cloud esa publicación estaba VACÍA:
-- ningún cambio llegaba en vivo y cada pantalla dependía de recargar a mano. Las migraciones antiguas ya
-- pedían estas altas, pero no se aplicaron en ese entorno.
--
-- Es idempotente y no destructiva: solo AGREGA tablas que existen y que aún no están publicadas; si una alta
-- falla (por ejemplo, el rol que migra no es dueño de la publicación) lo avisa sin abortar la migración.
-- Realtime respeta RLS: cada suscriptor solo recibe las filas que puede leer.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t      text;
  v_list text[] := ARRAY[
    'care_logs',          -- parte del turno en vivo (familia, círculo, institución)
    'service_bookings',   -- estado del servicio
    'notifications',      -- campana de avisos
    'messages',           -- chat por servicio
    'tracking_pings',     -- ubicación y ETA
    'service_ratings',    -- calificaciones pendientes
    'slot_proposals',     -- propuestas de horario
    'family_needs',       -- agenda de necesidades de familias
    'applications',       -- postulaciones
    'job_offers',         -- ofertas
    'job_offer_shifts',   -- agenda de turnos de instituciones
    'smart_contracts',    -- contratos inteligentes
    'mp_subscriptions',   -- plan vigente
    'emergency_incidents' -- botón SOS (consola de administración)
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que publicar';
    RETURN;
  END IF;
  FOREACH t IN ARRAY v_list LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo publicar public.%: %', t, SQLERRM;
    END;
  END LOOP;
END $$;
