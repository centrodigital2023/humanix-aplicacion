import { useEffect, useState } from "react";
import { Activity, HeartPulse, Thermometer, Wind, Droplet, AlertTriangle, CheckCircle2, Play, Pause } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Vital = {
  hr: number; // bpm
  spo2: number; // %
  sys: number; // systolic mmHg
  dia: number; // diastolic mmHg
  temp: number; // °C
  resp: number; // breaths/min
};

function randomDelta(base: number, jitter: number, min: number, max: number): number {
  const next = base + (Math.random() - 0.5) * jitter;
  return Math.max(min, Math.min(max, next));
}

function classifyVital(v: Vital): { tone: "ok" | "warn" | "alert"; reasons: string[] } {
  const reasons: string[] = [];
  let tone: "ok" | "warn" | "alert" = "ok";
  if (v.hr < 50 || v.hr > 110) {
    reasons.push(`FC ${Math.round(v.hr)} fuera de rango`);
    tone = v.hr < 40 || v.hr > 130 ? "alert" : "warn";
  }
  if (v.spo2 < 92) {
    reasons.push(`SpO₂ ${Math.round(v.spo2)}% baja`);
    tone = v.spo2 < 88 ? "alert" : tone === "ok" ? "warn" : tone;
  }
  if (v.sys > 160 || v.dia > 100) {
    reasons.push(`Presión alta ${Math.round(v.sys)}/${Math.round(v.dia)}`);
    tone = "alert";
  } else if (v.sys < 90 || v.dia < 60) {
    reasons.push(`Presión baja ${Math.round(v.sys)}/${Math.round(v.dia)}`);
    tone = tone === "ok" ? "warn" : tone;
  }
  if (v.temp >= 38) {
    reasons.push(`Fiebre ${v.temp.toFixed(1)}°C`);
    tone = v.temp >= 39 ? "alert" : tone === "ok" ? "warn" : tone;
  }
  if (v.resp < 10 || v.resp > 24) {
    reasons.push(`FR ${Math.round(v.resp)} fuera de rango`);
    tone = tone === "ok" ? "warn" : tone;
  }
  return { tone, reasons };
}

export function VitalSignsMonitor({ patientName }: { patientName?: string }) {
  const [live, setLive] = useState(true);
  const [v, setV] = useState<Vital>({ hr: 78, spo2: 97, sys: 122, dia: 78, temp: 36.7, resp: 16 });

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      setV((prev) => ({
        hr: randomDelta(prev.hr, 6, 45, 140),
        spo2: randomDelta(prev.spo2, 1.5, 85, 100),
        sys: randomDelta(prev.sys, 4, 85, 170),
        dia: randomDelta(prev.dia, 3, 55, 105),
        temp: randomDelta(prev.temp, 0.2, 35.5, 39.5),
        resp: randomDelta(prev.resp, 1.5, 8, 28),
      }));
    }, 2000);
    return () => clearInterval(t);
  }, [live]);

  const status = classifyVital(v);
  const toneCls =
    status.tone === "ok"
      ? "border-biosensor/30 bg-biosensor/5"
      : status.tone === "warn"
        ? "border-copper/40 bg-copper/5"
        : "border-destructive/40 bg-destructive/5";

  return (
    <Card className={`p-4 space-y-3 ${toneCls}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-fuchsia-neural" /> Seguimiento en casa · Signos vitales
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Monitoreo {live ? "en tiempo real" : "pausado"}
            {patientName ? ` · paciente ${patientName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.tone === "ok" ? (
            <Badge className="bg-biosensor/20 text-biosensor border-biosensor/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Estable
            </Badge>
          ) : status.tone === "warn" ? (
            <Badge className="bg-copper/20 text-copper border-copper/30">
              <AlertTriangle className="h-3 w-3 mr-1" /> Vigilar
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" /> Crítico
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => setLive((x) => !x)}>
            {live ? (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1" /> Reanudar
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat icon={<HeartPulse className="h-4 w-4 text-rose-500" />} label="FC" value={`${Math.round(v.hr)} bpm`} />
        <Stat icon={<Droplet className="h-4 w-4 text-sky-500" />} label="SpO₂" value={`${Math.round(v.spo2)}%`} />
        <Stat icon={<Activity className="h-4 w-4 text-fuchsia-neural" />} label="PA" value={`${Math.round(v.sys)}/${Math.round(v.dia)}`} />
        <Stat icon={<Thermometer className="h-4 w-4 text-amber-500" />} label="Temp" value={`${v.temp.toFixed(1)}°C`} />
        <Stat icon={<Wind className="h-4 w-4 text-emerald-500" />} label="FR" value={`${Math.round(v.resp)} rpm`} />
        <Stat
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Estado"
          value={status.tone === "ok" ? "OK" : status.tone === "warn" ? "Vigilar" : "Alerta"}
        />
      </div>

      {status.reasons.length > 0 && (
        <div className="rounded-lg bg-background/60 border px-3 py-2 text-xs space-y-1">
          <p className="font-semibold text-muted-foreground uppercase text-[10px]">Hallazgos</p>
          <ul className="space-y-0.5">
            {status.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 text-copper shrink-0" />
                <span className="text-muted-foreground">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground italic">
        Demo. Conecta dispositivos BLE / API hospitalaria para datos reales.
      </p>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 border px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-base font-semibold mt-0.5">{value}</p>
    </div>
  );
}
