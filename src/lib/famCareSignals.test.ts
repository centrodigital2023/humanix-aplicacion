import { describe, expect, it } from "vitest";
import { addDays, mergeDays, type CheckinRow, type DayKey } from "./famCareDays";
import {
  EMERGENCY_LINE,
  NOT_A_DIAGNOSIS,
  ageLabelEs,
  ageMonths,
  detectPatterns,
  flagFor,
  flagsOf,
  isGoodDay,
  levelOf,
  recipientStatus,
  silenceOf,
  silenceThreshold,
  urgentSignalsFor,
  worstLevel,
} from "./famCareSignals";
import {
  FAM_KINDS,
  NOTIFY_SIGNALS,
  SIGNAL_KEYS,
  SIGNAL_LABEL,
  SIGNALS_BY_KIND,
  type FamKind,
  type SignalKey,
} from "./famCareTypes";

const TODAY: DayKey = "2026-10-14";
const NOW = Date.UTC(2026, 9, 14, 15, 0, 0); // 10:00 en Colombia
const off = (n: number): DayKey => addDays(TODAY, n);

let seq = 0;
const row = (over: Partial<CheckinRow> & { day: string }): CheckinRow => ({
  id: `c${++seq}`,
  recipient_id: "r1",
  author_id: "u1",
  mood: 4,
  items: [],
  signals: [],
  note: null,
  created_at: `2026-10-14T10:00:${String(seq % 60).padStart(2, "0")}Z`,
  ...over,
});
const days = (rows: Array<Partial<CheckinRow> & { day: string }>) => mergeDays(rows.map(row));

describe("edad", () => {
  it("meses cumplidos, con el borde del día", () => {
    expect(ageMonths("2026-07-14", NOW)).toBe(3);
    expect(ageMonths("2026-07-15", NOW)).toBe(2);
    expect(ageMonths("2026-10-14", NOW)).toBe(0);
    expect(ageMonths("1948-10-14", NOW)).toBe(78 * 12);
  });

  it("sin fecha, con fecha imposible o futura: no se sabe", () => {
    expect(ageMonths(null, NOW)).toBeNull();
    expect(ageMonths("", NOW)).toBeNull();
    expect(ageMonths("2026-02-30", NOW)).toBeNull();
    expect(ageMonths("2027-01-01", NOW)).toBeNull();
  });

  it("la etiqueta de edad", () => {
    expect(ageLabelEs("2026-10-14", NOW)).toBe("recién nacido");
    expect(ageLabelEs("2026-02-14", NOW)).toBe("8 meses");
    expect(ageLabelEs("2026-09-14", NOW)).toBe("1 mes");
    expect(ageLabelEs("2024-07-14", NOW)).toBe("2 años y 3 meses");
    expect(ageLabelEs("2024-10-14", NOW)).toBe("2 años");
    expect(ageLabelEs("1948-03-02", NOW)).toBe("78 años");
    expect(ageLabelEs(null, NOW)).toBe("");
  });
});

