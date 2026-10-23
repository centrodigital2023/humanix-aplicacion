// Pacientes y monitoreo de la institución — datos con TanStack Query y avisos en vivo de Realtime (sin sondeo).
//
//   · Lecturas: tablas `inst_*` por RLS (la institución y su personal con el módulo de pacientes o el de monitoreo). Siempre con la lista
//     de columnas (nunca «*»: la huella del código de un dispositivo no se puede leer).
//   · Escrituras: solo por las funciones `inst_*` de la base (la base decide plan, límites, firmas, NEWS2 y alertas). Los errores llegan ya
//     traducidos al español (`CareError`).
//   · Tiempo real: una sola suscripción por pantalla; cada tabla invalida solo lo que le toca. Las lecturas de dispositivos llegan muchas:
//     se agrupan en una sola actualización cada 400 ms.
//   · Escalamiento: una alerta urgente o crítica que nadie ve en su plazo se escala (plan Institucional). La base lo revisa cada minuto; la
//     pantalla además lo pide a la hora exacta del vencimiento.
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTable } from "@/lib/epsMetrics";
import {
  EMPTY_OVERVIEW,
  careErrorKind,
  careErrorMessage,
  parseOverview,
  type CareErrorKind,
  type CareOverview,
} from "@/lib/instCare";
import {
  ALERT_COLUMNS,
  CASE_COLUMNS,
  DEVICE_COLUMNS,
  EVENT_COLUMNS,
  LIVE_COLUMNS,
  NOTE_COLUMNS,
  OBS_COLUMNS,
  PATIENT_COLUMNS,
  TASK_COLUMNS,
  type InstAlert,
  type InstCase,
  type InstDevice,
  type InstEvent,
  type InstLive,
  type InstNote,
  type InstObs,
  type InstPatient,
  type InstTask,
} from "@/lib/instCareTypes";
import type { CasePayload, PatientPayload } from "@/lib/instForms";
import { nextEscalationInMs } from "@/lib/instMonitoring";

// Las tablas y funciones de pacientes aún no están en los tipos generados (se regeneran con la base de datos).
const sb = supabase as unknown as SupabaseClient;

// ── Errores ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un error del servidor con su mensaje ya en español y su tipo (plan, validación, permiso, conflicto). */
export class CareError extends Error {
  kind: CareErrorKind;
  hint: string | null;
  /** La tabla o función aún no existe en esta base (la función no se habilitó). */
  notEnabled: boolean;
  constructor(raw: unknown) {
    super(careErrorMessage(raw));
    this.name = "CareError";
    this.kind = careErrorKind(raw);
    this.hint =
      typeof raw === "object" && raw !== null ? ((raw as { hint?: string }).hint ?? null) : null;
    this.notEnabled = isMissingTable(raw) || isMissingFunction(raw);
  }
}

function isMissingFunction(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (typeof message === "string" && /could not find the function/i.test(message))
  );
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new CareError(error);
  return data as T;
}

// ── Claves ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const careKeys = {
  root: (inst: string) => ["inst-care", inst] as const,
  overview: (inst: string) => ["inst-care", inst, "overview"] as const,
  patients: (inst: string) => ["inst-care", inst, "patients"] as const,
  cases: (inst: string) => ["inst-care", inst, "cases"] as const,
  tasks: (inst: string) => ["inst-care", inst, "tasks"] as const,
  live: (inst: string) => ["inst-care", inst, "live"] as const,
  alerts: (inst: string) => ["inst-care", inst, "alerts"] as const,
  devices: (inst: string) => ["inst-care", inst, "devices"] as const,
  applications: (inst: string) => ["inst-care", inst, "applications"] as const,
  flags: (inst: string) => ["inst-care", inst, "flags"] as const,
  detail: (inst: string, patient: string) => ["inst-care", inst, "detail", patient] as const,
};

const LIST_LIMIT = 1000;
const STALE = 15_000;

// ── Lecturas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cifras del tablero y plan con su uso (calculado en la base). Sin respuesta válida: tablero vacío con los topes del plan Free. */
export function useCareOverview(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.overview(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CareOverview> =>
      parseOverview(await rpc<unknown>("inst_care_overview")) ?? EMPTY_OVERVIEW,
  });
}

