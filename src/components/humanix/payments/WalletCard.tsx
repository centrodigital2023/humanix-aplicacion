// Billetera Humanix del profesional, tipo InDrive: saldo, cupo (hasta −$30.000), lo apartado para comisiones de turnos en
// efectivo ya aceptados, cuánto queda libre, avisos de saldo bajo o bloqueo, historial y recarga por Bre-B (rápida o del valor que
// quiera). Solo se usa para turnos en efectivo: la comisión se descuenta al terminar el turno.
// Los números los da la base (`get_my_wallet`); las reglas para explicarlos, `commissionMatrix.ts` (probadas).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Lock,
  Plus,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  COP,
  PAYMENT_MAX_COP,
  PAYMENT_MIN_COP,
  PRO_TIERS,
  WALLET_CREDIT_LIMIT_COP,
  type WalletHealth,
  nextTier,
  suggestedTopupCOP,
  walletHealth,
} from "@/lib/commissionMatrix";
import { topupWallet } from "@/lib/payments.functions";
import { cn } from "@/lib/utils";
import { PaySheet } from "./PaySheet";

export const walletQuery = (userId: string) => ["wallet", userId] as const;

const MOVEMENT_LABEL: Record<string, string> = {
  topup: "Recarga por Bre-B",
  commission_debit: "Comisión de turno en efectivo",
  adjustment: "Ajuste de Humanix",
};

export function useWallet(userId: string, historySize = 5) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...walletQuery(userId), historySize],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [w, m] = await Promise.all([
        supabase.rpc("get_my_wallet"),
        supabase
          .from("wallet_movements")
          .select("id, kind, amount_cop, balance_after, booking_id, created_at, note")
          .eq("professional_id", userId)
          .order("created_at", { ascending: false })
          .limit(historySize + 1),
      ]);
      if (w.error) throw w.error;
      const row = w.data?.[0];
      const balance = Number(row?.balance_cop ?? 0);
      const limit = Number(row?.credit_limit_cop ?? WALLET_CREDIT_LIMIT_COP);
      const reserved = Number(row?.reserved_cop ?? 0);
      const rows = m.data ?? [];
      return {
        balance,
        limit,
        reserved,
        free: Number(row?.free_cop ?? Math.max(0, balance - limit - reserved)),
        available: Number(row?.available_cop ?? balance - limit),
        blocked: Boolean(row?.blocked),
        health: ((row?.health as WalletHealth | undefined) ??
          walletHealth(balance, reserved, limit)) as WalletHealth,
        completed30d: Number(row?.completed_30d ?? 0),
        pct: Number(row?.commission_pct ?? 15),
        movements: rows.slice(0, historySize),
        moreMovements: rows.length > historySize,
      };
    },
  });
  useRealtimeRefresh(
    `wallet-${userId}`,
    [
      { table: "wallets", filter: `professional_id=eq.${userId}` },
      { table: "payment_charges", filter: `user_id=eq.${userId}` },
      // Aceptar, terminar o cancelar un turno en efectivo cambia lo apartado.
      { table: "service_bookings", filter: `professional_id=eq.${userId}` },
    ],
    () => void qc.invalidateQueries({ queryKey: walletQuery(userId) }),
    Boolean(userId),
  );
  return q;
}

const QUICK = [20_000, 50_000, 100_000];
const when = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Bogota",
});