describe("nivel de cada señal", () => {
  it("las emergencias son las que las guías tratan como atención inmediata", () => {
    for (const k of [
      "breathing",
      "chest_pain",
      "stroke",
      "seizure",
      "unresponsive",
      "bleeding",
    ] as SignalKey[]) {
      for (const kind of FAM_KINDS) expect(levelOf(k, { kind, ageMonths: null })).toBe("emergency");
    }
  });

  it("las urgentes se ven hoy", () => {
    for (const k of [
      "wound_infection",
      "leg_clot",
      "no_drink",
      "vomit_all",
      "confused",
    ] as SignalKey[]) {
      expect(levelOf(k, { kind: "elder", ageMonths: null })).toBe("urgent");
    }
  });

  it("las demás se vigilan", () => {
    for (const k of ["fall", "pain", "no_appetite", "bad_sleep"] as SignalKey[]) {
      expect(levelOf(k, { kind: "elder", ageMonths: null })).toBe("watch");
    }
  });

  it("la fiebre depende de quién la tiene", () => {
    expect(levelOf("fever", { kind: "child", ageMonths: 2 })).toBe("emergency");
    expect(levelOf("fever", { kind: "child", ageMonths: 0 })).toBe("emergency");
    expect(levelOf("fever", { kind: "child", ageMonths: 3 })).toBe("watch");
    expect(levelOf("fever", { kind: "child", ageMonths: 60 })).toBe("watch");
    expect(levelOf("fever", { kind: "child", ageMonths: null })).toBe("watch");
    expect(levelOf("fever", { kind: "surgery", ageMonths: 900 })).toBe("urgent");
    expect(levelOf("fever", { kind: "elder", ageMonths: 900 })).toBe("watch");
    expect(levelOf("fever", { kind: "illness", ageMonths: null })).toBe("watch");
  });

  it("todo lo que avisa al círculo es urgente o emergencia (y al revés)", () => {
    const ctx = { kind: "elder" as FamKind, ageMonths: null };
    const urgent = SIGNAL_KEYS.filter((k) => levelOf(k, ctx) !== "watch");
    expect([...NOTIFY_SIGNALS].sort()).toEqual([...urgent].sort());
  });

  it("cada tipo ofrece solo señales conocidas, sin repetir", () => {
    for (const kind of FAM_KINDS) {
      const list = SIGNALS_BY_KIND[kind];
      expect(new Set(list).size).toBe(list.length);
      for (const k of list) expect(SIGNAL_KEYS).toContain(k);
    }
  });

  it("cada tipo ofrece las señales de emergencia más importantes", () => {
    for (const kind of FAM_KINDS) {
      expect(SIGNALS_BY_KIND[kind]).toContain("breathing");
      expect(SIGNALS_BY_KIND[kind]).toContain("unresponsive");
    }
    expect(SIGNALS_BY_KIND.child).toContain("no_drink");
    expect(SIGNALS_BY_KIND.child).toContain("seizure");
    expect(SIGNALS_BY_KIND.surgery).toContain("leg_clot");
    expect(SIGNALS_BY_KIND.surgery).toContain("wound_infection");
    expect(SIGNALS_BY_KIND.elder).toContain("stroke");
  });
});

describe("guía de cada señal", () => {
  const ctx = { kind: "elder" as FamKind, ageMonths: null };

  it("toda señal tiene título y guía", () => {
    for (const k of SIGNAL_KEYS) {
      const f = flagFor(k, ctx);
      expect(f.title).toBe(SIGNAL_LABEL[k]);
      expect(f.guidance.length).toBeGreaterThan(20);
    }
  });

  it("las emergencias mandan a urgencias o a la línea de emergencias", () => {
    for (const k of SIGNAL_KEYS) {
      const f = flagFor(k, ctx);
      if (f.level === "emergency")
        expect(f.guidance).toMatch(/urgencias|emergencias|atención médica ya/i);
    }
    expect(EMERGENCY_LINE).toContain("123");
    expect(flagFor("breathing", ctx).guidance).toContain("123");
  });

  it("no afirma que sea una línea nacional: dice «en la mayoría»", () => {
    expect(EMERGENCY_LINE).toMatch(/en la mayoría/);
  });

  it("nunca promete ni diagnostica", () => {
    for (const k of SIGNAL_KEYS) {
      for (const kind of FAM_KINDS) {
        const g = flagFor(k, { kind, ageMonths: kind === "child" ? 1 : null }).guidance;
        expect(g).not.toMatch(
          /tiene (un|una) (infarto|derrame|infecci)|diagnóstico:|seguro que|no es nada/i,
        );
      }
    }
    expect(NOT_A_DIAGNOSIS).toMatch(/no un diagnóstico/);
  });

  it("el niño con señal de peligro va a urgencias hoy; el adulto, a consulta hoy", () => {
    expect(flagFor("vomit_all", { kind: "child", ageMonths: 18 }).guidance).toMatch(/urgencias/);
    expect(flagFor("vomit_all", { kind: "surgery", ageMonths: null }).guidance).toMatch(/hoy/);
  });

  it("la fiebre del bebé pequeño manda a urgencias; la del niño sin edad avisa del límite de 3 meses", () => {
    expect(flagFor("fever", { kind: "child", ageMonths: 2 }).guidance).toMatch(
      /menos de 3 meses.*urgencias/,
    );
    expect(flagFor("fever", { kind: "child", ageMonths: null }).guidance).toMatch(
      /menor de 3 meses/,
    );
    expect(flagFor("fever", { kind: "child", ageMonths: 24 }).guidance).not.toMatch(
      /menor de 3 meses/,
    );
  });

  it("la pierna hinchada tras una cirugía menciona el coágulo y la emergencia respiratoria", () => {
    const g = flagFor("leg_clot", { kind: "surgery", ageMonths: null }).guidance;
    expect(g).toMatch(/coágulo/);
    expect(g).toMatch(/dolor en el pecho/);
  });

  it("ordena de la más grave a la más leve", () => {
    const list = flagsOf(["bad_sleep", "breathing", "confused", "fall"], ctx);
    expect(list.map((f) => f.level)).toEqual(["emergency", "urgent", "watch", "watch"]);
    expect(list.map((f) => f.key)).toEqual(["breathing", "confused", "fall", "bad_sleep"]);
  });

  it("peor nivel de una lista", () => {
    expect(worstLevel([])).toBeNull();
    expect(worstLevel(["watch", "urgent"])).toBe("urgent");
    expect(worstLevel(["watch", "emergency", "urgent"])).toBe("emergency");
  });

  it("las banderas del bebé incluyen la fiebre; las del adulto no", () => {
    expect(urgentSignalsFor({ kind: "child", ageMonths: 1 }).has("fever")).toBe(true);
    expect(urgentSignalsFor({ kind: "elder", ageMonths: null }).has("fever")).toBe(false);
    expect(urgentSignalsFor({ kind: "surgery", ageMonths: null }).has("fever")).toBe(true);
  });
});

