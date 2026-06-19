-- =========================================================================
-- Public profile visibility fix
-- Problem: /profesional/:id mostraba "Profesional Humanix" a visitantes
-- anónimos porque `public_profiles_safe` era SECURITY INVOKER y la política
-- de `profiles` solo permite self/staff; el anon no podía leer el nombre.
--
-- Fix: recreamos el view como SECURITY DEFINER (corre como propietario), que
-- solo expone columnas no sensibles (full_name, city, avatar_url, bio) y lo
-- habilitamos para anon + authenticated. Email/teléfono NUNCA salen por aquí.
-- =========================================================================

REVOKE ALL ON public.public_profiles_safe FROM PUBLIC, anon, authenticated;
DROP VIEW IF EXISTS public.public_profiles_safe;

CREATE VIEW public.public_profiles_safe
WITH (security_invoker = false)
AS
SELECT user_id, full_name, city, avatar_url, bio
FROM public.profiles;

GRANT SELECT ON public.public_profiles_safe TO anon, authenticated;
