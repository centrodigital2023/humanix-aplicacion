// «Conectar con Firux Pay»: el profesional conecta su propia cuenta Firux y acepta UNA vez la comisión de Humanix.
// Desde ahí la familia le paga directo y Humanix se queda solo con su comisión. Mientras el servidor tenga el flag
// apagado (FIRUX_CONNECT_ENABLED) la tarjeta no se muestra y todo sigue por la llave Bre-B (`BrebKeyCard`).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  disconnectFiruxConnect,
  getFiruxConnectStatus,
  startFiruxConnect,
} from "@/lib/firux.functions";

export const firuxConnectQuery = (userId: string) => ["firux-connect", userId] as const;

export function FiruxConnectCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: firuxConnectQuery(userId),
    enabled: Boolean(userId),
    queryFn: () => getFiruxConnectStatus(),
    staleTime: 60_000,
  });
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const view = q.data?.view;
  if (!view || view.state === "disabled") return null;

  const connect = async () => {
    if (!q.data) return;
    setBusy(true);
    const r = await startFiruxConnect({
      data: { acceptTerms: accepted, termsVersion: q.data.termsVersion },
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      toast.error(r?.message ?? "No pudimos abrir Firux. Inténtalo de nuevo.");
      return;
    }
    window.location.assign(r.url);
  };

  const unlink = async () => {
    setBusy(true);
    const r = await disconnectFiruxConnect().catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      toast.error(r?.message ?? "No pudimos desconectar tu cuenta. Inténtalo de nuevo.");
      return;
    }
    toast.success("Listo. Tus próximos pagos llegarán a tu llave Bre-B.");
    void qc.invalidateQueries({ queryKey: firuxConnectQuery(userId) });
  };

  if (view.state === "connected") {
    return (
      <section
        aria-label="Firux Pay"
        className="rounded-3xl border border-biosensor/30 bg-biosensor/5 p-5"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-biosensor text-biosensor-foreground">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold">Firux Pay conectado</p>
            <p className="text-sm text-muted-foreground">
              Las familias te pagan directo a tu cuenta Firux. Humanix solo recibe su comisión.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={unlink} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Unlink className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1">Desconectar</span>
          </Button>
        </div>
      </section>
    );
  }

  const title =
    view.state === "needs_terms"
      ? "Actualizamos la comisión: acéptala para seguir cobrando directo"
      : view.state === "pending"
        ? "Termina de conectar tu cuenta Firux"
        : "Recibe tus pagos directo con Firux Pay";

  return (
    <section aria-label="Conectar con Firux Pay" className="rounded-3xl border bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Link2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-display text-lg font-bold">{title}</p>
            <p className="text-sm text-muted-foreground">
              Conecta tu cuenta Firux una sola vez. Cuando una familia pague por Bre-B, la plata te
              llega al instante y Humanix se queda con su comisión (15 %, 12 % o 10 % según tus
              turnos). Firux cobra 1 % + IVA por cobro (mínimo $500).
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="firux-connect-terms"
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
            />
            <Label htmlFor="firux-connect-terms" className="text-sm leading-snug">
              Acepto que Humanix descuente su comisión de cada turno que cobre por Firux Pay.
            </Label>
          </div>
          <Button onClick={connect} disabled={!accepted || busy} className="w-full sm:w-auto">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Conectar con Firux Pay
          </Button>
        </div>
      </div>
    </section>
  );
}
