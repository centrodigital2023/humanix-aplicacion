import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_CATALOG,
  type PlanKey,
  type PlanFeature,
  type SubscriptionSnapshot,
  canUseFeature,
  hasAtLeast,
  normalizeSubscription,
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
  /**
   * No se pudo leer el plan (red o servidor). Se conserva el último plan conocido en vez de mostrar «Free» a
   * quien sí paga; la interfaz no debe ofrecer pagar de nuevo mientras esto sea `true`.
   */
  error: boolean;
  /** Minimum-tier check: `has("pro_monthly")` returns true if plan >= pro. */
  has: (min: PlanKey) => boolean;
  /** Feature-based check using FEATURE_MIN_PLAN. */
  can: (feature: PlanFeature) => boolean;
  /** Current plan definition (label, price, features). */
  def: (typeof PLAN_CATALOG)[PlanKey];
  /** Force re-fetch. */
  refresh: () => Promise<void>;
};

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
    error: false,
  }));

  const load = useCallback(async () => {
    if (!userId) {
      setState((s) => ({ ...s, plan: "free", tier: 0, loading: false, error: false }));
      return;
    }
    // Un reintento corto antes de rendirse: un fallo de red no debe parecer «no tienes plan».
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from("mp_subscriptions")
        // «*»: la tabla de producción no tiene todas las columnas del repositorio (p. ej. cancel_at_period_end);
        // pedir una columna que no existe hace fallar la consulta para todos.
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!error) {
        const norm = normalizeSubscription((data ?? null) as SubscriptionSnapshot | null);
        setState({ ...norm, tier: tierOf(norm.plan), loading: false, error: false });
        return;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    setState((s) => ({ ...s, loading: false, error: true }));
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
