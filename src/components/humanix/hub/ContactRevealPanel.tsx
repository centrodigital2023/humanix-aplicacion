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
import { hubKeys } from "@/hooks/use-opportunity-feed";
import {
  buildFamilyOutreachMessage,
  canRevealContact,
  classifyHubError,
  whatsAppLink,
  type ServerError,
  type Shift,
} from "@/lib/opportunities";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";

const sb = supabase as unknown as SupabaseClient;

interface Contact {
  full_name: string | null;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  reveals_left: number;
}

interface Props {
  shift: Shift;
  userId: string;
  plan: PlanKey;
  hasApplied: boolean;
  proName: string | null;
  /** Familias cuyo contacto ya se desbloqueó hoy (cupo diario). */
  revealedToday: Set<string>;
}

const contactKey = (familyId: string) => ["hub", "contact", familyId] as const;

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.error("No se pudo copiar");
  }
}

/**
 * Dirección y WhatsApp de la familia: solo con plan de pago, tras postularse y dentro del cupo diario.
 * Cada desbloqueo queda auditado y la familia recibe un aviso. Los pagos no se coordinan por aquí.
 */
export function ContactRevealPanel({
  shift,
  userId,
  plan,
  hasApplied,
  proName,
  revealedToday,
}: Props) {
  const qc = useQueryClient();
  const [contact, setContact] = useState<Contact | null>(
    () => qc.getQueryData<Contact>(contactKey(shift.family_user_id)) ?? null,
  );
  const alreadyToday = revealedToday.has(shift.family_user_id);
  const gate = canRevealContact({
    plan,
    hasApplied,
    revealsToday: alreadyToday ? Math.max(0, revealedToday.size - 1) : revealedToday.size,
  });

  const reveal = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("reveal_opportunity_contact", {
        p_need_id: shift.need_ids[0],
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Contact | undefined;
      if (!row) throw new Error("No se pudo obtener el contacto");
      return row;
    },
    onSuccess: (row) => {
      qc.setQueryData(contactKey(shift.family_user_id), row);
      setContact(row);
      void qc.invalidateQueries({ queryKey: hubKeys.reveals(userId) });
      toast.success("Contacto desbloqueado", {
        description: "Quedó registrado y la familia fue notificada.",
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
            <strong className="text-foreground">Dirección y WhatsApp de la familia</strong> se
            desbloquean con el plan Esencial ({PLAN_CATALOG.essential_monthly.priceLabel}
            {PLAN_CATALOG.essential_monthly.priceNote}), que además no cobra comisión.
          </span>
        </p>
        <Button asChild size="sm" variant="hero">
          <Link to="/planes">Ver planes</Link>
        </Button>
      </div>
    );
  }

  if (contact) {
    const message = buildFamilyOutreachMessage({
      familyName: contact.full_name,
      proName,
      shift,
    });
    const wa = whatsAppLink(contact.whatsapp, message);
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
        <p className="font-medium">{contact.full_name ?? "Familia"}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
            {contact.address ?? "La familia aún no registró una dirección"}
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

        <div className="flex flex-wrap items-center gap-2">
          {wa ? (
            <Button asChild size="sm" variant="hero">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden /> Escribir por WhatsApp
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">La familia no registró WhatsApp.</span>
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

  if (!hasApplied) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Postúlate al turno para poder desbloquear la dirección y el WhatsApp de la familia.
      </p>
    );
  }

  const blocked = !gate.allowed && !alreadyToday;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        {blocked
          ? "Alcanzaste el límite diario de contactos desbloqueados. Mañana se renueva."
          : `Ver dirección y WhatsApp de la familia. Te quedan ${gate.remaining} desbloqueos hoy.`}
      </p>
      <Button
        size="sm"
        variant="hero"
        disabled={blocked || reveal.isPending}
        onClick={() => reveal.mutate()}
      >
        {reveal.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
        Ver dirección y WhatsApp
      </Button>
    </div>
  );
}
