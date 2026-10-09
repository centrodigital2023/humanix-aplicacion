import { describe, expect, it } from "vitest";
import {
  ALTERNATIVE_SUGGESTIONS,
  BENEFIT,
  CHANNEL_VALUES,
  PROFILES,
  assessQuality,
  canonicalName,
  cleanSubmission,
  clarityHint,
  countWords,
  crossFieldIssues,
  emptyForm,
  filterRows,
  looksLikeGibberish,
  marketValidationSchema,
  median,
  normalizeContact,
  questionsFor,
  responsesFilename,
  responsesToCsv,
  signalOf,
  signalScore,
  similarity,
  splitLegacyAlternatives,
  tabulate,
  tierFor,
  wtpSentence,
  type MarketValidationInput,
  type ResponseRow,
} from "./marketValidation";

const valid = (over: Partial<MarketValidationInput> = {}): MarketValidationInput => ({
  fullName: "Marta Rojas Díaz",
  profile: "familia",
  contact: "300 123 4567",
  city: "Bogotá",
  serviceOffer: "Busco una auxiliar de enfermería para mi mamá en las noches",
  painPoint: "No encuentro a nadie de confianza y las agencias cobran mucho y no responden rápido",
  targetAudience: "Hijos de 40 años que trabajan todo el día",
  dailyChange: "Podría trabajar tranquila sabiendo que alguien verificado la acompaña",
  paysCurrently: "no",
  alternatives: ["Grupos de WhatsApp", "", ""],
  searchChannels: ["whatsapp_groups"],
  searchChannelsOther: "",
  willingnessPct: 60,
  comments: "Necesito ver antecedentes judiciales",
  consent: true,
  website: "",
  ...over,
});

const issues = (input: unknown): Record<string, string> => {
  const r = marketValidationSchema.safeParse(input);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
};

describe("normalizeContact", () => {
  it("acepta celulares colombianos en cualquier formato y los lleva a 57XXXXXXXXXX", () => {
    for (const raw of [
      "3001234567",
      "300 123 4567",
      "(300) 123-4567",
      "+57 300 123 4567",
      "573001234567",
      "0057 300 123 4567",
    ]) {
      const c = normalizeContact(raw);
      expect(c?.kind, raw).toBe("whatsapp");
      expect(c?.value, raw).toBe("573001234567");
      expect(c?.key, raw).toBe("573001234567");
    }
    expect(normalizeContact("3001234567")?.display).toBe("+57 300 123 4567");
  });

  it("rechaza números que no son celulares colombianos", () => {
    for (const raw of [
      "",
      "123",
      "2001234567",
      "300123456",
      "30012345678",
      "abc",
      "+1 415 555 2671",
    ]) {
      expect(normalizeContact(raw), raw).toBeNull();
    }
  });

  it("normaliza correos y une las variantes de una misma persona", () => {
    const a = normalizeContact("Ana.Perez+rifas@Gmail.com");
    expect(a?.kind).toBe("email");
    expect(a?.value).toBe("ana.perez+rifas@gmail.com");
    expect(a?.key).toBe("anaperez@gmail.com");
    expect(normalizeContact("anaperez@googlemail.com")?.key).toBe("anaperez@gmail.com");
    expect(normalizeContact("a.n.a.perez@gmail.com")?.key).toBe("anaperez@gmail.com");
    // fuera de Gmail los puntos cuentan, pero la «+etiqueta» no
    expect(normalizeContact("ana.perez+x@empresa.co")?.key).toBe("ana.perez@empresa.co");
  });

  it("rechaza correos inválidos", () => {
    for (const raw of ["ana@", "@x.co", "ana@x", "ana x@y.co", "+tag@x.co"]) {
      expect(normalizeContact(raw), raw).toBeNull();
    }
  });

  it("enmascara sin revelar el contacto completo", () => {
    expect(normalizeContact("3001234567")?.masked).toBe("+57 300 *** 567");
    expect(normalizeContact("marta@correo.com")?.masked).toBe("ma***@correo.com");
  });
});

