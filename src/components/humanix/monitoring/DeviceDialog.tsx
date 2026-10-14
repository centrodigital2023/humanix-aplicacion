// Emparejar un reloj, celular, sensor o monitor con un paciente. El código se muestra UNA sola vez (en la base solo queda su huella); con él el
// dispositivo envía sus lecturas sin sesión, con freno a quien falla muchas veces. Plan IPS Mejorado. Aquí también se ve la salud de cada
// dispositivo (en línea, callado, sin conexión) y se revoca.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Check, Copy, Loader2, Lock, ShieldAlert, Unplug, Watch } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CareActions, DeviceCreated } from "@/hooks/use-inst-care";
import type { CareOverview, Clock } from "@/lib/instCare";
import type { InstDevice, InstPatient } from "@/lib/instCareTypes";
import { DEVICE_KIND_OPTIONS, deviceFormSchema, type DeviceFormValues } from "@/lib/instForms";
import { DEVICE_RULES, deviceHealth, deviceSnippets } from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { SelectField, TextField } from "@/components/humanix/instcare/fields";
import { TONE } from "@/components/humanix/instcare/tones";

const apiUrl = (): string => String(import.meta.env.VITE_SUPABASE_URL ?? "");

export function PairDeviceDialog({
  open,
  onOpenChange,
  patient,
  actions,
  overview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Pick<InstPatient, "id" | "full_name"> | null;
  actions: CareActions;
  overview: CareOverview;
}) {
  const [created, setCreated] = useState<DeviceCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceFormSchema),
    defaultValues: { label: "", kind: "smartwatch" },
  });
  const { isSubmitting } = form.formState;
  const locked = overview.limits.devices <= 0;
  const full = !locked && overview.usage.devices >= overview.limits.devices;

  useEffect(() => {
    if (open) {
      setCreated(null);
      setError(null);
      setCopied(null);
      form.reset({ label: "", kind: "smartwatch" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient?.id]);

  const submit = form.handleSubmit(async (v) => {
    if (!patient) return;
    setError(null);
    try {
      setCreated(
        await actions.createDevice.mutateAsync({
          patientId: patient.id,
          label: v.label,
          kind: v.kind,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  });

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
    }
  };

  const snippets = created ? deviceSnippets(created.code, apiUrl()) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-lg"
        data-testid="pair-device"
        // Con el código en pantalla, un clic afuera o Esc no lo cierra por accidente: se cierra con el botón o con la X.
        onInteractOutside={(e) => created && e.preventDefault()}
        onEscapeKeyDown={(e) => created && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Watch className="h-4 w-4 text-fuchsia-neural" aria-hidden /> Emparejar un dispositivo
          </DialogTitle>
          <DialogDescription>
            {patient ? `Para ${patient.full_name}. ` : ""}Los signos llegan solos, aunque nadie esté
            mirando la pantalla.
          </DialogDescription>
        </DialogHeader>

        {locked ? (
          <div className="flex items-start gap-3 rounded-2xl border border-copper/30 bg-copper/5 p-4 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden />
            <p>
              Conectar relojes y dispositivos es parte del plan IPS Mejorado. Mientras tanto puedes
              registrar los signos a mano.
            </p>
          </div>
        ) : created ? (
          <div className="space-y-4">
            <Alert role="status" className="border-warn/40 bg-warn/5">
              <ShieldAlert className="h-4 w-4 text-warn" aria-hidden />
              <AlertDescription>
                <strong>Guarda este código ahora.</strong> No se vuelve a mostrar. Si lo pierdes,
                revoca el dispositivo y empareja uno nuevo.
              </AlertDescription>
            </Alert>
            <div>
              <p className="mb-1 text-xs font-medium">Código de {created.device.label}</p>
              <div className="flex items-center gap-2">
                <code
                  data-testid="device-code"
                  className="min-w-0 flex-1 select-all break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs"
                >
                  {created.code}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy("code", created.code)}
                  aria-label="Copiar el código"
                >
                  {copied === "code" ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            </div>
            {snippets && (
              <div className="space-y-2">
                <p className="text-xs font-medium">Cómo enviar una lectura</p>
                <pre className="max-h-40 overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed">
                  {snippets.curl}
                </pre>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void copy("curl", snippets.curl)}
                >
                  {copied === "curl" ? <Check aria-hidden /> : <Copy aria-hidden />} Copiar ejemplo
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Reemplaza &lt;LLAVE_PÚBLICA_DEL_PROYECTO&gt; por la llave pública del proyecto.
                  Campos que acepta: hr, rr, spo2, sbp, dbp, temp_c y fall.
                </p>
              </div>
            )}
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {DEVICE_RULES.map((r) => (
                <li key={r} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok" aria-hidden /> {r}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="hero" onClick={() => onOpenChange(false)}>
                Ya lo guardé
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={submit}
            noValidate
            className="space-y-3"
            aria-label="Emparejar un dispositivo"
          >
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {full && (
              <p role="status" className="rounded-xl bg-warn/10 p-3 text-xs text-warn">
                Llegaste al máximo de {overview.limits.devices} dispositivos activos. Revoca alguno
                para emparejar otro.
              </p>
            )}
            <TextField
              form={form}
              name="label"
              label="Nombre del dispositivo"
              placeholder="Ej.: Reloj Samsung de Ana"
              required
            />
            <SelectField form={form} name="kind" label="Tipo" options={DEVICE_KIND_OPTIONS} />
            <p className="text-[11px] text-muted-foreground">
              Se emparejan solo pacientes activos y en monitoreo. Dispositivos activos:{" "}
              {overview.usage.devices} de {overview.limits.devices}.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="hero" disabled={isSubmitting || full}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />} Generar código
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Los dispositivos de un paciente (o de toda la institución): su salud y el botón para revocarlos. */
export function DevicesList({
  devices,
  now,
  actions,
  canWrite,
  names,
}: {
  devices: InstDevice[];
  now: Clock;
  actions: CareActions;
  canWrite: boolean;
  /** Para mostrar de quién es cada uno cuando la lista es de toda la institución. */
  names?: Map<string, string>;
}) {
  const [revoking, setRevoking] = useState<InstDevice | null>(null);
  const active = devices.filter((d) => d.status === "active");
  const revoked = devices.filter((d) => d.status === "revoked");
  if (devices.length === 0) return null;

  const revoke = async () => {
    if (!revoking) return;
    try {
      await actions.revokeDevice.mutateAsync({ id: revoking.id });
      toast.success("Dispositivo revocado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRevoking(null);
    }
  };

  const Row = ({ d }: { d: InstDevice }) => {
    const h = deviceHealth(d, now);
    return (
      <li
        className="flex items-center gap-3 rounded-xl border border-border p-3"
        data-testid="device-item"
        data-health={h.state}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            TONE[h.tone].solid,
            h.state === "online" && "motion-safe:animate-pulse",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {d.label}
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
              …{d.code_hint}
            </span>
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {names?.get(d.patient_id) ? `${names.get(d.patient_id)} · ` : ""}
            {h.label}
          </p>
        </div>
        {canWrite && d.status === "active" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRevoking(d)}
            aria-label={`Revocar ${d.label}`}
          >
            <Unplug aria-hidden /> Revocar
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2" data-testid="devices-list">
      <ul className="space-y-2">
        {active.map((d) => (
          <Row key={d.id} d={d} />
        ))}
      </ul>
      {revoked.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Revocados ({revoked.length})</summary>
          <ul className="mt-2 space-y-2 opacity-70">
            {revoked.slice(0, 20).map((d) => (
              <Row key={d.id} d={d} />
            ))}
          </ul>
        </details>
      )}
      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar este dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.label} dejará de enviar lecturas de inmediato. Para volver a usarlo tendrás
              que emparejar uno nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revoke()}>Revocar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
