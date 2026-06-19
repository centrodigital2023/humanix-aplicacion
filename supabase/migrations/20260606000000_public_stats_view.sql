-- ═══════════════════════════════════════════════════════════════
-- PALANCA 1: Vista pública de estadísticas (sin exponer datos sensibles)
-- Accesible por anon + authenticated. Usada en el Hero de la landing.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.public_stats AS
SELECT
  -- Profesionales con tarjeta RETHUS verificada
  (SELECT COUNT(*)::INTEGER
   FROM public.professional_profiles
   WHERE rethus_verified = true)                              AS verified_professionals,

  -- Profesionales disponibles ahora (disponibilidad activada)
  (SELECT COUNT(*)::INTEGER
   FROM public.professional_profiles
   WHERE available = true)                                    AS online_now,

  -- Familias e instituciones registradas
  (SELECT COUNT(*)::INTEGER
   FROM public.user_roles
   WHERE role IN ('family', 'institution'))                   AS total_clients,

  -- Nuevos usuarios en los últimos 30 días
  (SELECT COUNT(*)::INTEGER
   FROM public.profiles
   WHERE created_at > NOW() - INTERVAL '30 days')            AS new_this_month,

  -- Total de reservas/servicios completados
  (SELECT COUNT(*)::INTEGER
   FROM public.service_bookings
   WHERE status = 'completed')                               AS completed_services;

-- Acceso público: solo lectura, sin auth
GRANT SELECT ON public.public_stats TO anon, authenticated;
