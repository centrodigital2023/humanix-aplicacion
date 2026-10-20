// La ficha de un paciente: un panel lateral con todo lo suyo. Resumen (datos, estado, contacto), Casos, Notas (historia firmada), Tareas,
// Monitoreo (NEWS2, signos, alertas, dispositivos) y Actividad (todo lo que le ha pasado). Se actualiza en vivo.
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  FileText,
  FolderOpen,
  HeartHandshake,
  History,
  ListChecks,
  LogOut,
  MapPin,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  Play,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePatientDetail,
  type AcceptedApplication,
  type CareActions,
} from "@/hooks/use-inst-care";
import {
  MODALITY_META,
  STATUS_META,
  ageLabel,
  buildTimeline,
  dateLabel,
  normalizeCoPhone,
  type CareOverview,
} from "@/lib/instCare";
import type { InstCase, InstDevice, InstLive, InstPatient } from "@/lib/instCareTypes";
import { MODALITY_OPTIONS } from "@/lib/instForms";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/humanix/instcare/PersonAvatar";
import { QueryProblem } from "@/components/humanix/instcare/QueryProblem";
import type { CareScope } from "@/components/humanix/instcare/scope";
import { TONE } from "@/components/humanix/instcare/tones";
import { PatientMonitorPanel } from "@/components/humanix/monitoring/PatientMonitorPanel";
import { ActivityPanel } from "./PatientActivity";
import { DischargeDialog, ExportMenu, FamilyUpdateDialog, ScaleDialog } from "./PatientActions";
import { CaseDialog, CasesPanel, CloseCaseDialog, RateCaseDialog } from "./PatientCases";
import { PatientFormDialog } from "./PatientFormDialog";
import { NotesPanel } from "./PatientNotes";
import { TasksPanel } from "./PatientTasks";
import { friendlyError } from "@/lib/friendlyError";