export function useInstPatients(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.patients(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstPatient[]> => {
      const { data, error } = await sb
        .from("inst_patients")
        .select(PATIENT_COLUMNS)
        .eq("institution_id", inst)
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstPatient[];
    },
  });
}

export function useInstCases(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.cases(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstCase[]> => {
      const { data, error } = await sb
        .from("inst_cases")
        .select(CASE_COLUMNS)
        .eq("institution_id", inst)
        .order("opened_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstCase[];
    },
  });
}

/** Tareas abiertas de toda la institución (las hechas se ven en la ficha de cada paciente). */
export function useInstTasks(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.tasks(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstTask[]> => {
      const { data, error } = await sb
        .from("inst_tasks")
        .select(TASK_COLUMNS)
        .eq("institution_id", inst)
        .eq("status", "open")
        .order("due_at", { ascending: true })
        .limit(LIST_LIMIT);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstTask[];
    },
  });
}

/** Estado en vivo de cada paciente monitoreado (último puntaje, próximo control, último dato del dispositivo). */
export function useInstLive(inst: string | null | undefined) {
  const query = useQuery({
    queryKey: careKeys.live(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstLive[]> => {
      const { data, error } = await sb
        .from("inst_live")
        .select(LIVE_COLUMNS)
        .eq("institution_id", inst)
        .limit(LIST_LIMIT);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstLive[];
    },
  });
  const map = useMemo(
    () => new Map((query.data ?? []).map((l) => [l.patient_id, l] as const)),
    [query.data],
  );
  return { ...query, map };
}

/** Alertas sin resolver (las resueltas se ven en la ficha del paciente). */
export function useInstAlerts(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.alerts(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstAlert[]> => {
      const { data, error } = await sb
        .from("inst_alerts")
        .select(ALERT_COLUMNS)
        .eq("institution_id", inst)
        .neq("status", "resolved")
        .order("opened_at", { ascending: false })
        .limit(500);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstAlert[];
    },
  });
}

export function useInstDevices(inst: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.devices(inst ?? ""),
    enabled: !!inst,
    staleTime: STALE,
    queryFn: async (): Promise<InstDevice[]> => {
      const { data, error } = await sb
        .from("inst_devices")
        .select(DEVICE_COLUMNS)
        .eq("institution_id", inst)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstDevice[];
    },
  });
}

export interface AcceptedApplication {
  application_id: string;
  offer_id: string;
  offer_title: string;
  professional_id: string;
  professional_label: string | null;
  proposed_amount: number | null;
  accepted_at: string;
}

/** Postulaciones que la institución aceptó y que aún no tienen caso: «acepta una postulación para iniciar coordinación». */
export function useAcceptedApplications(inst: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: careKeys.applications(inst ?? ""),
    enabled: !!inst && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<AcceptedApplication[]> => {
      const rows = await rpc<AcceptedApplication[] | null>("inst_accepted_applications");
      return rows ?? [];
    },
  });
}

export interface CareFlags {
  /** Alguien escribió alguna vez una nota (no cuentan las que deja el sistema). */
  hasNote: boolean;
  hasControl: boolean;
  hasDevice: boolean;
  hasTeam: boolean;
}

/**
 * Verdades de «alguna vez» (no de los últimos 7 días): sirven para los primeros pasos y los hitos. Son conteos sin traer filas.
 * `hasTeam` solo lo puede saber la institución dueña (su lista de personal es privada).
 */
export function useCareFlags(inst: string | null | undefined, isOwner: boolean) {
  return useQuery({
    queryKey: careKeys.flags(inst ?? ""),
    enabled: !!inst,
    staleTime: 30_000,
    queryFn: async (): Promise<CareFlags> => {
      const any = async (
        table: string,
        build: (q: ReturnType<typeof head>) => ReturnType<typeof head>,
      ) => {
        const { count, error } = await build(head(table)).limit(1);
        if (error) throw new CareError(error);
        return (count ?? 0) > 0;
      };
      const head = (table: string) =>
        sb.from(table).select("id", { count: "exact", head: true }).eq("institution_id", inst);
      const [hasNote, hasControl, hasDevice, hasTeam] = await Promise.all([
        any("inst_notes", (q) => q.in("kind", ["evolution", "nursing", "family", "incident"])),
        any("inst_obs", (q) => q),
        any("inst_devices", (q) => q),
        isOwner ? any("institution_members", (q) => q) : Promise.resolve(false),
      ]);
      return { hasNote, hasControl, hasDevice, hasTeam };
    },
  });
}

