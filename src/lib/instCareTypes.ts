// Tipos de las tablas de pacientes y monitoreo de la institución (migración 20261014100000_institution_care_core.sql).
// Las tablas aún no están en los tipos generados de Supabase (se regeneran con la base): se declaran aquí tal como las devuelve PostgREST.
// Las listas `*_COLUMNS` son las columnas que pide la pantalla (nunca «*»: la huella del código de un dispositivo no se puede leer).

import type { News2Band } from "./news2";

export type Tone = "ok" | "trust" | "warn" | "sos" | "copper" | "biosensor" | "fuchsia" | "muted";

export type PatientStatus = "pending" | "active" | "paused" | "discharged";
export type PatientModality = "hospital" | "remote" | "postop" | "chronic" | "elder";
export type CaseStatus = "pending" | "active" | "completed" | "cancelled";
export type CasePriority = "low" | "medium" | "high" | "urgent";
export type CareType =
  | "domiciliary"
  | "nursing"
  | "postop"
  | "elder"
  | "palliative"
  | "chronic"
  | "rehab"
  | "other";
export type CaseOutcome = "recovered" | "stable" | "referred" | "withdrawn" | "deceased" | "other";
export type SatisfactionBy = "patient" | "family" | "coordinator";
export type NoteKind =
  | "evolution"
  | "nursing"
  | "coordination"
  | "family"
  | "incident"
  | "handoff"
  | "correction";
export type TaskKind =
  | "call"
  | "visit"
  | "medication"
  | "lab"
  | "education"
  | "followup"
  | "obs_round"
  | "other";
export type TaskStatus = "open" | "done" | "skipped";
export type AlertSeverity = "warn" | "urgent" | "critical";
export type AlertReason = "news2_single" | "news2_medium" | "news2_high" | "deterioration" | "fall";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type AlertResolution = "treated" | "false_alarm" | "transferred" | "auto" | "other";
export type ObsSource = "manual" | "device" | "app";
export type DeviceKind = "smartwatch" | "smartphone" | "sensor" | "monitor";
export type Avpu = "A" | "C" | "V" | "P" | "U";

export interface InstPatient {
  id: string;
  institution_id: string;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  birth_date: string | null;
  sex: "F" | "M" | "O" | null;
  eps_name: string | null;
  city: string | null;
  address: string | null;
  modality: PatientModality;
  room: string | null;
  conditions: string[];
  allergies: string[];
  emergency_name: string | null;
  emergency_phone: string | null;
  status: PatientStatus;
  spo2_scale: 1 | 2;
  monitoring: boolean;
  monitoring_since: string | null;
  family_updates_ok: boolean;
  consent_confirmed_at: string;
  consent_confirmed_by: string;
  external_ref: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  discharged_at: string | null;
}

