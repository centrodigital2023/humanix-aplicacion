// El monitoreo de UN paciente: su halo NEWS2, los últimos valores con color por puntos, la tendencia de 24 horas, sus alertas, sus dispositivos
// y sus últimos controles. Se usa en la pestaña «Monitoreo» de la ficha. Apoyo a la decisión clínica; no reemplaza el criterio del profesional.
import { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  HeartPulse,
  Plus,
  Power,
  Watch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CareActions } from "@/hooks/use-inst-care";
import {
  MODALITY_META,
  dayClockLabel,
  timeAgo,
  type CareOverview,
  type Clock,
} from "@/lib/instCare";
import type { InstAlert, InstDevice, InstLive, InstObs, InstPatient } from "@/lib/instCareTypes";
import {
  STATE_META,
  bandNote,
  monitorStatus,
  news2Trend,
  seriesOf,
  vitalTone,
} from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { NewsRing } from "@/components/humanix/instcare/NewsRing";
import { TrendSpark } from "@/components/humanix/instcare/TrendSpark";
import { TONE } from "@/components/humanix/instcare/tones";
import { AlertCenter } from "./AlertCenter";
import { DevicesList, PairDeviceDialog } from "./DeviceDialog";
import { VitalsDialog } from "./VitalsDialog";
import { toast } from "sonner";

function VitalTile({
  label,
  value,
  unit,
  tone,
  spark,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: keyof typeof TONE;
  spark?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        "rounded-2xl border bg-gradient-to-br p-3",
        tone === "muted" ? "border-border" : t.border,
        t.wash,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-0.5 font-display text-xl font-bold leading-none tabular-nums", t.text)}>
        {value}
        {unit && value !== "—" && (
          <span className="ml-1 text-[10px] font-medium text-muted-foreground">{unit}</span>
        )}
      </p>
      {spark && <div className="mt-1.5">{spark}</div>}
    </div>
  );
}

const fmt = (n: unknown, d = 0) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d).replace(".", ",") : "—";

