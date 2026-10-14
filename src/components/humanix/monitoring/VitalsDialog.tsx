// Registrar un control de signos vitales con la vista previa del NEWS2 EN VIVO: mientras escribes se ve el puntaje, la banda y qué parámetros
// se completaron con valores de las últimas 12 horas (igual que lo hará el servidor, que es quien lo calcula y guarda). Los valores raros
// avisan; los imposibles no se aceptan. Apoyo a la decisión clínica; no reemplaza el criterio del profesional.
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, HeartPulse, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CareActions } from "@/hooks/use-inst-care";
import { bandTone, type Clock } from "@/lib/instCare";
import type { InstObs, InstPatient } from "@/lib/instCareTypes";
import {
  EMPTY_VITALS_FORM,
  VITAL_RANGE,
  paramLabel,
  previewNews2,
  validateVitals,
  vitalsPayload,
  type VitalsForm,
} from "@/lib/instMonitoring";
import { BAND_INFO, NEWS2_DISCLAIMER, explainNews2 } from "@/lib/news2";
import { cn } from "@/lib/utils";
import { NewsRing } from "@/components/humanix/instcare/NewsRing";
import { TONE } from "@/components/humanix/instcare/tones";

type NumKey = "hr" | "rr" | "spo2" | "sbp" | "dbp" | "temp" | "pain";

const AVPU_OPTIONS = [
  { value: "A", label: "Alerta" },
  { value: "C", label: "Confusión nueva" },
  { value: "V", label: "Responde a la voz" },
  { value: "P", label: "Responde al dolor" },
  { value: "U", label: "No responde" },
] as const;

