-- Lead capture table: stores pre-registration survey responses from the
-- LeadCaptureWidget on the landing page. No auth required.
-- Rows are used for lead nurturing and activation campaigns.
CREATE TABLE IF NOT EXISTS lead_captures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  care_scope       text,          -- solo | familia | cronico | institucion
  frequency        text,          -- urgente | semanas | mensual | explorando
  contact_channel  text,          -- whatsapp | email | none
  whatsapp         text,
  email            text
);

ALTER TABLE lead_captures ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write
CREATE POLICY "service role full access" ON lead_captures
  USING (false)
  WITH CHECK (false);
