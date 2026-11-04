// Acciones de servidor de la cola de pagos a profesionales (solo staff). La lógica está en `payoutQueue.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PayoutQueue, PayoutResult } from "./payoutQueue.server";

export type { PayoutItem, PayoutQueue, PayoutResult, PayoutStatus } from "./payoutQueue.server";

export const getPayoutQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<PayoutResult<PayoutQueue>> => {
    const { listPayoutQueue } = await import("./payoutQueue.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return listPayoutQueue(supabaseAdmin as never, context.userId, data);
  });

export const markPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<PayoutResult<{ status: "paid" | "failed" }>> => {
    const { markPayout } = await import("./payoutQueue.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return markPayout(supabaseAdmin as never, context.userId, data);
  });
