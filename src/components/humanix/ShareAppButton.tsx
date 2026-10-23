import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const SHARE_URL = "https://humanix.lat/instalar";
const SHARE_TITLE = "Humanix · Cuidado en casa";
const SHARE_TEXT =
  "Te invito a descargar Humanix: cuidado en casa con profesionales de la salud verificados.";

export function ShareAppButton() {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
      } catch {
        // El usuario canceló el diálogo de compartir; no hay nada que hacer.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${SHARE_TEXT} ${SHARE_URL}`);
      setCopied(true);
      toast.success("Enlace copiado: compártelo por WhatsApp o correo");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Copia este enlace: ${SHARE_URL}`);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void share()}>
      {copied ? (
        <Check className="mr-1.5 h-4 w-4" />
      ) : (
        <Share2 className="mr-1.5 h-4 w-4" />
      )}
      <span>Invitar a la app</span>
    </Button>
  );
}
