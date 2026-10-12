import { describe, expect, it } from "vitest";
import {
  PRO_COUNTER_URGENT_HOURS,
  PRO_LATE_GRACE_MIN,
  PRO_PROFILE_LOW_PCT,
  PRO_PROPOSAL_URGENT_HOURS,
  PRO_RATING_WINDOW_DAYS,
  PRO_SERVICE_NEXT_HOURS,
  PRO_SERVICE_SOON_HOURS,
  PRO_UPGRADE_MIN_SERVICES,
  buildProBrief,
  proHeadline,
  proHeroStats,
  type ProBriefItem,
  type ProSnapshot,
} from "./proBrief";
import { DAY, HOUR, NOW, iso, mulberry32 } from "./intel.fixture";

const MIN = 60_000;
const snap = (over: Partial<ProSnapshot> = {}): ProSnapshot => ({
  now: NOW,
  services: [],
  proposals: [],
  counters: [],
  unrated: [],
  workload: null,
  profile: { completionPct: 100, verified: true, hasRate: true },
  opportunities: null,
  kudosThisWeek: 0,
  completedServices: 10,
  premium: true,
  commissionMonth: 0,
  ...over,
});
const svc = (
  over: Partial<ProSnapshot["services"][number]> = {},
): ProSnapshot["services"][number] => ({
  bookingId: "b1",
  status: "confirmed",
  scheduledAt: iso(2 * HOUR),
  counterpartName: "Laura Pérez",
  alerts: 0,
  ...over,
});
const prop = (
  over: Partial<ProSnapshot["proposals"][number]> = {},
): ProSnapshot["proposals"][number] => ({
  id: "p1",
  status: "pending",
  proposedBy: "family",
  expiresAt: iso(20 * HOUR),
  peerName: "Marta Ruiz",
  ...over,
});
const ctr = (
  over: Partial<ProSnapshot["counters"][number]> = {},
): ProSnapshot["counters"][number] => ({
  id: "c1",
  expiresAt: iso(30 * HOUR),
  institutionName: "Clínica del Norte",
  ...over,
});
const brief = (over: Partial<ProSnapshot> = {}) => buildProBrief(snap(over));
const ids = (xs: ProBriefItem[]) => xs.map((i) => i.id);
const one = (xs: ProBriefItem[], id: string) =>
  xs.find((i) => i.id === id || i.id.startsWith(`${id}:`))!;

describe("un profesional sin nada pendiente", () => {
  it("con plan, todo en orden", () => {
    const items = brief();
    expect(items).toEqual([]);
    expect(proHeadline(items)).toEqual({ text: "Todo en orden por ahora", tone: "calm" });
  });

  it("sin plan y con experiencia solo se le invita a conocer sus números", () => {
    const items = brief({ premium: false });
    expect(ids(items)).toEqual(["upgrade"]);
    expect(items[0]).toMatchObject({ priority: "low", cta: { target: { kind: "plans" } } });
  });

  it("la invitación exige al menos 3 servicios terminados", () => {
    expect(PRO_UPGRADE_MIN_SERVICES).toBe(3);
    expect(ids(brief({ premium: false, completedServices: 2 }))).toEqual([]);
    expect(ids(brief({ premium: false, completedServices: 3 }))).toEqual(["upgrade"]);
  });
});

