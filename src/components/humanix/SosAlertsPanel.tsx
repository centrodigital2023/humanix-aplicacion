// Alertas SOS abiertas: lo que ven y atienden el círculo de cuidado, el profesional con servicio vigente, la institución y la propia
// persona. La lista es la que dejan ver las políticas de la base (`my_sos_alerts`), se actualiza sola (Realtime) y las acciones
// («ya voy», resuelta, falsa alarma) las ejecuta la base con quién y cuándo — nadie puede atenderla a nombre de otro.
import { Siren, MapPin, Phone, CheckCircle2, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSosAction, useSosAlerts } from "@/hooks/use-sos";
import {
  EMERGENCY_NUMBER,
  EMERGENCY_TEL,
  SOS_ACTION_LABEL,
  SOS_STATUS_LABEL,
  activeSosCount,
  isSosOpen,
  mapsLink,
  sosActionsFor,
  sosAgeLabel,
  sosHandledLine,
  type SosAction,
  type SosAlertRow,
} from "@/lib/sos";

function AlertRow({
  row,
  busyId,
  onAction,
}: {
  row: SosAlertRow;
  busyId: string | null;
  onAction: (id: string, action: SosAction) => void;
}) {
  const open = isSosOpen(row.status);
  const map = mapsLink(row.lat, row.lng);
  const handled = sosHandledLine(row);
  return (
    <li
      className={`rounded-xl border p-3 ${
        row.status === "active" ? "border-destructive/50 bg-destructive/5" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {row.mine ? "Tú pediste ayuda" : `${row.patient_name ?? "Una persona"} pidió ayuda`}
          </p>
          <p className="text-xs text-muted-foreground">
            {sosAgeLabel(row.created_at)}
            {row.triggered_by_name ? ` · lo activó ${row.triggered_by_name}` : ""}
          </p>
        </div>
        <Badge variant={row.status === "active" ? "destructive" : "secondary"}>
          {SOS_STATUS_LABEL[row.status]}
        </Badge>
      </div>

      {handled && <p className="mt-1 text-xs text-muted-foreground">{handled}</p>}

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {map ? (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={map} target="_blank" rel="noopener noreferrer">
                <MapPin className="h-3.5 w-3.5" />
                Ver ubicación
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Sin ubicación: contáctalo ya.</span>
          )}
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={EMERGENCY_TEL}>
              <Phone className="h-3.5 w-3.5" />
              {EMERGENCY_NUMBER}
            </a>
          </Button>
          {sosActionsFor(row.status).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === "acknowledge" ? "destructive" : "ghost"}
              disabled={busyId === row.id}
              onClick={() => onAction(row.id, a)}
              className="gap-1.5"
            >
              {busyId === row.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : a === "acknowledge" ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {SOS_ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

export function SosAlertsPanel({
  userId,
  hideWhenEmpty = true,
  className = "",
}: {
  userId: string | null | undefined;
  /** Con la lista vacía, no ocupa lugar (profesionales e instituciones); la familia puede dejarla visible. */
  hideWhenEmpty?: boolean;
  className?: string;
}) {
  const alerts = useSosAlerts(userId);
  const act = useSosAction(userId);
  const rows = alerts.data ?? [];
  const active = activeSosCount(rows);

  if (alerts.isLoading) return null;
  if (rows.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card className={`p-4 ${className}`}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Siren className="h-4 w-4" /> Sin alertas SOS en los últimos 7 días.
        </p>
      </Card>
    );
  }

  const onAction = (id: string, action: SosAction) => {
    act.mutate(
      { id, action },
      {
        onSuccess: () =>
          toast.success(
            action === "acknowledge" ? "Marcaste que vas en camino" : "Alerta actualizada",
          ),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "No se pudo actualizar la alerta"),
      },
    );
  };

  return (
    <Card className={`p-4 ${active > 0 ? "border-destructive/50" : ""} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-bold">
          <Siren className={`h-4 w-4 ${active > 0 ? "text-destructive animate-pulse" : ""}`} />
          Alertas SOS
        </h3>
        {active > 0 && (
          <Badge variant="destructive">
            {active} activa{active === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <AlertRow
            key={r.id}
            row={r}
            busyId={act.isPending ? (act.variables?.id ?? null) : null}
            onAction={onAction}
          />
        ))}
      </ul>
    </Card>
  );
}
