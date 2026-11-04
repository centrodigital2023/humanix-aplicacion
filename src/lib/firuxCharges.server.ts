// Cobros Bre-B con Firux (servidor). Tres cobros: el turno que paga la familia, la recarga de la billetera del profesional y el
// plan anual de una institución. Vive aparte de `firux.functions.ts` para no viajar al navegador y poder probarse
// (`firuxCharges.test.ts`) con la base y Firux simulados.
//
// Orden seguro:
//   1. Se valida quién cobra y cuánto (el monto SIEMPRE sale de la base, nunca del navegador).
//   2. Si ya hay un cobro pendiente y vigente del mismo concepto, se devuelve ese (no se crean dos QR para lo mismo).
//   3. Se guarda la fila `firux_charges` y su id es la `Idempotency-Key`: si Firux recibe el mismo pedido dos veces, crea un
//      solo cobro.
//   4. El dinero solo se aplica cuando llega el aviso firmado `charge.paid` (`firuxWebhook.ts` → `hx_firux_charge_paid`).
//
// «Conectar con Firux Pay» (`ChargeDeps.connect`, apagado salvo FIRUX_CONNECT_ENABLED): si el profesional del turno tiene
// su cuenta Firux conectada y aceptó la comisión vigente, el cobro del turno se crea a nombre de esa cuenta con la comisión
// de Humanix incluida (`application_fee`). El dinero le llega directo y el turno no entra a la cola `payouts`
// (migración 20261104140000). En cualquier otro caso se cobra con la llave de Humanix, como hoy.
import type { SupabaseClient } from "@supabase/supabase-js";
import { INSTITUTION_PLANS, type InstitutionSize } from "./commissionMatrix";
import { PAYABLE_BOOKING_STATUSES } from "./escrow";
import { chooseChargeRoute, type ChargeRoute, type FiruxConnectionRow } from "./firuxConnect";
import {
  buildChargeBody,
  FIRUX_API,
  payLink,
  type ChargeResult,
  type ChargeView,
  type FiruxCharge,
} from "./firux";

export type { ChargeErrorCode, ChargeResult, ChargeView } from "./firux";

export type ChargeKind = "booking" | "topup" | "plan";

export interface ChargeRow {
  id: string;
  firux_id: string | null;
  kind: ChargeKind;
  user_id: string;
  booking_id: string | null;
  plan_key: string | null;
  amount_cop: number;
  status: string;
  qr_emv: string | null;
  payment_url: string | null;
  expires_at: string | null;
  /** Columnas de la migración 20261104140000 (solo se leen/escriben con Conectar encendido). */
  route?: "platform" | "connected" | null;
  firux_account_id?: string | null;
  application_fee_cop?: number | null;
}

export interface BookingForCharge {
  id: string;
  client_id: string;
  status: string;
  payment_method: string;
  total_amount: number;
  paid_at: string | null;
  professional_id?: string;
  /** Comisión de Humanix ya calculada en la base (con la exención del primer turno descontada). */
  platform_fee_amount?: number | null;
}

/** Lo que el servidor necesita de la base (adaptador real: `supabaseChargeStore`). */
export interface ChargeStore {
  booking(id: string): Promise<BookingForCharge | null>;
  chargeByFiruxId(firuxId: string): Promise<ChargeRow | null>;
  hasRole(userId: string, role: "professional" | "institution" | "family"): Promise<boolean>;
  openCharge(q: {
    kind: ChargeKind;
    userId: string;
    bookingId: string | null;
    amountCop: number;
    /** Solo con Conectar encendido: que el cobro abierto sea de la misma ruta. */
    route?: "platform" | "connected";
  }): Promise<ChargeRow | null>;
  insertCharge(row: {
    kind: ChargeKind;
    user_id: string;
    booking_id: string | null;
    plan_key: string | null;
    amount_cop: number;
    route?: "connected";
    firux_account_id?: string;
    application_fee_cop?: number;
  }): Promise<ChargeRow>;
  updateCharge(id: string, patch: Partial<ChargeRow>): Promise<void>;
}

