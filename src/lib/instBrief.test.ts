import { describe, expect, it } from "vitest";
import {
  INST_CONTRACT_SOON_HOURS,
  INST_LATE_GRACE_MIN,
  INST_LATE_MAX_HOURS,
  INST_LATE_URGENT_MIN,
  INST_RATING_WINDOW_DAYS,
  INST_UPGRADE_MIN_SERVICES,
  INST_WAITING_HIGH_HOURS,
  buildInstBrief,
  instHeadline,
  instHeroStats,
  type InstBriefItem,
  type InstSnapshot,
} from "./instBrief";
import { DAY, HOUR, NOW, iso, mulberry32 } from "./intel.fixture";

const MIN = 60_000;
const snap = (over: Partial<InstSnapshot> = {}): InstSnapshot => ({
  now: NOW,
  services: [],
  shifts: [],
  waiting: [],
  unsigned: [],
  unrated: [],
  profile: { complete: true, verified: true },
  coveragePct: null,
  hasShifts: true,
  completedServices: 10,
  premium: true,
  quality: null,
  ...over,
});
const svc = (
  over: Partial<InstSnapshot["services"][number]> = {},
): InstSnapshot["services"][number] => ({
  bookingId: "b1",
  status: "confirmed",
  scheduledAt: iso(2 * HOUR),
  counterpartName: "Laura Pérez",
  alerts: 0,
  ...over,
});
const shift = (
  over: Partial<InstSnapshot["shifts"][number]> = {},
): InstSnapshot["shifts"][number] => ({
  shiftId: "s1",
  offerTitle: "Auxiliar UCI noches",
  risk: "critical",
  open: 1,
  hoursToStart: 5,
  startsAt: iso(5 * HOUR),
  ...over,
});
const ids = (items: InstBriefItem[]) => items.map((i) => i.id);
const find = (items: InstBriefItem[], id: string) => items.find((i) => i.id === id);
const brief = (over: Partial<InstSnapshot> = {}) => buildInstBrief(snap(over));

describe("sin nada pendiente", () => {
  it("un día tranquilo no inventa tareas", () => {
    expect(brief()).toEqual([]);
    expect(instHeadline([], null).text).toBe("Todo en orden por ahora");
  });
});

describe("servicios en curso", () => {
  it("una alerta en un turno en curso es urgente y lleva al parte", () => {
    const items = brief({
      services: [svc({ status: "in_progress", alerts: 2, scheduledAt: iso(-3 * HOUR) })],
    });
    const i = find(items, "service_alert:b1")!;
    expect(i.priority).toBe("critical");
    expect(i.title).toBe("Alerta en el turno de Laura Pérez");
    expect(i.detail).toBe("2 alertas registradas en el parte de hoy. Revísalo ahora.");
    expect(i.cta).toEqual({ label: "Ver el parte", target: { kind: "service", bookingId: "b1" } });
  });

  it("un turno en curso sin alertas es solo información", () => {
    const i = find(brief({ services: [svc({ status: "in_progress" })] }), "service_live:b1")!;
    expect(i.priority).toBe("low");
    expect(i.title).toBe("Turno en curso con Laura Pérez");
    expect(ids(brief({ services: [svc({ status: "in_progress" })] }))).not.toContain(
      "service_alert:b1",
    );
  });

  it("sin nombre dice «tu profesional»", () => {
    const i = find(
      brief({ services: [svc({ status: "in_progress", alerts: 1, counterpartName: " " })] }),
      "service_alert:b1",
    )!;
    expect(i.title).toBe("Alerta en el turno de tu profesional");
  });
});

