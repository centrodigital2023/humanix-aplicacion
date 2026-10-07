import { Sparkles, Zap, TrendingDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAiCredits } from "@/hooks/use-ai-credits";

export function AiCreditsWidget({ userId }: { userId: string }) {
  const { balance, loading } = useAiCredits(userId);

  if (loading || !balance) return null;

  const total = balance.grand_total;
  const used = balance.monthly_used + balance.extra_used;
  const allowance = balance.monthly_allowance + balance.extra_total;
  const pct = allowance > 0 ? Math.min(100, (used / allowance) * 100) : 0;
  const critical = total <= 10;
  const low = total <= 50 && !critical;

  return (
    <Link
      to={"/creditos" as "/"}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 border transition-colors group ${
        critical
          ? "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15"
          : low
          ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15"
          : "bg-biosensor/5 border-biosensor/20 hover:bg-biosensor/10"
      }`}
    >
      {critical ? (
        <TrendingDown className="h-4 w-4 text-rose-500 shrink-0" />
      ) : (
        <Sparkles className={`h-4 w-4 shrink-0 ${low ? "text-amber-500" : "text-biosensor"}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-medium leading-none">Créditos IA</p>
          <p className={`text-xs font-bold tabular-nums ${critical ? "text-rose-600" : low ? "text-amber-600" : "text-biosensor"}`}>
            {total.toLocaleString("es-CO")}
          </p>
        </div>
        <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              critical ? "bg-rose-500" : low ? "bg-amber-500" : "bg-biosensor"
            }`}
            style={{ width: `${100 - pct}%` }}
          />
        </div>
      </div>
      {(critical || low) && (
        <span className="text-xs font-medium shrink-0 flex items-center gap-0.5 text-muted-foreground group-hover:text-foreground transition-colors">
          <Zap className="h-3 w-3" /> Recargar
        </span>
      )}
    </Link>
  );
}
