// Servicios en curso o por empezar, en vivo: el tablero de cada rol.
//  · Profesional: sus servicios de hoy, con el siguiente paso (salir, llegar, registrar el parte).
//  · Familia / institución: el turno en vivo con alertas, ánimo y últimos signos vitales.
//  · Círculo de cuidado: el servicio de su familiar, en solo lectura.
import { Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, ChevronRight, ClipboardList, HeartPulse } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveServices } from "@/hooks/use-care-loop";
import { MOOD_META, formatVitals, isCareMood, vitalFlags } from "@/lib/careLog";
import {
  SERVICE_STATUS_LABEL,
  needsAttention,
  nextStepLabel,
  sortActive,
  type ActiveService,
  type ServiceSide,
} from "@/lib/careLoop";
import { cn } from "@/lib/utils";

const whenFmt = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
});

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-biosensor/15 text-biosensor",
  in_route: "bg-copper/15 text-copper",
  in_progress: "bg-ok/15 text-ok",
};

function ServiceRow({ s }: { s: ActiveService }) {
  const attention = needsAttention(s);
  const mood = isCareMood(s.last_mood) ? MOOD_META[s.last_mood] : null;
  const vitals = s.last_vitals ? formatVitals(s.last_vitals) : "";
  const flags = s.last_vitals ? vitalFlags(s.last_vitals) : [];
  const who =
    s.side === "circle"
      ? `Servicio de ${s.owner_name ?? "tu familiar"} con ${s.counterpart_name}`
      : s.side === "professional"
        ? `Con ${s.counterpart_name}`
        : `${s.counterpart_name}`;

  return (
    <li
      className={cn(
        "rounded-xl border p-3 sm:p-4",
        attention ? "border-sos/50 bg-sos/5" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            STATUS_STYLE[s.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {SERVICE_STATUS_LABEL[s.status] ?? s.status}
        </span>
        <span className="text-sm font-semibold">{who}</span>
        <time className="text-xs text-muted-foreground" dateTime={s.scheduled_at}>
          {whenFmt.format(new Date(s.scheduled_at))} · {s.duration_hours} h
        </time>
        {attention && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sos/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sos">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {s.alerts}{" "}
            {s.alerts === 1 ? "alerta" : "alertas"}
          </span>
        )}
      </div>

      {s.status === "in_progress" && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> {s.events}{" "}
            {s.events === 1 ? "registro" : "registros"}
          </span>
          {mood && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true">{mood.emoji}</span> {mood.label}
            </span>
          )}
          {vitals && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                flags.some((f) => f.level === "alert") && "font-semibold text-sos",
              )}
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" /> {vitals}
            </span>
          )}
        </p>
      )}

      <div className="mt-3">
        <Link
          to="/servicio/$bookingId"
          params={{ bookingId: s.booking_id }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-biosensor px-4 text-sm font-semibold text-biosensor-foreground transition hover:opacity-95"
        >
          {nextStepLabel(s.side, s.status)} <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function ActiveServicesCard({
  userId,
  title,
  sides,
  emptyText,
  className,
}: {
  userId: string;
  title: string;
  /** Qué servicios mostrar: como cliente, como profesional o desde el círculo de cuidado (por defecto, todos). */
  sides?: ServiceSide[];
  /** Si se define, se muestra cuando no hay servicios; si no, la tarjeta no aparece. */
  emptyText?: string;
  className?: string;
}) {
  const active = useActiveServices(userId);
  // Antes de aplicar la migración la función no existe: no se muestra un error al usuario.
  if (active.error) return null;
  if (active.isLoading) return <Skeleton className="h-28 w-full" />;
  const rows = sortActive((active.data ?? []).filter((r) => !sides || sides.includes(r.side)));
  if (rows.length === 0 && !emptyText) return null;

  return (
    <Card className={cn("space-y-3 p-4 sm:p-5", className)} aria-label={title}>
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <HeartPulse className="h-4 w-4 text-biosensor" aria-hidden="true" /> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <ServiceRow key={s.booking_id} s={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}
