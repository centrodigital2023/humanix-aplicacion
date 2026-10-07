-- Tabla de OTPs para verificar contacto antes de revelar el código Premium.
CREATE TABLE IF NOT EXISTS validation_otps (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  response_id  uuid        REFERENCES validation_responses(id) ON DELETE CASCADE,
  contact      text        NOT NULL,
  channel      text        NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  code         text        NOT NULL,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  verified_at  timestamptz,
  attempts     smallint    NOT NULL DEFAULT 0
);

CREATE INDEX ON validation_otps (response_id);
CREATE INDEX ON validation_otps (contact, created_at);

ALTER TABLE validation_otps ENABLE ROW LEVEL SECURITY;
-- Solo el service role (edge functions) puede leer/escribir.
CREATE POLICY "service_full" ON validation_otps
  FOR ALL USING (auth.role() = 'service_role');