export type FiruxCreate = (
  body: {
    amount: number;
    external_reference: string;
    description: string;
    expires_at?: string;
    /** Solo en cobros conectados: la parte de Humanix en COP (ASUNCIÓN sobre el nombre del campo). */
    application_fee?: number;
  },
  idempotencyKey: string,
) => Promise<FiruxCharge>;

/** «Conectar con Firux Pay». Sin esto (o con `enabled: false`) todo se cobra con la llave de Humanix. */
export interface ConnectChargeDeps {
  enabled: boolean;
  connection(professionalId: string): Promise<FiruxConnectionRow | null>;
  /** Cobrador a nombre de la cuenta conectada; `null` = no se puede y el turno cae a la llave de Humanix. */
  firuxFor(accountId: string): FiruxCreate | null;
}

export interface ChargeDeps {
  store: ChargeStore;
  /** Cobrador con la llave de Humanix. */
  firux: FiruxCreate | null;
  now: () => number;
  connect?: ConnectChargeDeps;
  /** Pago retenido (por defecto encendido): el turno se cobra con la llave de Humanix para poder guardar el dinero.
   * Solo `false` deja que «Conectar» cobre el turno a nombre del profesional. */
  holdBookings?: boolean;
}

/** Pago retenido tipo InDrive (migración 20261104180000): la familia paga desde que pide el turno y Humanix guarda el
 * dinero hasta que confirma que terminó. Por eso un turno nunca se cobra por la cuenta conectada del profesional
 * (el dinero le llegaría antes de terminar): `connectedRoute` queda solo para cuando Firux permita retener. */
const PAYABLE_STATUSES = PAYABLE_BOOKING_STATUSES;
/** Vigencia del QR que pedimos a Firux (su valor por defecto también es 24 h). Firux no avisa cuando vence: por eso
 * la fijamos nosotros y la guardamos. */
const CHARGE_TTL_MS = 24 * 3_600_000;

export const INSTITUTION_PLAN_KEY: Record<InstitutionSize, string> = {
  small: "institution_small_annual",
  large: "institution_large_annual",
};

