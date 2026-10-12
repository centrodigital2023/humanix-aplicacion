import { describe, expect, it } from "vitest";
import {
  EPS_LEVELS,
  MIN_SERVICES_FOR_DURATION,
  WEEKLY_FROM_DAYS,
  buildEpsMetrics,
  clinicalReadStatus,
  isMissingTable,
  recentBookingIds,
  type EpsAlertRow,
  type EpsInput,
  type EpsRiskRow,
} from "./epsMetrics";
import type { InstBooking } from "./instData";
import { ahead, cancelled, dayAt, ib, late } from "./instIntel.fixture";
import { DAY, HOUR, NOW, bogota, iso, mulberry32 } from "./intel.fixture";
import { resolvePeriod } from "./intelShared";

const period = resolvePeriod("30d", NOW);

const alert = (daysAgo: number, severity: string, status = "active"): EpsAlertRow => ({
  booking_id: "x",
  patient_id: "pt",
  severity,
  status,
  created_at: iso(-daysAgo * DAY),
});
const risk = (
  patient: string,
  daysAgo: number,
  score: number | string | null,
  level: string,
): EpsRiskRow => ({
  patient_id: patient,
  score,
  level,
  calculated_at: iso(-daysAgo * DAY),
});

const run = (over: Partial<EpsInput> = {}) =>
  buildEpsMetrics({ bookings: [], alerts: null, risks: null, period, now: NOW, ...over });

describe("servicios del periodo", () => {
  it("cuenta terminados y cancelados del periodo y los que están en curso ahora", () => {
    const rows = [
      ib(1),
      ib(2),
      ib(3),
      cancelled(4, null),
      ib(5, { status: "in_progress", completed_at: null }),
      ahead(1),
    ];
    const m = run({ bookings: rows });
    expect(m.services).toEqual({ active: 1, completed: 3, cancelled: 1 });
    expect(m.hasData).toBe(true);
  });

  it("los terminados o cancelados fuera del periodo no cuentan; lo que está en curso sí, sea de cuando sea", () => {
    const rows = [
      ib(40),
      cancelled(45, null),
      ib(50, { status: "in_progress", completed_at: null }),
    ];
    expect(run({ bookings: rows }).services).toEqual({ active: 1, completed: 0, cancelled: 0 });
  });

  it("sin reservas no hay datos, pero todo queda en cero y sin NaN", () => {
    const m = run();
    expect(m.hasData).toBe(false);
    expect(m.services).toEqual({ active: 0, completed: 0, cancelled: 0 });
    expect(m.avgHours).toBeNull();
    expect(JSON.stringify(m)).not.toMatch(/NaN|undefined/);
  });
});

describe("duración promedio", () => {
  it(`se calcula con las horas registradas desde ${MIN_SERVICES_FOR_DURATION} servicios`, () => {
    const rows = [ib(1), late(ib(2), 30), ib(3)]; // 6 h, 5,5 h y 6 h → 5,83
    expect(run({ bookings: rows }).avgHours).toBe(5.8);
  });

  it("con menos servicios con horas no se inventa un promedio", () => {
    expect(run({ bookings: [ib(1), ib(2)] }).avgHours).toBeNull();
    // Dos con horas y uno sin registro de inicio: sigue sin muestra.
    const noStart = ib(3, { started_at: null, arrived_at: null });
    expect(run({ bookings: [ib(1), ib(2), noStart] }).avgHours).toBeNull();
  });

  it("un registro dañado (más de tres veces lo contratado) no cuenta", () => {
    const broken = ib(3, { completed_at: new Date(dayAt(3, 8) + 40 * HOUR).toISOString() });
    expect(run({ bookings: [ib(1), ib(2), broken] }).avgHours).toBeNull();
  });
});

