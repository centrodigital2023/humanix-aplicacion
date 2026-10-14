import { describe, expect, it } from "vitest";
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
} from "./instCareTypes";
import {
  EMPTY_OVERVIEW,
  FREE_LIMITS,
  MODALITY_ORDER,
  ageLabel,
  ageYears,
  attentionScore,
  avatarTone,
  buildTimeline,
  careErrorKind,
  careErrorMessage,
  careOnboarding,
  caseProgress,
  clockLabel,
  dateLabel,
  dayClockLabel,
  decimalEs,
  describeEvent,
  durationLabel,
  familyUpdateText,
  filterPatients,
  initials,
  normalizeCoPhone,
  normalizeText,
  notesToCsv,
  parseOverview,
  patientKpis,
  patientsToCsv,
  sortPatients,
  starsLabel,
  timeAgo,
  upsellFor,
  thousandsEs,
  usageMeters,
  whatsappLink,
  type CareOverview,
} from "./instCare";
import {
  NOW,
  T0,
  mkAlert,
  mkCase,
  mkDevice,
  mkEvent,
  mkLive,
  mkNote,
  mkObs,
  mkPatient,
  mkTask,
} from "./instCare.fixtures";

const sortedKeys = (o: object) => Object.keys(o).sort();
const sortedCols = (c: string) => c.split(",").sort();

describe("columnas que pide la pantalla = campos de los tipos", () => {
  it("coinciden en todas las tablas (un error de tipeo en una columna rompería la lectura)", () => {
    expect(sortedCols(PATIENT_COLUMNS)).toEqual(sortedKeys(mkPatient()));
    expect(sortedCols(CASE_COLUMNS)).toEqual(sortedKeys(mkCase()));
    expect(sortedCols(NOTE_COLUMNS)).toEqual(sortedKeys(mkNote()));
    expect(sortedCols(TASK_COLUMNS)).toEqual(sortedKeys(mkTask()));
    expect(sortedCols(OBS_COLUMNS)).toEqual(sortedKeys(mkObs()));
    expect(sortedCols(ALERT_COLUMNS)).toEqual(sortedKeys(mkAlert()));
    expect(sortedCols(DEVICE_COLUMNS)).toEqual(sortedKeys(mkDevice()));
    expect(sortedCols(LIVE_COLUMNS)).toEqual(sortedKeys(mkLive()));
    expect(sortedCols(EVENT_COLUMNS)).toEqual(sortedKeys(mkEvent()));
  });

  it("jamás se pide la huella del código del dispositivo", () => {
    expect(DEVICE_COLUMNS).not.toContain("code_hash");
    expect(DEVICE_COLUMNS).not.toContain("*");
  });
});

describe("hora de Colombia", () => {
  it("reloj de 12 horas con a. m. / p. m.", () => {
    expect(clockLabel("2026-10-14T15:30:00Z")).toBe("10:30 a. m.");
    expect(clockLabel("2026-10-14T17:05:00Z")).toBe("12:05 p. m.");
    expect(clockLabel("2026-10-14T05:00:00Z")).toBe("12:00 a. m.");
    expect(clockLabel("2026-10-14T23:59:00Z")).toBe("6:59 p. m.");
    expect(clockLabel(null)).toBe("");
    expect(clockLabel("no es fecha")).toBe("");
  });

  it("hoy, ayer, mañana o la fecha corta (con el día de Colombia, no el de UTC)", () => {
    const now = Date.parse("2026-10-14T16:00:00Z");
    expect(dayClockLabel("2026-10-14T15:30:00Z", now)).toBe("hoy 10:30 a. m.");
    expect(dayClockLabel("2026-10-13T21:00:00Z", now)).toBe("ayer 4:00 p. m.");
    expect(dayClockLabel("2026-10-15T15:00:00Z", now)).toBe("mañana 10:00 a. m.");
    expect(dayClockLabel("2026-10-01T15:00:00Z", now)).toBe("1 oct 10:00 a. m.");
    // 02:00 UTC del 15 es todavía el 14 en Colombia (9:00 p. m.)
    expect(dayClockLabel("2026-10-15T02:00:00Z", now)).toBe("hoy 9:00 p. m.");
  });

  it("fecha corta", () => {
    expect(dateLabel("2026-10-14T15:30:00Z")).toBe("14 oct 2026");
    expect(dateLabel(null)).toBe("");
  });

  it("hace cuánto", () => {
    const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
    expect(timeAgo(iso(10_000), NOW)).toBe("justo ahora");
    expect(timeAgo(iso(5 * 60_000), NOW)).toBe("hace 5 min");
    expect(timeAgo(iso(2 * 3_600_000), NOW)).toBe("hace 2 h");
    expect(timeAgo(iso(3 * 86_400_000), NOW)).toBe("hace 3 d");
    expect(timeAgo(iso(-20 * 60_000), NOW)).toBe("en 20 min");
    expect(timeAgo(undefined, NOW)).toBe("");
  });

  it("duración", () => {
    expect(durationLabel(7 * 60_000)).toBe("7 min");
    expect(durationLabel(80 * 60_000)).toBe("1 h 20 min");
    expect(durationLabel(120 * 60_000)).toBe("2 h");
    expect(durationLabel(-5)).toBe("0 min");
  });
});

