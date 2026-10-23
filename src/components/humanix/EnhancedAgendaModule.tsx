// Agenda institucional · próximos 7 días.
//
// Antes esta tarjeta marcaba todo como «programado», cargaba solo turnos futuros (así «Completados» y «No-show» nunca
// subían), simulaba los cambios de estado y mostraba el teléfono personal de cada profesional. Ahora lee los servicios
// reales de la institución con actualización en vivo (`useInstBookings`) y los turnos publicados (`useCoverageOffers`),
// y toda la lógica vive en `lib/instAgenda` (probada).
//
// Según el plan (se lee de `mp_subscriptions`; la puerta es de interfaz porque son cuentas sobre datos propios):
//  - Todas las instituciones: la semana con estados reales, contadores, posiciones sin cubrir, alertas explicadas y
//    recordatorios por WhatsApp que solo se preparan (sin exponer teléfonos ni hablar de pagos).
//  - Institucional (`inst_agenda_insights`): riesgo de inasistencia por profesional, reporte de utilización de 30 días y
//    exportación en CSV e iCal.
// Los cambios de estado de un servicio se hacen en su página (`/servicio/$bookingId`), donde viven las reglas reales.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { downloadText } from "@/components/humanix/premium/download";
import { PremiumPreview } from "@/components/humanix/premium/PremiumPreview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstBookings, useInstOffers, useInstProFacts } from "@/hooks/use-inst-intel";
import { useCoverageOffers } from "@/hooks/use-institution-hub";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import {
  AGENDA_DAYS,
  REPORT_DAYS,
  STATUS_LABEL,
  agendaCsv,
  agendaIcs,
  buildAgenda,
  needsReminder,
  proReliability,
  reliabilityFor,
  reminderText,
  utilizationReport,
  type AgendaAlert,
  type AgendaOfferShift,
  type AgendaShift,
  type AgendaStatus,
  type ProRiskLevel,
} from "@/lib/instAgenda";
import { proNames } from "@/lib/instData";
import { bogotaYmd, dayLabelEs, hoursEs, msOf, plural, timeLabelEs } from "@/lib/intelShared";
import { whatsappLink } from "@/lib/sos";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<AgendaStatus, string> = {
  pending: "border-copper/40 bg-copper/10 text-copper",
  confirmed: "border-trust/30 bg-trust/10 text-trust",
  in_route: "border-trust/40 bg-trust/15 text-trust",
  in_progress: "border-biosensor/40 bg-biosensor/10 text-biosensor",
  completed: "border-ok/30 bg-ok/10 text-ok",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
  no_show: "border-sos/40 bg-sos/10 text-sos",
  unclosed: "border-copper/40 bg-copper/10 text-copper",
};

const ALERT_TONE: Record<AgendaAlert["severity"], string> = {
  critical: "border-l-sos bg-sos/5",
  high: "border-l-copper bg-copper/5",
  watch: "border-l-trust bg-trust/5",
};

const RISK_TONE: Record<ProRiskLevel, { dot: string; label: string }> = {
  reliable: { dot: "bg-ok", label: "Confiable" },
  watch: { dot: "bg-copper", label: "En observación" },
  risk: { dot: "bg-sos", label: "Riesgo de inasistencia" },
  new: { dot: "bg-trust", label: "Primer turno" },
};

