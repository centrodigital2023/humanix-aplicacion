// Pacientes y coordinación de cuidado — gestión integral de casos, historial de servicios y notas médicas.
//
// El tablero de la institución: sus cinco cifras (Pacientes · Activos · Pendientes · Completados · ★ Promedio), lo que hoy pide atención,
// las postulaciones aceptadas que esperan su caso, los primeros pasos, la lista de pacientes con su ficha y lo que el equipo logra cada
// semana. Todo sale de datos reales de la institución y se actualiza en vivo. Los topes del plan los aplica el servidor.
import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  Star,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAcceptedApplications,
  useCareFlags,
  useCareOverview,
  useCareActions,
  useCareRealtime,
  useInstAlerts,
  useInstCases,
  useInstDevices,
  useInstLive,
  useInstPatients,
  useInstTasks,
  type AcceptedApplication,
} from "@/hooks/use-inst-care";
import { useMilestones } from "@/hooks/use-inst-celebrate";
import { useNow } from "@/hooks/use-now";
import {
  EMPTY_OVERVIEW,
  MODALITY_META,
  MODALITY_ORDER,
  careOnboarding,
  filterPatients,
  patientKpis,
  sortPatients,
  type PatientSort,
} from "@/lib/instCare";
import type {
  InstAlert,
  InstCase,
  InstTask,
  PatientModality,
  PatientStatus,
} from "@/lib/instCareTypes";
import { careCompass, type FocusTarget } from "@/lib/instCelebrate";
import type { PatientFormValues } from "@/lib/instForms";
import { cn } from "@/lib/utils";
import { AchievementsDialog, CelebrationToast } from "@/components/humanix/instcare/Celebration";
import { CompassStrip } from "@/components/humanix/instcare/CompassStrip";
import { EmptyScene } from "@/components/humanix/instcare/EmptyScene";
import { ImpactCard } from "@/components/humanix/instcare/ImpactCard";
import { KpiTile } from "@/components/humanix/instcare/KpiTile";
import { PatientPicker } from "@/components/humanix/instcare/PatientPicker";
import { PlanMeters } from "@/components/humanix/instcare/PlanMeters";
import { QueryProblem, StaleNotice } from "@/components/humanix/instcare/QueryProblem";
import { blockingProblem, hasStaleData } from "@/components/humanix/instcare/queryState";
import type { CareScope } from "@/components/humanix/instcare/scope";
import { TONE } from "@/components/humanix/instcare/tones";
import { ApplicationsBanner } from "./ApplicationsBanner";
import { OnboardingCard } from "./OnboardingCard";
import { PatientCard } from "./PatientCard";
import { PatientDrawer, type DrawerTab } from "./PatientDrawer";
import { CaseDialog } from "./PatientCases";
import { PatientFormDialog } from "./PatientFormDialog";
import { TasksInbox } from "./PatientTasks";

const PAGE = 24;
const STATUS_FILTERS: Array<{ value: PatientStatus | "open" | "all"; label: string }> = [
  { value: "open", label: "Abiertos" },
  { value: "active", label: "Activos" },
  { value: "pending", label: "Pendientes" },
  { value: "paused", label: "En pausa" },
  { value: "discharged", label: "Con alta" },
  { value: "all", label: "Todos" },
];

