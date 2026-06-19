-- Restrict public family map exposure: drop broad RLS policy and expose only safe columns via a definer view.
DROP POLICY IF EXISTS fam_select_map_public ON public.family_profiles;

CREATE OR REPLACE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT
  fp.user_id,
  fp.default_lat,
  fp.default_lng,
  fp.patient_name,
  fp.patient_relation,
  fp.default_address,
  fp.visible_on_map,
  fp.whatsapp
FROM public.family_profiles fp
WHERE fp.visible_on_map = true
  AND fp.default_lat IS NOT NULL
  AND fp.default_lng IS NOT NULL;

GRANT SELECT ON public.public_family_map_safe TO authenticated, anon;