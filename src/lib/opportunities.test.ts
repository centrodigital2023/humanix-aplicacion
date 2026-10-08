import { describe, it, expect } from "vitest";
import { guardOutgoing } from "../../supabase/functions/_shared/paymentGuard";
import {
  DEFAULT_FILTERS,
  parseList,
  bogotaToday,
  buildProContext,
  alertMatchesShift,
  applyFilters,
  classifyHubError,
  distinctCities,
  groupShiftsByDay,
  isShiftApplied,
  splitOpenNeedRows,
  type OpenNeedRow,
  buildApplicationDraft,
  buildFamilyOutreachMessage,
  canRevealContact,
  checkOutgoingMessage,
  displayName,
  estimatedTotal,
  formatShiftRange,
  groupNeedsIntoShifts,
  hasContactInfo,
  hoursBetween,
  rankShifts,
  redactContactInfo,
  scoreShift,
  summarizeOpportunities,
  toWhatsAppNumber,
  urgencyOf,
  whatsAppLink,
  type NeedBlock,
  type ProContext,
  type Shift,
} from "./opportunities";

const HOUR = 3_600_000;
// Lunes 12 de octubre de 2026, 10:00 en Bogotá (UTC-5).
const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
const block = (startOffsetH: number, hours = 1, o: Partial<NeedBlock> = {}): NeedBlock => ({
  id: `b${++seq}`,
  family_user_id: "fam-1",
  display_name: "María G.",
  city: "Bogotá",
  care_type: null,
  starts_at: iso(NOW + startOffsetH * HOUR),
  ends_at: iso(NOW + (startOffsetH + hours) * HOUR),
  hourly_rate: 20000,
  notes_public: null,
  status: "open",
  ...o,
});

const pro = (o: Partial<ProContext> = {}): ProContext => ({
  specialty: "Enfermería",
  subSpecialties: [],
  cities: ["Bogotá"],
  hourlyRate: 20000,
  busy: [],
  ...o,
});

const shiftOf = (o: Partial<Shift> = {}): Shift => ({
  key: "fam-1:b0",
  family_user_id: "fam-1",
  display_name: "María G.",
  city: "Bogotá",
  care_type: null,
  need_ids: ["b0"],
  starts_at: iso(NOW + 8 * HOUR),
  ends_at: iso(NOW + 14 * HOUR),
  hours: 6,
  rate_min: 20000,
  rate_max: 20000,
  rate_avg: 20000,
  notes: [],
  ...o,
});

describe("redactContactInfo", () => {
  it("oculta teléfonos en distintos formatos", () => {
    expect(redactContactInfo("Llámame al 300 123 4567 por favor")).toBe(
      "Llámame al [contacto oculto] por favor",
    );
    expect(redactContactInfo("WhatsApp +57 3001234567")).toBe("WhatsApp [contacto oculto]");
    expect(redactContactInfo("al (300) 123-4567")).toBe("al [contacto oculto]");
    expect(redactContactInfo("3001234567")).toBe("[contacto oculto]");
  });

  it("oculta correos, enlaces y @usuarios", () => {
    expect(redactContactInfo("escribe a ana.perez@gmail.com")).toBe("escribe a [contacto oculto]");
    expect(redactContactInfo("mira https://wa.me/573001234567 ahora")).toBe(
      "mira [enlace oculto] ahora",
    );
    expect(redactContactInfo("entra a www.misitio.com/x")).toBe("entra a [enlace oculto]");
    expect(redactContactInfo("mi instagram @ana_cuida")).toBe("mi instagram [contacto oculto]");
  });

  it("oculta direcciones exactas pero deja el barrio", () => {
    expect(redactContactInfo("Vivimos en la Calle 45 # 12-34, barrio Chapinero")).toBe(
      "Vivimos en la [dirección oculta], barrio Chapinero",
    );
    expect(redactContactInfo("Carrera 7 No. 45-10 apto 301")).toBe(
      "[dirección oculta] [dirección oculta]",
    );
    expect(redactContactInfo("Conjunto Los Alpes torre 3")).toBe(
      "[dirección oculta] [dirección oculta]",
    );
  });

  it("no toca texto clínico o cotidiano", () => {
    const ok = [
      "Necesito cuidado nocturno para mi mamá en Chapinero, Bogotá",
      "Turno de 12 horas con paciente de 82 años con oxígeno",
      "Cuidado en casa de mi madre, sin mascotas",
      "Presión 120/80 y glucosa 98",
    ];
    for (const t of ok) expect(redactContactInfo(t)).toBe(t);
  });

  it("es seguro con null/undefined y detecta si hubo datos", () => {
    expect(redactContactInfo(null)).toBe("");
    expect(redactContactInfo(undefined)).toBe("");
    expect(hasContactInfo("llama al 3001234567")).toBe(true);
    expect(hasContactInfo("sin datos de contacto")).toBe(false);
  });
});

