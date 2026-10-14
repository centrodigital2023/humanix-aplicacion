// Acciones sobre un paciente: dar de alta, cambiar la escala de saturación (solo por indicación médica), contarle a la familia cómo va y
// exportar la historia (plan IPS Mejorado). Todo lo que cambia datos lo hace el servidor; aquí se piden los datos y se muestran los resultados.
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  HeartHandshake,
  Loader2,
  LogOut,
  Lock,
  MessageCircle,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { downloadText } from "@/components/humanix/premium/download";
import { fetchPatientExport, type CareActions } from "@/hooks/use-inst-care";
import {
  familyUpdateText,
  normalizeCoPhone,
  notesToCsv,
  whatsappLink,
  type CareOverview,
} from "@/lib/instCare";
import type { InstLive, InstPatient } from "@/lib/instCareTypes";
import { OUTCOME_OPTIONS, dischargeSchema, type DischargeValues } from "@/lib/instForms";
import { FHIR_MIME, buildFhirBundle, bundleSummary, fhirFileName, fhirJson } from "@/lib/instFhir";
import { SelectField, TextAreaField } from "@/components/humanix/instcare/fields";

// ── Alta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function DischargeDialog({
  open,
  onOpenChange,
  actions,
  patient,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  patient: InstPatient;
  onDone?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<DischargeValues>({
    resolver: zodResolver(dischargeSchema),
    defaultValues: { outcome: "stable", note: "" },
  });
  const { isSubmitting } = form.formState;
  useEffect(() => {
    if (open) {
      setError(null);
      form.reset({ outcome: "stable", note: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await actions.dischargePatient.mutateAsync({
        id: patient.id,
        outcome: v.outcome,
        note: v.note,
      });
      toast.success("Alta registrada");
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="discharge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-4 w-4 text-trust" aria-hidden /> Dar de alta a {patient.full_name}
          </DialogTitle>
          <DialogDescription>
            Se cierran sus casos abiertos, se omiten sus tareas pendientes, se resuelven sus alertas
            y se revocan sus dispositivos. La historia queda para consulta y puedes reactivarlo
            cuando haga falta.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3" aria-label="Dar de alta">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <SelectField form={form} name="outcome" label="Desenlace" options={OUTCOME_OPTIONS} />
          <TextAreaField
            form={form}
            name="note"
            label="Nota del alta"
            rows={3}
            placeholder="Opcional"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />} Dar de alta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Escala de saturación ─────────────────────────────────────────────────────────────────────────────────────────────

export function ScaleDialog({
  open,
  onOpenChange,
  actions,
  patient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  patient: InstPatient;
}) {
  const [scale, setScale] = useState<1 | 2>(patient.spo2_scale);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setScale(patient.spo2_scale);
      setReason("");
      setError(null);
    }
  }, [open, patient.spo2_scale]);
  const needReason = scale === 2 && reason.trim().length < 8;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.setScale.mutateAsync({ id: patient.id, scale, reason });
      toast.success(`Escala de saturación: ${scale}`);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="scale-dialog">
        <DialogHeader>
          <DialogTitle>Escala de saturación (SpO₂) de {patient.full_name}</DialogTitle>
          <DialogDescription>
            La escala 1 es la habitual. La escala 2 (meta de 88 a 92 %) se usa solo por indicación
            médica, por ejemplo en personas con retención de CO₂. Queda escrita en la historia con
            su motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div role="radiogroup" aria-label="Escala" className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scale === s}
                onClick={() => setScale(s)}
                className={`rounded-xl border p-3 text-left text-sm transition-colors focus-premium ${
                  scale === s ? "border-trust bg-trust/10" : "border-border hover:bg-muted/40"
                }`}
              >
                <span className="block font-semibold">Escala {s}</span>
                <span className="text-[11px] text-muted-foreground">
                  {s === 1 ? "Meta habitual" : "Meta 88–92 % (indicación médica)"}
                </span>
              </button>
            ))}
          </div>
          {scale === 2 && (
            <div className="space-y-1.5">
              <Label htmlFor="scale-reason" className="text-xs font-medium">
                Indicación médica <span className="text-sos">*</span>
              </Label>
              <Textarea
                id="scale-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 300))}
                rows={2}
                placeholder="Ej.: EPOC con retención de CO₂, meta indicada por neumología"
              />
              {needReason && (
                <p className="text-[11px] text-muted-foreground">
                  Escribe la indicación (al menos 8 caracteres).
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="hero"
            disabled={busy || scale === patient.spo2_scale || needReason}
            onClick={() => void save()}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Mensaje a la familia ─────────────────────────────────────────────────────────────────────────────────────────────

const VITAL_KEYS = ["hr", "spo2", "sbp", "dbp", "temp_c", "rr"] as const;

export function FamilyUpdateDialog({
  open,
  onOpenChange,
  actions,
  patient,
  live,
  institutionName,
  signer,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  patient: InstPatient;
  live: InstLive | undefined;
  institutionName: string;
  signer?: string | null;
  now: number;
}) {
  const [withVitals, setWithVitals] = useState(false);
  const [leaveNote, setLeaveNote] = useState(false);
  const base = useMemo(() => {
    const vitals: Partial<Record<(typeof VITAL_KEYS)[number], number>> = {};
    for (const k of VITAL_KEYS) {
      const v = live?.last_vitals?.[k];
      if (typeof v === "number") vitals[k] = v;
    }
    return familyUpdateText({
      patientName: patient.full_name,
      institutionName,
      band: live?.last_band ?? null,
      lastObsAt: live?.last_obs_at ?? null,
      now,
      vitals: withVitals ? vitals : null,
      signer: signer ?? null,
    });
  }, [patient.full_name, institutionName, live, now, withVitals, signer]);
  const [text, setText] = useState(base);
  useEffect(() => setText(base), [base, open]);
  const wa = whatsappLink(patient.emergency_phone, text);
  const phone = normalizeCoPhone(patient.emergency_phone);

  const leaveConstancy = async () => {
    if (!leaveNote) return;
    try {
      await actions.addNote.mutateAsync({
        patientId: patient.id,
        kind: "family",
        body: "Se preparó un mensaje de actualización para la familia (redactado en Humanix).",
      });
    } catch {
      /* la constancia es opcional: no estorba al mensaje */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Mensaje copiado");
      await leaveConstancy();
    } catch {
      toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-lg"
        data-testid="family-update"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-fuchsia-neural" aria-hidden /> Contarle a la
            familia cómo va
          </DialogTitle>
          <DialogDescription>
            Un mensaje cálido y claro, listo para revisar. Tú decides si lo envías: nada sale solo.
            No incluye cobros ni pide datos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!patient.family_updates_ok && (
            <Alert role="status">
              <AlertDescription>
                Esta familia aún no autorizó recibir actualizaciones. Confírmalo con ellos antes de
                enviar el mensaje (puedes marcarlo al editar al paciente).
              </AlertDescription>
            </Alert>
          )}
          <Textarea
            aria-label="Mensaje para la familia"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1200))}
            rows={9}
            className="text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3">
            <Label htmlFor="fam-vitals" className="text-xs">
              Incluir los últimos valores (pulso, saturación, presión…)
            </Label>
            <Switch
              id="fam-vitals"
              checked={withVitals}
              onCheckedChange={setWithVitals}
              disabled={!live?.last_vitals}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3">
            <Label htmlFor="fam-note" className="text-xs">
              Dejar constancia en la historia
            </Label>
            <Switch id="fam-note" checked={leaveNote} onCheckedChange={setLeaveNote} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <Copy aria-hidden /> Copiar mensaje
          </Button>
          {wa ? (
            <Button asChild variant="hero">
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void leaveConstancy()}
              >
                <MessageCircle aria-hidden /> Abrir en WhatsApp
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="hero"
              disabled
              title={
                phone.kind === "landline"
                  ? "El teléfono es fijo: llámalos"
                  : "No hay un celular registrado"
              }
            >
              <MessageCircle aria-hidden /> Sin celular
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Exportar la historia ─────────────────────────────────────────────────────────────────────────────────────────────

export function ExportMenu({
  patient,
  overview,
  actions,
  institutionName,
}: {
  patient: InstPatient;
  overview: CareOverview;
  actions: CareActions;
  institutionName: string;
}) {
  const allowed = overview.limits.export;
  const [busy, setBusy] = useState(false);

  const run = async (format: "fhir" | "csv") => {
    setBusy(true);
    try {
      // Primero queda la constancia (Ley 1581: trazabilidad); si el plan no lo permite, el servidor lo rechaza y no se genera nada.
      await actions.logExport.mutateAsync({ patientId: patient.id, format });
      const data = await fetchPatientExport(patient.id);
      const now = Date.now();
      if (format === "fhir") {
        const bundle = buildFhirBundle({
          institutionName,
          patient,
          cases: data.cases,
          notes: data.notes,
          obs: data.obs,
          now,
        });
        downloadText(fhirFileName(patient, now), fhirJson(bundle), `${FHIR_MIME};charset=utf-8`);
        toast.success(`Historia exportada en FHIR · ${bundleSummary(bundle)}`);
      } else {
        const csvName = fhirFileName(patient, now)
          .replace("historia", "notas")
          .replace(/\.json$/, ".csv");
        downloadText(csvName, notesToCsv(data.notes), "text/csv;charset=utf-8");
        toast.success("Notas exportadas en CSV");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="export-menu">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}{" "}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Historia de {patient.full_name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allowed ? (
          <>
            <DropdownMenuItem onSelect={() => void run("fhir")} className="items-start gap-2">
              <FileJson className="mt-0.5 h-4 w-4" aria-hidden />
              <span>
                <span className="block text-sm">Historia en FHIR (JSON)</span>
                <span className="block text-[11px] text-muted-foreground">
                  Para enviarla a otra EPS, IPS u hospital.
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("csv")} className="items-start gap-2">
              <FileSpreadsheet className="mt-0.5 h-4 w-4" aria-hidden />
              <span>
                <span className="block text-sm">Notas en CSV</span>
                <span className="block text-[11px] text-muted-foreground">
                  Con la firma de cada nota. Se abre en Excel.
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
              Contiene datos personales y de salud (Ley 1581). Compártelo solo por canales seguros
              con quien tenga derecho a verlo. Cada exportación queda registrada.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Exportar la historia (FHIR y CSV) es parte del plan IPS Mejorado.</span>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
