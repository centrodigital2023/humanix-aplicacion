// SOS Familiar: botón de pánico que registra una alerta crítica con la ubicación y avisa DENTRO de la app al círculo de cuidado, al
// profesional con servicio vigente y a quien contrató (lo hace la base: migración 20261012160000_sos_familiar.sql).
//
// Lo que promete es lo que de verdad ocurre: la pantalla dice a cuántas personas se avisó en la app (lo cuenta la base) y deja el
// WhatsApp a mano —con el mensaje y la ubicación ya escritos— porque el aviso automático por WhatsApp solo existe si el proyecto
// tiene pg_net, el secreto de Vault y los secretos de la función. Y siempre, a un toque, la línea de emergencias 123.
import { useState } from "react";
import { Siren, Loader2, MapPin, Phone, MessageCircle, UserPlus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendSos, useEmergencyContact, type SosSendResult } from "@/hooks/use-sos";
import {
  EMERGENCY_NUMBER,
  EMERGENCY_TEL,
  normalizeCoPhone,
  sosOutcome,
  sosWhatsappText,
  whatsappLink,
} from "@/lib/sos";

export function SosFamiliarButton({
  patientId,
  bookingId,
  patientName,
  className = "",
  label = "SOS Familiar",
}: {
  /** A quién se le pide ayuda (uno mismo, o su paciente si lo pulsa su profesional o su círculo). */
  patientId: string;
  /** Reserva en curso, si la hay: así el aviso llega también a la otra parte del servicio. */
  bookingId?: string | null;
  patientName?: string | null;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SosSendResult | null>(null);
  const contact = useEmergencyContact(patientId, open);

  const trigger = async () => {
    setBusy(true);
    try {
      setResult(await sendSos({ patientId, bookingId }));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setResult(null);
  };

  const emergencyPhone = contact.data?.phone ?? null;
  const hasContact = !!normalizeCoPhone(emergencyPhone);
  const outcome = result
    ? sosOutcome({
        status: result.status,
        inappNotified: result.inappNotified,
        whatsappAuto: result.whatsappAuto,
        hasLocation: result.place.lat != null,
        hasEmergencyContact: hasContact,
      })
    : null;
  const waText = sosWhatsappText({
    name: patientName ?? contact.data?.patientName,
    lat: result?.place.lat,
    lng: result?.place.lng,
  });

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className={`gap-2 font-semibold animate-pulse ${className}`}
      >
        <Siren className="h-4 w-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent className="max-w-sm border-destructive/40">
          <DialogHeader>
            <div className="h-12 w-12 rounded-2xl bg-destructive/15 text-destructive inline-flex items-center justify-center">
              <Siren className="h-6 w-6" />
            </div>
            <DialogTitle className="font-display text-xl">
              {outcome ? outcome.headline : "¿Pedir ayuda ahora?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground" aria-live="polite">
                {outcome ? (
                  <ul className="space-y-1.5">
                    {outcome.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Registramos tu <strong>ubicación</strong> y una alerta crítica, y avisamos
                    dentro de Humanix a tu círculo de cuidado y a tu profesional. Úsalo solo si
                    necesitas ayuda urgente.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {!result && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              Compartiremos tu ubicación GPS si tu dispositivo lo permite.
            </p>
          )}

          <div className="space-y-2">
            {/* Siempre a la mano: es lo más rápido ante una urgencia. */}
            <Button
              asChild
              variant={outcome?.callFirst || !result ? "destructive" : "outline"}
              className="w-full gap-2"
            >
              <a href={EMERGENCY_TEL}>
                <Phone className="h-4 w-4" />
                Llamar al {EMERGENCY_NUMBER}
              </a>
            </Button>

            {result && (
              <>
                {hasContact ? (
                  <Button asChild variant="outline" className="w-full gap-2">
                    <a
                      href={whatsappLink(emergencyPhone, waText)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Avisar por WhatsApp a {contact.data?.name || "mi contacto"}
                    </a>
                  </Button>
                ) : (
                  <>
                    <Button asChild variant="outline" className="w-full gap-2">
                      <a
                        href={whatsappLink(null, waText)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-4 w-4" />
                        Elegir a quién avisar por WhatsApp
                      </a>
                    </Button>
                    <Link
                      to="/dashboard/familia/onboarding"
                      search={{ step: undefined }}
                      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Guarda un contacto de emergencia para la próxima vez
                    </Link>
                  </>
                )}
              </>
            )}

            {!result ? (
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={close} disabled={busy}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 gap-2"
                  onClick={trigger}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Siren className="h-4 w-4" />
                  )}
                  Enviar SOS ahora
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="w-full" onClick={close}>
                Cerrar
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
