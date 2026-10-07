-- Tabla de intentos de ingreso del código admin (rate-limiting).
-- Solo el service role puede leer/escribir. Se auto-purga con TTL en el edge function.
CREATE TABLE IF NOT EXISTS admin_code_attempts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    uuid        NOT NULL,
  ip         text
);

CREATE INDEX ON admin_code_attempts (user_id, created_at);

ALTER TABLE admin_code_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full" ON admin_code_attempts
  FOR ALL USING (auth.role() = 'service_role');