describe("marketValidationSchema", () => {
  it("acepta un formulario completo", () => {
    expect(issues(valid())).toEqual({});
  });

  it("exige nombre y apellido", () => {
    expect(issues(valid({ fullName: "Marta" })).fullName).toMatch(/nombre completo|apellido/i);
    expect(issues(valid({ fullName: "M R" })).fullName).toBeTruthy();
    expect(issues(valid({ fullName: "Marta Rojas" }))).toEqual({});
  });

  it("exige perfil, contacto válido y consentimiento", () => {
    expect(issues({ ...valid(), profile: undefined }).profile).toBe("Elige tu perfil");
    expect(issues(valid({ contact: "hola" })).contact).toMatch(/celular colombiano|correo/);
    expect(issues(valid({ contact: "marta@correo.com" }))).toEqual({});
    expect(issues({ ...valid(), consent: false }).consent).toMatch(/autorizar/);
  });

  it("pide respuestas con sustancia en 2.1 a 2.4", () => {
    expect(issues(valid({ serviceOffer: "auxiliar" })).serviceOffer).toBeTruthy();
    expect(issues(valid({ serviceOffer: "x".repeat(301) })).serviceOffer).toMatch(/300/);
    expect(issues(valid({ painPoint: "es difícil" })).painPoint).toBeTruthy();
    expect(issues(valid({ targetAudience: "todos" })).targetAudience).toBeTruthy();
    expect(issues(valid({ dailyChange: "mejor" })).dailyChange).toBeTruthy();
  });

  it("3.1 es obligatoria y, si hoy paga, pide al menos una alternativa (3.2)", () => {
    expect(issues({ ...valid(), paysCurrently: undefined }).paysCurrently).toBe("Elige una opción");
    expect(
      issues(valid({ paysCurrently: "yes", alternatives: ["", "", ""] })).alternatives,
    ).toMatch(/al menos una/);
    expect(issues(valid({ paysCurrently: "yes", alternatives: ["Agencia X", "", ""] }))).toEqual(
      {},
    );
    expect(issues(valid({ paysCurrently: "no", alternatives: ["", "", ""] }))).toEqual({});
    expect(issues(valid({ alternatives: ["a", "", ""] })).alternatives).toMatch(/2 letras/);
    expect(issues(valid({ alternatives: ["a1", "b2", "c3", "d4"] })).alternatives).toBeTruthy();
  });

  it("3.3 pide al menos un lugar o un texto", () => {
    expect(issues(valid({ searchChannels: [], searchChannelsOther: "" })).searchChannels).toMatch(
      /al menos un lugar/,
    );
    expect(
      issues(valid({ searchChannels: [], searchChannelsOther: "Voz a voz en el barrio" })),
    ).toEqual({});
    expect(issues({ ...valid(), searchChannels: ["telepatia"] }).searchChannels).toBeTruthy();
  });

  it("4.1 exige un entero de 0 a 100 elegido por la persona", () => {
    expect(issues({ ...valid(), willingnessPct: undefined }).willingnessPct).toMatch(/0 a 100/);
    expect(issues(valid({ willingnessPct: 101 })).willingnessPct).toMatch(/100/);
    expect(issues(valid({ willingnessPct: -1 })).willingnessPct).toMatch(/0/);
    expect(issues(valid({ willingnessPct: 12.5 })).willingnessPct).toMatch(/entero/);
    expect(issues(valid({ willingnessPct: 0 }))).toEqual({});
    expect(issues(valid({ willingnessPct: 100 }))).toEqual({});
  });

  it("4.2 y la ciudad son opcionales; el campo trampa debe ir vacío", () => {
    expect(issues(valid({ comments: "", city: "" }))).toEqual({});
    expect(issues(valid({ comments: "x".repeat(1001) })).comments).toBeTruthy();
    expect(issues(valid({ website: "http://spam.example" })).website).toBeTruthy();
  });

  it("el formulario vacío arranca sin respuestas inventadas", () => {
    const f = emptyForm();
    expect(f.willingnessPct).toBeUndefined();
    expect(f.profile).toBeUndefined();
    expect(f.paysCurrently).toBeUndefined();
    expect(f.consent).toBe(false);
    expect(f.alternatives).toHaveLength(3);
    expect(Object.keys(issues(f)).length).toBeGreaterThan(5);
  });
});

