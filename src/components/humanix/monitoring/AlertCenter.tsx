// Centro de alertas: cada alerta con su plazo corriendo (crítica 10 min, urgente 30 min, atención 2 h), la guía de qué hacer y los dos pasos
// que importan: «Ya la vi» (queda quién y cuándo) y «Resolver» (cómo se resolvió). Con el plan IPS Mejorado, la que nadie ve a tiempo se escala
// sola. Esto apoya la decisión clínica; no la reemplaza.
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock as ClockIcon,
  Eye,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CareActions } from "@/hooks/use-inst-care";
import { dayClockLabel, type Clock } from "@/lib/instCare";
import type { InstAlert, InstPatient } from "@/lib/instCareTypes";
import {
  ALERT_TITLE,
  SEVERITY_META,
  alertGuidance,
  alertSla,
  sortAlerts,
} from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/humanix/instcare/PersonAvatar";
import { TONE } from "@/components/humanix/instcare/tones";
import { friendlyError } from "@/lib/friendlyError";

const RESOLUTIONS = [
  { value: "treated", label: "Se atendió y se resolvió" },
  { value: "false_alarm", label: "Falsa alarma (dato mal tomado o sensor suelto)" },
  { value: "transferred", label: "Se trasladó o se escaló a otro servicio" },
  { value: "other", label: "Otro motivo" },
] as const;