export interface InstCase {
  id: string;
  institution_id: string;
  patient_id: string;
  title: string;
  care_type: CareType;
  priority: CasePriority;
  status: CaseStatus;
  opened_at: string;
  target_end_at: string | null;
  closed_at: string | null;
  outcome: CaseOutcome | null;
  satisfaction: number | null;
  satisfaction_by: SatisfactionBy | null;
  satisfaction_note: string | null;
  application_id: string | null;
  professional_id: string | null;
  professional_label: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InstNote {
  id: string;
  institution_id: string;
  patient_id: string;
  case_id: string | null;
  seq: number;
  kind: NoteKind;
  body: string;
  vitals: Record<string, number> | null;
  corrects_note_id: string | null;
  author_id: string;
  author_name: string;
  author_role: "owner" | "member";
  prev_hash: string;
  hash: string;
  created_at: string;
}

export interface InstTask {
  id: string;
  institution_id: string;
  patient_id: string;
  case_id: string | null;
  title: string;
  kind: TaskKind;
  due_at: string;
  status: TaskStatus;
  source: "manual" | "auto_followup";
  completed_at: string | null;
  completed_by: string | null;
  completed_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InstObs {
  id: string;
  institution_id: string;
  patient_id: string;
  recorded_at: string;
  source: ObsSource;
  hr: number | null;
  rr: number | null;
  spo2: number | null;
  on_o2: boolean | null;
  sbp: number | null;
  dbp: number | null;
  temp_c: number | null;
  avpu: Avpu | null;
  pain: number | null;
  fall: boolean;
  note: string | null;
  news2: number | null;
  news2_max_single: number | null;
  news2_measured: number | null;
  news2_input: Record<string, unknown> | null;
  band: News2Band | null;
  applicable: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  device_id: string | null;
  created_at: string;
}

export interface InstAlert {
  id: string;
  institution_id: string;
  patient_id: string;
  obs_id: string | null;
  severity: AlertSeverity;
  reason: AlertReason;
  news2: number | null;
  message: string;
  status: AlertStatus;
  occurrences: number;
  opened_at: string;
  last_seen_at: string;
  due_ack_at: string;
  acked_at: string | null;
  acked_by: string | null;
  acked_by_name: string | null;
  ack_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolution: AlertResolution | null;
  resolve_note: string | null;
  escalated_at: string | null;
  escalation_level: number;
  created_at: string;
}

export interface InstDevice {
  id: string;
  institution_id: string;
  patient_id: string;
  label: string;
  kind: DeviceKind;
  code_hint: string;
  status: "active" | "revoked";
  last_ingest_at: string | null;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
}

export interface InstLive {
  patient_id: string;
  institution_id: string;
  last_obs_at: string | null;
  last_obs_source: ObsSource | null;
  last_news2: number | null;
  last_band: News2Band | null;
  last_vitals: Record<string, number | string | boolean> | null;
  next_obs_due_at: string | null;
  last_device_at: string | null;
  updated_at: string;
}

export interface InstEvent {
  id: string;
  institution_id: string;
  patient_id: string | null;
  case_id: string | null;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

const cols = (...c: string[]) => c.join(",");

export const PATIENT_COLUMNS = cols(
  "id",
  "institution_id",
  "full_name",
  "document_type",
  "document_number",
  "birth_date",
  "sex",
  "eps_name",
  "city",
  "address",
  "modality",
  "room",
  "conditions",
  "allergies",
  "emergency_name",
  "emergency_phone",
  "status",
  "spo2_scale",
  "monitoring",
  "monitoring_since",
  "family_updates_ok",
  "consent_confirmed_at",
  "consent_confirmed_by",
  "external_ref",
  "created_by",
  "created_at",
  "updated_at",
  "discharged_at",
);

export const CASE_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "title",
  "care_type",
  "priority",
  "status",
  "opened_at",
  "target_end_at",
  "closed_at",
  "outcome",
  "satisfaction",
  "satisfaction_by",
  "satisfaction_note",
  "application_id",
  "professional_id",
  "professional_label",
  "summary",
  "created_by",
  "created_at",
  "updated_at",
);

export const NOTE_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "case_id",
  "seq",
  "kind",
  "body",
  "vitals",
  "corrects_note_id",
  "author_id",
  "author_name",
  "author_role",
  "prev_hash",
  "hash",
  "created_at",
);

export const TASK_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "case_id",
  "title",
  "kind",
  "due_at",
  "status",
  "source",
  "completed_at",
  "completed_by",
  "completed_name",
  "created_by",
  "created_at",
  "updated_at",
);

export const OBS_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "recorded_at",
  "source",
  "hr",
  "rr",
  "spo2",
  "on_o2",
  "sbp",
  "dbp",
  "temp_c",
  "avpu",
  "pain",
  "fall",
  "note",
  "news2",
  "news2_max_single",
  "news2_measured",
  "news2_input",
  "band",
  "applicable",
  "recorded_by",
  "recorded_by_name",
  "device_id",
  "created_at",
);

export const ALERT_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "obs_id",
  "severity",
  "reason",
  "news2",
  "message",
  "status",
  "occurrences",
  "opened_at",
  "last_seen_at",
  "due_ack_at",
  "acked_at",
  "acked_by",
  "acked_by_name",
  "ack_note",
  "resolved_at",
  "resolved_by",
  "resolved_by_name",
  "resolution",
  "resolve_note",
  "escalated_at",
  "escalation_level",
  "created_at",
);

/** Sin `code_hash`: esa columna no se puede leer por la API (y un «*» fallaría). */
export const DEVICE_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "label",
  "kind",
  "code_hint",
  "status",
  "last_ingest_at",
  "created_by",
  "created_at",
  "revoked_at",
);

export const LIVE_COLUMNS = cols(
  "patient_id",
  "institution_id",
  "last_obs_at",
  "last_obs_source",
  "last_news2",
  "last_band",
  "last_vitals",
  "next_obs_due_at",
  "last_device_at",
  "updated_at",
);

export const EVENT_COLUMNS = cols(
  "id",
  "institution_id",
  "patient_id",
  "case_id",
  "kind",
  "actor_id",
  "actor_name",
  "data",
  "created_at",
);
