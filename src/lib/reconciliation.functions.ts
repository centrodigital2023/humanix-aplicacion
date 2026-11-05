// Acciones de servidor de conciliación y dispersión (solo staff). La lógica está en `reconciliation.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StaffResult } from "./reconciliation.server";
import type { Reconciliation } from "./reconciliation";
import type { DispatchSummary } from "./dispersion.server";

export type { Reconciliation, ProfessionalBalance, ReconciliationIssue } from "./reconciliation";
export type { DispatchSummary } from "./dispersion.server";

export const getPaymentsReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<StaffResult<{ data: Reconciliation; dispersionEnabled: boolean }>> => {
      const { getReconciliation } = await import("./reconciliation.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return getReconciliation(supabaseAdmin as never, context.userId);
    },
  );

export const dispatchPayoutsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffResult<{ summary: DispatchSummary }>> => {
    const { dispatchNow } = await import("./reconciliation.server");
    const { dispersionDepsFromEnv } = await import("./dispersion.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return dispatchNow(supabaseAdmin as never, context.userId, dispersionDepsFromEnv);
  });

export const exportPaymentsLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<StaffResult<{ csv: string; rows: number }>> => {
    const { exportLedgerCsv } = await import("./reconciliation.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return exportLedgerCsv(supabaseAdmin as never, context.userId, data);
  });
