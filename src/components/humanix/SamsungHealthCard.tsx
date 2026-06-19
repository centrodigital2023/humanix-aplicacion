/**
 * SamsungHealthCard — Integración Samsung Health para Monitoreo Clínico Humanix
 *
 * Arquitectura:
 *   Galaxy Watch → Samsung Health → Health Connect → App Humanix Care (Android)
 *   → API Humanix SaaS (wearable_connections + vital_signs_readings)
 *
 * Flujo de vinculación:
 *  1. Usuario pulsa "Vincular".
 *  2. Se genera código y upsert en wearable_connections (provider=samsung_health).
 *  3. Se muestra un QR que codifica /pair?c=CODE&pv=samsung_health&u=PATIENT_ID.
 *  4. La app Humanix Care en Android lo escanea, autoriza Samsung Health +
 *     Health Connect y empieza a enviar vitales vía /wearable-ingest.
 *  5. Realtime detecta el primer INSERT en vital_signs_readings y marca
 *     "Vinculado" + última sincronización.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Droplet,
  Footprints,
  Heart,
  Info,
  Loader2,
  Moon,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Thermometer,
  Unlink,
  Wifi,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";

const PROVIDER = "samsung_health" as const;

const VITAL_SIGNS = [
  { icon: Heart, label: "Frecuencia cardíaca", color: "text-rose-500" },
  { icon: Droplet, label: "Saturación O₂ (SpO₂)", color: "text-sky-500" },
  { icon: Thermometer, label: "Temperatura", color: "text-amber-500" },
  { icon: Activity, label: "Presión arterial", color: "text-red-500" },
  { icon: Droplet, label: "Glucosa", color: "text-fuchsia-500" },
  { icon: Moon, label: "Calidad del sueño", color: "text-indigo-500" },
  { icon: Footprints, label: "Actividad física", color: "text-emerald-500" },
];

const STEPS: string[] = [
  "Escanea el QR con tu celular Android",
  "Instala la app Humanix Care (Play Store)",
  "Autoriza Samsung Health + Health Connect",
  "Sincronización automática · cada 5 min",
];

// Modelos Samsung compatibles vía Health Connect
const COMPATIBLE_DEVICES = [
  "Galaxy Watch 4 / 5 / 6 / 7 / Ultra",
  "Galaxy Ring",
  "Galaxy Fit 3",
  "Galaxy S / Note / Z (Android 10+)",
];

interface SamsungConnection {
  code: string;
  pairedAt: string;
  lastSyncAt: string | null;
  syncing: boolean;
}

function genCode(patientId: string): string {
  const seed = `${patientId}:${PROVIDER}:${Date.now()}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
    h >>>= 0;
  }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  let n = h;
  for (let i = 0; i < 8; i++) {
    code += chars[n % chars.length];
    n = (n >>> 5) || ((h >> i) & 0xff);
  }
  return code;
}

function buildPairingUrl(code: string, patientId: string): string {
  const base =
    typeof window !== "undefined" ? window.location.origin : "https://humanix.lat";
  const params = new URLSearchParams({ c: code, pv: PROVIDER, u: patientId });
  return `${base}/pair?${params.toString()}`;
}

function QrFullscreen({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <QRCode value={url} size={300} bgColor="#ffffff" fgColor="#0f0a2e" level="H" />
      </div>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

export function SamsungHealthCard({ patientId }: { patientId: string }) {
  const [conn, setConn] = useState<SamsungConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Cargar conexión existente
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("wearable_connections")
          .select("external_user_id, status, last_synced_at, connected_at")
          .eq("patient_id", patientId)
          .eq("provider", PROVIDER)
          .eq("status", "active")
          .maybeSingle();
        if (cancelled) return;
        if (!error && data) {
          setConn({
            code: data.external_user_id,
            pairedAt: data.connected_at,
            lastSyncAt: data.last_synced_at,
            syncing: false,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Realtime: detectar primer vital
  useEffect(() => {
    if (!qrOpen || !patientId) return;
    const suffix = Math.random().toString(36).slice(2, 8);
    const channel = supabase
      .channel(`samsung-pair-${patientId}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "vital_signs_readings",
          filter: `family_user_id=eq.${patientId}`,
        },
        (payload) => {
          const row = payload.new as { source?: string };
          if (row.source && row.source !== "manual") {
            setConn((prev) =>
              prev
                ? { ...prev, lastSyncAt: new Date().toISOString(), syncing: true }
                : prev,
            );
            toast.success("¡Samsung Health conectado!", {
              description: "Galaxy Watch enviando datos en tiempo real",
              duration: 6000,
            });
            setTimeout(() => setQrOpen(false), 2500);
          }
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [qrOpen, patientId]);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const code = genCode(patientId);
      const { error } = await (supabase as any)
        .from("wearable_connections")
        .upsert(
          {
            patient_id: patientId,
            provider: PROVIDER,
            external_user_id: code,
            status: "active",
          },
          { onConflict: "patient_id,provider" },
        );
      if (error) {
        toast.error("No se pudo iniciar la vinculación. Intenta de nuevo.");
        return;
      }
      setConn({
        code,
        pairedAt: new Date().toISOString(),
        lastSyncAt: null,
        syncing: false,
      });
      setQrOpen(true);
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await (supabase as any)
        .from("wearable_connections")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("patient_id", patientId)
        .eq("provider", PROVIDER);
      setConn(null);
      setQrOpen(false);
      toast.success("Samsung Health desvinculado");
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const renew = useCallback(async () => {
    if (!conn) return;
    const code = genCode(patientId);
    const { error } = await (supabase as any)
      .from("wearable_connections")
      .update({ external_user_id: code, updated_at: new Date().toISOString() })
      .eq("patient_id", patientId)
      .eq("provider", PROVIDER);
    if (error) {
      toast.error("No se pudo renovar el código");
      return;
    }
    setConn({ ...conn, code, syncing: false });
    toast.success("Código renovado");
  }, [conn, patientId]);

  // Demo: simula la primera lectura para validar el flujo en tiempo real
  // (útil para probar la integración antes de instalar Humanix Care).
  const simulate = useCallback(async () => {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const samples = [
        { reading_type: "heart_rate", value: 72, unit: "bpm" },
        { reading_type: "spo2", value: 98, unit: "%" },
        { reading_type: "steps", value: 8450, unit: "steps" },
      ];
      const { error } = await (supabase as any)
        .from("vital_signs_readings")
        .insert(
          samples.map((s) => ({
            family_user_id: patientId,
            recorded_by: patientId,
            ...s,
            source: "wearable",
            severity: "normal",
            recorded_at: now,
          })),
        );
      if (error) {
        toast.error("No se pudo simular la sincronización", {
          description: error.message,
        });
        return;
      }
      await (supabase as any)
        .from("wearable_connections")
        .update({
          last_synced_at: now,
          device_name: "Galaxy Watch (demo)",
          updated_at: now,
        })
        .eq("patient_id", patientId)
        .eq("provider", PROVIDER);
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const isActive = !!conn;
  const isSyncing = !!conn?.syncing;
  const url = conn ? buildPairingUrl(conn.code, patientId) : "";

  return (
    <>
      {/* QR Modal */}
      {qrOpen && conn && (
        <>
          {fullscreen && (
            <QrFullscreen url={url} onClose={() => setFullscreen(false)} />
          )}
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="relative bg-background border border-border rounded-2xl shadow-2xl max-w-sm w-full overflow-y-auto max-h-[92vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-5 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white font-bold text-xs">
                    S
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Samsung Health</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Galaxy Watch → Health Connect → Humanix
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setQrOpen(false)}
                  className="rounded-lg p-1.5 hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Pasos */}
              <ol className="px-5 space-y-2 pb-3">
                {STEPS.map((step, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 text-[11px] text-muted-foreground"
                  >
                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-blue-500/15 text-blue-600 text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              {/* QR */}
              <div className="px-5 pb-3">
                <button
                  onClick={() => setFullscreen(true)}
                  className="w-full rounded-2xl border-4 border-blue-500/20 bg-white p-4 shadow-inner flex items-center justify-center hover:border-blue-500/50 focus:outline-none"
                >
                  <QRCode
                    value={url}
                    size={200}
                    bgColor="#ffffff"
                    fgColor="#0f0a2e"
                    level="H"
                  />
                </button>
                <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
                  <ScanLine className="h-3 w-3 text-blue-500" />
                  <span>Apunta la cámara al código</span>
                  <span className="text-blue-500 font-medium inline-flex items-center gap-0.5">
                    · <ZoomIn className="h-3 w-3" /> Agrandar
                  </span>
                </div>
              </div>

              {/* Estado */}
              {isSyncing ? (
                <div className="mx-5 mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-emerald-500 animate-pulse" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      ¡Samsung Health conectado!
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                      Sincronizando vitales en tiempo real…
                    </p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />
                </div>
              ) : (
                <div className="mx-5 mb-3 rounded-xl bg-amber-500/5 border border-amber-500/20 p-2.5 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">
                    Esperando autorización en tu Android…
                  </p>
                </div>
              )}

              {/* Código */}
              <div className="mx-5 mb-3 rounded-xl bg-muted/60 p-3 space-y-1">
                <p className="text-[10px] text-muted-foreground font-medium">
                  Código de emparejamiento
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-base font-bold tracking-[0.25em] select-all">
                    {conn.code}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(conn.code);
                        toast.success("Código copiado");
                      }}
                      className="rounded-md p-1.5 hover:bg-muted"
                      title="Copiar código"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={renew}
                      className="rounded-md p-1.5 hover:bg-muted"
                      title="Renovar código"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-5 pb-5">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs gap-1.5 border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                  onClick={simulate}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Probar sincronización (demo)
                </Button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(url);
                    toast.success("Enlace copiado");
                  }}
                  className="w-full text-[10px] text-muted-foreground hover:text-foreground hover:underline mt-2"
                >
                  ¿Sin app? Copia el enlace de emparejamiento
                </button>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Compatibles: {COMPATIBLE_DEVICES.join(" · ")}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      <Card className="overflow-hidden border-blue-500/20">
        {/* Hero */}
        <div className="relative bg-gradient-to-br from-blue-500/10 via-background to-violet-500/10 p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white font-bold flex-shrink-0 shadow-lg shadow-blue-500/20">
                S
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-bold text-sm">Samsung Health</h3>
                  {loading ? (
                    <Badge variant="outline" className="text-[10px]">
                      Cargando…
                    </Badge>
                  ) : isActive ? (
                    <Badge className="text-[10px] gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/15">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Vinculado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] gap-1 border-rose-500/30 text-rose-600 dark:text-rose-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      No vinculado
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {isActive && conn?.lastSyncAt
                    ? `Última sincronización ${formatDistanceToNow(new Date(conn.lastSyncAt), { addSuffix: true, locale: es })}`
                    : isActive
                    ? "Esperando primer dato…"
                    : "Galaxy Watch · Health Connect · Tiempo real"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isActive ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                    onClick={() => setQrOpen(true)}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Ver QR
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 text-muted-foreground hover:text-destructive hover:border-destructive/30"
                    onClick={disconnect}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-md shadow-blue-500/20"
                  onClick={connect}
                  disabled={busy || loading}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  {busy ? "Generando…" : "Vincular"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="p-4 space-y-4">
          {/* Pasos rápidos */}
          <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.04] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <ScanLine className="h-3.5 w-3.5 text-blue-500" />
              <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                Conecta en segundos
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { n: 1, t: "Escanea QR" },
                { n: 2, t: "Autoriza Samsung Health" },
                { n: 3, t: "Datos automáticos" },
              ].map((s) => (
                <div key={s.n} className="flex items-start gap-1.5">
                  <span className="flex-shrink-0 h-4 w-4 rounded-full bg-blue-500/15 text-blue-600 text-[9px] font-bold flex items-center justify-center mt-0.5">
                    {s.n}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{s.t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Signos vitales recibidos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-foreground">
                Signos vitales que Humanix recibirá
              </p>
              <span className="text-[10px] text-muted-foreground">vía Health Connect</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {VITAL_SIGNS.map((v) => {
                const Icon = v.icon;
                return (
                  <div
                    key={v.label}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1.5"
                  >
                    <Icon className={`h-3.5 w-3.5 ${v.color} flex-shrink-0`} />
                    <span className="text-[10px] text-foreground/80 truncate">{v.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* IA + Alertas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
                <p className="text-[11px] font-semibold">IA de Riesgo</p>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug mb-2">
                Analiza signos, sueño, actividad e historial clínico para calcular riesgo:
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  🟢 Bajo
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                  🟡 Moderado
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                  🔴 Alto
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-[11px] font-semibold">Alertas inteligentes</p>
              </div>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 leading-snug">
                <li className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Caídas detectadas</li>
                <li className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Vitales anormales</li>
                <li className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Deterioro progresivo</li>
                <li className="flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" /> Posibles emergencias</li>
              </ul>
            </div>
          </div>

          {/* Arquitectura */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[10px] font-semibold text-muted-foreground mb-2">
              Arquitectura recomendada (Samsung Health Data SDK 2026)
            </p>
            <div className="flex items-center justify-between gap-1 text-[9px] font-medium overflow-x-auto">
              {["Galaxy Watch", "Samsung Health", "Health Connect", "Humanix Care", "Humanix SaaS"].map(
                (label, i, arr) => (
                  <div key={label} className="flex items-center gap-1 whitespace-nowrap">
                    <span className="px-1.5 py-1 rounded-md bg-background border border-border text-foreground/80">
                      {label}
                    </span>
                    {i < arr.length - 1 && (
                      <span className="text-muted-foreground">→</span>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Privacidad */}
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <p>
              Familiares, enfermeros y médicos autorizados verán signos vitales en tiempo real,
              recibirán alertas y podrán descargar reportes. Datos cifrados extremo a extremo.
              <span className="inline-flex items-center gap-1 ml-1">
                <Smartphone className="h-2.5 w-2.5" /> Android 12+
              </span>
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}