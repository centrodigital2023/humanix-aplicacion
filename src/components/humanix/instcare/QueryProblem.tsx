// Cuando una lectura falla: si la función aún no se habilitó en esta base, se dice con calma (no es un error de la persona); si fue un
// fallo de red o de permisos, se cuenta con claridad y se ofrece reintentar.
import { AlertTriangle, Hourglass, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CareError } from "@/hooks/use-inst-care";
import { careErrorMessage } from "@/lib/instCare";

export function QueryProblem({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (error instanceof CareError && error.notEnabled) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm"
      >
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold">Esta función se está habilitando</p>
          <p className="text-muted-foreground">
            Aún no está lista en tu cuenta. En unos minutos podrás usarla; no perdiste nada.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-2xl border border-sos/30 bg-sos/5 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sos" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sos">No pudimos cargar esta información</p>
        <p className="text-muted-foreground">{careErrorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "animate-spin" : ""} aria-hidden /> Reintentar
        </Button>
      )}
    </div>
  );
}

/** Falló una actualización pero hay datos anteriores a la vista: se avisa sin esconderlos. */
export function StaleNotice({
  onRetry,
  retrying = false,
}: {
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        No pudimos actualizar: lo que ves es lo último que llegó.
      </span>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onRetry}
          disabled={retrying}
        >
          <RefreshCw className={retrying ? "animate-spin" : ""} aria-hidden /> Reintentar
        </Button>
      )}
    </div>
  );
}
