// Cobros con Wompi (servidor). Tres cobros: el turno que paga la familia, la recarga de la billetera del profesional y el
// plan anual de una institución. Vive aparte de `payments.functions.ts` para no viajar al navegador y poder probarse
// (`charges.test.ts`) con la base simulada.
//
// Orden seguro:
//   1. Se valida quién cobra y cuánto (el monto SIEMPRE sale de la base, nunca del navegador).
//   2. Si ya hay un cobro pendiente, vigente y sin intento en Wompi del mismo concepto, se devuelve ese.
//   3. Se guarda la fila `payment_charges` y su id es la `reference` del checkout de Wompi (única por intento: Wompi no
//      deja reutilizar una referencia ya usada). La firma de integridad impide cambiar el monto en el navegador.
//   4. El dinero solo se aplica con el aviso firmado `transaction.updated` APPROVED (`wompiWebhook.ts`) o al consultar la
//      transacción directo en Wompi (`syncWompiTransaction`), siempre por `hx_charge_paid` (idempotente).
import type { SupabaseClient } from "@supabase/supabase-js";
import { INSTITUTION_PLANS, type InstitutionSize } from "./commissionMatrix";
import { PAYABLE_BOOKING_STATUSES } from "./escrow";
import {
  buildCheckoutUrl,
  wompiApiBase,
  type ChargeResult,
  type ChargeView,
  type WompiTransactionEvent,
} from "./wompi";

export type { ChargeErrorCode, ChargeResult, ChargeView } from "./wompi";

export type ChargeKind = "booking" | "topup" | "plan";

export interface ChargeRow {
  id: string;
  provider_tx_id: string | null;
  kind: ChargeKind;
  user_id: string;
  booking_id: string | null;
  plan_key: string | null;
  amount_cop: number;
  status: string;
  checkout_url: string | null;
  expires_at: string | null;
}

export interface BookingForCharge {
  id: string;
  client_id: string;
  status: string;
  payment_method: string;
  total_amount: number;
  paid_at: string | null;
  professional_id?: string;
}

/** Lo que el servidor necesita de la base (adaptador real: `supabaseChargeStore`). */
export interface ChargeStore {
  booking(id: string): Promise<BookingForCharge | null>;
  charge(id: string): Promise<ChargeRow | null>;
  hasRole(userId: string, role: "professional" | "institution" | "family"): Promise<boolean>;
  openCharge(q: {
    kind: ChargeKind;
    userId: string;
    bookingId: string | null;
    amountCop: number;
  }): Promise<ChargeRow | null>;
  insertCharge(row: {
    kind: ChargeKind;
    user_id: string;
    booking_id: string | null;
    plan_key: string | null;
    amount_cop: number;
  }): Promise<ChargeRow>;
  updateCharge(id: string, patch: Partial<ChargeRow>): Promise<void>;
}

export interface WompiCheckoutConfig {
  publicKey: string;
  integritySecret: string;
  /** A dónde vuelve la persona después de pagar (por defecto https://humanix.lat/pago/exito). */
  redirectUrl: string;
}

export interface ChargeDeps {
  store: ChargeStore;
  /** `null` = faltan las llaves de Wompi (WOMPI_PUBLIC_KEY / WOMPI_INTEGRITY_SECRET). */
  wompi: WompiCheckoutConfig | null;
  now: () => number;
}

/** Vigencia del enlace de pago (24 h, como antes): Wompi muestra la cuenta regresiva y rechaza después. */
const CHARGE_TTL_MS = 24 * 3_600_000;

export const INSTITUTION_PLAN_KEY: Record<InstitutionSize, string> = {
  small: "institution_small_annual",
  large: "institution_large_annual",
};

function view(c: ChargeRow): ChargeView {
  return {
    chargeId: c.id,
    amountCop: Number(c.amount_cop),
    checkoutUrl: c.checkout_url,
    expiresAt: c.expires_at,
    status: c.status,
  };
}