describe("servicios", () => {
  it("una alerta en un servicio en curso es lo más urgente y lleva al parte", () => {
    const items = brief({
      services: [
        svc({ bookingId: "live", status: "in_progress", alerts: 2, scheduledAt: iso(-2 * HOUR) }),
      ],
    });
    expect(items[0]).toMatchObject({
      id: "service_alert:live",
      priority: "critical",
      title: "Alerta en tu servicio con Laura Pérez",
      cta: { label: "Ver el parte", target: { kind: "service", bookingId: "live" } },
    });
    expect(items[0].detail).toBe("2 alertas registradas en el parte de hoy. Revísalo ahora.");
    expect(proHeadline(items)).toEqual({ text: "1 cosa urgente para mirar ahora", tone: "alert" });
  });

  it("un servicio en curso sin alertas es solo informativo", () => {
    const items = brief({ services: [svc({ status: "in_progress" })] });
    expect(items[0]).toMatchObject({ id: "service_live:b1", priority: "low" });
  });

  it("uno confirmado que empieza en las próximas 3 horas pide atención", () => {
    expect(PRO_SERVICE_SOON_HOURS).toBe(3);
    const items = brief({ services: [svc({ scheduledAt: iso(2 * HOUR) })] });
    expect(items[0]).toMatchObject({ id: "service_soon:b1", priority: "high" });
    expect(items[0].title).toBe("Tu servicio con Laura Pérez es hoy a las 12:00");
    // justo a las 3 h todavía entra; un minuto más, ya es «próximo»
    expect(ids(brief({ services: [svc({ scheduledAt: iso(3 * HOUR) })] }))).toEqual([
      "service_soon:b1",
    ]);
    expect(ids(brief({ services: [svc({ scheduledAt: iso(3 * HOUR + MIN) })] }))).toEqual([
      "service_next:b1",
    ]);
  });

  it("de 3 a 24 horas es solo «tu próximo servicio»; más lejos no se menciona", () => {
    expect(PRO_SERVICE_NEXT_HOURS).toBe(24);
    const next = brief({ services: [svc({ scheduledAt: iso(20 * HOUR) })] });
    expect(next[0]).toMatchObject({ id: "service_next:b1", priority: "low" });
    expect(next[0].title).toBe("Tu próximo servicio: Laura Pérez, mañana a las 06:00");
    expect(ids(brief({ services: [svc({ scheduledAt: iso(24 * HOUR) })] }))).toEqual([
      "service_next:b1",
    ]);
    expect(ids(brief({ services: [svc({ scheduledAt: iso(24 * HOUR + MIN) })] }))).toEqual([]);
  });

  it("si la hora ya pasó y no empezó: con 15 min de gracia sigue siendo «es hoy»; después, «ya debería haber empezado»", () => {
    expect(PRO_LATE_GRACE_MIN).toBe(15);
    const within = brief({ services: [svc({ scheduledAt: iso(-14 * MIN) })] });
    expect(within[0]).toMatchObject({ id: "service_soon:b1", priority: "high" });
    const late = brief({ services: [svc({ scheduledAt: iso(-16 * MIN) })] });
    expect(late[0]).toMatchObject({ id: "service_late:b1", priority: "high" });
    expect(late[0].title).toBe("Tu servicio con Laura Pérez ya debería haber empezado");
    // exactamente 15 min: ni «es hoy» ni «ya debería» (el borde no se duplica)
    expect(ids(brief({ services: [svc({ scheduledAt: iso(-15 * MIN) })] }))).toEqual([]);
  });

  it("un servicio sin iniciar de hace más de 12 horas es un dato viejo: no se alarma", () => {
    expect(ids(brief({ services: [svc({ scheduledAt: iso(-13 * HOUR) })] }))).toEqual([]);
    expect(ids(brief({ services: [svc({ scheduledAt: iso(-12 * HOUR) })] }))).toEqual([
      "service_late:b1",
    ]);
  });

  it("quien ya va en camino no recibe el aviso de «ya debería haber empezado» aunque la hora haya pasado", () => {
    const items = brief({ services: [svc({ status: "in_route", scheduledAt: iso(-30 * MIN) })] });
    expect(items[0].title).toBe("Vas en camino a tu servicio con Laura Pérez");
    expect(ids(items)).not.toContain("service_late:b1");
  });

  it("si va en camino, se le acompaña con calma (no es una alarma)", () => {
    const items = brief({ services: [svc({ status: "in_route", scheduledAt: iso(-5 * MIN) })] });
    expect(items[0]).toMatchObject({ id: "service_soon:b1", priority: "medium" });
    expect(items[0].title).toBe("Vas en camino a tu servicio con Laura Pérez");
  });

  it("sin nombre de la contraparte usa una palabra neutra, nunca «undefined»", () => {
    const items = brief({ services: [svc({ counterpartName: null, scheduledAt: iso(HOUR) })] });
    expect(items[0].title).toContain("tu paciente");
    expect(JSON.stringify(items)).not.toMatch(/undefined|null|NaN/);
  });

  it("los servicios con fecha dañada se ignoran", () => {
    expect(ids(brief({ services: [svc({ scheduledAt: "no-es-fecha" })] }))).toEqual([]);
  });
});

