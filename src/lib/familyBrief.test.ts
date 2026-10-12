import { describe, expect, it } from "vitest";
import {
  APPLICATION_STALE_HOURS,
  PROPOSAL_URGENT_HOURS,
  RATING_WINDOW_DAYS,
  briefHeadline,
  buildFamilyBrief,
  heroStats,
  whenEs,
  type BriefItem,
} from "./familyBrief";
import { calmScore, heroTone, splitVisible } from "./dayHero";
import {
  DAY,
  HOUR,
  NOW,
  briefApplication,
  briefProposal,
  briefService,
  iso,
  mulberry32,
  snapshot,
} from "./familyIntel.fixture";

const ids = (items: BriefItem[]) => items.map((i) => i.id);
const brief = (over: Parameters<typeof snapshot>[0] = {}) => buildFamilyBrief(snapshot(over));
const one = (items: BriefItem[], idPrefix: string) => items.find((i) => i.id.startsWith(idPrefix))!;

describe("una familia sin nada pendiente", () => {
  it("con plan de pago no hay nada que decir", () => {
    const items = brief({ premium: true });
    expect(items).toEqual([]);
    expect(briefHeadline(items)).toEqual({ text: "Todo en orden por ahora", tone: "calm" });
  });

  it("sin plan solo se le invita a conocer el plan Esencial", () => {
    const items = brief();
    expect(ids(items)).toEqual(["upgrade"]);
    expect(items[0]).toMatchObject({ priority: "low", cta: { target: { kind: "plans" } } });
    expect(items[0].detail).toMatch(/tendencias de ánimo/);
  });

  it("una cuenta nueva sin actividad no recibe la invitación, sino el primer paso", () => {
    const items = brief({ completedServices: 0, teamSize: 0, circleMembers: 0 });
    expect(ids(items)).toEqual(["first_request"]);
    expect(items[0]).toMatchObject({
      priority: "medium",
      cta: { label: "Buscar cuidado", target: { kind: "search" } },
    });
  });

  it("el primer paso desaparece en cuanto hay cualquier cosa en marcha", () => {
    const base = { completedServices: 0, teamSize: 0, circleMembers: 0 };
    expect(ids(brief({ ...base, proposals: [briefProposal()] }))).not.toContain("first_request");
    expect(
      ids(brief({ ...base, applications: [briefApplication({ status: "accepted" })] })),
    ).not.toContain("first_request");
    expect(
      ids(
        brief({
          ...base,
          gaps: [{ startsAt: iso(2 * DAY), endsAt: iso(2 * DAY + HOUR), hours: 1, level: "low" }],
        }),
      ),
    ).not.toContain("first_request");
  });
});