describe("textos", () => {
  it("normaliza sin tildes ni mayúsculas", () => {
    expect(normalizeText("  ÁNGELA Muñoz ")).toBe("angela munoz");
    expect(normalizeText(null)).toBe("");
  });

  it("iniciales", () => {
    expect(initials("Ana Lucía Pérez")).toBe("AP");
    expect(initials("  maría ")).toBe("M");
    expect(initials("")).toBe("?");
  });

  it("color estable por paciente", () => {
    const a = avatarTone("0000-1");
    expect(avatarTone("0000-1")).toBe(a);
    expect(["trust", "ok", "copper", "biosensor", "fuchsia"]).toContain(a);
  });

  it("edad: cumplida, con el día de Colombia", () => {
    const now = Date.parse("2026-10-14T16:00:00Z");
    expect(ageYears("1950-03-01", now)).toBe(76);
    expect(ageYears("1950-12-01", now)).toBe(75);
    expect(ageYears("1950-10-14", now)).toBe(76);
    expect(ageYears("2999-01-01", now)).toBeNull();
    expect(ageYears("no", now)).toBeNull();
    expect(ageYears(null, now)).toBeNull();
    // 03:00 UTC del 1 de marzo = 10:00 p. m. del 28 de febrero en Colombia: todavía no cumple
    const midnight = Date.parse("2026-03-01T03:00:00Z");
    expect(ageYears("2000-03-01", midnight)).toBe(25);
    expect(ageYears("2000-03-01", Date.parse("2026-03-01T06:00:00Z"))).toBe(26);
  });

  it("etiqueta de edad", () => {
    const now = Date.parse("2026-10-14T16:00:00Z");
    expect(ageLabel("1950-03-01", now)).toBe("76 años");
    expect(ageLabel("2025-09-01", now)).toBe("1 año");
    expect(ageLabel("2026-02-10", now)).toBe("8 meses");
    expect(ageLabel("2026-09-20", now)).toBe("1 mes");
    expect(ageLabel(null, now)).toBe("");
  });

  it("coma decimal", () => {
    expect(decimalEs(4.5)).toBe("4,5");
    expect(decimalEs(4)).toBe("4,0");
    expect(decimalEs(36.84, 1)).toBe("36,8");
    expect(decimalEs(97, 0)).toBe("97");
    expect(starsLabel(4.25)).toBe("4,3");
    expect(starsLabel(null)).toBe("—");
  });
});

const RAW_OVERVIEW = {
  plan: "institution_monthly",
  limits: {
    patients: 1000,
    monitored: 300,
    devices: 300,
    escalation: true,
    followups: true,
    handoff: true,
    export: true,
  },
  usage: { patients: 5, monitored: 3, devices: 1 },
  patients: { total: 6, open: 5, pending: 1, active: 3, paused: 1, discharged: 1, monitored: 3 },
  cases: { active: 1, pending: 1, completed: 3, cancelled: 1, rated: 2, avg_satisfaction: 4.5 },
  tasks: { open: 7, overdue: 2 },
  monitoring: { total: 3, online: 1, overdue: 1, high_risk: 1 },
  alerts: { open: 1, unacked: 1, critical: 0, overdue: 0, false_alarm_30d: 2 },
  impact: {
    since: "2026-10-07T16:00:00Z",
    manual_controls: 12,
    device_readings: 480,
    alerts: 6,
    alerts_on_time: 4,
    median_ack_seconds: 360,
    tasks_done: 9,
    notes: 30,
    cases_completed: 3,
  },
  ontime_streak: 3,
  generated_at: "2026-10-14T16:00:00Z",
};

describe("parseOverview", () => {
  it("interpreta lo que devuelve el servidor", () => {
    const o = parseOverview(RAW_OVERVIEW);
    expect(o).not.toBeNull();
    expect(o?.plan).toBe("institution_monthly");
    expect(o?.limits.devices).toBe(300);
    expect(o?.limits.escalation).toBe(true);
    expect(o?.cases.avgSatisfaction).toBe(4.5);
    expect(o?.monitoring.highRisk).toBe(1);
    expect(o?.alerts.falseAlarm30d).toBe(2);
    expect(o?.impact.medianAckSeconds).toBe(360);
    expect(o?.ontimeStreak).toBe(3);
  });

  it("lo que falta vale cero y el plan por defecto es Free", () => {
    const o = parseOverview({});
    expect(o?.plan).toBe("free");
    expect(o?.limits).toEqual(FREE_LIMITS);
    expect(o?.patients.total).toBe(0);
    expect(o?.cases.avgSatisfaction).toBeNull();
    expect(o?.impact.medianAckSeconds).toBeNull();
  });

  it("no es un objeto: null", () => {
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview("x")).toBeNull();
    expect(parseOverview([1])).toBeNull();
  });

  it("acepta números como texto (numeric de Postgres) y descarta basura", () => {
    const o = parseOverview({ cases: { avg_satisfaction: "4.5", active: "2", completed: "no" } });
    expect(o?.cases.avgSatisfaction).toBe(4.5);
    expect(o?.cases.active).toBe(2);
    expect(o?.cases.completed).toBe(0);
  });
});

