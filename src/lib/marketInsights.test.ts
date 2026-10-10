import { describe, expect, it } from "vitest";
import {
  TARGETS,
  VERDICT_LABEL,
  buildInsights,
  classifyThemes,
  executiveSummary,
  funnel,
  isHotLead,
  isTrusted,
  leadGreeting,
  leadScore,
  leadsToCsv,
  marginOfError,
  marketVerdict,
  priorityLeads,
  requiredSample,
  sampleReadiness,
  segmentRanking,
  themeStats,
  trustedRows,
  wilsonInterval,
  type Insight,
} from "./marketInsights";
import { NOW, makeRows, row } from "./marketRows.fixture";
import type { ResponseRow } from "./marketValidation";

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const many = (n: number, over: Partial<ResponseRow> | ((i: number) => Partial<ResponseRow>)) =>
  Array.from({ length: n }, (_, i) =>
    row({ id: `m${i}`, ...(typeof over === "function" ? over(i) : over) }),
  );

// ── Estadística ────────────────────────────────────────────────────────────────────────────
describe("estadística honesta", () => {
  it("el intervalo de Wilson coincide con los valores de referencia", () => {
    const zero = wilsonInterval(0, 10);
    expect(zero.p).toBe(0);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(0.2775, 3);
    const half = wilsonInterval(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
    const all = wilsonInterval(10, 10);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7225, 3);
  });

  it("sin datos no inventa precisión y se limita a lo posible", () => {
    expect(wilsonInterval(3, 0)).toEqual({ p: 0, low: 0, high: 1 });
    const over = wilsonInterval(99, 10); // más éxitos que intentos: se limita a n
    expect(over.p).toBe(1);
    expect(wilsonInterval(-4, 10).p).toBe(0);
  });

  it("margen de error y tamaño de muestra", () => {
    expect(marginOfError(100)).toBeCloseTo(0.098, 3);
    expect(marginOfError(0)).toBe(1);
    expect(requiredSample(0.1)).toBe(97);
    expect(requiredSample(0.05)).toBe(385);
    expect(requiredSample(0.1, 0.3)).toBe(81);
  });

  it("a más respuestas, intervalo más estrecho", () => {
    const w10 = wilsonInterval(5, 10);
    const w100 = wilsonInterval(50, 100);
    expect(w100.high - w100.low).toBeLessThan(w10.high - w10.low);
  });
});

// ── Madurez de la muestra ──────────────────────────────────────────────────────────────────────
describe("sampleReadiness", () => {
  it("dice cuánto falta y con qué margen de error se mira cada perfil", () => {
    const rows = [
      ...many(12, { profile_type: "familia" }),
      ...many(3, (i) => ({ id: `i${i}`, profile_type: "ips_eps" })),
    ];
    const r = sampleReadiness(rows);
    const fam = r.byProfile[0];
    expect(fam).toMatchObject({ n: 12, target: 30, missing: 18, moePct: 28, status: "growing" });
    expect(r.byProfile[1]).toMatchObject({ n: 3, status: "few" });
    expect(r.byProfile[2]).toMatchObject({ n: 0, status: "none", moePct: null, missing: 30 });
    expect(r.total).toMatchObject({ n: 15, target: TARGETS.total, missing: 85, status: "growing" });
  });

  it("con 30 respuestas por perfil ya son suficientes (±18 puntos en el peor caso)", () => {
    const r = sampleReadiness(many(30, { profile_type: "profesional" }));
    expect(r.byProfile[2]).toMatchObject({ n: 30, status: "ready", moePct: 18, missing: 0 });
  });
});

// ── Embudo ─────────────────────────────────────────────────────────────────────────────────────
describe("funnel", () => {
  const rows = [
    row({ id: "a", benefit_expires_at: iso(3 * DAY) }), // código vigente que vence en 3 días
    row({ id: "b", promo_code: "MLP-BBBBB-CCCCC", benefit_expires_at: iso(30 * DAY) }),
    row({
      id: "c",
      promo_code: "MLP-CCCCC-DDDDD",
      premium_activated: true,
      redeemed_at: iso(-DAY),
      benefit_status: "redeemed",
    }),
    row({ id: "d", contact_verified_at: null, promo_code: null, benefit_status: "none" }),
    row({ id: "e", promo_code: null, benefit_status: "duplicate_contact" }), // verificó, su código es el de otra respuesta
    row({ id: "f", contact_verified_at: null, promo_code: "MLP-OLD00001", benefit_status: "none" }), // antigua
  ];

  it("cuenta cada etapa y calcula las tasas", () => {
    expect(funnel(rows, NOW)).toEqual({
      responses: 6,
      verified: 4,
      withCode: 3,
      redeemed: 1,
      verifiedRate: 67,
      codeRate: 75,
      redeemRate: 33,
      unredeemed: 2,
      expiringSoon: 1,
    });
  });

  it("un código vencido ya no cuenta como pendiente", () => {
    const f = funnel([row({ benefit_expires_at: iso(-DAY) })], NOW);
    expect(f.unredeemed).toBe(0);
    expect(f.expiringSoon).toBe(0);
  });

  it("sin filas las tasas son null (no 0 %)", () => {
    expect(funnel([], NOW)).toMatchObject({
      verifiedRate: null,
      codeRate: null,
      redeemRate: null,
      responses: 0,
    });
  });

  it("no revienta con una fecha de vencimiento dañada", () => {
    expect(() => funnel([row({ benefit_expires_at: "mañana" })], NOW)).not.toThrow();
  });
});

