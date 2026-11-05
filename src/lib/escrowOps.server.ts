// Operación del pago retenido para el equipo (solo staff): reclamos de familias (turnos `disputed`), devoluciones
// (`booking_refunds`) y cuánto dinero está guardado ahora mismo. Decidir un reclamo usa `hx_escrow_resolve` y marcar
// una devolución `hx_mark_refund` (solo service_role, migración 20261104180000). Inyectable y probada
// (`escrowOps.server.test.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface DisputeItem {
  booking_id: string;
  client_id: string;
  professional_id: string;
  total_amount: number;
  professional_payout: number | null;
  dispute_reason: string | null;
  disputed_at: string | null;
  completed_at: string | null;
  client_name: string | null;
  professional_name: string | null;
}

export type RefundStatus = "needs_key" | "queued" | "paid" | "failed";

export interface RefundItem {
  id: string;
  booking_id: string | null;
  client_id: string;
  amount_cop: number;
  reason: "cancelled" | "dispute" | "duplicate";
  key_type: string | null;
  key_value: string | null;
  status: RefundStatus;
  provider_ref: string | null;
  error_code: string | null;
  created_at: string;
  client_name: string | null;
  client_phone: string | null;
}

export interface EscrowOps {
  disputes: DisputeItem[];
  refunds: RefundItem[];
  /** Dinero de turnos pagados que Humanix guarda ahora (retenido o en reclamo). */
  held: { count: number; amountCop: number };
}

export type EscrowOpsErrorCode =
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "not_open"
  | "already_paid"
  | "needs_key"
  | "failed";

export type EscrowOpsResult<T> =
  ({ ok: true } & T) | { ok: false; code: EscrowOpsErrorCode; message: string };

const MESSAGES: Record<EscrowOpsErrorCode, string> = {
  forbidden: "Solo el equipo de Humanix puede ver y decidir pagos retenidos.",
  invalid_input: "Datos no válidos.",
  not_found: "No encontramos ese turno o esa devolución.",
  not_open: "Ese pago ya no está retenido: alguien lo decidió antes.",
  already_paid: "Esa devolución ya estaba marcada como enviada.",
  needs_key: "La familia aún no tiene llave Bre-B: no se puede marcar como enviada.",
  failed: "No pudimos actualizar. Inténtalo de nuevo.",
};

function fail(code: EscrowOpsErrorCode): { ok: false; code: EscrowOpsErrorCode; message: string } {
  return { ok: false, code, message: MESSAGES[code] };
}

async function isStaff(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.rpc("is_staff", { _user_id: userId });
  return data === true;
}