describe("turnos", () => {
  it("una alerta en un turno en curso es lo más urgente y va primero", () => {
    const svc = briefService({ bookingId: "s1", alerts: 2 });
    const items = brief({ premium: true, services: [svc], applications: [briefApplication()] });
    expect(items[0]).toMatchObject({
      id: "service_alert:s1",
      priority: "critical",
      title: "Alerta en el turno de Laura",
      detail: "2 alertas registradas en el parte de hoy. Revísalo ahora.",
      cta: { label: "Ver el parte", target: { kind: "service", bookingId: "s1" } },
    });
    expect(briefHeadline(items)).toEqual({
      text: "1 cosa urgente para mirar ahora",
      tone: "alert",
    });
  });

  it("la alerta singular se dice en singular; la del círculo nombra al titular", () => {
    expect(brief({ services: [briefService({ alerts: 1 })] })[0].detail).toBe(
      "1 alerta registrada en el parte de hoy. Revísalo ahora.",
    );
    const circle = brief({
      services: [briefService({ side: "circle", alerts: 1, ownerName: "María" })],
    })[0];
    expect(circle.title).toBe("Alerta en el servicio de María");
    const anonymous = brief({
      services: [briefService({ side: "circle", alerts: 1, ownerName: null })],
    })[0];
    expect(anonymous.title).toBe("Alerta en el servicio de tu familiar");
  });

  it("un turno en curso sin alertas es solo un dato tranquilizador", () => {
    const own = one(
      brief({ premium: true, services: [briefService({ bookingId: "s1" })] }),
      "service_live",
    );
    expect(own).toMatchObject({
      priority: "low",
      title: "Turno en curso con Laura",
      cta: { label: "Ver el parte en vivo" },
    });
    const circle = one(
      brief({
        premium: true,
        services: [briefService({ bookingId: "s2", side: "circle", ownerName: "Pedro" })],
      }),
      "service_live",
    );
    expect(circle.title).toBe("Servicio en curso de Pedro");
  });

  it("un servicio confirmado de las próximas 24 horas se anuncia con la hora", () => {
    const today = one(
      brief({ services: [briefService({ status: "confirmed", scheduledAt: iso(5 * HOUR) })] }),
      "service_soon",
    );
    expect(today.title).toBe("Laura llega hoy a las 15:00");
    const tomorrow = one(
      brief({ services: [briefService({ status: "confirmed", scheduledAt: iso(20 * HOUR) })] }),
      "service_soon",
    );
    expect(tomorrow.title).toBe("Laura llega mañana a las 06:00");
  });

  it("no se anuncia lo que está lejos, lo que ya pasó ni los servicios del círculo", () => {
    const far = brief({
      services: [briefService({ status: "confirmed", scheduledAt: iso(25 * HOUR) })],
    });
    const past = brief({
      services: [briefService({ status: "confirmed", scheduledAt: iso(-HOUR) })],
    });
    const circle = brief({
      services: [briefService({ status: "confirmed", side: "circle", scheduledAt: iso(5 * HOUR) })],
    });
    for (const items of [far, past, circle])
      expect(ids(items).some((i) => i.startsWith("service_soon"))).toBe(false);
    // justo en el límite sí
    const edge = brief({
      services: [briefService({ status: "confirmed", scheduledAt: iso(24 * HOUR) })],
    });
    expect(ids(edge).some((i) => i.startsWith("service_soon"))).toBe(true);
  });

  it("«en camino» se avisa aunque la hora ya haya pasado", () => {
    const items = brief({
      services: [briefService({ status: "in_route", scheduledAt: iso(-20 * 60_000) })],
    });
    expect(one(items, "service_soon").title).toBe("Laura va en camino");
  });

  it("sin nombre del profesional usa «tu profesional»", () => {
    expect(brief({ services: [briefService({ alerts: 1, counterpartName: "  " })] })[0].title).toBe(
      "Alerta en el turno de tu profesional",
    );
    expect(brief({ services: [briefService({ alerts: 1, counterpartName: null })] })[0].title).toBe(
      "Alerta en el turno de tu profesional",
    );
  });
});