function ResolveDialog({
  alert,
  onOpenChange,
  actions,
}: {
  alert: InstAlert | null;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
}) {
  const [resolution, setResolution] = useState<string>("treated");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (alert) {
      setResolution("treated");
      setNote("");
      setError(null);
    }
  }, [alert]);
  const save = async () => {
    if (!alert) return;
    setBusy(true);
    setError(null);
    try {
      await actions.resolveAlert.mutateAsync({ id: alert.id, resolution, note });
      toast.success("Alerta resuelta");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={alert !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="resolve-alert">
        <DialogHeader>
          <DialogTitle>Resolver la alerta</DialogTitle>
          <DialogDescription>
            {alert ? ALERT_TITLE[alert.reason] : ""}. Queda escrito quién la resolvió y cómo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="resolve-how" className="text-xs font-medium">
              ¿Cómo se resolvió?
            </Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger id="resolve-how">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resolve-note" className="text-xs font-medium">
              Nota
            </Label>
            <Textarea
              id="resolve-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="Opcional. Qué se hizo, a quién se avisó…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="hero" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} Resolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlertCard({
  alert,
  patient,
  now,
  canWrite,
  onOpenPatient,
  onResolve,
  actions,
}: {
  alert: InstAlert;
  patient?: Pick<InstPatient, "id" | "full_name" | "room">;
  now: Clock;
  canWrite: boolean;
  onOpenPatient?: (id: string) => void;
  onResolve: (a: InstAlert) => void;
  actions: CareActions;
}) {
  const sev = SEVERITY_META[alert.severity];
  const sla = alertSla(alert, now);
  const t =
    TONE[alert.severity === "critical" ? "sos" : alert.severity === "urgent" ? "warn" : "copper"];
  const [open, setOpen] = useState(false);

  const ack = async () => {
    try {
      await actions.ackAlert.mutateAsync({ id: alert.id });
      toast.success("Quedó registrado que la viste");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  return (
    <li
      className={cn(
        "rounded-2xl border p-3 sm:p-4",
        alert.status === "open"
          ? cn(t.border, "bg-gradient-to-br", t.wash)
          : "border-border bg-card",
        sla.state === "overdue" && "ring-1 ring-sos/40",
      )}
      data-testid="alert-item"
      data-severity={alert.severity}
      data-status={alert.status}
    >
      <div className="flex items-start gap-3">
        {patient && <PersonAvatar name={patient.full_name} id={patient.id} size="sm" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                t.chip,
              )}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden /> {sev.label}
            </span>
            <p className="text-sm font-semibold">{ALERT_TITLE[alert.reason]}</p>
            {alert.occurrences > 1 && (
              <span className="text-[11px] text-muted-foreground">
                se repitió {alert.occurrences} veces
              </span>
            )}
          </div>
          {patient && (
            <p className="mt-0.5 text-xs">
              {onOpenPatient ? (
                <button
                  type="button"
                  className="font-semibold underline-offset-2 hover:underline focus-premium"
                  onClick={() => onOpenPatient(patient.id)}
                >
                  {patient.full_name}
                </button>
              ) : (
                <span className="font-semibold">{patient.full_name}</span>
              )}
              {patient.room ? (
                <span className="text-muted-foreground"> · hab. {patient.room}</span>
              ) : null}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{alert.message}</p>
          <p
            className={cn(
              "mt-1.5 inline-flex items-center gap-1 text-xs font-medium",
              sla.state === "overdue"
                ? "text-sos"
                : sla.state === "due_soon"
                  ? "text-warn"
                  : "text-muted-foreground",
            )}
            aria-live={sla.state === "overdue" ? "polite" : "off"}
          >
            {sla.state === "seen" ? (
              <Eye className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ClockIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {sla.label}
          </p>
          {alert.escalated_at && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sos">
              <BellRing className="h-3 w-3" aria-hidden /> Se avisó de nuevo al equipo{" "}
              {dayClockLabel(alert.escalated_at, now)}
            </p>
          )}
          {sla.state !== "seen" && sla.state !== "resolved" && sla.remainingMs !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-1000 motion-reduce:transition-none",
                  sla.state === "overdue"
                    ? "bg-sos"
                    : sla.state === "due_soon"
                      ? "bg-warn"
                      : t.solid,
                )}
                style={{ width: `${Math.round(sla.elapsed * 100)}%` }}
              />
            </div>
          )}
          {alert.ack_note && (
            <p className="mt-1.5 text-xs italic text-muted-foreground">«{alert.ack_note}»</p>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 text-[11px] font-medium text-trust underline-offset-2 hover:underline focus-premium"
          >
            {open ? "Ocultar la guía" : "¿Qué hago?"}
          </button>
          {open && (
            <p className="mt-1.5 rounded-xl bg-muted/50 p-2.5 text-xs leading-relaxed">
              {alertGuidance(alert)}
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Apoyo a la decisión clínica; no reemplaza el criterio del profesional.
              </span>
            </p>
          )}
        </div>
      </div>
      {canWrite && alert.status !== "resolved" && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {alert.status === "open" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void ack()}
              disabled={actions.ackAlert.isPending}
            >
              <Eye aria-hidden /> Ya la vi
            </Button>
          )}
          <Button type="button" size="sm" variant="hero" onClick={() => onResolve(alert)}>
            <CheckCircle2 aria-hidden /> Resolver
          </Button>
        </div>
      )}
    </li>
  );
}

export function AlertCenter({
  alerts,
  patients,
  now,
  actions,
  canWrite,
  onOpenPatient,
  title = "Alertas",
}: {
  alerts: InstAlert[];
  patients: Map<string, Pick<InstPatient, "id" | "full_name" | "room">>;
  now: Clock;
  actions: CareActions;
  canWrite: boolean;
  onOpenPatient?: (id: string) => void;
  title?: string;
}) {
  const [resolving, setResolving] = useState<InstAlert | null>(null);
  const open = sortAlerts(alerts.filter((a) => a.status !== "resolved"));
  if (open.length === 0) return null;
  const unseen = open.filter((a) => a.status === "open").length;
  return (
    <section aria-label={title} data-testid="alert-center" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-sm font-bold">
          <AlertTriangle className="h-4 w-4 text-sos" aria-hidden /> {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {open.length} {open.length === 1 ? "abierta" : "abiertas"}
          {unseen > 0 && <span className="font-semibold text-sos"> · {unseen} sin ver</span>}
        </span>
      </div>
      <ul className="space-y-2">
        {open.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            patient={patients.get(a.patient_id)}
            now={now}
            canWrite={canWrite}
            onOpenPatient={onOpenPatient}
            onResolve={setResolving}
            actions={actions}
          />
        ))}
      </ul>
      <ResolveDialog
        alert={resolving}
        onOpenChange={(o) => !o && setResolving(null)}
        actions={actions}
      />
    </section>
  );
}
