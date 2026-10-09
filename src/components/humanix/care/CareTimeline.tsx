// Línea de tiempo del parte del turno (presentacional). La reciben la familia, su círculo de cuidado, la
// institución cliente y el propio profesional. Solo muestra; la seguridad la decide la base de datos.
import {
  Activity,
  AlertTriangle,
  FileText,
  Home,
  LogOut,
  PersonStanding,
  Pill,
  Utensils,
} from "lucide-react";
import {
  MOOD_META,
  eventMeta,
  formatVitals,
  groupLogsByDay,
  hasAnyVital,
  isCareMood,
  vitalFlags,
  vitalsOf,
  type CareLogRow,
  type EventMeta,
} from "@/lib/careLog";
import { cn } from "@/lib/utils";

const ICONS: Record<EventMeta["icon"], React.ElementType> = {
  Home,
  Pill,
  Activity,
  Utensils,
  PersonStanding,
  FileText,
  AlertTriangle,
  LogOut,
};

const timeFmt = new Intl.DateTimeFormat("es-CO", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
});
const dayFmt = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Bogota",
});

function dayLabel(day: string, todayDay: string): string {
  if (day === todayDay) return "Hoy";
  const d = new Date(`${day}T12:00:00-05:00`);
  return dayFmt.format(d);
}

export function CareTimeline({
  logs,
  todayDay,
  className,
}: {
  logs: CareLogRow[];
  /** Día de hoy en Colombia («2026-10-09»); se inyecta para que sea determinista en pruebas. */
  todayDay: string;
  className?: string;
}) {
  const groups = groupLogsByDay(logs);
  return (
    <div className={cn("space-y-5", className)}>
      {groups.map((g) => (
        <section key={g.day} aria-label={dayLabel(g.day, todayDay)}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {dayLabel(g.day, todayDay)}
          </h3>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {g.rows.map((log) => {
              const meta = eventMeta(log.event_type);
              const Icon = ICONS[meta.icon];
              const vitals = vitalsOf(log);
              const flags = hasAnyVital(vitals) ? vitalFlags(vitals) : [];
              const mood = isCareMood(log.mood) ? MOOD_META[log.mood] : null;
              return (
                <li key={log.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[31px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background",
                      log.is_alert ? "bg-sos/15 text-sos" : meta.tone,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div
                    className={cn(
                      "rounded-xl border px-3 py-2.5",
                      log.is_alert ? "border-sos/40 bg-sos/5" : "border-border bg-card",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{meta.label}</span>
                      {log.is_alert && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sos/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sos">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Alerta
                        </span>
                      )}
                      {mood && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            mood.tone,
                          )}
                        >
                          <span aria-hidden="true">{mood.emoji}</span> {mood.label}
                        </span>
                      )}
                      <time
                        className="ml-auto text-xs text-muted-foreground"
                        dateTime={log.created_at}
                      >
                        {timeFmt.format(new Date(log.created_at))}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground/90">
                      {log.description}
                    </p>
                    {hasAnyVital(vitals) && (
                      <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                        {formatVitals(vitals)}
                      </p>
                    )}
                    {flags.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {flags.map((f) => (
                          <li
                            key={`${f.key}-${f.level}`}
                            className={cn(
                              "text-xs font-medium",
                              f.level === "alert" ? "text-sos" : "text-warn",
                            )}
                          >
                            {f.level === "alert" ? "⚠ " : "• "}
                            {f.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {log.is_alert && log.alert_reason && log.alert_reason !== log.description && (
                      <p className="mt-1 text-xs text-sos">Motivo: {log.alert_reason}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
