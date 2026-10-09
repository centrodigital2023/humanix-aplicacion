import { describe, it, expect } from "vitest";
import {
  HISTORY_COLUMNS,
  bogotaDateTime,
  csvCell,
  decimalEs,
  historyFilename,
  historyToCsv,
  historyTotals,
  neutralizeFormula,
  parseHistory,
  rangeError,
  rangeLastDays,
  toCsv,
  type HistoryRow,
} from "./careExport";

const row = (o: Partial<HistoryRow> = {}): HistoryRow => ({
  booking_id: "b1",
  scheduled_at: "2026-10-09T13:00:00Z",
  planned_hours: 4,
  status: "completed",
  professional: "Laura P.",
  specialty: "Auxiliar de enfermería",
  offer_title: null,
  started_at: "2026-10-09T13:05:00Z",
  ended_at: "2026-10-09T17:20:00Z",
  events: 11,
  vitals: 2,
  alerts: 2,
  incidents: 1,
  last_mood: "happy",
  kudos_sent: true,
  ...o,
});

describe("formato", () => {
  it("fecha y hora de Colombia", () => {
    expect(bogotaDateTime("2026-10-09T13:05:00Z")).toBe("2026-10-09 08:05");
    expect(bogotaDateTime("2026-10-10T02:00:00Z")).toBe("2026-10-09 21:00");
    expect(bogotaDateTime(null)).toBe("");
    expect(bogotaDateTime("nada")).toBe("");
  });
  it("decimales con coma", () => {
    expect(decimalEs(4)).toBe("4");
    expect(decimalEs("4.50")).toBe("4,5");
    expect(decimalEs(1.5)).toBe("1,5");
    expect(decimalEs(2.256)).toBe("2,26");
    expect(decimalEs(null)).toBe("");
    expect(decimalEs("")).toBe("");
  });
  it("nombre del archivo con la fecha de Colombia", () => {
    expect(historyFilename("2026-10-10T03:00:00Z")).toBe("historia-de-cuidado-2026-10-09.csv");
  });
});