// ── Temas ──────────────────────────────────────────────────────────────────────────────────────
describe("classifyThemes", () => {
  const ids = (t: string) => classifyThemes(t);

  it("reconoce los dolores con las palabras de la gente", () => {
    expect(ids("No sé en quién confiar para dejar sola a mi mamá")).toEqual(
      expect.arrayContaining(["trust", "discovery"]),
    );
    expect(ids("Las agencias cobran mucho y no responden rápido")).toEqual(
      expect.arrayContaining(["price", "urgency"]),
    );
    expect(ids("Quiero que el pago llegue el mismo día del turno")).toEqual(
      expect.arrayContaining(["payments", "shifts"]),
    );
    expect(ids("Es indispensable ver los antecedentes judiciales y la verificación")).toContain(
      "trust",
    );
    expect(ids("Necesitamos cubrir turnos en menos de 1 hora y con contrato firmado")).toEqual(
      expect.arrayContaining(["shifts", "urgency", "legal"]),
    );
    expect(ids("Que me avise cómo va el turno y poder trabajar tranquilo")).toEqual(
      expect.arrayContaining(["communication", "shifts"]),
    );
    expect(ids("Vivo lejos y necesito a alguien cerca de mi barrio")).toContain("geography");
    expect(ids("Son excelentes profesionales con mucha experiencia")).toContain("quality");
  });

  it("ignora tildes y mayúsculas", () => {
    expect(ids("ANTECEDENTES JUDICIALES")).toEqual(ids("antecedentes judiciales"));
    expect(ids("Verificación")).toEqual(ids("verificacion"));
  });

  it("«seguridad social» es formalidad, no confianza; «confirmar» no es confianza", () => {
    const legal = ids("Necesito afiliación y seguridad social");
    expect(legal).toContain("legal");
    expect(legal).not.toContain("trust");
    expect(ids("Quiero confirmar la cita")).not.toContain("trust");
  });

  it("un texto sin dolor, vacío o raro no da temas ni lanza", () => {
    expect(ids("Todo bien")).toEqual([]);
    expect(ids("")).toEqual([]);
    expect(ids(undefined as unknown as string)).toEqual([]);
    expect(ids("   ¿¿??!!   ")).toEqual([]);
  });

  it("no repite temas", () => {
    const r = ids("confianza confianza verificación antecedentes confiable");
    expect(new Set(r).size).toBe(r.length);
  });
});

describe("themeStats", () => {
  const rows = [
    row({
      id: "a",
      profile_type: "familia",
      signal_score: 80,
      pain_point: "No encuentro cuidadores de confianza. Las agencias cobran mucho.",
      key_benefit: "Tranquilidad",
      comments: null,
    }),
    row({
      id: "b",
      profile_type: "familia",
      signal_score: 40,
      pain_point: "Desconfío de quien llega a casa sin referencias verificables",
      key_benefit: null,
      comments: null,
    }),
    row({
      id: "c",
      profile_type: "ips_eps",
      signal_score: 60,
      pain_point: "Cuando alguien falla no hay reemplazo y el turno queda sin cubrir",
      key_benefit: null,
      comments: null,
    }),
    row({
      id: "d",
      profile_type: "profesional",
      signal_score: 70,
      pain_point: "Me pagan tarde y sin garantía",
      key_benefit: null,
      comments: "Quiero cobrar el mismo día",
    }),
    row({ id: "e", pain_point: null, key_benefit: null, comments: null }), // sin texto: no cuenta
  ];
  const stats = themeStats(rows);
  const by = Object.fromEntries(stats.map((s) => [s.id, s]));

  it("cuenta cada fila una sola vez por tema y calcula el % sobre las filas con texto", () => {
    expect(by.trust.count).toBe(2);
    expect(by.trust.pct).toBe(50); // 2 de las 4 filas con texto
    expect(by.shifts.count).toBe(1);
    expect(by.payments.count).toBe(1);
    expect(by.trust.byProfile).toEqual({ familia: 2, ips_eps: 0, profesional: 0 });
  });

  it("ordena de más a menos frecuente", () => {
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].count).toBeGreaterThanOrEqual(stats[i].count);
    }
    expect(stats[0].id).toBe("trust");
  });

  it("la cita sale de la respuesta con más señal y es una frase completa", () => {
    expect(by.trust.quote).toEqual({
      text: "No encuentro cuidadores de confianza",
      profile: "familia",
    });
    expect(by.shifts.quote?.profile).toBe("ips_eps");
  });

  it("sin filas no hay temas", () => {
    expect(themeStats([])).toEqual([]);
    expect(themeStats([row({ pain_point: null, key_benefit: null, comments: null })])).toEqual([]);
  });
});