describe("propuestas de familias", () => {
  it("solo esperan respuesta las pendientes, de la familia y sin vencer", () => {
    const items = brief({
      proposals: [
        prop({ id: "ok" }),
        prop({ id: "mia", proposedBy: "professional" }),
        prop({ id: "vencida", expiresAt: iso(-HOUR) }),
        prop({ id: "aceptada", status: "accepted" }),
      ],
    });
    expect(ids(items)).toEqual(["proposals_waiting"]);
    expect(items[0].title).toBe("1 propuesta de una familia espera tu respuesta");
    expect(items[0].priority).toBe("medium");
  });

  it("una propuesta que no viene de la familia (ni de nadie conocido) no espera tu respuesta", () => {
    expect(ids(brief({ proposals: [prop({ proposedBy: "system" })] }))).toEqual([]);
    expect(ids(brief({ proposals: [prop({ proposedBy: "professional" })] }))).toEqual([]);
  });

  it("una que vence en 6 h o menos sube a prioridad alta con cuenta regresiva", () => {
    expect(PRO_PROPOSAL_URGENT_HOURS).toBe(6);
    const items = brief({ proposals: [prop({ expiresAt: iso(2 * HOUR) })] });
    expect(items[0]).toMatchObject({ id: "proposal_expiring", priority: "high" });
    expect(items[0].title).toBe("Responde antes de que venza: Marta Ruiz");
    expect(items[0].detail).toBe("Vence en 2 h. Responder rápido genera confianza.");
    expect(ids(brief({ proposals: [prop({ expiresAt: iso(6 * HOUR + MIN) })] }))).toEqual([
      "proposals_waiting",
    ]);
    expect(ids(brief({ proposals: [prop({ expiresAt: iso(6 * HOUR) })] }))).toEqual([
      "proposal_expiring",
    ]);
  });

  it("varias urgentes se agrupan y avisan la primera que vence; el resto queda como pendiente", () => {
    const items = brief({
      proposals: [
        prop({ id: "a", expiresAt: iso(4 * HOUR), peerName: "A" }),
        prop({ id: "b", expiresAt: iso(HOUR), peerName: "B" }),
        prop({ id: "c", expiresAt: iso(30 * HOUR), peerName: "C" }),
      ],
    });
    expect(ids(items)).toEqual(["proposal_expiring", "proposals_waiting"]);
    expect(items[0].title).toBe("2 propuestas de familias vencen pronto");
    expect(items[0].detail).toBe("La primera vence en 1 h. Responder rápido genera confianza.");
  });

  it("una propuesta sin fecha de vencimiento espera, pero no es urgente", () => {
    expect(ids(brief({ proposals: [prop({ expiresAt: null })] }))).toEqual(["proposals_waiting"]);
  });
});

describe("contraofertas de instituciones", () => {
  it("las que vencen en 12 h o menos son urgentes; las demás esperan", () => {
    expect(PRO_COUNTER_URGENT_HOURS).toBe(12);
    const urgent = brief({ counters: [ctr({ expiresAt: iso(5 * HOUR) })] });
    expect(urgent[0]).toMatchObject({ id: "counter_expiring", priority: "high" });
    expect(urgent[0].title).toBe("Una contraoferta vence pronto: Clínica del Norte");
    expect(urgent[0].cta.target).toEqual({ kind: "counters" });
    expect(ids(brief({ counters: [ctr({ expiresAt: iso(12 * HOUR + MIN) })] }))).toEqual([
      "counters_waiting",
    ]);
    expect(ids(brief({ counters: [ctr({ expiresAt: iso(12 * HOUR) })] }))).toEqual([
      "counter_expiring",
    ]);
  });

  it("las vencidas no cuentan y los plurales se escriben bien", () => {
    expect(ids(brief({ counters: [ctr({ expiresAt: iso(-HOUR) })] }))).toEqual([]);
    const two = brief({ counters: [ctr({ id: "x" }), ctr({ id: "y" })] });
    expect(two[0].title).toBe("2 contraofertas esperan tu respuesta");
    expect(
      brief({
        counters: [
          ctr({ id: "x", expiresAt: iso(HOUR) }),
          ctr({ id: "y", expiresAt: iso(2 * HOUR) }),
        ],
      })[0].title,
    ).toBe("2 contraofertas vencen pronto");
  });
});

