import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { QRCode } from "react-qr-code";
import { Apple, Download, Monitor, Share, Smartphone, PlusSquare } from "lucide-react";
import { ContentPage } from "@/components/humanix/ContentPage";
import { Button } from "@/components/ui/button";
import { buildSeo, SITE_URL } from "@/lib/seo";

/** Enlace estable: siempre apunta al último APK publicado por el workflow `android-apk.yml`. */
const APK_URL =
  "https://github.com/centrodigital2023/humanix-aplicacion/releases/latest/download/humanix.apk";
const PAGE_URL = `${SITE_URL}/descargar`;

type Platform = "android" | "ios" | "desktop";

/** Evento no estándar de Chrome/Edge para instalar la PWA. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ se presenta como Mac con pantalla táctil.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  return "desktop";
}

export const Route = createFileRoute("/descargar")({
  head: () =>
    buildSeo({
      title: "Descargar la app · Android, iPhone y computador",
      path: "/descargar",
      description:
        "Descarga la app de Humanix: APK para Android, instalación en iPhone y acceso desde cualquier computador.",
    }),
  component: DescargarPage,
});

function DescargarPage() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installPwa = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <ContentPage
      icon={Download}
      badge="App Humanix"
      title={
        <>
          Lleva Humanix <span className="text-gradient-bio">en tu bolsillo</span>
        </>
      }
      description="Disponible para Android (APK), iPhone y cualquier computador. Elige tu dispositivo y sigue los pasos."
    >
      <div className="space-y-10">
        {installed && (
          <p className="rounded-xl border border-biosensor/30 bg-biosensor/10 p-4 text-sm text-foreground">
            Ya estás usando Humanix como app instalada en este dispositivo.
          </p>
        )}

        <AndroidSection highlight={platform === "android"} />

        <IosSection highlight={platform === "ios"} />

        <section
          className={`rounded-2xl border p-6 ${platform === "desktop" ? "border-biosensor/50 bg-biosensor/5" : "border-border"}`}
        >
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Monitor className="h-5 w-5 text-biosensor" /> Computador
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="mx-auto rounded-xl bg-white p-3">
              <QRCode value={PAGE_URL} size={148} />
            </div>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Escanea el código con la cámara de tu celular para abrir esta página y descargar la
                app allí.
              </p>
              <p>
                También puedes descargar el APK aquí y pasarlo a tu Android por cable, correo o
                WhatsApp.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a href={APK_URL} download>
                    <Download className="h-4 w-4" /> Descargar APK
                  </a>
                </Button>
                {installEvent && (
                  <Button onClick={installPwa}>
                    <PlusSquare className="h-4 w-4" /> Instalar en este computador
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </ContentPage>
  );
}

function AndroidSection({ highlight }: { highlight: boolean }) {
  return (
    <section
      className={`rounded-2xl border p-6 ${highlight ? "border-biosensor/50 bg-biosensor/5" : "border-border"}`}
    >
      <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <Smartphone className="h-5 w-5 text-biosensor" /> Android
      </h2>
      <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
        <a href={APK_URL} download>
          <Download className="h-4 w-4" /> Descargar APK de Humanix
        </a>
      </Button>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Toca "Descargar APK" y espera a que termine la descarga.</li>
        <li>Abre el archivo humanix.apk desde la notificación o desde la carpeta Descargas.</li>
        <li>
          Si Android lo pide, permite "Instalar apps desconocidas" para tu navegador (solo esta
          vez).
        </li>
        <li>Toca "Instalar" y luego "Abrir". ¡Listo!</li>
      </ol>
    </section>
  );
}

function IosSection({ highlight }: { highlight: boolean }) {
  return (
    <section
      className={`rounded-2xl border p-6 ${highlight ? "border-biosensor/50 bg-biosensor/5" : "border-border"}`}
    >
      <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <Apple className="h-5 w-5 text-biosensor" /> iPhone y iPad
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Apple no permite instalar archivos APK. Instala Humanix directo desde Safari, sin tienda y
        con su propio ícono:
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Abre humanix.lat/descargar en Safari.</li>
        <li>
          Toca el botón Compartir <Share className="inline h-4 w-4 align-text-bottom" />.
        </li>
        <li>
          Elige "Agregar a pantalla de inicio"{" "}
          <PlusSquare className="inline h-4 w-4 align-text-bottom" /> y toca "Agregar".
        </li>
      </ol>
    </section>
  );
}
