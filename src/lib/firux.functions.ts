// Acciones de servidor de Bre-B con Firux. La lógica está en `firuxCharges.server.ts` (probada); aquí solo se conecta la sesión,
// la base con service role y la llave secreta de Firux (`FIRUX_API_KEY`, nunca llega al navegador).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChargeResult } from "./firux";
import type { ChargeDeps } from "./firuxCharges.server";
import type { ConnectDeps, ConnectResult } from "./firuxConnect.server";
import type { ConnectView } from "./firuxConnect";

export type { ChargeResult, ChargeView, ChargeErrorCode } from "./firux";

async function deps(): Promise<ChargeDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { supabaseChargeStore } = await import("./firuxCharges.server");
  const { wompiCreateCharge } = await import("./wompi");
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  return {
    store: supabaseChargeStore(supabaseAdmin as never),
    // Pasarela: Wompi (Firux fue retirado el 5 nov 2026).
    firux:
      publicKey && integritySecret
        ? wompiCreateCharge({
            publicKey,
            integritySecret,
            redirectUrl: process.env.WOMPI_REDIRECT_URL ?? "https://humanix.lat/pago/exito",
          })
        : null,
    now: Date.now,
    connect: { enabled: false, connection: async () => null, firuxFor: () => null },
  };
}

async function connectDeps(): Promise<ConnectDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { supabaseConnectStore } = await import("./firuxConnect.server");
  const { isFiruxConnectEnabled } = await import("./firuxConnect");
  const { buildFiruxConnectUrl, exchangeFiruxConnectCode } = await import("./firuxConnectApi");
  const key = process.env.FIRUX_API_KEY;
  const clientId = process.env.FIRUX_CONNECT_CLIENT_ID;
  const redirectUri =
    process.env.FIRUX_CONNECT_REDIRECT_URI ?? "https://humanix.lat/firux/conectado";
  const ready = !!key && !!clientId;
  return {
    enabled: !!key && isFiruxConnectEnabled(process.env),
    store: supabaseConnectStore(supabaseAdmin as never),
    authorizeUrl: ready
      ? (state) => buildFiruxConnectUrl({ clientId: clientId!, redirectUri, state })
      : null,
    exchange: ready
      ? (code) => exchangeFiruxConnectCode(fetch, { apiKey: key!, code, redirectUri })
      : null,
    now: Date.now,
    randomState: () =>
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    sha256: async (s) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
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

// ── «Conectar con Firux Pay» (profesional) ─────────────────────────────────────────────────────────────────────

export type { ConnectView } from "./firuxConnect";

/** Estado de la conexión del profesional. `disabled` mientras el flag esté apagado (la tarjeta no se muestra). */
export const getFiruxConnectStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ view: ConnectView; termsVersion: string }> => {
    const { connectStatus } = await import("./firuxConnect.server");
    return connectStatus(await connectDeps(), context.userId);
  });

const startInput = z.object({ acceptTerms: z.boolean(), termsVersion: z.string().max(40) });

/** Acepta la comisión vigente y devuelve la URL de Firux para conectar la cuenta. */
export const startFiruxConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConnectResult<{ url: string }>> => {
    const { startConnect } = await import("./firuxConnect.server");
    return startConnect(await connectDeps(), context.userId, data);
  });

const completeInput = z.object({
  code: z.string().min(1).max(512),
  state: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Firux volvió a /firux/conectado: confirma la conexión. */
export const completeFiruxConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => completeInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConnectResult<{ accountId: string }>> => {
    const { completeConnect } = await import("./firuxConnect.server");
    return completeConnect(await connectDeps(), context.userId, data);
  });

/** Desconecta la cuenta Firux: los turnos nuevos vuelven a la llave de Humanix y a la cola de pagos. */
export const disconnectFiruxConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectResult<object>> => {
    const { disconnect } = await import("./firuxConnect.server");
    return disconnect(await connectDeps(), context.userId);
  });
