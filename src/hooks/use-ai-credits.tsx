import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AiCreditsBalance = {
  monthly_allowance: number;
  monthly_used: number;
  monthly_remaining: number;
  extra_total: number;
  extra_used: number;
  extra_remaining: number;
  grand_total: number;
  period_start: string;
  period_end: string;
};

export type AiCreditPack = {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price_cop: number;
  bonus_pct: number;
  validity_days: number;
  active: boolean;
  sort_order: number;
};

export function useAiCredits(userId: string | undefined) {
  const [balance, setBalance] = useState<AiCreditsBalance | null>(null);
  const [packs, setPacks] = useState<AiCreditPack[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyClient = supabase as any;
      const [balRes, packsRes] = await Promise.all([
        anyClient.rpc("get_total_ai_credits_balance", { p_user_id: userId }),
        anyClient
          .from("ai_credit_packs_catalog")
          .select("id, name, description, credits, price_cop, bonus_pct, validity_days, active, sort_order")
          .eq("active", true)
          .order("sort_order"),
      ]);
      if (balRes.data?.[0]) setBalance(balRes.data[0] as AiCreditsBalance);
      if (packsRes.data) setPacks(packsRes.data as AiCreditPack[]);
    } catch (e) {
      console.warn("[useAiCredits]", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: actualizar saldo cuando se acrediten créditos o se consuman
  useEffect(() => {
    if (!userId) return;
    const sub = supabase
      .channel(`ai_credits_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_credit_topups", filter: `user_id=eq.${userId}` },
        () => { refresh(); },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_credits_ledger", filter: `user_id=eq.${userId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [userId, refresh]);

  return { balance, packs, loading, refresh };
}
