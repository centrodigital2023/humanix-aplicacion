/**
 * WalletPanel — Billetera Humanix
 * ----------------------------------------------------------------------------
 * Saldo disponible/pendiente, historial de movimientos en vivo y solicitud de
 * retiro inmediato (Nequi · PSE · Bancolombia · Daviplata · RappiPay · transferencia).
 *
 * Backend: wallet_accounts / wallet_transactions / payout_requests
 * (migración 20260606140000_wallet_payouts.sql) + RPC request_payout().
 * Sincronizado en tiempo real vía Supabase Realtime.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Smartphone,
  Landmark,
  Send,
  Loader2,
  History,
  ShieldCheck,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

// ── Tipos ────────────────────────────────────────────────────────────────────

type PayoutMethod = "nequi" | "pse" | "bancolombia" | "daviplata" | "rappipay" | "bank_transfer";

interface WalletAccount {
  id: string;
  user_id: string;
  balance_cents: number;
  pending_cents: number;
  currency: string;
  payout_method: PayoutMethod | null;
  status: string;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount_cents: number;
  description: string | null;
  balance_after_cents: number;
  created_at: string;
}

interface PayoutRequest {
  id: string;
  amount_cents: number;
  method: PayoutMethod;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  requested_at: string;
}

const METHODS: Array<{ value: PayoutMethod; label: string; icon: React.ReactNode; placeholder: string }> = [
  { value: "nequi", label: "Nequi", icon: <Smartphone className="h-3.5 w-3.5" />, placeholder: "Número de celular Nequi" },
  { value: "pse", label: "PSE", icon: <Landmark className="h-3.5 w-3.5" />, placeholder: "Banco + número de cuenta" },
  { value: "bancolombia", label: "Bancolombia", icon: <Landmark className="h-3.5 w-3.5" />, placeholder: "Número de cuenta" },
  { value: "daviplata", label: "Daviplata", icon: <Smartphone className="h-3.5 w-3.5" />, placeholder: "Número de celular Daviplata" },
  { value: "rappipay", label: "RappiPay", icon: <Smartphone className="h-3.5 w-3.5" />, placeholder: "Número de celular RappiPay" },
  { value: "bank_transfer", label: "Transferencia bancaria", icon: <Banknote className="h-3.5 w-3.5" />, placeholder: "Banco + número de cuenta" },
];

const TX_CONFIG: Record<string, { label: string; icon: React.ReactNode; tone: "in" | "out" }> = {
  service_earning:     { label: "Pago de servicio",        icon: <ArrowDownLeft className="h-3.5 w-3.5" />, tone: "in" },
  referral_bonus:      { label: "Bono por referido",       icon: <Sparkles className="h-3.5 w-3.5" />,      tone: "in" },
  refund:              { label: "Reembolso",               icon: <ArrowDownLeft className="h-3.5 w-3.5" />, tone: "in" },
  adjustment:          { label: "Ajuste",                  icon: <History className="h-3.5 w-3.5" />,       tone: "in" },
  platform_commission: { label: "Comisión de plataforma",  icon: <ArrowUpRight className="h-3.5 w-3.5" />,  tone: "out" },
  payout:              { label: "Retiro solicitado",       icon: <Send className="h-3.5 w-3.5" />,          tone: "out" },
};

const STATUS_BADGE: Record<PayoutRequest["status"], { label: string; className: string; icon: React.ReactNode }> = {
  pending:    { label: "Pendiente",  className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20", icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Procesando", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",         icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed:  { label: "Completado", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:     { label: "Fallido",    className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",         icon: <XCircle className="h-3 w-3" /> },
  cancelled:  { label: "Cancelado",  className: "bg-muted text-muted-foreground border-border",                            icon: <XCircle className="h-3 w-3" /> },
};

function formatCOP(cents: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function WalletPanel({ userId }: { userId: string }) {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PayoutMethod>("nequi");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const [{ data: w }, { data: tx }, { data: po }] = await Promise.all([
        sb.rpc("get_or_create_wallet", { p_user_id: userId }).maybeSingle(),
        sb
          .from("wallet_transactions")
          .select("id, type, amount_cents, description, balance_after_cents, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(12),
        sb
          .from("payout_requests")
          .select("id, amount_cents, method, status, requested_at")
          .eq("user_id", userId)
          .order("requested_at", { ascending: false })
          .limit(6),
      ]);
      if (w) setWallet(w as WalletAccount);
      setTransactions((tx as WalletTransaction[]) ?? []);
      setPayouts((po as PayoutRequest[]) ?? []);
    } catch (err) {
      console.error("[WalletPanel] load error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = sb
      .channel(`wallet:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_accounts", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payout_requests", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const selectedMethod = useMemo(() => METHODS.find((m) => m.value === method)!, [method]);
  const availableCop = (wallet?.balance_cents ?? 0) / 100;

  const submitPayout = async () => {
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amountCents || amountCents <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    if (amountCents > (wallet?.balance_cents ?? 0)) {
      toast.error("El monto supera tu saldo disponible");
      return;
    }
    if (!destination.trim()) {
      toast.error(`Ingresa: ${selectedMethod.placeholder.toLowerCase()}`);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await sb.rpc("request_payout", {
        p_amount_cents: amountCents,
        p_method: method,
        p_destination: { detail: destination.trim() },
      });
      if (error) throw error;
      toast.success("Solicitud de retiro enviada. La procesaremos en las próximas 24-48h.");
      setOpen(false);
      setAmount("");
      setDestination("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo solicitar el retiro");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Balance hero */}
      <Card className="relative overflow-hidden p-5 border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-violet-500/5">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <Wallet className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">Saldo disponible</p>
              <Badge variant="outline" className="gap-1 text-[10px] border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> Protegido
              </Badge>
            </div>
            {loading ? (
              <div className="h-9 w-40 bg-muted/40 rounded-lg animate-pulse" />
            ) : (
              <p className="text-3xl font-bold font-display tabular-nums">
                {formatCOP(wallet?.balance_cents ?? 0)}
              </p>
            )}
            {!!wallet?.pending_cents && (
              <p className="text-[11px] text-muted-foreground mt-1">
                + {formatCOP(wallet.pending_cents)} en proceso de retiro
              </p>
            )}
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="hero" size="sm" className="gap-2" disabled={!wallet || wallet.balance_cents <= 0}>
                <Send className="h-4 w-4" />
                Retirar fondos
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-emerald-600" /> Solicitar retiro
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  Disponible: <span className="font-semibold text-foreground">{formatCOP(wallet?.balance_cents ?? 0)}</span>
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Método de pago</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {METHODS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setMethod(m.value)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          method === m.value
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{selectedMethod.placeholder}</Label>
                  <Input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={selectedMethod.placeholder}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Monto a retirar (COP)</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Máximo ${formatCOP(wallet?.balance_cents ?? 0)}`}
                    max={availableCop}
                    min={1}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submitPayout} disabled={submitting} className="w-full gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Confirmar solicitud
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Card>

      {/* Solicitudes de retiro */}
      {payouts.length > 0 && (
        <Card className="p-4 space-y-2.5">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Send className="h-3.5 w-3.5 text-muted-foreground" /> Retiros recientes
          </p>
          <div className="space-y-1.5">
            {payouts.map((p) => {
              const cfg = STATUS_BADGE[p.status];
              return (
                <div key={p.id} className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{formatCOP(p.amount_cents)}</span>
                    <span className="text-muted-foreground">
                      vía {METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(p.requested_at), "d MMM, HH:mm", { locale: es })}
                    </span>
                    <Badge variant="outline" className={cn("gap-1 text-[10px]", cfg.className)}>
                      {cfg.icon} {cfg.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Historial de movimientos */}
      <Card className="p-4 space-y-2.5">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-muted-foreground" /> Movimientos
        </p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-9 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Aún no tienes movimientos. Aparecerán aquí cuando completes tu primer servicio.
          </p>
        ) : (
          <div className="space-y-1">
            {transactions.map((tx) => {
              const cfg = TX_CONFIG[tx.type] ?? { label: tx.type, icon: <History className="h-3.5 w-3.5" />, tone: "in" as const };
              const isIn = cfg.tone === "in";
              return (
                <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn(
                      "h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0",
                      isIn ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600",
                    )}>
                      {cfg.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{tx.description || cfg.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(tx.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                      </p>
                    </div>
                  </div>
                  <span className={cn("text-xs font-semibold tabular-nums flex-shrink-0", isIn ? "text-emerald-600" : "text-red-600")}>
                    {isIn ? "+" : ""}{formatCOP(tx.amount_cents)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