describe("crossFieldIssues (validación por pasos)", () => {
  const base = {
    paysCurrently: "no" as const,
    alternatives: ["", "", ""],
    searchChannels: ["google"],
    searchChannelsOther: "",
  };

  it("detecta lo que el esquema omite cuando faltan otros campos", () => {
    // sin disposición a pagar el esquema completo no evalúa las reglas cruzadas; el formulario sí debe hacerlo
    const full = marketValidationSchema.safeParse({
      ...valid({ paysCurrently: "yes", alternatives: ["", "", ""] }),
      willingnessPct: undefined,
    });
    expect(full.success).toBe(false);
    if (!full.success)
      expect(full.error.issues.some((i) => i.path[0] === "alternatives")).toBe(false);
    expect(crossFieldIssues({ ...base, paysCurrently: "yes" })).toEqual([
      {
        path: "alternatives",
        message: "Si hoy pagas por algo similar, menciona al menos una alternativa",
      },
    ]);
  });

  it("valida alternativas y canales", () => {
    expect(crossFieldIssues(base)).toEqual([]);
    expect(crossFieldIssues({ ...base, alternatives: ["x", "", ""] })).toEqual([
      { path: "alternatives", message: "Cada alternativa necesita al menos 2 letras" },
    ]);
    expect(crossFieldIssues({ ...base, searchChannels: [] })).toEqual([
      { path: "searchChannels", message: "Elige al menos un lugar o cuéntanos cuál usas" },
    ]);
    expect(
      crossFieldIssues({ ...base, searchChannels: [], searchChannelsOther: "voz a voz" }),
    ).toEqual([]);
    expect(
      crossFieldIssues({ ...base, paysCurrently: "yes", alternatives: ["Agencia X", "", ""] }),
    ).toEqual([]);
  });
});

describe("cleanSubmission", () => {
  it("limpia espacios, quita alternativas vacías o repetidas y normaliza el contacto", () => {
    const c = cleanSubmission(
      valid({
        fullName: "  Marta   Rojas  ",
        alternatives: ["Grupos de WhatsApp", "  grupos de whatsapp ", "Agencia   X"],
        city: "  ",
        comments: "  ",
        searchChannels: ["google", "google"],
      }),
    );
    expect(c?.fullName).toBe("Marta Rojas");
    expect(c?.alternatives).toEqual(["Grupos de WhatsApp", "Agencia X"]);
    expect(c?.city).toBeNull();
    expect(c?.comments).toBeNull();
    expect(c?.searchChannels).toEqual(["google"]);
    expect(c?.contact.value).toBe("573001234567");
  });

  it("devuelve null si el contacto no es válido", () => {
    expect(cleanSubmission(valid({ contact: "nada" }))).toBeNull();
  });
});