describe("displayName", () => {
  it("usa nombre e inicial del último apellido", () => {
    expect(displayName("María Fernanda Gómez Ruiz")).toBe("María R.");
    expect(displayName("  luis   pérez ")).toBe("luis P.");
    expect(displayName("Ana")).toBe("Ana");
  });
  it("no expone correos ni nulos", () => {
    expect(displayName("juan@correo.com")).toBe("Familia");
    expect(displayName(null)).toBe("Familia");
    expect(displayName("")).toBe("Familia");
  });
});

describe("checkOutgoingMessage", () => {
  it("acepta texto limpio y lo recorta", () => {
    expect(checkOutgoingMessage("  Puedo cubrir el turno completo.  ")).toEqual({
      ok: true,
      text: "Puedo cubrir el turno completo.",
    });
  });
  it("exige texto cuando es obligatorio", () => {
    expect(checkOutgoingMessage("  ", { required: true })).toEqual({ ok: false, reason: "empty" });
    expect(checkOutgoingMessage("  ")).toEqual({ ok: true, text: "" });
  });
  it("bloquea contacto, pagos y textos largos", () => {
    expect(checkOutgoingMessage("Mi número es 3001234567")).toEqual({
      ok: false,
      reason: "contact_info",
    });
    expect(checkOutgoingMessage("Te hago una transferencia a mi cuenta")).toEqual({
      ok: false,
      reason: "payment_instruction",
    });
    expect(checkOutgoingMessage("a".repeat(501))).toEqual({ ok: false, reason: "too_long" });
  });
  it("quita caracteres de control", () => {
    expect(checkOutgoingMessage("hola\u0000 mundo")).toEqual({ ok: true, text: "hola mundo" });
  });
});

describe("groupNeedsIntoShifts", () => {
  it("une horas contiguas de una misma familia en un turno", () => {
    const shifts = groupNeedsIntoShifts([block(8), block(9), block(10)]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].hours).toBe(3);
    expect(shifts[0].need_ids).toHaveLength(3);
    expect(shifts[0].rate_avg).toBe(20000);
  });

  it("no salta huecos ni mezcla familias", () => {
    const shifts = groupNeedsIntoShifts([
      block(8),
      block(10),
      block(8, 1, { family_user_id: "fam-2", display_name: "Luis P." }),
      block(9, 1, { family_user_id: "fam-2", display_name: "Luis P." }),
    ]);
    expect(shifts).toHaveLength(3);
    expect(shifts.filter((s) => s.family_user_id === "fam-2")[0].hours).toBe(2);
  });

  it("promedia la tarifa ponderando por horas", () => {
    const [s] = groupNeedsIntoShifts([
      block(8, 2, { hourly_rate: 20000 }),
      block(10, 1, { hourly_rate: 32000 }),
    ]);
    expect(s.rate_min).toBe(20000);
    expect(s.rate_max).toBe(32000);
    expect(s.rate_avg).toBe(24000);
  });

  it("parte los turnos largos en máximo 24 h", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => block(8 + i));
    const shifts = groupNeedsIntoShifts(blocks);
    expect(shifts.map((s) => s.hours)).toEqual([24, 6]);
  });

  it("ignora bloques cerrados o con horario inválido y deduplica notas", () => {
    const shifts = groupNeedsIntoShifts([
      block(8, 1, { notes_public: "Paciente con oxígeno" }),
      block(9, 1, { notes_public: "Paciente con oxígeno" }),
      block(10, 1, { status: "matched" }),
      { ...block(12), ends_at: iso(NOW + 12 * HOUR) },
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].notes).toEqual(["Paciente con oxígeno"]);
  });

  it("deja la tarifa en null si ningún bloque la trae", () => {
    const [s] = groupNeedsIntoShifts([block(8, 1, { hourly_rate: null })]);
    expect(s.rate_avg).toBeNull();
    expect(estimatedTotal(s.rate_avg, s.hours)).toBeNull();
  });
});

