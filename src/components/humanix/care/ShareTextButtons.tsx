// Compartir un texto ya redactado (con su enlace) por WhatsApp o copiándolo. No se paga ni se cobra nada aquí.
import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ShareTextButtons({
  text,
  whatsappLabel = "WhatsApp",
  className,
}: {
  text: string;
  whatsappLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Mensaje copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div className={className ?? "flex flex-wrap gap-2"}>
      <Button asChild size="sm" variant="outline" className="gap-1.5">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> {whatsappLabel}
        </a>
      </Button>
      <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={copy}>
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Copiar mensaje
      </Button>
    </div>
  );
}
