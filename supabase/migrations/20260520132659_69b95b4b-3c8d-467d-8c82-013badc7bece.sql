
-- 1) Restrict public_profiles_safe view to published & active professionals only
REVOKE ALL ON public.public_profiles_safe FROM PUBLIC, anon, authenticated;
DROP VIEW IF EXISTS public.public_profiles_safe;

CREATE VIEW public.public_profiles_safe
WITH (security_invoker = false)
AS
SELECT p.user_id, p.full_name, p.city, p.avatar_url, p.bio
FROM public.profiles p
JOIN public.professional_profiles pp ON pp.user_id = p.user_id
WHERE pp.published = true
  AND pp.active = true
  AND COALESCE(pp.blocked, false) = false;

GRANT SELECT ON public.public_profiles_safe TO anon, authenticated;

-- 2) Server-side publish gate: prevent direct flips of published=true via PostgREST.
-- Only a SECURITY DEFINER RPC can toggle published to true.
CREATE OR REPLACE FUNCTION public.guard_professional_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow staff to do whatever
  IF public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Allow if the RPC set the bypass flag for this transaction
  IF current_setting('app.allow_publish', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Block flipping published from false -> true outside the RPC
  IF COALESCE(NEW.published, false) = true
     AND COALESCE(OLD.published, false) = false THEN
    RAISE EXCEPTION 'Publicación bloqueada: debes usar publish_profile() tras la validación IA.';
  END IF;

  -- Also block users from advancing published_at by themselves
  IF NEW.published_at IS DISTINCT FROM OLD.published_at
     AND COALESCE(NEW.published, false) = true THEN
    NEW.published_at := OLD.published_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_professional_publish ON public.professional_profiles;
CREATE TRIGGER trg_guard_professional_publish
BEFORE UPDATE ON public.professional_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_professional_publish();

-- 3) Authoritative server-side publish RPC.
-- Validates documents & references in the DB (no client-supplied data),
-- then sets published=true with the per-tx bypass flag.
CREATE OR REPLACE FUNCTION public.publish_profile(_validation_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_cv boolean;
  v_has_id boolean;
  v_has_bill boolean;
  v_has_rethus_or_diploma boolean;
  v_work_refs int;
  v_family_refs int;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.professional_documents
                 WHERE user_id = v_uid AND doc_type = 'cv'
                   AND COALESCE(status,'') <> 'rejected') INTO v_has_cv;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents
                 WHERE user_id = v_uid AND doc_type = 'id_document'
                   AND COALESCE(status,'') <> 'rejected') INTO v_has_id;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents
                 WHERE user_id = v_uid AND doc_type = 'utility_bill'
                   AND COALESCE(status,'') <> 'rejected') INTO v_has_bill;
  SELECT EXISTS (SELECT 1 FROM public.professional_documents
                 WHERE user_id = v_uid AND doc_type IN ('rethus','diploma')
                   AND COALESCE(status,'') <> 'rejected') INTO v_has_rethus_or_diploma;

  SELECT COUNT(*) INTO v_work_refs FROM public.professional_references
    WHERE user_id = v_uid AND ref_type = 'work';
  SELECT COUNT(*) INTO v_family_refs FROM public.professional_references
    WHERE user_id = v_uid AND ref_type = 'family';

  IF NOT v_has_cv THEN v_errors := array_append(v_errors, 'Falta CV.'); END IF;
  IF NOT v_has_id THEN v_errors := array_append(v_errors, 'Falta documento de identidad.'); END IF;
  IF NOT v_has_bill THEN v_errors := array_append(v_errors, 'Falta recibo de servicios.'); END IF;
  IF NOT v_has_rethus_or_diploma THEN
    v_errors := array_append(v_errors, 'Falta RETHUS o diploma.');
  END IF;
  IF v_work_refs < 2 THEN
    v_errors := array_append(v_errors, 'Se requieren mínimo 2 referencias laborales.');
  END IF;
  IF v_family_refs < 2 THEN
    v_errors := array_append(v_errors, 'Se requieren mínimo 2 referencias familiares.');
  END IF;

  IF array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors));
  END IF;

  PERFORM set_config('app.allow_publish', 'on', true);
  UPDATE public.professional_profiles
     SET published = true,
         published_at = now(),
         last_validation_id = COALESCE(_validation_id, last_validation_id)
   WHERE user_id = v_uid;
  PERFORM set_config('app.allow_publish', 'off', true);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_profile(uuid) TO authenticated;