describe("cifras del tablero", () => {
  it("cinco cifras en el orden de la pantalla", () => {
    const tiles = patientKpis(parseOverview(RAW_OVERVIEW) as CareOverview);
    expect(tiles.map((t) => t.key)).toEqual([
      "patients",
      "active",
      "pending",
      "completed",
      "rating",
    ]);
    expect(tiles.map((t) => t.value)).toEqual(["5", "1", "1", "3", "4,5"]);
    expect(tiles[0]?.sub).toBe("1 con alta");
    expect(tiles[4]?.sub).toBe("2 valoraciones");
  });

  it("sin valoraciones no hay «0,0»: hay un guion y una invitación", () => {
    const tiles = patientKpis(EMPTY_OVERVIEW);
    expect(tiles.map((t) => t.value)).toEqual(["0", "0", "0", "0", "—"]);
    expect(tiles[4]?.sub).toBe("Sin valoraciones aún");
    expect(tiles[0]?.sub).toBe("en la institución");
  });

  it("una sola valoración, en singular", () => {
    const tiles = patientKpis({
      ...EMPTY_OVERVIEW,
      cases: { ...EMPTY_OVERVIEW.cases, rated: 1, avgSatisfaction: 5 },
    });
    expect(tiles[4]?.value).toBe("5,0");
    expect(tiles[4]?.sub).toBe("1 valoración");
  });
});

describe("uso del plan", () => {
  const withUsage = (patients: number, monitored = 0, devices = 0): CareOverview => ({
    ...EMPTY_OVERVIEW,
    usage: { patients, monitored, devices },
  });

  it("Free: cuatro de cinco está cerca; cinco de cinco, lleno; los dispositivos, bloqueados", () => {
    const near = usageMeters(withUsage(4));
    expect(near[0]).toMatchObject({
      key: "patients",
      used: 4,
      limit: 5,
      state: "near",
      message: "4 de 5 pacientes",
    });
    const full = usageMeters(withUsage(5));
    expect(full[0]).toMatchObject({
      state: "full",
      message: "Llegaste al máximo de 5 pacientes",
      ratio: 1,
    });
    expect(usageMeters(withUsage(1))[0]?.state).toBe("ok");
    const devices = usageMeters(withUsage(1))[2];
    expect(devices).toMatchObject({
      key: "devices",
      state: "locked",
      message: "Disponible con IPS Mejorado",
    });
  });

  it("las cifras de miles llevan punto, igual en todos los navegadores (1.000), también en el plan de pago", () => {
    expect([0, 7, 999, 1000, 1234, 12_345, 300_000, 1_000_000].map(thousandsEs)).toEqual([
      "0",
      "7",
      "999",
      "1.000",
      "1.234",
      "12.345",
      "300.000",
      "1.000.000",
    ]);
    expect(thousandsEs(1234.9)).toBe("1.234");
    expect(thousandsEs(-1500)).toBe("-1.500");
    const premium = {
      ...EMPTY_OVERVIEW,
      plan: "institution_monthly",
      limits: { ...EMPTY_OVERVIEW.limits, patients: 1000, monitored: 300, devices: 300 },
      usage: { patients: 1000, monitored: 12, devices: 0 },
    };
    const [patients, monitored] = usageMeters(premium);
    expect(patients?.message).toBe("Llegaste al máximo de 1.000 pacientes");
    expect(monitored?.message).toBe("12 de 300 en monitoreo");
  });

  it("una oferta de mejora según qué tan cerca esté", () => {
    expect(upsellFor(withUsage(1))).toMatchObject({ show: true, urgency: "info" });
    expect(upsellFor(withUsage(4))).toMatchObject({ show: true, urgency: "near" });
    const full = upsellFor(withUsage(5));
    expect(full.urgency).toBe("full");
    expect(full.headline).toContain("5 pacientes");
    expect(full.perks.length).toBeGreaterThan(4);
  });

  it("IPS Mejorado no ve la oferta", () => {
    expect(upsellFor(parseOverview(RAW_OVERVIEW) as CareOverview).show).toBe(false);
  });
});