export function WalletCard({ userId, id = "billetera" }: { userId: string; id?: string }) {
  const [historySize, setHistorySize] = useState(5);
  const q = useWallet(userId, historySize);
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");

  if (q.isLoading)
    return <div className="h-48 animate-pulse rounded-3xl bg-muted/60" aria-hidden="true" />;
  if (q.error || !q.data) return null;
  const w = q.data;
  const next = nextTier(w.completed30d);
  const owe = w.balance < 0;
  const cupo = -w.limit;
  // Cupo usado: de 0 a 30.000 (cuánto del crédito se está usando).
  const creditUsed = Math.min(cupo, Math.max(0, -w.balance));
  const unblockCOP = w.blocked ? w.limit - w.balance : 0;
  // Recarga sugerida: desbloquear, o dejar el cupo libre completo otra vez (deuda + lo apartado).
  const suggested = w.blocked
    ? suggestedTopupCOP(unblockCOP)
    : w.health === "low"
      ? suggestedTopupCOP(cupo - w.free)
      : null;
  const tierFrom = next ? (next.pct === 12 ? 0 : 20) : 60;
  const tierTo = next ? (next.pct === 12 ? 20 : 60) : 60;
  const customCOP = Math.round(Number(custom.replace(/\D/g, "")) || 0);
  const customOk = customCOP >= PAYMENT_MIN_COP && customCOP <= PAYMENT_MAX_COP;

  return (
    <section
      id={id}
      aria-label="Tu billetera Humanix"
      className="scroll-mt-24 overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div
        className={cn(
          "p-5",
          w.health === "blocked"
            ? "bg-destructive/10"
            : w.health === "low"
              ? "bg-copper/10"
              : "bg-gradient-to-br from-trust/10 to-biosensor/10",
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
            ? `Pasaste el cupo de ${COP(cupo)}. Recarga para volver a recibir turnos.`
            : owe
              ? `Estás usando ${COP(creditUsed)} de tu cupo de ${COP(cupo)}.`
              : "Saldo a tu favor para comisiones de turnos en efectivo."}
        </p>

        {!w.blocked && (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl bg-background/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Libre para efectivo</dt>
              <dd className="font-bold tabular-nums">{COP(w.free)}</dd>
            </div>
            <div className="rounded-2xl bg-background/70 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Apartado</dt>
              <dd className="font-bold tabular-nums">{COP(w.reserved)}</dd>
            </div>
          </dl>
        )}
        {w.reserved > 0 && !w.blocked && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            «Apartado» es la comisión de tus turnos en efectivo ya aceptados. Se descuenta cuando
            terminan; si se cancelan, vuelve a quedar libre.
          </p>
        )}

        {w.health === "low" && (
          <p
            className="mt-3 flex items-start gap-2 rounded-2xl bg-background/80 px-3 py-2 text-sm"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
            Te queda poco para aceptar turnos en efectivo. Los turnos por Bre-B los sigues
            recibiendo normal.
          </p>
        )}

        {suggested ? (
          <Button
            size="lg"
            variant={w.blocked ? "default" : "secondary"}
            className="mt-4 h-14 w-full rounded-2xl text-base font-bold"
            onClick={() => setAmount(suggested)}
          >
            {w.blocked ? (
              <Lock className="mr-2 h-5 w-5" aria-hidden="true" />
            ) : (
              <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
            )}
            Recargar {COP(suggested)}
            {w.blocked ? " y desbloquear" : " y quedar al día"}
          </Button>
        ) : null}

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
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (customOk) setAmount(customCOP);
            }}
          >
            <Input
              inputMode="numeric"
              aria-label="Otro valor de recarga"
              placeholder="Otro valor"
              value={custom ? COP(customCOP).replace(/\s/g, "") : ""}
              onChange={(e) => setCustom(e.target.value)}
              className="h-12 rounded-2xl bg-background text-base"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!customOk}
              className="h-12 rounded-2xl bg-background font-bold"
            >
              Recargar
            </Button>
          </form>
          {custom && !customOk && (
            <p className="mt-1 text-xs text-muted-foreground">
              Desde {COP(PAYMENT_MIN_COP)} hasta {COP(PAYMENT_MAX_COP)}.
            </p>
          )}
        </div>
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
          <div>
            <h3 className="mb-2 text-sm font-semibold">Movimientos</h3>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {w.movements.map((m) => {
                const amt = Number(m.amount_cop);
                const up = amt > 0;
                const label = m.note ?? MOVEMENT_LABEL[m.kind] ?? (up ? "Recarga" : "Comisión");
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    {up ? (
                      <ArrowDownLeft
                        className="h-4 w-4 shrink-0 text-biosensor"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      {m.booking_id ? (
                        <Link
                          to="/servicio/$bookingId"
                          params={{ bookingId: m.booking_id }}
                          className="block truncate underline-offset-2 hover:underline"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="block truncate">{label}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {when.format(new Date(m.created_at))} · saldo{" "}
                        {Number(m.balance_after) < 0
                          ? `−${COP(-Number(m.balance_after))}`
                          : COP(Number(m.balance_after))}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        up ? "text-biosensor" : "text-copper",
                      )}
                    >
                      {up ? "+" : "−"}
                      {COP(Math.abs(amt))}
                    </span>
                  </li>
                );
              })}
            </ul>
            {w.moreMovements && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                onClick={() => setHistorySize((n) => n + 20)}
              >
                <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" /> Ver más movimientos
              </Button>
            )}
          </div>
        )}
      </div>

      <PaySheet
        pixelKind="topup"
        open={amount !== null}
        onOpenChange={(o) => !o && setAmount(null)}
        title="Recargar billetera"
        subtitle="Se suma a tu saldo apenas pagues."
        start={() => topupWallet({ data: { amountCop: amount ?? 0 } })}
        paidMessage="Ya sumamos la recarga a tu billetera. ¡A seguir cuidando!"
        onPaid={() => {
          setCustom("");
          void qc.invalidateQueries({ queryKey: walletQuery(userId) });
        }}
      />
    </section>
  );
}
