// Cola de pagos a profesionales (turnos Bre-B pagados y terminados, con la llave de Humanix). Hoy el equipo dispersa
// a mano desde el panel de Firux (la API de Firux no mueve dinero): esta lógica lista la cola para el staff y marca
// cada pago como enviado o fallido con `hx_mark_payout` (solo service_role, migración 20261104160000).
// Inyectable y probada (`payoutQueue.server.test.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type PayoutStatus = "needs_key" | "queued" | "sent" | "paid" | "failed";

export interface PayoutRow {
  id: string;
  professional_id: string;
  booking_id: string | null;
  amount_cop: number;
  key_type: string | null;
  key_value: string | null;
  status: PayoutStatus;
  provider_ref: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutItem extends PayoutRow {
  professional_name: string | null;
  professional_phone: string | null;
}

export interface PayoutQueue {
  items: PayoutItem[];
  totals: Record<PayoutStatus, { count: number; amountCop: number }>;
}

export type PayoutErrorCode =
  "forbidden" | "invalid_input" | "not_found" | "already_paid" | "needs_key" | "failed";

export type PayoutResult<T> =
  ({ ok: true } & T) | { ok: false; code: PayoutErrorCode; message: string };

const MESSAGES: Record<PayoutErrorCode, string> = {
  forbidden: "Solo el equipo de Humanix puede ver y marcar pagos.",
  invalid_input: "Datos no válidos.",
  not_found: "No encontramos ese pago.",
  already_paid: "Ese pago ya estaba marcado como enviado.",
  needs_key: "El profesional aún no tiene llave Bre-B: no se puede marcar como enviado.",
  failed: "No pudimos actualizar el pago. Inténtalo de nuevo.",
};

function fail(code: PayoutErrorCode): { ok: false; code: PayoutErrorCode; message: string } {
  return { ok: false, code, message: MESSAGES[code] };
}

const STATUSES: PayoutStatus[] = ["needs_key", "queued", "sent", "paid", "failed"];

/** Totales por estado (pura). */
export function summarizePayouts(
  rows: Pick<PayoutRow, "status" | "amount_cop">[],
): PayoutQueue["totals"] {
  const totals = Object.fromEntries(
    STATUSES.map((s) => [s, { count: 0, amountCop: 0 }]),
  ) as PayoutQueue["totals"];
  for (const r of rows) {
    const t = totals[r.status];
    if (!t) continue;
    t.count += 1;
    t.amountCop += Number(r.amount_cop) || 0;
  }
  return totals;
}

/** Orden de trabajo: primero lo que se puede pagar ya (más viejo primero), luego fallidos, sin llave y lo pagado. */
export function sortPayouts<T extends Pick<PayoutRow, "status" | "created_at">>(rows: T[]): T[] {
  const rank: Record<PayoutStatus, number> = {
    queued: 0,
    sent: 1,
    failed: 2,
    needs_key: 3,
    paid: 4,
  };
  return [...rows].sort(
    (a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.created_at.localeCompare(b.created_at),
  );
}

async function isStaff(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.rpc("is_staff", { _user_id: userId });
  return data === true;
}

const listInput = z
  .object({ includePaidDays: z.number().int().min(0).max(90).default(14) })
  .default({
    includePaidDays: 14,
  });

export async function listPayoutQueue(
  admin: SupabaseClient,
  userId: string,
  data: unknown,
  now: () => number = Date.now,
): Promise<PayoutResult<PayoutQueue>> {
  const parsed = listInput.safeParse(data ?? undefined);
  if (!parsed.success) return fail("invalid_input");
  if (!(await isStaff(admin, userId))) return fail("forbidden");
  const since = new Date(now() - parsed.data.includePaidDays * 86_400_000).toISOString();
  const { data: rows, error } = await admin
    .from("payouts")
    .select(
      "id, professional_id, booking_id, amount_cop, key_type, key_value, status, provider_ref, error_code, created_at, updated_at",
    )
    .or(`status.neq.paid,updated_at.gte.${since}`)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return fail("failed");
  const list = (rows ?? []) as PayoutRow[];
  const ids = [...new Set(list.map((r) => r.professional_id))];
  const names = new Map<string, { name: string | null; phone: string | null }>();
  if (ids.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("user_id, full_name, phone")
      .in("user_id", ids);
    for (const p of (profs ?? []) as {
      user_id: string;
      full_name: string | null;
      phone: string | null;
    }[]) {
      names.set(p.user_id, { name: p.full_name, phone: p.phone });
    }
  }
  const items = sortPayouts(
    list.map((r) => ({
      ...r,
      professional_name: names.get(r.professional_id)?.name ?? null,
      professional_phone: names.get(r.professional_id)?.phone ?? null,
    })),
  );
  return { ok: true, items, totals: summarizePayouts(list) };
}

const markInput = z.object({
  payoutId: z.string().uuid(),
  status: z.enum(["paid", "failed"]),
  reference: z.string().trim().max(120).default(""),
});

export async function markPayout(
  admin: SupabaseClient,
  userId: string,
  data: unknown,
): Promise<PayoutResult<{ status: "paid" | "failed" }>> {
  const parsed = markInput.safeParse(data);
  if (!parsed.success) return fail("invalid_input");
  if (!(await isStaff(admin, userId))) return fail("forbidden");
  const { data: res, error } = await admin.rpc("hx_mark_payout", {
    p_payout: parsed.data.payoutId,
    p_status: parsed.data.status,
    p_ref: parsed.data.reference,
  });
  if (error) return fail("failed");
  switch (String(res)) {
    case "paid":
    case "failed":
      return { ok: true, status: res as "paid" | "failed" };
    case "not_found":
      return fail("not_found");
    case "already_paid":
      return fail("already_paid");
    case "needs_key":
      return fail("needs_key");
    default:
      return fail("failed");
  }
}
