// Historia de cuidado exportable (plan de pago). Todos los servicios con el resumen de su parte: registros, alertas,
// ánimo y si se agradeció. Pensada para el médico tratante, la familia y, en instituciones, para auditoría. El plan se
// valida en el servidor; aquí solo se muestra o se invita a activarlo.
import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UpgradeCta } from "@/components/humanix/PlanGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyError, useCareHistory } from "@/hooks/use-care-loop";
import { usePlan } from "@/hooks/use-plan";
import { MOOD_META, isCareMood } from "@/lib/careLog";
import {
  STATUS_ES,
  bogotaDateTime,
  historyFilename,
  historyToCsv,
  historyTotals,
  rangeError,
  rangeLastDays,
} from "@/lib/careExport";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 10;

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CareHistoryCard({
  userId,
  kind,
  className,
}: {
  userId: string;
  kind: "family" | "institution";
  className?: string;
}) {
  const plan = usePlan(userId);
  const initial = useMemo(() => rangeLastDays(90), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [requested, setRequested] = useState<{ from: string; to: string } | null>(null);
  const allowed = plan.can("care_history_export");
  const history = useCareHistory(userId, requested ?? { from, to }, allowed && requested !== null);
  const invalid = rangeError(from, to);

  if (plan.loading) return <Skeleton className="h-32 w-full" />;

  const intro =
    kind === "institution"
      ? "Descarga el historial de turnos con su parte: registros, alertas, incidentes y ánimo. Útil para auditorías, calidad y coordinación con tus equipos."
      : "Descarga el historial de los servicios de tu familiar con el resumen de cada parte. Útil para llevar al médico tratante y para tener todo en orden.";

  if (!allowed) {
    return (
      <Card className={cn("space-y-3 p-4 sm:p-5", className)} aria-label="Historia de cuidado">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <FileSpreadsheet className="h-4 w-4 text-copper" aria-hidden="true" /> Historia de cuidado
        </h2>
        <p className="text-xs text-muted-foreground">{intro}</p>
        <UpgradeCta
          min="essential_monthly"
          title="Exporta tu historia de cuidado"
          description="Disponible desde el plan Esencial (COP 9.000/mes), sin permanencia."
        />
      </Card>
    );
  }

  const rows = history.data ?? [];
  const totals = historyTotals(rows);

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Historia de cuidado">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <FileSpreadsheet className="h-4 w-4 text-copper" aria-hidden="true" /> Historia de cuidado
        </h2>
        <p className="text-xs text-muted-foreground">{intro}</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          setRequested({ from, to });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`hist-from-${kind}`} className="text-xs">
            Desde
          </Label>
          <Input
            id={`hist-from-${kind}`}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`hist-to-${kind}`} className="text-xs">
            Hasta
          </Label>
          <Input
            id={`hist-to-${kind}`}
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["30 días", 30],
            ["90 días", 90],
            ["12 meses", 365],
          ].map(([label, days]) => (
            <Button
              key={String(label)}
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs"
              onClick={() => {
                const r = rangeLastDays(Number(days));
                setFrom(r.from);
                setTo(r.to);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button type="submit" size="sm" disabled={!!invalid || history.isFetching}>
          {history.isFetching && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          Ver historia
        </Button>
      </form>
      {invalid && <p className="text-xs text-destructive">{invalid}</p>}

      {history.error ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {friendlyError(
            history.error,
            "No pudimos cargar la historia. Inténtalo de nuevo en un momento.",
          )}
        </p>
      ) : history.data ? (
        rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No hay servicios en ese rango.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Servicios", totals.services],
                ["Completados", totals.completed],
                ["Horas", totals.hours],
                ["Alertas", totals.alerts],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-border bg-card p-3 text-center"
                >
                  <dd className="font-display text-xl font-bold leading-none">{String(value)}</dd>
                  <dt className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </dt>
                </div>
              ))}
            </dl>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fecha</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2 font-semibold">Profesional</th>
                    <th className="px-3 py-2 text-right font-semibold">Registros</th>
                    <th className="px-3 py-2 text-right font-semibold">Alertas</th>
                    <th className="px-3 py-2 font-semibold">Ánimo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.booking_id}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {bogotaDateTime(r.scheduled_at)}
                      </td>
                      <td className="px-3 py-2">{STATUS_ES[r.status] ?? r.status}</td>
                      <td className="px-3 py-2">{r.professional ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.events}</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right",
                          r.alerts > 0 && "font-semibold text-sos",
                        )}
                      >
                        {r.alerts}
                      </td>
                      <td className="px-3 py-2">
                        {isCareMood(r.last_mood)
                          ? `${MOOD_META[r.last_mood].emoji} ${MOOD_META[r.last_mood].label}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_ROWS && (
              <p className="text-xs text-muted-foreground">
                Mostrando {PREVIEW_ROWS} de {rows.length}: el archivo trae todos.
              </p>
            )}

            <Button
              type="button"
              variant="hero"
              size="sm"
              className="gap-2"
              onClick={() => {
                try {
                  downloadCsv(historyFilename(), historyToCsv(rows));
                  toast.success("Archivo descargado. Ábrelo con Excel.");
                } catch {
                  toast.error("No se pudo descargar el archivo");
                }
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Descargar para Excel (CSV)
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Contiene datos de salud: compártelo solo con quien tú decidas. No incluye teléfonos,
              direcciones ni valores de pago.
            </p>
          </>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Elige el rango y toca «Ver historia».</p>
      )}
    </Card>
  );
}