export interface PatientDetail {
  notes: InstNote[];
  obs: InstObs[];
  events: InstEvent[];
  tasks: InstTask[];
  cases: InstCase[];
  alerts: InstAlert[];
}

/**
 * Todo lo de UN paciente: notas, controles (a mano de las últimas 72 h; de dispositivo, de las últimas 12 h), bitácora, tareas, casos y
 * alertas. Solo mientras su ficha está abierta.
 */
export function usePatientDetail(
  inst: string | null | undefined,
  patientId: string | null | undefined,
) {
  return useQuery({
    queryKey: careKeys.detail(inst ?? "", patientId ?? ""),
    enabled: !!inst && !!patientId,
    staleTime: 10_000,
    queryFn: async (): Promise<PatientDetail> => {
      const since = new Date(Date.now() - 72 * 3_600_000).toISOString();
      const sinceDevice = new Date(Date.now() - 12 * 3_600_000).toISOString();
      const [notes, manual, device, events, tasks, cases, alerts] = await Promise.all([
        sb
          .from("inst_notes")
          .select(NOTE_COLUMNS)
          .eq("patient_id", patientId)
          .order("seq", { ascending: false })
          .limit(300),
        sb
          .from("inst_obs")
          .select(OBS_COLUMNS)
          .eq("patient_id", patientId)
          .neq("source", "device")
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: false })
          .limit(200),
        // Un dispositivo manda hasta una lectura por minuto: se pide solo lo reciente, para que la lista no se coma a los controles a mano.
        sb
          .from("inst_obs")
          .select(OBS_COLUMNS)
          .eq("patient_id", patientId)
          .eq("source", "device")
          .gte("recorded_at", sinceDevice)
          .order("recorded_at", { ascending: false })
          .limit(400),
        sb
          .from("inst_events")
          .select(EVENT_COLUMNS)
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(150),
        sb
          .from("inst_tasks")
          .select(TASK_COLUMNS)
          .eq("patient_id", patientId)
          .order("due_at", { ascending: false })
          .limit(200),
        sb
          .from("inst_cases")
          .select(CASE_COLUMNS)
          .eq("patient_id", patientId)
          .order("opened_at", { ascending: false })
          .limit(100),
        sb
          .from("inst_alerts")
          .select(ALERT_COLUMNS)
          .eq("patient_id", patientId)
          .order("opened_at", { ascending: false })
          .limit(100),
      ]);
      for (const r of [notes, manual, device, events, tasks, cases, alerts]) {
        if (r.error) throw new CareError(r.error);
      }
      const obs = [
        ...((manual.data ?? []) as unknown as InstObs[]),
        ...((device.data ?? []) as unknown as InstObs[]),
      ].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
      return {
        notes: (notes.data ?? []) as unknown as InstNote[],
        obs,
        events: (events.data ?? []) as unknown as InstEvent[],
        tasks: (tasks.data ?? []) as unknown as InstTask[],
        cases: (cases.data ?? []) as unknown as InstCase[],
        alerts: (alerts.data ?? []) as unknown as InstAlert[],
      };
    },
  });
}

/**
 * Los controles de las últimas 13 horas de un paciente. Al registrar uno nuevo, el NEWS2 se completa con lo último conocido de las 12
 * horas anteriores (igual que lo hace el servidor); esto trae justo ese historial.
 */
export function useRecentObs(
  inst: string | null | undefined,
  patientId: string | null | undefined,
) {
  return useQuery({
    queryKey: [...careKeys.detail(inst ?? "", patientId ?? ""), "recent"],
    enabled: !!inst && !!patientId,
    staleTime: 10_000,
    queryFn: async (): Promise<InstObs[]> => {
      const since = new Date(Date.now() - 13 * 3_600_000).toISOString();
      const { data, error } = await sb
        .from("inst_obs")
        .select(OBS_COLUMNS)
        .eq("patient_id", patientId)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false })
        .limit(200);
      if (error) throw new CareError(error);
      return (data ?? []) as unknown as InstObs[];
    },
  });
}

