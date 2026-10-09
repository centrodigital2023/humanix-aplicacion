// Resumen del parte del turno: duración, registros, último signo vital y ánimo. Presentacional.
import { Activity, AlertTriangle, ClipboardList, Clock, Copy, Smile } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  MOOD_META,
  VITALS_DISCLAIMER,
  durationLabel,
  formatVitals,
  moodHeadline,
  reportLastMood,
  reportToText,
  reportTone,
  vitalFlags,
  type CareReport,
} from "@/lib/careLog";
import { cn } from "@/lib/utils";

const TONE_STYLE = {
  ok: "border-ok/30 bg-ok/5",
  watch: "border-warn/40 bg-warn/5",
  alert: "border-sos/40 bg-sos/5",
} as const;

const TONE_LABEL = {
  ok: "Todo en orden",
  watch: "A vigilar",
  alert: "Con alertas",
} as const;

export function ShiftSummary({
  report,
  inProgress,
  canCopy = true,
}: {
  report: CareReport;
  inProgress: boolean;
  /** Copiar el resumen lo decide la familia o la institución; el profesional también puede. */
  canCopy?: boolean;
}) {
  const tone = reportTone(report);
  const duration = durationLabel(report.duration_minutes);
  const mood = reportLastMood(report);
  const lastMood = mood ? MOOD_META[mood] : null;
  const headline = moodHeadline(mood);
  const vitals = report.last_vitals ? formatVitals(report.last_vitals) : "";
  const flags = report.last_vitals ? vitalFlags(report.last_vitals) : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportToText(report));
      toast.success("Resumen copiado. Compártelo solo con quien tú decidas.");
    } catch {
      toast.error("No se pudo copiar el resumen");
    }
  };

  return (
    <div className={cn("rounded-2xl border p-4", TONE_STYLE[tone])} aria-label="Resumen del turno">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {inProgress ? "Resumen del turno en curso" : "Resumen del turno"}
          <span
            className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              tone === "ok" && "bg-ok/15 text-ok",
              tone === "watch" && "bg-warn/15 text-warn",
              tone === "alert" && "bg-sos/15 text-sos",
            )}
          >
            {TONE_LABEL[tone]}
          </span>
        </p>
        {canCopy && report.events > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={copy}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copiar resumen
          </Button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" /> Duración
          </dt>
          <dd className="text-sm font-semibold">{duration ?? "—"}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <ClipboardList className="h-3 w-3" aria-hidden="true" /> Registros
          </dt>
          <dd className="text-sm font-semibold">{report.events}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Alertas
          </dt>
          <dd className={cn("text-sm font-semibold", report.alerts > 0 && "text-sos")}>
            {report.alerts}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Smile className="h-3 w-3" aria-hidden="true" /> Ánimo
          </dt>
          <dd className="text-sm font-semibold">
            {lastMood ? (
              <span>
                <span aria-hidden="true">{lastMood.emoji}</span> {lastMood.label}
              </span>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {vitals && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Últimos signos vitales: <strong className="text-foreground">{vitals}</strong>
          </span>
        </p>
      )}
      {flags.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{VITALS_DISCLAIMER}</p>
      )}
      {headline && <p className="mt-2 text-sm text-foreground/90">{headline}</p>}
    </div>
  );
}
