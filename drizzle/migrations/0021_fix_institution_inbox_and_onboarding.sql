ALTER FUNCTION public.institution_application_inbox(integer) VOLATILE;
ALTER TABLE public.institution_profiles ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;
UPDATE public.institution_profiles SET onboarding_complete = true WHERE nit IS NOT NULL AND city IS NOT NULL;