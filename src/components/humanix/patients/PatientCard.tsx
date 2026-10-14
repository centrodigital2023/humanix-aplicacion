// La tarjeta de un paciente en la lista: quién es, cómo va (NEWS2 si está en monitoreo), su caso en curso con avance, lo que pide atención.
// Toda la tarjeta es un botón que abre la ficha.
import { Activity, AlertTriangle, CalendarClock, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  MODALITY_META,
  STATUS_META,
  ageLabel,
  caseProgress,
  decimalEs,
  type Clock,
} from "@/lib/instCare";
import type { InstAlert, InstCase, InstLive, InstPatient, InstTask } from "@/lib/instCareTypes";
import { STATE_META, monitorStatus } from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { NewsRing } from "@/components/humanix/instcare/NewsRing";
import { PersonAvatar } from "@/components/humanix/instcare/PersonAvatar";
import { TONE } from "@/components/humanix/instcare/tones";

function Chip({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        TONE[tone].chip,
      )}
    >
      {children}
    </span>
  );
}

export function PatientCard({
  patient,
  cases,
  tasks,
  live,
  alerts,
  now,
  onOpen,
}: {
  patient: InstPatient;
  cases: InstCase[];
  tasks: InstTask[];
  live: InstLive | undefined;
  alerts: InstAlert[];
  now: Clock;
  onOpen: () => void;
}) {
  const modality = MODALITY_META[patient.modality];
  const status = STATUS_META[patient.status];
  const monitored = patient.monitoring && patient.status === "active";
  const mon = monitored ? monitorStatus(live, alerts, now) : null;
  const current =
    cases.find((c) => c.status === "active") ?? cases.find((c) => c.status === "pending");
  const progress = current ? caseProgress(current, now) : null;
  const rated = cases.filter((c) => c.satisfaction !== null);
  const avg = rated.length
    ? rated.reduce((s, c) => s + (c.satisfaction ?? 0), 0) / rated.length
    : null;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const overdue = tasks.filter((t) => Date.parse(t.due_at) < nowMs).length;
  const age = ageLabel(patient.birth_date, now);
  const meta = [
    age,
    patient.sex === "F" ? "Mujer" : patient.sex === "M" ? "Hombre" : "",
    patient.room ? `hab. ${patient.room}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const needsEyes = mon && (mon.state === "critical" || mon.unackedAlerts > 0);

  return (
    <Card
      className={cn(
        "card-hover relative overflow-hidden rounded-2xl border bg-card",
        needsEyes ? cn(TONE.sos.border, "ring-1", TONE.sos.ring) : "border-border",
      )}
      data-testid="patient-card"
      data-patient-id={patient.id}
    >
      <button
        type="button"
        onClick={onOpen}
        className="focus-premium block w-full p-4 text-left"
        aria-label={`Abrir la ficha de ${patient.full_name}`}
      >
        <div className="flex items-start gap-3">
          <PersonAvatar name={patient.full_name} id={patient.id} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold leading-tight">
              {patient.full_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{meta || "Sin más datos"}</p>
          </div>
          {mon && mon.news2 !== null ? (
            <NewsRing score={mon.news2} band={mon.band} size="sm" />
          ) : mon ? (
            <span className="text-[10px] font-medium text-muted-foreground">Sin puntaje</span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tone={modality.tone}>{modality.label}</Chip>
          {patient.status !== "active" && <Chip tone={status.tone}>{status.label}</Chip>}
          {mon && (
            <Chip tone={STATE_META[mon.state].tone}>
              <Activity className="h-3 w-3" aria-hidden /> {STATE_META[mon.state].label}
            </Chip>
          )}
          {mon && mon.unackedAlerts > 0 && (
            <Chip tone="sos">
              <AlertTriangle className="h-3 w-3" aria-hidden /> {mon.unackedAlerts}{" "}
              {mon.unackedAlerts === 1 ? "alerta sin ver" : "alertas sin ver"}
            </Chip>
          )}
          {overdue > 0 && (
            <Chip tone="warn">
              <CalendarClock className="h-3 w-3" aria-hidden /> {overdue}{" "}
              {overdue === 1 ? "tarea vencida" : "tareas vencidas"}
            </Chip>
          )}
        </div>

        {patient.conditions.length > 0 && (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {patient.conditions.slice(0, 2).join(" · ")}
            {patient.conditions.length > 2 ? ` · +${patient.conditions.length - 2}` : ""}
          </p>
        )}

        {current && progress ? (
          <div className="mt-3 rounded-xl bg-muted/40 p-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{current.title}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  progress.late ? "font-semibold text-sos" : "text-muted-foreground",
                )}
              >
                {progress.label}
              </span>
            </div>
            {progress.pct !== null && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn("h-full rounded-full", progress.late ? "bg-sos" : "bg-ok")}
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            )}
            {current.professional_label && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                Con {current.professional_label}
              </p>
            )}
          </div>
        ) : (
          patient.status !== "discharged" && (
            <p className="mt-3 rounded-xl border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
              Sin caso en curso
            </p>
          )
        )}

        {avg !== null && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-copper">
            <Star className="h-3.5 w-3.5 fill-copper" aria-hidden /> {decimalEs(avg)}
            <span className="font-normal text-muted-foreground">
              · {rated.length} {rated.length === 1 ? "valoración" : "valoraciones"}
            </span>
          </p>
        )}
      </button>
    </Card>
  );
}
