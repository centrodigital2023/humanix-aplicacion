CREATE OR REPLACE FUNCTION public.hx_ping_map()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'map_changed', 'live_map_ping', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    -- Only an empty invalidation signal is public: never IDs, locations or profile data.
    PERFORM realtime.send('{}'::jsonb, 'map_changed', 'live_map_public_ping', false);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$fn$;
REVOKE ALL ON FUNCTION public.hx_ping_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_ping_map() TO service_role;

DROP TRIGGER IF EXISTS trg_map_directory_ping ON public.professional_profiles;
CREATE TRIGGER trg_map_directory_ping
AFTER UPDATE OF home_city, service_cities, total_jobs, avatar_url, avg_rating, hourly_rate, specialty, sub_specialties, verified, rethus_verified, trust_score
ON public.professional_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ping_map();
DROP TRIGGER IF EXISTS trg_map_profile_label_ping ON public.profiles;
CREATE TRIGGER trg_map_profile_label_ping
AFTER UPDATE OF full_name, avatar_url ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ping_map();