import { describe, expect, it } from "vitest";
import {
  HANDOFF_MAX_PATIENTS,
  HANDOFF_TEXT_MAX,
  ILLNESS_META,
  draftHandoff,
  handoffPayload,
  handoffToText,
  lastHandoffLabel,
  suggestIllness,
  validateHandoff,
} from "./instHandoff";
import { monitorStatus } from "./instMonitoring";
import { NOW, mkAlert, mkLive, mkPatient, mkTask } from "./instCare.fixtures";

const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();

describe("gravedad sugerida", () => {
  const st = (live: Parameters<typeof mkLive>[0], alerts: ReturnType<typeof mkAlert>[] = []) =>
    monitorStatus(mkLive({ next_obs_due_at: inMin(120), ...live }), alerts, NOW);

  it("crítico → inestable; urgente, atención o alerta abierta → en observación; el resto, estable", () => {
    expect(suggestIllness(st({ last_band: "high", last_news2: 9 }), 0)).toBe("unstable");
    expect(suggestIllness(st({ last_band: "low" }, [mkAlert({ severity: "critical" })]), 0)).toBe(
      "unstable",
    );
    expect(suggestIllness(st({ last_band: "medium", last_news2: 6 }), 0)).toBe("watcher");
    expect(suggestIllness(st({ last_band: "low_medium", last_news2: 3 }), 0)).toBe("watcher");
    expect(
      suggestIllness(
        st({ last_band: "low" }, [mkAlert({ severity: "warn", status: "acknowledged" })]),
        0,
      ),
    ).toBe("watcher");
    expect(suggestIllness(st({ last_band: "low", last_news2: 0 }), 0)).toBe("stable");
  });

  it("un control vencido pone en observación; sin puntaje solo si hay tareas vencidas", () => {
    expect(suggestIllness(st({ last_band: "low", next_obs_due_at: iso(30) }), 0)).toBe("watcher");
    const noScore = monitorStatus(undefined, [], NOW);
    expect(suggestIllness(noScore, 0)).toBe("stable");
    expect(suggestIllness(noScore, 2)).toBe("watcher");
  });
});

describe("borrador del relevo", () => {
  const ana = mkPatient({
    id: "a",
    full_name: "Ana Pérez",
    monitoring: true,
    room: "201",
    allergies: ["Penicilina"],
    spo2_scale: 2,
    conditions: ["EPOC", "Hipertensión", "Diabetes", "Asma"],
  });
  const beto = mkPatient({
    id: "b",
    full_name: "Beto Rojas",
    monitoring: true,
    room: "202",
    conditions: [],
    allergies: [],
  });
  const cami = mkPatient({
    id: "c",
    full_name: "Camila Díaz",
    monitoring: false,
    birth_date: null,
    conditions: [],
    allergies: [],
  });
  const dora = mkPatient({ id: "d", full_name: "Dora Gil", status: "discharged" });
  const live = new Map([
    [
      "a",
      mkLive({
        patient_id: "a",
        last_band: "high",
        last_news2: 9,
        last_obs_at: iso(40),
        next_obs_due_at: inMin(30),
      }),
    ],
    [
      "b",
      mkLive({
        patient_id: "b",
        last_band: "low",
        last_news2: 0,
        last_obs_at: iso(60),
        next_obs_due_at: inMin(600),
      }),
    ],
  ]);
  const alerts = [mkAlert({ patient_id: "a", severity: "critical", reason: "news2_high" })];
  const tasks = [
    mkTask({ patient_id: "a", title: "Llamar a la familia", due_at: inMin(60) }),
    mkTask({ patient_id: "a", title: "Ronda de signos", due_at: iso(20), kind: "obs_round" }),
    mkTask({ patient_id: "a", title: "Tarea de mañana", due_at: inMin(60 * 24) }),
    mkTask({ patient_id: "a", title: "Ya hecha", status: "done", due_at: inMin(10) }),
    mkTask({ patient_id: "c", title: "Pedir autorización", due_at: iso(120) }),
  ];
  const drafts = draftHandoff({ patients: [dora, cami, beto, ana], live, alerts, tasks, now: NOW });

  it("solo los activos, los más delicados primero", () => {
    expect(drafts.map((d) => d.patientId)).toEqual(["a", "c", "b"]);
    expect(drafts.map((d) => d.illness)).toEqual(["unstable", "watcher", "stable"]);
    expect(drafts.every((d) => d.suggested === d.illness)).toBe(true);
  });

  it("el resumen cuenta la edad, hasta tres condiciones, el NEWS2 y las alertas abiertas", () => {
    const a = drafts[0]!;
    expect(a.summary).toBe(
      "78 años. EPOC, Hipertensión, Diabetes. NEWS2 9 (crítico) hace 40 min. Alertas abiertas: riesgo clínico alto (sin ver)",
    );
    expect(a.age).toBe("78 años");
    expect(a.room).toBe("201");
    expect(drafts[2]!.summary).toBe("78 años. NEWS2 0 (estable) hace 1 h");
  });

  it("acciones: lo vencido y lo que toca en las próximas 12 horas, sin lo hecho ni lo de mañana", () => {
    const a = drafts[0]!;
    expect(a.actions).toBe("Ronda de signos (vencida); Llamar a la familia (12:00 p. m.)");
    expect(a.actions).toContain("Ronda de signos (vencida)");
    expect(a.actions).toContain("Llamar a la familia (");
    expect(a.actions).not.toContain("Tarea de mañana");
    expect(a.actions).not.toContain("Ya hecha");
    expect(a.actions.indexOf("Ronda")).toBeLessThan(a.actions.indexOf("Llamar"));
    expect(drafts[2]!.actions).toBe("Sin tareas pendientes.");
  });

  it("una persona sin monitoreo y con tareas vencidas queda en observación", () => {
    const c = drafts[1]!;
    expect(c.illness).toBe("watcher");
    expect(c.actions).toContain("Pedir autorización (vencida)");
    expect(c.summary).toBe("");
  });

  it("qué hacer si cambia, según la gravedad y el puntaje", () => {
    expect(drafts[0]!.contingency).toContain("activar la emergencia");
    expect(drafts[1]!.contingency).toBe(
      "Repetir los signos según el protocolo de la institución. Si el NEWS2 llega a 7 o más, o un parámetro suma 3 puntos, avisar al médico de turno.",
    );
    expect(drafts[2]!.contingency).toBe(
      "Controles cada 12 h. Si el NEWS2 sube a 5 o más o un parámetro suma 3 puntos, avisar al médico de turno.",
    );
  });

  it("no se le olvidan las alergias ni la escala de saturación", () => {
    expect(drafts[0]!.flags).toEqual([
      "Alergias: Penicilina",
      "Escala 2 de saturación (meta 88–92 %)",
    ]);
    expect(drafts[2]!.flags).toEqual([]);
  });

  it("una persona sin controles aún pide el primero", () => {
    const e = mkPatient({
      id: "e",
      full_name: "Eva Mora",
      monitoring: true,
      conditions: [],
      allergies: [],
      birth_date: null,
    });
    const [d] = draftHandoff({ patients: [e], live: new Map(), alerts: [], tasks: [], now: NOW });
    expect(d!.actions).toBe("Hacer el primer control de signos");
    expect(d!.summary).toBe("Aún sin controles");
  });

  it("los textos largos se recortan al límite del servidor", () => {
    const f = mkPatient({
      id: "f",
      full_name: "Fer",
      monitoring: false,
      conditions: ["x".repeat(79)],
    });
    const many = Array.from({ length: 5 }, (_, i) =>
      mkTask({ patient_id: "f", title: "t".repeat(160), due_at: inMin(i + 1) }),
    );
    const [d] = draftHandoff({ patients: [f], live: new Map(), alerts: [], tasks: many, now: NOW });
    expect(d!.actions.length).toBeLessThanOrEqual(HANDOFF_TEXT_MAX);
    expect(d!.actions.endsWith("…")).toBe(true);
  });
});

