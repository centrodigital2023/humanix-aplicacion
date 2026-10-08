ALTER TABLE public.professional_verifications
  ADD COLUMN IF NOT EXISTS requested_by uuid,
  ADD COLUMN IF NOT EXISTS reverified boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_professional_verifications_single_rethus
  ON public.professional_verifications (user_id)
  WHERE check_type = 'rethus' AND reverified = false AND status IN ('verified','not_found','name_mismatch');

CREATE INDEX IF NOT EXISTS idx_professional_verifications_requested_by
  ON public.professional_verifications (requested_by, created_at) WHERE reverified = true;

CREATE TABLE IF NOT EXISTS public.professional_identity_documents (
  user_id uuid PRIMARY KEY,
  document_type text NOT NULL,
  document_enc text NOT NULL,
  document_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.professional_identity_documents TO service_role;
ALTER TABLE public.professional_identity_documents ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.professional_identity_documents IS 'Documento del profesional cifrado (AES-GCM) para la verificación ReTHUS. Solo service_role; sin políticas para clientes.';