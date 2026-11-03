// Billetera Humanix del profesional: saldo, cupo (hasta −$30.000), comisión de hoy y cuánto falta para bajarla, y la
// recarga express por Bre-B. Solo se usa para turnos en efectivo: la comisión se descuenta al terminar el turno.
// Los números los da la base (`get_my_wallet`); las reglas para explicarlos, `commissionMatrix.ts` (probadas).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Lock, Plus, TrendingDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  COP,
  PRO_TIERS,
  WALLET_CREDIT_LIMIT_COP,
  nextTier,
  suggestedTopupCOP,
} from "@/lib/commissionMatrix";
import { topupWalletWithBreb } from "@/lib/firux.functions";
import { cn } from "@/lib/utils";
import { BrebPaySheet } from "./BrebPaySheet";

export const walletQuery = (userId: string) => ["wallet", userId] as const;

export function useWallet(userId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: walletQuery(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const [w, m] = await Promise.all([
        supabase.rpc("get_my_wallet"),
        supabase
          .from("wallet_movements")
          .select("id, kind, amount_cop, created_at, note")
          .eq("professional_id", userId)
          .order("created_at", { ascending: false })
          .limit(4),
      ]);
      if (w.error) throw w.error;
      const row = w.data?.[0];
      return {
        balance: Number(row?.balance_cop ?? 0),
        limit: Number(row?.credit_limit_cop ?? WALLET_CREDIT_LIMIT_COP),
        available: Number(row?.available_cop ?? -WALLET_CREDIT_LIMIT_COP),
        blocked: Boolean(row?.blocked),
        completed30d: Number(row?.completed_30d ?? 0),
        pct: Number(row?.commission_pct ?? 15),
        movements: m.data ?? [],
      };
    },
  });
  useRealtimeRefresh(
    `wallet-${userId}`,
    [
      { table: "wallets", filter: `professional_id=eq.${userId}` },
      { table: "firux_charges", filter: `user_id=eq.${userId}` },
    ],
    () => void qc.invalidateQueries({ queryKey: walletQuery(userId) }),
    Boolean(userId),
  );
  return q;
}

const QUICK = [20_000, 50_000, 100_000];

export function WalletCard({ userId, id = "billetera" }: { userId: string; id?: string }) {
  const q = useWallet(userId);
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | null>(null);

  if (q.isLoading)
    return <div className="h-48 animate-pulse rounded-3xl bg-muted/60" aria-hidden="true" />;
  if (q.error || !q.data) return null;
  const w = q.data;
  const next = nextTier(w.completed30d);
  const owe = w.balance < 0;
  // Cupo usado: de 0 a 30.000 (cuánto del crédito se está usando).
  const creditUsed = Math.min(-w.limit, Math.max(0, -w.balance));
  const missing = w.blocked ? w.limit - w.balance : 0;
  const tierFrom = next ? (next.pct === 12 ? 0 : 20) : 60;
  const tierTo = next ? (next.pct === 12 ? 20 : 60) : 60;

  return (
    <section
      id={id}
      aria-label="Tu billetera Humanix"
      className="scroll-mt-24 overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div
        className={cn(
          "p-5",
          w.blocked ? "bg-destructive/10" : "bg-gradient-to-br from-trust/10 to-biosensor/10",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Wallet className="h-4 w-4" aria-hidden="true" /> Tu billetera Humanix
          </p>
          <span className="rounded-full bg-background/80 px-3 py-1 text-xs font-semibold">
            Comisión hoy: {w.pct} %
          </span>
        </div>
        <p
          className={cn(
            "mt-2 font-display text-4xl font-bold tracking-tight",
            owe && "text-copper",
            w.blocked && "text-destructive",
          )}
        >
          {owe ? `−${COP(-w.balance)}` : COP(w.balance)}
        </p>
        <p className="text-sm text-muted-foreground">
          {w.blocked
            ? "Pasaste el cupo. Recarga para volver a recibir turnos."
            : owe
              ? `Estás usando ${COP(creditUsed)} de tu cupo de ${COP(-w.limit)}.`
              : `Puedes aceptar turnos en efectivo con comisión de hasta ${COP(w.available)}.`}
        </p>

        {w.blocked ? (
          <Button
            size="lg"
            className="mt-4 h-14 w-full rounded-2xl text-base font-bold"
            onClick={() => setAmount(suggestedTopupCOP(missing))}
          >
            <Lock className="mr-2 h-5 w-5" aria-hidden="true" /> Recargar{" "}
            {COP(suggestedTopupCOP(missing))} y desbloquear
          </Button>
        ) : (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Recarga en segundos con Bre-B</p>
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map((v) => (
                <Button
                  key={v}
                  variant="outline"
                  className="h-12 rounded-2xl bg-background text-base font-bold"
                  onClick={() => setAmount(v)}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  {COP(v).replace(/\s/g, "")}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <TrendingDown className="h-4 w-4 text-biosensor" aria-hidden="true" />
              {next
                ? `${next.shiftsToGo} turnos más y tu comisión baja a ${next.pct} %`
                : "¡Tienes la comisión más baja! 🎉"}
            </span>
            <span className="text-muted-foreground">{w.completed30d} en 30 días</span>
          </div>
          <Progress
            className="mt-2 h-2.5"
            value={next ? ((w.completed30d - tierFrom) / (tierTo - tierFrom)) * 100 : 100}
            aria-label="Avance hacia la siguiente comisión"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {PRO_TIERS.slice()
              .reverse()
              .map((t) => `${t.pct} % desde ${t.minShifts} turnos`)
              .join(" · ")}
            . Tu primer turno con cada familia nueva no paga comisión (hasta $30.000).
          </p>
        </div>

        {w.movements.length > 0 && (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {w.movements.map((m) => {
              const up = Number(m.amount_cop) > 0;
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {up ? (
                    <ArrowDownLeft className="h-4 w-4 text-biosensor" aria-hidden="true" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-copper" aria-hidden="true" />
                  )}
                  <span className="flex-1 truncate">{m.note ?? (up ? "Recarga" : "Comisión")}</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      up ? "text-biosensor" : "text-copper",
                    )}
                  >
                    {up ? "+" : "−"}
                    {COP(Math.abs(Number(m.amount_cop)))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <BrebPaySheet
        open={amount !== null}
        onOpenChange={(o) => !o && setAmount(null)}
        title="Recargar billetera"
        subtitle="Se suma a tu saldo apenas pagues."
        start={() => topupWalletWithBreb({ data: { amountCop: amount ?? 0 } })}
        paidMessage="Ya sumamos la recarga a tu billetera. ¡A seguir cuidando!"
        onPaid={() => void qc.invalidateQueries({ queryKey: walletQuery(userId) })}
      />
    </section>
  );
}
