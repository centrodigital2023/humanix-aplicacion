import { useEffect, useState } from "react";
import { QRCode } from "react-qr-code";
import { toast } from "sonner";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/seo";

export const APP_DOWNLOAD_URL = `${SITE_URL}/descargar`;
const SHARE_TEXT =
  "Te recomiendo Humanix: enfermería y cuidado en casa con profesionales verificados. Instala la app aquí:";

/** Tarjeta para compartir la app: compartir nativo, WhatsApp, copiar enlace y QR. */
export function ShareAppCard({ className = "" }: { className?: string }) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${APP_DOWNLOAD_URL}`)}`;

  const shareNative = async () => {
    try {
      await navigator.share({ title: "Humanix", text: SHARE_TEXT, url: APP_DOWNLOAD_URL });
    } catch {
      // El usuario cerró el menú de compartir.
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_DOWNLOAD_URL);
      toast.success("Enlace copiado");
    } catch {
      toast.error(`No se pudo copiar. El enlace es ${APP_DOWNLOAD_URL}`);
    }
  };

  return (
    <section className={`rounded-2xl border border-border p-6 ${className}`}>
      <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <Share2 className="h-5 w-5 text-biosensor" /> Comparte la app
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto rounded-xl bg-white p-3">
          <QRCode value={APP_DOWNLOAD_URL} size={140} />
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Envía el enlace a tu familia o a tus colegas. Desde cualquier celular o computador abre
            la página de instalación correcta para su dispositivo.
          </p>
          <p className="break-all font-medium text-foreground">{APP_DOWNLOAD_URL}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" /> Enviar por WhatsApp
              </a>
            </Button>
            {canShare && (
              <Button variant="outline" onClick={shareNative}>
                <Share2 className="h-4 w-4" /> Compartir
              </Button>
            )}
            <Button variant="outline" onClick={copyLink}>
              <Copy className="h-4 w-4" /> Copiar enlace
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