describe("agenda y descanso", () => {
  const work = (over: Partial<NonNullable<ProSnapshot["workload"]>> = {}) => ({
    level: "ok" as const,
    runLength: 0,
    nextRestLabel: "domingo 18 de octubre",
    nextRestIsToday: false,
    overlapsAhead: 0,
    ...over,
  });

  it("sin datos de carga o con carga normal no se dice nada", () => {
    expect(ids(brief({ workload: null }))).toEqual([]);
    expect(ids(brief({ workload: work() }))).toEqual([]);
  });

  it("un solo cruce ya cuenta y se escribe en singular", () => {
    expect(brief({ workload: work({ overlapsAhead: 1 }) })[0].title).toBe(
      "1 servicio se cruza con otro en tu agenda",
    );
  });

  it("servicios que se cruzan son prioridad alta", () => {
    const items = brief({ workload: work({ overlapsAhead: 2 }) });
    expect(items[0]).toMatchObject({ id: "overlap", priority: "high" });
    expect(items[0].title).toBe("2 servicios se cruzan con otro en tu agenda");
    expect(items[0].cta.target).toEqual({ kind: "agenda" });
  });

  it("carga alta: invita a descansar con el día libre sugerido; con plan lleva a «mi carga»", () => {
    const items = brief({ workload: work({ level: "high", runLength: 8 }) });
    expect(items[0]).toMatchObject({ id: "rest_high", priority: "high" });
    expect(items[0].title).toBe("Llevas 8 días seguidos: tu descanso también cuenta");
    expect(items[0].detail).toBe(
      "El domingo 18 de octubre no tienes servicios: puede ser tu descanso.",
    );
    expect(items[0].cta).toEqual({ label: "Ver mi carga", target: { kind: "rest" } });
  });

  it("el aviso de descanso es gratis: sin plan se queda en la agenda, sin candado", () => {
    const items = brief({
      premium: false,
      workload: work({ level: "high", runLength: 8 }),
      completedServices: 0,
    });
    expect(items[0].cta).toEqual({ label: "Ver mi agenda", target: { kind: "agenda" } });
  });

  it("a los 7 días seguidos ya se nombra la racha; con 6 todavía se habla de la semana", () => {
    expect(brief({ workload: work({ level: "high", runLength: 7 }) })[0].title).toBe(
      "Llevas 7 días seguidos: tu descanso también cuenta",
    );
    expect(brief({ workload: work({ level: "high", runLength: 6 }) })[0].title).toBe(
      "Tu carga de esta semana es muy alta: cuídate",
    );
  });

  it("carga alta sin racha larga habla de la semana; «atención» es prioridad media", () => {
    const high = brief({ workload: work({ level: "high", runLength: 3 }) });
    expect(high[0].title).toBe("Tu carga de esta semana es muy alta: cuídate");
    const watch = brief({ workload: work({ level: "watch", runLength: 5 }) });
    expect(watch[0]).toMatchObject({ id: "rest_watch", priority: "medium" });
    expect(watch[0].title).toBe("Llevas 5 días seguidos con servicios");
    const watchWeek = brief({ workload: work({ level: "watch", runLength: 2 }) });
    expect(watchWeek[0].title).toBe("Tu semana viene cargada: planea un descanso");
  });

  it("si hoy mismo es libre se celebra; si no hay ningún día libre, se dice con claridad", () => {
    const today = brief({ workload: work({ level: "watch", nextRestIsToday: true }) });
    expect(today[0].detail).toBe("Hoy no tienes servicios: aprovecha para descansar.");
    const none = brief({ workload: work({ level: "watch", nextRestLabel: null }) });
    expect(none[0].detail).toMatch(/No tienes un día libre/);
  });
});