// ── Leads ──────────────────────────────────────────────────────────────────────────────────────
describe("leadScore", () => {
  const strong = row({
    signal_score: 80,
    willingness_pct: 60,
    pays_currently: "yes",
    comments: "Necesito ver antecedentes judiciales del profesional siempre",
    created_at: iso(-60_000),
    benefit_status: "available",
  });

  it("suma señal, disposición a pagar, gasto actual, requisitos y cercanía (con razones)", () => {
    const s = leadScore(strong, NOW)!;
    // 80·0,55 + 60·0,15 + 10 (ya paga) + 5 (requisitos) + 5 (llegó hoy) = 73
    expect(s.score).toBe(73);
    expect(s.stage).toBe("code");
    expect(s.reasons).toEqual([
      "Señal fuerte (80)",
      "Estima que 60 % pagaría",
      "Ya paga por algo similar",
      "Dejó requisitos concretos",
      "Llegó hoy",
    ]);
  });

  it("una institución vale más y un profesional un poco más que una familia", () => {
    const fam = leadScore(strong, NOW)!.score;
    expect(leadScore({ ...strong, profile_type: "ips_eps" }, NOW)!.score).toBe(fam + 10);
    expect(leadScore({ ...strong, profile_type: "profesional" }, NOW)!.score).toBe(fam + 4);
    expect(leadScore({ ...strong, profile_type: "ips_eps" }, NOW)!.reasons).toContain(
      "Institución: cuenta de mayor valor",
    );
  });

  it("solo entran contactos verificados y sin avisos graves de calidad", () => {
    expect(leadScore({ ...strong, contact_verified_at: null }, NOW)).toBeNull();
    for (const bad of ["gibberish", "repeated_text", "example_copy", "duplicate_text"]) {
      expect(leadScore({ ...strong, quality_flags: [bad] }, NOW)).toBeNull();
    }
  });

  it("«poco esfuerzo» resta 15 pero no lo saca de la lista", () => {
    const base = leadScore(strong, NOW)!.score;
    expect(leadScore({ ...strong, quality_flags: ["low_effort"] }, NOW)!.score).toBe(base - 15);
  });

  it("quien ya canjeó su mes es un lead para convertir a pago", () => {
    const s = leadScore({ ...strong, premium_activated: true, redeemed_at: iso(-DAY) }, NOW)!;
    expect(s.stage).toBe("redeemed");
    expect(s.reasons[0]).toBe("Ya probó el plan Esencial: conviértelo en pago");
  });

  it("el puntaje se limita a 0–100", () => {
    const max = leadScore(
      { ...strong, signal_score: 100, willingness_pct: 100, profile_type: "ips_eps" },
      NOW,
    )!;
    expect(max.score).toBe(100);
    const min = leadScore(
      {
        ...strong,
        signal_score: 0,
        willingness_pct: 0,
        pays_currently: "no",
        comments: null,
        created_at: iso(-30 * DAY),
        quality_flags: ["low_effort"],
      },
      NOW,
    )!;
    expect(min.score).toBe(0);
  });

  it("la cercanía decae con los días", () => {
    const at = (days: number) => leadScore({ ...strong, created_at: iso(-days * DAY) }, NOW)!.score;
    expect(at(1)).toBe(at(0));
    expect(at(5)).toBe(at(0) - 3); // de +5 a +2
    expect(at(10)).toBe(at(0) - 5);
  });
});

describe("priorityLeads", () => {
  const rows = [
    row({
      id: "low",
      signal_score: 30,
      willingness_pct: 10,
      pays_currently: "no",
      created_at: iso(-20 * DAY),
    }),
    row({
      id: "top",
      signal_score: 90,
      willingness_pct: 80,
      pays_currently: "yes",
      profile_type: "ips_eps",
      whatsapp: "573001112233",
      email: "a@b.co",
    }),
    row({
      id: "mid",
      signal_score: 60,
      full_name: null,
      city: "  ",
      whatsapp: null,
      email: "z@y.co",
      created_at: iso(-30 * DAY),
    }),
    row({ id: "unverified", contact_verified_at: null }),
    row({ id: "flagged", quality_flags: ["gibberish"] }),
  ];

  it("ordena por puntaje, excluye a quien no corresponde y respeta el límite", () => {
    const all = priorityLeads(rows, NOW);
    expect(all.map((l) => l.id)).toEqual(["top", "mid", "low"]);
    expect(priorityLeads(rows, NOW, 2).map((l) => l.id)).toEqual(["top", "mid"]);
    expect(priorityLeads(rows, NOW, 0)).toEqual([]);
  });

  it("usa WhatsApp antes que el correo y completa los datos que faltan", () => {
    const [top, mid] = priorityLeads(rows, NOW);
    expect(top).toMatchObject({ contact: "573001112233", contactKind: "whatsapp" });
    expect(mid).toMatchObject({
      name: "Sin nombre",
      city: null,
      contact: "z@y.co",
      contactKind: "email",
    });
  });

  it("a igual puntaje gana la respuesta más reciente", () => {
    const tie = [
      row({ id: "old", created_at: iso(-DAY * 20) }),
      row({ id: "new", created_at: iso(-DAY * 19) }),
    ];
    expect(priorityLeads(tie, NOW).map((l) => l.id)).toEqual(["new", "old"]);
  });
});