// ── Tiempo real ──────────────────────────────────────────────────────────────────────────────────────────────────────

const suffix = () => Math.random().toString(36).slice(2, 8);

type ListKey =
  "overview" | "patients" | "cases" | "tasks" | "live" | "alerts" | "devices" | "applications";

/** Qué consultas se vuelven a pedir cuando cambia cada tabla. */
const TABLE_KEYS: Record<string, ListKey[]> = {
  inst_patients: ["patients", "overview", "live"],
  inst_cases: ["cases", "overview", "applications"],
  inst_tasks: ["tasks", "overview"],
  inst_alerts: ["alerts", "overview"],
  inst_live: ["live", "overview"],
};

/**
 * Una suscripción por pantalla: cada tabla invalida solo lo suyo, agrupado en una sola actualización cada 400 ms (un dispositivo
 * que habla cada minuto, multiplicado por cientos, no debe repintar la pantalla a cada paso). Si se abre la ficha de un paciente,
 * también se actualiza su detalle (los controles y las notas no van por Realtime: llega el aviso de su evento y de su estado en vivo).
 */
export function useCareRealtime(inst: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!inst || !enabled) return;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const keys = [...pending];
      pending.clear();
      for (const k of keys) void qc.invalidateQueries({ queryKey: JSON.parse(k) as unknown[] });
    };
    const mark = (...keys: ReadonlyArray<readonly unknown[]>) => {
      for (const k of keys) pending.add(JSON.stringify(k));
      if (!timer) timer = setTimeout(flush, 400);
    };

    let channel = sb.channel(`inst_care_${inst}_${suffix()}`);
    for (const table of Object.keys(TABLE_KEYS)) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `institution_id=eq.${inst}` },
        () => {
          mark(
            ...(TABLE_KEYS[table] ?? []).map((k) => careKeys[k](inst)),
            // El detalle abierto de cualquier paciente (casos, tareas, alertas, estado) también cambió.
            ["inst-care", inst, "detail"],
          );
        },
      );
    }
    channel = channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "inst_events",
        filter: `institution_id=eq.${inst}`,
      },
      // Cada acción deja un evento: también cubre lo que no va por Realtime (notas, dispositivos).
      () =>
        mark(
          ["inst-care", inst, "detail"],
          careKeys.overview(inst),
          careKeys.devices(inst),
          careKeys.flags(inst),
        ),
    );
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [inst, enabled, qc]);
}

// ── Escalamiento a la hora exacta ────────────────────────────────────────────────────────────────────────────────────

/**
 * Si hay una alerta urgente o crítica sin ver, programa un aviso a la hora en que vence su plazo para pedir el escalamiento. Con el
 * plan sin escalamiento no hace nada (la base tampoco escala). Nunca pide más de una vez por minuto.
 */
export function useEscalationTimer(
  inst: string | null | undefined,
  alerts: InstAlert[] | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const lastCall = useRef(0);
  useEffect(() => {
    if (!inst || !enabled || !alerts?.length) return;
    const ms = nextEscalationInMs(alerts, Date.now());
    if (ms === null) return;
    const wait = Math.max(ms + 1_500, Math.max(0, lastCall.current + 60_000 - Date.now()));
    const t = setTimeout(
      () => {
        lastCall.current = Date.now();
        void rpc<number>("inst_escalate_due")
          .then(() => {
            void qc.invalidateQueries({ queryKey: careKeys.alerts(inst) });
            void qc.invalidateQueries({ queryKey: careKeys.overview(inst) });
          })
          .catch(() => undefined);
      },
      Math.min(wait, 2_147_000_000),
    );
    return () => clearTimeout(t);
  }, [inst, enabled, alerts, qc]);
}

// ── Acciones ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function invalidateAll(qc: QueryClient, inst: string) {
  return qc.invalidateQueries({ queryKey: careKeys.root(inst) });
}

/** Una escritura: al terminar bien, todo lo de la institución se vuelve a pedir. Los errores llegan como `CareError`. */
function useAction<V, R>(inst: string | null | undefined, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation<R, CareError, V>({
    mutationFn: fn,
    onSuccess: () => {
      if (inst) void invalidateAll(qc, inst);
    },
  });
}

