// Agregar o editar un paciente. Un solo formulario (react-hook-form + Zod, las mismas reglas que la base de datos). Al registrar: se exige la
// autorización del paciente o su acudiente (Ley 1581), y de una vez se puede dejar en monitoreo y abrir su primer caso (o iniciarlo desde una
// postulación aceptada). Los topes del plan los aplica el servidor; aquí se avisan antes.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Activity, FolderPlus, Loader2, ShieldCheck, UserPlus } from "lucide-react";
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
import { CareError, type AcceptedApplication, type CareActions } from "@/hooks/use-inst-care";
import { careErrorMessage, type CareOverview } from "@/lib/instCare";
import type { InstPatient } from "@/lib/instCareTypes";
import {
  CARE_TYPE_OPTIONS,
  DOC_TYPE_OPTIONS,
  MODALITY_OPTIONS,
  PATIENT_FORM_DEFAULTS,
  PRIORITY_OPTIONS,
  SEX_OPTIONS,
  bogotaToday,
  firstCasePayload,
  patientEditPayload,
  patientFormSchema,
  patientPayload,
  patientToFormValues,
  type PatientFormValues,
} from "@/lib/instForms";
import { cn } from "@/lib/utils";
import {
  CheckField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "@/components/humanix/instcare/fields";
import type { CareScope } from "@/components/humanix/instcare/scope";

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-3 rounded-2xl border border-border p-3 sm:p-4", className)}>
      <legend className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function PatientFormDialog({
  open,
  onOpenChange,
  scope,
  overview,
  actions,
  patient,
  preset,
  applications,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: CareScope;
  overview: CareOverview;
  actions: CareActions;
  /** Con paciente: se edita; sin él: se registra uno nuevo. */
  patient?: InstPatient | null;
  preset?: Partial<PatientFormValues>;
  applications: AcceptedApplication[];
  onSaved?: (patientId: string, created: boolean) => void;
}) {
  const editing = !!patient;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: PATIENT_FORM_DEFAULTS,
    mode: "onTouched",
  });
  const { isSubmitting } = form.formState;
  const withCase = form.watch("with_case");
  const applicationId = form.watch("application_id");
  const monitor = form.watch("monitor");

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset(patient ? patientToFormValues(patient) : { ...PATIENT_FORM_DEFAULTS, ...preset });
    // Solo al abrir o al cambiar de paciente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient?.id]);

  // Con una postulación elegida, el título del caso sale de la oferta (y el nombre del profesional, del servidor).
  const application = useMemo(
    () => applications.find((a) => a.application_id === applicationId) ?? null,
    [applications, applicationId],
  );
  useEffect(() => {
    if (application && !form.getValues("title")) form.setValue("title", application.offer_title);
  }, [application, form]);

  const monitorFull = overview.usage.monitored >= overview.limits.monitored;
  const canMonitor = scope.canMonitoring && !editing;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      if (patient) {
        await actions.updatePatient.mutateAsync({ id: patient.id, data: patientEditPayload(v) });
        toast.success("Datos del paciente actualizados");
        onSaved?.(patient.id, false);
      } else {
        const res = await actions.createPatient.mutateAsync({
          data: patientPayload(v),
          consent: v.consent,
          monitor: v.monitor,
          firstCase: firstCasePayload(v),
        });
        toast.success(res.case ? "Paciente registrado y caso abierto" : "Paciente registrado");
        onSaved?.(res.patient.id, true);
      }
      onOpenChange(false);
    } catch (e) {
      if (e instanceof CareError && e.hint === "duplicate_document") {
        form.setError("document_number", { message: e.message });
      } else if (e instanceof CareError && e.hint === "consent_required") {
        form.setError("consent", { message: e.message });
      }
      setFormError(e instanceof CareError ? e.message : careErrorMessage(e));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        data-testid="patient-form"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-trust/10 text-trust">
              <UserPlus className="h-4 w-4" aria-hidden />
            </span>
            {editing ? "Editar paciente" : "Agregar paciente"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Actualiza los datos. Los cambios quedan en la bitácora."
              : "Solo el nombre es obligatorio; completa el resto cuando lo tengas. Todo se puede editar después."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={submit}
          noValidate
          className="space-y-4"
          aria-label={editing ? "Editar paciente" : "Agregar paciente"}
        >
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Section title="La persona">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                form={form}
                name="full_name"
                label="Nombre completo"
                required
                autoComplete="off"
                className="sm:col-span-2"
              />
              <SelectField
                form={form}
                name="document_type"
                label="Tipo de documento"
                options={DOC_TYPE_OPTIONS}
                allowEmpty
                emptyLabel="Sin documento"
              />
              <TextField
                form={form}
                name="document_number"
                label="Número de documento"
                inputMode="text"
                autoComplete="off"
              />
              <TextField
                form={form}
                name="birth_date"
                label="Fecha de nacimiento"
                type="date"
                max={bogotaToday()}
              />
              <SelectField
                form={form}
                name="sex"
                label="Sexo"
                options={SEX_OPTIONS}
                allowEmpty
                emptyLabel="Sin dato"
              />
            </div>
          </Section>

          <Section title="Dónde y cómo está">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                form={form}
                name="modality"
                label="Modalidad"
                options={MODALITY_OPTIONS}
              />
              <TextField
                form={form}
                name="room"
                label="Habitación o cama"
                placeholder="Ej.: 201-B"
              />
              <TextField form={form} name="city" label="Ciudad" />
              <TextField form={form} name="eps_name" label="EPS" />
              <TextField form={form} name="address" label="Dirección" className="sm:col-span-2" />
              <TextField
                form={form}
                name="external_ref"
                label="Historia clínica o referencia interna"
                className="sm:col-span-2"
              />
            </div>
          </Section>

          <Section title="Salud">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextAreaField
                form={form}
                name="conditions"
                label="Condiciones"
                rows={2}
                hint="Separadas por coma. Ej.: EPOC, hipertensión"
              />
              <TextAreaField
                form={form}
                name="allergies"
                label="Alergias"
                rows={2}
                hint="Separadas por coma. Se recuerdan en cada relevo de turno."
              />
            </div>
          </Section>

          <Section title="Contacto de emergencia">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField form={form} name="emergency_name" label="Nombre" />
              <TextField
                form={form}
                name="emergency_phone"
                label="Teléfono"
                type="tel"
                inputMode="tel"
                placeholder="300 123 4567"
              />
            </div>
            <SwitchField
              form={form}
              name="family_updates_ok"
              label="La familia autorizó recibir actualizaciones"
              description="Habilita el mensaje a la familia (lo revisas y lo envías tú; nada sale solo)."
            />
          </Section>

          {!editing && (
            <Section title="Cómo empieza">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  form={form}
                  name="status"
                  label="Estado inicial"
                  options={[
                    { value: "active", label: "Activo" },
                    { value: "pending", label: "Pendiente (aún no inicia)" },
                  ]}
                />
              </div>
              {canMonitor && (
                <SwitchField
                  form={form}
                  name="monitor"
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-biosensor" aria-hidden /> Poner en
                      monitoreo ahora
                    </span>
                  }
                  description={
                    monitorFull
                      ? `Tu plan permite monitorear hasta ${overview.limits.monitored} pacientes a la vez.`
                      : "El NEWS2 se calcula con cada control y te avisa si empeora."
                  }
                  disabled={monitorFull || form.watch("status") !== "active"}
                />
              )}
              {monitor && form.formState.errors.monitor?.message && (
                <p role="alert" className="text-xs text-sos">
                  {String(form.formState.errors.monitor.message)}
                </p>
              )}
              {scope.canPatients && (
                <>
                  <SwitchField
                    form={form}
                    name="with_case"
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <FolderPlus className="h-3.5 w-3.5 text-copper" aria-hidden /> Abrir su
                        primer caso ahora
                      </span>
                    }
                    description="Un caso reúne el servicio, quién lo presta y el seguimiento."
                  />
                  {withCase && (
                    <div
                      className="grid gap-3 rounded-2xl bg-muted/30 p-3 sm:grid-cols-2"
                      data-testid="first-case"
                    >
                      {applications.length > 0 && (
                        <SelectField
                          form={form}
                          name="application_id"
                          label="Desde una postulación aceptada"
                          allowEmpty
                          emptyLabel="Caso manual (sin postulación)"
                          options={applications.map((a) => ({
                            value: a.application_id,
                            label: `${a.offer_title}${a.professional_label ? ` · ${a.professional_label}` : ""}`,
                          }))}
                          className="sm:col-span-2"
                        />
                      )}
                      <TextField
                        form={form}
                        name="title"
                        label="Título del caso"
                        required
                        placeholder="Ej.: Curaciones posoperatorias"
                        className="sm:col-span-2"
                      />
                      <SelectField
                        form={form}
                        name="care_type"
                        label="Tipo de cuidado"
                        options={CARE_TYPE_OPTIONS}
                      />
                      <SelectField
                        form={form}
                        name="priority"
                        label="Prioridad"
                        options={PRIORITY_OPTIONS}
                      />
                      <TextField
                        form={form}
                        name="target_date"
                        label="Fecha estimada de cierre"
                        type="date"
                        min={bogotaToday()}
                      />
                      {!application && (
                        <TextField
                          form={form}
                          name="professional_label"
                          label="Profesional a cargo"
                          placeholder="Opcional"
                        />
                      )}
                      <TextAreaField
                        form={form}
                        name="summary"
                        label="Resumen"
                        rows={2}
                        className="sm:col-span-2"
                      />
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {!editing && (
            <div className="rounded-2xl border border-trust/30 bg-trust/5 p-3">
              <CheckField
                form={form}
                name="consent"
                label="Confirmo que la institución cuenta con la autorización del paciente o de su acudiente para tratar sus datos personales y de salud."
                description={
                  <>
                    Son datos sensibles (Ley 1581 de 2012).{" "}
                    <Link to="/habeas-data" className="underline underline-offset-2">
                      Conoce cómo se protegen
                    </Link>
                    .
                  </>
                }
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <p className="mr-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" aria-hidden /> Cada cambio queda en la
              bitácora.
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <UserPlus aria-hidden />
              )}
              {editing ? "Guardar cambios" : "Registrar paciente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
