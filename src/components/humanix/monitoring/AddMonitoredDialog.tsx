// «Agregar» al monitoreo: elegir a alguien que ya está registrado (y activo) o registrar a un paciente nuevo. El tope de pacientes en
// monitoreo lo pone el plan y lo aplica el servidor; aquí se muestra antes de intentarlo.
import { useState } from "react";
import { Activity, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CareActions } from "@/hooks/use-inst-care";
import type { CareOverview } from "@/lib/instCare";
import type { InstPatient } from "@/lib/instCareTypes";
import { PatientPicker } from "@/components/humanix/instcare/PatientPicker";

export function AddMonitoredDialog({
  open,
  onOpenChange,
  patients,
  overview,
  actions,
  now,
  canRegister,
  onRegisterNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: InstPatient[];
  overview: CareOverview;
  actions: CareActions;
  now: number;
  /** ¿La persona puede registrar pacientes nuevos? */
  canRegister: boolean;
  onRegisterNew: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = patients.filter((p) => p.status === "active" && !p.monitoring);
  const full = overview.usage.monitored >= overview.limits.monitored;

  const pick = async (p: InstPatient) => {
    setBusy(p.id);
    setError(null);
    try {
      await actions.setMonitoring.mutateAsync({ patientId: p.id, on: true });
      toast.success(`${p.full_name} entró a monitoreo`);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="add-monitored">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-biosensor" aria-hidden /> Agregar al monitoreo
          </DialogTitle>
          <DialogDescription>
            Pacientes hospitalizados, remotos, posoperatorios, crónicos o adultos mayores. En
            monitoreo: {overview.usage.monitored} de {overview.limits.monitored} que permite tu
            plan.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {full ? (
          <p role="status" className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
            Llegaste al máximo de {overview.limits.monitored} pacientes en monitoreo de tu plan.
            Saca a alguien del monitoreo o mejora el plan.
          </p>
        ) : (
          <PatientPicker
            patients={candidates}
            now={now}
            disabled={busy !== null}
            emptyText="Todos tus pacientes activos ya están en monitoreo. Registra uno nuevo."
            onPick={(p) => void pick(p)}
          />
        )}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Agregando…
          </p>
        )}
        {canRegister && !full && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onRegisterNew();
            }}
          >
            <UserPlus aria-hidden /> Registrar un paciente nuevo
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
