// Notas del paciente: historia inalterable. Cada nota se firma (lleva el sello de la anterior), no se edita ni se borra; si algo cambia se
// agrega una corrección que apunta a la nota original. «Verificar integridad» le pide a la base que recalcule cada firma de la cadena.
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  CornerDownRight,
  FileSignature,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CareError, verifyNotes, type CareActions } from "@/hooks/use-inst-care";
import { NOTE_KIND_META, dayClockLabel, thousandsEs, type Clock } from "@/lib/instCare";
import type { InstCase, InstNote, InstPatient } from "@/lib/instCareTypes";
import { NOTE_KIND_OPTIONS, NOTE_MAX, noteFormSchema, type NoteFormValues } from "@/lib/instForms";
import { cn } from "@/lib/utils";
import { SelectField, TextAreaField } from "@/components/humanix/instcare/fields";
import { TONE } from "@/components/humanix/instcare/tones";

const VITAL_LABEL: Record<string, string> = {
  hr: "Pulso",
  rr: "Resp.",
  spo2: "SpO₂",
  sbp: "PAS",
  dbp: "PAD",
  temp_c: "Temp.",
  news2: "NEWS2",
};

type Verdict = { ok: boolean; checked: number; bad: number | null } | null;

export function NotesPanel({
  patient,
  notes,
  cases,
  actions,
  now,
  canWrite,
}: {
  patient: InstPatient;
  notes: InstNote[];
  cases: InstCase[];
  actions: CareActions;
  now: Clock;
  canWrite: boolean;
}) {
  const [correcting, setCorrecting] = useState<InstNote | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discharged = patient.status === "discharged";
  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { kind: "evolution", body: "", case_id: "" },
  });
  const { isSubmitting } = form.formState;
  const body = form.watch("body");
  const bySeq = new Map(notes.map((n) => [n.id, n]));
  const openCases = cases.filter((c) => c.status === "active" || c.status === "pending");

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await verifyNotes(patient.id);
      setVerdict({ ok: r.ok, checked: r.checked, bad: r.first_bad_seq });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const startCorrection = (n: InstNote) => {
    setCorrecting(n);
    form.reset({
      kind: "correction",
      body: `Corrección a la nota n.º ${n.seq}: `,
      case_id: n.case_id ?? "",
    });
    requestAnimationFrame(() =>
      document
        .getElementById("note-composer")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const stopCorrection = () => {
    setCorrecting(null);
    form.reset({ kind: "evolution", body: "", case_id: "" });
  };

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await actions.addNote.mutateAsync({
        patientId: patient.id,
        kind: v.kind,
        body: v.body,
        caseId: v.case_id || null,
        corrects: correcting?.id ?? null,
      });
      toast.success(correcting ? "Corrección guardada" : "Nota firmada y guardada");
      setVerdict(null);
      stopCorrection();
    } catch (e) {
      setError(e instanceof CareError ? e.message : "No se pudo guardar la nota.");
    }
  });

  return (
    <div className="space-y-4" data-testid="notes-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-muted/30 p-3">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Las notas no se editan ni se borran: cada una queda firmada y enlazada a la anterior. Si
            algo cambia, agrega una corrección.
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void verify()}
          disabled={verifying || notes.length === 0}
        >
          {verifying ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ShieldCheck aria-hidden />
          )}{" "}
          Verificar integridad
        </Button>
      </div>

      {verdict && (
        <div
          role="status"
          data-testid="chain-verdict"
          className={cn(
            "flex items-start gap-2 rounded-2xl border p-3 text-sm",
            verdict.ok ? "border-ok/30 bg-ok/5 text-ok" : "border-sos/40 bg-sos/5 text-sos",
          )}
        >
          {verdict.ok ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <p>
            {verdict.ok
              ? `Cadena íntegra: ${verdict.checked} ${verdict.checked === 1 ? "nota verificada" : "notas verificadas"}; ninguna fue alterada.`
              : `Se detectó una alteración desde la nota n.º ${verdict.bad}. Avisa a soporte de inmediato: no borres nada.`}
          </p>
        </div>
      )}

      {canWrite && !discharged && (
        <Card id="note-composer" className="rounded-2xl p-4">
          <form onSubmit={submit} noValidate className="space-y-3" aria-label="Escribir una nota">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {correcting ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs">
                <span className="font-medium text-warn">
                  Corrigiendo la nota n.º {correcting.seq}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={stopCorrection}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  form={form}
                  name="kind"
                  label="Tipo de nota"
                  options={NOTE_KIND_OPTIONS.map((o) => ({
                    value: o.value,
                    label: `${o.label} — ${o.hint}`,
                  }))}
                />
                {openCases.length > 0 && (
                  <SelectField
                    form={form}
                    name="case_id"
                    label="Caso"
                    allowEmpty
                    emptyLabel="Sin caso"
                    options={openCases.map((c) => ({ value: c.id, label: c.title }))}
                  />
                )}
              </div>
            )}
            <TextAreaField
              form={form}
              name="body"
              label="Nota"
              rows={4}
              placeholder="Escribe lo que viste, lo que hiciste o lo que acordaron…"
            />
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  body.length > NOTE_MAX ? "text-sos" : "text-muted-foreground",
                )}
              >
                {thousandsEs(body.length)} / {thousandsEs(NOTE_MAX)}
              </span>
              <Button type="submit" variant="hero" size="sm" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <FileSignature aria-hidden />
                )}
                {correcting ? "Guardar corrección" : "Firmar y guardar"}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {discharged && (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          El paciente tiene el alta: la historia queda para consulta. Reactívalo para agregar notas.
        </p>
      )}

      {notes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aún no hay notas. La primera la deja el sistema al registrar al paciente.
        </p>
      ) : (
        <ol className="space-y-3" aria-label="Notas, de la más reciente a la más antigua">
          {notes.map((n) => {
            const meta = NOTE_KIND_META[n.kind];
            const target = n.corrects_note_id ? bySeq.get(n.corrects_note_id) : undefined;
            const vitals = n.vitals
              ? Object.entries(n.vitals).filter(([k]) => k in VITAL_LABEL)
              : [];
            return (
              <li key={n.id}>
                <Card className="rounded-2xl p-4" data-testid="note-item" data-seq={n.seq}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        TONE[meta.tone].chip,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="font-semibold">{n.author_name}</span>
                    <span className="text-muted-foreground">
                      {n.author_role === "owner" ? "cuenta de la institución" : "equipo"} ·{" "}
                      {dayClockLabel(n.created_at, now)}
                    </span>
                    <span
                      className="ml-auto font-mono text-[10px] text-muted-foreground"
                      title={`Firma completa: ${n.hash}`}
                    >
                      n.º {n.seq} · {n.hash.slice(0, 8)}
                    </span>
                  </div>
                  {n.kind === "correction" && target && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-warn">
                      <CornerDownRight className="h-3 w-3" aria-hidden /> Corrige la nota n.º{" "}
                      {target.seq}
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{n.body}</p>
                  {vitals.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {vitals.map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                        >
                          {VITAL_LABEL[k]} {String(v).replace(".", ",")}
                        </span>
                      ))}
                    </p>
                  )}
                  {canWrite && !discharged && n.kind !== "handoff" && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => startCorrection(n)}
                      >
                        Corregir esta nota
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
