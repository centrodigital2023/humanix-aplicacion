// Parte del turno en vivo: lo que la familia, su círculo de cuidado y la institución ven mientras el profesional
// atiende (medicamentos, comidas, signos vitales, ánimo, alertas), y el resumen final cuando termina.
import { ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCareLogs, useCareReport } from "@/hooks/use-care-loop";
import { bogotaDay } from "@/lib/careLog";
import { cn } from "@/lib/utils";
import { CareTimeline } from "@/components/humanix/care/CareTimeline";
import { ShiftSummary } from "@/components/humanix/care/ShiftSummary";

type Props = {
  bookingId: string;
  /** Estado de la reserva: define el texto cuando todavía no hay registros. */
  status?: string;
  className?: string;
};

function emptyCopy(status?: string): string {
  switch (status) {
    case "in_progress":
      return "Aún no hay registros. Verás aquí medicamentos, comidas, signos vitales y novedades en cuanto el profesional los anote.";
    case "completed":
      return "Este turno terminó sin registros escritos.";
    case "cancelled":
      return "El servicio fue cancelado: no hay parte del turno.";
    default:
      return "El parte aparece aquí cuando el profesional comienza el turno: medicamentos, comidas, signos vitales y novedades, en vivo.";
  }
}

export function CareFeed({ bookingId, status, className }: Props) {
  const logs = useCareLogs(bookingId);
  const rows = logs.data ?? [];
  const report = useCareReport(bookingId, rows.length > 0);
  const inProgress = status === "in_progress";

  const refresh = () => {
    void logs.refetch();
    void report.refetch();
  };

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Parte del turno">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ClipboardList className="h-4 w-4 text-biosensor" aria-hidden="true" /> Parte del turno
          {inProgress && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                logs.live ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground",
              )}
              title={
                logs.live
                  ? "Recibes cada registro apenas se guarda"
                  : "Sin conexión en vivo: usa «Actualizar»"
              }
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  logs.live ? "animate-pulse bg-ok" : "bg-muted-foreground/60",
                )}
                aria-hidden="true"
              />
              {logs.live ? "En vivo" : "Sin conexión en vivo"}
            </span>
          )}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={refresh}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", logs.isFetching && "animate-spin")}
            aria-hidden="true"
          />{" "}
          Actualizar
        </Button>
      </div>

      {logs.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : logs.error ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar el parte del turno. Revisa tu conexión y toca «Actualizar».
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {emptyCopy(status)}
        </p>
      ) : (
        <>
          {/* Si el servidor aún no ofrece el resumen, el parte se muestra igual. */}
          {report.data && (
            <ShiftSummary
              report={report.data}
              inProgress={inProgress}
              alertReasons={rows
                .filter((r) => r.is_alert && !r.system_generated)
                .map((r) => r.alert_reason || r.description)}
            />
          )}
          <div aria-live="polite">
            <CareTimeline logs={rows} todayDay={bogotaDay(new Date().toISOString())} />
          </div>
        </>
      )}
    </Card>
  );
}