/** Orden de trabajo de devoluciones: por enviar, fallidas, sin llave y al final las ya enviadas. */
export function sortRefunds<T extends Pick<RefundItem, "status" | "created_at">>(rows: T[]): T[] {
  const rank: Record<RefundStatus, number> = { queued: 0, failed: 1, needs_key: 2, paid: 3 };
  return [...rows].sort(
    (a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.created_at.localeCompare(b.created_at),
  );
}

export async function listEscrowOps(
  admin: SupabaseClient,
  userId: string,
  now: () => number = Date.now,
): Promise<EscrowOpsResult<EscrowOps>> {
  if (!(await isStaff(admin, userId))) return fail("forbidden");
  const since = new Date(now() - 14 * 86_400_000).toISOString();
  const [disputes, refunds, held] = await Promise.all([
    admin
      .from("service_bookings")
      .select(
        "id, client_id, professional_id, total_amount, professional_payout, dispute_reason, disputed_at, completed_at",
      )
      .eq("escrow_status", "disputed")
      .order("disputed_at", { ascending: true })
      .limit(200),
    admin
      .from("booking_refunds")
      .select(
        "id, booking_id, client_id, amount_cop, reason, key_type, key_value, status, provider_ref, error_code, created_at",
      )
      .or(`status.neq.paid,updated_at.gte.${since}`)
      .order("created_at", { ascending: true })
      .limit(500),
    admin
      .from("service_bookings")
      .select("total_amount")
      .in("escrow_status", ["held", "disputed"])
      .limit(5000),
  ]);
  if (disputes.error || refunds.error || held.error) return fail("failed");

  const d = (disputes.data ?? []) as Array<Record<string, unknown>>;
  const r = (refunds.data ?? []) as Array<Record<string, unknown>>;
  const ids = [
    ...new Set([
      ...d.flatMap((x) => [String(x.client_id), String(x.professional_id)]),
      ...r.map((x) => String(x.client_id)),
    ]),
  ];
  const people = new Map<string, { name: string | null; phone: string | null }>();
  if (ids.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("user_id, full_name, phone")
      .in("user_id", ids);
    for (const p of (profs ?? []) as Array<{
      user_id: string;
      full_name: string | null;
      phone: string | null;
    }>) {
      people.set(p.user_id, { name: p.full_name, phone: p.phone });
    }
  }

  const heldRows = (held.data ?? []) as Array<{ total_amount: number }>;
  return {
    ok: true,
    disputes: d.map((x) => ({
      booking_id: String(x.id),
      client_id: String(x.client_id),
      professional_id: String(x.professional_id),
      total_amount: Number(x.total_amount),
      professional_payout: x.professional_payout == null ? null : Number(x.professional_payout),
      dispute_reason: (x.dispute_reason as string | null) ?? null,
      disputed_at: (x.disputed_at as string | null) ?? null,
      completed_at: (x.completed_at as string | null) ?? null,
      client_name: people.get(String(x.client_id))?.name ?? null,
      professional_name: people.get(String(x.professional_id))?.name ?? null,
    })),
    refunds: sortRefunds(
      r.map((x) => ({
        ...(x as unknown as Omit<RefundItem, "client_name" | "client_phone">),
        amount_cop: Number(x.amount_cop),
        client_name: people.get(String(x.client_id))?.name ?? null,
        client_phone: people.get(String(x.client_id))?.phone ?? null,
      })),
    ),
    held: {
      count: heldRows.length,
      amountCop: heldRows.reduce((s, x) => s + (Number(x.total_amount) || 0), 0),
    },
  };
}

const resolveInput = z.object({
  bookingId: z.string().uuid(),
  action: z.enum(["release", "refund"]),
});

/** El equipo decide un reclamo: liberar al profesional o devolver todo a la familia. */
export async function resolveDispute(
  admin: SupabaseClient,
  userId: string,
  data: unknown,
): Promise<EscrowOpsResult<{ result: "released" | "refunding" }>> {
  const parsed = resolveInput.safeParse(data);
  if (!parsed.success) return fail("invalid_input");
  if (!(await isStaff(admin, userId))) return fail("forbidden");
  const { data: res, error } = await admin.rpc("hx_escrow_resolve", {
    p_booking: parsed.data.bookingId,
    p_action: parsed.data.action,
  });
  if (error) return fail("failed");
  switch (String(res)) {
    case "released":
    case "refunding":
      return { ok: true, result: res as "released" | "refunding" };
    case "already_released":
    case "not_open":
    case "not_releasable":
      return fail("not_open");
    case "not_found":
      return fail("not_found");
    default:
      return fail("failed");
  }
}

const markInput = z.object({
  refundId: z.string().uuid(),
  status: z.enum(["paid", "failed"]),
  reference: z.string().trim().max(120).default(""),
});

/** Marca una devolución como enviada desde Wompi (con la referencia) o fallida (con el motivo). */
export async function markRefund(
  admin: SupabaseClient,
  userId: string,
  data: unknown,
): Promise<EscrowOpsResult<{ status: "paid" | "failed" }>> {
  const parsed = markInput.safeParse(data);
  if (!parsed.success) return fail("invalid_input");
  if (!(await isStaff(admin, userId))) return fail("forbidden");
  const { data: res, error } = await admin.rpc("hx_mark_refund", {
    p_refund: parsed.data.refundId,
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