describe("tiempo y horarios", () => {
  it("calcula horas y total estimado", () => {
    expect(hoursBetween(iso(NOW), iso(NOW + 90 * 60_000))).toBe(1.5);
    expect(hoursBetween(iso(NOW), iso(NOW - HOUR))).toBe(0);
    expect(estimatedTotal(20000, 12)).toBe(240000);
  });

  it("clasifica la urgencia en hora de Bogotá", () => {
    expect(urgencyOf(iso(NOW + 3 * HOUR), NOW)).toBe("now");
    expect(urgencyOf(iso(NOW - HOUR), NOW)).toBe("now");
    expect(urgencyOf(iso(NOW + 8 * HOUR), NOW)).toBe("today");
    expect(urgencyOf(iso(Date.UTC(2026, 9, 13, 14, 0)), NOW)).toBe("tomorrow");
    expect(urgencyOf(iso(Date.UTC(2026, 9, 16, 14, 0)), NOW)).toBe("week");
    expect(urgencyOf(iso(Date.UTC(2026, 9, 25, 14, 0)), NOW)).toBe("later");
    // 23:00 en Bogotá: un turno a las 07:00 del día siguiente es «mañana», no «hoy».
    const lateNow = Date.UTC(2026, 9, 13, 4, 0);
    expect(urgencyOf(iso(Date.UTC(2026, 9, 13, 12, 0)), lateNow)).toBe("tomorrow");
    expect(urgencyOf("no-es-fecha", NOW)).toBe("later");
  });

  it("formatea el rango sin depender del ICU del equipo", () => {
    expect(
      formatShiftRange(iso(Date.UTC(2026, 9, 12, 23, 0)), iso(Date.UTC(2026, 9, 13, 11, 0))),
    ).toBe("lun 12 oct · 18:00–06:00 (12 h)");
    expect(formatShiftRange(iso(NOW), iso(NOW + 90 * 60_000))).toBe(
      "lun 12 oct · 10:00–11:30 (1.5 h)",
    );
    expect(formatShiftRange("x", "y")).toBe("Horario por definir");
  });
});

describe("scoreShift", () => {
  it("da 100 a un turno perfecto y explica por qué", () => {
    const m = scoreShift(
      shiftOf({ care_type: "Adulto mayor con oxígeno", rate_avg: 25000, rate_max: 25000 }),
      pro(),
      { stars: 4.8, ratings: 12 },
    );
    expect(m.score).toBe(100);
    expect(m.label).toBe("Excelente");
    expect(m.conflict).toBe(false);
    expect(m.reasons.join(" | ")).toMatch(/zona de servicio/);
    expect(m.reasons.join(" | ")).toMatch(/especialidad/);
    expect(m.warnings).toEqual([]);
  });

  it("detecta cruces con servicios confirmados y limita el puntaje", () => {
    const s = shiftOf();
    const m = scoreShift(
      s,
      pro({ busy: [{ start: iso(NOW + 10 * HOUR), end: iso(NOW + 20 * HOUR) }] }),
      { stars: 5, ratings: 20 },
    );
    expect(m.conflict).toBe(true);
    expect(m.score).toBeLessThanOrEqual(40);
    expect(m.warnings.join(" ")).toMatch(/cruza/);
  });

  it("un turno que termina justo cuando empieza otro no es cruce", () => {
    const s = shiftOf();
    const m = scoreShift(s, pro({ busy: [{ start: s.ends_at, end: iso(NOW + 20 * HOUR) }] }));
    expect(m.conflict).toBe(false);
  });

  it("avisa cuando está fuera de tus ciudades o paga menos que tu tarifa", () => {
    const m = scoreShift(
      shiftOf({ city: "Medellín", rate_avg: 15000, rate_max: 15000 }),
      pro({ hourlyRate: 20000 }),
    );
    expect(m.warnings.join(" | ")).toMatch(/Fuera de tus ciudades/);
    expect(m.warnings.join(" | ")).toMatch(/25% menos/);
  });

  it("no penaliza a una familia sin historial ni a un pro sin tarifa", () => {
    const withNew = scoreShift(shiftOf(), pro(), { stars: null, ratings: 1 });
    const withNone = scoreShift(shiftOf(), pro(), null);
    expect(withNew.score).toBe(withNone.score);
    const noRate = scoreShift(shiftOf(), pro({ hourlyRate: null }));
    expect(noRate.score).toBeGreaterThan(0);
  });

  it("advierte de familias con calificación baja", () => {
    const m = scoreShift(shiftOf(), pro(), { stars: 2.9, ratings: 6 });
    expect(m.warnings.join(" ")).toMatch(/calificación baja/);
  });
});

