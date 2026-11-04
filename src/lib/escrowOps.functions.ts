// Acciones de servidor del pago retenido para el equipo (solo staff). La lógica está en `escrowOps.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EscrowOps, EscrowOpsResult } from "./escrowOps.server";

export type { DisputeItem, EscrowOps, EscrowOpsResult, RefundItem } from "./escrowOps.server";

export const getEscrowOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EscrowOpsResult<EscrowOps>> => {
    const { listEscrowOps } = await import("./escrowOps.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return listEscrowOps(supabaseAdmin as never, context.userId);
  });

export const resolveEscrowDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(
    async ({ data, context }): Promise<EscrowOpsResult<{ result: "released" | "refunding" }>> => {
      const { resolveDispute } = await import("./escrowOps.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return resolveDispute(supabaseAdmin as never, context.userId, data);
    },
  );

export const markRefundStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<EscrowOpsResult<{ status: "paid" | "failed" }>> => {
    const { markRefund } = await import("./escrowOps.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return markRefund(supabaseAdmin as never, context.userId, data);
  });