describe("alertas ligadas a los servicios", () => {
  const rows = [
    alert(2, "critical"),
    alert(10, "high", "resolved"),
    alert(45, "medium"), // fuera del periodo, pero sigue sin atender
    alert(5, "low", "acknowledged"),
    alert(3, "weird"), // gravedad desconocida
  ];

  it("separa las del periodo, las que siguen sin atender y las críticas sin atender", () => {
    const a = run({ alerts: rows }).alerts;
    expect(a).toEqual({
      active: 3,
      activeCritical: 1,
      inPeriod: 4,
      bySeverity: { critical: 1, high: 1, medium: 0, low: 1 },
    });
  });

  it("una crítica ya resuelta no cuenta como crítica sin atender", () => {
    const a = run({ alerts: [alert(1, "critical", "resolved"), alert(1, "critical")] }).alerts;
    expect(a?.activeCritical).toBe(1);
    expect(a?.active).toBe(1);
    expect(a?.inPeriod).toBe(2);
  });

  it("si no se pudieron cargar queda en nulo (no en cero)", () => {
    expect(run({ alerts: null }).alerts).toBeNull();
    expect(run({ alerts: [] }).alerts).toEqual({
      active: 0,
      activeCritical: 0,
      inPeriod: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    });
  });

  it("el inicio del periodo cuenta y el final no", () => {
    const at = (ms: number): EpsAlertRow => ({
      ...alert(0, "low"),
      created_at: new Date(ms).toISOString(),
    });
    const a = run({
      alerts: [at(period.from), at(period.from - 1), at(period.to), at(period.to - 1)],
    }).alerts;
    expect(a?.inPeriod).toBe(2);
  });
});