export function PatientsHub({
  scope,
  onOpenMonitoring,
  onOpenOffers,
  onOpenTeam,
}: {
  scope: CareScope;
  /** Lleva al módulo de monitoreo (si la persona tiene acceso). */
  onOpenMonitoring?: () => void;
  /** Lleva a las ofertas y postulaciones. */
  onOpenOffers?: () => void;
  /** Lleva a la pestaña del equipo (solo la cuenta dueña). */
  onOpenTeam?: () => void;
}) {
  const inst = scope.institutionId;
  const now = useNow(60_000);
  const overviewQ = useCareOverview(inst);
  const patientsQ = useInstPatients(inst);
  const casesQ = useInstCases(inst);
  const tasksQ = useInstTasks(inst);
  const liveQ = useInstLive(inst);
  const alertsQ = useInstAlerts(inst);
  const devicesQ = useInstDevices(inst);
  const appsQ = useAcceptedApplications(inst, scope.canPatients);
  const flagsQ = useCareFlags(inst, scope.isOwner);
  useCareRealtime(inst);
  const actions = useCareActions(inst);

  const overview = overviewQ.data ?? EMPTY_OVERVIEW;
  const patients = useMemo(() => patientsQ.data ?? [], [patientsQ.data]);
  const cases = useMemo(() => casesQ.data ?? [], [casesQ.data]);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const alerts = useMemo(() => alertsQ.data ?? [], [alertsQ.data]);
  const devices = useMemo(() => devicesQ.data ?? [], [devicesQ.data]);
  const applications = useMemo(() => appsQ.data ?? [], [appsQ.data]);
  const flags = flagsQ.data;

  const milestones = useMilestones(scope.viewerId, overviewQ.data, {
    hasControl: flags?.hasControl,
    hasDevice: flags?.hasDevice,
  });

  // Filtros
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PatientStatus | "open" | "all">("open");
  const [modality, setModality] = useState<PatientModality | "all">("all");
  const [sort, setSort] = useState<PatientSort>("attention");
  const [shown, setShown] = useState(PAGE);

  // Ventanas
  const [formOpen, setFormOpen] = useState(false);
  const [preset, setPreset] = useState<Partial<PatientFormValues> | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("resumen");
  const [pickFor, setPickFor] = useState<AcceptedApplication | null>(null);
  const [caseFor, setCaseFor] = useState<{ patientId: string; applicationId: string } | null>(null);
  const [achievementsOpen, setAchievementsOpen] = useState(false);

  const byPatient = useMemo(() => {
    const c = new Map<string, InstCase[]>();
    const t = new Map<string, InstTask[]>();
    const a = new Map<string, InstAlert[]>();
    for (const x of cases) c.set(x.patient_id, [...(c.get(x.patient_id) ?? []), x]);
    for (const x of tasks) t.set(x.patient_id, [...(t.get(x.patient_id) ?? []), x]);
    for (const x of alerts) a.set(x.patient_id, [...(a.get(x.patient_id) ?? []), x]);
    return { cases: c, tasks: t, alerts: a };
  }, [cases, tasks, alerts]);

  const visible = useMemo(() => {
    const filtered = filterPatients(patients, { q, status, modality });
    return sortPatients(filtered, sort, { live: liveQ.map, alerts, now });
  }, [patients, q, status, modality, sort, liveQ.map, alerts, now]);

  const kpis = patientKpis(overview);
  const compass = careCompass(overview, now, scope.viewerName);
  const onboarding = careOnboarding(overview, {
    hasCase: cases.length > 0,
    hasNote: flags?.hasNote,
    hasControl: flags?.hasControl,
    hasTeam: flags?.hasTeam,
  });
  const selected = patients.find((p) => p.id === selectedId) ?? null;

  const openForm = (p?: Partial<PatientFormValues>) => {
    setPreset(p);
    setFormOpen(true);
  };
  const openPatient = (id: string, t: DrawerTab = "resumen") => {
    setTab(t);
    setSelectedId(id);
  };

  const focus = (target: FocusTarget) => {
    if (target === "tasks")
      document.getElementById("tareas-hoy")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else onOpenMonitoring?.();
  };

  const onStep = (key: string) => {
    if (key === "patient") openForm();
    else if (key === "case") {
      if (patients.length === 0) openForm({ with_case: true });
      else {
        const p = patients.find((x) => x.status !== "discharged");
        if (p) openPatient(p.id, "casos");
      }
    } else if (key === "note") {
      const p = patients.find((x) => x.status !== "discharged");
      if (p) openPatient(p.id, "notas");
      else openForm();
    } else if (key === "monitor" || key === "control" || key === "device") {
      if (onOpenMonitoring) onOpenMonitoring();
      else {
        const p = patients.find((x) => x.status === "active");
        if (p) openPatient(p.id, "monitoreo");
      }
    } else if (key === "team") onOpenTeam?.();
  };

  const loading = patientsQ.isLoading || overviewQ.isLoading;
  // Las cifras salen del resumen del servidor: si no llegó, mostrar ceros sería engañar.
  const problem = blockingProblem(patientsQ, overviewQ);
  const stale = hasStaleData(patientsQ, overviewQ);
  const refreshing = patientsQ.isFetching || overviewQ.isFetching || casesQ.isFetching;
  const refetchAll = () => {
    void overviewQ.refetch();
    void patientsQ.refetch();
    void casesQ.refetch();
    void tasksQ.refetch();
    void alertsQ.refetch();
    void liveQ.refetch();
  };
  const KPI_ICON = {
    patients: Users,
    active: Activity,
    pending: Clock,
    completed: CheckCircle2,
    rating: Star,
  } as const;

  return (
    <div className="space-y-5" data-testid="patients-hub">
      {/* Encabezado */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold leading-tight sm:text-2xl">
            Pacientes y coordinación de cuidado
          </h2>
          <p className="text-sm text-muted-foreground">
            Gestión integral de casos, historial de servicios y notas médicas
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAchievementsOpen(true)}
            aria-label={`Logros del equipo: ${milestones.states.filter((s) => s.earned).length} de ${milestones.states.length}`}
          >
            <Trophy className="text-copper" aria-hidden />
            <span className="tabular-nums">
              {milestones.states.filter((s) => s.earned).length}/{milestones.states.length}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={refetchAll}
            aria-label="Actualizar"
            disabled={refreshing}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
          </Button>
          {scope.canPatients && (
            <Button
              type="button"
              variant="hero"
              onClick={() => openForm()}
              data-testid="add-patient"
            >
              <UserPlus aria-hidden /> Agregar paciente
            </Button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando pacientes">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : problem ? (
        <QueryProblem error={problem.error} onRetry={refetchAll} retrying={refreshing} />
      ) : (
        <>
          {stale && <StaleNotice onRetry={refetchAll} retrying={refreshing} />}
          <CompassStrip compass={compass} onFocus={focus} />

          <section
            aria-label="Cifras de pacientes"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          >
            {kpis.map((k) => (
              <KpiTile
                key={k.key}
                label={k.label}
                value={/^\d+$/.test(k.value) ? Number(k.value) : k.value}
                sub={k.sub}
                tone={k.tone}
                icon={KPI_ICON[k.key]}
                testId={`kpi-${k.key}`}
              />
            ))}
          </section>

          <ApplicationsBanner
            applications={applications}
            now={now}
            onStartNew={(a) =>
              openForm({ with_case: true, application_id: a.application_id, title: a.offer_title })
            }
            onStartExisting={setPickFor}
          />

          {patients.length === 0 ? (
            <EmptyScene
              variant="patients"
              testId="patients-empty"
              title="Sin pacientes activos"
              description="Agrega un paciente manualmente o acepta una postulación para iniciar coordinación."
              actions={
                <>
                  {scope.canPatients && (
                    <Button
                      type="button"
                      variant="hero"
                      onClick={() => openForm({ with_case: true })}
                      data-testid="create-first-case"
                    >
                      Crear primer caso
                    </Button>
                  )}
                  {scope.canPatients && (
                    <Button type="button" variant="outline" onClick={() => openForm()}>
                      <UserPlus aria-hidden /> Agregar paciente
                    </Button>
                  )}
                  {onOpenOffers && (
                    <Button type="button" variant="ghost" onClick={onOpenOffers}>
                      Ver postulaciones
                    </Button>
                  )}
                </>
              }
            />
          ) : (
            <>
              <OnboardingCard onboarding={onboarding} onStep={onStep} />

              <div id="tareas-hoy" className="scroll-mt-24">
                <TasksInbox
                  tasks={tasks}
                  patients={patients}
                  now={now}
                  actions={actions}
                  canWrite={scope.canPatients || scope.canMonitoring}
                  onOpenPatient={(id) => openPatient(id, "tareas")}
                />
              </div>

              <section aria-label="Lista de pacientes" className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setShown(PAGE);
                      }}
                      placeholder="Buscar por nombre, documento, habitación o condición…"
                      aria-label="Buscar paciente"
                      className="pl-9"
                      autoComplete="off"
                    />
                  </div>
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                    <SelectTrigger className="sm:w-40" aria-label="Estado">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sort} onValueChange={(v) => setSort(v as PatientSort)}>
                    <SelectTrigger className="sm:w-44" aria-label="Orden">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="attention">Primero quien más atención pide</SelectItem>
                      <SelectItem value="name">Por nombre</SelectItem>
                      <SelectItem value="recent">Más recientes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div role="group" aria-label="Modalidad" className="flex flex-wrap gap-1.5">
                  {(["all", ...MODALITY_ORDER] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={modality === m}
                      onClick={() => {
                        setModality(m);
                        setShown(PAGE);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-premium",
                        modality === m
                          ? m === "all"
                            ? "border-trust bg-trust/10 text-trust"
                            : cn(TONE[MODALITY_META[m].tone].chip)
                          : "border-border text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {m === "all" ? "Todos" : MODALITY_META[m].label}
                    </button>
                  ))}
                </div>

                {visible.length === 0 ? (
                  <div
                    className="rounded-2xl border border-dashed border-border p-8 text-center"
                    data-testid="no-results"
                  >
                    <p className="text-sm font-medium">Ningún paciente coincide</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prueba con otra búsqueda o quita los filtros.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => {
                        setQ("");
                        setStatus("open");
                        setModality("all");
                      }}
                    >
                      Limpiar filtros
                    </Button>
                  </div>
                ) : (
                  <>
                    <ul
                      className="grid gap-3 sm:grid-cols-2"
                      aria-label={`${visible.length} pacientes`}
                    >
                      {visible.slice(0, shown).map((p) => (
                        <li key={p.id}>
                          <PatientCard
                            patient={p}
                            cases={byPatient.cases.get(p.id) ?? []}
                            tasks={byPatient.tasks.get(p.id) ?? []}
                            live={liveQ.map.get(p.id)}
                            alerts={byPatient.alerts.get(p.id) ?? []}
                            now={now}
                            onOpen={() => openPatient(p.id)}
                          />
                        </li>
                      ))}
                    </ul>
                    {visible.length > shown && (
                      <div className="text-center">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShown((n) => n + PAGE)}
                        >
                          Mostrar más ({visible.length - shown})
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}

          <PlanMeters overview={overview} canManagePlan={scope.isOwner} />
          <ImpactCard overview={overview} institution={scope.institutionName} />
        </>
      )}

      <PatientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        scope={scope}
        overview={overview}
        actions={actions}
        preset={preset}
        applications={applications}
        onSaved={(id, created) => {
          if (created) openPatient(id);
        }}
      />

      <PatientDrawer
        patient={selected}
        scope={scope}
        overview={overview}
        actions={actions}
        live={selected ? liveQ.map.get(selected.id) : undefined}
        devices={devices}
        applications={applications}
        now={now}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setSelectedId(null)}
      />

      <Dialog open={pickFor !== null} onOpenChange={(o) => !o && setPickFor(null)}>
        <DialogContent className="sm:max-w-md" data-testid="pick-patient">
          <DialogHeader>
            <DialogTitle>¿Para cuál paciente?</DialogTitle>
            <DialogDescription>
              {pickFor?.offer_title}. Se abre un caso con el profesional de esta postulación.
            </DialogDescription>
          </DialogHeader>
          <PatientPicker
            patients={patients.filter((p) => p.status !== "discharged")}
            now={now}
            emptyText="Aún no hay pacientes. Usa «Con paciente nuevo»."
            onPick={(p) => {
              if (pickFor) setCaseFor({ patientId: p.id, applicationId: pickFor.application_id });
              setPickFor(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <CaseDialog
        open={caseFor !== null}
        onOpenChange={(o) => !o && setCaseFor(null)}
        actions={actions}
        patient={
          patients.find((p) => p.id === caseFor?.patientId) ?? {
            id: caseFor?.patientId ?? "",
            full_name: "",
          }
        }
        applications={applications}
        presetApplicationId={caseFor?.applicationId ?? null}
      />

      <CelebrationToast
        plan={milestones.plan}
        institution={scope.institutionName}
        onDismiss={milestones.dismiss}
      />
      <AchievementsDialog
        open={achievementsOpen}
        onOpenChange={setAchievementsOpen}
        states={milestones.states}
      />
    </div>
  );
}