describe("por calificar, perfil y turnos", () => {
  it("los servicios por calificar caducan a los 14 días; sin fecha todavía se invita", () => {
    expect(PRO_RATING_WINDOW_DAYS).toBe(14);
    const items = brief({
      unrated: [
        { bookingId: "a", peerName: "A", completedAt: iso(-3 * DAY) },
        { bookingId: "b", peerName: "B", completedAt: iso(-14 * DAY) },
        { bookingId: "c", peerName: "C", completedAt: iso(-15 * DAY) },
        { bookingId: "d", peerName: "D", completedAt: null },
      ],
    });
    expect(one(items, "unrated").title).toBe("3 servicios por calificar");
    expect(
      brief({ unrated: [{ bookingId: "a", peerName: null, completedAt: iso(-DAY) }] })[0].title,
    ).toBe("1 servicio por calificar");
  });

  it("verificación pendiente solo si se sabe que no está verificado (null no alarma)", () => {
    expect(ids(brief({ profile: { completionPct: 100, verified: false, hasRate: true } }))).toEqual(
      ["verification"],
    );
    expect(ids(brief({ profile: { completionPct: 100, verified: null, hasRate: true } }))).toEqual(
      [],
    );
  });

  it("perfil por debajo de 70 % se señala; 70 % no", () => {
    expect(PRO_PROFILE_LOW_PCT).toBe(70);
    const low = brief({ profile: { completionPct: 69.6, verified: true, hasRate: true } });
    expect(low[0]).toMatchObject({ id: "profile_incomplete" });
    expect(low[0].title).toBe("Tu perfil está al 70 %");
    expect(ids(brief({ profile: { completionPct: 70, verified: true, hasRate: true } }))).toEqual(
      [],
    );
  });

  it("sin tarifa publicada se le sugiere ponerla", () => {
    expect(ids(brief({ profile: { completionPct: 100, verified: true, hasRate: false } }))).toEqual(
      ["no_rate"],
    );
  });

  it("turnos excelentes suben a prioridad media; solo compatibles, baja; sin datos, nada", () => {
    const good = brief({ opportunities: { fits: 5, excellent: 2 } });
    expect(good[0]).toMatchObject({ id: "opportunities_excellent", priority: "medium" });
    expect(good[0].title).toBe("2 turnos excelentes para ti");
    const some = brief({ opportunities: { fits: 3, excellent: 0 } });
    expect(some[0]).toMatchObject({ id: "opportunities", priority: "low" });
    expect(some[0].title).toBe("3 turnos compatibles con tu agenda");
    expect(brief({ opportunities: { fits: 1, excellent: 0 } })[0].title).toBe(
      "1 turno compatible con tu agenda",
    );
    expect(ids(brief({ opportunities: { fits: 0, excellent: 0 } }))).toEqual([]);
    expect(ids(brief({ opportunities: null }))).toEqual([]);
    expect(brief({ opportunities: { fits: 1, excellent: 1 } })[0].title).toBe(
      "1 turno excelente para ti",
    );
  });
});

