import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listEscrowOps, markRefund, resolveDispute, sortRefunds } from "./escrowOps.server";

const STAFF = "99999999-9999-4999-8999-999999999999";
const FAM = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const BOOKING = "33333333-3333-4333-8333-333333333333";
const REFUND = "44444444-4444-4444-8444-444444444444";

function fakeAdmin(opts: { staff: boolean; rpcResult?: string; failTable?: string }) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const filters: Array<{ table: string; m: string; args: unknown[] }> = [];
  const rows: Record<string, unknown[]> = {
    service_bookings: [
      {
        id: BOOKING,
        client_id: FAM,
        professional_id: PRO,
        total_amount: 80_000,
        professional_payout: 68_000,
        dispute_reason: "No llegó",
        disputed_at: "2026-11-04T10:00:00Z",
        completed_at: "2026-11-04T09:00:00Z",
      },
    ],
    booking_refunds: [
      {
        id: REFUND,
        booking_id: BOOKING,
        client_id: FAM,
        amount_cop: 80_000,
        reason: "cancelled",
        key_type: null,
        key_value: null,
        status: "needs_key",
        provider_ref: null,
        error_code: null,
        created_at: "2026-11-04T11:00:00Z",
      },
    ],
    profiles: [
      { user_id: FAM, full_name: "Marta", phone: "3001" },
      { user_id: PRO, full_name: "Alejandra", phone: "3002" },
    ],
  };
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "limit", "in", "eq"])
      q[m] = (...args: unknown[]) => {
        filters.push({ table, m, args });
        return q;
      };
    q.then = (res: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
      res(
        opts.failTable === table
          ? { data: null, error: { message: "x" } }
          : { data: rows[table] ?? [], error: null },
      );
    return q;
  };
  const admin = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "is_staff") return { data: opts.staff, error: null };
      return { data: opts.rpcResult ?? "released", error: null };
    },
    from: (t: string) => chain(t),
  } as unknown as SupabaseClient;
  return { admin, rpcCalls, filters };
}

describe("operación del pago retenido", () => {
  it("solo staff", async () => {
    const { admin } = fakeAdmin({ staff: false });
    expect(await listEscrowOps(admin, FAM)).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await resolveDispute(admin, FAM, { bookingId: BOOKING, action: "release" }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await markRefund(admin, FAM, { refundId: REFUND, status: "paid", reference: "x" }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("lista reclamos y devoluciones con nombres, y lo retenido", async () => {
    const { admin, filters } = fakeAdmin({ staff: true });
    const r = await listEscrowOps(admin, STAFF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.disputes[0]).toMatchObject({
      booking_id: BOOKING,
      client_name: "Marta",
      professional_name: "Alejandra",
      dispute_reason: "No llegó",
    });
    expect(r.refunds[0]).toMatchObject({ id: REFUND, client_name: "Marta", client_phone: "3001" });
    expect(r.held).toEqual({ count: 1, amountCop: 80_000 });
    expect(filters).toContainEqual({
      table: "service_bookings",
      m: "eq",
      args: ["escrow_status", "disputed"],
    });
  });

  it("si una consulta falla, no muestra datos a medias", async () => {
    const { admin } = fakeAdmin({ staff: true, failTable: "booking_refunds" });
    expect(await listEscrowOps(admin, STAFF)).toMatchObject({ ok: false, code: "failed" });
  });

  it("decide un reclamo con hx_escrow_resolve", async () => {
    const ok = fakeAdmin({ staff: true, rpcResult: "refunding" });
    expect(await resolveDispute(ok.admin, STAFF, { bookingId: BOOKING, action: "refund" })).toEqual(
      {
        ok: true,
        result: "refunding",
      },
    );
    expect(ok.rpcCalls.at(-1)).toEqual({
      fn: "hx_escrow_resolve",
      args: { p_booking: BOOKING, p_action: "refund" },
    });
    const late = fakeAdmin({ staff: true, rpcResult: "not_open" });
    expect(
      await resolveDispute(late.admin, STAFF, { bookingId: BOOKING, action: "release" }),
    ).toMatchObject({ ok: false, code: "not_open" });
    expect(
      await resolveDispute(late.admin, STAFF, { bookingId: "x", action: "release" }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("marca devoluciones con hx_mark_refund", async () => {
    const ok = fakeAdmin({ staff: true, rpcResult: "paid" });
    expect(
      await markRefund(ok.admin, STAFF, { refundId: REFUND, status: "paid", reference: " FX-1 " }),
    ).toEqual({ ok: true, status: "paid" });
    expect(ok.rpcCalls.at(-1)).toEqual({
      fn: "hx_mark_refund",
      args: { p_refund: REFUND, p_status: "paid", p_ref: "FX-1" },
    });
    const nk = fakeAdmin({ staff: true, rpcResult: "needs_key" });
    expect(await markRefund(nk.admin, STAFF, { refundId: REFUND, status: "paid" })).toMatchObject({
      ok: false,
      code: "needs_key",
    });
  });

  it("orden de trabajo de devoluciones", () => {
    const rows = [
      { status: "paid" as const, created_at: "1" },
      { status: "needs_key" as const, created_at: "1" },
      { status: "queued" as const, created_at: "2" },
      { status: "queued" as const, created_at: "1" },
      { status: "failed" as const, created_at: "1" },
    ];
    expect(sortRefunds(rows).map((r) => `${r.status}${r.created_at}`)).toEqual([
      "queued1",
      "queued2",
      "failed1",
      "needs_key1",
      "paid1",
    ]);
  });
});
