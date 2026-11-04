// «Conectar con Firux Pay» (servidor): el profesional conecta su cuenta Firux y acepta la comisión de Humanix una vez.
// Lógica inyectable y probada (`firuxConnect.server.test.ts`); `firux.functions.ts` la conecta con la sesión, la base
// (service role) y Firux.
//
// Flujo (ASUNCIÓN tipo OAuth, ver `firuxConnectApi.ts`):
//   1. `start`: el profesional acepta la comisión vigente → se guarda la aceptación y un `state` de un solo uso (solo su
//      hash, vence en 15 min) → se devuelve la URL de Firux.
//   2. Firux vuelve a `/firux/conectado?code=…&state=…` → `complete` valida el `state`, canjea el `code` por el id de la
//      cuenta y deja la conexión `active`.
//   3. `disconnect`: deja la conexión `revoked` (los cobros nuevos vuelven a la llave de Humanix + cola `payouts`).
// Todo responde `disabled` mientras FIRUX_CONNECT_ENABLED esté apagado.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectView,
  FIRUX_CONNECT_TERMS_VERSION,
  type ConnectView,
  type FiruxConnectionRow,
} from "./firuxConnect";
import type { ExchangeResult } from "./firuxConnectApi";

export const CONNECT_STATE_TTL_MS = 15 * 60_000;

export interface ConnectionRecord extends FiruxConnectionRow {
  connect_state_hash: string | null;
  connect_state_expires_at: string | null;
}

export interface ConnectStore {
  hasRole(userId: string, role: "professional"): Promise<boolean>;
  get(professionalId: string): Promise<ConnectionRecord | null>;
  upsert(
    professionalId: string,
    patch: Partial<ConnectionRecord> & Record<string, unknown>,
  ): Promise<void>;
}

export interface ConnectDeps {
  enabled: boolean;
  store: ConnectStore;
  /** URL de Firux para conectar (ASUNCIÓN). `null` = falta configurar FIRUX_CONNECT_CLIENT_ID / redirect. */
  authorizeUrl: ((state: string) => string) | null;
  exchange: ((code: string) => Promise<ExchangeResult>) | null;
  now: () => number;
  /** 32 bytes aleatorios en hex. */
  randomState: () => string;
  sha256: (s: string) => Promise<string>;
}

export type ConnectErrorCode =
  | "disabled"
  | "not_configured"
  | "forbidden"
  | "terms_required"
  | "invalid_state"
  | "provider_error";

export type ConnectResult<T> =
  ({ ok: true } & T) | { ok: false; code: ConnectErrorCode; message: string };

const MESSAGES: Record<ConnectErrorCode, string> = {
  disabled: "Conectar con Firux Pay todavía no está disponible.",
  not_configured: "Conectar con Firux Pay se está activando. Inténtalo más tarde.",
  forbidden: "Solo los profesionales pueden conectar una cuenta Firux.",
  terms_required: "Para conectar tu cuenta debes aceptar la comisión de Humanix.",
  invalid_state: "El enlace de conexión venció o no es válido. Vuelve a intentarlo desde tu panel.",
  provider_error: "Firux no confirmó la conexión. Inténtalo de nuevo en un momento.",
};

function fail(code: ConnectErrorCode): { ok: false; code: ConnectErrorCode; message: string } {
  return { ok: false, code, message: MESSAGES[code] };
}

export async function connectStatus(
  deps: ConnectDeps,
  userId: string,
): Promise<{ view: ConnectView; termsVersion: string }> {
  if (!deps.enabled)
    return { view: { state: "disabled" }, termsVersion: FIRUX_CONNECT_TERMS_VERSION };
  const row = await deps.store.get(userId);
  return { view: connectView(true, row), termsVersion: FIRUX_CONNECT_TERMS_VERSION };
}

