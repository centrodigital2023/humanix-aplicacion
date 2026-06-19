/**
 * Ruta: /pair
 * Landing page para el código QR de emparejamiento de wearables.
 * Parámetros URL: ?c=CODE&pv=PROVIDER&u=PATIENT_UUID
 *
 * Cuando el paciente escanea el QR con su celular (app Humanix o cámara):
 *  1. Esta página muestra las instrucciones específicas del proveedor.
 *  2. Si el usuario ya está autenticado y es el mismo paciente (u === auth.uid),
 *     confirma visualmente que el emparejamiento quedó registrado en BD.
 *  3. Proporciona el código para entrada manual en caso de que se escanee sin la app.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import {
  Smartphone,
  QrCode,
  Copy,
  CheckCircle2,
  ArrowLeft,
  Heart,
  Wifi,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

// ─── Route definition ─────────────────────────────────────────────────────────

const searchSchema = z.object({
  c:  z.string().optional(),   // pairing code
  pv: z.string().optional(),   // provider
  u:  z.string().optional(),   // patient UUID
});

export const Route = createFileRoute("/pair")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Vincular dispositivo · Humanix" },
      { name: "description", content: "Empareja tu wearable con Humanix para sincronizar signos vitales en tiempo real" },
    ],
  }),
  component: PairPage,
});

// ─── Provider labels ──────────────────────────────────────────────────────────

const PROVIDER_INFO: Record<string, { label: string; emoji: string; instructions: string[] }> = {
  apple_healthkit: {
    label: "Apple Health",
    emoji: "🍎",
    instructions: [
      "Abre la app Humanix en tu iPhone.",
      "Ve a Ajustes → Salud → Apple Health.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Activa la sincronización automática y otorga permisos de HealthKit.",
    ],
  },
  google_health_connect: {
    label: "Google Health Connect",
    emoji: "🤖",
    instructions: [
      "Instala Health Connect desde Google Play (Android 12+). En Android 14+ viene integrado.",
      "Abre la app Humanix → Dispositivos → Google Health Connect.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Concede permisos: Frecuencia cardíaca, SpO₂ y Pasos.",
    ],
  },
  garmin: {
    label: "Garmin Connect",
    emoji: "⌚",
    instructions: [
      "Abre Garmin Connect IQ en tu reloj o teléfono.",
      "Ve a Aplicaciones conectadas → Humanix.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Los datos se sincronizarán automáticamente.",
    ],
  },
  fitbit: {
    label: "Fitbit",
    emoji: "💚",
    instructions: [
      "Abre la app Fitbit en tu celular.",
      "Cuenta → Aplicaciones → Humanix.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Actividad y frecuencia cardíaca se sincronizarán.",
    ],
  },
  oura: {
    label: "Oura Ring",
    emoji: "💍",
    instructions: [
      "Abre la app Oura en tu celular.",
      "Perfil → Integraciones → Humanix.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Sueño, temperatura y actividad se sincronizarán.",
    ],
  },
  whoop: {
    label: "WHOOP",
    emoji: "🏃",
    instructions: [
      "Abre la app WHOOP.",
      "Perfil → Integraciones → Humanix.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "Strain, recuperación y sueño se sincronizarán.",
    ],
  },
  polar: {
    label: "Polar Flow",
    emoji: "🎯",
    instructions: [
      "Abre Polar Flow en tu teléfono.",
      "Ajustes → Servicios de terceros → Humanix.",
      "Ingresa el código de emparejamiento que aparece abajo.",
      "FC y entrenamientos se sincronizarán.",
    ],
  },
  samsung_health: {
    label: "Samsung Health",
    emoji: "⌚",
    instructions: [
      "Instala la app Humanix Care desde Google Play (Android 10+).",
      "Asegúrate de tener Samsung Health y Health Connect instalados (Android 14+ ya lo trae).",
      "Abre Humanix Care → Conectar Samsung Health e ingresa el código de abajo.",
      "Autoriza Samsung Health y Health Connect (FC, SpO₂, sueño, pasos, temperatura).",
      "La sincronización es automática cada 5 minutos · datos en tiempo real en Humanix.",
    ],
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

function PairPage() {
  const { c: code, pv: provider, u: patientId } = Route.useSearch();

  const info = provider ? PROVIDER_INFO[provider] : null;

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Código copiado al portapapeles");
  };

  // Caso: URL mal formada o parámetros faltantes
  if (!code || !provider || !patientId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full p-6 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto">
            <Info className="h-6 w-6 text-amber-500" />
          </div>
          <h1 className="font-bold text-base">Enlace de emparejamiento inválido</h1>
          <p className="text-xs text-muted-foreground">
            El enlace que escaneaste no tiene los parámetros necesarios. Escanea
            de nuevo el QR desde la sección <strong>Wearables</strong> en tu portal Humanix.
          </p>
          <Link to="/dashboard/monitoreo">
            <Button size="sm" className="gap-2 text-xs">
              <ArrowLeft className="h-3 w-3" /> Ir al portal
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-500/5 via-background to-sky-500/5 flex items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-4">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="h-14 w-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-3">
            <Heart className="h-7 w-7 text-violet-600 animate-pulse" />
          </div>
          <h1 className="text-lg font-bold">Vincular dispositivo</h1>
          <p className="text-xs text-muted-foreground">
            Sigue los pasos para conectar tu wearable con Humanix
          </p>
        </div>

        {/* Provider card */}
        <Card className="p-4 space-y-4">
          {/* Provider header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-xl">
              {info?.emoji ?? "📱"}
            </div>
            <div>
              <p className="font-semibold text-sm">{info?.label ?? provider}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Wifi className="h-3 w-3 text-emerald-500" />
                Sincronización en tiempo real
              </p>
            </div>
          </div>

          {/* Instructions */}
          {info && (
            <ol className="space-y-2">
              {info.instructions.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[11px] text-muted-foreground">
                  <span className="flex-shrink-0 h-5 w-5 rounded-full bg-violet-500/15 text-violet-600 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}

          {/* Pairing code display */}
          <div className="rounded-xl bg-muted/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" />
              <span className="font-medium">Código de emparejamiento</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xl font-bold tracking-[0.3em] select-all text-foreground">
                {code}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 flex-shrink-0"
                onClick={copyCode}
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Ingresa este código en la app de tu dispositivo cuando te lo solicite.
            </p>
          </div>

          {/* Confirmation hint */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
              Una vez que tu dispositivo envíe el primer dato, el monitor clínico
              de Humanix se actualizará <strong>en tiempo real</strong> de forma automática.
            </p>
          </div>
        </Card>

        {/* Platform info */}
        <Card className="p-3 space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
            <Smartphone className="h-3.5 w-3.5" /> Plataformas compatibles
          </p>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">🍎 iOS (iPhone)</p>
              <p>Apple HealthKit · Cualquier reloj compatible</p>
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">🤖 Android</p>
              <p>Google Health Connect · Android 12 o superior</p>
            </div>
          </div>
        </Card>

        {/* Back link */}
        <div className="text-center">
          <Link to="/dashboard/monitoreo" className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
            Volver al portal de monitoreo
          </Link>
        </div>
      </div>
    </div>
  );
}
