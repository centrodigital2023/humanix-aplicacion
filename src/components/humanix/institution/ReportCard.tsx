// Informe de gestión para la gerencia: una frase de apertura, cifras clave, una sección por tema, lo que hay que atender y
// lo que va bien (lógica en `lib/instReport`). Se copia, se baja en texto, se imprime o se guarda como PDF desde el
// navegador, y los servicios del periodo salen en un CSV para auditoría. No incluye nombres de profesionales ni datos de
// pacientes, y no habla de pagos fuera de la página web de Humanix.
import { ClipboardCopy, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/humanix/premium/StatTile";
import { downloadText } from "@/components/humanix/premium/download";
import { reportFilename, type ExecutiveReport } from "@/lib/instReport";
import { cn } from "@/lib/utils";

/** Al imprimir solo sale el informe: el resto de la página (menús, botones, otras tarjetas) se oculta. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #inst-report-print, #inst-report-print * { visibility: visible !important; }
  #inst-report-print { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; background: white; color: black; }
}`;

/** Las líneas que empiezan con «- » son viñetas; el resto, frases sueltas. */
function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line, i) => {
        const bullet = line.startsWith("- ");
        return (
          <li key={i} className={cn(bullet && "flex gap-2")}>
            {bullet && (
              <span
                aria-hidden="true"
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-copper"
              />
            )}
            <span>{bullet ? line.slice(2) : line}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportCard({
  report,
  loading,
  error,
  now,
  getCsv,
  className,
}: {
  report: ExecutiveReport | null;
  loading: boolean;
  error: boolean;
  now: number;
  /** El CSV de servicios se arma al pulsar: no se calcula si nadie lo pide. */
  getCsv: () => string;
  className?: string;
}) {
  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      toast.success("Informe copiado. Pégalo donde quieras compartirlo.");
    } catch {
      toast.error("No se pudo copiar. Abre «Ver el informe en texto» para copiarlo a mano.");
    }
  };
  const save = (name: string, text: string, type: string, done: string) => {
    try {
      downloadText(name, text, type);
      toast.success(done);
    } catch {
      toast.error("No se pudo descargar el archivo.");
    }
  };

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Informe de gestión">
      <style>{PRINT_CSS}</style>
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <FileText className="h-4 w-4 text-copper" aria-hidden="true" /> Informe de gestión
        </h3>
        <p className="text-xs text-muted-foreground">
          Un resumen listo para la gerencia o la auditoría, con las cifras del periodo que elegiste.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos armar el informe. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-sm font-semibold">Llévalo a donde lo necesites</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="hero"
                className="w-full gap-2 sm:w-auto"
                onClick={() => void copy()}
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar informe
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={() =>
                  save(
                    reportFilename("informe", "txt", now),
                    report.text,
                    "text/plain;charset=utf-8",
                    "Informe descargado.",
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Descargar (.txt)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={() =>
                  save(
                    reportFilename("servicios", "csv", now),
                    getCsv(),
                    "text/csv;charset=utf-8",
                    "Servicios descargados.",
                  )
                }
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Servicios (CSV)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir o guardar en PDF
              </Button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Ver el informe en texto</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-relaxed">
                {report.text}
              </pre>
            </details>
            <p className="text-[11px] text-muted-foreground">
              El informe no lleva nombres de profesionales ni datos de pacientes. El CSV trae un
              renglón por servicio (fecha, profesional, estado, horas, valor, parte, contrato y
              RETHUS) para auditorías y se abre en Excel: compártelo solo con quien tú decidas.
            </p>
          </div>

          <article
            id="inst-report-print"
            aria-label={report.title}
            className="space-y-4 rounded-2xl border border-border bg-card p-4"
          >
            <header className="space-y-1">
              <h4 className="font-display text-lg font-bold leading-tight">{report.title}</h4>
              <p className="text-xs text-muted-foreground">
                {report.periodLabel} · {report.generatedLabel}
              </p>
              <p className="pt-1 text-sm leading-relaxed">{report.headline}</p>
            </header>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {report.kpis.map((k) => (
                <StatTile key={k.label} label={k.label} value={k.value} hint={k.hint} />
              ))}
            </dl>

            {report.sections.map((s) => (
              <section key={s.id} aria-label={s.title} className="space-y-1.5">
                <h5 className="text-sm font-semibold">{s.title}</h5>
                <Lines lines={s.lines} />
              </section>
            ))}

            {report.attention.length > 0 && (
              <section aria-label="Para atender" className="space-y-1.5">
                <h5 className="text-sm font-semibold">Para atender</h5>
                <Lines lines={report.attention.map((a) => `- ${a}`)} />
              </section>
            )}
            {report.highlights.length > 0 && (
              <section aria-label="Lo que va bien" className="space-y-1.5">
                <h5 className="text-sm font-semibold">Lo que va bien</h5>
                <Lines lines={report.highlights.map((h) => `- ${h}`)} />
              </section>
            )}

            <p className="text-[11px] text-muted-foreground">
              Este informe se calculó con los servicios, partes del turno y contratos de la
              institución registrados en Humanix. Un indicador sin datos suficientes no se completa:
              se muestra como tal.
            </p>
          </article>
        </>
      )}
    </Card>
  );
}
