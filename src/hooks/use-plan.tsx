import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_CATALOG,
  type PlanKey,
  type PlanFeature,
  canUseFeature,
  hasAtLeast,
  tierOf,
} from "@/lib/plans";

export type UserPlanState = {
  plan: PlanKey;
  tier: number;
  status: string | null;
  amount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  loading: boolean;
  /** Minimum-tier check: `has("pro_monthly")` returns true if plan >= pro. */
  has: (min: PlanKey) => boolean;
  /** Feature-based check using FEATURE_MIN_PLAN. */
  can: (feature: PlanFeature) => boolean;
  /** Current plan definition (label, price, features). */
  def: (typeof PLAN_CATALOG)[PlanKey];
  /** Force re-fetch. */
  refresh: () => Promise<void>;
};

const FREE_STATE = {
  plan: "free" as PlanKey,
  status: null,
  amount: null,
  currency: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

type SubRow = {
  plan: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  current_period_end: string | null;
  cancel_at_period_end?: boolean | null;
};

function normalizePlan(row: SubRow | null | undefined): {
  plan: PlanKey;
  status: string | null;
  amount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
} {
  if (!row) return { ...FREE_STATE };
  const active = row.status === "active" || row.status === "approved";
  const stillInPeriod =
    !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now();
  if (!active || !stillInPeriod) {
    return {
      ...FREE_STATE,
      status: row.status ?? null,
      currentPeriodEnd: row.current_period_end ?? null,
    };
  }
  const rawPlan = (row.plan ?? "free") as PlanKey;
  const plan: PlanKey = rawPlan in PLAN_CATALOG ? rawPlan : "free";
  return {
    plan,
    status: row.status,
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  };
}

export function usePlan(userId: string | null | undefined): UserPlanState {
  const [state, setState] = useState<
    Omit<UserPlanState, "has" | "can" | "def" | "refresh" | "tier"> & {
      tier: number;
    }
  >(() => ({
    plan: "free",
    tier: 0,
    status: null,
    amount: null,
    currency: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    loading: true,
  }));

  const load = useCallback(async () => {
    if (!userId) {
      setState((s) => ({ ...s, plan: "free", tier: 0, loading: false }));
      return;
    }
    const { data } = await supabase
      .from("mp_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const norm = normalizePlan((data ?? null) as SubRow | null);
    setState({
      ...norm,
      tier: tierOf(norm.plan),
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: when MP webhook flips status or webhook inserts a new sub,
  // we pick it up without a page reload.
  useEffect(() => {
    if (!userId) return;
    // Unique channel name per mount to avoid "add callbacks after subscribe()"
    // errors when StrictMode/HMR re-runs the effect before the previous
    // removeChannel resolves.
    const channelName = `mp_subscriptions:${userId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mp_subscriptions",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const has = useCallback((min: PlanKey) => hasAtLeast(state.plan, min), [state.plan]);
  const can = useCallback(
    (feature: PlanFeature) => canUseFeature(state.plan, feature),
    [state.plan],
  );

  return {
    ...state,
    has,
    can,
    def: PLAN_CATALOG[state.plan],
    refresh: load,
  };
}
