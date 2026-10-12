import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  MIN_SAMPLE_SMALL,
  REVIEW_LIMIT,
  THRESHOLDS,
  buildQualityReport,
  qualityHeadline,
  signedBookingIds,
  statusOf,
  type QualityInput,
  type QualityKey,
} from "./instQuality";
import type { InstBooking } from "./instData";
import { ahead, cancelled, contractOf, dayAt, ib, late, logFor } from "./instIntel.fixture";
import { DAY, HOUR, NOW, mulberry32 } from "./intel.fixture";
import { resolvePeriod } from "./intelShared";
import { formatCOP } from "./pricing";
import { CANCEL_REASONS } from "./serviceCancel";

const period = resolvePeriod("90d", NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const run = (over: Partial<QualityInput> = {}) =>
  buildQualityReport({
    bookings: [],
    logs: null,
    contractShifts: null,
    pros: null,
    period,
    now: NOW,
    ...over,
  });
const metric = (r: ReturnType<typeof run>, key: QualityKey) =>
  r.metrics.find((m) => m.key === key)!;
const ids = (r: ReturnType<typeof run>) => r.insights.map((i) => i.id);
/** n servicios terminados en los últimos n días (uno por día). */
const many = (n: number, make: (daysAgo: number) => InstBooking = (d) => ib(d)) =>
  Array.from({ length: n }, (_, i) => make(i + 1));
const PRO_CANCEL = CANCEL_REASONS.professional[0].label;
const CLIENT_CANCEL = CANCEL_REASONS.client[0].label;

describe("semáforo de cada indicador", () => {
  it("sin dato es «sin datos»; en la meta, verde; entre la meta y el piso, amarillo; debajo, rojo", () => {
    for (const key of Object.keys(THRESHOLDS) as QualityKey[]) {
      const { ok, watch } = THRESHOLDS[key];
      expect(statusOf(key, null)).toBe("unknown");
      expect(statusOf(key, 100)).toBe("ok");
      expect(statusOf(key, ok)).toBe("ok");
      expect(statusOf(key, ok - 1)).toBe("watch");
      expect(statusOf(key, watch)).toBe("watch");
      expect(statusOf(key, watch - 1)).toBe("alert");
      expect(statusOf(key, 0)).toBe("alert");
    }
  });

  it("las metas son las del producto (decisión de negocio escrita a propósito, no derivada)", () => {
    expect(THRESHOLDS).toEqual({
      reliability: { ok: 92, watch: 80 },
      punctuality: { ok: 90, watch: 75 },
      hours_logged: { ok: 95, watch: 85 },
      documentation: { ok: 90, watch: 70 },
      contracts: { ok: 95, watch: 80 },
      verified: { ok: 98, watch: 85 },
    });
    expect(MIN_SAMPLE).toBe(5);
    expect(MIN_SAMPLE_SMALL).toBe(3);
    expect(REVIEW_LIMIT).toBe(5);
  });

  it("las metas son coherentes: el verde nunca queda por debajo del amarillo", () => {
    for (const key of Object.keys(THRESHOLDS) as QualityKey[]) {
      expect(THRESHOLDS[key].ok).toBeGreaterThan(THRESHOLDS[key].watch);
      expect(THRESHOLDS[key].ok).toBeLessThanOrEqual(100);
    }
  });
});

describe("sin servicios", () => {
  it("lo explica y no inventa porcentajes", () => {
    const r = run();
    expect(r.hasData).toBe(false);
    expect(r.metrics).toHaveLength(6);
    expect(r.metrics.every((m) => m.value === null && m.status === "unknown")).toBe(true);
    expect(r.counts).toEqual({ ok: 0, watch: 0, alert: 0, unknown: 6 });
    expect(r.level).toBe("unknown");
    expect(r.headline).toBe("Aún no hay servicios en este periodo para medir.");
    expect(ids(r)).toEqual(["no_data"]);
    expect(r.incidents).toBeNull();
    expect(r.services.due).toBe(0);
  });

  it("los servicios fuera del periodo o por venir no cuentan", () => {
    const r = run({ bookings: [ib(120), ahead(2), ib(3, { status: "pending" })] });
    expect(r.hasData).toBe(false);
  });
});

describe("muestra mínima", () => {
  it("con menos de 5 llegadas no hay porcentaje de puntualidad; con 5 sí", () => {
    const four = metric(run({ bookings: many(MIN_SAMPLE - 1) }), "punctuality");
    expect(four.value).toBeNull();
    expect(four.status).toBe("unknown");
    expect(four.sample).toBe(MIN_SAMPLE - 1);
    expect(four.detail).toContain("al menos 5 y hay 4");
    const five = metric(run({ bookings: many(MIN_SAMPLE) }), "punctuality");
    expect(five.value).toBe(100);
    expect(five.status).toBe("ok");
  });
});

describe("puntualidad", () => {
  it("hasta 10 min de margen es puntual; 11 min ya es tarde", () => {
    const rows = [...many(5, (d) => ib(d)), late(ib(6), 10), late(ib(7), 11), late(ib(8), 45)];
    const r = run({ bookings: rows });
    expect(r.punctuality).toMatchObject({ onTime: 6, late: 2, veryLate: 1 });
    expect(metric(r, "punctuality").value).toBe(75); // 6 de 8
    expect(metric(r, "punctuality").status).toBe("watch");
  });

  it("la demora típica es la mediana de las llegadas tarde", () => {
    const rows = [...many(5), late(ib(6), 15), late(ib(7), 45), late(ib(8), 20)];
    expect(run({ bookings: rows }).punctuality.medianLateMin).toBe(20);
    expect(
      run({ bookings: [...many(5), late(ib(6), 15), late(ib(7), 45)] }).punctuality.medianLateMin,
    ).toBe(30);
    expect(run({ bookings: many(5) }).punctuality.medianLateMin).toBeNull();
  });

  it("la demora típica se redondea al minuto", () => {
    const r = run({ bookings: [...many(5), late(ib(6), 15), late(ib(7), 40)] });
    expect(r.punctuality.medianLateMin).toBe(28); // mediana de 15 y 40 = 27,5
  });

  it("más de 30 min es «muy tarde»; exactamente 30 no", () => {
    const r = run({ bookings: [...many(5), late(ib(6), 30), late(ib(7), 31)] });
    expect(r.punctuality.late).toBe(2);
    expect(r.punctuality.veryLate).toBe(1);
  });

  it("los servicios sin hora de llegada ni de inicio no entran en la muestra", () => {
    const blind = many(3, (d) => ib(d, { arrived_at: null, started_at: null }));
    const r = run({ bookings: [...many(5), ...blind] });
    expect(metric(r, "punctuality").sample).toBe(5);
  });

  it("un servicio en curso con llegada registrada también cuenta", () => {
    const live = ib(1, { status: "in_progress", completed_at: null });
    const r = run({ bookings: [...many(4, (d) => ib(d + 1)), live] });
    expect(metric(r, "punctuality").sample).toBe(5);
  });

  it("90 % es verde y 89 % amarillo, con la muestra de 100 servicios", () => {
    const base = Array.from({ length: 100 }, (_, i) => ib((i % 80) + 1));
    const ninety = base.map((b, i) => (i < 10 ? late(b, 40) : b));
    expect(metric(run({ bookings: ninety }), "punctuality").status).toBe("ok");
    const eightyNine = base.map((b, i) => (i < 11 ? late(b, 40) : b));
    expect(metric(run({ bookings: eightyNine }), "punctuality").status).toBe("watch");
  });
});

describe("turnos cumplidos", () => {
  it("cuenta contra el profesional sus cancelaciones y los servicios que nunca iniciaron", () => {
    const rows = [
      ...many(8),
      cancelled(9, PRO_CANCEL),
      ahead(0, { scheduled_at: iso(NOW - 3 * HOUR) }), // confirmado, sin inicio, hace 3 h
    ];
    const r = run({ bookings: rows });
    expect(r.services).toMatchObject({
      completed: 8,
      cancelledByProfessional: 1,
      unstarted: 1,
    });
    expect(metric(r, "reliability").value).toBe(80); // 8 de 10
    expect(metric(r, "reliability").status).toBe("watch");
  });

  it("las cancelaciones de la propia institución o de motivo desconocido no lo bajan", () => {
    const rows = [
      ...many(5),
      cancelled(6, CLIENT_CANCEL),
      cancelled(7, CLIENT_CANCEL),
      cancelled(8, "Me salió algo"),
      cancelled(9, null),
    ];
    const r = run({ bookings: rows });
    expect(r.services.cancelled).toBe(4);
    expect(r.services.cancelledByInstitution).toBe(2);
    expect(r.services.cancelledUnknown).toBe(2);
    expect(metric(r, "reliability").value).toBe(100);
  });

  it("los 92 % de la meta se cumplen con 23 de 25", () => {
    const rows = [...many(23, (d) => ib(d)), cancelled(24, PRO_CANCEL), cancelled(25, PRO_CANCEL)];
    expect(metric(run({ bookings: rows }), "reliability").value).toBe(92);
    expect(metric(run({ bookings: rows }), "reliability").status).toBe("ok");
    const worse = [
      ...many(22, (d) => ib(d)),
      cancelled(24, PRO_CANCEL),
      cancelled(25, PRO_CANCEL),
      cancelled(26, PRO_CANCEL),
    ];
    expect(metric(run({ bookings: worse }), "reliability").value).toBe(88);
  });

  it("con menos de 5 turnos en la base no hay porcentaje", () => {
    const r = run({ bookings: [...many(3), cancelled(4, PRO_CANCEL)] });
    expect(metric(r, "reliability").value).toBeNull();
    expect(metric(r, "reliability").sample).toBe(4);
  });
});

describe("horas registradas", () => {
  const worked = (daysAgo: number, hours: number) =>
    ib(daysAgo, {
      completed_at: iso(new Date(ib(daysAgo).scheduled_at).getTime() + hours * HOUR),
    });

  it("compara las horas del parte con las contratadas y marca los servicios cortos", () => {
    const rows = [...many(4), worked(5, 3)];
    const r = run({ bookings: rows });
    expect(metric(r, "hours_logged").value).toBe(90); // 27 de 30 h
    expect(metric(r, "hours_logged").status).toBe("watch");
    expect(r.hours).toMatchObject({
      contracted: 30,
      worked: 27,
      shortServices: 1,
      unloggedHours: 3,
      valueAtStake: 75_000,
    });
    expect(r.review.short).toHaveLength(1);
    expect(r.review.short[0]).toMatchObject({ contracted: 6, worked: 3, value: 75_000 });
  });

  it("solo es «corto» por debajo del 80 % y con al menos 1 h de diferencia", () => {
    const r = run({
      bookings: [
        ...many(5),
        worked(6, 4.8), // justo 80 %: no
        worked(7, 4.7), // 78 %: sí
        worked(8, 5.5), // 92 %: no
        ib(9, {
          duration_hours: 2,
          completed_at: iso(new Date(ib(9).scheduled_at).getTime() + 1.5 * HOUR),
        }), // 75 % pero faltan 0,5 h: no
      ],
    });
    expect(r.hours.shortServices).toBe(1);
    expect(r.review.short[0].worked).toBe(4.7);
  });

  it("una diferencia de exactamente 1 h ya se revisa si además es menos del 80 %", () => {
    const hrs = (d: number, contracted: number, hours: number) =>
      ib(d, {
        duration_hours: contracted,
        completed_at: iso(new Date(ib(d).scheduled_at).getTime() + hours * HOUR),
      });
    // 3 h contratadas y 2 registradas: 67 % y 1 h de diferencia → se revisa
    expect(run({ bookings: [...many(4), hrs(5, 3, 2)] }).hours.shortServices).toBe(1);
    // 3 h contratadas y 2,01 registradas: 67 % pero 0,99 h de diferencia → no
    expect(run({ bookings: [...many(4), hrs(5, 3, 2.01)] }).hours.shortServices).toBe(0);
  });

  it("las horas de más no compensan las de menos", () => {
    const r = run({ bookings: [...many(4), worked(5, 8)] });
    // 4 × 6 h + min(8, 6) = 30 de 30
    expect(metric(r, "hours_logged").value).toBe(100);
  });

  it("los servicios sin inicio o cierre registrados no entran", () => {
    const blind = many(3, (d) => ib(d + 10, { started_at: null }));
    const r = run({ bookings: [...many(5), ...blind] });
    expect(metric(r, "hours_logged").sample).toBe(5);
  });

  it("el valor usa la tarifa del servicio o, si falta, el total entre las horas", () => {
    const noRate = ib(5, {
      hourly_rate: null,
      total_amount: 120_000,
      duration_hours: 6,
      completed_at: iso(new Date(ib(5).scheduled_at).getTime() + 2 * HOUR),
    });
    const r = run({ bookings: [...many(4), noRate] });
    expect(r.review.short[0].value).toBe(Math.round(4 * 20_000));
  });
});

describe("documentación del turno", () => {
  it("sin el parte cargado es «sin datos», no 0 %", () => {
    const r = run({ bookings: many(6), logs: null });
    const m = metric(r, "documentation");
    expect(m.value).toBeNull();
    expect(m.status).toBe("unknown");
    expect(m.detail).toBe("Todavía no se cargaron estos datos.");
  });

  it("cuenta los servicios terminados con al menos un registro del parte", () => {
    const rows = many(10);
    const withLogs = rows.slice(0, 8).map((b) => logFor(b.id));
    const r = run({ bookings: rows, logs: { rows: withLogs, queried: rows.map((b) => b.id) } });
    expect(metric(r, "documentation").value).toBe(80);
    expect(metric(r, "documentation").status).toBe("watch");
    expect(r.review.undocumented).toHaveLength(2);
  });

  it("60 % de servicios documentados es rojo", () => {
    const rows = many(10);
    const r = run({
      bookings: rows,
      logs: { rows: rows.slice(0, 6).map((b) => logFor(b.id)), queried: rows.map((b) => b.id) },
    });
    expect(metric(r, "documentation").value).toBe(60);
    expect(metric(r, "documentation").status).toBe("alert");
  });

  it("los servicios cuyo parte no se pidió no cuentan como «sin parte»", () => {
    const rows = many(10);
    const queried = rows.slice(0, 5).map((b) => b.id);
    const r = run({ bookings: rows, logs: { rows: queried.map((id) => logFor(id)), queried } });
    expect(metric(r, "documentation").sample).toBe(5);
    expect(metric(r, "documentation").value).toBe(100);
    expect(r.review.undocumented).toEqual([]);
  });

  it("con menos de 5 servicios consultados no hay porcentaje", () => {
    const rows = many(4);
    const r = run({ bookings: rows, logs: { rows: [], queried: rows.map((b) => b.id) } });
    expect(metric(r, "documentation").value).toBeNull();
  });
});

describe("alertas del parte", () => {
  it("cuenta las alertas y los incidentes del periodo, y en cuántos servicios pasaron", () => {
    const rows = many(6);
    const logs = [
      logFor(rows[0].id, { is_alert: true }),
      logFor(rows[0].id, { is_alert: true }),
      logFor(rows[1].id, { event_type: "incident" }),
      logFor(rows[2].id, { is_alert: false }),
      logFor(rows[3].id, { is_alert: true, created_at: iso(NOW - 200 * DAY) }), // fuera del periodo
    ];
    const r = run({ bookings: rows, logs: { rows: logs, queried: rows.map((b) => b.id) } });
    expect(r.incidents).toEqual({ count: 3, services: 2 });
    expect(ids(r)).toContain("alerts_logged");
  });

  it("sin el parte cargado no se dice nada de alertas", () => {
    expect(run({ bookings: many(6) }).incidents).toBeNull();
    expect(ids(run({ bookings: many(6) }))).not.toContain("alerts_logged");
  });

  it("sin alertas, el contador es cero y no hay hallazgo", () => {
    const rows = many(6);
    const r = run({
      bookings: rows,
      logs: { rows: rows.map((b) => logFor(b.id)), queried: rows.map((b) => b.id) },
    });
    expect(r.incidents).toEqual({ count: 0, services: 0 });
    expect(ids(r)).not.toContain("alerts_logged");
  });
});

describe("contratos firmados", () => {
  it("solo cuentan los servicios de turnos publicados y los contratos activos o completados", () => {
    const rows = [
      ...many(4, (d) => ib(d)),
      ib(5, { job_offer_id: null }), // reserva directa: no tiene contrato inteligente
      cancelled(6, PRO_CANCEL), // cancelado: no cuenta
    ];
    const shifts = [
      contractOf(rows[0].id, "active"),
      contractOf(rows[1].id, "completed"),
      contractOf(rows[2].id, "partially_signed"),
      contractOf(rows[3].id, "pending_signature"),
    ];
    const r = run({ bookings: rows, contractShifts: shifts });
    const m = metric(r, "contracts");
    expect(m.sample).toBe(4);
    expect(m.value).toBe(50);
    expect(m.status).toBe("alert");
    expect(r.review.noContract.map((x) => x.bookingId).sort()).toEqual(
      [rows[2].id, rows[3].id].sort(),
    );
    expect(ids(r)).toContain("contracts_gap");
  });

  it("sin contratos cargados es «sin datos»", () => {
    const m = metric(run({ bookings: many(6) }), "contracts");
    expect(m.status).toBe("unknown");
    expect(m.detail).toBe("Todavía no se cargaron estos datos.");
  });

  it("necesita al menos 3 servicios de turnos publicados", () => {
    const rows = many(MIN_SAMPLE_SMALL - 1);
    expect(metric(run({ bookings: rows, contractShifts: [] }), "contracts").value).toBeNull();
    const three = many(MIN_SAMPLE_SMALL);
    expect(
      metric(
        run({ bookings: three, contractShifts: three.map((b) => contractOf(b.id)) }),
        "contracts",
      ).value,
    ).toBe(100);
  });

  it("un servicio por venir sin contrato baja el porcentaje pero no es «prestado sin contrato»", () => {
    const rows = [
      ...many(3),
      ib(1, {
        status: "confirmed",
        scheduled_at: iso(NOW - HOUR),
        arrived_at: null,
        started_at: null,
        completed_at: null,
      }),
    ];
    const r = run({
      bookings: rows,
      contractShifts: rows.slice(0, 3).map((b) => contractOf(b.id)),
    });
    expect(metric(r, "contracts").value).toBe(75);
    expect(r.review.noContract).toEqual([]);
  });

  it("filas de contrato sin turno enlazado no suman", () => {
    const rows = many(3);
    const r = run({
      bookings: rows,
      contractShifts: [{ booking_id: null, contract_status: "active" }],
    });
    expect(metric(r, "contracts").value).toBe(0);
  });
});

describe("profesionales verificados", () => {
  const pros = { p1: { rethusVerified: true }, p2: { rethusVerified: false } };

  it("pesa por horas: lo que prestó cada profesional verificado sobre el total", () => {
    const rows = [
      ...many(4, (d) => ib(d, { professional_id: "p1" })),
      ...many(2, (d) => ib(d + 10, { professional_id: "p2" })),
    ];
    const r = run({ bookings: rows, pros });
    expect(metric(r, "verified").value).toBe(67); // 24 h de 36 h
    expect(metric(r, "verified").status).toBe("alert");
    expect(metric(r, "verified").sample).toBe(2);
    expect(ids(r)).toContain("unverified");
    const insight = r.insights.find((i) => i.id === "unverified")!;
    expect(insight.title).toContain(
      "1 profesional sin RETHUS verificado prestó el 33 % de las horas",
    );
  });

  it("un profesional sin perfil conocido cuenta como no verificado, y sin perfiles cargados es «sin datos»", () => {
    const rows = many(5, (d) => ib(d, { professional_id: "p9" }));
    expect(metric(run({ bookings: rows, pros: {} }), "verified").value).toBe(0);
    expect(metric(run({ bookings: rows, pros: null }), "verified").status).toBe("unknown");
  });

  it("todos verificados es verde y no genera aviso", () => {
    const rows = many(5);
    const r = run({ bookings: rows, pros: { p1: { rethusVerified: true } } });
    expect(metric(r, "verified").value).toBe(100);
    expect(ids(r)).not.toContain("unverified");
  });

  it("necesita al menos 3 servicios terminados", () => {
    expect(metric(run({ bookings: many(2), pros }), "verified").value).toBeNull();
    expect(metric(run({ bookings: many(3), pros }), "verified").value).toBe(100);
  });

  it("amarillo (90 %) también avisa, con la parte de las horas sin verificar", () => {
    const rows = [
      ...many(9, (d) => ib(d, { professional_id: "p1" })),
      ib(20, { professional_id: "p2" }),
    ];
    const r = run({ bookings: rows, pros });
    expect(metric(r, "verified").value).toBe(90);
    expect(metric(r, "verified").status).toBe("watch");
    expect(r.insights.find((i) => i.id === "unverified")!.title).toBe(
      "1 profesional sin RETHUS verificado prestó el 10 % de las horas",
    );
  });

  it("«verified» sin RETHUS no basta: se mide el RETHUS", () => {
    const rows = many(5);
    const r = run({ bookings: rows, pros: { p1: { rethusVerified: false, verified: true } } });
    expect(metric(r, "verified").value).toBe(0);
  });
});

describe("servicios sin iniciar ni cerrar", () => {
  it("se avisan con su servicio para revisar y no se ocultan aunque no haya muestra", () => {
    const stuck = ahead(0, { scheduled_at: iso(NOW - 3 * HOUR) });
    const open = ib(2, { status: "in_progress", completed_at: null });
    const r = run({ bookings: [stuck, open] });
    expect(r.services.unstarted).toBe(1);
    expect(r.services.unclosed).toBe(1);
    expect(r.review.unstarted[0]).toMatchObject({ bookingId: stuck.id, professionalId: "p1" });
    expect(r.review.unclosed[0].bookingId).toBe(open.id);
    expect(ids(r)).toEqual(expect.arrayContaining(["unstarted", "unclosed"]));
    expect(ids(r).indexOf("unstarted")).toBeLessThan(ids(r).indexOf("unclosed"));
  });
});

describe("titular y nivel", () => {
  it("rojo manda sobre amarillo y verde", () => {
    const rows = [...many(9), late(ib(10), 50)];
    const r = run({
      bookings: [...rows, ...many(10, (d) => ib(d + 20, { professional_id: "p2" }))],
      pros: { p1: { rethusVerified: true }, p2: { rethusVerified: false } },
    });
    expect(r.level).toBe("alert");
    expect(r.headline).toBe("1 indicador pide tu atención.");
  });

  it("rojo y amarillo juntos: el nivel es rojo y el titular cuenta solo los rojos", () => {
    const r = run({
      bookings: [...many(8), late(ib(9), 40), late(ib(10), 50)], // puntualidad 80 %: amarillo
      pros: { p1: { rethusVerified: false } }, // 0 % verificados: rojo
    });
    expect(metric(r, "punctuality").status).toBe("watch");
    expect(metric(r, "verified").status).toBe("alert");
    expect(r.counts).toMatchObject({ alert: 1, watch: 1 });
    expect(r.level).toBe("alert");
    expect(r.headline).toBe("1 indicador pide tu atención.");
  });

  it("sin rojos pero con amarillos: «vas bien»", () => {
    const r = run({ bookings: [...many(8), late(ib(9), 40), late(ib(10), 50)] });
    expect(metric(r, "punctuality").value).toBe(80);
    expect(metric(r, "punctuality").status).toBe("watch");
    expect(r.level).toBe("watch");
    expect(r.headline).toBe("Vas bien: 1 indicador se puede mejorar.");
  });

  it("todo en verde, con y sin indicadores sin datos", () => {
    const rows = many(8);
    const full = run({
      bookings: rows,
      logs: { rows: rows.map((b) => logFor(b.id)), queried: rows.map((b) => b.id) },
      contractShifts: rows.map((b) => contractOf(b.id)),
      pros: { p1: { rethusVerified: true } },
    });
    expect(full.counts).toEqual({ ok: 6, watch: 0, alert: 0, unknown: 0 });
    expect(full.level).toBe("ok");
    expect(full.headline).toBe("Todo en verde: cumples la meta en los seis indicadores.");
    const partial = run({ bookings: rows });
    expect(partial.headline).toMatch(
      /^Todo en verde en lo que ya se puede medir \(3 indicadores\)\.$/,
    );
    expect(ids(full)).toEqual(expect.arrayContaining(["punctual", "reliable"]));
  });

  it("sin muestra suficiente en ningún indicador lo dice", () => {
    const r = run({ bookings: many(2) });
    expect(r.hasData).toBe(true);
    expect(r.level).toBe("unknown");
    expect(r.headline).toBe(
      "Aún no hay muestra suficiente: se necesitan al menos 5 servicios por indicador.",
    );
    expect(ids(r)).toContain("thin_sample");
  });

  it("la frase del encabezado no depende de cómo se llame la función", () => {
    expect(qualityHeadline(run())).toBe("Aún no hay servicios en este periodo para medir.");
  });
});

describe("hallazgos: cuándo aparece cada uno", () => {
  const clean = () => many(8);

  it("un periodo limpio no trae avisos de falta ni de sobra", () => {
    const r = run({ bookings: clean() });
    for (const id of [
      "unstarted",
      "unclosed",
      "late_arrivals",
      "professional_cancellations",
      "hours_short",
      "docs_low",
      "contracts_gap",
      "unverified",
      "alerts_logged",
      "thin_sample",
    ]) {
      expect(ids(r), id).not.toContain(id);
    }
  });

  it("amarillo en puntualidad ya avisa de las llegadas tarde, con la demora típica", () => {
    const r = run({ bookings: [...many(8), late(ib(9), 40), late(ib(10), 50)] });
    expect(metric(r, "punctuality").status).toBe("watch");
    const i = r.insights.find((x) => x.id === "late_arrivals")!;
    expect(i.title).toBe("2 de 10 llegadas fueron tarde");
    expect(i.detail).toBe("La demora típica fue de 45 min y 2 llegadas pasaron de 30 min.");
  });

  it("amarillo en documentación avisa cuántos servicios quedaron sin parte", () => {
    const rows = many(10);
    const r = run({
      bookings: rows,
      logs: { rows: rows.slice(0, 8).map((b) => logFor(b.id)), queried: rows.map((b) => b.id) },
    });
    expect(metric(r, "documentation").status).toBe("watch");
    expect(r.insights.find((x) => x.id === "docs_low")!.title).toBe(
      "2 de 10 servicios sin parte del turno",
    );
  });

  it("las cancelaciones de profesionales avisan por su cuenta (2) o porque el cumplimiento está en rojo", () => {
    const stuck = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        ahead(0, { id: `st${i}`, scheduled_at: iso(NOW - (3 + i) * HOUR) }),
      );
    // 1 cancelación del profesional, pero 5 terminados y 3 sin iniciar: 5 de 9 = 56 % → rojo
    const red = run({ bookings: [...many(5), cancelled(6, PRO_CANCEL), ...stuck(3)] });
    expect(metric(red, "reliability").status).toBe("alert");
    expect(red.services.cancelledByProfessional).toBe(1);
    expect(ids(red)).toContain("professional_cancellations");
    // 2 cancelaciones sobre muchos servicios: el cumplimiento sigue en verde pero el aviso aparece
    const two = run({
      bookings: [...many(40), cancelled(41, PRO_CANCEL), cancelled(42, PRO_CANCEL)],
    });
    expect(metric(two, "reliability").status).toBe("ok");
    expect(ids(two)).toContain("professional_cancellations");
  });

  it("un contrato pendiente en un servicio ya prestado avisa; con todos firmados, no", () => {
    const rows = many(4);
    const signed = run({ bookings: rows, contractShifts: rows.map((b) => contractOf(b.id)) });
    expect(ids(signed)).not.toContain("contracts_gap");
    const gap = run({ bookings: rows, contractShifts: rows.slice(1).map((b) => contractOf(b.id)) });
    expect(gap.insights.find((x) => x.id === "contracts_gap")!.title).toBe(
      "1 servicio se prestó sin contrato firmado por ambas partes",
    );
  });

  it("la muestra insuficiente solo se menciona cuando ningún indicador se pudo medir", () => {
    expect(ids(run({ bookings: many(8) }))).not.toContain("thin_sample"); // 3 indicadores sí se miden
    expect(ids(run({ bookings: many(2) }))).toContain("thin_sample");
  });
});

