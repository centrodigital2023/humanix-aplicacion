import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { instKeys } from "@/hooks/use-institution-hub";
import { classifyHubError, whatsAppLink, type ServerError } from "@/lib/opportunities";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";

const sb = supabase as unknown as SupabaseClient;

interface Contact {
  counterpart_name: string | null;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
  access_notes: string | null;
  city: string | null;
  reveals_left: number;
}

interface Props {
  applicationId: string;
  userId: string;
  plan: PlanKey;
  institutionName: string;
  /** Resumen del turno para el primer mensaje de WhatsApp. */
  shiftHint?: string;
  proName: string | null;
  accepted: boolean;
}

const contactKey = (applicationId: string) => ["inst", "contact", applicationId] as const;

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.error("No se pudo copiar");
  }
}

/**
 * Dirección exacta y WhatsApp de la institución: solo con plan de pago y tras postularse. Cada desbloqueo
 * queda auditado y la institución recibe un aviso. Los pagos no se coordinan por aquí.
 */
export function OfferContactPanel({
  applicationId,
  userId,
  plan,
  institutionName,
  shiftHint,
  proName,
  accepted,
}: Props) {
  const qc = useQueryClient();
  const [contact, setContact] = useState<Contact | null>(
    () => qc.getQueryData<Contact>(contactKey(applicationId)) ?? null,
  );

  const reveal = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("reveal_offer_contact", {
        p_application_id: applicationId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Contact | undefined;
      if (!row) throw new Error("No se pudo obtener el contacto");
      return row;
    },
    onSuccess: (row) => {
      qc.setQueryData(contactKey(applicationId), row);
      setContact(row);
      void qc.invalidateQueries({ queryKey: instKeys.myApps(userId) });
      toast.success("Contacto desbloqueado", {
        description: "Quedó registrado y la institución fue notificada.",
      });
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  if (plan === "free") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-start gap-2 text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="text-foreground">Contacto y WhatsApp de {institutionName}</strong> se
            desbloquean con el plan Esencial ({PLAN_CATALOG.essential_monthly.priceLabel}
            {PLAN_CATALOG.essential_monthly.priceNote}), que además no cobra comisión.
            {accepted ? " La dirección del servicio ya está en tu reserva." : ""}
          </span>
        </p>
        <Button asChild size="sm" variant="hero">
          <Link to="/planes">Ver planes</Link>
        </Button>
      </div>
    );
  }

  if (contact) {
    const first = (proName ?? "").trim().split(/\s+/)[0] || "un profesional";
    const message = [
      `Hola, soy ${first} de Humanix.`,
      shiftHint ? `Te escribo por ${shiftHint}.` : "Te escribo por el turno publicado.",
      "¿Podemos coordinar los detalles?",
      "Recuerda que los pagos se gestionan únicamente en la página web de Humanix.",
    ].join(" ");
    const wa = whatsAppLink(contact.whatsapp ?? contact.phone, message);
    const maps = contact.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${contact.address} ${contact.city ?? ""}`.trim(),
        )}`
      : null;
    return (
      <div className="space-y-2 rounded-lg border border-ok/40 bg-ok/5 p-3 text-sm">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Contacto desbloqueado
        </p>
        <p className="font-medium">{contact.counterpart_name ?? institutionName}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
            {contact.address ?? "La institución aún no registró una dirección"}
          </span>
          {contact.address && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copy(contact.address!, "Dirección")}
              >
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copiar
              </Button>
              {maps && (
                <Button asChild size="sm" variant="ghost">
                  <a href={maps} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden /> Cómo llegar
                  </a>
                </Button>
              )}
            </>
          )}
        </div>
        {contact.access_notes && (
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <strong className="text-foreground">Cómo ingresar:</strong> {contact.access_notes}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {wa ? (
            <Button asChild size="sm" variant="hero">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden /> Escribir por WhatsApp
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              La institución no registró un número.
            </span>
          )}
          {contact.phone && (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
                <Phone className="mr-1.5 h-4 w-4" aria-hidden /> Llamar
              </a>
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Te quedan {contact.reveals_left} desbloqueos hoy. Coordina aquí los detalles del servicio:
          los pagos se gestionan únicamente en la página web de Humanix.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        Ver dirección, WhatsApp y cómo ingresar a {institutionName}. Queda registrado y la
        institución recibe un aviso.
      </p>
      <Button size="sm" variant="hero" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
        {reveal.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
        Ver dirección y WhatsApp
      </Button>
    </div>
  );
}