describe("calidad de las respuestas", () => {
  it("reconoce texto sin sentido pero no respuestas cortas legítimas", () => {
    for (const t of [
      "asdfasdf asdf qwerty",
      "aaaaaaaa",
      "jjjjjjjjj kkkkkkk",
      "bcdfg hjklm nnnnn",
      "si si si si si si",
    ]) {
      expect(looksLikeGibberish(t), t).toBe(true);
    }
    for (const t of [
      "Cuidado en casa para mi papá",
      "UCI de adultos",
      "EPS Sura y Sanitas",
      "Busco enfermera nocturna",
      "Turnos de 12 horas en Cali",
      "Necesito ver antecedentes judiciales",
    ]) {
      expect(looksLikeGibberish(t), t).toBe(false);
    }
  });

  it("mide el parecido entre dos textos", () => {
    expect(similarity("busco una enfermera para mi mamá", "Busco una enfermera para mi mamá")).toBe(
      1,
    );
    expect(similarity("busco enfermera nocturna", "turnos de clínica con contrato")).toBeLessThan(
      0.2,
    );
  });

  it("acepta un formulario normal sin banderas graves", () => {
    const q = assessQuality(valid());
    expect(q.severe).toBe(false);
    expect(q.flags).not.toContain("gibberish");
  });

  it("rechaza dos o más respuestas sin sentido", () => {
    const q = assessQuality(
      valid({ serviceOffer: "asdfg asdfg asdfg", painPoint: "jjjjjjj kkkkkkk lllllll" }),
    );
    expect(q.flags).toContain("gibberish");
    expect(q.severe).toBe(true);
    expect(q.fields).toEqual(expect.arrayContaining(["serviceOffer", "painPoint"]));
  });

  it("una sola respuesta rara no basta para rechazar", () => {
    const q = assessQuality(valid({ comments: "qwerty asdf zxcv" }));
    expect(q.flags).toContain("gibberish");
    expect(q.severe).toBe(false);
  });

  it("detecta la misma respuesta pegada en varios campos", () => {
    const same = "Necesito una enfermera de confianza para mi madre enferma";
    const q = assessQuality(
      valid({ serviceOffer: same, painPoint: same, targetAudience: same, dailyChange: same }),
    );
    expect(q.flags).toContain("repeated_text");
    expect(q.severe).toBe(true);
  });

  it("detecta los ejemplos copiados tal cual", () => {
    const ex = questionsFor("familia");
    const q = assessQuality(
      valid({ serviceOffer: ex.serviceOffer.example, painPoint: ex.painPoint.example }),
    );
    expect(q.flags).toContain("example_copy");
    expect(q.severe).toBe(true);
    expect(assessQuality(valid({ serviceOffer: ex.serviceOffer.example })).severe).toBe(false);
  });

  it("avisa cuando el esfuerzo es muy bajo (sin rechazar)", () => {
    const q = assessQuality(
      valid({
        serviceOffer: "enfermera nocturna casa",
        painPoint: "no confío en nadie",
        targetAudience: "hijos que trabajan",
        dailyChange: "más tranquilidad",
      }),
    );
    expect(q.flags).toContain("low_effort");
    expect(q.severe).toBe(false);
  });
});

describe("señal de demanda", () => {
  const base = {
    painPoint: "palabra ".repeat(20).trim(),
    targetAudience: "palabra ".repeat(12).trim(),
    dailyChange: "palabra ".repeat(15).trim(),
    paysCurrently: "yes" as const,
    alternatives: ["Agencia A", "Agencia B", "Grupos de WhatsApp"],
    willingnessPct: 100,
    comments: "palabra ".repeat(15).trim(),
  };

  it("suma 100 con las mejores respuestas y las partes cuadran", () => {
    const s = signalScore(base);
    expect(s.score).toBe(100);
    expect(s.tier).toBe("strong");
    expect(s.parts.reduce((a, p) => a + p.points, 0)).toBe(s.score);
    expect(s.parts.reduce((a, p) => a + p.max, 0)).toBe(100);
  });

  it("es baja con respuestas pobres", () => {
    const s = signalScore({
      ...base,
      painPoint: "no",
      targetAudience: "x",
      dailyChange: "y",
      paysCurrently: "not_researched",
      alternatives: [],
      willingnessPct: 0,
      comments: "",
    });
    expect(s.score).toBeLessThan(10);
    expect(s.tier).toBe("weak");
  });

  it("pesa cada parte con las reglas documentadas", () => {
    const parts = (over: object) =>
      Object.fromEntries(signalScore({ ...base, ...over }).parts.map((p) => [p.key, p.points]));
    expect(parts({ paysCurrently: "yes" }).spend).toBe(20);
    expect(parts({ paysCurrently: "no" }).spend).toBe(8);
    expect(parts({ paysCurrently: "not_researched" }).spend).toBe(4);
    expect(parts({ willingnessPct: 50 }).wtp).toBe(15);
    expect(parts({ alternatives: ["Uno"] }).market).toBe(8);
    expect(parts({ alternatives: ["Uno", "Dos"] }).market).toBe(12);
    expect(parts({ comments: "una frase corta pero útil de verdad" }).evidence).toBe(6);
    expect(parts({ comments: "ok" }).evidence).toBe(3);
  });

  it("una respuesta de baja calidad grave no puede pasar de 20", () => {
    expect(signalScore(base, { severe: true }).score).toBe(20);
  });

  it("los niveles cortan en 45 y 70", () => {
    expect(tierFor(70)).toBe("strong");
    expect(tierFor(69)).toBe("medium");
    expect(tierFor(45)).toBe("medium");
    expect(tierFor(44)).toBe("weak");
  });

  it("las filas antiguas usan su puntaje de 0 a 30 llevado a 100", () => {
    expect(signalOf({ signal_score: 80, total_score: 30 })).toBe(80);
    expect(signalOf({ signal_score: null, total_score: 15 })).toBe(50);
    expect(signalOf({ signal_score: null, total_score: 0 })).toBeNull();
  });
});

