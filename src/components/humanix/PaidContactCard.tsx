// Tarjeta que expone las opciones de comunicación con la contraparte (cliente
// o profesional) SOLO cuando el servicio ya está pagado/confirmado.
// Wraps RPCs `get_booking_contact` + `get_or_create_booking_conversation`
// para resguardar el teléfono detrás de RLS server-side.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Phone, Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = {
  bookingId: string;
  peerName: string;
  isPaid: boolean;
  amountCOP: number;
};

// E.164 ligero: quita espacios, guiones y paréntesis. Prefija +57 si viene sin
// código de país y el número parece colombiano (10 dígitos iniciando por 3).
function toWhatsAppNumber(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (/^3\d{9}$/.test(cleaned)) return `57${cleaned}`;
  return cleaned;
}

export function PaidContactCard({ bookingId, peerName, isPaid, amountCOP }: Props) {
  const navigate = useNavigate();
  const [openingInbox, setOpeningInbox] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const COP = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amountCOP);

  if (!isPaid) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/70 p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground mb-1">Comunicación bloqueada</p>
        <p>
          Podrás contactar a <span className="font-medium text-foreground">{peerName}</span> por
          WhatsApp o por la bandeja de Humanix cuando el servicio sea aceptado y el pago por{" "}
          <span className="font-semibold">{COP}</span> quede confirmado.
        </p>
      </div>
    );
  }

  const openInbox = async () => {
    setOpeningInbox(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_or_create_booking_conversation" as never,
        {
          _booking_id: bookingId,
        } as never,
      );
      if (error) throw error;
      const convId = typeof data === "string" ? data : (data as { id?: string })?.id;
      if (!convId) throw new Error("No se pudo abrir la conversación");
      navigate({ to: "/mensajes", search: { c: convId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir la bandeja");
    } finally {
      setOpeningInbox(false);
    }
  };

  const openWhatsApp = async () => {
    setRevealing(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_booking_contact" as never,
        {
          _booking_id: bookingId,
        } as never,
      );
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        peer_id: string;
        full_name: string | null;
        phone: string | null;
        avatar_url: string | null;
        is_professional: boolean;
      }>;
      const contact = rows[0];
      if (!contact?.phone) {
        toast.error("La contraparte no registró un número de WhatsApp en su perfil.");
        return;
      }
      const wa = toWhatsAppNumber(contact.phone);
      const greeting = encodeURIComponent(
        `Hola ${contact.full_name ?? peerName}, te contacto desde Humanix por el servicio contratado (ref ${bookingId.slice(0, 8)}).`,
      );
      window.open(`https://wa.me/${wa}?text=${greeting}`, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo obtener el contacto");
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-biosensor/40 bg-biosensor/5 p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-biosensor/15 text-biosensor flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-biosensor font-semibold">
            Contacto habilitado
          </p>
          <p className="font-display text-base font-bold mt-0.5">Comunícate con {peerName}</p>
          <p className="text-xs text-muted-foreground mt-1">
            El pago está confirmado. Usa el chat interno para quedar registro auditable o WhatsApp
            para coordinación inmediata.
          </p>
        </div>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-2">
        <Button
          variant="hero"
          size="sm"
          onClick={openInbox}
          disabled={openingInbox}
          className="justify-center"
        >
          {openingInbox ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          Bandeja Humanix
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openWhatsApp}
          disabled={revealing}
          className="justify-center"
        >
          {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          WhatsApp
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Button>
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Toda apertura del canal queda registrada por Habeas Data (Ley 1581). No compartas
        información de salud fuera de Humanix.
      </p>
    </div>
  );
}
