// Calidad y cumplimiento: seis indicadores de lo que ya ocurrió en los servicios de la institución, cada uno con su meta
// y de dónde sale el número, y la lista de servicios para revisar (lógica en `lib/instQuality`). Es una guía para revisar
// y mejorar, no una acusación: no contacta a nadie ni cambia nada.
import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { StatTile } from "@/components/humanix/premium/StatTile";
import {
  type QualityMetric,
  type QualityReport,
  type QualitySeverity,
  type QualityStatus,
  type ReviewItem,
  type ShortItem,
} from "@/lib/instQuality";
import { dayLabelEs, hoursEs, msOf, plural, timeLabelEs } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const TONE: Record<QualitySeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** El estado se dice con palabras, no solo con color. */
const STATUS: Record<
  QualityStatus,
  { word: string; chip: string; bar: string; Icon: typeof Info; box: string }
> = {
  ok: {
    word: "En verde",
    chip: "border-ok/40 bg-ok/10 text-ok",
    bar: "bg-ok",
    Icon: CheckCircle2,
    box: "border-ok/25 from-ok/10 to-trust/10",
  },
  watch: {
    word: "Por mejorar",
    chip: "border-warn/40 bg-warn/10 text-warn",
    bar: "bg-warn",
    Icon: AlertCircle,
    box: "border-warn/30 from-warn/10 to-background",
  },
  alert: {
    word: "En rojo",
    chip: "border-sos/40 bg-sos/10 text-sos",
    bar: "bg-sos",
    Icon: AlertTriangle,
    box: "border-sos/30 from-sos/10 to-background",
  },
  unknown: {
    word: "Sin datos suficientes",
    chip: "border-border bg-muted/40 text-muted-foreground",
    bar: "bg-muted-foreground/40",
    Icon: Info,
    box: "border-border from-muted/40 to-background",
  },
};

function MetricRow({ m }: { m: QualityMetric }) {
  const st = STATUS[m.status];
  return (
    <li className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{m.label}</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            st.chip,
          )}
        >
          <st.Icon className="h-3 w-3" aria-hidden="true" /> {st.word}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <p className="w-16 shrink-0 font-display text-xl font-bold tabular-nums">
          {m.value === null ? "—" : `${m.value} %`}
        </p>
        <div
          className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={
            m.value === null
              ? `${m.label}: sin datos suficientes`
              : `${m.label}: ${m.value} %, meta ${m.target} %`
          }
        >
          {m.value !== null && (
            <div className={cn("h-full rounded-full", st.bar)} style={{ width: `${m.value}%` }} />
          )}
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/60"
            style={{ left: `${m.target}%` }}
            aria-hidden="true"
          />
        </div>
        <p className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] text-muted-foreground">
          meta {m.target}&nbsp;%
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{m.detail}</p>
    </li>
  );
}

function when(iso: string): string {
  const t = msOf(iso);
  return Number.isFinite(t) ? `${dayLabelEs(t)} · ${timeLabelEs(t)}` : "Fecha sin dato";
}

