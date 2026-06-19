-- Fix: perfil profesional muestra "no disponible" porque:
-- 1) professional_profiles tiene RLS que bloquea lecturas de otras familias
-- 2) public_profiles_safe filtra published=true AND active=true

-- ─── public_professionals_safe: incluir todos los campos necesarios para el perfil ─
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  pp.user_id,
  pp.specialty,
  pp.sub_specialties,
  pp.gender,
  pp.years_experience,
  pp.home_city,
  pp.service_cities,
  pp.hourly_rate,
  pp.shift_rate,
  pp.monthly_rate,
  pp.avg_rating,
  pp.total_jobs,
  pp.trust_score,
  pp.verified,
  pp.rethus_verified,
  pp.rethus_number,
  pp.ai_summary,
  pp.ai_strengths,
  pp.certifications,
  pp.work_experience,
  pp.languages,
  pp.availability,
  pp.available,
  pp.lat,
  pp.lng,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  pp.avatar_url,
  pp.bio,
  pp.blocked,
  -- Datos de profiles incluidos via SQL JOIN (bypasa RLS)
  pr.full_name,
  pr.phone,
  CASE WHEN pp.available = TRUE THEN 'available' ELSE 'unavailable' END AS availability_status
FROM public.professional_profiles pp
LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
WHERE pp.blocked IS NOT TRUE;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;

-- ─── public_profiles_safe: eliminar gate published/active ────────────────────────
-- Muestra cualquier usuario con perfil profesional no bloqueado (para la página pública).
DROP VIEW IF EXISTS public.public_profiles_safe CASCADE;
CREATE VIEW public.public_profiles_safe
WITH (security_invoker = false) AS
SELECT
  p.user_id,
  p.full_name,
  p.city,
  p.avatar_url,
  p.bio
FROM public.profiles p
JOIN public.professional_profiles pp ON pp.user_id = p.user_id
WHERE pp.blocked IS NOT TRUE;

GRANT SELECT ON public.public_profiles_safe TO anon, authenticated;
