-- RPC pública para contadores del Hero y LivePulseBar.
-- SECURITY DEFINER bypasa RLS para que anon pueda leer los totales reales.
-- Cuenta desde las tablas de perfiles (no user_roles) para máxima fidelidad.

CREATE OR REPLACE FUNCTION public.get_platform_counts()
RETURNS TABLE(
  professionals_total     bigint,
  professionals_available bigint,
  professionals_rethus    bigint,
  families_total          bigint,
  institutions_total      bigint,
  completed_services      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE blocked IS NOT TRUE)                                        AS professionals_total,

    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE available = TRUE
        AND blocked IS NOT TRUE)                                        AS professionals_available,

    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE rethus_verified = TRUE
        AND blocked IS NOT TRUE)                                        AS professionals_rethus,

    (SELECT COUNT(*) FROM public.family_profiles)                      AS families_total,

    (SELECT COUNT(*) FROM public.institution_profiles)                 AS institutions_total,

    (SELECT COUNT(*)
       FROM public.service_bookings
      WHERE status = 'completed')                                      AS completed_services;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;
