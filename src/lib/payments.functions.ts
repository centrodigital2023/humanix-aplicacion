// Confirmación del pago o la suscripción cuando la persona vuelve de Mercado Pago, y cancelación de la renovación
// automática (acciones de servidor).
// El servidor consulta el pago directamente en Mercado Pago y lo aplica con la misma lógica del webhook
// (`supabase/functions/_shared/mpPayment.ts`). Solo la dueña del pago puede confirmarlo. Ver `paymentReturn.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  confirmReturnedPayment,
  confirmReturnedSubscription,
  type ConfirmResult,
} from "./paymentReturn";
import type { MpPreapproval } from "./planBilling";
import { makeRest, type MpPayment } from "../../supabase/functions/_shared/mpPayment";

const input = z.object({ paymentId: z.string().regex(/^\d{1,20}$/) });

export const confirmMercadoPagoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!token || !supabaseUrl || !serviceKey) return { ok: false, code: "not_configured" };

    return confirmReturnedPayment({
      paymentId: data.paymentId,
      userId: context.userId,
      now: Date.now,
      rest: makeRest(supabaseUrl, serviceKey),
      fetchPayment: async (id) => {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`mp_fetch_${r.status}`);
        return (await r.json()) as MpPayment;
      },
    });
  });

const MP_BASE = "https://api.mercadopago.com";

function serverConfig() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return token && supabaseUrl && serviceKey ? { token, supabaseUrl, serviceKey } : null;
}

async function mpFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const r = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`mp_fetch_${r.status}`);
  return (await r.json()) as T;
}

const subInput = z.object({ preapprovalId: z.string().regex(/^[0-9a-z]{8,64}$/i) });

export const confirmMercadoPagoSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, code: "not_configured" };
    const { token } = cfg;
    const cancelPreapproval = async (id: string) => {
      await mpFetch(token, `/preapproval/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
    };

    return confirmReturnedSubscription({
      preapprovalId: data.preapprovalId,
      userId: context.userId,
      now: Date.now,
      rest: makeRest(cfg.supabaseUrl, cfg.serviceKey),
      cancelPreapproval,
      fetchPreapproval: (id) =>
        mpFetch<MpPreapproval>(token, `/preapproval/${encodeURIComponent(id)}`),
      fetchLatestPayment: async (id) => {
        const found = await mpFetch<{
          results?: Array<{ payment?: { id?: unknown } | null; date_created?: string }>;
        }>(token, `/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
        const latest = (found?.results ?? [])
          .filter((r) => r.payment?.id)
          .sort((a, b) =>
            String(b.date_created ?? "").localeCompare(String(a.date_created ?? "")),
          )[0];
        if (!latest?.payment?.id) return null;
        return mpFetch<MpPayment>(
          token,
          `/v1/payments/${encodeURIComponent(String(latest.payment.id))}`,
        );
      },
    });
  });

export type CancelRenewalResult = { ok: true } | { ok: false; code: "none" | "not_configured" };

/** Cancela la renovación automática: el plan sigue vigente hasta su vencimiento, solo se deja de cobrar. */
export const cancelMercadoPagoRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelRenewalResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, code: "not_configured" };
    const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
    const rows = (await (
      await rest(`mp_subscriptions?user_id=eq.${context.userId}&select=mp_preapproval_id`)
    ).json()) as Array<{ mp_preapproval_id: string | null }>;
    const id = rows[0]?.mp_preapproval_id;
    if (!id) return { ok: false, code: "none" };
    await mpFetch(cfg.token, `/preapproval/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    await rest(
      `mp_subscriptions?user_id=eq.${context.userId}&mp_preapproval_id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ mp_preapproval_id: null }),
      },
    );
    return { ok: true };
  });
