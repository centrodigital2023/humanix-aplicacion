// Acciones de servidor de Bre-B con Firux. La lógica está en `firuxCharges.server.ts` (probada); aquí solo se conecta la sesión,
// la base con service role y la llave secreta de Firux (`FIRUX_API_KEY`, nunca llega al navegador).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChargeResult } from "./firux";
import type { ChargeDeps } from "./firuxCharges.server";

export type { ChargeResult, ChargeView, ChargeErrorCode } from "./firux";

async function deps(): Promise<ChargeDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { supabaseChargeStore, firuxCreateCharge } = await import("./firuxCharges.server");
  const key = process.env.FIRUX_API_KEY;
  return {
    store: supabaseChargeStore(supabaseAdmin as never),
    firux: key ? firuxCreateCharge(key) : null,
    now: Date.now,
  };
}

const bookingInput = z.object({ bookingId: z.string().uuid() });
const topupInput = z.object({ amountCop: z.number().int().min(2_000).max(12_000_000) });
const planInput = z.object({ size: z.enum(["small", "large"]) });

/** La familia paga su turno: devuelve el QR Bre-B y el enlace para abrir su banco. */
export const payBookingWithBreb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bookingInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeBooking } = await import("./firuxCharges.server");
    return chargeBooking(await deps(), context.userId, data.bookingId);
  });

/** El profesional recarga su billetera Humanix. */
export const topupWalletWithBreb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => topupInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeTopup } = await import("./firuxCharges.server");
    return chargeTopup(await deps(), context.userId, data.amountCop);
  });

/** La institución paga su plan anual. */
export const payInstitutionPlanWithBreb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => planInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeInstitutionPlan } = await import("./firuxCharges.server");
    return chargeInstitutionPlan(await deps(), context.userId, data.size);
  });
