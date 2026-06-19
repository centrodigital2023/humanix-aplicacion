/**
 * AiCreditsBalance — saldo y consumo del cupo mensual de créditos IA
 * ----------------------------------------------------------------------------
 * Lee el saldo vía RPC get_ai_credits_balance (cupo según plan activo en
 * mp_subscriptions, ver migración 20260606170000_ai_credits_consumption.sql)
 * y muestra el historial reciente desde ai_credits_ledger.
 */
import { useEffect, useState } from "react";
import { Sparkles, Zap, History, Crown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type Balance = {
  allowance: number;
  used: number;
  remaining: number;
  period_start: string;
  period_end: string;
};

type LedgerRow = {
  id: string;
  feature: string;
  credits_used: number;
  created_at: string;
};

const FEATURE_LABEL: Record<string, string> = {
  "chat-copilot": "Sugerencias de chat",
  "match-offers": "Match de ofertas IA",
  "semantic-match": "Búsqueda semántica",
  "rate-suggester": "Sugerencia de tarifa",
  "crm-segment-ai": "Segmentación CRM IA",
  "family-onboarding-ai": "Onboarding asistido IA",
};

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { month: "long", year: "numeric" });

export function AiCreditsBalance({ userId }: { userId: string }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: balData }, { data: histData }] = await Promise.all([
      sb.rpc("get_ai_credits_balance", { p_user_id: userId }),
      sb
        .from("ai_credits_ledger")
        .select("id, feature, credits_used, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    const row = Array.isArray(balData) ? balData[0] : balData;
    setBalance((row as Balance) ?? null);
    setHistory((histData as LedgerRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = sb
      .channel(`ai-credits:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_credits_ledger", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return <div className="h-32 rounded-2xl bg-muted/30 animate-pulse" />;
  }
  if (!balance) return null;

  const pctUsed = balance.allowance > 0 ? Math.min(100, Math.round((balance.used / balance.allowance) * 100)) : 0;
  const low = balance.remaining <= Math.max(1, Math.round(balance.allowance * 0.15));

  return (
    <Card className="relative overflow-hidden p-5 border-fuchsia-neural/20 bg-gradient-to-br from-fuchsia-neural/10 via-background to-biosensor/5">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-neural/10 blur-3xl pointer-events-none" />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-fuchsia-neural/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4.5 w-4.5 text-fuchsia-neural" />
            </div>
            <div>
              <p className="text-sm font-bold font-display">Créditos IA</p>
              <p className="text-[10px] text-muted-foreground capitalize">Ciclo de {monthLabel(balance.period_start)}</p>
            </div>
          </div>
          <Badge variant="outline" className={cn("text-[10px] gap-1", low ? "border-amber-500/30 text-amber-600" : "border-emerald-500/30 text-emerald-600")}>
            <Zap className="h-3 w-3" /> {balance.remaining} restantes
          </Badge>
        </div>

        <div className="space-y-1.5">
          <Progress value={pctUsed} className={cn("h-2", low && "[&>div]:bg-amber-500")} />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{balance.used} usados</span>
            <span>{balance.allowance} créditos/mes</span>
          </div>
        </div>

        {low && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Tu cupo IA está por agotarse este mes.
            </p>
            <Button asChild size="sm" variant="outline" className="h-6 text-[10px] gap-1 flex-shrink-0 border-amber-500/30">
              <Link to="/planes">
                <Crown className="h-3 w-3" /> Subir de plan
              </Link>
            </Button>
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-border">
            <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1 pt-2">
              <History className="h-3 w-3" /> Uso reciente
            </p>
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground truncate">{FEATURE_LABEL[h.feature] ?? h.feature}</span>
                <span className="font-medium tabular-nums flex-shrink-0 ml-2">
                  −{h.credits_used} · {new Date(h.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
