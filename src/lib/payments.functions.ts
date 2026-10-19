// Confirmación del pago cuando la persona vuelve de Mercado Pago (acción de servidor).
// El servidor consulta el pago directamente en Mercado Pago y lo aplica con la misma lógica del webhook
// (`supabase/functions/_shared/mpPayment.ts`). Solo la dueña del pago puede confirmarlo. Ver `paymentReturn.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { confirmReturnedPayment, type ConfirmResult } from "./paymentReturn";
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