describe("primeros pasos", () => {
  it("un tablero nuevo en Free: 0 de 5 (dispositivo y equipo pedirían el plan de pago)", () => {
    const o = careOnboarding(EMPTY_OVERVIEW);
    expect(o.steps).toHaveLength(7);
    expect(o.total).toBe(5);
    expect(o.done).toBe(0);
    expect(o.pct).toBe(0);
    expect(o.next?.key).toBe("patient");
    expect(o.steps.filter((s) => s.locked).map((s) => s.key)).toEqual(["device", "team"]);
    expect(o.complete).toBe(false);
  });

  it("avanza con los datos", () => {
    const o = careOnboarding({
      ...EMPTY_OVERVIEW,
      patients: { ...EMPTY_OVERVIEW.patients, total: 2, monitored: 1 },
      cases: { ...EMPTY_OVERVIEW.cases, active: 1 },
    });
    expect(o.steps.filter((s) => s.done).map((s) => s.key)).toEqual(["patient", "case", "monitor"]);
    expect(o.pct).toBe(60);
    expect(o.next?.key).toBe("note");
  });

  it("la nota de registro no cuenta como «la primera nota»", () => {
    const base = { ...EMPTY_OVERVIEW, patients: { ...EMPTY_OVERVIEW.patients, total: 1 } };
    expect(
      careOnboarding({ ...base, impact: { ...base.impact, notes: 1 } }).steps.find(
        (s) => s.key === "note",
      )?.done,
    ).toBe(false);
    expect(
      careOnboarding({ ...base, impact: { ...base.impact, notes: 2 } }).steps.find(
        (s) => s.key === "note",
      )?.done,
    ).toBe(true);
    expect(careOnboarding(base, { hasNote: true }).steps.find((s) => s.key === "note")?.done).toBe(
      true,
    );
  });

  it("IPS Mejorado: siete pasos, y el último es invitar al equipo", () => {
    const o = careOnboarding(parseOverview(RAW_OVERVIEW) as CareOverview);
    expect(o.total).toBe(7);
    expect(o.steps.every((s) => !s.locked)).toBe(true);
    expect(o.next?.key).toBe("team");
    const full = careOnboarding(parseOverview(RAW_OVERVIEW) as CareOverview, {
      hasNote: true,
      hasTeam: true,
    });
    expect(full.complete).toBe(true);
    expect(full.pct).toBe(100);
    expect(full.next).toBeNull();
  });
});