export function PatientMonitorPanel({
  patient,
  live,
  alerts,
  obs,
  devices,
  now,
  actions,
  overview,
  canWrite,
}: {
  patient: InstPatient;
  live: InstLive | undefined;
  alerts: InstAlert[];
  obs: InstObs[];
  devices: InstDevice[];
  now: Clock;
  actions: CareActions;
  overview: CareOverview;
  canWrite: boolean;
}) {
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const status = monitorStatus(live, alerts, now);
  const trend = news2Trend(obs, now);
  const v = live?.last_vitals ?? {};
  const scale = patient.spo2_scale;
  const onO2 = v.on_o2 === true;
  const sp = (key: "hr" | "rr" | "spo2" | "sbp" | "dbp" | "temp_c" | "news2") =>
    seriesOf(obs, key, 24, now);
  const meta = MODALITY_META[patient.modality];
  const TrendIcon =
    trend.direction === "up"
      ? ArrowUpRight
      : trend.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const recent = obs.slice(0, 8);

  const turnOff = async () => {
    try {
      await actions.setMonitoring.mutateAsync({ patientId: patient.id, on: false });
      toast.success("Salió de monitoreo");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!patient.monitoring) {
    return (
      <div
        className="space-y-3 rounded-2xl border border-dashed border-border p-6 text-center"
        data-testid="monitor-off"
      >
        <Activity className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Este paciente no está en monitoreo</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          Al monitorearlo, el NEWS2 se calcula con cada control y el sistema avisa si empeora.
        </p>
        {canWrite && patient.status === "active" && (
          <Button
            type="button"
            variant="hero"
            size="sm"
            disabled={actions.setMonitoring.isPending}
            onClick={() =>
              void actions.setMonitoring
                .mutateAsync({ patientId: patient.id, on: true })
                .then(() => toast.success("Entró a monitoreo"))
                .catch((e: Error) => toast.error(e.message))
            }
          >
            <Power aria-hidden /> Poner en monitoreo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="monitor-panel">
      <Card
        className={cn(
          "flex flex-col gap-4 rounded-2xl border bg-gradient-to-br p-4 sm:flex-row sm:items-center",
          TONE[STATE_META[status.state].tone].border,
          TONE[STATE_META[status.state].tone].wash,
        )}
      >
        <NewsRing score={status.news2} band={status.band} size="lg" />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "font-display text-xl font-bold",
              TONE[STATE_META[status.state].tone].text,
            )}
          >
            {STATE_META[status.state].label}
            {bandNote(status) && (
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                {bandNote(status)}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Último control:{" "}
            {status.lastSeenAt
              ? `${timeAgo(status.lastSeenAt, now)} (${dayClockLabel(status.lastSeenAt, now)})`
              : "ninguno todavía"}
          </p>
          <p
            className={cn(
              "text-xs",
              status.overdue ? "font-semibold text-warn" : "text-muted-foreground",
            )}
          >
            {status.dueLabel}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs">
            <TrendIcon
              className={cn(
                "h-3.5 w-3.5",
                trend.direction === "up"
                  ? "text-sos"
                  : trend.direction === "down"
                    ? "text-ok"
                    : "text-muted-foreground",
              )}
              aria-hidden
            />
            {trend.label}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {meta.label}
            {scale === 2 ? " · Escala 2 de saturación (meta 88–92 %)" : ""}
            {status.online ? " · dispositivo en línea" : ""}
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 flex-col gap-2">
            <Button type="button" variant="hero" size="sm" onClick={() => setVitalsOpen(true)}>
              <HeartPulse aria-hidden /> Registrar signos
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void turnOff()}
              disabled={actions.setMonitoring.isPending}
            >
              <Power aria-hidden /> Dejar de monitorear
            </Button>
          </div>
        )}
      </Card>

      <section
        aria-label="Últimos valores"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
      >
        <VitalTile
          label="Pulso"
          value={fmt(v.hr)}
          unit="/min"
          tone={vitalTone("hr", typeof v.hr === "number" ? v.hr : null)}
          spark={
            <TrendSpark
              points={sp("hr")}
              label="Pulso, últimas 24 horas"
              tone={vitalTone("hr", typeof v.hr === "number" ? v.hr : null)}
              width={110}
              height={26}
            />
          }
        />
        <VitalTile
          label="Saturación"
          value={fmt(v.spo2, 0)}
          unit="%"
          tone={vitalTone("spo2", typeof v.spo2 === "number" ? v.spo2 : null, { scale, onO2 })}
          spark={
            <TrendSpark
              points={sp("spo2")}
              label="Saturación, últimas 24 horas"
              tone={vitalTone("spo2", typeof v.spo2 === "number" ? v.spo2 : null, { scale, onO2 })}
              width={110}
              height={26}
            />
          }
        />
        <VitalTile
          label="Presión"
          value={typeof v.sbp === "number" ? `${fmt(v.sbp)}/${fmt(v.dbp)}` : "—"}
          unit="mmHg"
          tone={vitalTone("sbp", typeof v.sbp === "number" ? v.sbp : null)}
          spark={
            <TrendSpark
              points={sp("sbp")}
              label="Presión sistólica, últimas 24 horas"
              tone={vitalTone("sbp", typeof v.sbp === "number" ? v.sbp : null)}
              width={110}
              height={26}
            />
          }
        />
        <VitalTile
          label="Respiración"
          value={fmt(v.rr)}
          unit="/min"
          tone={vitalTone("rr", typeof v.rr === "number" ? v.rr : null)}
        />
        <VitalTile
          label="Temperatura"
          value={fmt(v.temp_c, 1)}
          unit="°C"
          tone={vitalTone("temp_c", typeof v.temp_c === "number" ? v.temp_c : null)}
        />
        <VitalTile
          label="Conciencia"
          value={typeof v.avpu === "string" ? (v.avpu === "A" ? "Alerta" : v.avpu) : "—"}
          tone={v.avpu === "A" ? "ok" : typeof v.avpu === "string" ? "sos" : "muted"}
        />
        <VitalTile
          label="Oxígeno"
          value={v.on_o2 === true ? "Con O₂" : v.on_o2 === false ? "Aire" : "—"}
          tone={v.on_o2 === true ? "warn" : "muted"}
        />
        <VitalTile
          label="NEWS2 (24 h)"
          value={status.news2 === null ? "—" : String(status.news2)}
          tone={status.news2 === null ? "muted" : STATE_META[status.state].tone}
          spark={
            <TrendSpark
              points={sp("news2")}
              label="NEWS2, últimas 24 horas"
              tone={STATE_META[status.state].tone}
              width={110}
              height={26}
            />
          }
        />
      </section>

      {alerts.some((a) => a.status !== "resolved") && (
        <AlertCenter
          alerts={alerts}
          patients={new Map([[patient.id, patient]])}
          now={now}
          actions={actions}
          canWrite={canWrite}
          title="Alertas de este paciente"
        />
      )}

      <section aria-label="Dispositivos" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 font-display text-sm font-bold">
            <Watch className="h-4 w-4 text-fuchsia-neural" aria-hidden /> Dispositivos
          </h3>
          {canWrite && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPairOpen(true)}>
              <Plus aria-hidden /> Emparejar
            </Button>
          )}
        </div>
        {devices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            {overview.limits.devices > 0
              ? "Sin dispositivos. Empareja un reloj o sensor y los signos llegan solos."
              : "Conectar relojes y sensores es parte del plan IPS Mejorado. Mientras tanto, registra los signos a mano."}
          </p>
        ) : (
          <DevicesList devices={devices} now={now} actions={actions} canWrite={canWrite} />
        )}
      </section>

      <section aria-label="Últimos controles" className="space-y-2">
        <h3 className="font-display text-sm font-bold">Últimos controles</h3>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            Aún no hay controles.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Hora</th>
                  <th className="px-2 py-2 font-semibold">Pulso</th>
                  <th className="px-2 py-2 font-semibold">SpO₂</th>
                  <th className="px-2 py-2 font-semibold">Presión</th>
                  <th className="px-2 py-2 font-semibold">Temp.</th>
                  <th className="px-2 py-2 font-semibold">NEWS2</th>
                  <th className="px-3 py-2 font-semibold">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {dayClockLabel(o.recorded_at, now)}
                    </td>
                    <td className="px-2 py-1.5">{fmt(o.hr)}</td>
                    <td className="px-2 py-1.5">
                      {fmt(o.spo2 === null ? null : Number(o.spo2), 0)}
                    </td>
                    <td className="px-2 py-1.5">
                      {o.sbp !== null ? `${o.sbp}/${o.dbp ?? "—"}` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {fmt(o.temp_c === null ? null : Number(o.temp_c), 1)}
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{o.news2 ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {o.source === "device" ? "Dispositivo" : (o.recorded_by_name ?? "A mano")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <VitalsDialog
        open={vitalsOpen}
        onOpenChange={setVitalsOpen}
        patient={patient}
        history={obs}
        actions={actions}
        now={now}
      />
      <PairDeviceDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        patient={patient}
        actions={actions}
        overview={overview}
      />
    </div>
  );
}
