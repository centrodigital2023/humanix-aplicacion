CREATE OR REPLACE FUNCTION public.publish_profile(_validation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_cv boolean;
  v_has_id boolean;
  v_has_rethus_or_diploma boolean;
  v_work_refs int;
  v_family_refs int;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents WHERE user_id = v_uid AND doc_type = 'cv' AND COALESCE(status,'') <> 'rejected') INTO v_has_cv;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents WHERE user_id = v_uid AND doc_type = 'id_document' AND COALESCE(status,'') <> 'rejected') INTO v_has_id;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents WHERE user_id = v_uid AND doc_type IN ('rethus','diploma') AND COALESCE(status,'') <> 'rejected') INTO v_has_rethus_or_diploma;
  SELECT COUNT(*) INTO v_work_refs FROM public.professional_references WHERE user_id = v_uid AND ref_type = 'work';
  SELECT COUNT(*) INTO v_family_refs FROM public.professional_references WHERE user_id = v_uid AND ref_type = 'family';
  IF NOT v_has_cv THEN v_errors := array_append(v_errors, 'Falta CV.'); END IF;
  IF NOT v_has_id THEN v_errors := array_append(v_errors, 'Falta documento de identidad.'); END IF;
  IF NOT v_has_rethus_or_diploma THEN v_errors := array_append(v_errors, 'Falta RETHUS o diploma.'); END IF;
  IF v_work_refs < 2 THEN v_errors := array_append(v_errors, 'Se requieren mínimo 2 referencias laborales.'); END IF;
  IF v_family_refs < 2 THEN v_errors := array_append(v_errors, 'Se requieren mínimo 2 referencias familiares.'); END IF;
  IF array_length(v_errors, 1) > 0 THEN RETURN jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors)); END IF;
  PERFORM set_config('app.allow_publish', 'on', true);
  UPDATE public.professional_profiles SET published = true, published_at = now(), last_validation_id = COALESCE(_validation_id, last_validation_id) WHERE user_id = v_uid;
  PERFORM set_config('app.allow_publish', 'off', true);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_profile(uuid) TO authenticated;
COMMENT ON FUNCTION public.publish_profile(uuid) IS 'Authenticated publication gate: CV, identity, credential and references; utility bills are retired and historical documents remain unchanged.';