describe("seguridad del CSV", () => {
  it("neutraliza fórmulas", () => {
    expect(neutralizeFormula("=SUMA(A1)")).toBe("'=SUMA(A1)");
    expect(neutralizeFormula("+57 300")).toBe("'+57 300");
    expect(neutralizeFormula("-1")).toBe("'-1");
    expect(neutralizeFormula("@cmd")).toBe("'@cmd");
    expect(neutralizeFormula("\tcmd")).toBe("'\tcmd");
    expect(neutralizeFormula("Laura")).toBe("Laura");
  });
  it("comillas, separador y saltos de línea", () => {
    expect(csvCell('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("a,b")).toBe("a,b");
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
  it("una oferta con fórmula no sale como fórmula", () => {
    const csv = historyToCsv([row({ offer_title: '=HYPERLINK("http://x.co","clic")' })]);
    expect(csv).toContain(`;"'=HYPERLINK(""http://x.co"",""clic"")";`);
    expect(csv.split("\r\n")[1]).not.toMatch(/;=HYPERLINK/);
  });
});

describe("historia de cuidado en CSV", () => {
  it("encabezados y fila completa", () => {
    const csv = historyToCsv([row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, body, tail] = csv.split("\r\n");
    expect(head.replace("﻿", "")).toBe(
      "Fecha;Estado;Profesional;Especialidad;Turno u oferta;Horas planeadas;Inicio real;Fin real;Duración real;Registros del parte;Con signos vitales;Alertas;Incidentes;Ánimo al final;Agradecido",
    );
    expect(body).toBe(
      "2026-10-09 08:00;Completado;Laura P.;Auxiliar de enfermería;;4;2026-10-09 08:05;2026-10-09 12:20;4 h 15 min;11;2;2;1;Contento/a;Sí",
    );
    expect(tail).toBe("");
    expect(HISTORY_COLUMNS).toHaveLength(15);
  });
  it("servicio cancelado: sin horas reales ni ánimo", () => {
    const body = historyToCsv([
      row({
        status: "cancelled",
        started_at: null,
        ended_at: null,
        events: 0,
        vitals: 0,
        alerts: 0,
        incidents: 0,
        last_mood: null,
        kudos_sent: false,
      }),
    ]).split("\r\n")[1];
    expect(body).toBe(
      "2026-10-09 08:00;Cancelado;Laura P.;Auxiliar de enfermería;;4;;;;0;0;0;0;;No",
    );
  });
  it("estado desconocido se muestra tal cual", () => {
    expect(historyToCsv([row({ status: "raro" })]).split("\r\n")[1]).toContain(";raro;");
  });
  it("sin BOM si se pide", () => {
    expect(toCsv([row()], HISTORY_COLUMNS, { bom: false }).startsWith("Fecha")).toBe(true);
    expect(
      toCsv([row()], [{ header: "a", value: () => "x,y" }], { delimiter: ",", bom: false }),
    ).toBe('a\r\n"x,y"\r\n');
  });
});

describe("totales", () => {
  it("agrega solo lo completado en horas", () => {
    const t = historyTotals([
      row(),
      row({ booking_id: "b2", planned_hours: "6.5", alerts: 0, incidents: 0, events: 0 }),
      row({
        booking_id: "b3",
        status: "cancelled",
        planned_hours: 8,
        events: 0,
        alerts: 0,
        incidents: 0,
      }),
    ]);
    expect(t).toEqual({
      services: 3,
      completed: 2,
      cancelled: 1,
      hours: 10.5,
      withReport: 1,
      alerts: 2,
      incidents: 1,
    });
  });
  it("vacío", () => {
    expect(historyTotals([])).toEqual({
      services: 0,
      completed: 0,
      cancelled: 0,
      hours: 0,
      withReport: 0,
      alerts: 0,
      incidents: 0,
    });
  });
});

describe("normalización de las filas del servidor", () => {
  it("convierte tipos y descarta filas sin id", () => {
    const rows = parseHistory([
      {
        booking_id: "b1",
        scheduled_at: "2026-10-09T13:00:00Z",
        planned_hours: "4.00",
        status: "completed",
        professional: "Laura P.",
        specialty: null,
        offer_title: null,
        started_at: null,
        ended_at: null,
        events: "11",
        vitals: 2,
        alerts: 2,
        incidents: 1,
        last_mood: "happy",
        kudos_sent: true,
      },
      { booking_id: 5 },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      events: 11,
      planned_hours: "4.00",
      kudos_sent: true,
      specialty: null,
    });
    expect(parseHistory({})).toEqual([]);
  });
});

describe("rango de fechas", () => {
  it("últimos N días con fechas de Colombia", () => {
    expect(rangeLastDays(1, "2026-10-09T15:00:00Z")).toEqual({
      from: "2026-10-09",
      to: "2026-10-09",
    });
    expect(rangeLastDays(30, "2026-10-09T15:00:00Z")).toEqual({
      from: "2026-09-10",
      to: "2026-10-09",
    });
    // 02:00 UTC del 10 todavía es el 9 en Bogotá.
    expect(rangeLastDays(2, "2026-10-10T02:00:00Z")).toEqual({
      from: "2026-10-08",
      to: "2026-10-09",
    });
  });
  it("validación del rango", () => {
    expect(rangeError("2026-09-01", "2026-10-09")).toBeNull();
    expect(rangeError("", "2026-10-09")).toBe("Elige las dos fechas.");
    expect(rangeError("2026-10-10", "2026-10-09")).toBe(
      "La fecha de inicio debe ser anterior a la de fin.",
    );
    expect(rangeError("2023-01-01", "2026-10-09")).toBe("El rango puede ser de hasta 2 años.");
  });
});
