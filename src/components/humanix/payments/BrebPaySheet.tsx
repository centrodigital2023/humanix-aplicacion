// Hoja de pago con Bre-B (Firux). Una sola pantalla, pensada para el celular:
//   1. Un botón grande «Abrir mi banco» (enlace de pago de Firux) — en el celular es todo lo que hay que hacer.
//   2. El QR, para pagar desde otro teléfono o desde el computador.
//   3. El estado en vivo (Realtime sobre `firux_charges`): apenas llega el aviso firmado, la hoja celebra.
// El monto lo pone siempre el servidor; aquí solo se muestra.
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { CHARGE_ERROR_MESSAGE, type ChargeResult, type ChargeView } from "@/lib/firux";
import { COP } from "@/lib/commissionMatrix";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; charge: ChargeView }
  | { kind: "paid"; charge: ChargeView }
  | { kind: "expired"; charge: ChargeView }
  | { kind: "error"; message: string };

export interface BrebPaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Pagar turno», «Recargar billetera»… */
  title: string;
  /** Una línea con lo que se paga («Turno del martes con Laura»). */
  subtitle?: string;
  /** Pide el cobro al servidor (nunca se manda el monto desde aquí). */
  start: () => Promise<ChargeResult>;
  /** Texto de la celebración. */
  paidMessage?: string;
  onPaid?: () => void;
}

export function BrebPaySheet({
  open,
  onOpenChange,
  title,
  subtitle,
  start,
  paidMessage,
  onPaid,
}: BrebPaySheetProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [showQr, setShowQr] = useState(false);
  const startRef = useRef(start);
  startRef.current = start;
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const r = await startRef.current();
      if (r.ok)
        setPhase(
          r.charge.status === "paid"
            ? { kind: "paid", charge: r.charge }
            : { kind: "ready", charge: r.charge },
        );
      else setPhase({ kind: "error", message: CHARGE_ERROR_MESSAGE[r.code] });
    } catch {
      setPhase({ kind: "error", message: CHARGE_ERROR_MESSAGE.provider_error });
    }
  }, []);

  useEffect(() => {
    if (open) {
      setShowQr(false);
      void load();
    }
  }, [open, load]);

  const chargeId = phase.kind === "ready" ? phase.charge.chargeId : null;

  // Estado en vivo del cobro: el aviso de Firux lo marca pagado y aquí se ve al instante.
  useEffect(() => {
    if (!chargeId) return;
    const channel = supabase
      .channel(`firux_charge:${chargeId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "firux_charges", filter: `id=eq.${chargeId}` },
        (payload) => {
          const status = String((payload.new as { status?: string }).status ?? "");
          setPhase((p) => {
            if (p.kind !== "ready") return p;
            if (status === "paid") return { kind: "paid", charge: { ...p.charge, status } };
            if (status === "expired" || status === "failed" || status === "underpaid")
              return { kind: "expired", charge: { ...p.charge, status } };
            return p;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chargeId]);

  useEffect(() => {
    if (phase.kind === "paid") onPaidRef.current?.();
  }, [phase.kind]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Código copiado. Pégalo en la opción «Pagar con código» de tu banco.");
    } catch {
      toast.error("No pudimos copiar. Usa el QR o el botón de tu banco.");
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader className="text-center">
          <DrawerTitle className="font-display text-2xl">{title}</DrawerTitle>
          {subtitle && <DrawerDescription className="text-base">{subtitle}</DrawerDescription>}
        </DrawerHeader>

        <div className="px-5 pb-8" aria-live="polite">
          {phase.kind === "loading" && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-biosensor" aria-hidden="true" />
              <p>Preparando tu pago seguro…</p>
            </div>
          )}

          {phase.kind === "error" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-base">{phase.message}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cerrar
                </Button>
                <Button onClick={() => void load()}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Intentar de nuevo
                </Button>
              </div>
            </div>
          )}

          {phase.kind === "paid" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center animate-in fade-in zoom-in-95">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-biosensor/15">
                <CheckCircle2 className="h-12 w-12 text-biosensor" aria-hidden="true" />
              </div>
              <p className="font-display text-2xl font-bold">¡Listo, pago recibido! 💚</p>
              <p className="text-muted-foreground">
                {paidMessage ?? "Te llegará la confirmación en tus notificaciones."}
              </p>
              <Button size="lg" className="mt-2 w-full" onClick={() => onOpenChange(false)}>
                Perfecto
              </Button>
            </div>
          )}

          {(phase.kind === "ready" || phase.kind === "expired") && (
            <div className="space-y-4">
              <div className="rounded-3xl bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">Vas a pagar</p>
                <p className="font-display text-4xl font-bold tracking-tight">
                  {COP(phase.charge.amountCop)}
                </p>
              </div>

              {phase.kind === "expired" ? (
                <div className="space-y-3 text-center">
                  <p>Este enlace de pago venció. Generemos uno nuevo, toma un segundo.</p>
                  <Button size="lg" className="w-full" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" /> Generar un código
                    nuevo
                  </Button>
                </div>
              ) : (
                <>
                  {phase.charge.paymentUrl && (
                    <Button asChild size="lg" className="h-16 w-full rounded-2xl text-lg font-bold">
                      <a href={phase.charge.paymentUrl} target="_blank" rel="noopener noreferrer">
                        <Landmark className="mr-2 h-6 w-6" aria-hidden="true" /> Pagar ahora
                      </a>
                    </Button>
                  )}

                  {phase.charge.qrEmv && (phase.charge.paymentUrl ? showQr : true) ? (
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-background p-4">
                      <div className="rounded-2xl bg-white p-3">
                        <QRCode
                          value={phase.charge.qrEmv}
                          size={196}
                          aria-label="Código QR Bre-B para pagar"
                        />
                      </div>
                      <p className="text-center text-sm text-muted-foreground">
                        Abre la app de tu banco, Nequi o Daviplata → <strong>Pagar con QR</strong> →
                        escanea.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void copy(phase.charge.qrEmv!)}
                      >
                        <Copy className="mr-2 h-4 w-4" aria-hidden="true" /> Copiar código
                      </Button>
                    </div>
                  ) : (
                    phase.charge.qrEmv && (
                      <Button
                        variant="outline"
                        size="lg"
                        className="w-full rounded-2xl"
                        onClick={() => setShowQr(true)}
                      >
                        <QrCode className="mr-2 h-5 w-5" aria-hidden="true" /> Pagar con QR desde
                        otro celular
                      </Button>
                    )
                  )}

                  <div className="flex items-center justify-center gap-2 rounded-2xl bg-biosensor/10 px-4 py-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-biosensor" aria-hidden="true" />
                    <span>Esperando tu pago… esta pantalla se actualiza sola.</span>
                  </div>
                </>
              )}

              <ul className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-biosensor" aria-hidden="true" /> Pago seguro
                  con Wompi
                </li>
                <li className="flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-biosensor" aria-hidden="true" /> PSE,
                  tarjeta, Nequi o Bancolombia
                </li>
              </ul>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
