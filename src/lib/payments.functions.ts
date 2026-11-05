// Acciones de servidor de pagos con Wompi. La lógica está en `charges.server.ts` (probada); aquí solo se conecta la sesión,
// la base con service role y las llaves de Wompi (WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET; el secreto nunca llega al
// navegador, solo el enlace firmado).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChargeResult } from "./wompi";
import type { ChargeDeps, SyncResult } from "./charges.server";

export type { ChargeResult, ChargeView, ChargeErrorCode } from "./wompi";

const DEFAULT_REDIRECT = "https://humanix.lat/pago/exito";

async function deps(): Promise<ChargeDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { supabaseChargeStore } = await import("./charges.server");
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  return {
    store: supabaseChargeStore(supabaseAdmin as never),
    wompi:
      publicKey && integritySecret
        ? {
            publicKey,
            integritySecret,
            redirectUrl: process.env.WOMPI_REDIRECT_URL || DEFAULT_REDIRECT,
          }
        : null,
    now: Date.now,
  };
}

const bookingInput = z.object({ bookingId: z.string().uuid() });
const topupInput = z.object({ amountCop: z.number().int().min(2_000).max(12_000_000) });
const planInput = z.object({ size: z.enum(["small", "large"]) });
const syncInput = z.object({
  transactionId: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** La familia paga su turno: devuelve el enlace del checkout de Wompi. */
export const payBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bookingInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeBooking } = await import("./charges.server");
    return chargeBooking(await deps(), context.userId, data.bookingId);
  });

/** El profesional recarga su billetera Humanix. */
export const topupWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => topupInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeTopup } = await import("./charges.server");
    return chargeTopup(await deps(), context.userId, data.amountCop);
  });

/** La institución paga su plan anual. */
export const payInstitutionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => planInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const { chargeInstitutionPlan } = await import("./charges.server");
    return chargeInstitutionPlan(await deps(), context.userId, data.size);
  });

/** Al volver de Wompi (/pago/exito?id=…): consulta la transacción en Wompi y la aplica si es de esta persona. */
export const syncPaymentReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => syncInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<SyncResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncWompiTransaction, supabaseChargeStore, supabaseApplyStore, wompiFetchTransaction } =
      await import("./charges.server");
    const publicKey = process.env.WOMPI_PUBLIC_KEY;
    return syncWompiTransaction(
      {
        store: supabaseChargeStore(supabaseAdmin as never),
        apply: supabaseApplyStore(supabaseAdmin as never),
        fetchTx: publicKey ? wompiFetchTransaction(publicKey) : null,
      },
      context.userId,
      data.transactionId,
    );
  });