describe("isHotLead", () => {
  it("avisa solo con señal fuerte y sin avisos graves", () => {
    expect(isHotLead({ signal_score: 69, total_score: null, quality_flags: [] })).toBe(false);
    expect(isHotLead({ signal_score: 70, total_score: null, quality_flags: [] })).toBe(true);
    expect(isHotLead({ signal_score: 90, total_score: null, quality_flags: ["gibberish"] })).toBe(
      false,
    );
    expect(isHotLead({ signal_score: 90, total_score: null, quality_flags: ["low_effort"] })).toBe(
      true,
    );
    expect(isHotLead({ signal_score: null, total_score: 21, quality_flags: null })).toBe(true); // 21/30 = 70
    expect(isHotLead({ signal_score: null, total_score: null, quality_flags: null })).toBe(false);
  });
});

// ── Segmentos ──────────────────────────────────────────────────────────────────────────────────
describe("segmentRanking", () => {
  const rows = [
    ...[80, 70, 60].map((s, i) =>
      row({
        id: `fb${i}`,
        profile_type: "familia",
        city: "Bogotá",
        signal_score: s,
        willingness_pct: [60, 50, 40][i],
        pays_currently: i < 2 ? "yes" : "no",
      }),
    ),
    row({ id: "fc", profile_type: "familia", city: "Cali", signal_score: 99 }), // un solo caso: no alcanza
    ...[0, 1].map((i) =>
      row({
        id: `im${i}`,
        profile_type: "ips_eps",
        city: "Medellín",
        signal_score: 50,
        willingness_pct: 30,
        pays_currently: "no",
      }),
    ),
    ...[0, 1].map((i) =>
      row({
        id: `ps${i}`,
        profile_type: "profesional",
        city: i ? "  " : null,
        signal_score: 90,
        willingness_pct: 80,
        pays_currently: "yes",
      }),
    ),
  ];

  it("agrupa por perfil y ciudad, exige un mínimo y ordena por puntaje", () => {
    const seg = segmentRanking(rows);
    expect(seg.map((s) => s.key)).toEqual([
      "profesional|Sin ciudad",
      "familia|Bogotá",
      "ips_eps|Medellín",
    ]);
    expect(seg[0]).toMatchObject({
      n: 2,
      city: "Sin ciudad",
      avgSignal: 90,
      avgWtp: 80,
      payingPct: 100,
      score: 89,
    });
    expect(seg[1]).toMatchObject({ n: 3, avgSignal: 70, avgWtp: 50, payingPct: 67, score: 65 });
    expect(seg[2]).toMatchObject({ score: 38, payingPct: 0 });
  });

  it("el mínimo y el límite se pueden cambiar", () => {
    expect(segmentRanking(rows, 1).length).toBe(4);
    expect(segmentRanking(rows, 2, 1)).toHaveLength(1);
    expect(segmentRanking(rows, 10)).toEqual([]);
  });

  it("ignora perfiles desconocidos y no lanza sin filas", () => {
    expect(segmentRanking([row({ profile_type: "otro" }), row({ profile_type: "otro" })])).toEqual(
      [],
    );
    expect(segmentRanking([])).toEqual([]);
  });
});