// ── Tabulación ────────────────────────────────────────────────────────────────────
const NOW = Date.parse("2026-10-11T15:00:00Z");

const row = (over: Partial<ResponseRow> = {}): ResponseRow => ({
  id: crypto.randomUUID(),
  created_at: "2026-10-11T14:00:00Z",
  profile_type: "familia",
  full_name: "Persona Uno",
  whatsapp: null,
  email: "uno@t.co",
  city: "Bogotá",
  service_offer: "Busco auxiliar de enfermería",
  pain_point: "No encuentro cuidadores confiables para mi mamá",
  target_customer: "Hijos que trabajan",
  key_benefit: "Tranquilidad con cuidadores verificados",
  pays_currently: "yes",
  alternatives: ["Grupos de WhatsApp", "Agencia Salud Ya"],
  competitors: null,
  search_channels: ["whatsapp_groups", "recommendations"],
  retention_channels: null,
  willingness_pct: 60,
  comments: "Necesito cuidadores verificados",
  signal_score: 80,
  total_score: null,
  quality_flags: [],
  contact_verified_at: "2026-10-11T14:05:00Z",
  verified_channel: "email",
  promo_code: "MLP-AAAAA-BBBBB",
  benefit_status: "available",
  premium_activated: false,
  redeemed_at: null,
  ...over,
});