describe("propuestas de profesionales", () => {
  it("la que vence en pocas horas pide respuesta ya y dice cuánto falta", () => {
    const items = brief({
      proposals: [briefProposal({ expiresAt: iso(3 * HOUR), peerName: "Marta" })],
    });
    expect(one(items, "proposal_expiring")).toMatchObject({
      priority: "high",
      title: "Responde antes de que venza: Marta",
      detail: "Vence en 3 h. Si no respondes, se pierde.",
      cta: { label: "Ver propuestas", target: { kind: "proposals" } },
    });
  });

  it("la frontera es exacta: 6 h es urgente, 6 h y un instante ya no", () => {
    const at = (offset: number) =>
      ids(brief({ proposals: [briefProposal({ expiresAt: iso(offset) })] }));
    expect(at(PROPOSAL_URGENT_HOURS * HOUR)).toEqual(["proposal_expiring", "upgrade"]);
    expect(at(PROPOSAL_URGENT_HOURS * HOUR + 1)).toEqual(["proposals_waiting", "upgrade"]);
  });

  it("varias por vencer se agrupan y nombran la primera", () => {
    const items = brief({
      proposals: [
        briefProposal({ expiresAt: iso(4 * HOUR) }),
        briefProposal({ expiresAt: iso(90 * 60_000) }),
      ],
    });
    const item = one(items, "proposal_expiring");
    expect(item.title).toBe("2 propuestas vencen pronto");
    expect(item.detail).toBe("La primera vence en 1 h 30 min. Si no respondes, se pierde.");
  });

  it("las demás esperan en un aviso aparte; sin vencimiento también esperan", () => {
    const items = brief({
      proposals: [
        briefProposal({ expiresAt: iso(2 * HOUR) }),
        briefProposal({ expiresAt: iso(30 * HOUR) }),
        briefProposal({ expiresAt: null }),
      ],
    });
    expect(ids(items).filter((i) => i.startsWith("proposal"))).toEqual([
      "proposal_expiring",
      "proposals_waiting",
    ]);
    expect(one(items, "proposals_waiting").title).toBe("2 propuestas esperando tu respuesta");
  });

  it("no cuentan las propias, las vencidas ni las que ya tienen respuesta", () => {
    const items = brief({
      proposals: [
        briefProposal({ proposedBy: "family" }),
        briefProposal({ expiresAt: iso(-HOUR) }),
        briefProposal({ status: "accepted" }),
        briefProposal({ status: "rejected" }),
        briefProposal({ status: "countered" }),
      ],
    });
    expect(ids(items).some((i) => i.startsWith("proposal"))).toBe(false);
  });

  it("una sola propuesta sin nombre no inventa uno", () => {
    expect(
      one(
        brief({ proposals: [briefProposal({ expiresAt: iso(HOUR), peerName: null })] }),
        "proposal_expiring",
      ).title,
    ).toBe("Responde antes de que venza: una propuesta");
  });
});

describe("postulaciones", () => {
  it("sin responder: media prioridad al principio, alta cuando llevan un día", () => {
    const fresh = one(
      brief({ applications: [briefApplication({ createdAt: iso(-3 * HOUR) })] }),
      "applications",
    );
    expect(fresh).toMatchObject({ priority: "medium", title: "1 postulación sin responder" });
    expect(fresh.detail).toBe(
      "La más antigua llegó hace 3 h. Quien espera mucho suele aceptar otra oferta.",
    );
    const stale = one(
      brief({
        applications: [briefApplication({ createdAt: iso(-APPLICATION_STALE_HOURS * HOUR) })],
      }),
      "applications",
    );
    expect(stale.priority).toBe("high");
    const almost = one(
      brief({
        applications: [briefApplication({ createdAt: iso(-APPLICATION_STALE_HOURS * HOUR + 1) })],
      }),
      "applications",
    );
    expect(almost.priority).toBe("medium");
  });

  it("cuenta solo las pendientes y toma la más antigua", () => {
    const items = brief({
      applications: [
        briefApplication({ createdAt: iso(-10 * HOUR) }),
        briefApplication({ createdAt: iso(-60 * HOUR) }),
        briefApplication({ status: "accepted", createdAt: iso(-100 * HOUR) }),
        briefApplication({ status: "rejected" }),
      ],
    });
    const item = one(items, "applications");
    expect(item.title).toBe("2 postulaciones sin responder");
    expect(item.detail).toMatch(/hace 2 días/);
  });

  it("con fechas dañadas no falla y sigue avisando", () => {
    const item = one(
      brief({ applications: [briefApplication({ createdAt: "no-es-fecha" })] }),
      "applications",
    );
    expect(item.title).toBe("1 postulación sin responder");
    expect(item.detail).toBe("Responde para no perder a quienes se postularon.");
    expect(item.priority).toBe("medium");
  });
});

