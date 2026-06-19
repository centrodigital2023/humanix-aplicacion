DROP FUNCTION IF EXISTS public.get_platform_counts() CASCADE;
CREATE OR REPLACE FUNCTION public.get_platform_counts()
RETURNS TABLE(
  professionals_total bigint, professionals_available bigint,
  professionals_rethus bigint, professionals_online bigint,
  families_total bigint, families_online bigint,
  institutions_total bigint, institutions_online bigint,
  completed_services bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH
pro_stats AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE available = TRUE AND COALESCE(active, TRUE) IS NOT FALSE) AS available,
    COUNT(*) FILTER (WHERE rethus_verified = TRUE) AS rethus
  FROM public.professional_profiles
),
fam_stats AS (SELECT COUNT(*) AS total FROM public.family_profiles),
inst_stats AS (SELECT COUNT(*) AS total FROM public.institution_profiles),
svc AS (SELECT COUNT(*) AS completed FROM public.service_bookings WHERE status = 'completed')
SELECT ps.total, ps.available, ps.rethus, 0::bigint,
       fs.total, 0::bigint, is2.total, 0::bigint, sv.completed
FROM pro_stats ps, fam_stats fs, inst_stats is2, svc sv;
$$;
GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;