describe("lo bueno y el plan", () => {
  it("los «gracias» se celebran y cambian la frase del encabezado cuando todo lo demás está en orden", () => {
    const items = brief({ kudosThisWeek: 3 });
    expect(items[0]).toMatchObject({ id: "kudos_new", priority: "low" });
    expect(items[0].title).toBe("3 personas te dieron las gracias esta semana");
    expect(proHeadline(items)).toEqual({
      text: "Todo en orden, y alguien te dio las gracias",
      tone: "calm",
    });
    expect(brief({ kudosThisWeek: 1 })[0].title).toBe("1 persona te dio las gracias esta semana");
  });

  it("si hay algo urgente, el encabezado habla de lo urgente aunque haya «gracias»", () => {
    const items = brief({
      kudosThisWeek: 2,
      services: [svc({ status: "in_progress", alerts: 1 })],
    });
    expect(proHeadline(items).tone).toBe("alert");
  });

  it("quien paga comisión ve su dato real y una invitación honesta; la suscripción es en la web", () => {
    const items = brief({ premium: false, commissionMonth: 54_000 });
    expect(ids(items)).toEqual(["commission_hint"]);
    expect(items[0].title).toBe("Este mes llevas $ 54.000 en comisión");
    expect(items[0].detail).toMatch(/página web/);
    expect(items[0].cta.target).toEqual({ kind: "plans" });
  });

  it("no hay invitaciones para quien ya tiene el plan, aunque tenga comisión registrada", () => {
    expect(ids(brief({ premium: true, commissionMonth: 54_000 }))).toEqual([]);
  });

  it("la invitación genérica no aparece si ya se mostró la de comisión", () => {
    const items = brief({ premium: false, commissionMonth: 10_000, completedServices: 9 });
    expect(ids(items)).toEqual(["commission_hint"]);
  });
});