describe("el profesional que no llega", () => {
  const late = (min: number, status = "confirmed") => svc({ status, scheduledAt: iso(-min * MIN) });

  it("hasta 15 min no se avisa; con más de 15 es importante; con más de 30 es urgente", () => {
    expect(INST_LATE_GRACE_MIN).toBe(15);
    expect(INST_LATE_URGENT_MIN).toBe(30);
    expect(ids(brief({ services: [late(14)] }))).toEqual([]);
    expect(ids(brief({ services: [late(15)] }))).toEqual([]);
    expect(find(brief({ services: [late(16)] }), "service_no_show:b1")!.priority).toBe("high");
    expect(find(brief({ services: [late(30)] }), "service_no_show:b1")!.priority).toBe("high");
    expect(find(brief({ services: [late(31)] }), "service_no_show:b1")!.priority).toBe("critical");
  });

  it("dice hace cuánto debía empezar y propone el plan B", () => {
    const i = find(brief({ services: [late(45)] }), "service_no_show:b1")!;
    expect(i.title).toBe("Laura Pérez aún no ha iniciado su turno");
    expect(i.detail).toBe(
      "Debía empezar hace 45 min. Si no hay noticias, invita a tu equipo de confianza a cubrirlo.",
    );
    expect(i.cta.target).toEqual({ kind: "service", bookingId: "b1" });
    expect(find(brief({ services: [late(150)] }), "service_no_show:b1")!.detail).toContain(
      "hace 2 h",
    );
  });

  it("pasadas 12 h ya no es un aviso del día (es un servicio sin iniciar, que ve la tarjeta de calidad)", () => {
    expect(INST_LATE_MAX_HOURS).toBe(12);
    expect(ids(brief({ services: [late(12 * 60)] }))).toContain("service_no_show:b1");
    expect(ids(brief({ services: [late(12 * 60 + 1)] }))).toEqual([]);
  });

  it("si va en camino y se retrasa, es menos grave que si no ha dicho nada", () => {
    expect(
      find(brief({ services: [late(20, "in_route")] }), "service_late_route:b1")!.priority,
    ).toBe("medium");
    expect(
      find(brief({ services: [late(45, "in_route")] }), "service_late_route:b1")!.priority,
    ).toBe("high");
    expect(find(brief({ services: [late(45, "in_route")] }), "service_late_route:b1")!.detail).toBe(
      "Su turno debía empezar hace 45 min. Ya avisó que viene en camino.",
    );
    expect(ids(brief({ services: [late(10, "in_route")] }))).toEqual([]);
  });

  it("los minutos de retraso se redondean y a partir de 60 se cuentan en horas", () => {
    const detail = (ms: number, status = "confirmed") =>
      find(
        brief({ services: [svc({ status, scheduledAt: iso(-ms) })] }),
        `service_${status === "confirmed" ? "no_show" : "late_route"}:b1`,
      )!.detail;
    expect(detail(45 * MIN + 30_000)).toContain("hace 46 min"); // 45,5 → 46
    expect(detail(45 * MIN + 29_000)).toContain("hace 45 min");
    expect(detail(59 * MIN)).toContain("hace 59 min");
    expect(detail(60 * MIN)).toContain("hace 1 h");
    expect(detail(150 * MIN)).toContain("hace 2 h");
    expect(detail(60 * MIN, "in_route")).toContain("hace 1 h");
  });

  it("en camino con exactamente 30 min de retraso todavía es «pendiente»; con más, importante", () => {
    const route = (min: number) => svc({ status: "in_route", scheduledAt: iso(-min * MIN) });
    expect(find(brief({ services: [route(30)] }), "service_late_route:b1")!.priority).toBe(
      "medium",
    );
    expect(find(brief({ services: [route(31)] }), "service_late_route:b1")!.priority).toBe("high");
  });

  it("solo los servicios confirmados o en camino generan avisos de retraso", () => {
    for (const status of ["pending", "completed", "cancelled"]) {
      expect(ids(brief({ services: [svc({ status, scheduledAt: iso(-3 * HOUR) })] }))).toEqual([]);
    }
  });

  it("un turno que empieza justo ahora dice «ya empezó», no una cuenta regresiva vencida", () => {
    const i = find(
      brief({ shifts: [shift({ hoursToStart: 0, startsAt: iso(0) })] }),
      "coverage_critical",
    )!;
    expect(i.detail).toBe("El primero: «Auxiliar UCI noches», ya empezó.");
    const soon = find(
      brief({ shifts: [shift({ hoursToStart: 0.5, startsAt: iso(30 * MIN) })] }),
      "coverage_critical",
    )!;
    expect(soon.detail).toBe("El primero: «Auxiliar UCI noches», empieza en 30 min.");
  });

  it("un servicio por empezar o con fecha dañada no genera avisos", () => {
    expect(ids(brief({ services: [svc({ scheduledAt: iso(2 * HOUR) })] }))).toEqual([]);
    expect(ids(brief({ services: [svc({ scheduledAt: "x" })] }))).toEqual([]);
    expect(ids(brief({ services: [svc({ status: "in_route", scheduledAt: "x" })] }))).toEqual([]);
  });
});

