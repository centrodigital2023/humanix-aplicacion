-- Documentos institucionales (2026-10-28): la cédula del representante legal deja de ser obligatoria.
-- La institución queda verificada con cámara de comercio y RUT aprobados. Recalcula «verified» de todas.
-- Depende de 20261028150000_institution_documents_review.sql. Idempotente.

CREATE OR REPLACE FUNCTION public.hx_inst_docs_complete(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.institution_documents d WHERE d.user_id = p_uid AND d.doc_type = 'camara_comercio' AND d.status = 'approved')
     AND EXISTS (SELECT 1 FROM public.institution_documents d WHERE d.user_id = p_uid AND d.doc_type = 'rut' AND d.status = 'approved')
$fn$;
REVOKE ALL ON FUNCTION public.hx_inst_docs_complete(uuid) FROM PUBLIC, anon, authenticated;

UPDATE public.institution_profiles ip
   SET verified = true
 WHERE NOT COALESCE(ip.verified, false)
   AND public.hx_inst_docs_complete(ip.user_id);
