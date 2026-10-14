// Monitoreo Clínico · Live — el tablero de las personas que la institución vigila (hospitalizadas, remotas, posoperatorias, crónicas, adultos
// mayores): quién está bien y quién necesita ojos, de un vistazo.
//
// «Triage NEWS2» es el semáforo del puntaje de alerta temprana (Royal College of Physicians), calculado por el servidor con cada control
// (a mano o de un dispositivo): apoya la decisión clínica, no la reemplaza. Las alertas tienen plazo y, con el plan IPS Mejorado, se escalan
// solas. Todo se actualiza en vivo (Realtime), sin recargar.
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Radio,
  RefreshCw,
  Repeat,
  Search,
  ShieldAlert,
  Trophy,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCareActions,
  useCareFlags,
  useCareOverview,
  useCareRealtime,
  useEscalationTimer,
  useInstAlerts,
  useInstDevices,
  useInstLive,
  useInstPatients,
  useInstTasks,
  useRecentObs,
} from "@/hooks/use-inst-care";
import { useMilestones } from "@/hooks/use-inst-celebrate";
import { useNow } from "@/hooks/use-now";
import { EMPTY_OVERVIEW, MODALITY_META, MODALITY_ORDER } from "@/lib/instCare";
import type { InstPatient, PatientModality } from "@/lib/instCareTypes";
import type { PatientFormValues } from "@/lib/instForms";
import { careCompass, streakInfo } from "@/lib/instCelebrate";
import { dueRound, monitorKpis, triageColumns } from "@/lib/instMonitoring";
import { cn } from "@/lib/utils";
import { AchievementsDialog, CelebrationToast } from "@/components/humanix/instcare/Celebration";
import { CompassStrip } from "@/components/humanix/instcare/CompassStrip";
import { EmptyScene } from "@/components/humanix/instcare/EmptyScene";
import { ImpactCard } from "@/components/humanix/instcare/ImpactCard";
import { KpiTile } from "@/components/humanix/instcare/KpiTile";
import { PlanMeters } from "@/components/humanix/instcare/PlanMeters";
import { QueryProblem, StaleNotice } from "@/components/humanix/instcare/QueryProblem";
import { blockingProblem, hasStaleData } from "@/components/humanix/instcare/queryState";
import type { CareScope } from "@/components/humanix/instcare/scope";
import { TONE } from "@/components/humanix/instcare/tones";
import { PatientDrawer, type DrawerTab } from "@/components/humanix/patients/PatientDrawer";
import { PatientFormDialog } from "@/components/humanix/patients/PatientFormDialog";
import { AddMonitoredDialog } from "./AddMonitoredDialog";
import { AlertCenter } from "./AlertCenter";
import { DevicesList } from "./DeviceDialog";
import { HandoffDialog } from "./HandoffDialog";
import { MonitorCard } from "./MonitorCard";
import { VitalsDialog } from "./VitalsDialog";