/** Un grupo de servicios para revisar; cada uno abre el detalle del servicio. */
function ReviewGroup({
  title,
  hint,
  items,
  names,
  extra,
}: {
  title: string;
  hint: string;
  items: ReviewItem[];
  names: Record<string, string>;
  extra?: (item: ReviewItem) => string | null;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-1.5">
      <h5 className="text-sm font-semibold">{title}</h5>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.bookingId}>
            <Link
              to="/servicio/$bookingId"
              params={{ bookingId: i.bookingId }}
              className="flex flex-wrap items-center justify-between gap-x-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{when(i.scheduledAt)}</span>
              <span className="text-xs text-muted-foreground">
                {names[i.professionalId] ?? "Profesional"}
                {extra?.(i) ? ` · ${extra(i)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QualityCard({
  report,
  names,
  loading,
  error,
  className,
}: {
  report: QualityReport | null;
  /** Nombre por profesional, para los servicios por revisar. */
  names: Record<string, string>;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const st = report ? STATUS[report.level] : STATUS.unknown;
  const r = report?.review;
  const nothingToReview =
    r &&
    r.unstarted.length +
      r.unclosed.length +
      r.short.length +
      r.undocumented.length +
      r.noContract.length ===
      0;

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Calidad y cumplimiento">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-ok" aria-hidden="true" /> Calidad y cumplimiento
        </h3>
        <p className="text-xs text-muted-foreground">
          Si el turno se cumplió, si llegaron a tiempo, si quedó el parte y el contrato, y si quien
          atendió tiene el RETHUS verificado.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus servicios. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <p
            className={cn(
              "flex items-start gap-3 rounded-2xl border bg-gradient-to-br p-4 text-base font-medium leading-snug",
              st.box,
            )}
          >
            <st.Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{report.headline}</span>
          </p>

          {report.hasData && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                label="Servicios del periodo"
                value={report.services.due}
                hint={`${report.services.completed} terminados`}
              />
              <StatTile
                label="Cancelados"
                value={report.services.cancelled}
                hint={
                  report.services.cancelled > 0
                    ? `${report.services.cancelledByProfessional} por el profesional · ${report.services.cancelledByInstitution} por tu institución${
                        report.services.cancelledUnknown > 0
                          ? ` · ${report.services.cancelledUnknown} sin dato`
                          : ""
                      }`
                    : "ninguno"
                }
              />
              <StatTile
                label="Alertas del parte"
                value={report.incidents ? report.incidents.count : "—"}
                hint={
                  report.incidents
                    ? `en ${plural(report.incidents.services, "servicio", "servicios")}`
                    : "todavía no se cargó el parte"
                }
                tone={report.incidents && report.incidents.count > 0 ? "warn" : undefined}
              />
              <StatTile
                label="Horas registradas"
                value={`${hoursEs(report.hours.worked)} h`}
                hint={`de ${hoursEs(report.hours.contracted)} h contratadas`}
              />
            </dl>
          )}

          {report.hasData && (
            <ul aria-label="Indicadores de calidad" className="space-y-2">
              {report.metrics.map((m) => (
                <MetricRow key={m.key} m={m} />
              ))}
            </ul>
          )}

          {report.hasData && r && (
            <section aria-label="Servicios para revisar" className="space-y-3">
              <h4 className="text-sm font-semibold">Para revisar</h4>
              {nothingToReview ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Nada para revisar en este periodo.
                </p>
              ) : (
                <>
                  <ReviewGroup
                    title="Sin iniciar"
                    hint="Ya pasó la hora y no se registró el inicio. Confirma qué pasó."
                    items={r.unstarted}
                    names={names}
                  />
                  <ReviewGroup
                    title="Sin cerrar"
                    hint="Empezaron, pero el parte sigue abierto mucho después del fin del turno."
                    items={r.unclosed}
                    names={names}
                  />
                  <ReviewGroup
                    title="Con menos horas registradas que las contratadas"
                    hint="Puede ser un cierre anticipado o tardío del parte: revísalo antes de dar nada por hecho."
                    items={r.short}
                    names={names}
                    extra={(i) => {
                      const s = i as ShortItem;
                      return `${hoursEs(s.worked)} h de ${hoursEs(s.contracted)} h · ${formatCOP(s.value)} en juego`;
                    }}
                  />
                  <ReviewGroup
                    title="Sin parte del turno"
                    hint="Terminó, pero no hay registros del cuidado."
                    items={r.undocumented}
                    names={names}
                  />
                  <ReviewGroup
                    title="Sin contrato firmado"
                    hint="Nacieron de un turno publicado y no tienen contrato firmado por ambas partes."
                    items={r.noContract}
                    names={names}
                  />
                </>
              )}
            </section>
          )}

          <InsightList
            label="Hallazgos de calidad"
            items={report.insights.map((i) => ({
              id: i.id,
              tone: TONE[i.severity],
              title: i.title,
              detail: i.detail,
              action: i.action,
            }))}
          />

          <p className="text-[11px] text-muted-foreground">
            Un indicador sin muestra suficiente no se muestra como cero: dice «sin datos
            suficientes». Es una guía para revisar, no una acusación; Humanix no contacta a nadie
            por ti.
          </p>
        </>
      )}
    </Card>
  );
}
