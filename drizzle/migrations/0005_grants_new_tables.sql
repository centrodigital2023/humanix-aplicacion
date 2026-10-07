GRANT ALL ON public.admin_code_attempts, public.validation_otps, public.validation_responses, public.lead_captures TO service_role;
GRANT INSERT ON public.validation_responses TO anon, authenticated;