export type DrawerTab = "resumen" | "casos" | "notas" | "tareas" | "monitoreo" | "actividad";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export function PatientDrawer({
  patient,
  scope,
  overview,
  actions,
  live,
  devices,
  applications,
  now,
  tab,
  onTabChange,
  onClose,
}: {
  patient: InstPatient | null;
  scope: CareScope;
  overview: CareOverview;
  actions: CareActions;
  live: InstLive | undefined;
  devices: InstDevice[];
  applications: AcceptedApplication[];
  now: number;
  tab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  onClose: () => void;
}) {
  const detail = usePatientDetail(scope.institutionId, patient?.id);
  const [editOpen, setEditOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [caseDialog, setCaseDialog] = useState<{ open: boolean; existing: InstCase | null }>({
    open: false,
    existing: null,
  });
  const [closing, setClosing] = useState<InstCase | null>(null);
  const [rating, setRating] = useState<InstCase | null>(null);

  const d = detail.data;
  const timeline = useMemo(
    () =>
      d
        ? buildTimeline({
            notes: d.notes,
            events: d.events,
            alerts: d.alerts,
            tasks: d.tasks,
            cases: d.cases,
            obs: d.obs,
          })
        : [],
    [d],
  );

  const canWrite = scope.canPatients;
  const canMonitor = scope.canMonitoring;
  const open = patient !== null;

  const setStatus = async (status: "pending" | "active" | "paused") => {
    if (!patient) return;
    try {
      await actions.setPatientStatus.mutateAsync({ id: patient.id, status });
      toast.success(status === "paused" ? "En pausa" : "Paciente activo");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-2xl"
        data-testid="patient-drawer"
      >
        {patient && (
          <>
            <SheetHeader className="space-y-0 border-b border-border bg-gradient-to-br from-trust/5 via-background to-biosensor/5 p-4 pr-12 text-left sm:p-5 sm:pr-14">
              <div className="flex items-start gap-3">
                <PersonAvatar name={patient.full_name} id={patient.id} size="lg" />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate font-display text-xl font-bold">
                    {patient.full_name}
                  </SheetTitle>
                  <SheetDescription className="truncate">
                    {[
                      ageLabel(patient.birth_date, now),
                      patient.sex === "F" ? "Mujer" : patient.sex === "M" ? "Hombre" : "",
                      patient.room ? `hab. ${patient.room}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Ficha del paciente"}
                  </SheetDescription>
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        TONE[STATUS_META[patient.status].tone].chip,
                      )}
                    >
                      {STATUS_META[patient.status].label}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        TONE[MODALITY_META[patient.modality].tone].chip,
                      )}
                    >
                      {MODALITY_META[patient.modality].label}
                    </span>
                    {patient.monitoring && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          TONE.biosensor.chip,
                        )}
                      >
                        <Activity className="h-3 w-3" aria-hidden /> En monitoreo
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canWrite && patient.status !== "discharged" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil aria-hidden /> Editar
                  </Button>
                )}
                <ExportMenu
                  patient={patient}
                  overview={overview}
                  actions={actions}
                  institutionName={scope.institutionName}
                />
                {patient.status !== "discharged" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFamilyOpen(true)}
                  >
                    <HeartHandshake aria-hidden /> Contar a la familia
                  </Button>
                )}
                {canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" aria-label="Más acciones">
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {patient.status === "active" && (
                        <DropdownMenuItem onSelect={() => void setStatus("paused")}>
                          <Pause className="mr-2 h-4 w-4" aria-hidden /> Poner en pausa
                        </DropdownMenuItem>
                      )}
                      {(patient.status === "paused" || patient.status === "pending") && (
                        <DropdownMenuItem onSelect={() => void setStatus("active")}>
                          <Play className="mr-2 h-4 w-4" aria-hidden /> Activar
                        </DropdownMenuItem>
                      )}
                      {patient.status === "discharged" && (
                        <DropdownMenuItem onSelect={() => void setStatus("active")}>
                          <Play className="mr-2 h-4 w-4" aria-hidden /> Reactivar
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setScaleOpen(true)}>
                        <Stethoscope className="mr-2 h-4 w-4" aria-hidden /> Escala de saturación
                      </DropdownMenuItem>
                      {patient.status !== "discharged" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setDischargeOpen(true)}
                            className="text-sos focus:text-sos"
                          >
                            <LogOut className="mr-2 h-4 w-4" aria-hidden /> Dar de alta
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </SheetHeader>

            <Tabs
              value={tab}
              onValueChange={(v) => onTabChange(v as DrawerTab)}
              className="p-4 sm:p-5"
            >
              <TabsList
                className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1"
                aria-label="Secciones de la ficha"
              >
                <TabsTrigger value="resumen" className="gap-1.5">
                  <UserRound className="h-3.5 w-3.5" aria-hidden /> Resumen
                </TabsTrigger>
                <TabsTrigger value="casos" className="gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Casos
                </TabsTrigger>
                <TabsTrigger value="notas" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> Notas
                </TabsTrigger>
                <TabsTrigger value="tareas" className="gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" aria-hidden /> Tareas
                </TabsTrigger>
                {canMonitor && (
                  <TabsTrigger value="monitoreo" className="gap-1.5">
                    <Activity className="h-3.5 w-3.5" aria-hidden /> Monitoreo
                  </TabsTrigger>
                )}
                <TabsTrigger value="actividad" className="gap-1.5">
                  <History className="h-3.5 w-3.5" aria-hidden /> Actividad
                </TabsTrigger>
              </TabsList>

              {detail.isLoading ? (
                <div className="mt-4 space-y-3" aria-busy="true" aria-label="Cargando la ficha">
                  <Skeleton className="h-24 w-full rounded-2xl" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
              ) : detail.isError ? (
                <div className="mt-4">
                  <QueryProblem
                    error={detail.error}
                    onRetry={() => void detail.refetch()}
                    retrying={detail.isFetching}
                  />
                </div>
              ) : (
                <>
                  <TabsContent value="resumen" className="mt-4 space-y-4">
                    {patient.allergies.length > 0 && (
                      <div
                        className="flex items-start gap-2 rounded-2xl border border-sos/30 bg-sos/5 p-3 text-sm"
                        data-testid="allergies"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sos" aria-hidden />
                        <p>
                          <span className="font-semibold text-sos">Alergias: </span>
                          {patient.allergies.join(", ")}
                        </p>
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-border p-4">
                      <Fact label="Documento">
                        {patient.document_number
                          ? `${patient.document_type ?? ""} ${patient.document_number}`.trim()
                          : null}
                      </Fact>
                      <Fact label="Nacimiento">
                        {patient.birth_date
                          ? dateLabel(`${patient.birth_date}T12:00:00-05:00`)
                          : null}
                      </Fact>
                      <Fact label="EPS">{patient.eps_name}</Fact>
                      <Fact label="Historia o referencia">{patient.external_ref}</Fact>
                      <Fact label="Ciudad">{patient.city}</Fact>
                      <Fact label="Habitación">{patient.room}</Fact>
                      <Fact label="Dirección">
                        {patient.address ? (
                          <span className="inline-flex items-start gap-1">
                            <MapPin
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden
                            />{" "}
                            {patient.address}
                          </span>
                        ) : null}
                      </Fact>
                      <Fact label="Registrado">{dateLabel(patient.created_at)}</Fact>
                    </dl>

                    {patient.conditions.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Condiciones
                        </p>
                        <p className="flex flex-wrap gap-1.5">
                          {patient.conditions.map((c) => (
                            <span key={c} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                              {c}
                            </span>
                          ))}
                        </p>
                      </div>
                    )}

                    <div className="rounded-2xl border border-border p-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Contacto de emergencia
                      </p>
                      {patient.emergency_name || patient.emergency_phone ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm">
                            {patient.emergency_name ?? "Sin nombre"}
                            {patient.emergency_phone ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {patient.emergency_phone}
                              </span>
                            ) : null}
                          </p>
                          {patient.emergency_phone &&
                            normalizeCoPhone(patient.emergency_phone).e164 && (
                              <Button asChild size="sm" variant="outline">
                                <a href={`tel:+${normalizeCoPhone(patient.emergency_phone).e164}`}>
                                  <Phone aria-hidden /> Llamar
                                </a>
                              </Button>
                            )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Sin contacto registrado. Agrégalo al editar al paciente.
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {patient.family_updates_ok
                          ? "La familia autorizó recibir actualizaciones."
                          : "Aún no hay autorización de la familia para actualizaciones."}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border p-4 text-sm">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Seguimiento
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
                          Escala de saturación {patient.spo2_scale}
                          {patient.spo2_scale === 2 ? " (meta 88–92 %)" : ""}
                        </span>
                        {canWrite && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setScaleOpen(true)}
                          >
                            Cambiar
                          </Button>
                        )}
                      </div>
                      {canWrite && patient.status === "active" && canMonitor && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label
                            htmlFor="drawer-modality"
                            className="text-xs text-muted-foreground"
                          >
                            Modalidad
                          </label>
                          <Select
                            value={patient.modality}
                            onValueChange={(v) =>
                              void actions.setMonitoring
                                .mutateAsync({
                                  patientId: patient.id,
                                  on: patient.monitoring,
                                  modality: v,
                                })
                                .then(() => toast.success("Modalidad actualizada"))
                                .catch((err: Error) => toast.error(friendlyError(err)))
                            }
                          >
                            <SelectTrigger id="drawer-modality" className="h-8 w-44 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MODALITY_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Autorización para tratar los datos confirmada el{" "}
                      {dateLabel(patient.consent_confirmed_at)} (Ley 1581 de 2012).
                    </p>
                  </TabsContent>

                  <TabsContent value="casos" className="mt-4">
                    <CasesPanel
                      cases={d?.cases ?? []}
                      now={now}
                      canWrite={canWrite && patient.status !== "discharged"}
                      onOpen={() => setCaseDialog({ open: true, existing: null })}
                      onEdit={(c) => setCaseDialog({ open: true, existing: c })}
                      onClose={setClosing}
                      onRate={setRating}
                    />
                  </TabsContent>

                  <TabsContent value="notas" className="mt-4">
                    <NotesPanel
                      patient={patient}
                      notes={d?.notes ?? []}
                      cases={d?.cases ?? []}
                      actions={actions}
                      now={now}
                      canWrite={canWrite || canMonitor}
                    />
                  </TabsContent>

                  <TabsContent value="tareas" className="mt-4">
                    <TasksPanel
                      patient={patient}
                      tasks={d?.tasks ?? []}
                      cases={d?.cases ?? []}
                      actions={actions}
                      now={now}
                      canWrite={canWrite || canMonitor}
                    />
                  </TabsContent>

                  {canMonitor && (
                    <TabsContent value="monitoreo" className="mt-4">
                      <PatientMonitorPanel
                        patient={patient}
                        live={live}
                        alerts={(d?.alerts ?? []).filter((a) => a.status !== "resolved")}
                        obs={d?.obs ?? []}
                        devices={devices.filter((x) => x.patient_id === patient.id)}
                        now={now}
                        actions={actions}
                        overview={overview}
                        canWrite={canMonitor}
                      />
                    </TabsContent>
                  )}

                  <TabsContent value="actividad" className="mt-4">
                    <ActivityPanel items={timeline} now={now} />
                  </TabsContent>
                </>
              )}
            </Tabs>

            <PatientFormDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              scope={scope}
              overview={overview}
              actions={actions}
              patient={patient}
              applications={applications}
            />
            <DischargeDialog
              open={dischargeOpen}
              onOpenChange={setDischargeOpen}
              actions={actions}
              patient={patient}
            />
            <ScaleDialog
              open={scaleOpen}
              onOpenChange={setScaleOpen}
              actions={actions}
              patient={patient}
            />
            <FamilyUpdateDialog
              open={familyOpen}
              onOpenChange={setFamilyOpen}
              actions={actions}
              patient={patient}
              live={live}
              institutionName={scope.institutionName}
              signer={scope.viewerName}
              now={now}
            />
            <CaseDialog
              open={caseDialog.open}
              onOpenChange={(o) => setCaseDialog((s) => ({ ...s, open: o }))}
              actions={actions}
              patient={patient}
              existing={caseDialog.existing}
              applications={applications}
            />
            <CloseCaseDialog
              open={closing !== null}
              onOpenChange={(o) => !o && setClosing(null)}
              actions={actions}
              target={closing}
            />
            <RateCaseDialog
              open={rating !== null}
              onOpenChange={(o) => !o && setRating(null)}
              actions={actions}
              target={rating}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