/** Paso 1: aceptar la comisión vigente y obtener la URL de Firux. */
export async function startConnect(
  deps: ConnectDeps,
  userId: string,
  input: { acceptTerms: boolean; termsVersion: string },
): Promise<ConnectResult<{ url: string }>> {
  if (!deps.enabled) return fail("disabled");
  if (!(await deps.store.hasRole(userId, "professional"))) return fail("forbidden");
  if (!input.acceptTerms || input.termsVersion !== FIRUX_CONNECT_TERMS_VERSION)
    return fail("terms_required");
  if (!deps.authorizeUrl || !deps.exchange) return fail("not_configured");

  const existing = await deps.store.get(userId);
  const state = deps.randomState();
  const nowIso = new Date(deps.now()).toISOString();
  await deps.store.upsert(userId, {
    // Una conexión activa sigue activa hasta que Firux confirme la nueva (reconectar no corta los cobros).
    status: existing?.status === "active" ? "active" : "pending",
    commission_terms_version: FIRUX_CONNECT_TERMS_VERSION,
    commission_accepted_at: nowIso,
    connect_state_hash: await deps.sha256(state),
    connect_state_expires_at: new Date(deps.now() + CONNECT_STATE_TTL_MS).toISOString(),
    updated_at: nowIso,
  });
  return { ok: true, url: deps.authorizeUrl(state) };
}

/** Paso 2: Firux volvió con `code` y `state`. */
export async function completeConnect(
  deps: ConnectDeps,
  userId: string,
  input: { code: string; state: string },
): Promise<ConnectResult<{ accountId: string }>> {
  if (!deps.enabled) return fail("disabled");
  if (!deps.exchange) return fail("not_configured");
  const row = await deps.store.get(userId);
  const hash = await deps.sha256(input.state);
  const expires = row?.connect_state_expires_at ? Date.parse(row.connect_state_expires_at) : 0;
  if (!row || !row.connect_state_hash || row.connect_state_hash !== hash || expires <= deps.now()) {
    return fail("invalid_state");
  }
  if (row.commission_terms_version !== FIRUX_CONNECT_TERMS_VERSION || !row.commission_accepted_at) {
    return fail("terms_required");
  }
  // El `state` se quema antes de llamar a Firux: un mismo enlace no sirve dos veces.
  const nowIso = new Date(deps.now()).toISOString();
  await deps.store.upsert(userId, {
    connect_state_hash: null,
    connect_state_expires_at: null,
    updated_at: nowIso,
  });
  const res = await deps.exchange(input.code);
  if (!res.ok) return fail("provider_error");
  await deps.store.upsert(userId, {
    firux_account_id: res.accountId,
    status: "active",
    connected_at: nowIso,
    revoked_at: null,
    updated_at: nowIso,
  });
  return { ok: true, accountId: res.accountId };
}

/** Desconectar: los turnos nuevos vuelven a cobrarse con la llave de Humanix (y a pagarse por la cola `payouts`). */
export async function disconnect(
  deps: ConnectDeps,
  userId: string,
): Promise<ConnectResult<object>> {
  if (!deps.enabled) return fail("disabled");
  const row = await deps.store.get(userId);
  if (!row) return { ok: true };
  const nowIso = new Date(deps.now()).toISOString();
  await deps.store.upsert(userId, {
    status: "revoked",
    revoked_at: nowIso,
    connect_state_hash: null,
    connect_state_expires_at: null,
    updated_at: nowIso,
  });
  return { ok: true };
}

// ─── Adaptador real ──────────────────────────────────────────────────────────

export function supabaseConnectStore(admin: SupabaseClient): ConnectStore {
  return {
    async hasRole(userId, role) {
      const { data } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", role)
        .limit(1);
      return (data ?? []).length > 0;
    },
    async get(professionalId) {
      const { data, error } = await admin
        .from("professional_firux_connections")
        .select(
          "professional_id, firux_account_id, status, commission_terms_version, commission_accepted_at, connect_state_hash, connect_state_expires_at",
        )
        .eq("professional_id", professionalId)
        .maybeSingle();
      if (error) throw new Error(`firux_connection_read: ${error.message}`);
      return (data as ConnectionRecord | null) ?? null;
    },
    async upsert(professionalId, patch) {
      const { error } = await admin
        .from("professional_firux_connections")
        .upsert({ professional_id: professionalId, ...patch }, { onConflict: "professional_id" });
      if (error) throw new Error(`firux_connection_write: ${error.message}`);
    },
  };
}
