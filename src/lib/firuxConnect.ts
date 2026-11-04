// «Conectar con Firux Pay»: lógica pura (probada en `firuxConnect.test.ts`).
//
// Cada profesional conecta su propia cuenta Firux y acepta UNA vez la comisión de Humanix. Desde ahí, el cobro de un
// turno pagado por Bre-B se crea a nombre del profesional con la comisión incluida: el dinero le llega directo y la
// comisión a Humanix. Humanix no dispersa nada y ese turno no entra a la cola `payouts`.
//
// Todo está detrás de `FIRUX_CONNECT_ENABLED` (apagado por defecto). Con el flag apagado, o si el profesional no tiene
// una conexión activa con la comisión aceptada en la versión vigente, el cobro va por la llave de Humanix y el pago
// al profesional sigue por la cola `payouts` + su llave Bre-B (respaldo de hoy).

/** Versión del texto de comisión que acepta el profesional. Subirla obliga a aceptar de nuevo. */
export const FIRUX_CONNECT_TERMS_VERSION = "2026-11-v1";

export type ConnectionStatus = "pending" | "active" | "revoked";

export interface FiruxConnectionRow {
  professional_id: string;
  firux_account_id: string | null;
  status: ConnectionStatus | string;
  commission_terms_version: string | null;
  commission_accepted_at: string | null;
}

export function isFiruxConnectEnabled(env: {
  FIRUX_CONNECT_ENABLED?: string | undefined;
}): boolean {
  const v = (env.FIRUX_CONNECT_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Una conexión sirve para cobrar solo si está activa, tiene cuenta y la comisión vigente está aceptada. */
export function connectionUsable(
  c: FiruxConnectionRow | null | undefined,
): c is FiruxConnectionRow & {
  firux_account_id: string;
} {
  return (
    !!c &&
    c.status === "active" &&
    !!c.firux_account_id &&
    !!c.commission_accepted_at &&
    c.commission_terms_version === FIRUX_CONNECT_TERMS_VERSION
  );
}

export interface BookingForRoute {
  total_amount: number;
  platform_fee_amount: number;
  commission_exempt_cop?: number | null;
  payment_method: string;
}

export type ChargeRoute =
  | { route: "platform"; reason: "flag_off" | "no_connection" | "not_digital" }
  | { route: "connected"; accountId: string; applicationFeeCop: number };

/**
 * Por dónde se cobra un turno. La comisión sale de la base (`platform_fee_amount`, que ya descuenta la exención del
 * primer turno); aquí solo se asegura que sea un entero entre 0 y el total.
 */
export function chooseChargeRoute(
  booking: BookingForRoute,
  connection: FiruxConnectionRow | null | undefined,
  enabled: boolean,
): ChargeRoute {
  if (!enabled) return { route: "platform", reason: "flag_off" };
  if (booking.payment_method !== "DIGITAL_BREB")
    return { route: "platform", reason: "not_digital" };
  if (!connectionUsable(connection)) return { route: "platform", reason: "no_connection" };
  const total = Math.max(0, Math.round(booking.total_amount));
  const fee = Math.min(total, Math.max(0, Math.round(booking.platform_fee_amount || 0)));
  return { route: "connected", accountId: connection.firux_account_id, applicationFeeCop: fee };
}

/** Lo que ve el profesional en su tarjeta. */
export type ConnectView =
  | { state: "disabled" }
  | { state: "not_connected" }
  | { state: "pending" }
  | { state: "needs_terms" }
  | { state: "connected"; accountId: string };

export function connectView(
  enabled: boolean,
  c: FiruxConnectionRow | null | undefined,
): ConnectView {
  if (!enabled) return { state: "disabled" };
  if (!c || c.status === "revoked") return { state: "not_connected" };
  if (c.status === "pending" || !c.firux_account_id) return { state: "pending" };
  if (!connectionUsable(c)) return { state: "needs_terms" };
  return { state: "connected", accountId: c.firux_account_id };
}