describe("horas sin cubrir", () => {
  const gap = (offsetH: number, level: "critical" | "high" | "medium" | "low", hours = 6) => ({
    startsAt: iso(offsetH * HOUR),
    endsAt: iso((offsetH + hours) * HOUR),
    hours,
    level,
  });

  it("el nivel del hueco decide la prioridad", () => {
    expect(one(brief({ gaps: [gap(3, "critical")] }), "gap_soon").priority).toBe("critical");
    expect(one(brief({ gaps: [gap(20, "high")] }), "gap_soon").priority).toBe("high");
    expect(one(brief({ gaps: [gap(50, "medium")] }), "gap_soon").priority).toBe("medium");
  });

  it("un hueco lejano (nivel bajo) no entra al resumen del día", () => {
    expect(ids(brief({ gaps: [gap(100, "low")] })).includes("gap_soon")).toBe(false);
  });

  it("dice cuándo y cuánto, y cuenta los demás", () => {
    const items = brief({
      gaps: [gap(30, "medium", 4), gap(3, "critical", 6), gap(50, "medium", 2)],
    });
    const item = one(items, "gap_soon");
    expect(item.title).toBe("Sin profesional hoy a las 13:00");
    expect(item.detail).toBe("6 horas sin cubrir, y 2 huecos más en los próximos días.");
    expect(item.cta).toEqual({ label: "Ver mi agenda", target: { kind: "agenda" } });
  });

  it("una hora sola y un hueco más se dicen en singular", () => {
    const item = one(brief({ gaps: [gap(3, "critical", 1), gap(30, "medium", 1)] }), "gap_soon");
    expect(item.detail).toBe("1 hora sin cubrir, y 1 hueco más en los próximos días.");
  });

  it("un turno que ya empezó sin profesional se dice tal cual", () => {
    const item = one(brief({ gaps: [gap(-1, "critical", 3)] }), "gap_soon");
    expect(item.title).toBe("Hay un turno ya empezado sin profesional");
    expect(item.priority).toBe("critical");
  });

  it("mañana y días siguientes", () => {
    expect(one(brief({ gaps: [gap(20, "high")] }), "gap_soon").title).toBe(
      "Sin profesional mañana a las 06:00",
    );
    expect(one(brief({ gaps: [gap(60, "medium")] }), "gap_soon").title).toBe(
      "Sin profesional vie 16 oct a las 22:00",
    );
  });
});

describe("datos de seguridad", () => {
  it("sin contacto de emergencia: alta prioridad si ya hay servicios, media si no", () => {
    const withService = one(
      brief({
        profile: { complete: false, hasEmergencyContact: false },
        services: [briefService()],
      }),
      "emergency",
    );
    expect(withService).toMatchObject({
      priority: "high",
      title: "Agrega un contacto de emergencia",
      cta: { target: { kind: "profile" } },
    });
    const none = one(
      brief({ profile: { complete: false, hasEmergencyContact: false } }),
      "emergency",
    );
    expect(none.priority).toBe("medium");
  });

  it("perfil incompleto pero con contacto de emergencia: aviso suave", () => {
    const items = brief({ profile: { complete: false, hasEmergencyContact: true } });
    expect(ids(items)).toContain("profile_incomplete");
    expect(ids(items)).not.toContain("emergency_contact");
    expect(one(items, "profile_incomplete").priority).toBe("medium");
  });

  it("el contacto de emergencia tapa el aviso de perfil incompleto (no se repite)", () => {
    const items = brief({ profile: { complete: false, hasEmergencyContact: false } });
    expect(ids(items)).toContain("emergency_contact");
    expect(ids(items)).not.toContain("profile_incomplete");
  });
});