// ── Veredicto ──────────────────────────────────────────────────────────────────────────────────
describe("marketVerdict", () => {
  const good = (i: number) => ({
    id: `g${i}`,
    signal_score: 80,
    willingness_pct: 60,
    pays_currently: "yes",
    contact_verified_at: iso(-DAY),
  });

  it("sin respuestas o con pocas, pide más datos y dice cuántas faltan", () => {
    const none = marketVerdict([]);
    expect(none.verdict).toBe("insufficient");
    expect(none.summary).toContain("Aún no hay respuestas");
    expect(none.criteria.every((c) => c.ok === null)).toBe(true);
    const few = marketVerdict(many(12, good));
    expect(few.verdict).toBe("insufficient");
    expect(few.summary).toContain("Faltan 18 respuestas");
    expect(few.summary).toContain("llevas 12 de 30");
  });

  it("con 30 respuestas que cumplen los 4 criterios: mercado validado", () => {
    const v = marketVerdict(many(30, good));
    expect(v).toMatchObject({
      verdict: "validated",
      label: VERDICT_LABEL.validated,
      passed: 4,
      evaluated: 4,
    });
    expect(v.criteria.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(v.summary).toContain("no una garantía");
  });

  it("si falla un criterio es «prometedor» y se nombra la meta que no llega", () => {
    const v = marketVerdict(many(30, (i) => ({ ...good(i), pays_currently: "no" })));
    expect(v.verdict).toBe("promising");
    expect(v.criteria.find((c) => c.key === "paying")).toMatchObject({
      ok: false,
      value: "0 %",
      target: "≥ 25 %",
    });
    expect(v.passed).toBe(3);
  });

  it("si fallan dos o más es «señal débil»", () => {
    const v = marketVerdict(
      many(30, (i) => ({
        ...good(i),
        signal_score: 20,
        willingness_pct: 10,
        pays_currently: "no",
        contact_verified_at: null,
      })),
    );
    expect(v.verdict).toBe("weak");
    expect(v.passed).toBe(0);
  });

  it("un criterio sin datos no cuenta en contra (filas antiguas sin «¿paga hoy?»)", () => {
    const v = marketVerdict(many(30, (i) => ({ ...good(i), pays_currently: null })));
    expect(v.criteria.find((c) => c.key === "paying")).toMatchObject({ ok: null, value: "—" });
    expect(v).toMatchObject({ verdict: "validated", evaluated: 3, passed: 3 });
  });

  it("si casi nada se puede evaluar, son datos insuficientes aunque haya 30 filas", () => {
    const v = marketVerdict(
      many(30, {
        signal_score: 80,
        willingness_pct: null,
        pays_currently: null,
        contact_verified_at: iso(-DAY),
      }),
    );
    expect(v.evaluated).toBe(2);
    expect(v.verdict).toBe("insufficient");
  });

  it("los umbrales publicados no cambian sin querer", () => {
    expect(TARGETS).toEqual({
      perProfile: 30,
      total: 100,
      verdict: { minResponses: 30, signal: 55, medianWtp: 40, payingPct: 25, verifiedPct: 50 },
      leadReady: 60,
      hotLeadSignal: 70,
    });
  });

  it("fronteras exactas con números literales: 54/55, 39/40, 24/25 %, 49/50 %", () => {
    const base = (i: number) => ({
      id: `b${i}`,
      signal_score: 80,
      willingness_pct: 60,
      pays_currently: "yes",
      contact_verified_at: iso(-DAY),
    });
    const okOf = (rows: ResponseRow[], key: string) =>
      marketVerdict(rows).criteria.find((c) => c.key === key)!.ok;
    expect(
      okOf(
        many(30, (i) => ({ ...base(i), signal_score: 54 })),
        "signal",
      ),
    ).toBe(false);
    expect(
      okOf(
        many(30, (i) => ({ ...base(i), signal_score: 55 })),
        "signal",
      ),
    ).toBe(true);
    expect(
      okOf(
        many(30, (i) => ({ ...base(i), willingness_pct: 39 })),
        "wtp",
      ),
    ).toBe(false);
    expect(
      okOf(
        many(30, (i) => ({ ...base(i), willingness_pct: 40 })),
        "wtp",
      ),
    ).toBe(true);
    // 100 filas: 24 % y 25 % pagan hoy
    const pay = (k: number) =>
      many(100, (i) => ({ ...base(i), pays_currently: i < k ? "yes" : "no" }));
    expect(okOf(pay(24), "paying")).toBe(false);
    expect(okOf(pay(25), "paying")).toBe(true);
    const ver = (k: number) =>
      many(100, (i) => ({ ...base(i), contact_verified_at: i < k ? iso(-DAY) : null }));
    expect(okOf(ver(49), "verified")).toBe(false);
    expect(okOf(ver(50), "verified")).toBe(true);
  });

  it("los umbrales son los publicados en TARGETS (frontera exacta)", () => {
    const T = TARGETS.verdict;
    const edge = marketVerdict(
      many(T.minResponses, (i) => ({
        id: `e${i}`,
        signal_score: T.signal,
        willingness_pct: T.medianWtp,
        pays_currently: i < Math.ceil((T.payingPct / 100) * T.minResponses) ? "yes" : "no",
        contact_verified_at:
          i < Math.ceil((T.verifiedPct / 100) * T.minResponses) ? iso(-DAY) : null,
      })),
    );
    expect(edge.verdict).toBe("validated");
  });
});

// ── Hallazgos ──────────────────────────────────────────────────────────────────────────────────
describe("buildInsights", () => {
  const byId = (xs: Insight[], id: string) => xs.find((x) => x.id === id);

  it("sin respuestas, un solo mensaje que dice qué hacer", () => {
    const xs = buildInsights([], NOW);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toMatchObject({ id: "empty", severity: "info" });
    expect(xs[0].action).toContain("/validacion");
  });

  it("con pocas respuestas advierte el margen de error y cuántas faltan", () => {
    const xs = buildInsights(many(12, {}), NOW);
    const s = byId(xs, "sample")!;
    expect(s.severity).toBe("warn");
    expect(s.title).toBe("Muestra pequeña: 12 respuestas");
    expect(s.detail).toContain("±28 puntos");
    expect(s.action).toContain("Faltan 18");
    expect(s.action).toContain("97");
  });

  it("el singular y el plural salen bien", () => {
    expect(byId(buildInsights(many(1, {}), NOW), "sample")!.title).toBe(
      "Muestra pequeña: 1 respuesta",
    );
  });

  const market = [
    ...many(20, (i) => ({
      id: `f${i}`,
      profile_type: "familia",
      signal_score: 80,
      willingness_pct: 70,
      pays_currently: i < 12 ? "yes" : "no",
      alternatives: ["Grupos de WhatsApp"],
      search_channels: ["whatsapp_groups"],
      pain_point: "No encuentro cuidadores de confianza y las agencias cobran mucho",
      created_at: iso(-DAY),
    })),
    ...many(15, (i) => ({
      id: `p${i}`,
      profile_type: "profesional",
      signal_score: 40,
      willingness_pct: 20,
      pays_currently: "no",
      alternatives: ["Agencia Salud Ya"],
      search_channels: ["facebook_groups"],
      pain_point: "Me pagan tarde y las ofertas son falsas",
      created_at: iso(-2 * DAY),
    })),
  ];
  const xs = buildInsights(market, NOW);

  it("lee la muestra, el perfil más fuerte y el más débil", () => {
    expect(byId(xs, "sample")).toMatchObject({ severity: "info" });
    expect(byId(xs, "strongest-profile")!.title).toContain("Familia / Usuario");
    expect(byId(xs, "strongest-profile")!.detail).toContain("80 sobre 100");
    expect(byId(xs, "weakest-profile")!.title).toContain("Profesional de Salud");
  });

  it("avisa de los perfiles que no han respondido", () => {
    const gap = byId(xs, "profile-gap")!;
    expect(gap.severity).toBe("warn");
    expect(gap.title).toContain("IPS / EPS");
  });

  it("interpreta la disposición a pagar y la brecha entre perfiles", () => {
    const w = byId(xs, "wtp")!;
    expect(w.title).toBe("Disposición a pagar: mediana de 70 %");
    expect(w.detail).toContain("brecha de 50 puntos");
    expect(w.action).toContain("Segmenta");
  });

  it("nombra la competencia y los canales", () => {
    expect(byId(xs, "competition")!.title).toContain("Grupos de WhatsApp");
    expect(byId(xs, "competition")!.detail).toContain("canal informal");
    expect(byId(xs, "channels")!.detail).toContain("Familia / Usuario: Grupos de WhatsApp");
  });

  it("resume los dolores y los contactos listos", () => {
    expect(byId(xs, "themes")!.title).toContain("Confianza y verificación");
    expect(byId(xs, "leads")!.severity).toBe("good");
  });

  it("los avisos van antes que lo bueno y lo informativo", () => {
    const order = { risk: 0, warn: 1, good: 2, info: 3 } as const;
    for (let i = 1; i < xs.length; i++) {
      expect(order[xs[i - 1].severity]).toBeLessThanOrEqual(order[xs[i].severity]);
    }
    expect(new Set(xs.map((x) => x.id)).size).toBe(xs.length);
  });

  it("si casi nadie verifica el contacto, es un riesgo", () => {
    const f = byId(
      buildInsights(
        many(12, { contact_verified_at: null, promo_code: null, benefit_status: "none" }),
        NOW,
      ),
      "funnel-verify",
    )!;
    expect(f.severity).toBe("risk");
    expect(f.title).toBe("Solo 0 % verifica su contacto");
  });

  it("avisa de los códigos sin canjear y de los que vencen pronto", () => {
    const rows = many(6, (i) => ({
      id: `c${i}`,
      promo_code: `MLP-${i}`,
      benefit_status: "available",
      benefit_expires_at: iso(2 * DAY),
    }));
    const ins = buildInsights(rows, NOW);
    expect(byId(ins, "funnel-redeem")!.title).toBe("Solo 0 % canjeó su mes del plan Esencial");
    expect(byId(ins, "funnel-expiring")!.title).toBe("6 códigos vencen en 7 días");
  });

  it("compara la semana con la anterior", () => {
    const up = buildInsights(
      [
        ...many(10, (i) => ({ id: `n${i}`, created_at: iso(-DAY) })),
        ...many(5, (i) => ({ id: `o${i}`, created_at: iso(-10 * DAY) })),
      ],
      NOW,
    );
    expect(byId(up, "trend")).toMatchObject({ severity: "good" });
    expect(byId(up, "trend")!.title).toContain("subieron 100 %");
    const down = buildInsights(
      [
        ...many(2, (i) => ({ id: `n${i}`, created_at: iso(-DAY) })),
        ...many(10, (i) => ({ id: `o${i}`, created_at: iso(-10 * DAY) })),
      ],
      NOW,
    );
    expect(byId(down, "trend")).toMatchObject({ severity: "warn" });
    expect(byId(down, "trend")!.title).toContain("bajaron 80 %");
  });

  it("señala cuando muchas respuestas traen avisos de calidad", () => {
    const rows = [
      ...many(5, { quality_flags: ["low_effort"] }),
      ...many(5, (i) => ({ id: `ok${i}` })),
    ];
    expect(byId(buildInsights(rows, NOW), "quality")!.title).toContain("50 %");
  });

  it("dice si hay presupuesto o si hay que educar al mercado", () => {
    const rich = buildInsights(many(10, { pays_currently: "yes" }), NOW);
    expect(byId(rich, "budget")!.severity).toBe("good");
    const poor = buildInsights(many(10, { pays_currently: "no" }), NOW);
    expect(byId(poor, "budget")!.severity).toBe("warn");
  });
});

// ── Resumen ────────────────────────────────────────────────────────────────────────────────────
describe("executiveSummary", () => {
  it("sin respuestas lo dice y ya", () => {
    expect(executiveSummary([], NOW).split("\n")).toEqual([
      "Validación de mercado de Humanix — corte al 11 de octubre de 2026",
      "Aún no hay respuestas del formulario.",
    ]);
  });

  it("junta las cifras clave en texto listo para pegar", () => {
    const rows = [
      ...many(20, (i) => ({
        id: `f${i}`,
        profile_type: "familia",
        signal_score: 80,
        willingness_pct: 70,
        pays_currently: "yes",
        pain_point: "No encuentro cuidadores de confianza",
      })),
      ...many(10, (i) => ({
        id: `p${i}`,
        profile_type: "profesional",
        signal_score: 50,
        willingness_pct: 30,
        pays_currently: "no",
        pain_point: "Me pagan tarde",
      })),
    ];
    const text = executiveSummary(rows, NOW);
    expect(text).toContain("corte al 11 de octubre de 2026");
    expect(text).toContain(
      "• Respuestas: 30 (100 % con contacto verificado) · señal media 70 de 100",
    );
    expect(text).toContain("• Lectura: ");
    expect(text).toContain(
      "• Por perfil: Familia / Usuario 20 (señal 80, mediana 70 %) · Profesional de Salud 10 (señal 50, mediana 30 %)",
    );
    expect(text).toContain("• Disposición a pagar: mediana 70 %");
    expect(text).toContain("• Ya pagan por algo similar: 67 %");
    expect(text).toContain("• Dolores principales: ");
    expect(text).toContain(
      "• Embudo: 30 respuestas → 30 verificadas → 30 con código → 0 canjeadas",
    );
    expect(text.trim().split("\n").at(-1)).toContain("Lectura automática y orientativa");
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

// ── Propiedades con filas aleatorias ───────────────────────────────────────────────────────────
describe("invariantes del motor de inteligencia (filas aleatorias)", () => {
  for (const seed of [3, 11, 77, 2026]) {
    const rows = makeRows(seed, 350);

    it(`semilla ${seed}: nada lanza, los puntajes están en rango y las listas bien ordenadas`, () => {
      const leads = priorityLeads(rows, NOW, 50);
      leads.forEach((l) => {
        expect(l.score).toBeGreaterThanOrEqual(0);
        expect(l.score).toBeLessThanOrEqual(100);
        expect(l.reasons.length).toBeLessThanOrEqual(5);
      });
      for (let i = 1; i < leads.length; i++)
        expect(leads[i - 1].score).toBeGreaterThanOrEqual(leads[i].score);

      const seg = segmentRanking(rows, 2, 20);
      seg.forEach((s) => {
        expect(s.n).toBeGreaterThanOrEqual(2);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      });
      for (let i = 1; i < seg.length; i++)
        expect(seg[i - 1].score).toBeGreaterThanOrEqual(seg[i].score);

      const themes = themeStats(rows);
      themes.forEach((t) => {
        expect(t.count).toBeGreaterThan(0);
        expect(t.count).toBeLessThanOrEqual(rows.length);
        expect(t.pct).toBeLessThanOrEqual(100);
      });
    });

    it(`semilla ${seed}: el embudo es monótono y el veredicto coherente`, () => {
      const f = funnel(rows, NOW);
      expect(f.verified).toBeLessThanOrEqual(f.responses);
      expect(f.withCode).toBeLessThanOrEqual(f.responses);
      expect(f.redeemed).toBeLessThanOrEqual(f.withCode);
      expect(f.unredeemed).toBeLessThanOrEqual(f.withCode);
      expect(f.expiringSoon).toBeLessThanOrEqual(f.unredeemed);
      const v = marketVerdict(rows);
      expect(v.passed).toBeLessThanOrEqual(v.evaluated);
      expect(v.evaluated).toBeLessThanOrEqual(4);
      expect(Object.keys(VERDICT_LABEL)).toContain(v.verdict);
    });

    it(`semilla ${seed}: los hallazgos tienen texto, ids únicos y orden por gravedad`, () => {
      const xs = buildInsights(rows, NOW);
      expect(xs.length).toBeGreaterThan(0);
      expect(new Set(xs.map((x) => x.id)).size).toBe(xs.length);
      const order = { risk: 0, warn: 1, good: 2, info: 3 } as const;
      for (let i = 1; i < xs.length; i++)
        expect(order[xs[i - 1].severity]).toBeLessThanOrEqual(order[xs[i].severity]);
      xs.forEach((x) => {
        expect(x.title.trim().length).toBeGreaterThan(0);
        expect(`${x.title} ${x.detail} ${x.action ?? ""}`).not.toMatch(/undefined|NaN|\[object/);
      });
      const text = executiveSummary(rows, NOW);
      expect(text).not.toMatch(/undefined|NaN|\[object/);
    });

    it(`semilla ${seed}: la madurez de la muestra suma el total`, () => {
      const r = sampleReadiness(rows);
      expect(r.total.n).toBe(rows.length);
      r.byProfile.forEach((p) => expect(p.missing).toBe(Math.max(0, p.target - p.n)));
    });
  }
});

describe("mensaje y exportación de contactos", () => {
  it("el saludo usa el primer nombre bien escrito y cambia según la etapa", () => {
    expect(leadGreeting({ name: "maRTA rojas díaz", stage: "verified" })).toBe(
      "Hola Marta, soy del equipo de Humanix. Gracias por contarnos qué necesitas. ¿Te puedo hacer 3 preguntas rápidas para ayudarte mejor?",
    );
    expect(leadGreeting({ name: "Luis Prado", stage: "redeemed" })).toContain(
      "¿Cómo te ha ido con tu mes del plan Esencial?",
    );
    expect(leadGreeting({ name: "Sin nombre", stage: "code" })).toMatch(/^Hola, soy del equipo/);
    expect(leadGreeting({ name: "", stage: "code" })).toMatch(/^Hola, soy del equipo/);
  });

  it("el saludo nunca habla de pagos ni de cuentas", () => {
    for (const stage of ["verified", "code", "redeemed"] as const) {
      expect(leadGreeting({ name: "Ana Gil", stage })).not.toMatch(
        /pagu|pago|transfer|tarjeta|clave|contraseña/i,
      );
    }
  });

  it("la lista exportada trae una fila por contacto y neutraliza las fórmulas", () => {
    const leads = priorityLeads(
      [
        row({ id: "a", full_name: "=CMD()", signal_score: 90, whatsapp: "573001112233" }),
        row({
          id: "b",
          full_name: 'Luis; "Prado"',
          signal_score: 70,
          email: "l@p.co",
          whatsapp: null,
        }),
      ],
      NOW,
    );
    const csv = leadsToCsv(leads);
    expect(csv.startsWith("\uFEFFPuntaje;Nombre;Perfil;Contacto;Medio;Ciudad;Etapa;")).toBe(true);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('"Luis; ""Prado"""');
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(csv).toContain("WhatsApp");
    expect(csv).toContain("Correo");
  });
});

// ── Lo que no cuenta para decidir ───────────────────────────────────────────────────────────
describe("respuestas con avisos graves no inflan la lectura", () => {
  const farm = (n: number) =>
    many(n, (i) => ({
      id: `farm${i}`,
      quality_flags: ["duplicate_text"],
      signal_score: 100,
      willingness_pct: 100,
      pays_currently: "yes",
    }));
  const weak = many(30, (i) => ({
    id: `w${i}`,
    signal_score: 20,
    willingness_pct: 10,
    pays_currently: "no",
    contact_verified_at: null,
    promo_code: null,
    benefit_status: "none",
  }));

  it("solo los 4 avisos graves sacan una respuesta; «poco esfuerzo» no", () => {
    for (const f of ["gibberish", "repeated_text", "example_copy", "duplicate_text"]) {
      expect(isTrusted({ quality_flags: [f] })).toBe(false);
    }
    expect(isTrusted({ quality_flags: ["low_effort"] })).toBe(true);
    expect(isTrusted({ quality_flags: [] })).toBe(true);
    expect(isTrusted({ quality_flags: null })).toBe(true);
    const rows = [row({ id: "a" }), row({ id: "b", quality_flags: ["gibberish"] })];
    expect(trustedRows(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("una granja de respuestas copiadas no convierte el veredicto en «validado»", () => {
    const rows = [...weak, ...farm(60)];
    expect(marketVerdict(rows)).toMatchObject({ verdict: "weak", passed: 0, evaluated: 4 });
    expect(marketVerdict(rows).verdict).toBe(marketVerdict(weak).verdict);
    // sin el filtro, esas 60 filas llevarían la mediana y la señal por encima de las metas
    expect(marketVerdict(many(60, { signal_score: 100, willingness_pct: 100 })).verdict).toBe(
      "validated",
    );
  });

  it("la madurez de la muestra cuenta solo respuestas confiables", () => {
    expect(sampleReadiness([...weak, ...farm(60)]).total.n).toBe(30);
  });

  it("los temas y los segmentos ignoran las respuestas con aviso grave", () => {
    const bad = row({
      id: "bad",
      quality_flags: ["gibberish"],
      pain_point: "Necesito verificación y antecedentes siempre",
    });
    expect(themeStats([bad])).toEqual([]);
    expect(segmentRanking([bad, { ...bad, id: "bad2" }])).toEqual([]);
  });

  it("los hallazgos avisan cuántas se dejaron fuera y qué hacer", () => {
    const xs = buildInsights([...weak, ...farm(60)], NOW);
    const ex = xs.find((x) => x.id === "excluded")!;
    expect(ex.severity).toBe("warn");
    expect(ex.title).toBe("60 respuestas con avisos graves no cuentan en esta lectura");
    expect(ex.action).toContain("triángulo");
    expect(xs.find((x) => x.id === "sample")!.title).toBe(
      "Muestra de 30 respuestas (margen ±18 puntos)",
    );
    expect(buildInsights([...weak, ...farm(1)], NOW).find((x) => x.id === "excluded")!.title).toBe(
      "1 respuesta con aviso grave no cuenta en esta lectura",
    );
  });

  it("si todas tienen aviso grave, solo se explica eso (sin cifras inventadas)", () => {
    const xs = buildInsights(farm(5), NOW);
    expect(xs.map((x) => x.id)).toEqual(["excluded"]);
    expect(executiveSummary(farm(5), NOW).split("\n")[1]).toContain("todas con avisos graves");
  });

  it("el resumen cuenta cuántas quedaron fuera", () => {
    const text = executiveSummary([...weak, ...farm(2)], NOW);
    expect(text).toContain("• Respuestas: 30 (0 % con contacto verificado)");
    expect(text).toContain(
      "• No cuentan en esta lectura: 2 respuestas con avisos graves de calidad",
    );
  });

  it("el embudo sí cuenta todo lo recibido (es operativo)", () => {
    expect(funnel([...weak, ...farm(60)], NOW).responses).toBe(90);
  });
});

describe("segmentos con texto libre", () => {
  it("una ciudad con «|» se agrupa y se muestra completa", () => {
    const rows = [
      row({ id: "a", city: "Cali|Valle" }),
      row({ id: "b", city: "Cali|Valle" }),
      row({ id: "c", city: "Cali" }),
      row({ id: "d", city: "Cali" }),
    ];
    const seg = segmentRanking(rows);
    expect(seg.map((x) => x.city).sort()).toEqual(["Cali", "Cali|Valle"]);
    expect(seg.find((x) => x.city === "Cali|Valle")).toMatchObject({ profile: "familia", n: 2 });
  });
});
