-- Quitar trigger de cálculo de comisión si existe (era opcional)
DROP TRIGGER IF EXISTS trg_compute_platform_fee ON public.service_bookings;

-- Cambiar default a 0 y poner en 0 los existentes
ALTER TABLE public.service_bookings
  ALTER COLUMN platform_fee_pct SET DEFAULT 0,
  ALTER COLUMN platform_fee_amount SET DEFAULT 0;

UPDATE public.service_bookings
SET platform_fee_pct = 0,
    platform_fee_amount = 0,
    professional_payout = total_amount
WHERE platform_fee_pct <> 0 OR platform_fee_amount <> 0;

-- Marcar pagos como "directos al profesional"
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'direct_to_professional';

COMMENT ON COLUMN public.service_bookings.payment_mode IS
  'direct_to_professional = el profesional cobra al cliente fuera de la plataforma (efectivo, transferencia, Nequi). platform = pago intermediado por Humanix (futuro).';