function NumberInput({
  k,
  form,
  setForm,
  error,
  autoFocus,
}: {
  k: NumKey;
  form: VitalsForm;
  setForm: (f: VitalsForm) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const r = VITAL_RANGE[k];
  const id = `vital-${k}`;
  return (
    <div className="space-y-1">
      {/* Dos líneas de alto, pegado abajo: aunque un nombre largo se parta, las casillas de una fila quedan alineadas. */}
      <Label htmlFor={id} className="flex min-h-8 items-end text-xs font-medium leading-4">
        <span>
          {r.label} <span className="font-normal text-muted-foreground">({r.unit})</span>
        </span>
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        placeholder={`${String(r.min).replace(".", ",")}–${r.max}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="tabular-nums"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[11px] text-sos">
          {error}
        </p>
      )}
    </div>
  );
}

export function VitalsDialog({
  open,
  onOpenChange,
  patient,
  history,
  actions,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: InstPatient | null;
  history: InstObs[];
  actions: CareActions;
  now: Clock;
}) {
  const [form, setForm] = useState<VitalsForm>(EMPTY_VITALS_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(EMPTY_VITALS_FORM);
      setError(null);
    }
  }, [open, patient?.id]);

  const check = useMemo(() => validateVitals(form), [form]);
  const preview = useMemo(
    () =>
      patient
        ? previewNews2({
            values: check.values,
            scale: patient.spo2_scale,
            history,
            now,
            birthDate: patient.birth_date,
          })
        : null,
    [check.values, history, now, patient],
  );

  const save = async () => {
    if (!patient || !check.ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await actions.recordVitals.mutateAsync({
        patientId: patient.id,
        data: vitalsPayload(form),
      });
      const score = res.obs.news2;
      toast.success(
        res.alert
          ? "Control guardado · se abrió una alerta"
          : score !== null
            ? `Control guardado · NEWS2 ${score}`
            : "Control guardado",
      );
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const result = preview?.result ?? null;
  const tone = result ? TONE[bandTone(result.band)] : TONE.muted;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        data-testid="vitals-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-biosensor" aria-hidden /> Registrar signos de{" "}
            {patient?.full_name}
          </DialogTitle>
          <DialogDescription>
            Escribe lo que mediste; lo que no, déjalo vacío. El puntaje se calcula con lo medido más
            lo último conocido de las últimas 12 horas.
          </DialogDescription>
        </DialogHeader>

        {/* En pantallas chicas el puntaje en vivo queda pegado arriba mientras se escribe (la vista completa va debajo del formulario). `-top-6`: el diálogo tiene 1.5 rem de relleno, así queda al ras del borde. */}
        {preview?.applicable && result && (
          <div
            aria-hidden="true"
            data-testid="news2-compact"
            className={cn(
              "sticky -top-6 z-10 -mx-6 flex items-center gap-3 border-y bg-background/95 px-6 py-1.5 backdrop-blur md:hidden",
              tone.border,
            )}
          >
            <NewsRing
              score={result.measured === 0 ? null : result.score}
              band={result.measured === 0 ? null : result.band}
              size="sm"
              pulse={false}
            />
            <div className="min-w-0">
              <p className={cn("truncate text-sm font-bold leading-tight", tone.text)}>
                {result.measured === 0
                  ? "Sin datos todavía"
                  : `NEWS2 · ${BAND_INFO[result.band].label}`}
              </p>
              <p className="text-[11px] text-muted-foreground">{result.measured} de 7 parámetros</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            noValidate
            className="space-y-3"
            aria-label="Signos vitales"
          >
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {check.errors.form && (
              <p role="status" className="text-xs text-muted-foreground">
                {check.errors.form}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberInput k="hr" form={form} setForm={setForm} error={check.errors.hr} autoFocus />
              <NumberInput k="rr" form={form} setForm={setForm} error={check.errors.rr} />
              <NumberInput k="spo2" form={form} setForm={setForm} error={check.errors.spo2} />
              <NumberInput k="sbp" form={form} setForm={setForm} error={check.errors.sbp} />
              <NumberInput k="dbp" form={form} setForm={setForm} error={check.errors.dbp} />
              <NumberInput k="temp" form={form} setForm={setForm} error={check.errors.temp} />
              <NumberInput k="pain" form={form} setForm={setForm} error={check.errors.pain} />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">¿Recibe oxígeno suplementario?</legend>
              <div
                role="radiogroup"
                aria-label="Oxígeno suplementario"
                className="flex flex-wrap gap-1.5"
              >
                {(
                  [
                    ["", "No sé"],
                    ["no", "Respira aire"],
                    ["yes", "Con oxígeno"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={form.onO2 === v}
                    onClick={() => setForm({ ...form, onO2: v })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-premium",
                      form.onO2 === v
                        ? "border-trust bg-trust/10 text-trust"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">Estado de conciencia</legend>
              <div
                role="radiogroup"
                aria-label="Estado de conciencia"
                className="flex flex-wrap gap-1.5"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.avpu === ""}
                  onClick={() => setForm({ ...form, avpu: "" })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-premium",
                    form.avpu === ""
                      ? "border-trust bg-trust/10 text-trust"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  No evaluado
                </button>
                {AVPU_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={form.avpu === o.value}
                    onClick={() => setForm({ ...form, avpu: o.value })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-premium",
                      form.avpu === o.value
                        ? o.value === "A"
                          ? "border-ok bg-ok/10 text-ok"
                          : "border-sos bg-sos/10 text-sos"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center gap-2">
              <Checkbox
                id="vital-fall"
                checked={form.fall}
                onCheckedChange={(v) => setForm({ ...form, fall: v === true })}
              />
              <Label htmlFor="vital-fall" className="text-sm font-normal">
                Se reportó una caída
              </Label>
            </div>

            <div className="space-y-1">
              <Label htmlFor="vital-note" className="text-xs font-medium">
                Nota del control
              </Label>
              <Textarea
                id="vital-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 300) })}
                placeholder="Opcional"
              />
            </div>

            {check.warnings.length > 0 && (
              <ul
                className="space-y-1 rounded-xl border border-warn/30 bg-warn/5 p-2.5 text-xs"
                aria-label="Valores para confirmar"
              >
                {check.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5 text-warn">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {w}
                  </li>
                ))}
              </ul>
            )}
          </form>

          <aside
            aria-label="Vista previa del NEWS2"
            aria-live="polite"
            className={cn(
              "h-fit space-y-3 rounded-2xl border bg-gradient-to-br p-4",
              tone.border,
              tone.wash,
            )}
            data-testid="news2-preview"
          >
            {!preview?.applicable ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> El NEWS2 es para personas
                de 16 años o más. Para esta persona usa la escala pediátrica del protocolo de la
                institución; el control se guarda igual.
              </p>
            ) : result ? (
              <>
                <div className="flex items-center gap-3">
                  <NewsRing
                    score={result.measured === 0 ? null : result.score}
                    band={result.measured === 0 ? null : result.band}
                    size="lg"
                    pulse={false}
                  />
                  <div>
                    <p className={cn("font-display text-lg font-bold leading-tight", tone.text)}>
                      {result.measured === 0 ? "Sin datos" : BAND_INFO[result.band].label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {result.measured} de 7 parámetros
                    </p>
                  </div>
                </div>
                {result.measured > 0 && (
                  <p className="text-xs leading-relaxed">{BAND_INFO[result.band].guidance}</p>
                )}
                {preview.carried.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    <Activity className="mr-1 inline h-3 w-3" aria-hidden />
                    Completado con lo último conocido:{" "}
                    {preview.carried.map(paramLabel).join(", ").toLowerCase()}.
                  </p>
                )}
                {preview.missing.length > 0 && result.measured > 0 && (
                  <p className="text-[11px] text-warn">
                    Sin dato en 12 h: {preview.missing.map(paramLabel).join(", ").toLowerCase()}. El
                    puntaje puede subestimar el riesgo.
                  </p>
                )}
                {result.measured > 0 && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer font-medium">¿De dónde sale?</summary>
                    <ul className="mt-1.5 space-y-0.5">
                      {explainNews2(result).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : null}
            <p className="text-[10px] leading-snug text-muted-foreground">{NEWS2_DISCLAIMER}</p>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="hero"
            onClick={() => void save()}
            disabled={busy || !check.ok}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <HeartPulse aria-hidden />}{" "}
            Guardar control
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