export interface DeviceCreated {
  device: InstDevice;
  /** El código completo: solo se ve aquí, una vez. */
  code: string;
}

/**
 * Todas las escrituras. Cada una vuelve a pedir lo que cambió; los errores llegan como `CareError` con el mensaje en español.
 * Los componentes usan `await actions.x(...)` dentro de try/catch (o `.mutateAsync`) y muestran `error.message`.
 */
export function useCareActions(inst: string | null | undefined) {
  const createPatient = useAction(
    inst,
    (v: {
      data: PatientPayload;
      consent: boolean;
      monitor?: boolean;
      firstCase?: CasePayload | null;
    }) =>
      rpc<{ patient: InstPatient; case: InstCase | null }>("inst_patient_create", {
        p_data: v.data,
        p_consent: v.consent,
        p_monitor: v.monitor ?? false,
        p_case: v.firstCase ?? null,
      }),
  );
  const updatePatient = useAction(inst, (v: { id: string; data: Partial<PatientPayload> }) =>
    rpc<InstPatient>("inst_patient_update", { p_id: v.id, p_data: v.data }),
  );
  const setPatientStatus = useAction(
    inst,
    (v: { id: string; status: "pending" | "active" | "paused" }) =>
      rpc<InstPatient>("inst_patient_set_status", { p_id: v.id, p_status: v.status }),
  );
  const dischargePatient = useAction(inst, (v: { id: string; outcome: string; note?: string }) =>
    rpc<InstPatient>("inst_patient_discharge", {
      p_id: v.id,
      p_outcome: v.outcome,
      p_note: v.note?.trim() || null,
    }),
  );
  const setScale = useAction(inst, (v: { id: string; scale: 1 | 2; reason?: string }) =>
    rpc<InstPatient>("inst_patient_set_scale", {
      p_id: v.id,
      p_scale: v.scale,
      p_reason: v.reason?.trim() || null,
    }),
  );
  const openCase = useAction(inst, (v: { patientId: string; data: CasePayload }) =>
    rpc<InstCase>("inst_case_open", { p_patient: v.patientId, p_data: v.data }),
  );
  const updateCase = useAction(inst, (v: { id: string; data: CasePayload }) =>
    rpc<InstCase>("inst_case_update", { p_id: v.id, p_data: v.data }),
  );
  const closeCase = useAction(
    inst,
    (v: {
      id: string;
      status: "completed" | "cancelled";
      outcome?: string;
      satisfaction?: number | null;
      by?: string;
      note?: string;
    }) =>
      rpc<InstCase>("inst_case_close", {
        p_id: v.id,
        p_status: v.status,
        p_outcome: v.outcome ?? null,
        p_satisfaction: v.satisfaction ?? null,
        p_by: v.by ?? null,
        p_note: v.note?.trim() || null,
      }),
  );
  const rateCase = useAction(
    inst,
    (v: { id: string; satisfaction: number; by?: string; note?: string }) =>
      rpc<InstCase>("inst_case_rate", {
        p_id: v.id,
        p_satisfaction: v.satisfaction,
        p_by: v.by ?? "coordinator",
        p_note: v.note?.trim() || null,
      }),
  );
  const addNote = useAction(
    inst,
    (v: {
      patientId: string;
      kind: string;
      body: string;
      caseId?: string | null;
      vitals?: Record<string, number> | null;
      corrects?: string | null;
    }) =>
      rpc<InstNote>("inst_note_add", {
        p_patient: v.patientId,
        p_kind: v.kind,
        p_body: v.body,
        p_case: v.caseId ?? null,
        p_vitals: v.vitals ?? null,
        p_corrects: v.corrects ?? null,
      }),
  );
  const addTask = useAction(
    inst,
    (v: {
      patientId: string;
      title: string;
      kind?: string;
      dueAt?: string | null;
      caseId?: string | null;
    }) =>
      rpc<InstTask>("inst_task_add", {
        p_patient: v.patientId,
        p_title: v.title,
        p_kind: v.kind ?? "other",
        p_due_at: v.dueAt ?? null,
        p_case: v.caseId ?? null,
      }),
  );
  const finishTask = useAction(inst, (v: { id: string; status?: "done" | "skipped" }) =>
    rpc<InstTask>("inst_task_done", { p_id: v.id, p_status: v.status ?? "done" }),
  );
  const setMonitoring = useAction(
    inst,
    (v: { patientId: string; on: boolean; modality?: string }) =>
      rpc<InstPatient>("inst_monitoring_set", {
        p_patient: v.patientId,
        p_on: v.on,
        p_modality: v.modality ?? null,
      }),
  );
  const recordVitals = useAction(inst, (v: { patientId: string; data: Record<string, unknown> }) =>
    rpc<{ obs: InstObs; alert: InstAlert | null }>("inst_vitals_record", {
      p_patient: v.patientId,
      p_data: v.data,
    }),
  );
  const ackAlert = useAction(inst, (v: { id: string; note?: string }) =>
    rpc<InstAlert>("inst_alert_ack", { p_id: v.id, p_note: v.note?.trim() || null }),
  );
  const resolveAlert = useAction(inst, (v: { id: string; resolution: string; note?: string }) =>
    rpc<InstAlert>("inst_alert_resolve", {
      p_id: v.id,
      p_resolution: v.resolution,
      p_note: v.note?.trim() || null,
    }),
  );
  const createDevice = useAction(inst, (v: { patientId: string; label: string; kind?: string }) =>
    rpc<DeviceCreated>("inst_device_create", {
      p_patient: v.patientId,
      p_label: v.label,
      p_kind: v.kind ?? "smartwatch",
    }),
  );
  const revokeDevice = useAction(inst, (v: { id: string }) =>
    rpc<InstDevice>("inst_device_revoke", { p_id: v.id }),
  );
  const commitHandoff = useAction(inst, (v: { items: Array<Record<string, string>> }) =>
    rpc<{ ok: boolean; saved: number }>("inst_handoff_commit", { p_items: v.items }),
  );
  const logExport = useAction(inst, (v: { patientId: string; format: "fhir" | "csv" | "print" }) =>
    rpc<null>("inst_export_log", { p_patient: v.patientId, p_format: v.format }),
  );

  return {
    createPatient,
    updatePatient,
    setPatientStatus,
    dischargePatient,
    setScale,
    openCase,
    updateCase,
    closeCase,
    rateCase,
    addNote,
    addTask,
    finishTask,
    setMonitoring,
    recordVitals,
    ackAlert,
    resolveAlert,
    createDevice,
    revokeDevice,
    commitHandoff,
    logExport,
  };
}