describe("cobertura", () => {
  it("los turnos críticos con cupos libres son urgentes y nombran el primero", () => {
    const items = brief({
      shifts: [
        shift({
          shiftId: "a",
          offerTitle: "UCI noches",
          hoursToStart: 20,
          startsAt: iso(20 * HOUR),
        }),
        shift({ shiftId: "b", offerTitle: "Urgencias", hoursToStart: 5, startsAt: iso(5 * HOUR) }),
      ],
    });
    const i = find(items, "coverage_critical")!;
    expect(i.priority).toBe("critical");
    expect(i.title).toBe("2 turnos críticos sin cubrir");
    expect(i.detail).toBe("El primero: «Urgencias», empieza en 5 h.");
    expect(i.cta).toEqual({ label: "Cubrir ahora", target: { kind: "coverage" } });
  });

  it("un turno que ya empezó se dice «ya empezó»", () => {
    const i = find(
      brief({ shifts: [shift({ hoursToStart: -2, startsAt: iso(-2 * HOUR) })] }),
      "coverage_critical",
    )!;
    expect(i.title).toBe("1 turno crítico sin cubrir");
    expect(i.detail).toBe("El primero: «Auxiliar UCI noches», ya empezó.");
  });

  it("los turnos en riesgo son importantes, no urgentes", () => {
    const i = find(
      brief({ shifts: [shift({ risk: "high" }), shift({ shiftId: "s2", risk: "high" })] }),
      "coverage_high",
    )!;
    expect(i.priority).toBe("high");
    expect(i.title).toBe("2 turnos en riesgo de quedar sin cubrir");
  });

  it("lo cubierto, lo que solo hay que vigilar y lo que está en orden no se muestra", () => {
    const quiet = brief({
      shifts: [
        shift({ open: 0 }),
        shift({ risk: "watch" }),
        shift({ risk: "ok" }),
        shift({ risk: "covered", open: 0 }),
      ],
    });
    expect(ids(quiet)).toEqual([]);
    expect(ids(brief({ shifts: [shift({ risk: "critical", open: 0 })] }))).toEqual([]);
  });
});

describe("postulaciones", () => {
  const waiting = (hours: number) => ({ id: `w${hours}`, createdAt: iso(-hours * HOUR) });

  it("sin pasar 24 h son pendientes; desde 24 h, importantes", () => {
    expect(INST_WAITING_HIGH_HOURS).toBe(24);
    expect(find(brief({ waiting: [waiting(5)] }), "applications_waiting")!.priority).toBe("medium");
    expect(find(brief({ waiting: [waiting(23.9)] }), "applications_waiting")!.priority).toBe(
      "medium",
    );
    expect(find(brief({ waiting: [waiting(24)] }), "applications_waiting")!.priority).toBe("high");
  });

  it("cuenta las postulaciones y dice cuánto lleva la más antigua", () => {
    const i = find(
      brief({ waiting: [waiting(3), waiting(30), waiting(8)] }),
      "applications_waiting",
    )!;
    expect(i.title).toBe("3 postulaciones esperan tu respuesta");
    expect(i.detail).toBe(
      "La más antigua lleva 30 h esperando. Pasadas 24 h muchos profesionales aceptan otra oferta.",
    );
    expect(find(brief({ waiting: [waiting(2)] }), "applications_waiting")!.title).toBe(
      "1 postulación espera tu respuesta",
    );
    expect(find(brief({ waiting: [waiting(0.2)] }), "applications_waiting")!.detail).toContain(
      "menos de 1 h",
    );
    expect(find(brief({ waiting: [waiting(72)] }), "applications_waiting")!.detail).toContain(
      "3 días",
    );
  });

  it("la antigüedad se dice en minutos, horas o días, sin redondear hacia arriba", () => {
    const detail = (hours: number) =>
      find(
        brief({ waiting: [{ id: "w", createdAt: iso(-hours * HOUR) }] }),
        "applications_waiting",
      )!.detail;
    expect(detail(0.99)).toContain("lleva menos de 1 h esperando");
    expect(detail(1)).toContain("lleva 1 h esperando");
    expect(detail(5.6)).toContain("lleva 5 h esperando");
    expect(detail(47.9)).toContain("lleva 47 h esperando");
    expect(detail(48)).toContain("lleva 2 días esperando");
    expect(detail(80)).toContain("lleva 3 días esperando");
  });

  it("una postulación con fecha futura (reloj desfasado) no rompe el aviso", () => {
    const i = find(
      brief({ waiting: [{ id: "w", createdAt: iso(2 * HOUR) }] }),
      "applications_waiting",
    )!;
    expect(i.priority).toBe("medium");
    expect(i.detail).toContain("menos de 1 h");
  });

  it("una fecha dañada no rompe el aviso", () => {
    const i = find(brief({ waiting: [{ id: "x", createdAt: "x" }] }), "applications_waiting")!;
    expect(i.priority).toBe("medium");
    expect(i.detail).not.toMatch(/NaN/);
    expect(i.cta.target).toEqual({ kind: "applications" });
  });
});

