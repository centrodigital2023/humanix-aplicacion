// La tarjeta de una persona en el tablero de monitoreo: halo NEWS2, últimos valores con color según los puntos que aportan, cuándo toca el
// próximo control y si su dispositivo está en línea. Toda la tarjeta abre la ficha; «Registrar signos» abre el formulario directo.
import { AlertTriangle, HeartPulse, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MODALITY_META } from "@/lib/instCare";
import type { InstLive, InstPatient } from "@/lib/instCareTypes";
import { STATE_META, bandNote, vitalTone, type MonitorStatus } from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { NewsRing } from "@/components/humanix/instcare/NewsRing";
import { PersonAvatar } from "@/components/humanix/instcare/PersonAvatar";
import { TONE } from "@/components/humanix/instcare/tones";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f = (v: number | null, d = 0) => (v === null ? "—" : v.toFixed(d).replace(".", ","));

function Mini({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-2 py-1">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("truncate text-sm font-bold tabular-nums", TONE[tone].text)}>{value}</p>
    </div>
  );
}

export function MonitorCard({
  patient,
  live,
  status,
  canWrite,
  onOpen,
  onRecord,
}: {
  patient: InstPatient;
  live: InstLive | undefined;
  status: MonitorStatus;
  canWrite: boolean;
  onOpen: () => void;
  onRecord: () => void;
}) {
  const v = live?.last_vitals ?? {};
  const hr = num(v.hr);
  const spo2 = num(v.spo2);
  const sbp = num(v.sbp);
  const dbp = num(v.dbp);
  const temp = num(v.temp_c);
  const scale = patient.spo2_scale;
  const onO2 = v.on_o2 === true;
  const meta = STATE_META[status.state];
  const hot = status.state === "critical" || status.unackedAlerts > 0;

  return (
    <Card
      className={cn(
        "card-hover overflow-hidden rounded-2xl border bg-gradient-to-br",
        hot ? cn(TONE[meta.tone].border, "ring-1", TONE[meta.tone].ring) : "border-border",
        TONE[meta.tone].wash,
      )}
      data-testid="monitor-card"
      data-patient-id={patient.id}
      data-state={status.state}
    >
      <button
        type="button"
        onClick={onOpen}
        className="focus-premium block w-full p-3 text-left sm:p-4"
        aria-label={`Abrir la ficha de ${patient.full_name}: ${meta.label}${status.news2 !== null ? `, NEWS2 ${status.news2}` : ""}`}
      >
        <div className="flex items-center gap-3">
          <NewsRing score={status.news2} band={status.band} size="md" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate font-display text-sm font-bold">
              <PersonAvatar
                name={patient.full_name}
                id={patient.id}
                size="sm"
                className="h-6 w-6 rounded-lg text-[9px]"
              />
              <span className="truncate">{patient.full_name}</span>
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {MODALITY_META[patient.modality].label}
              {patient.room ? ` · hab. ${patient.room}` : ""}
              {scale === 2 ? " · escala 2" : ""}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn("text-[11px] font-semibold", TONE[meta.tone].text)}>
                {meta.label}
                {bandNote(status) ? ` · ${bandNote(status)}` : ""}
              </span>
              {status.online && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ok">
                  <Wifi className="h-3 w-3" aria-hidden /> En línea
                </span>
              )}
            </p>
          </div>
        </div>

        {/* La presión («120/78») es el valor más ancho: una columna algo mayor evita que se corte con puntos suspensivos. */}
        <div className="mt-3 grid grid-cols-[1fr_1fr_1.4fr_1fr] gap-1.5">
          <Mini label="Pulso" value={f(hr)} tone={vitalTone("hr", hr)} />
          <Mini label="SpO₂" value={f(spo2)} tone={vitalTone("spo2", spo2, { scale, onO2 })} />
          <Mini
            label="PA"
            value={sbp !== null ? `${f(sbp)}/${f(dbp)}` : "—"}
            tone={vitalTone("sbp", sbp)}
          />
          <Mini label="Temp" value={f(temp, 1)} tone={vitalTone("temp_c", temp)} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <span
            className={cn(status.overdue ? "font-semibold text-warn" : "text-muted-foreground")}
          >
            {status.dueLabel}
          </span>
          {status.openAlerts > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-semibold",
                status.unackedAlerts > 0 ? "text-sos" : "text-warn",
              )}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {status.openAlerts} {status.openAlerts === 1 ? "alerta" : "alertas"}
              {status.unackedAlerts > 0 ? ` (${status.unackedAlerts} sin ver)` : ""}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Último control: {status.lastSeenLabel}
        </p>
      </button>
      {canWrite && (
        <div className="border-t border-border/60 px-3 py-2 sm:px-4">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-full justify-center text-xs"
            onClick={onRecord}
          >
            <HeartPulse aria-hidden /> Registrar signos
          </Button>
        </div>
      )}
    </Card>
  );
}