describe("patrones", () => {
  it("tres días seguidos con ánimo bajo", () => {
    const s = days([
      { day: off(0), mood: 2 },
      { day: off(-1), mood: 1 },
      { day: off(-2), mood: 2 },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: s, today: TODAY }).map((p) => p.id),
    ).toContain("low_mood");
  });

  it("si hoy aún no se anota, cuentan los tres días anteriores", () => {
    const s = days([
      { day: off(-1), mood: 2 },
      { day: off(-2), mood: 2 },
      { day: off(-3), mood: 1 },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: s, today: TODAY }).map((p) => p.id),
    ).toContain("low_mood");
  });

  it("dos días bajos no alcanzan, ni uno intermedio normal", () => {
    expect(
      detectPatterns({
        kind: "elder",
        summaries: days([
          { day: off(0), mood: 2 },
          { day: off(-1), mood: 2 },
        ]),
        today: TODAY,
      }).map((p) => p.id),
    ).not.toContain("low_mood");
    expect(
      detectPatterns({
        kind: "elder",
        summaries: days([
          { day: off(0), mood: 2 },
          { day: off(-1), mood: 3 },
          { day: off(-2), mood: 2 },
        ]),
        today: TODAY,
      }).map((p) => p.id),
    ).not.toContain("low_mood");
  });

  it("un día sin anotación entre medias corta el patrón", () => {
    const s = days([
      { day: off(0), mood: 2 },
      { day: off(-2), mood: 2 },
      { day: off(-3), mood: 2 },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: s, today: TODAY }).map((p) => p.id),
    ).not.toContain("low_mood");
  });

  it("comió poco en dos de los últimos tres días", () => {
    const s = days([
      { day: off(0), signals: ["no_appetite"] },
      { day: off(-1) },
      { day: off(-2), signals: ["no_appetite"] },
    ]);
    expect(
      detectPatterns({ kind: "illness", summaries: s, today: TODAY }).map((p) => p.id),
    ).toContain("appetite");
    const one = days([
      { day: off(0), signals: ["no_appetite"] },
      { day: off(-1) },
      { day: off(-2) },
    ]);
    expect(
      detectPatterns({ kind: "illness", summaries: one, today: TODAY }).map((p) => p.id),
    ).not.toContain("appetite");
  });

  it("no durmió en tres de los últimos cinco días", () => {
    const s = days([
      { day: off(0), signals: ["bad_sleep"] },
      { day: off(-2), signals: ["bad_sleep"] },
      { day: off(-4), signals: ["bad_sleep"] },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: s, today: TODAY }).map((p) => p.id),
    ).toContain("sleep");
    const two = days([
      { day: off(0), signals: ["bad_sleep"] },
      { day: off(-4), signals: ["bad_sleep"] },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: two, today: TODAY }).map((p) => p.id),
    ).not.toContain("sleep");
    const old = days([
      { day: off(0), signals: ["bad_sleep"] },
      { day: off(-2), signals: ["bad_sleep"] },
      { day: off(-5), signals: ["bad_sleep"] },
    ]);
    expect(
      detectPatterns({ kind: "elder", summaries: old, today: TODAY }).map((p) => p.id),
    ).not.toContain("sleep");
  });

  it("una caída con dolor o confusión es urgente", () => {
    const pain = days([{ day: off(0), signals: ["fall", "pain"] }]);
    const p = detectPatterns({ kind: "elder", summaries: pain, today: TODAY }).find(
      (x) => x.id === "fall_combo",
    );
    expect(p?.level).toBe("urgent");
    const confused = days([{ day: off(-1), signals: ["fall", "confused"] }]);
    expect(
      detectPatterns({ kind: "elder", summaries: confused, today: TODAY }).map((x) => x.id),
    ).toContain("fall_combo");
    const alone = days([{ day: off(0), signals: ["fall"] }]);
    expect(
      detectPatterns({ kind: "elder", summaries: alone, today: TODAY }).map((x) => x.id),
    ).not.toContain("fall_combo");
  });

  it("la medicina sin marcar en 2 de las últimas 3 anotaciones", () => {
    const s = days([
      { day: off(0), items: ["meds"] },
      { day: off(-1), items: ["food"] },
      { day: off(-2), items: [] },
    ]);
    const p = detectPatterns({ kind: "chronic", summaries: s, today: TODAY }).find(
      (x) => x.id === "meds_gap",
    );
    expect(p).toBeDefined();
    expect(p?.detail).toMatch(/Puede que sí/);
  });

  it("la medicina: con dos anotaciones no se avisa, y en niños tampoco", () => {
    const two = days([
      { day: off(0), items: [] },
      { day: off(-1), items: [] },
    ]);
    expect(
      detectPatterns({ kind: "chronic", summaries: two, today: TODAY }).map((x) => x.id),
    ).not.toContain("meds_gap");
    const three = days([
      { day: off(0), items: [] },
      { day: off(-1), items: [] },
      { day: off(-2), items: [] },
    ]);
    expect(
      detectPatterns({ kind: "child", summaries: three, today: TODAY }).map((x) => x.id),
    ).not.toContain("meds_gap");
    expect(
      detectPatterns({ kind: "elder", summaries: three, today: TODAY }).map((x) => x.id),
    ).toContain("meds_gap");
  });

  it("si la medicina sí se marcó en dos de tres, no se avisa", () => {
    const s = days([
      { day: off(0), items: ["meds"] },
      { day: off(-1), items: ["meds"] },
      { day: off(-2), items: [] },
    ]);
    expect(
      detectPatterns({ kind: "surgery", summaries: s, today: TODAY }).map((x) => x.id),
    ).not.toContain("meds_gap");
  });
});

