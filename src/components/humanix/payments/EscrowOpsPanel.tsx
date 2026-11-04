// Panel del equipo: pagos retenidos, reclamos de familias y devoluciones (solo staff, en /superadmin/pagos).
// Las acciones pasan por el servidor (`escrowOps.functions.ts`), que verifica que quien decide sea staff.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, ShieldCheck, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BREB_KEY_TYPES, type BrebKeyType } from "@/lib/breb";
import { COP } from "@/lib/commissionMatrix";
import {
  getEscrowOps,
  markRefundStatus,
  resolveEscrowDispute,
  type RefundItem,
} from "@/lib/escrowOps.functions";

const QUERY_KEY = ["superadmin", "escrow-ops"] as const;

const REFUND_LABEL: Record<RefundItem["status"], string> = {
  queued: "Por devolver",
  failed: "Falló",
  needs_key: "Sin llave",
  paid: "Devuelto",
};
const REASON_LABEL: Record<RefundItem["reason"], string> = {
  cancelled: "Turno cancelado",
  dispute: "Reclamo a favor de la familia",
  duplicate: "Pago repetido",
};

function keyLabel(type: string | null): string {
  return BREB_KEY_TYPES.find((t) => t.type === (type as BrebKeyType))?.label ?? "Llave";
}

export function EscrowOpsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => getEscrowOps() });
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QUERY_KEY });
    void qc.invalidateQueries({ queryKey: ["superadmin", "payouts"] });
  };

  const resolve = async (bookingId: string, action: "release" | "refund") => {
    if (
      !window.confirm(
        action === "release"
          ? "¿Liberar el pago al profesional? Entra a la cola de pagos."
          : "¿Devolver el pago completo a la familia?",
      )
    )
      return;
    setBusy(bookingId);
    const r = await resolveEscrowDispute({ data: { bookingId, action } }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return toast.error(r?.message ?? "No pudimos decidir el reclamo.");
    toast.success(r.result === "released" ? "Pago liberado" : "Devolución creada");
    refresh();
  };

  const mark = async (r: RefundItem, status: "paid" | "failed") => {
    setBusy(r.id);
    const res = await markRefundStatus({
      data: { refundId: r.id, status, reference: refs[r.id] ?? "" },
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast.error(res?.message ?? "No pudimos actualizar la devolución.");
    toast.success(status === "paid" ? "Devolución marcada como enviada" : "Marcada como fallida");
    refresh();
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
  if (q.isLoading)
    return (
      <div className="flex items-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando pagos retenidos…
      </div>
    );
  if (data && !data.ok) return <Card className="p-4 text-sm">{data.message}</Card>;
  if (!data?.ok) return null;

  return (
    <section className="space-y-4" aria-label="Pagos retenidos, reclamos y devoluciones">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Retenido ahora (turnos pagados)</p>
          <p className="font-display text-xl font-bold">{COP(data.held.amountCop)}</p>
          <p className="text-xs text-muted-foreground">{data.held.count} turnos</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Reclamos por decidir</p>
          <p className="font-display text-xl font-bold">{data.disputes.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Devoluciones pendientes</p>
          <p className="font-display text-xl font-bold">
            {COP(
              data.refunds
                .filter((r) => r.status !== "paid")
                .reduce((s, r) => s + Number(r.amount_cop), 0),
            )}
          </p>
        </Card>
      </div>

      {data.disputes.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-bold">Reclamos de familias</h2>
          {data.disputes.map((d) => (
            <Card key={d.booking_id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">Reclamo</Badge>
                <span className="font-semibold">
                  {d.client_name ?? "Familia"} → {d.professional_name ?? "Profesional"}
                </span>
                <span className="ml-auto font-display text-lg font-bold">
                  {COP(d.total_amount)}
                </span>
              </div>
              <p className="text-sm">«{d.dispute_reason}»</p>
              <p className="text-xs text-muted-foreground">
                Reportado el {d.disputed_at ? new Date(d.disputed_at).toLocaleString("es-CO") : "—"}{" "}
                ·{" "}
                <a className="underline" href={`/servicio/${d.booking_id}`}>
                  ver turno
                </a>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => resolve(d.booking_id, "release")}
                  disabled={busy === d.booking_id}
                >
                  <ShieldCheck className="mr-1 h-4 w-4" /> Liberar al profesional
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolve(d.booking_id, "refund")}
                  disabled={busy === d.booking_id}
                >
                  <Undo2 className="mr-1 h-4 w-4" /> Devolver a la familia
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {data.refunds.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-bold">Devoluciones a familias</h2>
          <p className="text-sm text-muted-foreground">
            Envía la devolución desde el panel de Firux a la llave Bre-B de la familia y márcala
            aquí.
          </p>
          {data.refunds.map((r) => {
            const canMark = r.status === "queued" || r.status === "failed";
            return (
              <Card key={r.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "queued" ? "default" : "secondary"}>
                    {REFUND_LABEL[r.status]}
                  </Badge>
                  <span className="font-semibold">{r.client_name ?? "Familia"}</span>
                  <span className="text-xs text-muted-foreground">{REASON_LABEL[r.reason]}</span>
                  <span className="ml-auto font-display text-lg font-bold">
                    {COP(r.amount_cop)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {r.key_value ? (
                    <>
                      <span className="text-muted-foreground">{keyLabel(r.key_type)}:</span>
                      <code className="rounded bg-muted px-2 py-0.5">{r.key_value}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(r.key_value!)}
                        aria-label="Copiar llave"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      La familia aún no da su llave Bre-B
                      {r.client_phone ? ` · ${r.client_phone}` : ""}
                    </span>
                  )}
                </div>
                {r.status === "paid" && r.provider_ref && (
                  <p className="text-xs text-muted-foreground">
                    Referencia Firux: {r.provider_ref}
                  </p>
                )}
                {r.status === "failed" && r.error_code && (
                  <p className="text-xs text-destructive">Motivo: {r.error_code}</p>
                )}
                {canMark && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="max-w-xs"
                      placeholder="Referencia de Firux o motivo"
                      value={refs[r.id] ?? ""}
                      onChange={(e) => setRefs((x) => ({ ...x, [r.id]: e.target.value }))}
                    />
                    <Button size="sm" onClick={() => mark(r, "paid")} disabled={busy === r.id}>
                      {busy === r.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-4 w-4" />
                      )}
                      Marcar devuelto
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mark(r, "failed")}
                      disabled={busy === r.id}
                    >
                      <X className="mr-1 h-4 w-4" /> Falló
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
