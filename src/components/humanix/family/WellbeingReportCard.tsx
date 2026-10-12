// Informe de bienestar (plan Esencial): cómo ha estado la persona cuidada según los partes que registran los
// profesionales (lógica en `lib/wellbeing`). No diagnostica: señala lo que merece conversarse con el médico.
import { ClipboardCopy, Download, HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CARE_MOODS, MOOD_META, type CareMood } from "@/lib/careLog";
import { dateEs, dayLabelEs, msOf, bogotaYmd } from "@/lib/familyIntelShared";
import {
  WELLBEING_WINDOWS,
  averageText,
  doctorSummary,
  type HighlightSeverity,
  type ReadingLevel,
  type VitalSummary,
  type WellbeingReport,
} from "@/lib/wellbeing";
import { cn } from "@/lib/utils";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { Sparkline } from "@/components/humanix/premium/Sparkline";

const TONE: Record<HighlightSeverity, InsightTone> = {
  alert: "alert",
  watch: "warn",
  ok: "ok",
  info: "info",
};

const MOOD_BAR: Record<CareMood, string> = {
  happy: "bg-ok",
  calm: "bg-biosensor",
  tired: "bg-muted-foreground/40",
  sad: "bg-trust",
  pain: "bg-warn",
  agitated: "bg-sos",
};

const LEVEL: Record<ReadingLevel, { text: string; cls: string }> = {
  ok: { text: "Dentro de lo esperado", cls: "text-ok" },
  watch: { text: "A vigilar", cls: "text-warn" },
  alert: { text: "Fuera de rango", cls: "text-sos" },
};

const CONFIDENCE = {
  low: "baja: pocos datos",
  medium: "media",
  high: "alta",
} as const;

function fileName(now: number): string {
  const { y, m, d } = bogotaYmd(now);
  return `resumen-de-cuidado-${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}.txt`;
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function VitalRow({ s }: { s: VitalSummary }) {
  const last = s.last;
  const level = last ? LEVEL[last.level] : null;
  const lastText = last
    ? `${s.key === "bp" ? `${last.value}${last.value2 !== null ? `/${last.value2}` : ""}` : last.value} ${s.unit}`
    : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{s.label}</p>
        <p className="text-xs text-muted-foreground">
          Promedio {averageText(s)} · {s.readings} {s.readings === 1 ? "lectura" : "lecturas"}
          {s.watch + s.alert > 0 && ` · ${s.watch + s.alert} fuera de lo esperado`}
        </p>
        {last && level && (
          <p className="mt-0.5 text-xs">
            Última: <strong>{lastText}</strong> ({dayLabelEs(msOf(last.at))}) ·{" "}
            <span className={cn("font-semibold", level.cls)}>{level.text}</span>
          </p>
        )}
      </div>
      <Sparkline
        values={s.series}
        label={`Evolución de ${s.label.toLowerCase()}: de ${s.series[0]} a ${s.series[s.series.length - 1]} ${s.unit}`}
      />
    </li>
  );
}

export function WellbeingReportCard({
  report,
  windowDays,
  onWindowChange,
  loading,
  error,
  className,
}: {
  report: WellbeingReport | null;
  windowDays: number;
  onWindowChange: (days: number) => void;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const text = report ? doctorSummary(report) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Resumen copiado. Pégalo donde quieras compartirlo.");
    } catch {
      toast.error("No se pudo copiar. Abre «Ver el resumen» para copiarlo a mano.");
    }
  };

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Informe de bienestar">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-base font-semibold">
            <HeartPulse className="h-4 w-4 text-sos" aria-hidden="true" /> Informe de bienestar
          </h3>
          <p className="text-xs text-muted-foreground">
            {report
              ? `Del ${dateEs(report.period.fromMs)} al ${dateEs(report.period.toMs)}, según los partes de cada turno.`
              : "Según los partes que registra cada profesional en cada turno."}
          </p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(windowDays)}
          onValueChange={(v) => v && onWindowChange(Number(v))}
          aria-label="Periodo del informe"
        >
          {WELLBEING_WINDOWS.map((d) => (
            <ToggleGroupItem key={d} value={String(d)} aria-label={`Últimos ${d} días`}>
              {d} días
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar los partes. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Servicios", String(report.services.count)],
              ["Horas", String(report.services.hours)],
              [
                "Con parte",
                report.services.reportedPct === null ? "—" : `${report.services.reportedPct} %`,
              ],
              ["Alertas", String(report.alerts.total)],
            ].map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border border-border bg-card p-3 text-center",
                  label === "Alertas" && report.alerts.last7d > 0 && "border-sos/40 bg-sos/5",
                )}
              >
                <dd className="font-display text-xl font-bold leading-none">{value}</dd>
                <dt className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Confianza del informe: <strong>{CONFIDENCE[report.confidence]}</strong>.
          </p>

          <InsightList
            label="Hallazgos del informe"
            items={report.highlights.map((h) => ({
              id: h.id,
              tone: TONE[h.severity],
              title: h.title,
              detail: h.detail,
              action: h.action,
            }))}
          />

          <section aria-label="Ánimo" className="space-y-2">
            <h4 className="text-sm font-semibold">Ánimo al terminar cada servicio</h4>
            {report.moods.withMood === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay ánimo registrado en este periodo.
              </p>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={`Ánimo en ${report.moods.withMood} servicios: ${CARE_MOODS.filter(
                    (m) => report.moods.counts[m] > 0,
                  )
                    .map((m) => `${MOOD_META[m].label} ${report.moods.counts[m]}`)
                    .join(", ")}`}
                  className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                >
                  {CARE_MOODS.filter((m) => report.moods.counts[m] > 0).map((m) => (
                    <span
                      key={m}
                      className={MOOD_BAR[m]}
                      style={{
                        width: `${(report.moods.counts[m] / report.moods.withMood) * 100}%`,
                      }}
                    />
                  ))}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {CARE_MOODS.filter((m) => report.moods.counts[m] > 0).map((m) => (
                    <li key={m} className="flex items-center gap-1.5">
                      <span
                        className={cn("h-2.5 w-2.5 rounded-full", MOOD_BAR[m])}
                        aria-hidden="true"
                      />
                      <span aria-hidden="true">{MOOD_META[m].emoji}</span>
                      {MOOD_META[m].label} · {report.moods.counts[m]}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-label="Signos vitales" className="space-y-2">
            <h4 className="text-sm font-semibold">Signos vitales registrados</h4>
            {report.vitals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay lecturas en este periodo.</p>
            ) : (
              <ul className="space-y-2">
                {report.vitals.map((s) => (
                  <VitalRow key={s.key} s={s} />
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-sm font-semibold">Para llevar a la consulta</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="hero"
                className="gap-2"
                onClick={() => void copy()}
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar resumen para el
                médico
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  try {
                    downloadText(fileName(report.period.toMs), text);
                    toast.success("Archivo descargado.");
                  } catch {
                    toast.error("No se pudo descargar el archivo.");
                  }
                }}
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Descargar (.txt)
              </Button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Ver el resumen</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-relaxed">
                {text}
              </pre>
            </details>
            <p className="text-[11px] text-muted-foreground">
              Contiene datos de salud: compártelo solo con quien tú decidas. No incluye nombres de
              profesionales, direcciones ni valores de pago.
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground">{report.disclaimer}</p>
        </>
      )}
    </Card>
  );
}