describe("contratos", () => {
  it("con un turno en menos de 48 h es importante; si no, pendiente", () => {
    expect(INST_CONTRACT_SOON_HOURS).toBe(48);
    const soon = find(
      brief({ unsigned: [{ id: "c1", firstShiftAt: iso(20 * HOUR) }] }),
      "contracts_unsigned",
    )!;
    expect(soon.priority).toBe("high");
    expect(soon.detail).toBe(
      "Hay turnos que empiezan en menos de 48 h sin contrato firmado por ambas partes.",
    );
    const later = find(
      brief({ unsigned: [{ id: "c1", firstShiftAt: iso(5 * DAY) }] }),
      "contracts_unsigned",
    )!;
    expect(later.priority).toBe("medium");
    expect(later.detail).toContain("evidencia verificable");
  });

  it("el límite es de 48 h exactas y sin fecha no hay urgencia", () => {
    expect(
      find(brief({ unsigned: [{ id: "c", firstShiftAt: iso(48 * HOUR) }] }), "contracts_unsigned")!
        .priority,
    ).toBe("high");
    expect(
      find(
        brief({ unsigned: [{ id: "c", firstShiftAt: iso(48 * HOUR + MIN) }] }),
        "contracts_unsigned",
      )!.priority,
    ).toBe("medium");
    expect(
      find(brief({ unsigned: [{ id: "c", firstShiftAt: null }] }), "contracts_unsigned")!.priority,
    ).toBe("medium");
  });

  it("basta uno urgente para que el aviso sea importante, y cuenta todos", () => {
    const i = find(
      brief({
        unsigned: [
          { id: "a", firstShiftAt: iso(10 * DAY) },
          { id: "b", firstShiftAt: iso(5 * HOUR) },
        ],
      }),
      "contracts_unsigned",
    )!;
    expect(i.priority).toBe("high");
    expect(i.title).toBe("2 contratos esperan tu firma");
    expect(i.cta).toEqual({ label: "Revisar y firmar", target: { kind: "contracts" } });
  });
});

describe("calidad (plan Institucional)", () => {
  it("con indicadores en rojo avisa, con el más bajo, y lo marca como del plan", () => {
    const i = find(
      brief({ quality: { alerts: 2, worst: { label: "Llegadas puntuales", value: 62 } } }),
      "quality_attention",
    )!;
    expect(i.priority).toBe("medium");
    expect(i.badge).toBe("Plan Institucional");
    expect(i.title).toBe("2 indicadores de calidad piden atención");
    expect(i.detail).toBe("El más bajo: Llegadas puntuales (62 %).");
    expect(i.cta.target).toEqual({ kind: "quality" });
    expect(
      find(brief({ quality: { alerts: 1, worst: null } }), "quality_attention")!.detail,
    ).toContain("Revisa en detalle");
    expect(find(brief({ quality: { alerts: 1, worst: null } }), "quality_attention")!.title).toBe(
      "1 indicador de calidad pide atención",
    );
  });

  it("sin plan, sin datos o sin rojos no aparece", () => {
    expect(ids(brief({ premium: false, quality: { alerts: 3, worst: null } }))).not.toContain(
      "quality_attention",
    );
    expect(ids(brief({ quality: null }))).not.toContain("quality_attention");
    expect(ids(brief({ quality: { alerts: 0, worst: null } }))).not.toContain("quality_attention");
  });
});