describe("silencio", () => {
  const lit = (...o: number[]) => new Set(o.map(off));

  it("hoy ya se anotó: no hay silencio", () => {
    expect(silenceOf({ kind: "elder", lit: lit(0, -5), today: TODAY })).toBeNull();
  });

  it("sin ninguna anotación todavía no se avisa (lo cubre la bienvenida)", () => {
    expect(silenceOf({ kind: "elder", lit: lit(), today: TODAY })).toBeNull();
  });

  it("ayer anotado y hoy pendiente: nada que avisar", () => {
    expect(silenceOf({ kind: "elder", lit: lit(-1), today: TODAY })).toBeNull();
  });

  it("dos días completos sin anotar: se avisa", () => {
    const s = silenceOf({ kind: "elder", lit: lit(-3), today: TODAY });
    expect(s?.days).toBe(2);
    expect(s?.title).toBe("Sin registro hace 2 días");
  });

  it("un solo día de silencio no alcanza en un adulto mayor, pero sí en una enfermedad o en la primera semana tras la cirugía", () => {
    expect(silenceOf({ kind: "elder", lit: lit(-2), today: TODAY })).toBeNull();
    expect(silenceOf({ kind: "illness", lit: lit(-2), today: TODAY })?.days).toBe(1);
    expect(silenceOf({ kind: "surgery", lit: lit(-2), today: TODAY, routeDay: 3 })?.days).toBe(1);
    expect(silenceOf({ kind: "surgery", lit: lit(-2), today: TODAY, routeDay: 20 })).toBeNull();
    expect(silenceOf({ kind: "surgery", lit: lit(-2), today: TODAY, routeDay: null })).toBeNull();
    expect(silenceThreshold("surgery", 7)).toBe(1);
    expect(silenceThreshold("surgery", 8)).toBe(2);
    expect(silenceThreshold("surgery", -3)).toBe(2);
  });

  it("singular y plural", () => {
    expect(silenceOf({ kind: "illness", lit: lit(-2), today: TODAY })?.title).toBe(
      "Sin registro hace 1 día",
    );
  });
});