function fileDate(now: number): string {
  const { y, m, d } = bogotaYmd(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function Kpi({
  label,
  value,
  tone = "text-foreground",
  hint,
}: {
  label: string;
  /** `null`: no hay datos suficientes (se muestra «—», nunca un cero inventado). */
  value: number | null;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3 text-center" title={hint}>
      <p
        className={cn(
          "font-display text-2xl font-bold tabular-nums",
          value === null ? "text-muted-foreground" : tone,
        )}
      >
        {value === null ? "—" : value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function EnhancedAgendaModule({ userId }: { userId: string }) {
  const now = useNow();
  const plan = usePlan(userId);
  const premium = plan.can("inst_agenda_insights");

  const bookingsQ = useInstBookings(userId);
  const coverageQ = useCoverageOffers(userId);
  const offersQ = useInstOffers(userId);
  const [selected, setSelected] = useState<AgendaShift | null>(null);

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);

  // Solo se piden nombres de quienes aparecen en la semana (y, con el plan, en el historial).
  const weekProIds = useMemo(() => {
    const from = now - 60 * 86_400_000;
    const to = now + (AGENDA_DAYS + 1) * 86_400_000;
    return [
      ...new Set(
        bookings
          .filter((b) => {
            const t = msOf(b.scheduled_at);
            return t >= from && t <= to;
          })
          .map((b) => b.professional_id),
      ),
    ];
  }, [bookings, now]);
  const { pros } = useInstProFacts(weekProIds, weekProIds.length > 0);
  const names = useMemo(() => proNames(pros), [pros]);

  const titles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, o] of Object.entries(offersQ.data ?? {})) if (o.title) out[id] = o.title;
    return out;
  }, [offersQ.data]);

  const openShifts = useMemo<AgendaOfferShift[]>(
    () =>
      (coverageQ.data ?? []).flatMap((o) =>
        (o.job_offer_shifts ?? []).map((s) => ({ ...s, title: o.title })),
      ),
    [coverageQ.data],
  );

  const reliability = useMemo(
    () => (premium ? reliabilityFor(weekProIds, proReliability(bookings, now)) : null),
    [premium, weekProIds, bookings, now],
  );

  const view = useMemo(
    () => buildAgenda({ bookings, openShifts, names, titles, reliability, now }),
    [bookings, openShifts, names, titles, reliability, now],
  );
  const report = useMemo(() => utilizationReport(bookings, now), [bookings, now]);

  if (bookingsQ.isLoading || plan.loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Preparando tu agenda">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (bookingsQ.isError) {
    return (
      <Card className="space-y-3 p-5" role="status">
        <p className="font-semibold">No pudimos traer tu agenda ahora mismo.</p>
        <p className="text-sm text-muted-foreground">Revisa tu conexión y vuelve a intentarlo.</p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void bookingsQ.refetch()}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </Button>
      </Card>
    );
  }

  const { kpis } = view;

  return (
    <section aria-labelledby="agenda-inst" className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="agenda-inst"
            className="flex items-center gap-2 font-display text-lg font-semibold"
          >
            <CalendarDays className="h-5 w-5 text-trust" aria-hidden="true" />
            Agenda institucional · próximos 7 días
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Vista inteligente de turnos, alertas de no-show y reportes de utilización.
          </p>
        </div>
        {!plan.loading && <PlanBadge plan={plan.plan} />}
      </div>

      <p
        className={cn(
          "rounded-xl px-3 py-2 text-sm font-medium",
          view.alerts.some((a) => a.severity === "critical")
            ? "bg-sos/10 text-sos"
            : view.alerts.length > 0
              ? "bg-copper/10 text-copper"
              : "bg-ok/10 text-ok",
        )}
        aria-live="polite"
      >
        {view.headline}
      </p>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Kpi label="Turnos totales" value={kpis.total} hint="Sin contar cancelados" />
        <Kpi label="Programados" value={kpis.scheduled} tone="text-trust" />
        <Kpi label="En curso" value={kpis.inProgress} tone="text-biosensor" />
        <Kpi label="Completados" value={kpis.completed} tone="text-ok" />
        <Kpi
          label="Sin iniciar"
          value={kpis.noShows}
          tone={kpis.noShows > 0 ? "text-sos" : "text-muted-foreground"}
          hint="Confirmados que pasaron 2 h sin llegada ni inicio"
        />
        <Kpi
          label="Posiciones sin cubrir"
          value={kpis.openPositions}
          tone={kpis.openPositions > 0 ? "text-copper" : "text-muted-foreground"}
        />
      </div>

      {/* Alertas */}
      {view.alerts.length > 0 && (
        <div className="space-y-2" aria-label="Alertas de la agenda">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-copper" aria-hidden="true" />
            {plural(view.alerts.length, "alerta", "alertas")}
          </h4>
          <ul className="space-y-2">
            {view.alerts.slice(0, 6).map((a) => {
              const shift = a.bookingId
                ? view.days.flatMap((d) => d.shifts).find((s) => s.id === a.bookingId)
                : undefined;
              return (
                <li
                  key={a.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border border-l-4 border-border p-3 sm:flex-row sm:items-start sm:justify-between motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300",
                    ALERT_TONE[a.severity],
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {shift && needsReminder(shift, now) && (
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                        <a
                          href={whatsappLink(null, reminderText(shift, now))}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Preparar recordatorio en WhatsApp (tú eliges a quién enviarlo)"
                        >
                          <Send className="h-3.5 w-3.5" aria-hidden="true" /> Recordar
                        </a>
                      </Button>
                    )}
                    {a.bookingId && (
                      <Button asChild size="sm" variant="ghost" className="h-8 gap-1">
                        <Link to="/servicio/$bookingId" params={{ bookingId: a.bookingId }}>
                          Ver <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {view.alerts.length > 6 && (
            <p className="text-xs text-muted-foreground">
              Y {plural(view.alerts.length - 6, "alerta más", "alertas más")} en los días de abajo.
            </p>
          )}
        </div>
      )}

      {/* La semana */}
      <ol
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0"
        aria-label="Turnos de los próximos 7 días"
      >
        {view.days.map((d, i) => (
          <li
            key={d.day}
            style={{ animationDelay: `${i * 40}ms` }}
            className={cn(
              "min-h-[11rem] w-40 shrink-0 snap-start space-y-2 rounded-xl border p-2.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-backwards motion-safe:duration-500 md:w-auto",
              d.isToday ? "border-trust/50 bg-trust/5 ring-1 ring-trust/20" : "border-border",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {d.isToday ? "Hoy" : d.label.split(" ")[0]}
              </p>
              <p className="font-display text-lg font-bold">{d.label.split(" ")[1]}</p>
            </div>
            {(d.hours > 0 || d.openPositions > 0) && (
              <p className="text-[10px] text-muted-foreground">
                {d.hours > 0 && `${hoursEs(d.hours)} h`}
                {d.hours > 0 && d.openPositions > 0 && " · "}
                {d.openPositions > 0 && (
                  <span className="font-semibold text-copper">{d.openPositions} sin cubrir</span>
                )}
              </p>
            )}
            {d.shifts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Sin turnos</p>
            ) : (
              <ul className="space-y-1">
                {d.shifts.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(s)}
                      className={cn(
                        "w-full rounded-lg border px-1.5 py-1 text-left text-[11px] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-safe:active:scale-[0.98]",
                        STATUS_TONE[s.status],
                      )}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="font-semibold tabular-nums">
                          {timeLabelEs(s.startsAt)}
                        </span>
                        {s.risk && s.status !== "cancelled" && (
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              RISK_TONE[s.risk.level].dot,
                            )}
                            title={RISK_TONE[s.risk.level].label}
                            aria-label={RISK_TONE[s.risk.level].label}
                          />
                        )}
                      </span>
                      <span className="block truncate">{s.professionalName ?? "Profesional"}</span>
                      <span className="block truncate opacity-80">{STATUS_LABEL[s.status]}</span>
                    </button>
                  </li>
                ))}
                {d.shifts.length > 4 && (
                  <li className="px-1 text-[10px] text-muted-foreground">
                    +{d.shifts.length - 4} más
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {premium && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(Object.keys(RISK_TONE) as ProRiskLevel[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", RISK_TONE[k].dot)} aria-hidden="true" />
              {RISK_TONE[k].label}
            </span>
          ))}
        </p>
      )}

      {/* Reporte de utilización y exportes */}
      {premium ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 font-display text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-trust" aria-hidden="true" /> Utilización · últimos{" "}
              {REPORT_DAYS} días
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadText(
                    `agenda-${fileDate(now)}.csv`,
                    `﻿${agendaCsv(view)}`,
                    "text/csv;charset=utf-8",
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" /> CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadText(
                    `agenda-${fileDate(now)}.ics`,
                    agendaIcs(view, now),
                    "text/calendar;charset=utf-8",
                  )
                }
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Calendario
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Cumplimiento (%)" value={report.completionPct} tone="text-ok" />
            <Kpi
              label="Inasistencias (%)"
              value={report.noShowPct}
              tone={(report.noShowPct ?? 0) >= 10 ? "text-sos" : "text-foreground"}
            />
            <Kpi label="Horas registradas (%)" value={report.utilizationPct} tone="text-trust" />
            <Kpi label="Puntualidad (%)" value={report.punctualPct} tone="text-biosensor" />
          </div>
          <div aria-label="Turnos cumplidos por día de la semana">
            <div className="flex h-16 items-end gap-1.5">
              {report.byWeekday.map((n, i) => {
                const max = Math.max(1, ...report.byWeekday);
                return (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
                    <div
                      className={cn(
                        "w-full rounded-t-md motion-safe:transition-[height] motion-safe:duration-700",
                        i === report.busiestWeekday ? "bg-trust" : "bg-trust/30",
                      )}
                      style={{ height: `${Math.max(4, (n / max) * 100)}%` }}
                      title={`${n} turnos`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1.5 text-center text-[10px] text-muted-foreground">
              {["L", "M", "X", "J", "V", "S", "D"].map((l) => (
                <span key={l} className="flex-1">
                  {l}
                </span>
              ))}
            </div>
          </div>
          <ul className="space-y-1 text-sm">
            {report.insights.map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-trust" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <PremiumPreview
          min="institution_monthly"
          icon={<BarChart3 className="h-4 w-4 text-trust" aria-hidden="true" />}
          title="Agenda inteligente"
          description="Anticipa inasistencias y mide cómo se usan tus turnos."
          bullets={[
            "Riesgo de inasistencia de cada profesional según su historial con tu institución",
            `Reporte de utilización de ${REPORT_DAYS} días: cumplimiento, inasistencias, horas registradas y puntualidad`,
            "Exporta tu semana a CSV o a tu calendario (Google, Outlook o el celular)",
          ]}
          teaser={
            report.committed > 0
              ? `Tienes ${plural(report.committed, "turno", "turnos")} en los últimos ${REPORT_DAYS} días listos para analizar.`
              : null
          }
        />
      )}

      {/* Detalle del turno */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {dayLabelEs(selected.startsAt)} · {timeLabelEs(selected.startsAt)} –{" "}
                  {timeLabelEs(selected.endsAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {selected.professionalName ?? "Profesional"}
                </p>
                <p className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {hoursEs(selected.hours)} h ·{" "}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs",
                      STATUS_TONE[selected.status],
                    )}
                  >
                    {STATUS_LABEL[selected.status]}
                  </span>
                </p>
                {selected.risk ? (
                  <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
                    <ShieldAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-semibold">{RISK_TONE[selected.risk.level].label}</p>
                      <p className="text-xs text-muted-foreground">{selected.risk.reason}</p>
                    </div>
                  </div>
                ) : !premium ? (
                  <p className="text-xs text-muted-foreground">
                    Con el plan Institucional ves aquí el riesgo de inasistencia de esta persona
                    según su historial con tu institución.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {needsReminder(selected, now) && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a
                        href={whatsappLink(null, reminderText(selected, now))}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Preparar recordatorio en WhatsApp (tú eliges a quién enviarlo)"
                      >
                        <Send className="h-4 w-4" aria-hidden="true" /> Preparar recordatorio
                      </a>
                    </Button>
                  )}
                  <Button asChild size="sm" className="gap-1.5">
                    <Link to="/servicio/$bookingId" params={{ bookingId: selected.id }}>
                      Gestionar el servicio{" "}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