async function issue(
  deps: ChargeDeps,
  input: {
    kind: ChargeKind;
    userId: string;
    bookingId: string | null;
    planKey: string | null;
    amountCop: number;
  },
): Promise<ChargeResult> {
  const cfg = deps.wompi;
  if (!cfg) return { ok: false, code: "not_configured" };
  const amount = Math.round(Number(input.amountCop));
  // Valida el monto antes de tocar la base (misma regla que el checkout).
  const probe = await buildCheckoutUrl({ ...cfg, amountCop: amount, reference: "probe" });
  if (!probe.ok) {
    return {
      ok: false,
      code: probe.error === "not_configured" ? "not_configured" : "amount_out_of_range",
    };
  }

  const open = await deps.store.openCharge({
    kind: input.kind,
    userId: input.userId,
    bookingId: input.bookingId,
    amountCop: amount,
  });
  if (open && open.checkout_url && !open.provider_tx_id) {
    const left = open.expires_at ? Date.parse(open.expires_at) - deps.now() : Infinity;
    if (left > 60_000) return { ok: true, charge: view(open) };
    await deps.store.updateCharge(open.id, { status: "expired" });
  }

  const row = await deps.store.insertCharge({
    kind: input.kind,
    user_id: input.userId,
    booking_id: input.bookingId,
    plan_key: input.planKey,
    amount_cop: amount,
  });
  const expiresAt = new Date(deps.now() + CHARGE_TTL_MS).toISOString();
  try {
    const built = await buildCheckoutUrl({
      ...cfg,
      amountCop: amount,
      reference: row.id,
      expirationTime: expiresAt,
    });
    if (!built.ok) throw new Error(built.error);
    const patch: Partial<ChargeRow> = { checkout_url: built.url, expires_at: expiresAt };
    await deps.store.updateCharge(row.id, patch);
    return { ok: true, charge: view({ ...row, ...patch }) };
  } catch {
    await deps.store.updateCharge(row.id, { status: "failed" }).catch(() => undefined);
    return { ok: false, code: "provider_error" };
  }
}

/** La familia paga su turno. Solo quien reservó, solo turnos digitales sin pagar, desde que lo pide. */
export async function chargeBooking(
  deps: ChargeDeps,
  userId: string,
  bookingId: string,
): Promise<ChargeResult> {
  const b = await deps.store.booking(bookingId);
  if (!b) return { ok: false, code: "not_found" };
  if (b.client_id !== userId) return { ok: false, code: "forbidden" };
  if (b.paid_at) return { ok: false, code: "already_paid" };
  if (b.payment_method === "CASH") return { ok: false, code: "cash_booking" };
  if (!PAYABLE_BOOKING_STATUSES.has(b.status)) return { ok: false, code: "not_payable" };
  return issue(deps, {
    kind: "booking",
    userId,
    bookingId: b.id,
    planKey: null,
    amountCop: Number(b.total_amount),
  });
}

/** El profesional recarga su billetera (para aceptar turnos en efectivo o salir del cupo). */
export async function chargeTopup(
  deps: ChargeDeps,
  userId: string,
  amountCop: number,
): Promise<ChargeResult> {
  if (!(await deps.store.hasRole(userId, "professional"))) return { ok: false, code: "forbidden" };
  return issue(deps, { kind: "topup", userId, bookingId: null, planKey: null, amountCop });
}

/** La institución paga su plan anual (un solo pago al año). */
export async function chargeInstitutionPlan(
  deps: ChargeDeps,
  userId: string,
  size: InstitutionSize,
): Promise<ChargeResult> {
  if (!(await deps.store.hasRole(userId, "institution"))) return { ok: false, code: "forbidden" };
  return issue(deps, {
    kind: "plan",
    userId,
    bookingId: null,
    planKey: INSTITUTION_PLAN_KEY[size],
    amountCop: INSTITUTION_PLANS[size].annualCOP,
  });
}

// ─── Aplicar una transacción de Wompi (aviso o consulta) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApplyStore {
  /** `hx_charge_paid`: aplica el pago una sola vez. Devuelve applied | already_applied | underpaid | unknown_charge… */
  applyPaid(chargeId: string, providerTxId: string, amountPaidCop: number): Promise<string>;
  /** Marca el intento rechazado/fallido (solo si el cobro sigue pendiente) y anota el id de Wompi. */
  markAttempt(chargeId: string, providerTxId: string, status: "pending" | "failed"): Promise<void>;
}

/** Qué hacer con el estado de una transacción de Wompi. Idempotente: se puede llamar con el mismo dato varias veces. */
export async function applyWompiTransaction(
  store: ApplyStore,
  tx: Pick<WompiTransactionEvent, "transactionId" | "reference" | "status" | "amountCop">,
): Promise<string> {
  if (!UUID_RE.test(tx.reference)) return "unknown_charge";
  switch (tx.status) {
    case "APPROVED":
      return store.applyPaid(tx.reference.toLowerCase(), tx.transactionId, tx.amountCop);
    case "DECLINED":
    case "ERROR":
    case "VOIDED":
      await store.markAttempt(tx.reference.toLowerCase(), tx.transactionId, "failed");
      return "marked_failed";
    case "PENDING":
      await store.markAttempt(tx.reference.toLowerCase(), tx.transactionId, "pending");
      return "pending";
    default:
      return "ignored";
  }
}