describe("servicios por calificar", () => {
  it("avisa de los terminados en las últimas 2 semanas", () => {
    expect(INST_RATING_WINDOW_DAYS).toBe(14);
    const i = find(
      brief({
        unrated: [
          { bookingId: "a", completedAt: iso(-3 * DAY) },
          { bookingId: "b", completedAt: iso(-14 * DAY) },
          { bookingId: "c", completedAt: iso(-14 * DAY - 1) },
        ],
      }),
      "unrated",
    )!;
    expect(i.title).toBe("2 servicios por calificar");
    expect(i.cta.target).toEqual({ kind: "ratings" });
    expect(
      find(brief({ unrated: [{ bookingId: "a", completedAt: null }] }), "unrated")!.title,
    ).toBe("1 servicio por calificar");
    expect(ids(brief({ unrated: [{ bookingId: "c", completedAt: iso(-20 * DAY) }] }))).toEqual([]);
  });
});

describe("perfil y primer paso", () => {
  it("un perfil incompleto es lo primero; sin verificar es solo información", () => {
    expect(
      find(brief({ profile: { complete: false, verified: false } }), "profile_incomplete")!
        .priority,
    ).toBe("medium");
    expect(ids(brief({ profile: { complete: false, verified: false } }))).not.toContain(
      "unverified",
    );
    expect(
      find(brief({ profile: { complete: true, verified: false } }), "unverified")!.priority,
    ).toBe("low");
    expect(ids(brief({ profile: { complete: true, verified: null } }))).toEqual([]);
    expect(ids(brief({ profile: { complete: true, verified: true } }))).toEqual([]);
  });

  it("una institución nueva con perfil completo es invitada a publicar su primer turno", () => {
    const fresh = brief({ hasShifts: false, completedServices: 0 });
    expect(find(fresh, "publish_first")!.cta).toEqual({
      label: "Publicar turnos",
      target: { kind: "publish" },
    });
    expect(ids(brief({ hasShifts: true, completedServices: 0 }))).not.toContain("publish_first");
    expect(ids(brief({ hasShifts: false, completedServices: 2 }))).not.toContain("publish_first");
    expect(
      ids(
        brief({
          hasShifts: false,
          completedServices: 0,
          services: [svc({ status: "in_progress" })],
        }),
      ),
    ).not.toContain("publish_first");
    expect(
      ids(
        brief({
          hasShifts: false,
          completedServices: 0,
          profile: { complete: false, verified: null },
        }),
      ),
    ).not.toContain("publish_first");
  });
});

describe("invitación al plan", () => {
  it("solo con servicios hechos y sin el plan, con lo que incluye y sin presionar", () => {
    expect(INST_UPGRADE_MIN_SERVICES).toBe(3);
    const i = find(brief({ premium: false, completedServices: 3 }), "upgrade")!;
    expect(i.priority).toBe("low");
    expect(i.detail).toContain("costos");
    expect(i.cta).toEqual({ label: "Ver el plan Institucional", target: { kind: "plans" } });
    expect(ids(brief({ premium: false, completedServices: 2 }))).not.toContain("upgrade");
    expect(ids(brief({ premium: true, completedServices: 30 }))).not.toContain("upgrade");
  });
});