function view(c: ChargeRow): ChargeView {
  return {
    chargeId: c.id,
    amountCop: Number(c.amount_cop),
    qrEmv: c.qr_emv,
    paymentUrl: c.payment_url,
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
    description: string;
    /** Cobro conectado (turnos con Conectar encendido); si falta, llave de Humanix. */
    connected?: { create: FiruxCreate; accountId: string; applicationFeeCop: number };
  },
): Promise<ChargeResult> {
  const create = input.connected?.create ?? deps.firux;
  if (!create) return { ok: false, code: "not_configured" };
  const connectOn = !!deps.connect?.enabled;
  const draft = buildChargeBody({
    amountCop: input.amountCop,
    reference: "pending",
    description: input.description,
  });
  if (!draft.ok) return { ok: false, code: "amount_out_of_range" };

  const open = await deps.store.openCharge({
    kind: input.kind,
    userId: input.userId,
    bookingId: input.bookingId,
    amountCop: draft.body.amount,
    ...(connectOn
      ? { route: input.connected ? ("connected" as const) : ("platform" as const) }
      : {}),
  });
  if (open && open.firux_id && (open.qr_emv || open.payment_url)) {
    const left = open.expires_at ? Date.parse(open.expires_at) - deps.now() : Infinity;
    // Mientras siga vigente es el mismo cobro (Firux también devuelve el pendiente de la misma referencia).
    if (left > 0) return { ok: true, charge: view(open) };
    await deps.store.updateCharge(open.id, { status: "expired" });
  }

  const row = await deps.store.insertCharge({
    kind: input.kind,
    user_id: input.userId,
    booking_id: input.bookingId,
    plan_key: input.planKey,
    amount_cop: draft.body.amount,
    ...(input.connected
      ? {
          route: "connected" as const,
          firux_account_id: input.connected.accountId,
          application_fee_cop: input.connected.applicationFeeCop,
        }
      : {}),
  });
  // La referencia que vuelve en el aviso: el turno (como pide Firux) o, para recargas y planes, nuestro propio cobro.
  const reference = input.bookingId ?? row.id;
  const expiresAt = new Date(deps.now() + CHARGE_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  try {
    const fx = await create(
      {
        ...draft.body,
        external_reference: reference,
        expires_at: expiresAt,
        ...(input.connected ? { application_fee: input.connected.applicationFeeCop } : {}),
      },
      row.id,
    );
    if (!fx?.id) throw new Error("firux_missing_id");
    // Firux devolvió un cobro que ya teníamos (misma referencia, aún pendiente): se usa ese y el nuevo se descarta.
    const known = await deps.store.chargeByFiruxId(String(fx.id));
    if (known && known.id !== row.id) {
      await deps.store.updateCharge(row.id, { status: "failed" });
      if (known.status !== "paid") await deps.store.updateCharge(known.id, { status: "pending" });
      return {
        ok: true,
        charge: view({ ...known, status: known.status === "paid" ? "paid" : "pending" }),
      };
    }
    const patch: Partial<ChargeRow> = {
      firux_id: String(fx.id),
      qr_emv: fx.qr_emv ?? null,
      payment_url: payLink(fx),
      expires_at: fx.expires_at ?? expiresAt,
    };
    await deps.store.updateCharge(row.id, patch);
    return { ok: true, charge: view({ ...row, ...patch }) };
  } catch (e) {
    await deps.store.updateCharge(row.id, { status: "failed" }).catch(() => undefined);
    // 409: esa referencia ya está pagada en Firux (el aviso puede venir en camino).
    if (e instanceof Error && e.message === "firux_409" && input.bookingId) {
      return { ok: false, code: "already_paid" };
    }
    return { ok: false, code: "provider_error" };
  }
}

/** La familia paga su turno por Bre-B. Solo quien reservó, solo turnos digitales sin pagar, desde que lo pide. */
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
  if (!PAYABLE_STATUSES.has(b.status)) return { ok: false, code: "not_payable" };
  return issue(deps, {
    kind: "booking",
    userId,
    bookingId: b.id,
    planKey: null,
    amountCop: Number(b.total_amount),
    description: "Turno de cuidado Humanix",
    connected: deps.holdBookings === false ? await connectedRoute(deps, b) : undefined,
  });
}

/** Ruta de cobro del turno con «Conectar con Firux Pay». `undefined` = llave de Humanix (respaldo: cola `payouts`). */
export async function connectedRoute(
  deps: ChargeDeps,
  b: BookingForCharge,
): Promise<{ create: FiruxCreate; accountId: string; applicationFeeCop: number } | undefined> {
  const c = deps.connect;
  if (!c?.enabled || !b.professional_id) return undefined;
  let connection: FiruxConnectionRow | null = null;
  try {
    connection = await c.connection(b.professional_id);
  } catch {
    return undefined; // Si no se puede leer la conexión, se cobra como hoy: nunca se bloquea el pago.
  }
  const route: ChargeRoute = chooseChargeRoute(
    {
      total_amount: Number(b.total_amount),
      platform_fee_amount: Number(b.platform_fee_amount ?? 0),
      payment_method: b.payment_method,
    },
    connection,
    true,
  );
  if (route.route !== "connected") return undefined;
  const create = c.firuxFor(route.accountId);
  if (!create) return undefined;
  return { create, accountId: route.accountId, applicationFeeCop: route.applicationFeeCop };
}

/** El profesional recarga su billetera (para aceptar turnos en efectivo o salir del cupo). */
export async function chargeTopup(
  deps: ChargeDeps,
  userId: string,
  amountCop: number,
): Promise<ChargeResult> {
  if (!(await deps.store.hasRole(userId, "professional"))) return { ok: false, code: "forbidden" };
  return issue(deps, {
    kind: "topup",
    userId,
    bookingId: null,
    planKey: null,
    amountCop,
    description: "Recarga billetera Humanix",
  });
}