/** Lee la transacción directo de Wompi (`GET /v1/transactions/{id}`, pública). */
export type WompiFetchTx = (
  transactionId: string,
) => Promise<{ id: string; reference: string; status: string; amount_in_cents: number } | null>;

export function wompiFetchTransaction(
  publicKey: string,
  fetchImpl: typeof fetch = fetch,
): WompiFetchTx {
  const base = wompiApiBase(publicKey);
  return async (id) => {
    const r = await fetchImpl(`${base}/transactions/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: Record<string, unknown> };
    const d = j?.data;
    if (!d?.id || !d.reference) return null;
    return {
      id: String(d.id),
      reference: String(d.reference),
      status: String(d.status ?? "").toUpperCase(),
      amount_in_cents: Number(d.amount_in_cents ?? 0),
    };
  };
}

export type SyncResult = { ok: true; status: string; kind: ChargeKind | null } | { ok: false };

/**
 * La persona vuelve de Wompi a /pago/exito?id=<transacción>. Consultamos la transacción en Wompi (no confiamos en el
 * navegador) y, si es de un cobro de esta persona, la aplicamos igual que el aviso. Así no depende solo del webhook.
 */
export async function syncWompiTransaction(
  deps: { store: ChargeStore; apply: ApplyStore; fetchTx: WompiFetchTx | null },
  userId: string,
  transactionId: string,
): Promise<SyncResult> {
  if (!deps.fetchTx) return { ok: false };
  const tx = await deps.fetchTx(transactionId).catch(() => null);
  if (!tx || !UUID_RE.test(tx.reference)) return { ok: false };
  const charge = await deps.store.charge(tx.reference.toLowerCase());
  if (!charge || charge.user_id !== userId) return { ok: false };
  await applyWompiTransaction(deps.apply, {
    transactionId: tx.id,
    reference: tx.reference,
    status: tx.status,
    amountCop: Math.floor(tx.amount_in_cents / 100),
  });
  const after = await deps.store.charge(charge.id);
  return { ok: true, status: after?.status ?? charge.status, kind: charge.kind };
}

// ─── Adaptadores reales ──────────────────────────────────────────────────────

/** Tablas más nuevas que los tipos generados: cliente sin tipar, con service role. */
export function supabaseChargeStore(admin: SupabaseClient): ChargeStore {
  return {
    async booking(id) {
      const { data } = await admin
        .from("service_bookings")
        .select("id, client_id, professional_id, status, payment_method, total_amount, paid_at")
        .eq("id", id)
        .maybeSingle();
      return (data as BookingForCharge | null) ?? null;
    },
    async charge(id) {
      const { data } = await admin.from("payment_charges").select("*").eq("id", id).maybeSingle();
      return (data as ChargeRow | null) ?? null;
    },
    async hasRole(userId, role) {
      const { data } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", role)
        .limit(1);
      return (data ?? []).length > 0;
    },
    async openCharge({ kind, userId, bookingId, amountCop }) {
      let q = admin
        .from("payment_charges")
        .select("*")
        .eq("provider", "wompi")
        .eq("kind", kind)
        .eq("user_id", userId)
        .eq("status", "pending")
        .eq("amount_cop", amountCop)
        .not("checkout_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      q = bookingId ? q.eq("booking_id", bookingId) : q.is("booking_id", null);
      const { data } = await q;
      return ((data ?? [])[0] as ChargeRow | undefined) ?? null;
    },
    async insertCharge(row) {
      const { data, error } = await admin
        .from("payment_charges")
        .insert({ ...row, provider: "wompi" })
        .select("*")
        .single();
      if (error || !data) throw new Error(`charge_insert: ${error?.message ?? "sin fila"}`);
      return data as ChargeRow;
    },
    async updateCharge(id, patch) {
      const { error } = await admin.from("payment_charges").update(patch).eq("id", id);
      if (error) throw new Error(`charge_update: ${error.message}`);
    },
  };
}

export function supabaseApplyStore(admin: SupabaseClient): ApplyStore {
  return {
    async applyPaid(chargeId, providerTxId, amountPaidCop) {
      const { data, error } = await admin.rpc("hx_charge_paid", {
        p_charge: chargeId,
        p_provider_tx: providerTxId,
        p_amount_paid: amountPaidCop,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    async markAttempt(chargeId, providerTxId, status) {
      const { error } = await admin.rpc("hx_charge_attempt", {
        p_charge: chargeId,
        p_provider_tx: providerTxId,
        p_status: status,
      });
      if (error) throw new Error(error.message);
    },
  };
}