describe("tabulate", () => {
  const rows: ResponseRow[] = [
    row({ id: "1" }),
    row({
      id: "2",
      profile_type: "ips_eps",
      pays_currently: "no",
      willingness_pct: 20,
      signal_score: 40,
      alternatives: ["whatsapp", "Computrabajo"],
      search_channels: ["job_boards"],
      city: "Medellín",
      contact_verified_at: null,
      promo_code: null,
      benefit_status: "none",
    }),
    row({
      id: "3",
      profile_type: "profesional",
      pays_currently: "not_researched",
      willingness_pct: 90,
      signal_score: 75,
      alternatives: [],
      search_channels: [],
      retention_channels: "Grupos de Facebook, voz a voz",
      city: "Bogotá",
      premium_activated: true,
      benefit_status: "redeemed",
      redeemed_at: "2026-10-10T12:00:00Z",
    }),
    row({
      id: "4",
      pays_currently: null,
      willingness_pct: null,
      signal_score: null,
      total_score: 24,
      alternatives: null,
      competitors: "1) Agencia Uno — bolsa general  2) Computrabajo — solo empleo",
      city: null,
      search_channels: null,
      created_at: "2026-09-01T10:00:00Z",
    }),
  ];
  const t = tabulate(rows, NOW);

  it("totales y verificación", () => {
    expect(t.total).toBe(4);
    expect(t.verified).toBe(3);
    expect(t.verifiedPct).toBe(75);
    expect(t.withBenefit).toBe(3);
    expect(t.redeemed).toBe(1);
  });

  it("señal y disposición a pagar ignoran lo que no se contestó", () => {
    // 80, 40, 75 y la antigua 24/30 = 80
    expect(t.avgSignal).toBe(68.8);
    expect(t.avgWtp).toBe(57);
    expect(t.medianWtp).toBe(60);
  });

  it("¿paga hoy? se cuenta sin las filas antiguas", () => {
    expect(t.pays).toEqual({ yes: 1, no: 1, not_researched: 1, unknown: 1 });
    expect(t.payingPct).toBe(33);
  });

  it("separa por perfil", () => {
    expect(t.byProfile.map((p) => p.profile)).toEqual([...PROFILES]);
    const fam = t.byProfile[0];
    expect(fam.count).toBe(2);
    expect(fam.pct).toBe(50);
    const ips = t.byProfile[1];
    expect(ips.count).toBe(1);
    expect(ips.pays.no).toBe(1);
    expect(ips.avgWtp).toBe(20);
    expect(t.byProfile[2].avgWtp).toBe(90);
  });

  it("reparte la disposición a pagar en tramos", () => {
    const by = Object.fromEntries(t.wtpBuckets.map((b) => [b.label, b.count]));
    expect(by).toEqual({
      "0 a 10 %": 0,
      "11 a 25 %": 1,
      "26 a 50 %": 0,
      "51 a 75 %": 1,
      "76 a 100 %": 1,
    });
  });

  it("une alternativas escritas distinto y entiende el texto antiguo", () => {
    const names = Object.fromEntries(t.topAlternatives.map((a) => [a.name, a.count]));
    expect(names["Grupos de WhatsApp"]).toBe(2); // «Grupos de WhatsApp» y «whatsapp»
    expect(names["Bolsas de empleo en línea"]).toBe(2); // «Computrabajo» en la fila 2 y en la antigua
    expect(names["Agencias de empleo o de enfermería"]).toBe(2); // «Agencia Salud Ya» y «Agencia Uno»
  });

  it("junta los canales marcados y los escritos", () => {
    const names = Object.fromEntries(t.topChannels.map((a) => [a.name, a.count]));
    expect(names["Grupos de WhatsApp"]).toBe(1);
    expect(names["Recomendaciones de conocidos"]).toBe(2); // chip + «voz a voz»
    expect(names["Grupos de Facebook"]).toBe(1);
    expect(names["Bolsas de empleo en línea"]).toBe(1);
  });

  it("extrae palabras del dolor sin palabras vacías y con tilde original", () => {
    const names = t.keywords.map((k) => k.name);
    expect(names).toContain("cuidadores");
    expect(names).toContain("verificados");
    expect(names).not.toContain("para");
    expect(names).not.toContain("humanix");
  });

  it("cuenta ciudades y respuestas por día (hora de Colombia, 14 días)", () => {
    expect(t.byCity[0]).toEqual({ name: "Bogotá", count: 2, pct: 50 });
    expect(t.daily).toHaveLength(14);
    expect(t.daily[13]).toEqual({ day: "2026-10-11", count: 3 });
    expect(t.daily.reduce((s, d) => s + d.count, 0)).toBe(3); // la del 1 de septiembre queda fuera
  });

  it("clasifica las señales en niveles", () => {
    expect(t.tiers).toEqual({ strong: 3, medium: 0, weak: 1 });
  });

  it("no revienta sin filas", () => {
    const e = tabulate([], NOW);
    expect(e.total).toBe(0);
    expect(e.avgSignal).toBe(0);
    expect(e.payingPct).toBe(0);
    expect(e.byProfile.every((p) => p.count === 0)).toBe(true);
  });
});

describe("nombres canónicos y texto antiguo", () => {
  it("canonicalName agrupa sinónimos y capitaliza lo demás", () => {
    expect(canonicalName("WhatsApp")).toBe("Grupos de WhatsApp");
    expect(canonicalName("grupos de facebook")).toBe("Grupos de Facebook");
    expect(canonicalName("elempleo.com")).toBe("Bolsas de empleo en línea");
    expect(canonicalName("mi vecina Rosa")).toBe("Mi vecina Rosa");
    expect(canonicalName("   ")).toBe("");
  });

  it("splitLegacyAlternatives separa «1) … 2) …» y recorta el diferencial", () => {
    expect(
      splitLegacyAlternatives("1) JobsInSalud — bolsa general. 2) Sanitas — solo empleados"),
    ).toEqual(["JobsInSalud", "Sanitas"]);
    expect(splitLegacyAlternatives(null)).toEqual([]);
  });
});

