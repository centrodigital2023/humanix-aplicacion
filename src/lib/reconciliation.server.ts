// Conciliación y dispersión manual desde /superadmin/pagos (solo staff). Inyectable y probada.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ledgerToCsv,
  normalizeReconciliation,
  type LedgerRow,
  type Reconciliation,
} from "./reconciliation";
import type { DispatchSummary, DispersionDeps } from "./dispersion.server";

export type StaffResult<T> = ({ ok: true } & T) | { ok: false; message: string };

async function isStaff(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.rpc("is_staff", { _user_id: userId });
  return data === true;
}

const FORBIDDEN = {
  ok: false as const,
  message: "Solo el equipo de Humanix puede ver la conciliación.",
};

export async function getReconciliation(
  admin: SupabaseClient,
  userId: string,
): Promise<StaffResult<{ data: Reconciliation; dispersionEnabled: boolean }>> {
  if (!(await isStaff(admin, userId))) return FORBIDDEN;
  const { data, error } = await admin.rpc("hx_reconciliation");
  if (error)
    return {
      ok: false,
      message: "No pudimos calcular la conciliación. ¿Está aplicada la migración 20261105100000?",
    };
  const { isDispersionEnabled } = await import("./dispersion");
  return {
    ok: true,
    data: normalizeReconciliation(data),
    dispersionEnabled: isDispersionEnabled(process.env),
  };
}

export async function dispatchNow(
  admin: SupabaseClient,
  userId: string,
  deps: () => Promise<DispersionDeps>,
): Promise<StaffResult<{ summary: DispatchSummary }>> {
  if (!(await isStaff(admin, userId))) return FORBIDDEN;
  const { runDispersion } = await import("./dispersion.server");
  const summary = await runDispersion(await deps(), "staff", userId);
  if (summary.reason === "disabled")
    return { ok: false, message: "La dispersión automática está apagada (FIRUX_PAYOUTS_ENABLED)." };
  if (summary.reason === "not_configured")
    return { ok: false, message: "Falta la llave de Firux (FIRUX_API_KEY)." };
  return { ok: true, summary };
}

const csvInput = z
  .object({ days: z.number().int().min(1).max(366).default(31) })
  .default({ days: 31 });

export async function exportLedgerCsv(
  admin: SupabaseClient,
  userId: string,
  data: unknown,
  now: () => number = Date.now,
): Promise<StaffResult<{ csv: string; rows: number }>> {
  if (!(await isStaff(admin, userId))) return FORBIDDEN;
  const parsed = csvInput.safeParse(data ?? undefined);
  if (!parsed.success) return { ok: false, message: "Datos no válidos." };
  const since = new Date(now() - parsed.data.days * 86_400_000).toISOString();
  const { data: rows, error } = await admin
    .from("ledger_entries")
    .select(
      "created_at, ref, from_account, from_pro, to_account, to_pro, amount_cop, booking_id, memo",
    )
    .gte("created_at", since)
    .order("id", { ascending: true })
    .limit(20000);
  if (error) return { ok: false, message: "No pudimos leer el libro." };
  const list = (rows ?? []) as LedgerRow[];
  return { ok: true, csv: ledgerToCsv(list), rows: list.length };
}
