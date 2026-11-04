// «Conectar con Firux Pay»: llamadas a Firux para conectar la cuenta de un profesional. Solo servidor.
//
// TODO este archivo es ASUNCIÓN: Firux aún no publica la conexión (está en pruebas). Cuando la publique, se corrigen
// aquí la URL de autorización, el canje del código y los nombres de campos, y nada más.
import { FIRUX_API } from "./firux";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── «Conectar con Firux Pay» (ASUNCIÓN completa: Firux no ha publicado esta parte) ─────────────────────────────────
//
// Suponemos un flujo tipo OAuth: Humanix manda al profesional a una página de Firux con `client_id`, `redirect_uri` y
// un `state` de un solo uso; Firux vuelve a `redirect_uri` con `code` y `state`, y Humanix canjea el `code` por el id
// de la cuenta conectada. Cuando Firux publique la conexión, solo cambian estas dos funciones.

export function buildFiruxConnectUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  baseUrl?: string;
}): string {
  const base = (args.baseUrl ?? "https://pay.firux.co").replace(/\/+$/, ""); // ASUNCIÓN
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
  });
  return `${base}/connect/authorize?${q.toString()}`;
}

export type ExchangeResult =
  { ok: true; accountId: string } | { ok: false; code: "invalid" | "unavailable"; status: number };

export async function exchangeFiruxConnectCode(
  fetchFn: FetchFn,
  args: { apiKey: string; code: string; redirectUri: string; baseUrl?: string },
): Promise<ExchangeResult> {
  const base = (args.baseUrl ?? FIRUX_API).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchFn(`${base}/connect/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });
  } catch {
    return { ok: false, code: "unavailable", status: 0 };
  }
  if (res.status >= 400 && res.status < 500)
    return { ok: false, code: "invalid", status: res.status };
  if (!res.ok) return { ok: false, code: "unavailable", status: res.status };
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const accountId = str(body?.account_id) ?? str(body?.accountId);
  return accountId
    ? { ok: true, accountId }
    : { ok: false, code: "unavailable", status: res.status };
}