export function MonitoringHub({
  scope,
  onOpenPatients,
}: {
  scope: CareScope;
  /** Lleva al módulo de pacientes (si la persona tiene acceso). */
  onOpenPatients?: () => void;
}) {
  const inst = scope.institutionId;
  const now = useNow(15_000);
  const overviewQ = useCareOverview(inst);
  const patientsQ = useInstPatients(inst);
  const liveQ = useInstLive(inst);
  const alertsQ = useInstAlerts(inst);
  const tasksQ = useInstTasks(inst);
  const devicesQ = useInstDevices(inst);
  const flagsQ = useCareFlags(inst, scope.isOwner);
  useCareRealtime(inst);
  const actions = useCareActions(inst);

  const overview = overviewQ.data ?? EMPTY_OVERVIEW;
  const patients = useMemo(() => patientsQ.data ?? [], [patientsQ.data]);
  const alerts = useMemo(() => alertsQ.data ?? [], [alertsQ.data]);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const devices = useMemo(() => devicesQ.data ?? [], [devicesQ.data]);
  useEscalationTimer(inst, alertsQ.data, overview.limits.escalation);

  const milestones = useMilestones(scope.viewerId, overviewQ.data, {
    hasControl: flagsQ.data?.hasControl,
    hasDevice: flagsQ.data?.hasDevice,
  });

  const [q, setQ] = useState("");
  const [modality, setModality] = useState<PatientModality | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("monitoreo");
  const [recordFor, setRecordFor] = useState<InstPatient | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [preset, setPreset] = useState<Partial<PatientFormValues>>({ monitor: true });
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);

  const kpis = useMemo(
    () => monitorKpis(patients, liveQ.map, alerts, now),
    [patients, liveQ.map, alerts, now],
  );
  const columns = useMemo(
    () => triageColumns(patients, liveQ.map, alerts, now, { q, modality }),
    [patients, liveQ.map, alerts, now, q, modality],
  );
  const round = useMemo(() => dueRound(patients, liveQ.map, now, 15), [patients, liveQ.map, now]);
  const monitored = patients.filter((p) => p.monitoring && p.status === "active");
  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p] as const)), [patients]);
  const selected = patients.find((p) => p.id === selectedId) ?? null;
  const compass = careCompass(overview, now, scope.viewerName);
  const streak = streakInfo(overview);
  const matches = columns.reduce((n, c) => n + c.entries.length, 0);

  // Los controles recientes de quien se va a registrar (para completar el NEWS2 con lo último conocido de 12 h).
  const historyQ = useRecentObs(inst, recordFor?.id);

  // Las alertas y las lecturas en vivo son esenciales: sin ellas el tablero diría «0 alertas» sin saberlo.
  const loading =
    patientsQ.isLoading || overviewQ.isLoading || liveQ.isLoading || alertsQ.isLoading;
  const problem = blockingProblem(patientsQ, overviewQ, liveQ, alertsQ);
  const stale = hasStaleData(patientsQ, overviewQ, liveQ, alertsQ);
  const refreshing = patientsQ.isFetching || liveQ.isFetching || alertsQ.isFetching;
  const refetchAll = () => {
    void overviewQ.refetch();
    void patientsQ.refetch();
    void liveQ.refetch();
    void alertsQ.refetch();
    void devicesQ.refetch();
  };
  const canWrite = scope.canMonitoring;
  const openPatient = (id: string, t: DrawerTab = "monitoreo") => {
    setTab(t);
    setSelectedId(id);
  };
  /** Inicio rápido del estado vacío: el formulario del paciente nuevo ya con su modalidad y en monitoreo. */
  const startWith = (modality: PatientModality) => {
    setPreset({ monitor: true, modality });
    setFormOpen(true);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5" data-testid="monitoring-hub">
        {/* Encabezado */}
        <header className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-biosensor/10 via-background to-fuchsia-neural/10 p-4 sm:p-5">
          <div aria-hidden="true" className="orb-bio -right-10 -top-10 h-44 w-44 opacity-60" />
          <svg
            aria-hidden="true"
            viewBox="0 0 240 40"
            className="pointer-events-none absolute bottom-0 right-0 hidden h-10 w-60 opacity-50 sm:block"
            preserveAspectRatio="none"
          >
            <path
              d="M0 22h60l8-14 10 28 10-20 6 6h146"
              fill="none"
              className="animate-ecg-loop stroke-biosensor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold leading-tight sm:text-2xl">
                  Monitoreo Clínico · Live
                </h2>
                <span className="badge-live" data-testid="live-badge">
                  <Radio className="h-3 w-3 motion-safe:animate-pulse" aria-hidden /> En vivo
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-fuchsia-neural/30 bg-fuchsia-neural/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-neural">
                      <ShieldAlert className="h-3 w-3" aria-hidden /> Triage NEWS2
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Semáforo del puntaje de alerta temprana NEWS2 (Royal College of Physicians),
                    calculado con cada control. Apoya la decisión clínica; no es un diagnóstico ni
                    reemplaza al profesional. No aplica a menores de 16 años.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-1 text-sm text-muted-foreground" data-testid="monitor-subtitle">
                {loading
                  ? "Cargando el monitoreo…"
                  : problem
                    ? "No pudimos leer el monitoreo"
                    : `${kpis.total} ${kpis.total === 1 ? "paciente" : "pacientes"} · ${kpis.online} en línea`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAchievementsOpen(true)}
                aria-label="Logros del equipo"
              >
                <Trophy className="text-copper" aria-hidden />
                <span className="tabular-nums">
                  {milestones.states.filter((s) => s.earned).length}/{milestones.states.length}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refetchAll}
                disabled={refreshing}
                data-testid="refresh"
              >
                <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden /> Actualizar
              </Button>
              {canWrite && (
                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  data-testid="add-monitored-btn"
                >
                  <UserPlus aria-hidden /> Agregar
                </Button>
              )}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Cargando el monitoreo">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        ) : problem ? (
          <QueryProblem error={problem.error} onRetry={refetchAll} retrying={refreshing} />
        ) : (
          <>
            {stale && <StaleNotice onRetry={refetchAll} retrying={refreshing} />}
            <section
              aria-label="Cifras del monitoreo"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              <KpiTile
                label="Total"
                value={kpis.total}
                sub="en monitoreo"
                tone="trust"
                icon={Users}
                testId="kpi-total"
              />
              <KpiTile
                label="En línea"
                value={kpis.online}
                sub="con dispositivo activo"
                tone="ok"
                icon={Wifi}
                testId="kpi-online"
              />
              <KpiTile
                label="Alertas"
                value={kpis.alerts}
                sub={kpis.unacked > 0 ? `${kpis.unacked} sin ver` : "abiertas"}
                tone={kpis.alerts > 0 ? "warn" : "muted"}
                icon={AlertTriangle}
                alert={kpis.unacked > 0}
                testId="kpi-alerts"
              />
              <KpiTile
                label="Críticos"
                value={kpis.critical}
                sub="NEWS2 de 7 o más"
                tone={kpis.critical > 0 ? "sos" : "muted"}
                icon={Activity}
                alert={kpis.critical > 0}
                testId="kpi-critical"
              />
            </section>

            {monitored.length === 0 ? (
              <EmptyScene
                variant="monitoring"
                testId="monitoring-empty"
                title="Sin pacientes en monitoreo"
                description="Agrega pacientes hospitalizados, remotos o crónicos. La app Humanix o un smartwatch compatible sincroniza los signos vitales en tiempo real."
                actions={
                  <>
                    {canWrite && (
                      <Button
                        type="button"
                        variant="hero"
                        onClick={() => setAddOpen(true)}
                        data-testid="add-first-monitored"
                      >
                        <UserPlus aria-hidden /> Agregar primer paciente
                      </Button>
                    )}
                    {onOpenPatients && (
                      <Button type="button" variant="ghost" onClick={onOpenPatients}>
                        Ir a Pacientes
                      </Button>
                    )}
                  </>
                }
                footer={
                  canWrite ? (
                    <div className="text-center" data-testid="quick-start">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        ¿A quién vas a vigilar primero?
                      </p>
                      <div
                        role="group"
                        aria-label="Tipo de paciente para empezar"
                        className="flex flex-wrap justify-center gap-1.5"
                      >
                        {MODALITY_ORDER.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => startWith(m)}
                            className={cn(
                              "focus-premium rounded-full border px-3 py-1 text-xs font-semibold transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                              TONE[MODALITY_META[m].tone].chip,
                            )}
                          >
                            {MODALITY_META[m].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <>
                <CompassStrip compass={compass} />

                {streak.count > 0 && (
                  <p
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
                      TONE[streak.tone].chip,
                    )}
                    title={streak.hint}
                    data-testid="streak"
                  >
                    {streak.headline}
                    {streak.next !== null && (
                      <span className="font-normal opacity-80">
                        · faltan {streak.toNext} para {streak.next}
                      </span>
                    )}
                  </p>
                )}

                <AlertCenter
                  alerts={alerts}
                  patients={patientMap}
                  now={now}
                  actions={actions}
                  canWrite={canWrite}
                  onOpenPatient={(id) => openPatient(id)}
                  title="Alertas por atender"
                />

                {round.length > 0 && (
                  <section aria-label="Ronda de signos" className="space-y-2" data-testid="round">
                    <h3 className="font-display text-sm font-bold">Ronda de signos</h3>
                    <p className="text-xs text-muted-foreground">
                      Quienes tienen el control vencido o por vencer en 15 minutos.
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {round.slice(0, 12).map((r) => (
                        <li key={r.patient.id}>
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => setRecordFor(r.patient)}
                            className={cn(
                              "focus-premium inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50 disabled:opacity-60",
                              r.minutes < 0
                                ? "border-warn/40 bg-warn/5 text-warn"
                                : "border-border",
                            )}
                          >
                            {r.patient.full_name}
                            <span className="tabular-nums text-muted-foreground">
                              {r.dueAt === null
                                ? "primer control"
                                : r.minutes < 0
                                  ? `vencido ${-r.minutes} min`
                                  : r.minutes <= 1
                                    ? "ahora"
                                    : `en ${r.minutes} min`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section aria-label="Buscar y filtrar" className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Buscar paciente..."
                        aria-label="Buscar paciente"
                        className="pl-9"
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setHandoffOpen(true)}
                      >
                        <Repeat aria-hidden /> Relevo de turno
                      </Button>
                      {devices.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDevicesOpen((v) => !v)}
                          aria-expanded={devicesOpen}
                        >
                          <Wifi aria-hidden /> Dispositivos (
                          {devices.filter((d) => d.status === "active").length})
                        </Button>
                      )}
                    </div>
                  </div>
                  <div role="group" aria-label="Modalidad" className="flex flex-wrap gap-1.5">
                    {(["all", ...MODALITY_ORDER] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={modality === m}
                        onClick={() => setModality(m)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-premium",
                          modality === m
                            ? m === "all"
                              ? "border-trust bg-trust/10 text-trust"
                              : TONE[MODALITY_META[m].tone].chip
                            : "border-border text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {m === "all" ? "Todos" : MODALITY_META[m].label}
                      </button>
                    ))}
                  </div>
                  {devicesOpen && (
                    <div className="rounded-2xl border border-border p-3">
                      <DevicesList
                        devices={devices}
                        now={now}
                        actions={actions}
                        canWrite={canWrite}
                        names={new Map(patients.map((p) => [p.id, p.full_name]))}
                      />
                    </div>
                  )}
                </section>

                {matches === 0 ? (
                  <div
                    className="rounded-2xl border border-dashed border-border p-8 text-center"
                    data-testid="no-results"
                  >
                    <p className="text-sm font-medium">Ningún paciente coincide</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prueba con otra búsqueda o con «Todos».
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => {
                        setQ("");
                        setModality("all");
                      }}
                    >
                      Limpiar filtros
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {columns
                      .filter((c) => c.entries.length > 0)
                      .map((c) => (
                        <section
                          key={c.state}
                          aria-label={`${c.label}: ${c.entries.length}`}
                          data-testid={`col-${c.state}`}
                        >
                          <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-bold">
                            <span
                              className={cn("h-2.5 w-2.5 rounded-full", TONE[c.tone].solid)}
                              aria-hidden
                            />
                            {c.label}
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {c.entries.length}
                            </span>
                            {c.state === "pending" && (
                              <span className="text-[11px] font-normal text-muted-foreground">
                                aún sin controles o sin datos para puntuar
                              </span>
                            )}
                          </h3>
                          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {c.entries.map((e) => (
                              <li key={e.patient.id}>
                                <MonitorCard
                                  patient={e.patient}
                                  live={liveQ.map.get(e.patient.id)}
                                  status={e.status}
                                  canWrite={canWrite}
                                  onOpen={() => openPatient(e.patient.id)}
                                  onRecord={() => setRecordFor(e.patient)}
                                />
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                  </div>
                )}

                <PlanMeters overview={overview} canManagePlan={scope.isOwner} />
                <ImpactCard overview={overview} institution={scope.institutionName} />
              </>
            )}
          </>
        )}

        <AddMonitoredDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          patients={patients}
          overview={overview}
          actions={actions}
          now={now}
          canRegister
          onRegisterNew={() => {
            setPreset({ monitor: true });
            setFormOpen(true);
          }}
        />
        <PatientFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          scope={scope}
          overview={overview}
          actions={actions}
          preset={preset}
          applications={[]}
          onSaved={(id, created) => {
            if (created) openPatient(id);
          }}
        />
        <VitalsDialog
          open={recordFor !== null}
          onOpenChange={(o) => !o && setRecordFor(null)}
          patient={recordFor}
          history={historyQ.data ?? []}
          actions={actions}
          now={now}
        />
        <HandoffDialog
          open={handoffOpen}
          onOpenChange={setHandoffOpen}
          patients={patients.filter((p) => p.status === "active")}
          live={liveQ.map}
          alerts={alerts}
          tasks={tasks}
          overview={overview}
          actions={actions}
          institutionName={scope.institutionName}
          viewerName={scope.viewerName}
          now={now}
          onlyMonitored
        />
        <PatientDrawer
          patient={selected}
          scope={scope}
          overview={overview}
          actions={actions}
          live={selected ? liveQ.map.get(selected.id) : undefined}
          devices={devices}
          applications={[]}
          now={now}
          tab={tab}
          onTabChange={setTab}
          onClose={() => setSelectedId(null)}
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
    </TooltipProvider>
  );
}