describe("rankShifts y resumen", () => {
  it("ordena por compatibilidad y deja los cruces al final", () => {
    const good = shiftOf({ key: "a", family_user_id: "a", care_type: "Enfermería" });
    const worse = shiftOf({
      key: "b",
      family_user_id: "b",
      city: "Cali",
      rate_avg: 12000,
      rate_max: 12000,
    });
    const clash = shiftOf({ key: "c", family_user_id: "c", care_type: "Enfermería" });
    const busy = pro({ busy: [{ start: iso(NOW), end: iso(NOW + 9 * HOUR) }] });
    // Con la agenda ocupada los tres turnos se cruzan: todos quedan marcados.
    expect(rankShifts([worse, clash, good], busy, {}, NOW).every((r) => r.match.conflict)).toBe(
      true,
    );
    const free = rankShifts([worse, good, clash], pro(), {}, NOW);
    expect(free.map((r) => r.shift.key)).toEqual(["a", "c", "b"]);
    expect(free[0].urgency).toBe("today");
    // Un turno en conflicto baja al final aunque tenga mejor puntaje base.
    const later = shiftOf({
      ...worse,
      starts_at: iso(NOW + 30 * HOUR),
      ends_at: iso(NOW + 36 * HOUR),
    });
    const mixed = rankShifts(
      [good, later],
      pro({ busy: [{ start: good.starts_at, end: good.ends_at }] }),
      {},
      NOW,
    );
    expect(mixed.map((r) => r.shift.key)).toEqual(["b", "a"]);
  });

  it("resume horas y ganancias potenciales sin contar los cruces", () => {
    const a = shiftOf({ key: "a", hours: 6, rate_avg: 20000 });
    const b = shiftOf({ key: "b", hours: 4, rate_avg: 25000, starts_at: iso(NOW + 2 * HOUR) });
    const ranked = rankShifts([a, b], pro(), {}, NOW);
    const sum = summarizeOpportunities(ranked);
    expect(sum).toEqual({
      shifts: 2,
      hours: 10,
      potentialEarnings: 220000,
      urgent: 2,
      conflicts: 0,
    });
  });
});

