import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Apple,
  CheckCircle2,
  Download,
  Monitor,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
} from "lucide-react";
import { ContentPage } from "@/components/humanix/ContentPage";
import { ShareAppCard } from "@/components/humanix/ShareAppCard";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";

/** Enlace estable: siempre apunta al último APK publicado por el workflow `android-apk.yml`. */
const APK_URL =
  "https://github.com/centrodigital2023/humanix-aplicacion/releases/latest/download/humanix.apk";
const LATEST_RELEASE_API =
  "https://api.github.com/repos/centrodigital2023/humanix-aplicacion/releases/latest";

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

/** El botón de APK solo aparece cuando ya hay una APK publicada (evita enlaces rotos). */
async function apkIsPublished(): Promise<boolean> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return false;
    const release = (await res.json()) as { assets?: { name: string }[] };
    return Boolean(release.assets?.some((a) => a.name === "humanix.apk"));
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/descargar")({
  head: () =>
    buildSeo({
      title: "Descargar la app · Android, iPhone y computador",
      path: "/descargar",
      description:
        "Instala la app de Humanix en un clic en Android, iPhone o computador y compártela por WhatsApp.",
    }),
  component: DescargarPage,
});

function DescargarPage() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hasApk, setHasApk] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    void apkIsPublished().then(setHasApk);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
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

  const highlight = (p: Platform) =>
    platform === p ? "border-biosensor/50 bg-biosensor/5" : "border-border";

  return (
    <ContentPage
      icon={Download}
      badge="App Humanix"
      title={
        <>
          Lleva Humanix <span className="text-gradient-bio">en tu bolsillo</span>
        </>
      }
      description="Instálala gratis en un clic, sin tiendas, en Android, iPhone o computador. Y compártela con quien la necesite."
    >
      <div className="space-y-8">
        {installed ? (
          <p className="flex items-center gap-2 rounded-xl border border-biosensor/30 bg-biosensor/10 p-4 text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 text-biosensor" /> Ya tienes Humanix instalada en este
            dispositivo.
          </p>
        ) : (
          installEvent && (
            <div className="rounded-2xl border border-biosensor/50 bg-biosensor/5 p-6 text-center">
              <p className="text-sm text-muted-foreground">Tu dispositivo permite instalarla ya:</p>
              <Button size="lg" className="mt-3 w-full sm:w-auto" onClick={installPwa}>
                <Download className="h-4 w-4" /> Instalar Humanix
              </Button>
            </div>
          )
        )}

        <section className={`rounded-2xl border p-6 ${highlight("android")}`}>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Smartphone className="h-5 w-5 text-biosensor" /> Android
          </h2>
          {hasApk && (
            <>
              <Button
                asChild
                size="lg"
                variant={installEvent ? "outline" : "default"}
                className="mt-4 w-full sm:w-auto"
              >
                <a href={APK_URL} download>
                  <Download className="h-4 w-4" /> Descargar APK
                </a>
              </Button>
              <p className="mt-3 text-sm text-muted-foreground">
                Abre el archivo humanix.apk descargado y toca "Instalar". Si Android lo pide,
                permite "Instalar apps desconocidas" para tu navegador.
              </p>
            </>
          )}
          <p className="mt-4 text-sm font-medium text-foreground">
            {hasApk ? "O instálala desde Chrome:" : "Instálala desde Chrome en dos toques:"}
          </p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Toca el menú <MoreVertical className="inline h-4 w-4 align-text-bottom" /> de Chrome.
            </li>
            <li>Elige "Instalar app" o "Agregar a pantalla principal".</li>
          </ol>
        </section>

        <section className={`rounded-2xl border p-6 ${highlight("ios")}`}>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Apple className="h-5 w-5 text-biosensor" /> iPhone y iPad
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Abre humanix.lat/descargar en Safari.</li>
            <li>
              Toca Compartir <Share className="inline h-4 w-4 align-text-bottom" />.
            </li>
            <li>
              Elige "Agregar a pantalla de inicio"{" "}
              <PlusSquare className="inline h-4 w-4 align-text-bottom" /> y toca "Agregar".
            </li>
          </ol>
        </section>

        <section className={`rounded-2xl border p-6 ${highlight("desktop")}`}>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Monitor className="h-5 w-5 text-biosensor" /> Computador
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            En Chrome o Edge, toca el ícono de instalar en la barra de direcciones. Para el celular,
            escanea el código QR de abajo con la cámara.
          </p>
        </section>

        <ShareAppCard />
      </div>
    </ContentPage>
  );
}