describe("validar y enviar", () => {
  const draft = (over = {}) => ({
    patientId: "p1",
    name: "Ana",
    room: null,
    age: "",
    illness: "stable" as const,
    suggested: "stable" as const,
    summary: "ok",
    actions: "ok",
    contingency: "ok",
    flags: [],
    ...over,
  });

  it("reglas del servidor", () => {
    expect(validateHandoff([draft()])).toEqual({ ok: true, errors: [] });
    expect(validateHandoff([]).errors).toEqual(["Elige al menos un paciente."]);
    expect(
      validateHandoff([draft({ summary: "x".repeat(HANDOFF_TEXT_MAX + 1) })]).errors[0],
    ).toContain("«resumen»");
    expect(
      validateHandoff(Array.from({ length: HANDOFF_MAX_PATIENTS + 1 }, () => draft())).errors[0],
    ).toContain("150");
  });

  it("lo que se manda: ids, gravedad y textos recortados de espacios", () => {
    expect(handoffPayload([draft({ summary: "  hola  ", illness: "watcher" })])).toEqual([
      { patient_id: "p1", illness: "watcher", summary: "hola", actions: "ok", contingency: "ok" },
    ]);
  });

  it("gravedades con su color", () => {
    expect(ILLNESS_META.unstable.tone).toBe("sos");
    expect(ILLNESS_META.stable.rank).toBeGreaterThan(ILLNESS_META.watcher.rank);
  });
});

describe("hoja impresa", () => {
  it("encabezado, conteos, cada paciente y espacio para la síntesis de quien recibe", () => {
    const drafts = draftHandoff({
      patients: [
        mkPatient({
          id: "a",
          full_name: "Ana Pérez",
          monitoring: false,
          room: "201",
          allergies: ["Penicilina"],
          conditions: [],
        }),
      ],
      live: new Map(),
      alerts: [],
      tasks: [],
      now: NOW,
    });
    const text = handoffToText(drafts, {
      institution: "Clínica Norte",
      now: NOW,
      from: "Marta",
      to: "Jorge",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("RELEVO DE TURNO · I-PASS");
    expect(lines[1]).toBe("Clínica Norte · 14 oct 2026 · 11:00 a. m.");
    expect(lines[2]).toBe("De: Marta   A: Jorge");
    expect(lines[3]).toBe("1 pacientes · 0 inestables · 0 en observación · 1 estables");
    expect(text).toContain("[ESTABLE] 1. Ana Pérez · 78 años · hab. 201");
    expect(text).toContain("   ⚠ Alergias: Penicilina");
    expect(text).toContain("   Si cambia: Controles según el protocolo de la institución.");
    expect(text).toContain("Síntesis de quien recibe");
    expect(
      text.endsWith(
        "Firma de quien entrega: ______________   Firma de quien recibe: ______________",
      ),
    ).toBe(true);
  });

  it("sin quién entrega ni recibe, no hay línea «De»", () => {
    expect(handoffToText([], { institution: "X", now: NOW })).not.toContain("De:");
  });

  it("último relevo", () => {
    expect(lastHandoffLabel(null, NOW)).toBe("Aún no se ha guardado ningún relevo");
    expect(lastHandoffLabel("2026-10-14T15:30:00Z", NOW)).toBe("Último relevo: hoy 10:30 a. m.");
  });
});