describe("alertMatchesShift", () => {
  const alert = {
    cities: ["Bogotá"],
    care_types: ["adulto mayor"],
    min_rate: 18000,
    urgent_only: false,
  };
  it("coincide cuando se cumplen todos los criterios", () => {
    const s = shiftOf({ care_type: "Cuidado de adulto mayor", rate_max: 20000, hours: 6 });
    expect(alertMatchesShift(alert, s, NOW)).toBe(true);
  });
  it("falla si cambia ciudad, tipo o tarifa", () => {
    const base = shiftOf({ care_type: "Cuidado de adulto mayor", rate_max: 20000, hours: 6 });
    expect(alertMatchesShift(alert, { ...base, city: "Cali" }, NOW)).toBe(false);
    expect(alertMatchesShift(alert, { ...base, care_type: "Pediatría" }, NOW)).toBe(false);
    expect(alertMatchesShift(alert, { ...base, rate_max: 15000 }, NOW)).toBe(false);
  });
  it("urgent_only solo deja pasar lo de hoy o inmediato", () => {
    const base = shiftOf({ care_type: "adulto mayor", rate_max: 20000, hours: 6 });
    const urgent = { ...alert, urgent_only: true };
    expect(alertMatchesShift(urgent, base, NOW)).toBe(true);
    expect(
      alertMatchesShift(urgent, { ...base, starts_at: iso(Date.UTC(2026, 9, 20, 14)) }, NOW),
    ).toBe(false);
  });
  it("sin filtros coincide con todo", () => {
    expect(
      alertMatchesShift(
        { cities: [], care_types: [], min_rate: null, urgent_only: false },
        shiftOf(),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("postulación y primer contacto", () => {
  it("el borrador de postulación es válido para enviar", () => {
    const draft = buildApplicationDraft(shiftOf(), {
      name: "Laura Gómez Ruiz",
      specialty: "Enfermería",
      yearsExperience: 6,
      rethusVerified: true,
    });
    expect(draft).toMatch(
      /^Hola, soy Laura, enfermería con 6 años de experiencia y registro RETHUS verificado\./,
    );
    expect(checkOutgoingMessage(draft, { required: true }).ok).toBe(true);
  });

  it("el borrador funciona con perfiles incompletos", () => {
    const draft = buildApplicationDraft(shiftOf(), {
      name: null,
      specialty: null,
      yearsExperience: 1,
      rethusVerified: false,
    });
    expect(draft).toMatch(/^Hola, soy un profesional de Humanix con 1 año de experiencia\./);
  });

  it("normaliza números de WhatsApp colombianos", () => {
    expect(toWhatsAppNumber("300 123 4567")).toBe("573001234567");
    expect(toWhatsAppNumber("+57 300 1234567")).toBe("573001234567");
    expect(toWhatsAppNumber("573001234567")).toBe("573001234567");
    expect(toWhatsAppNumber("123")).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });

  it("arma un mensaje de WhatsApp que pasa la barrera de pagos", () => {
    const msg = buildFamilyOutreachMessage({
      familyName: "María Gómez",
      proName: "Laura Ruiz",
      shift: shiftOf(),
    });
    expect(msg).toMatch(/^Hola María, soy Laura de Humanix\./);
    expect(msg).toMatch(/pagos se gestionan únicamente en la página web/);
    expect(guardOutgoing(msg, "x", ["humanix.lat"]).blocked).toBe(false);
    const link = whatsAppLink("300 123 4567", msg);
    expect(link?.startsWith("https://wa.me/573001234567?text=")).toBe(true);
    expect(whatsAppLink("abc", msg)).toBeNull();
  });
});

describe("canRevealContact", () => {
  it("Free nunca puede desbloquear: lo bloquea el plan", () => {
    expect(canRevealContact({ plan: "free", hasApplied: true, revealsToday: 0 })).toEqual({
      allowed: false,
      blockedBy: "plan",
      remaining: 0,
    });
    expect(canRevealContact({ plan: null, hasApplied: true, revealsToday: 0 }).blockedBy).toBe(
      "plan",
    );
  });
  it("exige postularse primero y respeta el cupo diario", () => {
    expect(
      canRevealContact({ plan: "essential_monthly", hasApplied: false, revealsToday: 0 }),
    ).toEqual({
      allowed: false,
      blockedBy: "not_applied",
      remaining: 15,
    });
    expect(
      canRevealContact({ plan: "essential_monthly", hasApplied: true, revealsToday: 15 }),
    ).toEqual({
      allowed: false,
      blockedBy: "quota",
      remaining: 0,
    });
    expect(canRevealContact({ plan: "pro_monthly", hasApplied: true, revealsToday: 1 })).toEqual({
      allowed: true,
      blockedBy: null,
      remaining: 39,
    });
  });
});

const row = (o: Partial<OpenNeedRow> = {}): OpenNeedRow => ({
  id: `r${++seq}`,
  family_user_id: "fam-1",
  display_name: "María R.",
  city: "Bogotá",
  care_type: "Adulto mayor",
  starts_at: iso(NOW + 8 * HOUR),
  ends_at: iso(NOW + 9 * HOUR),
  hourly_rate: 20000,
  notes_public: null,
  created_at: iso(NOW - HOUR),
  already_applied: false,
  family_stars: null,
  family_ratings: 0,
  family_completed: 0,
  ...o,
});

describe("splitOpenNeedRows", () => {
  it("separa bloques, reputación por familia y horas ya postuladas", () => {
    const rows = [
      row({
        id: "a",
        already_applied: true,
        family_stars: "4.67",
        family_ratings: 3,
        family_completed: 5,
      }),
      row({ id: "b" }),
      row({ id: "c", family_user_id: "fam-2", family_stars: null, family_ratings: null }),
    ];
    const { blocks, families, appliedNeedIds } = splitOpenNeedRows(rows);
    expect(blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(blocks.every((b) => b.status === "open")).toBe(true);
    expect(families["fam-1"]).toEqual({ stars: 4.67, ratings: 3, completed: 5 });
    expect(families["fam-2"]).toEqual({ stars: null, ratings: 0, completed: 0 });
    expect([...appliedNeedIds]).toEqual(["a"]);
  });

  it("un turno cuenta como postulado si alguna de sus horas lo está", () => {
    const shift = shiftOf({ need_ids: ["x", "y"] });
    expect(isShiftApplied(shift, new Set(["y"]))).toBe(true);
    expect(isShiftApplied(shift, new Set(["z"]))).toBe(false);
  });
});

describe("applyFilters y vistas", () => {
  const mk = (key: string, o: Partial<Shift>, conflict = false) => ({
    shift: shiftOf({ key, family_user_id: key, ...o }),
    match: { score: 50, label: "Posible" as const, reasons: [], warnings: [], conflict },
    urgency: urgencyOf((o.starts_at as string) ?? iso(NOW + 8 * HOUR), NOW),
  });
  const items = [
    mk("a", { city: "Bogotá", care_type: "Adulto mayor", rate_max: 20000, rate_avg: 20000 }),
    mk("b", {
      city: "Medellín",
      care_type: "Pediatría",
      rate_max: 30000,
      rate_avg: 30000,
      hours: 2,
    }),
    mk(
      "c",
      {
        city: "Bogotá",
        care_type: null,
        notes: ["Paciente con oxígeno"],
        starts_at: iso(NOW + 5 * 24 * HOUR),
        rate_max: 15000,
        rate_avg: 15000,
      },
      true,
    ),
  ];

  it("filtra por ciudad (sin tildes ni mayúsculas), texto, tarifa, urgencia y cruces", () => {
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, city: "bogota" }).map((r) => r.shift.key),
    ).toEqual(["a", "c"]);
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, query: "OXÍGENO" }).map((r) => r.shift.key),
    ).toEqual(["c"]);
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, minRate: 25000 }).map((r) => r.shift.key),
    ).toEqual(["b"]);
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, urgentOnly: true }).map((r) => r.shift.key),
    ).toEqual(["a", "b"]);
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, hideConflicts: true }).map((r) => r.shift.key),
    ).toEqual(["a", "b"]);
  });

  it("ordena por cercanía o por pago total", () => {
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, sort: "soonest" }).map((r) => r.shift.key),
    ).toEqual(["a", "b", "c"]);
    // a: 6 h × 20.000 = 120.000; b: 6 h × 30.000 = 180.000 (hours manual = 2 → 60.000); c: 6 h × 15.000 = 90.000
    expect(
      applyFilters(items, { ...DEFAULT_FILTERS, sort: "pay" }).map((r) => r.shift.key),
    ).toEqual(["a", "c", "b"]);
  });

  it("lista las ciudades una sola vez y ordenadas", () => {
    const shifts = [
      ...items.map((i) => i.shift),
      shiftOf({ city: "BOGOTA" }),
      shiftOf({ city: null }),
    ];
    expect(distinctCities(shifts)).toEqual(["Bogotá", "Medellín"]);
  });

  it("agrupa por día de inicio en hora de Colombia", () => {
    const night = {
      shift: shiftOf({
        key: "n",
        starts_at: iso(Date.UTC(2026, 9, 13, 3, 0)), // 22:00 del 12 de octubre en Bogotá
        ends_at: iso(Date.UTC(2026, 9, 13, 11, 0)),
      }),
    };
    const morning = { shift: shiftOf({ key: "m", starts_at: iso(Date.UTC(2026, 9, 13, 13, 0)) }) }; // 08:00 del 13
    const groups = groupShiftsByDay([morning, night]);
    expect(groups.map((g) => g.label)).toEqual(["lun 12 oct", "mar 13 oct"]);
    expect(groups[0].items[0].shift.key).toBe("n");
    expect(groups[1].items[0].shift.key).toBe("m");
  });
});

