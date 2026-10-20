// Base de datos falsa y pagos de ejemplo para probar el cobro sin Postgres. Solo la usan las pruebas.
import type { MpPayment, RestFn } from "../../supabase/functions/_shared/mpPayment";

// ─── Base de datos falsa con las reglas que importan de producción ──────────────────────────────────────────────
// - payment_webhook_events: único (provider, external_event_id) → 409.
// - mp_payments: único mp_payment_id; status solo del enum de producción (si no, 400 como PostgREST).
// - PATCH con filtros eq./is.null es atómico (como una fila bloqueada en Postgres).
// - referrals: el cobro solo la toca con PATCH condicionales (reclamar y liberar la recompensa).

const ENUM = new Set(["pending", "approved", "rejected", "cancelled", "refunded", "in_process"]);
type Row = Record<string, unknown>;

export function fakeDb(opts: { failOn?: (path: string, method: string) => boolean } = {}) {
  const t: Record<string, Row[]> = {
    payment_webhook_events: [],
    mp_payments: [],
    mp_subscriptions: [],
    notifications: [],
    ai_credit_topups: [],
    referrals: [],
  };
  const calls: string[] = [];

  const parse = (path: string) => {
    const [table, qs = ""] = path.split("?");
    const params = new URLSearchParams(qs);
    const filters: Array<[string, (v: unknown) => boolean]> = [];
    params.forEach((value, key) => {
      if (["select", "on_conflict"].includes(key)) return;
      if (value.startsWith("eq.")) {
        const want = decodeURIComponent(value.slice(3));
        filters.push([key, (v) => String(v) === want]);
      } else if (value === "is.null") {
        filters.push([key, (v) => v === null || v === undefined]);
      }
    });
    return { table, params, match: (r: Row) => filters.every(([k, f]) => f(r[k])) };
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const rest: RestFn = async (path, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push(`${method} ${path.split("?")[0]}`);
    if (opts.failOn?.(path, method)) throw new Error(`rest ${path.split("?")[0]} 500`);
    const { table, params, match } = parse(path);
    const body = init.body ? (JSON.parse(String(init.body)) as Row) : {};
    let res: Response;

    if (table === "rpc/grant_ai_credits") {
      if (t.ai_credit_topups.some((r) => r.mp_payment_id === body.p_mp_payment_id)) {
        res = json({ message: "duplicate" }, 409);
      } else {
        t.ai_credit_topups.push({ mp_payment_id: body.p_mp_payment_id, credits: body.p_credits });
        res = json(null);
      }
    } else if (method === "GET") {
      res = json(t[table].filter(match));
    } else if (method === "POST") {
      const conflictKey = params.get("on_conflict");
      if (table === "mp_payments" && !ENUM.has(String(body.status))) {
        res = json({ message: "invalid input value for enum" }, 400);
      } else if (table === "payment_webhook_events") {
        const dup = t[table].some(
          (r) => r.provider === body.provider && r.external_event_id === body.external_event_id,
        );
        if (dup) res = json({ message: "duplicate" }, 409);
        else {
          t[table].push({ processed: false, error_code: null, ...body });
          res = json(null, 201);
        }
      } else if (conflictKey) {
        const existing = t[table].find((r) => r[conflictKey] === body[conflictKey]);
        if (existing) Object.assign(existing, body);
        else t[table].push({ paid_at: null, ...body });
        res = json(null, 201);
      } else {
        t[table].push(body);
        res = json(null, 201);
      }
    } else if (method === "PATCH") {
      const hit = t[table].filter(match);
      hit.forEach((r) => Object.assign(r, body));
      res = json(hit);
    } else {
      res = json(null, 405);
    }
    if (!res.ok && !(init.allowConflict && res.status === 409)) {
      throw new Error(`rest ${table} ${res.status}`);
    }
    return res;
  };
  return { rest, t, calls };
}

export const USER = "11111111-2222-4333-8444-555555555555";
export const NOW = Date.parse("2026-10-19T17:00:00Z");
export const DAY = 86_400_000;

export const planPayment = (over: Partial<MpPayment> = {}): MpPayment => ({
  id: 9001,
  status: "approved",
  transaction_amount: 29000,
  currency_id: "COP",
  external_reference: USER,
  preference_id: "pref-1",
  metadata: { user_id: USER, plan: "pro_monthly", price_cop: 29000 },
  ...over,
});
export const creditsPayment = (over: Partial<MpPayment> = {}): MpPayment => ({
  id: 7001,
  status: "approved",
  transaction_amount: 12900,
  currency_id: "COP",
  external_reference: `credits:${USER}:pack_300`,
  metadata: {
    type: "credits",
    user_id: USER,
    pack_id: "pack_300",
    credits: 330,
    validity_days: 90,
    price_cop: 12900,
  },
  ...over,
});
export const deps = (rest: RestFn, now = NOW, source: "webhook" | "return" = "webhook") => ({
  rest,
  now: () => now,
  source,
  topic: "payment",
});
