-- ═══════════════════════════════════════════════════════════════════════════
-- RETHUS · RE-VERIFICACIÓN PERIÓDICA AUTOMATIZADA
-- La verificación de RETHUS hoy es un evento único (el evaluador aprueba el
-- documento una vez y professional_profiles.rethus_verified queda en true para
-- siempre). Esto añade un ciclo semanal que vuelve a pasar el certificado ya
-- aprobado por el mismo motor de IA (Lovable AI Gateway / Gemini, el que ya usa
-- document-verifier) para detectar certificados vencidos o que ya no son
-- válidos — sin depender de un scraper frágil contra SISPRO/RETHUS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Cuándo fue la última verificación vigente (para saber qué está vencido)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS rethus_verified_at TIMESTAMPTZ;

-- El flujo manual (evaluador.tsx) ya marca rethus_verified = true al aprobar;
-- sembramos rethus_verified_at para los que ya están verificados hoy, así el
-- primer barrido semanal no los marca a todos como "vencidos" de inmediato.
UPDATE public.professional_profiles
SET rethus_verified_at = NOW()
WHERE rethus_verified = true AND rethus_verified_at IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Bitácora de cada re-chequeo (auditoría + base para notificar/hacer panel)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rethus_checks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id       UUID        REFERENCES public.professional_documents(id) ON DELETE SET NULL,
  previous_verified BOOLEAN     NOT NULL,
  new_verified      BOOLEAN     NOT NULL,
  ai_score          NUMERIC,
  ai_notes          TEXT,
  action            TEXT        NOT NULL CHECK (action IN ('renewed', 'renewal_requested', 'no_document')),
  notified_whatsapp BOOLEAN     NOT NULL DEFAULT false,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rethus_checks_professional ON public.rethus_checks (professional_id, checked_at DESC);

ALTER TABLE public.rethus_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rethus_checks_owner_or_staff"
  ON public.rethus_checks FOR SELECT
  USING (professional_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "rethus_checks_staff_write"
  ON public.rethus_checks FOR INSERT
  WITH CHECK (public.is_staff(auth.uid()));

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Tarea semanal vía pg_cron + pg_net contra la edge function
--    (el secreto compartido se guarda en Supabase Vault, NUNCA en una
--    migración versionada — ver instrucciones más abajo)
-- ──────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ PASO MANUAL ÚNICO DEL OPERADOR (no se versiona el valor del secreto): ║
-- ║   1. Generar un secreto largo y aleatorio.                            ║
-- ║   2. En el SQL editor de Supabase ejecutar UNA vez:                   ║
-- ║        select vault.create_secret('<secreto>', 'rethus_cron_secret'); ║
-- ║   3. Configurar el MISMO valor como RETHUS_CRON_SECRET en             ║
-- ║      Edge Functions → rethus-weekly-check → Secrets.                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝
SELECT cron.schedule(
  'rethus-weekly-check',
  '0 9 * * 1',  -- lunes 9:00 UTC
  $cron$
  SELECT net.http_post(
    url     := 'https://rwllmouomrytejtbpxvn.supabase.co/functions/v1/rethus-weekly-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Rethus-Cron-Secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'rethus_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);