/** La institución paga su plan anual (un solo pago al año). */
export async function chargeInstitutionPlan(
  deps: ChargeDeps,
  userId: string,
  size: InstitutionSize,
): Promise<ChargeResult> {
  if (!(await deps.store.hasRole(userId, "institution"))) return { ok: false, code: "forbidden" };
  const plan = INSTITUTION_PLANS[size];
  return issue(deps, {
    kind: "plan",
    userId,
    bookingId: null,
    planKey: INSTITUTION_PLAN_KEY[size],
    amountCop: plan.annualCOP,
    description: `Plan Institucional anual · ${plan.label}`,
  });
}

// ─── Adaptadores reales ──────────────────────────────────────────────────────

/** Tablas nuevas (migración 20261103160000), más nuevas que los tipos generados: cliente sin tipar, con service role. */
export function supabaseChargeStore(admin: SupabaseClient): ChargeStore {
  return {
    async booking(id) {
      const { data } = await admin
        .from("service_bookings")
        .select(
          "id, client_id, professional_id, status, payment_method, total_amount, platform_fee_amount, paid_at",
        )
        .eq("id", id)
        .maybeSingle();
      return (data as BookingForCharge | null) ?? null;
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
    async openCharge({ kind, userId, bookingId, amountCop, route }) {
      let q = admin
        .from("firux_charges")
        .select("*")
        .eq("kind", kind)
        .eq("user_id", userId)
        .eq("status", "pending")
        .eq("amount_cop", amountCop)
        .not("firux_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      q = bookingId ? q.eq("booking_id", bookingId) : q.is("booking_id", null);
      // La columna `route` existe desde 20261104140000; solo se filtra con Conectar encendido.
      if (route) q = q.eq("route", route);
      const { data } = await q;
      return ((data ?? [])[0] as ChargeRow | undefined) ?? null;
    },
    async insertCharge(row) {
      const { data, error } = await admin.from("firux_charges").insert(row).select("*").single();
      if (error || !data) throw new Error(`firux_charge_insert: ${error?.message ?? "sin fila"}`);
      return data as ChargeRow;
    },
    async chargeByFiruxId(firuxId) {
      const { data } = await admin
        .from("firux_charges")
        .select("*")
        .eq("firux_id", firuxId)
        .maybeSingle();
      return (data as ChargeRow | null) ?? null;
    },
    async updateCharge(id, patch) {
      const { error } = await admin.from("firux_charges").update(patch).eq("id", id);
      if (error) throw new Error(`firux_charge_update: ${error.message}`);
    },
  };
}

/**
 * `POST /v1/charges` con la llave secreta y la `Idempotency-Key`.
 * Con `accountId` el cobro va a nombre de una cuenta conectada. ASUNCIÓN (Firux no ha publicado «Conectar con Firux
 * Pay»): se firma con la llave de Humanix más el encabezado `Firux-Account`. Si Firux usa un token por profesional, se
 * cambia solo aquí y en `firux.functions.ts`.
 */
export function firuxCreateCharge(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  opts: { accountId?: string } = {},
): FiruxCreate {
  return async (body, idempotencyKey) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    if (opts.accountId) headers["Firux-Account"] = opts.accountId;
    const r = await fetchImpl(`${FIRUX_API}/charges`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`firux_${r.status}`);
    return (await r.json()) as FiruxCharge;
  };
}

/** Conexión Firux del profesional (tabla de 20261104140000). */
export function supabaseConnectionLookup(admin: SupabaseClient) {
  return async (professionalId: string): Promise<FiruxConnectionRow | null> => {
    const { data, error } = await admin
      .from("professional_firux_connections")
      .select(
        "professional_id, firux_account_id, status, commission_terms_version, commission_accepted_at",
      )
      .eq("professional_id", professionalId)
      .maybeSingle();
    if (error) throw new Error(`firux_connection_read: ${error.message}`);
    return (data as FiruxConnectionRow | null) ?? null;
  };
}
