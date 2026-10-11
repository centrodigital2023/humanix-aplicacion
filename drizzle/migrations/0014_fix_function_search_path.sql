DO $$ DECLARE r record; BEGIN
FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('city_key','contract_event_hash','contract_signature_hash','default_contract_conditions','hx_cop','hx_duration_label','hx_sha256','kudos_allowed_kinds','offer_band_max','offer_band_min','pqrs_before_insert','rate_band_max','rate_band_min','reveal_daily_quota','smart_contract_immutable')
LOOP EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig); END LOOP; END $$;