describe("filtros y orden", () => {
  const ana = mkPatient({
    id: "a",
    full_name: "Ángela Muñoz",
    room: "301",
    modality: "elder",
    monitoring: true,
  });
  const beto = mkPatient({
    id: "b",
    full_name: "Beto Rojas",
    document_number: "99887766",
    modality: "hospital",
    conditions: ["EPOC"],
  });
  const cami = mkPatient({
    id: "c",
    full_name: "Camila Díaz",
    status: "discharged",
    modality: "remote",
  });
  const dora = mkPatient({
    id: "d",
    full_name: "Dora Gil",
    status: "paused",
    eps_name: "Nueva EPS",
    city: "Medellín",
  });
  const all = [ana, beto, cami, dora];

  it("por defecto no muestra a quienes tienen el alta", () => {
    expect(filterPatients(all, {}).map((p) => p.id)).toEqual(["a", "b", "d"]);
    expect(filterPatients(all, { status: "all" })).toHaveLength(4);
    expect(filterPatients(all, { status: "discharged" }).map((p) => p.id)).toEqual(["c"]);
    expect(filterPatients(all, { status: "paused" }).map((p) => p.id)).toEqual(["d"]);
  });

  it("busca sin tildes ni mayúsculas, por varias palabras y por varios campos", () => {
    expect(filterPatients(all, { q: "angela" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterPatients(all, { q: "MUNOZ ang" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterPatients(all, { q: "301" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterPatients(all, { q: "99887766" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterPatients(all, { q: "epoc" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterPatients(all, { q: "nueva eps" }).map((p) => p.id)).toEqual(["d"]);
    expect(filterPatients(all, { q: "medellin" }).map((p) => p.id)).toEqual(["d"]);
    expect(filterPatients(all, { q: "zzz" })).toEqual([]);
  });

  it("por modalidad y monitoreo", () => {
    expect(filterPatients(all, { modality: "hospital" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterPatients(all, { modality: "all" })).toHaveLength(3);
    expect(filterPatients(all, { monitoring: true }).map((p) => p.id)).toEqual(["a"]);
    expect(MODALITY_ORDER).toEqual(["hospital", "remote", "postop", "chronic", "elder"]);
  });

  it("atención: una alerta abierta pesa más que cualquier puntaje", () => {
    const live = new Map([
      ["a", { last_band: "high" as const, next_obs_due_at: null }],
      ["b", { last_band: "low" as const, next_obs_due_at: null }],
    ]);
    const alerts = [mkAlert({ patient_id: "b", severity: "warn", status: "open" })];
    const ctx = { live, alerts, now: NOW };
    expect(attentionScore(beto, ctx)).toBeGreaterThan(attentionScore(ana, ctx));
    expect(attentionScore(dora, ctx)).toBe(0);
  });

  it("una alerta resuelta no cuenta; una crítica sin ver pesa más que una reconocida", () => {
    const ctx = (alerts: ReturnType<typeof mkAlert>[]) => ({ live: new Map(), alerts, now: NOW });
    expect(attentionScore(beto, ctx([mkAlert({ patient_id: "b", status: "resolved" })]))).toBe(0);
    const open = attentionScore(
      beto,
      ctx([mkAlert({ patient_id: "b", severity: "critical", status: "open" })]),
    );
    const acked = attentionScore(
      beto,
      ctx([mkAlert({ patient_id: "b", severity: "critical", status: "acknowledged" })]),
    );
    expect(open).toBeGreaterThan(acked);
  });

  it("un control vencido o un paciente en monitoreo sin ningún control suben en la lista", () => {
    const monitored = mkPatient({ id: "m", monitoring: true });
    const noLive = attentionScore(monitored, { live: new Map(), alerts: [], now: NOW });
    expect(noLive).toBe(5);
    const overdue = attentionScore(monitored, {
      live: new Map([
        ["m", { last_band: "low" as const, next_obs_due_at: "2026-10-14T10:00:00Z" }],
      ]),
      alerts: [],
      now: NOW,
    });
    const onTime = attentionScore(monitored, {
      live: new Map([
        ["m", { last_band: "low" as const, next_obs_due_at: "2026-10-14T20:00:00Z" }],
      ]),
      alerts: [],
      now: NOW,
    });
    expect(overdue).toBe(onTime + 5);
  });

  it("ordena por atención, nombre o actividad reciente", () => {
    const ctx = {
      live: new Map([["d", { last_band: "high" as const, next_obs_due_at: null }]]),
      alerts: [],
      now: NOW,
    };
    const dMon = { ...dora, monitoring: true };
    // d: banda alta; a: en monitoreo y sin ningún control; b: nada
    expect(sortPatients([ana, beto, dMon], "attention", ctx).map((p) => p.id)).toEqual([
      "d",
      "a",
      "b",
    ]);
    expect(sortPatients([beto, ana, dora], "name").map((p) => p.id)).toEqual(["a", "b", "d"]);
    const recent = sortPatients(
      [
        { ...ana, updated_at: "2026-10-01T00:00:00Z" },
        { ...beto, updated_at: "2026-10-10T00:00:00Z" },
      ],
      "recent",
    );
    expect(recent.map((p) => p.id)).toEqual(["b", "a"]);
    // sin contexto, «atención» cae al orden alfabético
    expect(sortPatients([beto, ana], "attention").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("no modifica la lista original", () => {
    const copy = [beto, ana];
    sortPatients(copy, "name");
    expect(copy.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("avance de un caso", () => {
  it("con fecha estimada: porcentaje, días y si va tarde", () => {
    const c = mkCase({ opened_at: "2026-10-04T16:00:00Z", target_end_at: "2026-10-24T16:00:00Z" });
    const p = caseProgress(c, Date.parse("2026-10-14T16:00:00Z"));
    expect(p.pct).toBe(50);
    expect(p.daysOpen).toBe(10);
    expect(p.daysLeft).toBe(10);
    expect(p.late).toBe(false);
    expect(p.label).toBe("Faltan 10 días");
  });

  it("termina hoy y ya pasó", () => {
    const c = mkCase({ opened_at: "2026-10-04T16:00:00Z", target_end_at: "2026-10-14T20:00:00Z" });
    expect(caseProgress(c, Date.parse("2026-10-14T16:00:00Z")).label).toBe("Faltan 1 día");
    expect(caseProgress(c, Date.parse("2026-10-14T20:00:00Z")).label).toBe("Termina hoy");
    const late = caseProgress(c, Date.parse("2026-10-17T20:00:00Z"));
    expect(late.late).toBe(true);
    expect(late.pct).toBe(100);
    expect(late.label).toBe("Pasó la fecha estimada hace 3 días");
  });

  it("sin fecha estimada o cerrado", () => {
    const open = caseProgress(
      mkCase({ target_end_at: null, opened_at: "2026-10-13T16:00:00Z" }),
      Date.parse("2026-10-14T16:00:00Z"),
    );
    expect(open.pct).toBeNull();
    expect(open.label).toBe("1 día abierto");
    const closed = caseProgress(
      mkCase({
        status: "completed",
        closed_at: "2026-10-09T16:00:00Z",
        opened_at: "2026-10-04T16:00:00Z",
      }),
      Date.parse("2026-10-14T16:00:00Z"),
    );
    expect(closed.pct).toBe(100);
    expect(closed.label).toBe("Cerrado tras 5 días");
  });
});

describe("línea de tiempo", () => {
  it("juntas, lo más reciente primero, y sin duplicar lo que ya se cuenta con la nota o el control", () => {
    const items = buildTimeline({
      notes: [mkNote({ id: "n1", created_at: "2026-10-14T15:00:00Z", body: "Nota uno" })],
      events: [
        mkEvent({ id: "e1", kind: "note_added", created_at: "2026-10-14T15:00:00Z" }),
        mkEvent({ id: "e2", kind: "obs_recorded", created_at: "2026-10-14T15:10:00Z" }),
        mkEvent({ id: "e3", kind: "monitoring_on", created_at: "2026-10-14T14:00:00Z" }),
      ],
      alerts: [mkAlert({ id: "a1", opened_at: "2026-10-14T15:20:00Z", severity: "urgent" })],
      tasks: [
        mkTask({
          id: "t1",
          status: "done",
          completed_at: "2026-10-14T15:30:00Z",
          completed_name: "Marta",
          title: "Llamar",
        }),
      ],
      cases: [mkCase({ id: "c1", opened_at: "2026-10-04T15:00:00Z" })],
      obs: [
        mkObs({
          id: "o1",
          recorded_at: "2026-10-14T15:40:00Z",
          news2: 5,
          band: "medium",
          hr: 105,
          spo2: 94.5,
          sbp: 105,
          temp_c: 38.5,
        }),
        mkObs({ id: "o2", recorded_at: "2026-10-14T15:41:00Z", source: "device" }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual([
      "obs:o1",
      "task:t1:done",
      "alert:a1:open",
      "note:n1",
      "event:e3",
      "case:c1:open",
    ]);
    expect(items[0]).toMatchObject({
      title: "Control · NEWS2 5",
      tone: "warn",
      detail: "pulso 105 · SpO₂ 94,5 % · PAS 105 · 38,5 °C",
      actor: "Jorge Monitoreo",
    });
    expect(items[2]).toMatchObject({ title: "Alerta urgente", tone: "warn" });
    expect(items[1]).toMatchObject({ title: "Tarea hecha: Llamar", actor: "Marta" });
  });

  it("un caso cerrado aparece dos veces: abierto y cerrado, con desenlace y estrellas", () => {
    const items = buildTimeline({
      cases: [
        mkCase({
          id: "c1",
          status: "completed",
          opened_at: "2026-10-04T15:00:00Z",
          closed_at: "2026-10-12T15:00:00Z",
          outcome: "recovered",
          satisfaction: 5,
        }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["case:c1:close", "case:c1:open"]);
    expect(items[0]?.detail).toBe("Recuperado · 5 ★");
    expect(items[0]?.title).toContain("Caso completado");
    expect(items[1]?.detail).toBe("Con Laura Gómez");
  });

  it("las correcciones y los relevos se distinguen", () => {
    const items = buildTimeline({
      notes: [
        mkNote({ id: "n1", kind: "correction", created_at: "2026-10-14T15:00:00Z" }),
        mkNote({ id: "n2", kind: "handoff", created_at: "2026-10-14T15:01:00Z" }),
      ],
    });
    expect(items[0]).toMatchObject({ icon: "handoff", title: "Relevo de turno" });
    expect(items[1]).toMatchObject({ icon: "note", title: "Corrección a una nota anterior" });
  });

  it("recorta los textos largos y respeta el límite", () => {
    const long = "x".repeat(500);
    const items = buildTimeline(
      {
        notes: Array.from({ length: 10 }, (_, i) =>
          mkNote({ id: `n${i}`, body: long, created_at: `2026-10-14T15:0${i}:00Z` }),
        ),
      },
      3,
    );
    expect(items).toHaveLength(3);
    expect(items[0]?.detail?.length).toBe(220);
    expect(items[0]?.detail?.endsWith("…")).toBe(true);
  });

  it("describeEvent: lo que se cuenta y lo que no", () => {
    expect(describeEvent({ kind: "note_added", data: {} })).toBeNull();
    expect(describeEvent({ kind: "obs_recorded", data: {} })).toBeNull();
    expect(describeEvent({ kind: "algo_nuevo", data: {} })).toBeNull();
    expect(
      describeEvent({ kind: "patient_status", data: { from: "active", to: "paused" } })?.title,
    ).toBe("Estado: activo → en pausa");
    expect(
      describeEvent({ kind: "patient_discharged", data: { outcome: "referred" } })?.title,
    ).toBe("Alta del paciente · Remitido a otro servicio");
    expect(describeEvent({ kind: "scale_changed", data: { from: 1, to: 2 } })?.title).toContain(
      "1 → 2",
    );
    expect(describeEvent({ kind: "case_closed", data: { status: "cancelled" } })).toMatchObject({
      title: "Caso cancelado",
      tone: "muted",
    });
    expect(describeEvent({ kind: "alert_escalated", data: {} })?.tone).toBe("sos");
    expect(describeEvent({ kind: "export", data: { format: "fhir" } })?.icon).toBe("export");
  });
});

describe("mensaje para la familia", () => {
  const base = { patientName: "Ana Lucía Pérez", institutionName: "Clínica Norte", now: NOW };

  it("cuenta el estado en palabras, con el primer nombre y la firma de la institución", () => {
    const t = familyUpdateText({ ...base, band: "low", lastObsAt: T0 });
    expect(t).toContain("Hola, le saluda Clínica Norte.");
    expect(t).toContain("Ana (control de hoy 10:30 a. m.): se encuentra estable.");
    expect(t).not.toContain("Lucía");
    expect(t).toContain("responda este mensaje o llame a la institución");
    expect(t.endsWith("— Equipo de Clínica Norte")).toBe(true);
  });

  it("sin monitoreo, sin números inventados", () => {
    const t = familyUpdateText(base);
    expect(t).toContain("sigue en seguimiento de nuestro equipo");
    expect(t).not.toContain("control de");
  });

  it("si el estado es importante, avisa que llamarán por teléfono", () => {
    for (const band of ["medium", "high"] as const) {
      const t = familyUpdateText({ ...base, band });
      expect(t).toContain("Le llamaremos por teléfono");
      expect(t).not.toContain("responda este mensaje");
    }
    expect(familyUpdateText({ ...base, band: "low_medium" })).toContain("vigilando más de cerca");
  });

  it("los valores solo salen si se piden", () => {
    const v = { hr: 72, spo2: 97, sbp: 118, dbp: 76, temp_c: 36.8, rr: 16 };
    const without = familyUpdateText({ ...base, band: "low" });
    expect(without).not.toContain("Últimos valores");
    const withV = familyUpdateText({ ...base, band: "low", vitals: v, signer: "Marta" });
    expect(withV).toContain(
      "Últimos valores: pulso 72, saturación 97 %, presión 118/76, temperatura 36,8 °C, respiración 16 por minuto.",
    );
    expect(withV.endsWith("— Marta, Clínica Norte")).toBe(true);
    expect(familyUpdateText({ ...base, vitals: { sbp: 118 } })).toContain("presión sistólica 118");
    expect(familyUpdateText({ ...base, vitals: {} })).not.toContain("Últimos valores");
  });

  it("nunca habla de dinero (los pagos se hacen solo en la web de Humanix)", () => {
    for (const band of [null, "low", "low_medium", "medium", "high"] as const) {
      const t = familyUpdateText({ ...base, band, vitals: { hr: 70 }, signer: "Marta" });
      expect(t).not.toMatch(/pag(o|ar|a)\b|transferencia|nequi|daviplata|bancolombia|consign|\$/i);
    }
  });

  it("teléfonos colombianos", () => {
    expect(normalizeCoPhone("300 123 4567")).toEqual({ e164: "573001234567", kind: "mobile" });
    expect(normalizeCoPhone("+57 (300) 123-4567")).toEqual({
      e164: "573001234567",
      kind: "mobile",
    });
    expect(normalizeCoPhone("573001234567")).toEqual({ e164: "573001234567", kind: "mobile" });
    expect(normalizeCoPhone("601 234 5678")).toEqual({ e164: "576012345678", kind: "landline" });
    expect(normalizeCoPhone("234 5678")).toEqual({ e164: null, kind: "landline" });
    expect(normalizeCoPhone("123")).toEqual({ e164: null, kind: "unknown" });
    expect(normalizeCoPhone(null)).toEqual({ e164: null, kind: "unknown" });
  });

  it("el enlace de WhatsApp lleva el texto codificado y solo existe para móviles", () => {
    const link = whatsappLink("300 123 4567", "Hola, ¿cómo está?\nGracias");
    expect(link).toBe(
      "https://wa.me/573001234567?text=Hola%2C%20%C2%BFc%C3%B3mo%20est%C3%A1%3F%0AGracias",
    );
    expect(whatsappLink("601 234 5678", "x")).toBeNull();
    expect(whatsappLink("", "x")).toBeNull();
  });
});

describe("errores del servidor, traducidos", () => {
  it("cada código tiene su mensaje", () => {
    const e = (hint: string, extra: object = {}) => ({ hint, message: "x", ...extra });
    expect(careErrorMessage(e("consent_required"))).toContain("autorización del paciente");
    expect(careErrorMessage(e("duplicate_document"))).toContain(
      "ya hay un paciente con ese documento".replace("ya", "Ya"),
    );
    expect(careErrorMessage(e("forbidden"))).toContain("No tienes acceso");
    expect(careErrorMessage(e("case_closed"))).toBe("Ese caso ya está cerrado.");
    expect(careErrorMessage(e("not_monitored"))).toBe("El paciente no está en monitoreo.");
    expect(careErrorMessage(e("empty_vitals"))).toBe("Escribe al menos un valor.");
    expect(careErrorMessage(e("note_immutable"))).toContain("agrega una corrección");
    expect(careErrorMessage(e("devices_plan"))).toContain("IPS Mejorado");
  });

  it("un tope del plan conserva el número exacto que dice el servidor", () => {
    expect(
      careErrorMessage({
        hint: "patient_limit",
        message:
          "Tu plan permite hasta 5 pacientes a la vez. Da de alta a alguno o mejora tu plan.",
      }),
    ).toBe("Tu plan permite hasta 5 pacientes a la vez. Da de alta a alguno o mejora tu plan.");
    expect(careErrorMessage({ hint: "patient_limit", message: "limit" })).toBe(
      "Llegaste al máximo de pacientes de tu plan.",
    );
  });

  it("«datos inválidos» dice qué campo falló cuando el servidor lo informa", () => {
    expect(
      careErrorMessage({ hint: "invalid_data", details: "inst_patients_full_name_check" }),
    ).toContain("nombre");
    expect(careErrorMessage({ hint: "invalid_data", details: "inst_patients_check" })).toContain(
      "tipo",
    );
    expect(careErrorMessage({ hint: "invalid_data", details: "inst_obs_spo2_check" })).toBe(
      "La saturación debe estar entre 50 y 100 %.",
    );
    expect(careErrorMessage({ hint: "invalid_data", details: "inst_obs_temp_c_check" })).toContain(
      "temperatura",
    );
    expect(careErrorMessage({ hint: "invalid_data", details: "algo_raro" })).toBe(
      "Revisa los datos: alguno no es válido.",
    );
    expect(careErrorMessage({ hint: "invalid_data" })).toBe(
      "Revisa los datos: alguno no es válido.",
    );
  });

  it("sin pista: el mensaje del servidor si es legible; si no, uno genérico", () => {
    expect(careErrorMessage({ message: "El paciente no es de esta institución" })).toBe(
      "El paciente no es de esta institución",
    );
    expect(careErrorMessage({ message: "PGRST301 JWT expired" })).toBe(
      "No se pudo completar la acción. Inténtalo de nuevo.",
    );
    expect(careErrorMessage({ message: "x".repeat(300) })).toBe(
      "No se pudo completar la acción. Inténtalo de nuevo.",
    );
    expect(careErrorMessage(null)).toBe("No se pudo completar la acción. Inténtalo de nuevo.");
    expect(careErrorMessage("texto")).toBe("texto");
    expect(
      careErrorMessage({ code: "42501", message: "permission denied for table inst_patients" }),
    ).toContain("No tienes acceso");
  });

  it("el tipo de error decide qué se le ofrece a la persona", () => {
    expect(careErrorKind({ hint: "patient_limit" })).toBe("plan");
    expect(careErrorKind({ hint: "export_plan" })).toBe("plan");
    expect(careErrorKind({ hint: "forbidden" })).toBe("forbidden");
    expect(careErrorKind({ hint: "consent_required" })).toBe("validation");
    expect(careErrorKind({ hint: "case_closed" })).toBe("conflict");
    expect(careErrorKind({ hint: "zzz" })).toBe("other");
    expect(careErrorKind(undefined)).toBe("other");
  });
});

describe("exportar", () => {
  it("CSV de pacientes: separador «;», BOM, y celdas neutralizadas contra fórmulas", () => {
    const evil = mkPatient({
      id: "e",
      full_name: '=HYPERLINK("http://x")',
      conditions: ["Asma", "EPOC; severa"],
    });
    const ok = mkPatient({ id: "o", full_name: "Ana Pérez", birth_date: "1950-03-01" });
    const csv = patientsToCsv(
      [ok, evil],
      [
        mkCase({ patient_id: "o", status: "active" }),
        mkCase({ patient_id: "o", status: "completed", closed_at: "2026-10-09T15:00:00Z" }),
      ],
      NOW,
    );
    expect(csv.startsWith("﻿Nombre;Documento;Edad;")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      "Ana Pérez;CC 1020304050;76;F;Sanitas;Bogotá;Crónico;Activo;201;No;",
    );
    expect(lines[1]?.endsWith(";1;1")).toBe(true);
    expect(lines[2]?.startsWith("\"'=HYPERLINK") || lines[2]?.startsWith("'=HYPERLINK")).toBe(true);
    expect(lines[2]).toContain('"Asma, EPOC; severa"');
  });

  it("CSV de notas: en orden de secuencia y con la firma de cada una", () => {
    const csv = notesToCsv([
      mkNote({ seq: 2, body: "Segunda\ncon salto", hash: "b".repeat(64) }),
      mkNote({ seq: 1, body: "Primera", hash: "a".repeat(64), kind: "coordination" }),
    ]);
    const body = csv.replace("﻿", "");
    expect(
      body.startsWith(
        "N.º;Fecha;Tipo;Autor;Texto;Firma (SHA-256)\r\n1;2026-10-14 10:30;Coordinación;Marta Pacientes;Primera;",
      ),
    ).toBe(true);
    expect(body).toContain('"Segunda\ncon salto"');
    expect(body.indexOf("Primera")).toBeLessThan(body.indexOf("Segunda"));
  });
});