describe("classifyHubError", () => {
  it("reconoce cada caso por la pista del servidor", () => {
    expect(classifyHubError({ hint: "plan_required", message: "x" }).kind).toBe("plan_required");
    expect(classifyHubError({ hint: "negotiate_rate_requires_plan" }).kind).toBe("negotiate_plan");
    expect(classifyHubError({ hint: "application_required" }).kind).toBe("application_required");
    expect(classifyHubError({ hint: "quota_exceeded" }).kind).toBe("quota");
  });
  it("y por código o texto cuando no hay pista", () => {
    expect(classifyHubError({ code: "23505" }).kind).toBe("duplicate");
    expect(classifyHubError({ code: "23P01" }).kind).toBe("conflict");
    expect(classifyHubError({ message: "La oferta venció" }).kind).toBe("unavailable");
    expect(classifyHubError({ message: "Alguna de las horas ya no está disponible" }).kind).toBe(
      "unavailable",
    );
    expect(classifyHubError({ message: "No incluyas teléfonos, correos…" }).kind).toBe(
      "forbidden_content",
    );
    expect(classifyHubError({ message: "boom" })).toEqual({ kind: "other", message: "boom" });
    expect(classifyHubError(null).message).toMatch(/Inténtalo de nuevo/);
  });
});

describe("contexto del profesional", () => {
  it("une ciudades de servicio, base y perfil, y convierte reservas en intervalos ocupados", () => {
    const ctx = buildProContext({
      specialty: "Enfermería",
      sub_specialties: null,
      service_cities: ["Bogotá", "Soacha"],
      home_city: "Bogotá",
      hourly_rate: 22000,
      profileCity: "Chía",
      bookings: [
        { scheduled_at: iso(NOW), duration_hours: "2.50" },
        { scheduled_at: "no-es-fecha", duration_hours: 2 },
        { scheduled_at: iso(NOW), duration_hours: 0 },
      ],
    });
    expect(ctx.cities).toEqual(["Bogotá", "Soacha", "Bogotá", "Chía"]);
    expect(ctx.subSpecialties).toEqual([]);
    expect(ctx.hourlyRate).toBe(22000);
    expect(ctx.busy).toEqual([{ start: iso(NOW), end: iso(NOW + 2.5 * HOUR) }]);
  });

  it("sin tarifa válida deja null y tolera datos vacíos", () => {
    const ctx = buildProContext({
      specialty: null,
      sub_specialties: [],
      service_cities: null,
      home_city: null,
      hourly_rate: 0,
      profileCity: null,
      bookings: [],
    });
    expect(ctx).toEqual({
      specialty: null,
      subSpecialties: [],
      cities: [],
      hourlyRate: null,
      busy: [],
    });
  });

  it("«hoy» se calcula en hora de Bogotá", () => {
    // 03:00 UTC del 13 de octubre = 22:00 del 12 en Colombia.
    expect(bogotaToday(Date.UTC(2026, 9, 13, 3, 0))).toBe("2026-10-12");
    expect(bogotaToday(Date.UTC(2026, 9, 13, 5, 0))).toBe("2026-10-13");
  });
});

describe("parseList", () => {
  it("separa por coma, punto y coma o salto de línea, sin vacíos ni repetidos", () => {
    expect(parseList("Bogotá, soacha;  BOGOTA\n, ,Chía")).toEqual(["Bogotá", "soacha", "Chía"]);
  });
  it("respeta el tope de elementos y de longitud", () => {
    expect(parseList("a,b,c,d", { max: 2 })).toEqual(["a", "b"]);
    expect(parseList("x".repeat(60), { maxLen: 10 })).toEqual(["xxxxxxxxxx"]);
    expect(parseList("")).toEqual([]);
  });
});