describe("calificar, equipo y círculo", () => {
  it("un servicio por calificar con su nombre; varios en plural", () => {
    const one1 = one(
      brief({ unrated: [{ bookingId: "a", proName: "Laura", completedAt: iso(-2 * DAY) }] }),
      "unrated",
    );
    expect(one1).toMatchObject({
      priority: "medium",
      title: "Califica el servicio con Laura",
      cta: { target: { kind: "ratings" } },
    });
    const many = one(
      brief({
        unrated: [
          { bookingId: "a", proName: "Laura", completedAt: iso(-2 * DAY) },
          { bookingId: "b", proName: null, completedAt: iso(-5 * DAY) },
          { bookingId: "c", proName: "Ana", completedAt: iso(-9 * DAY) },
        ],
      }),
      "unrated",
    );
    expect(many.title).toBe("3 servicios por calificar");
  });

  it("después de 14 días ya no se insiste; sin fecha sí", () => {
    const old = brief({
      unrated: [
        { bookingId: "a", proName: "Laura", completedAt: iso(-(RATING_WINDOW_DAYS * DAY + HOUR)) },
      ],
    });
    expect(ids(old)).not.toContain("unrated");
    const edge = brief({
      unrated: [{ bookingId: "a", proName: "Laura", completedAt: iso(-RATING_WINDOW_DAYS * DAY) }],
    });
    expect(ids(edge)).toContain("unrated");
    expect(
      ids(brief({ unrated: [{ bookingId: "a", proName: "Laura", completedAt: null }] })),
    ).toContain("unrated");
  });

  it("guardar un equipo solo se sugiere tras un servicio y sin equipo", () => {
    expect(ids(brief({ teamSize: 0 }))).toContain("save_team");
    expect(ids(brief({ teamSize: 0, completedServices: 0 }))).not.toContain("save_team");
    expect(ids(brief({ teamSize: 1 }))).not.toContain("save_team");
  });

  it("invitar al círculo se sugiere con actividad y sin círculo", () => {
    expect(ids(brief({ circleMembers: 0 }))).toContain("invite_circle");
    expect(
      ids(brief({ circleMembers: 0, completedServices: 0, services: [briefService()] })),
    ).toContain("invite_circle");
    expect(ids(brief({ circleMembers: 0, completedServices: 0 }))).not.toContain("invite_circle");
    expect(ids(brief({ circleMembers: 2 }))).not.toContain("invite_circle");
  });
});

describe("avisos del plan de pago", () => {
  const hints = {
    alerts7d: 2,
    moodTrend: "worse" as const,
    budgetDeltaPct: 40,
    aboveMarketPct: 18,
  };

  it("con plan se añaden los avisos del informe y del presupuesto, marcados como premium", () => {
    const items = brief({ premium: true, hints });
    expect(ids(items)).toEqual([
      "wellbeing_alerts",
      "wellbeing_mood",
      "budget_pace",
      "budget_market",
    ]);
    expect(items.every((i) => i.premium)).toBe(true);
    expect(items[0].title).toBe("Hubo 2 alertas o incidentes esta semana");
    expect(items[0].cta.target).toEqual({ kind: "wellbeing" });
    expect(items[2]).toMatchObject({
      title: "Vas 40 % por encima del mes pasado",
      cta: { target: { kind: "budget" } },
    });
    expect(items[3].title).toBe("Pagas 18 % más que la mediana de tu ciudad");
  });

  it("sin plan nunca salen, aunque se pasen los datos", () => {
    const items = brief({ premium: false, hints });
    expect(items.some((i) => i.premium)).toBe(false);
    expect(ids(items)).toEqual(["upgrade"]);
  });

  it("las fronteras: 25 % de aumento, 10 % sobre el mercado, 1 alerta", () => {
    expect(ids(brief({ premium: true, hints: { budgetDeltaPct: 25 } }))).toContain("budget_pace");
    expect(ids(brief({ premium: true, hints: { budgetDeltaPct: 24 } }))).not.toContain(
      "budget_pace",
    );
    expect(ids(brief({ premium: true, hints: { aboveMarketPct: 10 } }))).toContain("budget_market");
    expect(ids(brief({ premium: true, hints: { aboveMarketPct: 9 } }))).not.toContain(
      "budget_market",
    );
    expect(one(brief({ premium: true, hints: { alerts7d: 1 } }), "wellbeing_alerts").title).toBe(
      "Hubo 1 alerta o incidente esta semana",
    );
    expect(
      ids(
        brief({
          premium: true,
          hints: { alerts7d: 0, moodTrend: "stable", budgetDeltaPct: null, aboveMarketPct: null },
        }),
      ),
    ).toEqual([]);
  });

  it("la invitación al plan no sale para quien ya lo tiene", () => {
    expect(ids(brief({ premium: true, hints }))).not.toContain("upgrade");
  });
});

