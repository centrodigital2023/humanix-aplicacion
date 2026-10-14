import { describe, expect, it } from "vitest";
import {
  ALERT_TITLE,
  CARRY_WINDOW_HOURS,
  EMPTY_VITALS_FORM,
  ONLINE_WINDOW_MIN,
  alertGuidance,
  alertSla,
  bandLabel,
  bandNote,
  deviceHealth,
  deviceSnippets,
  dueRound,
  groupAlerts,
  lastControlLabel,
  monitorKpis,
  monitorStatus,
  news2Trend,
  nextEscalationInMs,
  parseVitalNumber,
  previewNews2,
  seriesOf,
  sortAlerts,
  sparkline,
  triageColumns,
  triageOf,
  validateVitals,
  vitalTone,
  vitalsPayload,
  type VitalValues,
} from "./instMonitoring";
import { NOW, mkAlert, mkDevice, mkLive, mkObs, mkPatient } from "./instCare.fixtures";

const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();

describe("estado de cada persona", () => {
  it("la banda del NEWS2 manda cuando no hay alertas", () => {
    expect(monitorStatus(mkLive({ last_band: "low" }), [], NOW).state).toBe("stable");
    expect(monitorStatus(mkLive({ last_band: "low_medium" }), [], NOW).state).toBe("attention");
    expect(monitorStatus(mkLive({ last_band: "medium" }), [], NOW).state).toBe("urgent");
    expect(monitorStatus(mkLive({ last_band: "high", last_news2: 9 }), [], NOW)).toMatchObject({
      state: "critical",
      band: "high",
      news2: 9,
    });
  });

  it("la banda del NEWS2 solo se repite junto al estado si dice algo distinto", () => {
    expect(bandNote(monitorStatus(mkLive({ last_band: "high", last_news2: 9 }), [], NOW))).toBe("");
    expect(bandNote(monitorStatus(mkLive({ last_band: "low", last_news2: 1 }), [], NOW))).toBe("");
    // el estado lo sube una alerta (p. ej. una caída) y el puntaje sigue estable: eso sí se dice
    const fall = mkAlert({ severity: "critical", reason: "fall" });
    expect(bandNote(monitorStatus(mkLive({ last_band: "low", last_news2: 1 }), [fall], NOW))).toBe(
      "NEWS2 estable",
    );
    // sin puntaje no hay banda que mostrar
    expect(bandNote(monitorStatus(undefined, [], NOW))).toBe("");
  });

  it("una alerta abierta más grave que la banda la supera; una menos grave no la rebaja", () => {
    const warn = mkAlert({ severity: "warn" });
    const critical = mkAlert({ severity: "critical" });
    expect(monitorStatus(mkLive({ last_band: "low" }), [critical], NOW).state).toBe("critical");
    expect(monitorStatus(mkLive({ last_band: "high" }), [warn], NOW).state).toBe("critical");
    expect(monitorStatus(mkLive({ last_band: "low" }), [warn], NOW).state).toBe("attention");
  });

  it("una alerta resuelta ya no cuenta; una reconocida sigue contando como abierta pero no como «sin ver»", () => {
    const resolved = mkAlert({ status: "resolved" });
    const acked = mkAlert({ status: "acknowledged", severity: "urgent" });
    const s0 = monitorStatus(mkLive({ last_band: "low" }), [resolved], NOW);
    expect(s0).toMatchObject({
      state: "stable",
      openAlerts: 0,
      unackedAlerts: 0,
      topSeverity: null,
    });
    const s1 = monitorStatus(
      mkLive({ last_band: "low" }),
      [acked, mkAlert({ severity: "warn" })],
      NOW,
    );
    expect(s1).toMatchObject({
      state: "urgent",
      openAlerts: 2,
      unackedAlerts: 1,
      topSeverity: "urgent",
    });
  });

  it("sin puntaje: ni «estable» (un menor de 16 años) ni crítico (aún sin controles)", () => {
    expect(monitorStatus(undefined, [], NOW)).toMatchObject({
      state: "pending",
      band: null,
      news2: null,
      lastSeenLabel: "Sin controles",
      overdue: true,
      dueLabel: "Primer control pendiente",
    });
    expect(monitorStatus(mkLive({ last_band: null, last_news2: null }), [], NOW).state).toBe(
      "pending",
    );
  });

  it("en línea: habló hace menos de 10 minutos", () => {
    expect(ONLINE_WINDOW_MIN).toBe(10);
    expect(monitorStatus(mkLive({ last_device_at: iso(9) }), [], NOW).online).toBe(true);
    expect(monitorStatus(mkLive({ last_device_at: iso(11) }), [], NOW).online).toBe(false);
    expect(monitorStatus(mkLive({ last_device_at: null }), [], NOW).online).toBe(false);
  });

  it("control: próximo, ahora o vencido", () => {
    expect(monitorStatus(mkLive({ next_obs_due_at: inMin(90) }), [], NOW)).toMatchObject({
      overdue: false,
      dueInMin: 90,
      dueLabel: "Próximo control en 1 h 30 min",
    });
    expect(monitorStatus(mkLive({ next_obs_due_at: inMin(1) }), [], NOW).dueLabel).toBe(
      "Control ahora",
    );
    expect(monitorStatus(mkLive({ next_obs_due_at: iso(25) }), [], NOW)).toMatchObject({
      overdue: true,
      dueInMin: -25,
      dueLabel: "Control vencido 25 min",
    });
  });

  it("etiquetas de banda y de triage", () => {
    expect(bandLabel("high")).toBe("Crítico");
    expect(bandLabel("low")).toBe("Estable");
    expect(bandLabel(null)).toBe("Sin puntaje");
    expect(triageOf("medium")).toBe("naranja");
    expect(triageOf(null)).toBeNull();
  });
});

