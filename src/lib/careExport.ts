// Historia de cuidado exportable (plan de pago) — lógica pura.
//
// El servidor (`care_history_report`, migración 20261010100000_care_loop.sql) entrega las filas SOLO a quien tiene
// un plan de pago y solo de sus propios servicios; aquí se arma el CSV. Pensado para Excel en español de
// Colombia: separador «;», coma decimal, BOM UTF-8 (tildes y ñ) y celdas neutralizadas contra inyección de
// fórmulas (el nombre de una oferta lo escribe un tercero).

import { MOOD_META, durationLabel, isCareMood } from "./careLog";

const BOGOTA_OFFSET_MS = -5 * 3_600_000;

export interface HistoryRow {
  booking_id: string;
  scheduled_at: string;
  planned_hours: number | string | null;
  status: string;
  professional: string | null;
  specialty: string | null;
  offer_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  events: number;
  vitals: number;
  alerts: number;
  incidents: number;
  last_mood: string | null;
  kudos_sent: boolean;
}

export const STATUS_ES: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_route: "En camino",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** «2026-10-09 08:05» en hora de Colombia. */
export function bogotaDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + BOGOTA_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** Número con coma decimal («4,5»); sin decimales si es entero. */
export function decimalEs(n: number | string | null | undefined, digits = 2): string {
  if (n === null || n === undefined || n === "") return "";
  const v = toNum(n);
  const rounded = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(rounded).replace(".", ",");
}

/** Evita que Excel interprete una celda como fórmula (`=`, `+`, `-`, `@`, tabulación, retorno). */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export function csvCell(raw: string | number | null | undefined, delimiter = ";"): string {
  const text = neutralizeFormula(raw === null || raw === undefined ? "" : String(raw));
  const needsQuotes = text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(
  rows: T[],
  columns: Array<CsvColumn<T>>,
  opts: { delimiter?: string; bom?: boolean } = {},
): string {
  const delimiter = opts.delimiter ?? ";";
  const lines = [columns.map((c) => csvCell(c.header, delimiter)).join(delimiter)];
  for (const row of rows)
    lines.push(columns.map((c) => csvCell(c.value(row), delimiter)).join(delimiter));
  return `${opts.bom === false ? "" : "﻿"}${lines.join("\r\n")}\r\n`;
}

function realMinutes(r: HistoryRow): number | null {
  if (!r.started_at || !r.ended_at) return null;
  const m = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60_000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
}

export const HISTORY_COLUMNS: Array<CsvColumn<HistoryRow>> = [
  { header: "Fecha", value: (r) => bogotaDateTime(r.scheduled_at) },
  { header: "Estado", value: (r) => STATUS_ES[r.status] ?? r.status },
  { header: "Profesional", value: (r) => r.professional },
  { header: "Especialidad", value: (r) => r.specialty },
  { header: "Turno u oferta", value: (r) => r.offer_title },
  { header: "Horas planeadas", value: (r) => decimalEs(r.planned_hours) },
  { header: "Inicio real", value: (r) => bogotaDateTime(r.started_at) },
  { header: "Fin real", value: (r) => bogotaDateTime(r.ended_at) },
  { header: "Duración real", value: (r) => durationLabel(realMinutes(r)) ?? "" },
  { header: "Registros del parte", value: (r) => r.events },
  { header: "Con signos vitales", value: (r) => r.vitals },
  { header: "Alertas", value: (r) => r.alerts },
  { header: "Incidentes", value: (r) => r.incidents },
  {
    header: "Ánimo al final",
    value: (r) => (isCareMood(r.last_mood) ? MOOD_META[r.last_mood].label : ""),
  },
  { header: "Agradecido", value: (r) => (r.kudos_sent ? "Sí" : "No") },
];

export function historyToCsv(rows: HistoryRow[]): string {
  return toCsv(rows, HISTORY_COLUMNS);
}

export interface HistoryTotals {
  services: number;
  completed: number;
  cancelled: number;
  /** Horas planeadas de los servicios completados. */
  hours: number;
  withReport: number;
  alerts: number;
  incidents: number;
}

export function historyTotals(rows: HistoryRow[]): HistoryTotals {
  const completed = rows.filter((r) => r.status === "completed");
  return {
    services: rows.length,
    completed: completed.length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    hours: Math.round(completed.reduce((acc, r) => acc + toNum(r.planned_hours), 0) * 100) / 100,
    withReport: rows.filter((r) => r.events > 0).length,
    alerts: rows.reduce((acc, r) => acc + r.alerts, 0),
    incidents: rows.reduce((acc, r) => acc + r.incidents, 0),
  };
}

/** Normaliza las filas del RPC (números como texto, nulos). */
export function parseHistory(raw: unknown): HistoryRow[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter((r) => r && typeof r.booking_id === "string")
    .map((r) => ({
      booking_id: String(r.booking_id),
      scheduled_at: String(r.scheduled_at ?? ""),
      planned_hours: (r.planned_hours as number | string | null) ?? null,
      status: String(r.status ?? ""),
      professional: typeof r.professional === "string" ? r.professional : null,
      specialty: typeof r.specialty === "string" ? r.specialty : null,
      offer_title: typeof r.offer_title === "string" ? r.offer_title : null,
      started_at: typeof r.started_at === "string" ? r.started_at : null,
      ended_at: typeof r.ended_at === "string" ? r.ended_at : null,
      events: toNum(r.events),
      vitals: toNum(r.vitals),
      alerts: toNum(r.alerts),
      incidents: toNum(r.incidents),
      last_mood: typeof r.last_mood === "string" ? r.last_mood : null,
      kudos_sent: r.kudos_sent === true,
    }));
}

/** «historia-de-cuidado-2026-10-09.csv» (fecha de Colombia). */
export function historyFilename(now: Date | number | string = Date.now()): string {
  const day = new Date(new Date(now).getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
  return `historia-de-cuidado-${day}.csv`;
}

/** Rango «últimos N días» en fechas de Colombia (`YYYY-MM-DD`), incluyendo hoy. */
export function rangeLastDays(
  days: number,
  now: Date | number | string = Date.now(),
): { from: string; to: string } {
  const end = new Date(new Date(now).getTime() + BOGOTA_OFFSET_MS);
  const start = new Date(end.getTime() - Math.max(0, days - 1) * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** La fecha de inicio no puede ser posterior a la de fin ni el rango pasar de dos años. */
export function rangeError(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return "Elige las dos fechas.";
  if (from > to) return "La fecha de inicio debe ser anterior a la de fin.";
  const days =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
  return days > 731 ? "El rango puede ser de hasta 2 años." : null;
}