describe("orden del día", () => {
  it("un día cargado: crítico, luego alto por hora, luego medio y bajo", () => {
    const items = brief({
      services: [
        briefService({ bookingId: "a", alerts: 1 }),
        briefService({ bookingId: "b", status: "confirmed", scheduledAt: iso(5 * HOUR) }),
      ],
      proposals: [briefProposal({ expiresAt: iso(2 * HOUR) })],
      applications: [briefApplication({ createdAt: iso(-30 * HOUR) })],
      gaps: [{ startsAt: iso(20 * HOUR), endsAt: iso(26 * HOUR), hours: 6, level: "high" }],
      unrated: [{ bookingId: "u", proName: "Laura", completedAt: iso(-DAY) }],
      profile: { complete: true, hasEmergencyContact: false },
      teamSize: 0,
      circleMembers: 0,
    });
    expect(ids(items)).toEqual([
      "service_alert:a", // crítico
      "proposal_expiring", // alto: vence en 2 h
      "gap_soon", // alto: mañana
      "applications_waiting", // alto: lleva más de un día (sin hora: después de lo que tiene hora)
      "emergency_contact", // alto: hay servicios
      "unrated", // medio
      "save_team", // medio
      "service_soon:b", // bajo, con hora: llega hoy
      "invite_circle", // bajo
      "upgrade", // bajo
    ]);
  });

  it("a igual prioridad, lo que ocurre antes va primero y el desempate es por id", () => {
    const items = brief({
      services: [
        briefService({ bookingId: "tarde", status: "confirmed", scheduledAt: iso(10 * HOUR) }),
        briefService({ bookingId: "pronto", status: "confirmed", scheduledAt: iso(2 * HOUR) }),
      ],
    });
    expect(ids(items).filter((i) => i.startsWith("service_soon"))).toEqual([
      "service_soon:pronto",
      "service_soon:tarde",
    ]);
  });

  it("el orden de entrada no cambia el resultado", () => {
    const data = {
      services: [
        briefService({ bookingId: "a", alerts: 1 }),
        briefService({ bookingId: "b", status: "in_route" }),
      ],
      proposals: [
        briefProposal({ id: "p1", expiresAt: iso(2 * HOUR) }),
        briefProposal({ id: "p2", expiresAt: null }),
      ],
      applications: [briefApplication({ id: "x" }), briefApplication({ id: "y" })],
    };
    const a = brief(data);
    const b = brief({
      ...data,
      services: [...data.services].reverse(),
      proposals: [...data.proposals].reverse(),
      applications: [...data.applications].reverse(),
    });
    expect(ids(b)).toEqual(ids(a));
  });
});