describe("filtros", () => {
  const rows = [
    row({ id: "a", full_name: "María Peña", profile_type: "familia", signal_score: 90 }),
    row({
      id: "b",
      full_name: "Clínica Norte",
      profile_type: "ips_eps",
      signal_score: 30,
      contact_verified_at: null,
    }),
    row({
      id: "c",
      full_name: "Luis",
      profile_type: "profesional",
      signal_score: 50,
      pain_point: "Pago tardío",
    }),
  ];
  it("por perfil, verificación, nivel y texto sin importar tildes", () => {
    expect(filterRows(rows, { profile: "ips_eps" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, { verified: "no" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, { verified: "yes" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterRows(rows, { tier: "strong" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, { q: "maria pena" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, { q: "PAGO tardio" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterRows(rows, { profile: "all", verified: "all", tier: "all" })).toHaveLength(3);
  });
});

describe("CSV para Excel", () => {
  it("lleva BOM, encabezados en español y celdas neutralizadas", () => {
    const csv = responsesToCsv([
      row({
        full_name: '=HYPERLINK("http://x")',
        alternatives: ["A", "B"],
        comments: "linea1\nlinea2",
      }),
    ]);
    expect(csv.startsWith("﻿Fecha;Perfil;Nombre;")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("A | B");
    expect(csv).toContain('"linea1\nlinea2"');
    expect(csv).toContain("Familia / Usuario");
    expect(csv).toContain("Disponible");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("nombra el archivo con la fecha de Colombia", () => {
    expect(responsesFilename("2026-10-12T03:00:00Z")).toBe("validacion-de-mercado-2026-10-11.csv");
  });
});

describe("apoyos de la interfaz", () => {
  it("adapta los ejemplos al perfil pero mantiene las preguntas", () => {
    const f = questionsFor("familia");
    const i = questionsFor("ips_eps");
    const p = questionsFor("profesional");
    expect(f.serviceOffer.label).toBe(i.serviceOffer.label);
    expect(f.serviceOffer.label).toBe(
      "¿Qué producto o servicio buscas contratar u ofrecer en Humanix?",
    );
    expect(f.serviceOffer.example).not.toBe(i.serviceOffer.example);
    expect(i.comments.example).toMatch(/1 hora/);
    expect(p.painPoint.example).toMatch(/WhatsApp/);
    expect(f.comments.example).toMatch(/antecedentes judiciales/);
  });

  it("ofrece sugerencias de alternativas por perfil", () => {
    for (const p of PROFILES) expect(ALTERNATIVE_SUGGESTIONS[p].length).toBeGreaterThanOrEqual(3);
  });

  it("las pistas de claridad suben con el detalle", () => {
    expect(clarityHint("", { min: 5, good: 12 }).level).toBe("idle");
    expect(clarityHint("necesito ayuda", { min: 5, good: 12 }).level).toBe("short");
    expect(clarityHint("necesito ayuda con mi mamá de noche", { min: 5, good: 12 }).level).toBe(
      "ok",
    );
    expect(
      clarityHint(
        "necesito una auxiliar de enfermería para mi mamá de setenta años que vive sola en Bogotá",
        { min: 5, good: 12 },
      ).level,
    ).toBe("great");
  });

  it("explica el porcentaje en lenguaje claro", () => {
    expect(wtpSentence(undefined)).toMatch(/Elige/);
    expect(wtpSentence(0)).toMatch(/Nadie/);
    expect(wtpSentence(100)).toMatch(/Todas/);
    expect(wtpSentence(60)).toBe("Más o menos 6 de cada 10 personas pagarían por esto.");
  });

  it("cuenta palabras con tildes y números", () => {
    expect(countWords("  Auxiliar de enfermería, 12 horas  ")).toBe(5);
    expect(countWords("")).toBe(0);
  });

  it("la mediana funciona con pares e impares", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("el beneficio es 1 mes del plan Esencial (el básico de pago)", () => {
    expect(BENEFIT.plan).toBe("essential_monthly");
    expect(BENEFIT.months).toBe(1);
    expect(CHANNEL_VALUES.length).toBeGreaterThanOrEqual(8);
  });
});
