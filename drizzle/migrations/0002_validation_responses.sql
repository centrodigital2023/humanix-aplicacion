-- Worksheet de validación MLP: respuestas de encuesta y promo de 1 mes Premium
CREATE TABLE IF NOT EXISTS validation_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Contacto
  profile_type text NOT NULL DEFAULT 'familia',
  full_name text,
  whatsapp text,
  email text,
  -- Sección 1: Claridad de propuesta
  service_offer text,
  pain_point text,
  target_customer text,
  key_benefit text,
  -- Sección 2: Panorama del mercado
  current_solutions text,
  competitors text,
  retention_channels text,
  -- Sección 3: Prueba de demanda
  willingness_pct integer DEFAULT 50,
  comments text,
  -- Sección 4: Puntuación 0-5 por factor (max 30)
  score_clear_problem integer DEFAULT 0 CHECK (score_clear_problem BETWEEN 0 AND 5),
  score_demand integer DEFAULT 0 CHECK (score_demand BETWEEN 0 AND 5),
  score_reach integer DEFAULT 0 CHECK (score_reach BETWEEN 0 AND 5),
  score_benefit integer DEFAULT 0 CHECK (score_benefit BETWEEN 0 AND 5),
  score_competitive_adv integer DEFAULT 0 CHECK (score_competitive_adv BETWEEN 0 AND 5),
  score_passion integer DEFAULT 0 CHECK (score_passion BETWEEN 0 AND 5),
  -- Calculado: suma de los 6 factores
  total_score integer GENERATED ALWAYS AS (
    COALESCE(score_clear_problem, 0) + COALESCE(score_demand, 0) +
    COALESCE(score_reach, 0) + COALESCE(score_benefit, 0) +
    COALESCE(score_competitive_adv, 0) + COALESCE(score_passion, 0)
  ) STORED,
  -- Premio Premium
  promo_code text UNIQUE DEFAULT (
    'MLP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  premium_activated boolean DEFAULT false
);

ALTER TABLE validation_responses ENABLE ROW LEVEL SECURITY;

-- Cualquier visitante puede registrar su respuesta
CREATE POLICY "public_insert" ON validation_responses
  FOR INSERT WITH CHECK (true);

-- Solo el service role puede leer/modificar (dashboard superadmin via service key)
CREATE POLICY "service_full" ON validation_responses
  FOR ALL USING (auth.role() = 'service_role');