describe("estado de la persona", () => {
  const base = { kind: "elder" as FamKind, ageMonths: null, today: TODAY };

  it("sin nada: en calma", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([{ day: off(0), mood: 4, items: ["meds"] }]),
    });
    expect(st.level).toBe("calm");
    expect(st.flags).toEqual([]);
  });

  it("una emergencia de hoy manda sobre todo lo demás", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([{ day: off(0), signals: ["breathing", "bad_sleep"] }]),
    });
    expect(st.level).toBe("emergency");
    expect(st.flags[0].key).toBe("breathing");
    expect(st.flagDay).toBe(TODAY);
  });

  it("las señales de ayer siguen vigentes mientras hoy no se anote", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([{ day: off(-1), signals: ["confused"] }]),
    });
    expect(st.level).toBe("urgent");
    expect(st.flagDay).toBe(off(-1));
  });

  it("las de antier ya no son vigentes", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([
        { day: off(-2), signals: ["chest_pain"] },
        { day: off(-1), signals: [] },
      ]),
    });
    expect(st.flags).toEqual([]);
    expect(st.level).toBe("calm");
  });

  it("si hoy se anota sin señales, las de ayer se dan por superadas", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([
        { day: off(-1), signals: ["chest_pain"] },
        { day: off(0), signals: [] },
      ]),
    });
    expect(st.flags).toEqual([]);
  });

  it("una señal para vigilar o un silencio piden atención", () => {
    expect(
      recipientStatus({ ...base, summaries: days([{ day: off(0), signals: ["pain"] }]) }).level,
    ).toBe("attention");
    expect(recipientStatus({ ...base, summaries: days([{ day: off(-4) }]) }).level).toBe(
      "attention",
    );
  });

  it("un patrón urgente sube el estado a urgente", () => {
    const st = recipientStatus({
      ...base,
      summaries: days([{ day: off(0), signals: ["fall", "pain"] }]),
    });
    expect(st.level).toBe("urgent");
    expect(st.patterns.map((p) => p.id)).toContain("fall_combo");
  });

  it("el bebé con fiebre es emergencia", () => {
    const st = recipientStatus({
      kind: "child",
      ageMonths: 2,
      today: TODAY,
      summaries: days([{ day: off(0), signals: ["fever"] }]),
    });
    expect(st.level).toBe("emergency");
  });

  it("un buen día es de ánimo 4 o 5 y sin urgencias", () => {
    const urgent = urgentSignalsFor({ kind: "elder", ageMonths: null });
    const s = days([
      { day: off(0), mood: 5 },
      { day: off(-1), mood: 3 },
      { day: off(-2), mood: 5, signals: ["confused"] },
    ]);
    expect(isGoodDay(s.get(off(0)), urgent)).toBe(true);
    expect(isGoodDay(s.get(off(-1)), urgent)).toBe(false);
    expect(isGoodDay(s.get(off(-2)), urgent)).toBe(false);
    expect(isGoodDay(undefined, urgent)).toBe(false);
  });
});