describe("encabezado y lista corta", () => {
  const item = (id: string, priority: BriefItem["priority"]): BriefItem => ({
    id,
    priority,
    title: id,
    detail: id,
    cta: { label: "ok", target: { kind: "agenda" } },
  });

  it("el encabezado cuenta lo urgente y lo que pide atención", () => {
    expect(
      briefHeadline([item("a", "critical"), item("b", "critical"), item("c", "high")]),
    ).toEqual({
      text: "2 cosas urgentes para mirar ahora",
      tone: "alert",
    });
    expect(briefHeadline([item("a", "high")])).toEqual({
      text: "1 cosa pide tu atención hoy",
      tone: "attention",
    });
    expect(briefHeadline([item("a", "high"), item("b", "high"), item("c", "medium")])).toEqual({
      text: "2 cosas piden tu atención hoy",
      tone: "attention",
    });
    expect(briefHeadline([item("a", "medium"), item("b", "low")])).toEqual({
      text: "Todo en orden por ahora",
      tone: "calm",
    });
  });

  it("el tono del encabezado coincide con el del héroe y con la calma", () => {
    const cases: BriefItem["priority"][][] = [
      [],
      ["low"],
      ["medium"],
      ["high"],
      ["critical", "low"],
    ];
    const map = { alert: "urgent", attention: "attention", calm: "calm" } as const;
    for (const priorities of cases) {
      const items = priorities.map((p, i) => item(`x${i}`, p));
      expect(map[briefHeadline(items).tone]).toBe(heroTone(priorities));
    }
    expect(calmScore([])).toBe(100);
  });
});

describe("cifras del encabezado", () => {
  it("cuenta lo que está en curso, lo programado y lo que espera respuesta", () => {
    const stats = heroStats(
      snapshot({
        services: [
          briefService({ bookingId: "a", status: "in_progress" }),
          briefService({ bookingId: "b", status: "confirmed" }),
          briefService({ bookingId: "c", status: "in_route" }),
          briefService({ bookingId: "d", status: "confirmed", side: "circle" }),
        ],
        proposals: [briefProposal({ id: "p1" }), briefProposal({ id: "p2", proposedBy: "family" })],
        applications: [
          briefApplication({ id: "x", status: "pending" }),
          briefApplication({ id: "y", status: "accepted" }),
        ],
      }),
    );
    expect(stats).toEqual([
      { label: "En curso", value: 1 },
      { label: "Programados", value: 3 },
      { label: "Por responder", value: 2 },
    ]);
  });

  it("no cuenta propuestas vencidas, propias ni ya respondidas", () => {
    const stats = heroStats(
      snapshot({
        proposals: [
          briefProposal({ id: "vencida", expiresAt: iso(-HOUR) }),
          briefProposal({ id: "mia", proposedBy: "family" }),
          briefProposal({ id: "aceptada", status: "accepted" }),
          briefProposal({ id: "sin_fecha", expiresAt: null }),
        ],
      }),
    );
    expect(stats[2]).toEqual({ label: "Por responder", value: 1 });
  });

  it("una familia sin nada muestra ceros, no huecos", () => {
    expect(heroStats(snapshot({}))).toEqual([
      { label: "En curso", value: 0 },
      { label: "Programados", value: 0 },
      { label: "Por responder", value: 0 },
    ]);
  });

  it("las cifras de «por responder» coinciden con lo que la lista del día anuncia", () => {
    const snap = snapshot({
      proposals: [briefProposal({ id: "p1" }), briefProposal({ id: "p2" })],
      applications: [briefApplication({ id: "a1" })],
      premium: true,
    });
    const items = buildFamilyBrief(snap);
    const waitingItem = items.find(
      (i) => i.id === "proposals_waiting" || i.id === "proposal_expiring",
    );
    expect(waitingItem).toBeDefined();
    expect(heroStats(snap)[2].value).toBe(3);
  });
});

describe("«cuándo»", () => {
  it("hoy, mañana y días siguientes, en hora de Colombia", () => {
    expect(whenEs(NOW + 5 * HOUR, NOW)).toBe("hoy a las 15:00");
    expect(whenEs(NOW + 20 * HOUR, NOW)).toBe("mañana a las 06:00");
    expect(whenEs(NOW + 2 * DAY, NOW)).toBe("vie 16 oct a las 10:00");
    // 23:30 en Colombia sigue siendo «hoy»; 00:30 ya es «mañana», aunque en UTC sea otro día
    expect(whenEs(Date.parse("2026-10-15T04:30:00Z"), NOW)).toBe("hoy a las 23:30");
    expect(whenEs(Date.parse("2026-10-15T05:30:00Z"), NOW)).toBe("mañana a las 00:30");
  });
});