describe("hallazgos", () => {
  it("las cancelaciones de profesionales avisan desde la segunda y proponen el plan B", () => {
    const one = run({ bookings: [...many(20), cancelled(21, PRO_CANCEL)] });
    expect(ids(one)).not.toContain("professional_cancellations");
    const two = run({
      bookings: [...many(20), cancelled(21, PRO_CANCEL), cancelled(22, PRO_CANCEL)],
    });
    const insight = two.insights.find((i) => i.id === "professional_cancellations")!;
    expect(insight.title).toBe("2 cancelaciones de profesionales en el periodo");
    expect(insight.action).toContain("equipo de confianza");
  });

  it("las horas cortas son información con un servicio y alerta desde dos, con el valor en pesos", () => {
    const short = (d: number) =>
      ib(d, { completed_at: iso(new Date(ib(d).scheduled_at).getTime() + 3 * HOUR) });
    const one = run({ bookings: [ib(1), short(2)] });
    expect(one.insights.find((i) => i.id === "hours_short")!.severity).toBe("info");
    const two = run({ bookings: [short(1), short(2)] });
    const insight = two.insights.find((i) => i.id === "hours_short")!;
    expect(insight.severity).toBe("warn");
    expect(insight.detail).toContain("6 h");
    expect(insight.detail).toContain(formatCOP(150_000));
    expect(insight.detail).toContain("no es una acusación");
  });

  it("los avisos van primero; lo bueno, al final", () => {
    const rows = [...many(8), late(ib(9), 50), late(ib(10), 50)];
    const r = run({ bookings: rows });
    const sev = r.insights.map((i) => i.severity);
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) => ["warn", "info", "good"].indexOf(a) - ["warn", "info", "good"].indexOf(b),
      ),
    );
  });

  it("los textos no hablan de pagos por fuera ni de WhatsApp", () => {
    const rows = [
      ...many(8),
      late(ib(9), 50),
      cancelled(10, PRO_CANCEL),
      cancelled(11, PRO_CANCEL),
    ];
    const r = run({
      bookings: rows,
      logs: { rows: [], queried: rows.map((b) => b.id) },
      contractShifts: [],
      pros: {},
    });
    const text = JSON.stringify(r.insights) + r.headline + JSON.stringify(r.metrics);
    expect(text).not.toMatch(/whatsapp|efectivo|transferencia|nequi|daviplata/i);
  });
});