describe("tablero", () => {
  const mk = (id: string, over = {}) =>
    mkPatient({ id, monitoring: true, status: "active", full_name: `Paciente ${id}`, ...over });
  const pa = mk("a", { modality: "hospital", room: "101" });
  const pb = mk("b", { modality: "remote" });
  const pc = mk("c");
  const pd = mkPatient({ id: "d", monitoring: false }); // no monitoreado
  const pe = mk("e", { status: "paused", monitoring: false });
  const live = new Map([
    [
      "a",
      mkLive({
        patient_id: "a",
        last_band: "high",
        last_news2: 9,
        last_device_at: iso(2),
        next_obs_due_at: inMin(10),
      }),
    ],
    [
      "b",
      mkLive({
        patient_id: "b",
        last_band: "low",
        last_news2: 0,
        last_device_at: iso(60),
        next_obs_due_at: iso(30),
      }),
    ],
  ]);
  const alerts = [
    mkAlert({ patient_id: "a", severity: "critical" }),
    mkAlert({ patient_id: "b", severity: "warn", status: "resolved" }),
    mkAlert({ patient_id: "d", severity: "critical" }), // no monitoreado: no cuenta
  ];

  it("Total · En línea · Alertas · Críticos (solo de quienes están en monitoreo)", () => {
    const k = monitorKpis([pa, pb, pc, pd, pe], live, alerts, NOW);
    expect(k).toEqual({ total: 3, online: 1, alerts: 1, critical: 1, overdue: 2, unacked: 1 });
  });

  it("vacío: todo en cero", () => {
    expect(monitorKpis([], new Map(), [], NOW)).toEqual({
      total: 0,
      online: 0,
      alerts: 0,
      critical: 0,
      overdue: 0,
      unacked: 0,
    });
  });

  it("columnas por estado, las más urgentes arriba, sin quienes no están en monitoreo", () => {
    const cols = triageColumns([pa, pb, pc, pd, pe], live, alerts, NOW);
    expect(cols.map((c) => c.state)).toEqual([
      "critical",
      "urgent",
      "attention",
      "stable",
      "pending",
    ]);
    expect(cols[0]?.entries.map((e) => e.patient.id)).toEqual(["a"]);
    expect(cols[3]?.entries.map((e) => e.patient.id)).toEqual(["b"]);
    expect(cols[4]?.entries.map((e) => e.patient.id)).toEqual(["c"]);
    expect(
      cols
        .flatMap((c) => c.entries)
        .map((e) => e.patient.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("dentro de una columna: mayor puntaje primero, luego control vencido, luego nombre", () => {
    const x = mk("x", { full_name: "Zoe" });
    const y = mk("y", { full_name: "Ana" });
    const z = mk("z", { full_name: "Bea" });
    const l = new Map([
      [
        "x",
        mkLive({ patient_id: "x", last_band: "low", last_news2: 2, next_obs_due_at: inMin(60) }),
      ],
      [
        "y",
        mkLive({ patient_id: "y", last_band: "low", last_news2: 2, next_obs_due_at: inMin(60) }),
      ],
      [
        "z",
        mkLive({ patient_id: "z", last_band: "low", last_news2: 4, next_obs_due_at: inMin(60) }),
      ],
    ]);
    const stable = triageColumns([x, y, z], l, [], NOW)[3]?.entries.map((e) => e.patient.id);
    expect(stable).toEqual(["z", "y", "x"]);
  });

  it("busca por nombre o habitación y filtra por modalidad", () => {
    expect(
      triageColumns([pa, pb, pc], live, alerts, NOW, { q: "101" })
        .flatMap((c) => c.entries)
        .map((e) => e.patient.id),
    ).toEqual(["a"]);
    expect(
      triageColumns([pa, pb, pc], live, alerts, NOW, { modality: "remote" })
        .flatMap((c) => c.entries)
        .map((e) => e.patient.id),
    ).toEqual(["b"]);
    expect(
      triageColumns([pa, pb, pc], live, alerts, NOW, { modality: "all", q: "" }).flatMap(
        (c) => c.entries,
      ),
    ).toHaveLength(3);
  });

  it("la ronda: lo vencido y lo que vence en 15 minutos, lo más atrasado primero; sin control, de primero", () => {
    const l = new Map([
      ["a", mkLive({ patient_id: "a", next_obs_due_at: inMin(10) })],
      ["b", mkLive({ patient_id: "b", next_obs_due_at: iso(30) })],
      ["x", mkLive({ patient_id: "x", next_obs_due_at: inMin(120) })],
    ]);
    const x = mk("x");
    const round = dueRound([pa, pb, pc, pd, x], l, NOW);
    expect(round.map((r) => r.patient.id)).toEqual(["c", "b", "a"]);
    expect(round[0]?.dueAt).toBeNull();
    expect(round[1]?.minutes).toBe(-30);
    expect(dueRound([pa], l, NOW, 5)).toEqual([]);
  });

  it("agrupa alertas por paciente", () => {
    const g = groupAlerts(alerts);
    expect(g.get("a")).toHaveLength(1);
    expect(g.get("zzz")).toBeUndefined();
  });
});

describe("formulario de signos", () => {
  const form = (o: Partial<typeof EMPTY_VITALS_FORM>) => ({ ...EMPTY_VITALS_FORM, ...o });

  it("acepta coma o punto decimal y rechaza lo demás", () => {
    expect(parseVitalNumber("36,8")).toBe(36.8);
    expect(parseVitalNumber(" 36.8 ")).toBe(36.8);
    expect(parseVitalNumber("")).toBeNull();
    expect(parseVitalNumber(undefined)).toBeNull();
    expect(parseVitalNumber("abc")).toBe("invalid");
    expect(parseVitalNumber("1e3")).toBe("invalid");
    expect(parseVitalNumber("36,8,1")).toBe("invalid");
  });

  it("un control válido: valores redondeados como en la base", () => {
    const c = validateVitals(
      form({
        hr: "72,4",
        rr: "16",
        spo2: "97,56",
        sbp: "120",
        dbp: "80",
        temp: "36,84",
        pain: "3",
        avpu: "A",
        onO2: "no",
      }),
    );
    expect(c.ok).toBe(true);
    expect(c.values).toEqual({
      hr: 72,
      rr: 16,
      spo2: 97.6,
      sbp: 120,
      dbp: 80,
      temp_c: 36.8,
      pain: 3,
      avpu: "A",
      on_o2: false,
    });
    expect(c.errors).toEqual({});
  });

  it("fuera de rango o con texto: dice cuál campo", () => {
    const c = validateVitals(
      form({ hr: "500", spo2: "101", temp: "abc", rr: "3", sbp: "20", dbp: "300", pain: "11" }),
    );
    expect(c.ok).toBe(false);
    expect(Object.keys(c.errors).sort()).toEqual([
      "dbp",
      "hr",
      "pain",
      "rr",
      "sbp",
      "spo2",
      "temp",
    ]);
    expect(c.errors.hr).toBe("Pulso: escribe un número entre 20 y 300 (por minuto).");
    expect(c.errors.temp).toContain("entre 25 y 45");
    expect(c.values.hr).toBeNull();
  });

  it("los límites exactos valen", () => {
    expect(validateVitals(form({ hr: "20" })).ok).toBe(true);
    expect(validateVitals(form({ hr: "300" })).ok).toBe(true);
    expect(validateVitals(form({ hr: "19" })).ok).toBe(false);
    expect(validateVitals(form({ spo2: "100" })).ok).toBe(true);
    expect(validateVitals(form({ pain: "0" })).ok).toBe(true);
  });

  it("hace falta al menos una medida; el oxígeno solo no basta, la caída o la conciencia sí", () => {
    expect(validateVitals(form({})).errors.form).toBe("Escribe al menos un valor.");
    expect(validateVitals(form({ onO2: "yes" })).errors.form).toBe("Escribe al menos un valor.");
    expect(validateVitals(form({ note: "solo una nota" })).ok).toBe(false);
    expect(validateVitals(form({ fall: true })).ok).toBe(true);
    expect(validateVitals(form({ avpu: "V" })).ok).toBe(true);
    expect(validateVitals(form({ pain: "0" })).ok).toBe(true);
  });

  it("avisa de valores raros sin bloquear", () => {
    const c = validateVitals(
      form({ hr: "200", spo2: "75", temp: "41,5", sbp: "60", dbp: "70", rr: "45" }),
    );
    expect(c.ok).toBe(true);
    expect(c.warnings).toHaveLength(6);
    expect(c.warnings.join(" ")).toContain("diastólica");
    expect(validateVitals(form({ hr: "72" })).warnings).toEqual([]);
  });

  it("lo que se manda al servidor: solo lo medido", () => {
    expect(
      vitalsPayload(
        form({ hr: "72", spo2: "97,5", onO2: "no", fall: true, note: "  buen día  " }),
        "2026-10-14T15:00:00Z",
      ),
    ).toEqual({
      hr: 72,
      spo2: 97.5,
      on_o2: false,
      fall: true,
      note: "buen día",
      recorded_at: "2026-10-14T15:00:00Z",
    });
    expect(vitalsPayload(form({ hr: "72" }))).toEqual({ hr: 72 });
    expect(vitalsPayload(form({ hr: "72", note: "x".repeat(400) })).note).toHaveLength(300);
    expect(vitalsPayload(form({ avpu: "C", onO2: "yes", hr: "abc" }))).toEqual({
      avpu: "C",
      on_o2: true,
    });
  });
});

describe("vista previa del NEWS2 (igual que la base)", () => {
  const nothing: VitalValues = {
    hr: null,
    rr: null,
    spo2: null,
    sbp: null,
    dbp: null,
    temp_c: null,
    pain: null,
    avpu: null,
    on_o2: null,
  };
  // Un control con solo lo que se midió (lo demás, nulo), como los que guarda la base.
  const row = (minAgo: number, v: Partial<ReturnType<typeof mkObs>>) =>
    mkObs({
      recorded_at: iso(minAgo),
      rr: null,
      spo2: null,
      on_o2: null,
      sbp: null,
      dbp: null,
      hr: null,
      avpu: null,
      temp_c: null,
      ...v,
    });
  const normal = (minAgo: number) =>
    row(minAgo, { rr: 16, spo2: 98, on_o2: false, sbp: 120, hr: 72, avpu: "A", temp_c: 36.8 });

  it("un control parcial hereda lo último conocido y dice qué heredó (mismo caso que I.6 de la base)", () => {
    const p = previewNews2({
      values: { ...nothing, hr: 118 },
      scale: 1,
      history: [normal(5)],
      now: NOW,
    });
    expect(p.applicable).toBe(true);
    expect(p.result?.score).toBe(2);
    expect(p.result?.measured).toBe(7);
    expect(p.carried).toEqual(["rr", "spo2", "on_o2", "sbp", "avpu", "temp_c"]);
    expect(p.missing).toEqual([]);
  });

  it("la ventana es de 12 horas: de 11 h sí, de 20 h no (casos I.8 e I.9 de la base)", () => {
    expect(CARRY_WINDOW_HOURS).toBe(12);
    const h11 = [row(11 * 60, { rr: 22 })];
    const h20 = [row(20 * 60, { rr: 22 })];
    const v = { ...nothing, hr: 72 };
    const a = previewNews2({ values: v, scale: 1, history: h11, now: NOW });
    expect(a.result?.score).toBe(2);
    expect(a.result?.measured).toBe(2);
    expect(a.carried).toEqual(["rr"]);
    const b = previewNews2({ values: v, scale: 1, history: h20, now: NOW });
    expect(b.result?.score).toBe(0);
    expect(b.result?.measured).toBe(1);
    expect(b.carried).toEqual([]);
    expect(b.missing).toEqual(["rr", "spo2", "on_o2", "sbp", "avpu", "temp_c"]);
  });

  it("un control con solo la temperatura hereda los otros seis (caso I.9b de la base: 2+1+1+1 = 5)", () => {
    const hist = [
      row(60, { rr: 22, spo2: 94, on_o2: false, sbp: 105, hr: 105, avpu: "A", temp_c: 38.5 }),
    ];
    const p = previewNews2({
      values: { ...nothing, temp_c: 36.8 },
      scale: 1,
      history: hist,
      now: NOW,
    });
    expect(p.result?.score).toBe(5);
    expect(p.result?.band).toBe("medium");
    expect(p.result?.measured).toBe(7);
    expect(p.carried).toEqual(["rr", "spo2", "on_o2", "sbp", "hr", "avpu"]);
  });

  it("lo medido ahora manda sobre lo anterior; se usa el valor más reciente de cada parámetro", () => {
    const hist = [row(120, { hr: 130 }), row(30, { hr: 60 })];
    const p = previewNews2({ values: nothing, scale: 1, history: hist, now: NOW });
    expect(p.result?.parts.find((x) => x.key === "hr")?.value).toBe(60);
    const q = previewNews2({ values: { ...nothing, hr: 140 }, scale: 1, history: hist, now: NOW });
    expect(q.result?.parts.find((x) => x.key === "hr")?.value).toBe(140);
    expect(q.carried).not.toContain("hr");
  });

  it("ignora lo posterior a ahora y respeta la escala 2 de saturación", () => {
    const future = [row(-30, { hr: 200 })];
    expect(previewNews2({ values: nothing, scale: 1, history: future, now: NOW }).carried).toEqual(
      [],
    );
    const v = { ...nothing, spo2: 90, on_o2: false };
    expect(previewNews2({ values: v, scale: 1, history: [], now: NOW }).result?.score).toBe(3);
    expect(previewNews2({ values: v, scale: 2, history: [], now: NOW }).result?.score).toBe(0);
  });

  it("menor de 16 años: no aplica (no hay puntaje)", () => {
    const p = previewNews2({
      values: { ...nothing, hr: 140 },
      scale: 1,
      history: [],
      now: NOW,
      birthDate: "2015-01-01",
    });
    expect(p).toEqual({ applicable: false, result: null, carried: [], missing: [] });
    expect(
      previewNews2({
        values: { ...nothing, hr: 140 },
        scale: 1,
        history: [],
        now: NOW,
        birthDate: "1950-01-01",
      }).applicable,
    ).toBe(true);
    expect(
      previewNews2({
        values: { ...nothing, hr: 140 },
        scale: 1,
        history: [],
        now: NOW,
        birthDate: null,
      }).applicable,
    ).toBe(true);
  });
});

describe("tendencia y gráficas", () => {
  const o = (minAgo: number, news2: number | null, over = {}) =>
    mkObs({
      recorded_at: iso(minAgo),
      news2,
      hr: news2 === null ? null : 60 + news2 * 10,
      ...over,
    });

  it("serie: dentro de la ventana, ordenada, sin nulos ni texto raro", () => {
    const obs = [
      o(30, 3),
      o(300, 1),
      o(20 * 60, 9),
      o(10, null),
      { ...o(5, 2), news2: "4" as unknown as number },
    ];
    const s = seriesOf(obs, "news2", 6, NOW);
    expect(s.map((p) => p.v)).toEqual([1, 3, 4]);
    expect(s[0]!.t).toBeLessThan(s[1]!.t);
  });

  it("sparkline: x por tiempo, y invertida, plana a media altura, vacía sin datos", () => {
    expect(sparkline([], 100, 20)).toEqual({ points: "", min: 0, max: 0, last: null });
    const flat = sparkline(
      [
        { t: 0, v: 5 },
        { t: 10, v: 5 },
      ],
      100,
      20,
      0,
    );
    expect(flat.points).toBe("0,10 100,10");
    const up = sparkline(
      [
        { t: 0, v: 0 },
        { t: 50, v: 5 },
        { t: 100, v: 10 },
      ],
      100,
      20,
      0,
    );
    expect(up.points).toBe("0,20 50,10 100,0");
    expect(up.last).toEqual({ x: 100, y: 0 });
    expect(up.min).toBe(0);
    expect(up.max).toBe(10);
    expect(sparkline([{ t: 5, v: 1 }], 100, 20).points).toBe("50,10");
  });

  it("tendencia del NEWS2 en las últimas 6 horas", () => {
    expect(news2Trend([o(30, 3)], NOW).direction).toBe("unknown");
    const up = news2Trend([o(300, 1), o(120, 3), o(10, 5)], NOW);
    expect(up).toMatchObject({ direction: "up", delta: 4, label: "Empeorando (+4 en 6 h)" });
    const down = news2Trend([o(300, 6), o(10, 2)], NOW);
    expect(down).toMatchObject({ direction: "down", delta: -4, label: "Mejorando (-4 en 6 h)" });
    expect(news2Trend([o(300, 2), o(10, 3)], NOW).direction).toBe("flat");
    // un salto reciente pesa más que una mejora lejana: de 2 a 14 no es «mejorando» aunque hace horas hubiera 19
    expect(news2Trend([o(300, 19), o(120, 0), o(60, 2), o(5, 14)], NOW)).toMatchObject({
      direction: "up",
      delta: 12,
      label: "Empeorando (+12 desde el control anterior)",
    });
    expect(news2Trend([o(300, 1), o(10, 5)], NOW)).toMatchObject({
      direction: "up",
      delta: 4,
      label: "Empeorando (+4 desde el control anterior)",
    });
    // una subida de 1 al final no borra una mejora grande; un salto de 2 sobre el control anterior sí es un empeoramiento
    expect(news2Trend([o(300, 9), o(120, 3), o(10, 4)], NOW)).toMatchObject({
      direction: "down",
      delta: -5,
    });
    expect(news2Trend([o(300, 6), o(120, 3), o(10, 5)], NOW)).toMatchObject({
      direction: "up",
      delta: 2,
      label: "Empeorando (+2 desde el control anterior)",
    });
    // lo de hace más de 6 horas no cuenta; los menores de 16 años (sin puntaje) tampoco
    expect(news2Trend([o(8 * 60, 0), o(10, 5)], NOW).direction).toBe("unknown");
    expect(
      news2Trend([o(300, 1, { applicable: false }), o(10, 6, { applicable: false })], NOW)
        .direction,
    ).toBe("unknown");
  });

  it("color de un valor según los puntos que aporta", () => {
    expect(vitalTone("hr", 72)).toBe("ok");
    expect(vitalTone("hr", 100)).toBe("copper");
    expect(vitalTone("hr", 120)).toBe("warn");
    expect(vitalTone("hr", 140)).toBe("sos");
    expect(vitalTone("spo2", 97)).toBe("ok");
    expect(vitalTone("spo2", 90)).toBe("sos");
    expect(vitalTone("spo2", 90, { scale: 2 })).toBe("ok");
    expect(vitalTone("spo2", 95, { scale: 2, onO2: true })).toBe("warn");
    expect(vitalTone("temp_c", 38.5)).toBe("copper");
    expect(vitalTone("rr", 22)).toBe("warn");
    expect(vitalTone("sbp", 85)).toBe("sos");
    expect(vitalTone("hr", null)).toBe("muted");
    expect(vitalTone("hr", Number.NaN)).toBe("muted");
  });
});

describe("alertas: plazo, orden y guía", () => {
  const open = (over = {}) => mkAlert({ opened_at: iso(5), due_ack_at: inMin(5), ...over });

  it("sin ver: quedan X minutos; luego «por vencer»; luego vencida", () => {
    const a = alertSla(
      mkAlert({ severity: "warn", opened_at: iso(10), due_ack_at: inMin(110) }),
      NOW,
    );
    expect(a).toMatchObject({ state: "ok", tone: "copper", label: "Quedan 1 h 50 min para verla" });
    expect(a.elapsed).toBeCloseTo(10 / 120, 3);
    const soon = alertSla(open({ opened_at: iso(8), due_ack_at: inMin(2) }), NOW);
    expect(soon).toMatchObject({
      state: "due_soon",
      tone: "warn",
      label: "Quedan 2 min para verla",
    });
    const late = alertSla(open({ opened_at: iso(25), due_ack_at: iso(15) }), NOW);
    expect(late).toMatchObject({
      state: "overdue",
      tone: "sos",
      label: "Sin atender: venció hace 15 min",
      elapsed: 1,
    });
    expect(late.remainingMs).toBe(-15 * 60_000);
  });

  it("reconocida: a tiempo o fuera de plazo; resuelta", () => {
    const base = {
      opened_at: iso(30),
      due_ack_at: iso(20),
      status: "acknowledged" as const,
      acked_by_name: "Jorge",
    };
    expect(alertSla(mkAlert({ ...base, acked_at: iso(25) }), NOW)).toMatchObject({
      state: "seen",
      tone: "ok",
      label: "Vista por Jorge hace 25 min",
    });
    expect(alertSla(mkAlert({ ...base, acked_at: iso(5) }), NOW)).toMatchObject({
      state: "seen",
      tone: "copper",
      label: "Vista por Jorge hace 5 min (fuera de plazo)",
    });
    expect(alertSla(mkAlert({ status: "resolved", resolved_at: iso(60) }), NOW)).toMatchObject({
      state: "resolved",
      label: "Resuelta hace 1 h",
    });
  });

  it("orden: sin ver (la más grave y la que vence antes), luego vistas, al final resueltas", () => {
    const a = open({ id: "warn-open", severity: "warn", due_ack_at: inMin(1) });
    const b = open({ id: "crit-late", severity: "critical", due_ack_at: inMin(9) });
    const c = open({ id: "crit-soon", severity: "critical", due_ack_at: inMin(2) });
    const d = mkAlert({ id: "acked", status: "acknowledged", opened_at: iso(1) });
    const e = mkAlert({ id: "res", status: "resolved", opened_at: iso(2) });
    expect(sortAlerts([e, d, a, b, c]).map((x) => x.id)).toEqual([
      "crit-soon",
      "crit-late",
      "warn-open",
      "acked",
      "res",
    ]);
  });

  it("cuándo pedir el escalamiento: el primer vencimiento de una urgente o crítica sin ver ni escalar", () => {
    expect(nextEscalationInMs([], NOW)).toBeNull();
    expect(nextEscalationInMs([open({ severity: "warn", due_ack_at: inMin(1) })], NOW)).toBeNull();
    expect(nextEscalationInMs([open({ status: "acknowledged" })], NOW)).toBeNull();
    expect(nextEscalationInMs([open({ escalated_at: iso(1) })], NOW)).toBeNull();
    expect(
      nextEscalationInMs(
        [open({ due_ack_at: inMin(9) }), open({ severity: "urgent", due_ack_at: inMin(4) })],
        NOW,
      ),
    ).toBe(4 * 60_000);
    expect(nextEscalationInMs([open({ due_ack_at: iso(3) })], NOW)).toBe(0);
  });

  it("título y guía de cada motivo", () => {
    for (const reason of Object.keys(ALERT_TITLE) as Array<keyof typeof ALERT_TITLE>) {
      expect(ALERT_TITLE[reason].length).toBeGreaterThan(5);
      expect(alertGuidance({ reason }).length).toBeGreaterThan(30);
    }
    expect(alertGuidance({ reason: "news2_high" })).toContain("emergencia");
    expect(alertGuidance({ reason: "fall" })).toContain("emergencia");
  });
});

describe("dispositivos", () => {
  it("estado según cuándo habló", () => {
    expect(deviceHealth(mkDevice({ last_ingest_at: iso(3) }), NOW)).toMatchObject({
      state: "online",
      label: "En línea",
      tone: "ok",
    });
    expect(deviceHealth(mkDevice({ last_ingest_at: iso(25) }), NOW)).toMatchObject({
      state: "quiet",
      label: "Sin datos desde hace 25 min",
    });
    expect(deviceHealth(mkDevice({ last_ingest_at: iso(180) }), NOW)).toMatchObject({
      state: "offline",
      tone: "sos",
      label: "Sin conexión hace 3 h",
    });
    expect(deviceHealth(mkDevice({ last_ingest_at: null }), NOW).state).toBe("never");
    expect(
      deviceHealth(mkDevice({ status: "revoked", last_ingest_at: iso(1) }), NOW),
    ).toMatchObject({ state: "revoked", label: "Revocado" });
  });

  it("ejemplos para quien integra: sin imprimir ninguna llave", () => {
    const s = deviceSnippets("hx_" + "a".repeat(32), "https://abc.supabase.co/");
    expect(s.curl).toContain("https://abc.supabase.co/rest/v1/rpc/inst_device_ingest");
    expect(s.curl).toContain("<LLAVE_PÚBLICA_DEL_PROYECTO>");
    expect(s.curl).toContain("hx_" + "a".repeat(32));
    expect(() => JSON.parse(s.json)).not.toThrow();
    expect(JSON.parse(s.json).p_code).toBe("hx_" + "a".repeat(32));
    expect(s.curl).not.toMatch(/eyJ/);
  });

  it("último control en palabras", () => {
    expect(lastControlLabel(mkLive({ last_obs_at: "2026-10-14T15:30:00Z" }), NOW)).toBe(
      "hoy 10:30 a. m.",
    );
    expect(lastControlLabel(null, NOW)).toBe("Sin controles");
    expect(lastControlLabel(mkLive({ last_obs_at: null }), NOW)).toBe("Sin controles");
  });
});
