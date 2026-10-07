-- Adds multi-turn conversation state to whatsapp_contacts.
-- wa_state holds the current booking/search flow step as JSONB.
-- wa_state_updated_at tracks when the state was last changed so
-- stale flows can be reset automatically by the webhook.
ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS wa_state        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wa_state_updated_at timestamptz;
