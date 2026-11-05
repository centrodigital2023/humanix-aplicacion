// Pagos a profesionales (cola `payouts`). El dinero de los turnos Bre-B llega a la cuenta Wompi de Humanix. Con la
// dispersión automática encendida (WOMPI_PAYOUTS_ENABLED) cada pago liberado sale solo a la llave Bre-B del profesional;
// si no, o como respaldo, el equipo paga desde el panel de Wompi y aquí lo marca como enviado (o fallido).
// Solo staff: la lista y las marcas pasan por el servidor (`payoutQueue.functions.ts`).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Check,
  Copy,
  FileCheck,
  LayoutDashboard,
  Loader2,
  Mail,
  Megaphone,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { EscrowOpsPanel } from "@/components/humanix/payments/EscrowOpsPanel";
import { ReconciliationPanel } from "@/components/humanix/payments/ReconciliationPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSuperadmin } from "@/hooks/use-superadmin";
import { BREB_KEY_TYPES, type BrebKeyType } from "@/lib/breb";
import { COP } from "@/lib/commissionMatrix";
import {
  getPayoutQueue,
  markPayoutStatus,
  type PayoutItem,
  type PayoutStatus,
} from "@/lib/payoutQueue.functions";

const NAV: NavItem[] = [
  { label: "Control Center", to: "/superadmin", icon: LayoutDashboard },
  { label: "Pagos Bre-B", to: "/superadmin/pagos", icon: Wallet },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/buscar", icon: Briefcase },
];

export const Route = createFileRoute("/superadmin/pagos")({
  head: () => ({ meta: [{ title: "Pagos Bre-B · Humanix" }] }),
  component: PagosPage,
});

const STATUS_LABEL: Record<PayoutStatus, string> = {
  queued: "Por pagar",
  sending: "Enviando",
  sent: "En camino",
  failed: "Falló",
  needs_key: "Sin llave",
  paid: "Pagado",
};

const STATUS_VARIANT: Record<PayoutStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "default",
  sending: "secondary",
  sent: "secondary",
  failed: "destructive",
  needs_key: "outline",
  paid: "secondary",
};

function keyLabel(type: string | null): string {
  return BREB_KEY_TYPES.find((t) => t.type === (type as BrebKeyType))?.label ?? "Llave";
}

const QUERY_KEY = ["superadmin", "payouts"] as const;

function PagosPage() {
  const { user, logout } = useSuperadmin();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getPayoutQueue({ data: { includePaidDays: 14 } }),
  });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const mark = async (p: PayoutItem, status: "paid" | "failed") => {
    setBusy(p.id);
    const r = await markPayoutStatus({
      data: { payoutId: p.id, status, reference: refs[p.id] ?? "" },
    }).catch(() => null);
    setBusy(null);
    if (!r?.ok) {
      toast.error(r?.message ?? "No pudimos actualizar el pago.");
      return;
    }
    toast.success(status === "paid" ? "Pago marcado como enviado" : "Pago marcado como fallido");
    void qc.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const data = q.data;

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verificando acceso…
      </div>
    );
  }

  return (
    <AppShell nav={NAV} title="Pagos a profesionales (Bre-B)" user={user} onLogout={logout}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Un turno entra aquí solo cuando su pago se libera: la familia confirmó que terminó,
          pasaron 24 h sin reportes o el equipo decidió un reclamo. Ahí se reparte: la comisión
          queda para Humanix y el resto sale a la llave Bre-B del profesional, solo si la dispersión
          automática está encendida. Si no, págalo desde el panel de Wompi y márcalo aquí.
        </p>

        <ReconciliationPanel />

        <EscrowOpsPanel />

        <h2 className="pt-2 font-display text-lg font-bold">Pagos a profesionales</h2>

        {q.isLoading && (
          <div className="flex items-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}

        {data && !data.ok && <Card className="p-4 text-sm">{data.message}</Card>}

        {data?.ok && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {(["queued", "failed", "needs_key", "paid"] as const).map((s) => (
                <Card key={s} className="p-4">
                  <p className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</p>
                  <p className="font-display text-xl font-bold">{COP(data.totals[s].amountCop)}</p>
                  <p className="text-xs text-muted-foreground">{data.totals[s].count} pagos</p>
                </Card>
              ))}
            </div>

            {data.items.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No hay pagos pendientes.
              </Card>
            )}

            <div className="space-y-3">
              {data.items.map((p) => {
                const canPay =
                  p.status === "queued" || p.status === "sent" || p.status === "failed";
                return (
                  <Card key={p.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      <span className="font-semibold">{p.professional_name ?? "Profesional"}</span>
                      <span className="ml-auto font-display text-lg font-bold">
                        {COP(p.amount_cop)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {p.key_value ? (
                        <>
                          <span className="text-muted-foreground">{keyLabel(p.key_type)}:</span>
                          <code className="rounded bg-muted px-2 py-0.5">{p.key_value}</code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copy(p.key_value!)}
                            aria-label="Copiar llave"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Aún no guarda su llave Bre-B
                          {p.professional_phone ? ` · ${p.professional_phone}` : ""}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Turno terminado el {new Date(p.created_at).toLocaleDateString("es-CO")}
                      </span>
                    </div>
                    {p.status === "paid" && p.provider_ref && (
                      <p className="text-xs text-muted-foreground">
                        Referencia Wompi: {p.provider_ref}
                      </p>
                    )}
                    {p.status === "failed" && p.error_code && (
                      <p className="text-xs text-destructive">Motivo: {p.error_code}</p>
                    )}
                    {canPay && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="max-w-xs"
                          placeholder="Referencia de Wompi o motivo"
                          value={refs[p.id] ?? ""}
                          onChange={(e) => setRefs((r) => ({ ...r, [p.id]: e.target.value }))}
                        />
                        <Button size="sm" onClick={() => mark(p, "paid")} disabled={busy === p.id}>
                          {busy === p.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="mr-1 h-4 w-4" />
                          )}
                          Marcar enviado
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => mark(p, "failed")}
                          disabled={busy === p.id}
                        >
                          <X className="mr-1 h-4 w-4" /> Falló
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