export type CareActions = ReturnType<typeof useCareActions>;

/** ¿La cadena de notas de un paciente está íntegra? (la base vuelve a calcular cada firma). */
export async function verifyNotes(patientId: string) {
  return rpc<{ ok: boolean; checked: number; first_bad_seq: number | null }>("inst_verify_notes", {
    p_patient: patientId,
  });
}

export interface PatientExportData {
  notes: InstNote[];
  obs: InstObs[];
  cases: InstCase[];
}

/**
 * Todo lo que lleva la historia exportada de un paciente: todas las notas (en orden), los 500 controles más recientes y todos los casos.
 * Se pide al exportar (no se reutiliza la ficha, que solo trae lo reciente).
 */
export async function fetchPatientExport(patientId: string): Promise<PatientExportData> {
  const [notes, obs, cases] = await Promise.all([
    sb
      .from("inst_notes")
      .select(NOTE_COLUMNS)
      .eq("patient_id", patientId)
      .order("seq", { ascending: true })
      .limit(5000),
    sb
      .from("inst_obs")
      .select(OBS_COLUMNS)
      .eq("patient_id", patientId)
      .order("recorded_at", { ascending: false })
      .limit(500),
    sb
      .from("inst_cases")
      .select(CASE_COLUMNS)
      .eq("patient_id", patientId)
      .order("opened_at", { ascending: true })
      .limit(500),
  ]);
  for (const r of [notes, obs, cases]) if (r.error) throw new CareError(r.error);
  return {
    notes: (notes.data ?? []) as unknown as InstNote[],
    obs: (obs.data ?? []) as unknown as InstObs[],
    cases: (cases.data ?? []) as unknown as InstCase[],
  };
}
