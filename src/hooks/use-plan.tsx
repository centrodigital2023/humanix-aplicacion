import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_CATALOG,
  type InstitutionSize,
  type PlanKey,
  type PlanFeature,
  type SubscriptionSnapshot,
  canUseFeature,
  effectivePlan,
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
  /** Tamaño del plan institucional vigente (nulo si no hay). */
  institutionSize: InstitutionSize | null;
  loading: boolean;
  /**
   * No se pudo leer el plan (red o servidor). Se conserva el último plan conocido en vez de bajar de nivel a quien
   * ya lo tiene; la interfaz no debe ofrecer pagar de nuevo mientras esto sea `true`.
   */
  error: boolean;
  /** Minimum-tier check: `has("pro_monthly")` returns true if plan >= pro. */
  has: (min: PlanKey) => boolean;
  /** Feature-based check. */
  can: (feature: PlanFeature) => boolean;
  /** Current plan definition (label, price, features). */
  def: (typeof PLAN_CATALOG)[PlanKey];
  /** Force re-fetch. */
  refresh: () => Promise<void>;
};

/**
 * Nivel efectivo de la cuenta, con la misma regla que `plan_key_for()` en SQL: familias y profesionales tienen todas
 * sus funciones gratis; la institución abre las suyas con el plan anual (que escribe solo el aviso de pago de Wompi).
 */
export function usePlan(userId: string | null | undefined): UserPlanState {
  const [state, setState] = useState<Omit<UserPlanState, "has" | "can" | "def" | "refresh">>(
    () => ({
      plan: "free",
      tier: 0,
      status: null,
      amount: null,
      currency: null,
      currentPeriodEnd: null,
      institutionSize: null,
      loading: true,
      error: false,
    }),
  );

  const load = useCallback(async () => {
    if (!userId) {
      setState((s) => ({ ...s, plan: "free", tier: 0, loading: false, error: false }));
      return;
    }
    // Un reintento corto antes de rendirse: un fallo de red no debe parecer «no tienes plan».
    for (let attempt = 0; attempt < 2; attempt++) {
      const [roles, sub] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        // «*»: la tabla de producción no tiene todas las columnas del repositorio.
        supabase.from("mp_subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (!roles.error && !sub.error) {
        const norm = effectivePlan(
          (roles.data ?? []).map((r) => String(r.role)),
          (sub.data ?? null) as SubscriptionSnapshot | null,
        );
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

  // Realtime: cuando el aviso de pago activa el plan institucional, se ve sin recargar.
  useEffect(() => {
    if (!userId) return;
    // Nombre único por montaje: evita «add callbacks after subscribe()» con StrictMode/HMR.
    const channelName = `mp_subscriptions:${userId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mp_subscriptions", filter: `user_id=eq.${userId}` },
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

  return { ...state, has, can, def: PLAN_CATALOG[state.plan], refresh: load };
}