describe("la lista para revisar", () => {
  it("muestra a lo sumo 5, de lo más reciente a lo más antiguo, venga como venga la lista", () => {
    // se arman del más antiguo al más reciente: si no se ordena, quedaría al revés
    const rows = Array.from({ length: 8 }, (_, i) =>
      ahead(0, { id: `u${i}`, scheduled_at: iso(NOW - (10 - i) * HOUR) }),
    );
    const r = run({ bookings: rows });
    expect(r.services.unstarted).toBe(8);
    expect(r.review.unstarted).toHaveLength(REVIEW_LIMIT);
    const times = r.review.unstarted.map((x) => new Date(x.scheduledAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("periodo", () => {
  it("el mes pasado solo cuenta los servicios de ese mes calendario", () => {
    const last = resolvePeriod("last_month", NOW);
    const inside = Array.from({ length: 5 }, (_, i) =>
      ib(0, {
        scheduled_at: iso(last.from + (i + 2) * DAY + 8 * HOUR),
        arrived_at: iso(last.from + (i + 2) * DAY + 8 * HOUR),
        started_at: iso(last.from + (i + 2) * DAY + 8 * HOUR),
        completed_at: iso(last.from + (i + 2) * DAY + 14 * HOUR),
      }),
    );
    const outside = many(5); // octubre
    const r = run({ bookings: [...inside, ...outside], period: last });
    expect(r.services.completed).toBe(5);
    expect(r.period.key).toBe("last_month");
  });
});

describe("propiedades con datos al azar", () => {
  it("nunca hay NaN, los porcentajes quedan entre 0 y 100 y los contadores cuadran", () => {
    const rand = mulberry32(2026);
    const statuses = [
      "completed",
      "completed",
      "completed",
      "cancelled",
      "confirmed",
      "in_progress",
      "in_route",
      "pending",
    ];
    for (let round = 0; round < 60; round++) {
      const n = Math.floor(rand() * 40);
      const rows: InstBooking[] = Array.from({ length: n }, (_, i) => {
        const status = statuses[Math.floor(rand() * statuses.length)];
        const base = ib(Math.floor(rand() * 100) - 5, {
          professional_id: `p${Math.floor(rand() * 4)}`,
          status,
        });
        const start = new Date(base.scheduled_at).getTime();
        const variant = Math.floor(rand() * 5);
        return {
          ...base,
          id: `r${round}-${i}`,
          job_offer_id: rand() < 0.7 ? "o1" : null,
          arrived_at: variant === 0 ? null : iso(start + Math.floor(rand() * 90 - 20) * MIN),
          started_at: variant === 1 ? null : iso(start + Math.floor(rand() * 60) * MIN),
          completed_at: variant === 2 ? null : iso(start + Math.floor(rand() * 9 * 60) * MIN),
          duration_hours: variant === 3 ? "abc" : 6,
          cancel_reason:
            status === "cancelled"
              ? [PRO_CANCEL, CLIENT_CANCEL, "otro", null][Math.floor(rand() * 4)]
              : null,
        };
      });
      const logs = rows
        .filter(() => rand() < 0.6)
        .map((b) => logFor(b.id, { is_alert: rand() < 0.2 }));
      const r = buildQualityReport({
        bookings: rows,
        logs: rand() < 0.8 ? { rows: logs, queried: rows.map((b) => b.id) } : null,
        contractShifts:
          rand() < 0.8 ? rows.filter(() => rand() < 0.5).map((b) => contractOf(b.id)) : null,
        pros: rand() < 0.8 ? { p0: { rethusVerified: true }, p1: { rethusVerified: false } } : null,
        period,
        now: NOW,
      });
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined/);
      for (const m of r.metrics) {
        if (m.value !== null) {
          expect(m.value).toBeGreaterThanOrEqual(0);
          expect(m.value).toBeLessThanOrEqual(100);
        }
        expect(m.status === "unknown").toBe(m.value === null);
      }
      expect(r.counts.ok + r.counts.watch + r.counts.alert + r.counts.unknown).toBe(6);
      const s = r.services;
      expect(s.completed + s.cancelled + s.unstarted + s.unclosed).toBeLessThanOrEqual(
        s.due + s.unstarted + s.unclosed,
      );
      expect(s.cancelledByProfessional + s.cancelledByInstitution + s.cancelledUnknown).toBe(
        s.cancelled,
      );
      for (const list of Object.values(r.review))
        expect(list.length).toBeLessThanOrEqual(REVIEW_LIMIT);
      expect(r.hours.valueAtStake).toBeGreaterThanOrEqual(0);
      expect(r.hours.unloggedHours).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("el día de hoy", () => {
  it("un servicio de hoy a las 08:00 ya cuenta como «debido» (son las 10:00)", () => {
    expect(dayAt(0, 8)).toBeLessThan(NOW);
    const r = run({ bookings: [ib(0, { status: "in_progress", completed_at: null })] });
    expect(r.services.due).toBe(1);
  });
});

describe("servicios con contrato firmado", () => {
  it("cuentan los contratos vigentes y los terminados", () => {
    const out = signedBookingIds([contractOf("a", "active"), contractOf("b", "completed")]);
    expect([...out].sort()).toEqual(["a", "b"]);
  });

  it("no cuentan los que aún no están firmados por ambas partes ni los que no se concretaron", () => {
    const out = signedBookingIds(
      ["draft", "pending_signature", "partially_signed", "cancelled", "expired", "rejected"].map(
        (status, i) => contractOf(`x${i}`, status),
      ),
    );
    expect(out.size).toBe(0);
  });

  it("ignora los turnos sin servicio o sin estado de contrato", () => {
    const out = signedBookingIds([
      { booking_id: null, contract_status: "active" },
      { booking_id: "a", contract_status: null },
      { booking_id: "", contract_status: "active" },
    ]);
    expect(out.size).toBe(0);
  });

  it("sin turnos, el conjunto queda vacío", () => {
    expect(signedBookingIds([]).size).toBe(0);
  });

  it("el informe de calidad usa la misma regla", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ib(i + 1));
    const signed = rows.slice(0, 3).map((b) => contractOf(b.id, "completed"));
    const pending = contractOf(rows[3].id, "pending_signature");
    const r = run({ bookings: rows, contractShifts: [...signed, pending] });
    expect(r.metrics.find((m) => m.key === "contracts")?.value).toBe(75);
  });
});

describe("horas con coma decimal", () => {
  it("las horas registradas se escriben con coma", () => {
    const rows = [1, 2, 3, 4].map((d) => ib(d)).concat([late(ib(5), 30)]); // 6 h cuatro veces y 5,5 h una vez
    expect(metric(run({ bookings: rows }), "hours_logged").detail).toBe(
      "Entre el inicio y el cierre del parte quedaron 29,5 h de 30 h contratadas.",
    );
  });

  it("las horas que faltaron en el parte se escriben con coma", () => {
    const short = (d: number) => late(ib(d), 150); // empezó 2,5 h tarde: quedaron 3,5 h de 6 h
    const r = run({ bookings: [short(1), short(2), short(3)] });
    const insight = r.insights.find((i) => i.id === "hours_short")!;
    expect(insight.detail).toContain("Faltaron 7,5 h (unos");
    expect(insight.detail).toContain(formatCOP(187_500));
  });
});