describe("invariantes (fotos aleatorias de la familia)", () => {
  for (const seed of [5, 17, 321, 2026, 9001]) {
    it(`semilla ${seed}: ids únicos, orden por prioridad, premium solo con plan y textos limpios`, () => {
      const rnd = mulberry32(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const date = () => (rnd() < 0.05 ? "fecha-rota" : iso((rnd() * 6 - 2) * DAY));
      for (let k = 0; k < 40; k++) {
        const premium = rnd() < 0.5;
        const items = buildFamilyBrief(
          snapshot({
            premium,
            services: Array.from({ length: Math.floor(rnd() * 4) }, (_, i) =>
              briefService({
                bookingId: `s${i}`,
                side: pick(["client", "circle"] as const),
                status: pick(["confirmed", "in_route", "in_progress", "otro"]),
                scheduledAt: date(),
                alerts: Math.floor(rnd() * 3),
                counterpartName: rnd() < 0.3 ? null : "Laura",
                ownerName: rnd() < 0.5 ? null : "María",
              }),
            ),
            proposals: Array.from({ length: Math.floor(rnd() * 4) }, () =>
              briefProposal({
                status: pick(["pending", "pending", "rejected"]),
                proposedBy: pick(["family", "professional"]),
                expiresAt: rnd() < 0.2 ? null : date(),
              }),
            ),
            applications: Array.from({ length: Math.floor(rnd() * 3) }, () =>
              briefApplication({ status: pick(["pending", "accepted"]), createdAt: date() }),
            ),
            gaps: Array.from({ length: Math.floor(rnd() * 3) }, () => ({
              startsAt: date(),
              endsAt: iso(3 * DAY),
              hours: Math.round(rnd() * 24 * 10) / 10,
              level: pick(["critical", "high", "medium", "low"] as const),
            })),
            unrated: Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({
              bookingId: `u${i}`,
              proName: rnd() < 0.5 ? null : "Ana",
              completedAt: rnd() < 0.2 ? null : date(),
            })),
            profile: { complete: rnd() < 0.5, hasEmergencyContact: rnd() < 0.5 },
            completedServices: Math.floor(rnd() * 4),
            teamSize: Math.floor(rnd() * 3),
            circleMembers: Math.floor(rnd() * 3),
            hints:
              rnd() < 0.7
                ? {
                    alerts7d: Math.floor(rnd() * 3),
                    moodTrend: pick(["better", "worse", "stable", "unknown"] as const),
                    budgetDeltaPct: rnd() < 0.3 ? null : Math.round(rnd() * 100 - 30),
                    aboveMarketPct: rnd() < 0.3 ? null : Math.round(rnd() * 40),
                  }
                : undefined,
          }),
        );
        expect(new Set(ids(items)).size).toBe(items.length);
        const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
        for (let i = 1; i < items.length; i++)
          expect(order[items[i - 1].priority]).toBeLessThanOrEqual(order[items[i].priority]);
        if (!premium) expect(items.some((i) => i.premium)).toBe(false);
        for (const it of items) {
          expect(it.title.length).toBeGreaterThan(0);
          expect(it.cta.label.length).toBeGreaterThan(0);
          expect(`${it.title} ${it.detail}`).not.toMatch(/undefined|NaN|Infinity|\[object/);
        }
        const { shown, hidden } = splitVisible(items);
        expect(shown.length + hidden.length).toBe(items.length);
        expect(shown.filter((i) => i.priority === "critical").length).toBe(
          items.filter((i) => i.priority === "critical").length,
        );
      }
    });
  }
});