describe("orden y cifras", () => {
  it("la prioridad manda; a igual prioridad, lo que ocurre o vence antes; luego el lugar de la regla", () => {
    const items = brief({
      services: [
        svc({ bookingId: "soon", scheduledAt: iso(2 * HOUR) }),
        svc({ bookingId: "alert", status: "in_progress", alerts: 1, scheduledAt: iso(-3 * HOUR) }),
      ],
      proposals: [prop({ expiresAt: iso(HOUR) })],
      kudosThisWeek: 1,
      profile: { completionPct: 50, verified: false, hasRate: true },
    });
    expect(ids(items)).toEqual([
      "service_alert:alert",
      "proposal_expiring", // vence en 1 h: antes que el servicio de dentro de 2 h
      "service_soon:soon",
      "verification",
      "profile_incomplete",
      "kudos_new",
    ]);
  });

  it("a igual prioridad y sin hora, decide el lugar de la regla (medios y bajos)", () => {
    const items = brief({
      premium: false,
      commissionMonth: 12_000,
      services: [svc({ bookingId: "live", status: "in_progress" })],
      proposals: [prop({ expiresAt: iso(40 * HOUR) })],
      counters: [ctr()],
      unrated: [{ bookingId: "u", peerName: null, completedAt: iso(-DAY) }],
      workload: {
        level: "watch",
        runLength: 5,
        nextRestLabel: null,
        nextRestIsToday: false,
        overlapsAhead: 0,
      },
      profile: { completionPct: 40, verified: false, hasRate: false },
      opportunities: { fits: 4, excellent: 1 },
      kudosThisWeek: 2,
    });
    expect(ids(items)).toEqual([
      "proposals_waiting",
      "counters_waiting",
      "opportunities_excellent",
      "unrated",
      "verification",
      "profile_incomplete",
      "rest_watch",
      "service_live:live", // tiene hora: va antes que los avisos sin hora de su misma prioridad
      "no_rate",
      "kudos_new",
      "commission_hint",
    ]);
  });

  it("cifras del encabezado: en curso, programados y por responder", () => {
    const stats = proHeroStats(
      snap({
        services: [
          svc({ bookingId: "a", status: "in_progress" }),
          svc({ bookingId: "b", status: "confirmed" }),
          svc({ bookingId: "c", status: "in_route" }),
        ],
        proposals: [
          prop({ id: "1" }),
          prop({ id: "2", proposedBy: "professional" }),
          prop({ id: "3", expiresAt: iso(-HOUR) }),
        ],
        counters: [ctr({ id: "x" }), ctr({ id: "y", expiresAt: iso(-HOUR) })],
      }),
    );
    expect(stats).toEqual([
      { label: "En curso", value: 1 },
      { label: "Programados", value: 2 },
      { label: "Por responder", value: 2 },
    ]);
  });

  it("las cifras de «por responder» coinciden con lo que la lista anuncia", () => {
    const s = snap({ proposals: [prop({ id: "1" }), prop({ id: "2" })], counters: [ctr()] });
    expect(proHeroStats(s)[2].value).toBe(3);
    const items = buildProBrief(s);
    expect(items.map((i) => i.id)).toEqual(["proposals_waiting", "counters_waiting"]);
  });

  it("los encabezados cuentan lo urgente y lo que pide atención, con plurales", () => {
    expect(
      proHeadline(
        brief({
          services: [
            svc({ status: "in_progress", alerts: 1 }),
            svc({ bookingId: "z", status: "in_progress", alerts: 3 }),
          ],
        }),
      ).text,
    ).toBe("2 cosas urgentes para mirar ahora");
    expect(proHeadline(brief({ proposals: [prop({ expiresAt: iso(HOUR) })] })).text).toBe(
      "1 cosa pide tu atención hoy",
    );
  });

  it("propiedad: con fotos al azar nunca hay textos rotos, ids repetidos, pagos ni WhatsApp, y el orden respeta la prioridad", () => {
    const rnd = mulberry32(2026);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    for (let i = 0; i < 300; i++) {
      const items = buildProBrief(
        snap({
          services: Array.from({ length: Math.floor(rnd() * 4) }, (_, k) =>
            svc({
              bookingId: `s${k}`,
              status: ["confirmed", "in_route", "in_progress"][Math.floor(rnd() * 3)],
              scheduledAt: iso(Math.floor((rnd() * 40 - 14) * HOUR)),
              alerts: Math.floor(rnd() * 3),
              counterpartName: rnd() < 0.3 ? null : "Laura",
            }),
          ),
          proposals: Array.from({ length: Math.floor(rnd() * 4) }, (_, k) =>
            prop({
              id: `p${k}`,
              status: rnd() < 0.2 ? "accepted" : "pending",
              proposedBy: rnd() < 0.2 ? "professional" : "family",
              expiresAt: rnd() < 0.2 ? null : iso(Math.floor((rnd() * 50 - 5) * HOUR)),
            }),
          ),
          counters: Array.from({ length: Math.floor(rnd() * 3) }, (_, k) =>
            ctr({
              id: `c${k}`,
              expiresAt: rnd() < 0.2 ? null : iso(Math.floor((rnd() * 40 - 3) * HOUR)),
            }),
          ),
          unrated: Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => ({
            bookingId: `u${k}`,
            peerName: null,
            completedAt: rnd() < 0.2 ? null : iso(-Math.floor(rnd() * 30) * DAY),
          })),
          workload:
            rnd() < 0.3
              ? null
              : {
                  level: (["ok", "watch", "high"] as const)[Math.floor(rnd() * 3)],
                  runLength: Math.floor(rnd() * 10),
                  nextRestLabel: rnd() < 0.3 ? null : "sábado 17 de octubre",
                  nextRestIsToday: rnd() < 0.3,
                  overlapsAhead: Math.floor(rnd() * 3),
                },
          profile: {
            completionPct: Math.floor(rnd() * 101),
            verified: [true, false, null][Math.floor(rnd() * 3)],
            hasRate: rnd() < 0.7,
          },
          opportunities:
            rnd() < 0.3 ? null : { fits: Math.floor(rnd() * 6), excellent: Math.floor(rnd() * 3) },
          kudosThisWeek: Math.floor(rnd() * 4),
          completedServices: Math.floor(rnd() * 8),
          premium: rnd() < 0.5,
          commissionMonth: rnd() < 0.5 ? 0 : Math.floor(rnd() * 90_000),
        }),
      );
      const text = JSON.stringify(items);
      expect(text).not.toMatch(/NaN|Infinity|undefined|\[object|null/);
      expect(text).not.toMatch(/whatsapp|transferencia|efectivo|consigna/i);
      expect(new Set(ids(items)).size).toBe(items.length);
      for (let k = 1; k < items.length; k++)
        expect(rank[items[k - 1].priority]).toBeLessThanOrEqual(rank[items[k].priority]);
      for (const it of items) {
        expect(it.title.length).toBeGreaterThan(0);
        expect(it.cta.label.length).toBeGreaterThan(0);
      }
    }
  });
});
