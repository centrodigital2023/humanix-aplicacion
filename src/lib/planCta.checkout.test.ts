/**
 * Integration-style test for the "intelligent" CTA flow:
 *  - upgrade   → invokes mp-create-subscription with correct plan + redirects to init_point
 *  - downgrade → invokes with the lower-tier plan
 *  - reactivate (cancelAtPeriodEnd) → re-invokes with the same plan
 *  - login flow → no invoke; computes /auth?redirect=/planes?plan=...
 *  - institution → no invoke; opens mailto
 *
 * We test the actual control flow that planes.tsx uses, by replicating the
 * `choose()` switch around `computeCta`. This keeps the test independent from
 * TanStack Router setup while still exercising the supabase invocation path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeCta, type CtaContext } from "./planCta";
import { PLAN_CATALOG, type PlanKey } from "./plans";

type InvokeResult = { data: unknown; error: unknown };
const invoke = vi.fn<(name: string, args: { body: unknown }) => Promise<InvokeResult>>();

// Replica del flujo en src/routes/planes.tsx → choose().
// Devuelve la "intención" final para que el test la verifique.
type FlowResult =
  | { kind: "navigate"; href: string }
  | { kind: "noop"; reason: "current" }
  | { kind: "invoke-failed"; message: string };

async function runChoose(
  target: PlanKey,
  ctx: CtaContext & { email?: string | null },
): Promise<FlowResult> {
  const cta = computeCta(target, ctx);
  if (cta.action.kind === "free") {
    return { kind: "navigate", href: ctx.userId ? "/dashboard" : "/auth" };
  }
  if (cta.action.kind === "sales") {
    return {
      kind: "navigate",
      href: `https://wa.me/573147444715?text=${encodeURIComponent(
        "Hola Humanix 👋, quiero información del Plan Institución (IPS).",
      )}`,
    };
  }
  if (cta.action.kind === "login") {
    return {
      kind: "navigate",
      href: `/auth?redirect=${encodeURIComponent(cta.action.redirectTo)}`,
    };
  }
  if (cta.action.kind === "current") {
    return { kind: "noop", reason: "current" };
  }
  // checkout | reactivate → invoke MP
  const def = PLAN_CATALOG[target];
  const { data, error } = await invoke("mp-create-subscription", {
    body: { plan: target, amount: def.amountCOP, email: ctx.email ?? undefined },
  });
  if (error) return { kind: "invoke-failed", message: String(error) };
  const d = data as { init_point?: string; sandbox_init_point?: string } | null;
  const url = d?.init_point ?? d?.sandbox_init_point;
  if (!url) return { kind: "invoke-failed", message: "no url" };
  return { kind: "navigate", href: url };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("CTA flow → Mercado Pago checkout", () => {
  it("upgrade (Free → Essential) invokes mp-create-subscription and redirects to init_point", async () => {
    invoke.mockResolvedValueOnce({
      data: { init_point: "https://mp.test/checkout/abc" },
      error: null,
    });
    const result = await runChoose("essential_monthly", {
      userId: "u1",
      currentPlan: "free",
      cancelAtPeriodEnd: false,
      email: "ana@humanix.lat",
    });
    expect(invoke).toHaveBeenCalledWith("mp-create-subscription", {
      body: { plan: "essential_monthly", amount: 9000, email: "ana@humanix.lat" },
    });
    expect(result).toEqual({ kind: "navigate", href: "https://mp.test/checkout/abc" });
  });

  it("downgrade (Pro → Essential) invokes with the lower-tier plan", async () => {
    invoke.mockResolvedValueOnce({
      data: { init_point: "https://mp.test/checkout/down" },
      error: null,
    });
    const result = await runChoose("essential_monthly", {
      userId: "u1",
      currentPlan: "pro_monthly",
      cancelAtPeriodEnd: false,
      email: "ana@humanix.lat",
    });
    expect(invoke.mock.calls[0]?.[1].body).toMatchObject({
      plan: "essential_monthly",
      amount: 9000,
    });
    expect(result).toEqual({ kind: "navigate", href: "https://mp.test/checkout/down" });
  });

  it("reactivate (cancellation pending) re-invokes the same plan", async () => {
    invoke.mockResolvedValueOnce({
      data: { init_point: "https://mp.test/checkout/renew" },
      error: null,
    });
    const result = await runChoose("pro_monthly", {
      userId: "u1",
      currentPlan: "pro_monthly",
      cancelAtPeriodEnd: true,
      email: "ana@humanix.lat",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[1].body).toMatchObject({ plan: "pro_monthly", amount: 29000 });
    expect(result).toEqual({ kind: "navigate", href: "https://mp.test/checkout/renew" });
  });

  it("logged-out user → no invoke, goes to /auth with plan redirect", async () => {
    const result = await runChoose("essential_monthly", {
      userId: null,
      currentPlan: "free",
      cancelAtPeriodEnd: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "navigate",
      href: "/auth?redirect=" + encodeURIComponent("/planes?plan=essential_monthly"),
    });
  });

  it("current plan (no cancellation) → no-op, no invoke", async () => {
    const result = await runChoose("pro_monthly", {
      userId: "u1",
      currentPlan: "pro_monthly",
      cancelAtPeriodEnd: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "noop", reason: "current" });
  });

  it("institution → no invoke, opens WhatsApp", async () => {
    const result = await runChoose("institution_monthly", {
      userId: "u1",
      currentPlan: "pro_monthly",
      cancelAtPeriodEnd: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.kind).toBe("navigate");
    if (result.kind === "navigate")
      expect(result.href.startsWith("https://wa.me/")).toBe(true);
  });

  it("checkout falls back to sandbox_init_point when init_point missing", async () => {
    invoke.mockResolvedValueOnce({
      data: { sandbox_init_point: "https://mp.test/sandbox/xyz" },
      error: null,
    });
    const result = await runChoose("pro_monthly", {
      userId: "u1",
      currentPlan: "free",
      cancelAtPeriodEnd: false,
    });
    expect(result).toEqual({ kind: "navigate", href: "https://mp.test/sandbox/xyz" });
  });

  it("checkout surfaces invoke errors instead of redirecting", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: "boom" });
    const result = await runChoose("pro_monthly", {
      userId: "u1",
      currentPlan: "free",
      cancelAtPeriodEnd: false,
    });
    expect(result).toEqual({ kind: "invoke-failed", message: "boom" });
  });
});