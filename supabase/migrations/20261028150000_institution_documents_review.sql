-- ═══════════════════════════════════════════════════════════════════════════════
-- DOCUMENTOS INSTITUCIONALES DE LA EPS/IPS: subida real + validación por el superadmin (pedido el 2026-10-28).
--
-- Antes
--   • El panel guardaba una URL «blob:» del navegador: el archivo nunca llegaba al servidor y nadie podía abrirlo.
--   • No existía el bucket «institution-docs» (el onboarding también fallaba al adjuntar la cámara de comercio).
--   • La cuenta de la institución podía cambiar el estado de sus propios documentos y su campo «verified».
--
-- Qué hace
--   1. Bucket privado «institution-docs» (carpeta = user_id) con las mismas reglas que «family-docs».
--   2. institution_documents: la institución sube y borra; solo el superadmin aprueba o rechaza (status, reviewed_*, reviewer_note).
--   3. institution_profiles.verified: solo lo cambia el superadmin o el recálculo automático. Queda en true cuando están APROBADOS
--      los tres obligatorios (cámara de comercio, RUT y cédula del representante legal) y vuelve a false si alguno se rechaza o se borra.
--   4. Borra las filas viejas con URL «blob:» (el archivo no existe en ningún lado).
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Bucket y políticas de storage ────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('institution-docs', 'institution-docs', false, 15728640)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS institution_docs_select_own ON storage.objects;
CREATE POLICY institution_docs_select_own ON storage.objects
  FOR SELECT USING (
    bucket_id = 'institution-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_staff(auth.uid()))
  );

DROP POLICY IF EXISTS institution_docs_insert_own ON storage.objects;
CREATE POLICY institution_docs_insert_own ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'institution-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS institution_docs_update_own ON storage.objects;
CREATE POLICY institution_docs_update_own ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'institution-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_staff(auth.uid()))
  );

DROP POLICY IF EXISTS institution_docs_delete_own ON storage.objects;
CREATE POLICY institution_docs_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'institution-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_staff(auth.uid()))
  );

-- ── 2) Solo el superadmin revisa ────────────────────────────────────────────────

-- auth.uid() nulo = service role / SQL directo (migraciones, funciones del servidor).
CREATE OR REPLACE FUNCTION public.hx_can_review_institution()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NULL OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
$fn$;
REVOKE ALL ON FUNCTION public.hx_can_review_institution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_can_review_institution() TO authenticated;

CREATE OR REPLACE FUNCTION public.hx_inst_docs_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.hx_can_review_institution() THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
      NEW.reviewed_by := COALESCE(auth.uid(), NEW.reviewed_by);
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewer_note := NULL;
  ELSE
    NEW.status := OLD.status;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.reviewer_note := OLD.reviewer_note;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inst_docs_guard ON public.institution_documents;
CREATE TRIGGER trg_inst_docs_guard
  BEFORE INSERT OR UPDATE ON public.institution_documents
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_docs_guard();

-- ── 3) verified de la institución ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_inst_docs_complete(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.institution_documents d WHERE d.user_id = p_uid AND d.doc_type = 'camara_comercio' AND d.status = 'approved')
     AND EXISTS (SELECT 1 FROM public.institution_documents d WHERE d.user_id = p_uid AND d.doc_type = 'rut' AND d.status = 'approved')
     AND EXISTS (SELECT 1 FROM public.institution_documents d WHERE d.user_id = p_uid AND d.doc_type = 'cedula_representante' AND d.status = 'approved')
$fn$;
REVOKE ALL ON FUNCTION public.hx_inst_docs_complete(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hx_inst_docs_sync_verified()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  PERFORM set_config('hx.inst_verify_sync', 'on', true);
  UPDATE public.institution_profiles
     SET verified = public.hx_inst_docs_complete(v_uid)
   WHERE user_id = v_uid
     AND verified IS DISTINCT FROM public.hx_inst_docs_complete(v_uid);
  PERFORM set_config('hx.inst_verify_sync', 'off', true);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inst_docs_sync_verified ON public.institution_documents;
CREATE TRIGGER trg_inst_docs_sync_verified
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.institution_documents
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_docs_sync_verified();

CREATE OR REPLACE FUNCTION public.hx_inst_profile_verified_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.hx_can_review_institution() THEN
      NEW.verified := false;
    END IF;
  ELSIF NEW.verified IS DISTINCT FROM OLD.verified
        AND NOT public.hx_can_review_institution()
        AND COALESCE(current_setting('hx.inst_verify_sync', true), 'off') <> 'on' THEN
    NEW.verified := OLD.verified;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inst_profile_verified_guard ON public.institution_profiles;
CREATE TRIGGER trg_inst_profile_verified_guard
  BEFORE INSERT OR UPDATE ON public.institution_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hx_inst_profile_verified_guard();

-- ── 4) Limpieza y realtime ──────────────────────────────────────────────────────

DELETE FROM public.institution_documents WHERE file_url LIKE 'blob:%';

ALTER TABLE public.institution_documents REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.institution_documents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