describe("orden del día", () => {
  const rich = (): InstSnapshot =>
    snap({
      services: [
        svc({ bookingId: "a", status: "in_progress", alerts: 1, scheduledAt: iso(-3 * HOUR) }),
        svc({ bookingId: "n", scheduledAt: iso(-50 * MIN) }),
        svc({ bookingId: "l", status: "in_progress", scheduledAt: iso(-1 * HOUR) }),
      ],
      shifts: [shift(), shift({ shiftId: "h", risk: "high" })],
      waiting: [{ id: "w", createdAt: iso(-30 * HOUR) }],
      unsigned: [{ id: "c", firstShiftAt: iso(10 * HOUR) }],
      unrated: [{ bookingId: "u", completedAt: iso(-2 * DAY) }],
      profile: { complete: false, verified: false },
      quality: { alerts: 1, worst: { label: "Llegadas puntuales", value: 70 } },
    });

  it("primero lo urgente, luego lo importante, lo pendiente y al final lo informativo", () => {
    const items = buildInstBrief(rich());
    const order = ["critical", "high", "medium", "low"];
    const ranks = items.map((i) => order.indexOf(i.priority));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(items[0].priority).toBe("critical");
    expect(items[items.length - 1].priority).toBe("low");
  });

  it("entre urgentes, lo que ocurre antes va primero", () => {
    const items = buildInstBrief(rich());
    const critical = items.filter((i) => i.priority === "critical").map((i) => i.id);
    // alerta de hace 3 h (a), profesional sin llegar desde hace 50 min (n), turno crítico dentro de 5 h
    expect(critical).toEqual(["service_alert:a", "service_no_show:n", "coverage_critical"]);
  });

  it("el resultado no depende del orden en que llegaron los datos", () => {
    const base = rich();
    const rand = mulberry32(3);
    const shuffle = <T>(xs: T[]) => [...xs].sort(() => rand() - 0.5);
    const expected = ids(buildInstBrief(base));
    for (let i = 0; i < 20; i++) {
      const s = {
        ...base,
        services: shuffle(base.services),
        shifts: shuffle(base.shifts),
        waiting: shuffle(base.waiting),
      };
      expect(ids(buildInstBrief(s))).toEqual(expected);
    }
  });

  it("no modifica lo que recibe", () => {
    const s = rich();
    const copy = JSON.parse(JSON.stringify(s));
    buildInstBrief(s);
    expect(s).toEqual(copy);
  });

  it("los textos no hablan de pagos por fuera ni de WhatsApp", () => {
    const text = JSON.stringify(buildInstBrief({ ...rich(), premium: false }));
    expect(text).not.toMatch(/whatsapp|efectivo|transferencia|nequi|daviplata/i);
  });
});

describe("titular y cifras", () => {
  it("cuenta lo urgente primero, luego lo importante, y celebra la cobertura completa", () => {
    const urgent = brief({ shifts: [shift()], waiting: [{ id: "w", createdAt: iso(-30 * HOUR) }] });
    expect(instHeadline(urgent)).toEqual({
      text: "1 cosa urgente para mirar ahora",
      tone: "alert",
    });
    const important = brief({
      waiting: [{ id: "w", createdAt: iso(-30 * HOUR) }],
      unsigned: [{ id: "c", firstShiftAt: iso(5 * HOUR) }],
    });
    expect(instHeadline(important)).toEqual({
      text: "2 cosas piden tu atención hoy",
      tone: "attention",
    });
    expect(instHeadline([], 100)).toEqual({
      text: "Todo en orden y tus turnos están cubiertos",
      tone: "calm",
    });
    expect(instHeadline([], 80).text).toBe("Todo en orden por ahora");
    expect(instHeadline([], 99).text).toBe("Todo en orden por ahora"); // cubierto casi todo no es cubierto todo
    // con algo importante pendiente, la cobertura completa no tapa el aviso
    expect(instHeadline(important, 100).tone).toBe("attention");
  });

  it("tres cifras: cobertura, en curso y por responder", () => {
    const stats = instHeroStats(
      snap({
        coveragePct: 87,
        services: [
          svc({ status: "in_progress" }),
          svc({ bookingId: "b2", status: "in_progress" }),
          svc({ bookingId: "b3" }),
        ],
        waiting: [{ id: "w", createdAt: iso(-HOUR) }],
      }),
    );
    expect(stats).toEqual([
      { label: "Cobertura", value: "87 %" },
      { label: "En curso", value: 2 },
      { label: "Por responder", value: 1 },
    ]);
    expect(instHeroStats(snap({ coveragePct: null }))[0]).toEqual({
      label: "Cobertura",
      value: "—",
    });
  });
});
