-- Fix: show ALL registered profiles on the map, not just available/published ones.
-- Uses SELECT * to avoid column-not-found errors across different DB states.
-- Available = green marker, unavailable/inactive = gray marker.

-- ─── PROFESSIONAL PROFILES ───────────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  pp.*,
  CASE WHEN pp.available = true THEN 'available' ELSE 'unavailable' END AS availability_status
FROM public.professional_profiles pp
WHERE pp.blocked = false;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;

-- ─── FAMILY PROFILES ─────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT fp.*
FROM public.family_profiles fp
WHERE fp.default_lat IS NOT NULL
  AND fp.default_lng IS NOT NULL;

GRANT SELECT ON public.public_family_map_safe TO authenticated, anon;

-- ─── INSTITUTION PROFILES ────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT ip.*
FROM public.institution_profiles ip
WHERE ip.lat IS NOT NULL
  AND ip.lng IS NOT NULL;

GRANT SELECT ON public.public_institutions_safe TO authenticated, anon;