describe("riesgo clínico", () => {
  const rows = [
    risk("p1", 10, 80, "critical"),
    risk("p1", 2, 40, "medium"), // el último de p1
    risk("p2", 4, 20, "low"),
    risk("p3", 6, "62.5", "high"),
    risk("p4", 1, 90, "extreme"), // nivel desconocido: no cuenta
    risk("p5", 3, null, "low"),
  ];

  it("usa el último puntaje de cada paciente", () => {
    const r = run({ risks: rows }).risk;
    expect(r?.patients).toBe(4);
    expect(r?.levels).toEqual({ critical: 0, high: 1, medium: 1, low: 2 });
    expect(r?.avg).toBe(31); // (40 + 20 + 62,5 + 0) / 4 = 30,6
  });

  it("no importa el orden en que lleguen las filas", () => {
    const shuffled = [...rows].reverse();
    expect(run({ risks: shuffled }).risk).toEqual(run({ risks: rows }).risk);
  });

  it("un nivel desconocido más reciente no desplaza al último puntaje válido", () => {
    const r = run({ risks: [risk("p1", 5, 30, "low"), risk("p1", 1, 99, "extreme")] }).risk;
    expect(r).toEqual({
      patients: 1,
      avg: 30,
      levels: { critical: 0, high: 0, medium: 0, low: 1 },
    });
  });

  it("sin filas no hay pacientes ni promedio; si no se cargó, queda en nulo", () => {
    expect(run({ risks: [] }).risk).toEqual({
      patients: 0,
      avg: null,
      levels: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(run({ risks: null }).risk).toBeNull();
  });
});

describe("barras por día o por semana", () => {
  const total = (m: ReturnType<typeof run>, key: "services" | "alerts") =>
    m.points.reduce((s, p) => s + p[key], 0);

  it("30 días: una barra por día, de «14 sep» a «14 oct»", () => {
    const m = run({ bookings: [ib(1), ib(2)], alerts: [alert(1, "low")] });
    expect(m.bucketDays).toBe(1);
    expect(m.points).toHaveLength(31);
    expect(m.points[0].label).toBe("14 sep");
    expect(m.points[30].label).toBe("14 oct");
    expect(m.points[30].dayMs).toBe(bogota("2026-10-14T00:00:00"));
  });

  it("90 días: una barra por semana", () => {
    const p90 = resolvePeriod("90d", NOW);
    const m = run({ period: p90, bookings: [ib(1), ib(60)], alerts: [alert(80, "low")] });
    expect(m.bucketDays).toBe(7);
    expect(m.points).toHaveLength(13); // 91 días / 7
    expect(m.points[0].label).toBe("16 jul");
    expect(m.points[1].label).toBe("23 jul");
    expect(total(m, "services")).toBe(2);
    expect(total(m, "alerts")).toBe(1);
  });

  it(`el límite entre diario y semanal es ${WEEKLY_FROM_DAYS} días`, () => {
    const make = (days: number) => ({
      key: "30d" as const,
      from: bogota("2026-10-14T00:00:00") - (days - 1) * DAY,
      to: bogota("2026-10-14T00:00:00") + DAY,
      label: "x",
    });
    expect(run({ period: make(WEEKLY_FROM_DAYS) }).bucketDays).toBe(1);
    expect(run({ period: make(WEEKLY_FROM_DAYS + 1) }).bucketDays).toBe(7);
    expect(run({ period: make(WEEKLY_FROM_DAYS) }).points).toHaveLength(WEEKLY_FROM_DAYS);
    expect(run({ period: make(WEEKLY_FROM_DAYS + 1) }).points).toHaveLength(6);
  });

  it("el mes pasado va de «1 sep» a «30 sep» sin barras de más", () => {
    const m = run({ period: resolvePeriod("last_month", NOW) });
    expect(m.points).toHaveLength(30);
    expect(m.points[0].label).toBe("1 sep");
    expect(m.points[29].label).toBe("30 sep");
  });

  it("un servicio pasadas las 19:00 de Colombia queda en su día, no en el siguiente (UTC)", () => {
    const night = ib(0, {
      scheduled_at: new Date(bogota("2026-10-13T23:30:00")).toISOString(),
      started_at: new Date(bogota("2026-10-13T23:30:00")).toISOString(),
      completed_at: new Date(bogota("2026-10-13T23:30:00") + 4 * HOUR).toISOString(),
    });
    const early = ib(0, {
      scheduled_at: new Date(bogota("2026-10-14T00:30:00")).toISOString(),
      started_at: new Date(bogota("2026-10-14T00:30:00")).toISOString(),
      completed_at: new Date(bogota("2026-10-14T05:30:00")).toISOString(),
    });
    const m = run({ bookings: [night, early] });
    const byLabel = Object.fromEntries(
      m.points.filter((p) => p.services).map((p) => [p.label, p.services]),
    );
    expect(byLabel).toEqual({ "13 oct": 1, "14 oct": 1 });
  });

  it("una alerta del último día del periodo queda en la última barra", () => {
    const m = run({
      alerts: [{ ...alert(0, "low"), created_at: new Date(NOW - 1).toISOString() }],
    });
    expect(m.points[m.points.length - 1].alerts).toBe(1);
  });

  it("las barras suman exactamente los servicios y las alertas del periodo (propiedad con datos al azar)", () => {
    const rand = mulberry32(2026);
    for (let run_ = 0; run_ < 60; run_++) {
      const bookings: InstBooking[] = Array.from({ length: Math.floor(rand() * 25) }, () =>
        ib(Math.floor(rand() * 120) - 5, {
          status: ["completed", "completed", "cancelled", "confirmed"][Math.floor(rand() * 4)],
        }),
      );
      const alerts = Array.from({ length: Math.floor(rand() * 25) }, () =>
        alert(
          Math.floor(rand() * 120) - 5,
          EPS_LEVELS[Math.floor(rand() * 4)],
          rand() < 0.5 ? "active" : "resolved",
        ),
      );
      for (const key of ["30d", "90d", "last_month"] as const) {
        const m = run({ bookings, alerts, period: resolvePeriod(key, NOW) });
        expect(total(m, "services")).toBe(m.services.completed);
        expect(total(m, "alerts")).toBe(m.alerts?.inPeriod);
        expect(m.alerts?.bySeverity.critical).toBeGreaterThanOrEqual(0);
        expect(JSON.stringify(m)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});

describe("servicios de los que se piden alertas y riesgo", () => {
  const row = (id: string, daysAgo: number) => ({
    id,
    scheduled_at: new Date(NOW - daysAgo * DAY).toISOString(),
  });

  it("los más recientes primero, incluidos los que vienen", () => {
    const out = recentBookingIds(
      [row("viejo", 20), row("hoy", 0), row("manana", -1), row("ayer", 1)],
      NOW,
      120,
      10,
    );
    expect(out).toEqual({ ids: ["manana", "hoy", "ayer", "viejo"], truncated: false });
  });

  it("deja fuera lo anterior a la ventana; el borde justo entra", () => {
    const out = recentBookingIds(
      [row("justo", 120), row("afuera", 121), row("dentro", 119)],
      NOW,
      120,
      10,
    );
    expect(out.ids).toEqual(["dentro", "justo"]);
  });

  it("con más del tope, se queda con los más recientes y lo avisa", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`s${i}`, i));
    expect(recentBookingIds(rows, NOW, 120, 3)).toEqual({
      ids: ["s0", "s1", "s2"],
      truncated: true,
    });
    expect(recentBookingIds(rows, NOW, 120, 5)).toEqual({
      ids: ["s0", "s1", "s2", "s3", "s4"],
      truncated: false,
    });
  });

  it("a igual fecha manda el id menor y una fecha dañada no entra", () => {
    const same = [row("b", 2), row("a", 2), { id: "rota", scheduled_at: "no es fecha" }];
    expect(recentBookingIds(same, NOW, 120, 10).ids).toEqual(["a", "b"]);
  });

  it("sin servicios no hay ids ni aviso", () => {
    expect(recentBookingIds([], NOW, 120, 3)).toEqual({ ids: [], truncated: false });
  });
});

describe("tabla ausente frente a fallo", () => {
  it("reconoce el código de PostgREST aunque no traiga mensaje", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
  });

  it("reconoce el código de PostgreSQL aunque no traiga mensaje", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
  });

  it("reconoce el mensaje de PostgREST aunque no traiga código (y sin importar mayúsculas)", () => {
    expect(
      isMissingTable(
        new Error("Could not find the table 'public.patient_risk_scores' in the schema cache"),
      ),
    ).toBe(true);
    expect(isMissingTable({ message: "COULD NOT FIND THE TABLE 'public.x'" })).toBe(true);
  });

  it("reconoce el mensaje de PostgreSQL aunque no traiga código", () => {
    expect(isMissingTable(new Error('relation "public.patient_risk_scores" does not exist'))).toBe(
      true,
    );
  });

  it("una columna que falta, un permiso negado o un corte de red son fallos, no tabla ausente", () => {
    expect(isMissingTable({ code: "42703", message: 'column "lat" does not exist' })).toBe(false);
    expect(
      isMissingTable({
        code: "PGRST204",
        message: "Could not find the 'lat' column of 'clinical_alerts' in the schema cache",
      }),
    ).toBe(false);
    expect(
      isMissingTable({ code: "42501", message: "permission denied for table clinical_alerts" }),
    ).toBe(false);
    expect(
      isMissingTable({ code: "PGRST202", message: "Could not find the function public.f" }),
    ).toBe(false);
    expect(isMissingTable(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("lo que no es un objeto de error nunca cuenta", () => {
    for (const v of [null, undefined, "PGRST205", 42, false]) expect(isMissingTable(v)).toBe(false);
  });
});

describe("estado de las lecturas clínicas", () => {
  const missing = { code: "PGRST205", message: "Could not find the table 'public.x'" };
  const network = new TypeError("Failed to fetch");

  it("sin errores todo está habilitado y nada falló", () => {
    expect(clinicalReadStatus(null, null)).toEqual({
      notEnabled: false,
      alertsFailed: false,
      risksFailed: false,
    });
  });

  it("producción hoy: existe la tabla de alertas pero no la de puntajes → no habilitado, sin «fallos»", () => {
    expect(clinicalReadStatus(null, missing)).toEqual({
      notEnabled: true,
      alertsFailed: false,
      risksFailed: false,
    });
  });

  it("si falta la tabla de alertas también es «no habilitado»", () => {
    expect(clinicalReadStatus(missing, null).notEnabled).toBe(true);
    expect(clinicalReadStatus(missing, missing).notEnabled).toBe(true);
  });

  it("un corte de red en una lectura la marca como fallida y deja la otra sana", () => {
    expect(clinicalReadStatus(network, null)).toEqual({
      notEnabled: false,
      alertsFailed: true,
      risksFailed: false,
    });
    expect(clinicalReadStatus(null, network)).toEqual({
      notEnabled: false,
      alertsFailed: false,
      risksFailed: true,
    });
    expect(clinicalReadStatus(network, network)).toEqual({
      notEnabled: false,
      alertsFailed: true,
      risksFailed: true,
    });
  });

  it("si falta una tabla, el fallo de la otra lectura no se reporta aparte", () => {
    expect(clinicalReadStatus(network, missing)).toEqual({
      notEnabled: true,
      alertsFailed: false,
      risksFailed: false,
    });
    expect(clinicalReadStatus(missing, network)).toEqual({
      notEnabled: true,
      alertsFailed: false,
      risksFailed: false,
    });
  });
});
