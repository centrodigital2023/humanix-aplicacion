import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listPayoutQueue,
  markPayout,
  sortPayouts,
  summarizePayouts,
  type PayoutRow,
} from "./payoutQueue.server";

const STAFF = "99999999-9999-4999-8999-999999999999";
const PRO = "22222222-2222-4222-8222-222222222222";
const PAYOUT = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<PayoutRow>): PayoutRow {
  return {
    id: PAYOUT,
    professional_id: PRO,
    booking_id: null,
    amount_cop: 100_000,
    key_type: "phone",
    key_value: "3001234567",
    status: "queued",
    provider_ref: null,
    error_code: null,
    created_at: "2026-11-04T10:00:00Z",
    updated_at: "2026-11-04T10:00:00Z",
    ...over,
  };
}

/** Cliente mínimo: `rpc` y una cadena de consulta que resuelve con filas fijas. */
function fakeAdmin(opts: { staff: boolean; payouts?: PayoutRow[]; markResult?: string }) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "limit", "in", "eq"]) q[m] = () => q;
    q.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
      res({ data: rows, error: null });
    return q;
  };
  const admin = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "is_staff") return { data: opts.staff, error: null };
      return { data: opts.markResult ?? "paid", error: null };
    },
    from: (t: string) =>
      chain(
        t === "payouts"
          ? (opts.payouts ?? [])
          : [{ user_id: PRO, full_name: "Laura", phone: "300" }],
      ),
  } as unknown as SupabaseClient;
  return { admin, rpcCalls };
}

describe("cola de pagos a profesionales", () => {
  it("totales por estado y orden de trabajo", () => {
    const rows = [
      row({ id: "a", status: "paid", created_at: "2026-11-01T00:00:00Z" }),
      row({ id: "b", status: "needs_key", amount_cop: 50_000 }),
      row({ id: "c", status: "queued", created_at: "2026-11-03T00:00:00Z" }),
      row({ id: "d", status: "queued", created_at: "2026-11-02T00:00:00Z" }),
    ];
    const t = summarizePayouts(rows);
    expect(t.queued).toEqual({ count: 2, amountCop: 200_000 });
    expect(t.needs_key).toEqual({ count: 1, amountCop: 50_000 });
    expect(sortPayouts(rows).map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("solo staff ve la cola; trae el nombre del profesional", async () => {
    const no = fakeAdmin({ staff: false, payouts: [row({})] });
    expect(await listPayoutQueue(no.admin, PRO, {})).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const yes = fakeAdmin({ staff: true, payouts: [row({})] });
    const r = await listPayoutQueue(yes.admin, STAFF, {});
    expect(r).toMatchObject({ ok: true, items: [{ id: PAYOUT, professional_name: "Laura" }] });
  });

  it("marcar: solo staff, entrada válida y resultados de la base traducidos", async () => {
    const no = fakeAdmin({ staff: false });
    expect(await markPayout(no.admin, PRO, { payoutId: PAYOUT, status: "paid" })).toMatchObject({
      code: "forbidden",
    });
    expect(no.rpcCalls.map((c) => c.fn)).toEqual(["is_staff"]);

    const bad = fakeAdmin({ staff: true });
    expect(await markPayout(bad.admin, STAFF, { payoutId: "x", status: "paid" })).toMatchObject({
      code: "invalid_input",
    });

    const ok = fakeAdmin({ staff: true, markResult: "paid" });
    expect(
      await markPayout(ok.admin, STAFF, { payoutId: PAYOUT, status: "paid", reference: " FX-1 " }),
    ).toEqual({ ok: true, status: "paid" });
    expect(ok.rpcCalls[1]).toEqual({
      fn: "hx_mark_payout",
      args: { p_payout: PAYOUT, p_status: "paid", p_ref: "FX-1" },
    });

    for (const [res, code] of [
      ["needs_key", "needs_key"],
      ["already_paid", "already_paid"],
      ["not_found", "not_found"],
    ] as const) {
      const w = fakeAdmin({ staff: true, markResult: res });
      expect(await markPayout(w.admin, STAFF, { payoutId: PAYOUT, status: "paid" })).toMatchObject({
        code,
      });
    }
  });
});
