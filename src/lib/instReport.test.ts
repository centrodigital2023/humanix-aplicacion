import { describe, expect, it } from "vitest";
import {
  buildExecutiveReport,
  csvContext,
  reportFilename,
  servicesCsv,
  type ReportInput,
} from "./instReport";
import { buildCostReport } from "./instCost";
import { buildForecast } from "./instForecast";
import { buildQualityReport } from "./instQuality";
import { buildTeamReport } from "./instTeam";
import type { InstBooking } from "./instData";
import { ahead, cancelled, contractOf, ib, late, logFor } from "./instIntel.fixture";
import { DAY, HOUR, NOW, bogota } from "./intel.fixture";
import { periodPhrase, resolvePeriod } from "./intelShared";
import { formatCOP } from "./pricing";
import { CANCEL_REASONS } from "./serviceCancel";

const period = resolvePeriod("30d", NOW);
const MARKET = { n: 12, p25: 20_000, median: 24_000, p75: 28_000 };

function inputFor(
  over: {
    bookings?: InstBooking[];
    withLogs?: boolean;
    period?: typeof period;
    shifts?: boolean;
  } = {},
): ReportInput {
  const bookings = over.bookings ?? [];
  const p = over.period ?? period;
  const logs =
    over.withLogs === false
      ? null
      : {
          rows: bookings.filter((b) => b.status === "completed").map((b) => logFor(b.id)),
          queried: bookings.map((b) => b.id),
        };
  const quality = buildQualityReport({
    bookings,
    logs,
    contractShifts: bookings.filter((b) => b.job_offer_id).map((b) => contractOf(b.id)),
    pros: { p1: { name: "Marta Ruiz", rethusVerified: true } },
    period: p,
    now: NOW,
  });
  return {
    institutionName: "Clínica del Norte",
    period: p,
    cost: buildCostReport({
      bookings,
      offers: { o1: { title: "UCI noches", specialty: "Enfermería" } },
      market: MARKET,
      period: p,
      now: NOW,
    }),
    quality,
    team: buildTeamReport({
      bookings,
      pros: { p1: { name: "Marta Ruiz", rethusVerified: true } },
      teamIds: ["p1"],
      period: p,
      now: NOW,
    }),
    forecast: buildForecast({ inputs: [], now: NOW }),
    now: NOW,
  };
}
const good = () => Array.from({ length: 8 }, (_, i) => ib(i + 1));
const build = (over: Parameters<typeof inputFor>[0] = {}) => buildExecutiveReport(inputFor(over));

describe("frase de apertura", () => {
  it("resume servicios, horas, inversión y los indicadores que sí se pueden medir", () => {
    const r = build({ bookings: good() });
    expect(r.headline).toBe(
      `En los últimos 30 días se prestaron 8 servicios (48 h), con una inversión de ${formatCOP(1_200_000)}. ` +
        "En calidad: se cumplió el 100 % de los turnos, el 100 % de las llegadas fue puntual, el 100 % de los servicios quedó documentado y el 100 % de los turnos publicados tiene contrato firmado.",
    );
    expect(r.title).toBe("Informe de gestión · Clínica del Norte");
    expect(r.periodLabel).toBe("Últimos 30 días");
    expect(r.generatedLabel).toBe("Generado el 14 oct 2026");
  });

  it("deja fuera lo que no tiene datos suficientes en lugar de decir 0 %", () => {
    const r = build({ bookings: good(), withLogs: false });
    expect(r.headline).not.toContain("documentado");
    expect(r.headline).toContain("el 100 % de las llegadas fue puntual");
    const few = build({ bookings: [ib(1), ib(2)] });
    expect(few.headline).toBe(
      `En los últimos 30 días se prestaron 2 servicios (12 h), con una inversión de ${formatCOP(300_000)}.`,
    );
  });

  it("sin servicios lo dice sin inventar", () => {
    const r = build({ bookings: [] });
    expect(r.headline).toBe("En los últimos 30 días no hubo servicios terminados.");
    expect(r.kpis.map((k) => k.label)).toEqual([
      "Servicios prestados",
      "Horas atendidas",
      "Inversión",
    ]);
    expect(r.attention).toEqual([]);
  });

  it("con el mes pasado como periodo usa su nombre", () => {
    const last = resolvePeriod("last_month", NOW);
    const r = build({ bookings: Array.from({ length: 5 }, (_, i) => ib(20 + i)), period: last });
    expect(r.headline.startsWith("En el mes pasado (sep 2026) se prestaron 5 servicios")).toBe(
      true,
    );
  });
});

describe("cifras clave", () => {
  it("incluye cada indicador medible con su meta y el costo por hora", () => {
    const r = build({ bookings: good() });
    const byLabel = Object.fromEntries(r.kpis.map((k) => [k.label, k]));
    expect(byLabel["Servicios prestados"].value).toBe("8");
    expect(byLabel["Horas atendidas"].value).toBe("48 h");
    expect(byLabel["Inversión"].value).toBe(formatCOP(1_200_000));
    expect(byLabel["Costo por hora"].value).toBe(formatCOP(25_000));
    expect(byLabel["Llegadas puntuales"]).toEqual({
      label: "Llegadas puntuales",
      value: "100 %",
      hint: "Meta: 90 %",
    });
    expect(byLabel["Horas con RETHUS verificado"].value).toBe("100 %");
  });

  it("no incluye indicadores sin datos y suma la cobertura si hay turnos publicados", () => {
    const base = inputFor({ bookings: [ib(1), ib(2)] });
    const withShifts: ReportInput = {
      ...base,
      forecast: buildForecast({
        inputs: [
          {
            offerId: "o1",
            title: "UCI",
            serviceArea: null,
            specialty: null,
            city: "Bogotá",
            modality: "shift",
            amount: 180_000,
            isUrgent: false,
            shiftId: "s1",
            startsAt: new Date(NOW + 2 * DAY).toISOString(),
            endsAt: new Date(NOW + 2 * DAY + 6 * HOUR).toISOString(),
            positions: 2,
            filled: 1,
            applicants: 0,
            awaitingResponse: 0,
            oldestWaitingAt: null,
          },
        ],
        now: NOW,
      }),
    };
    const r = buildExecutiveReport(withShifts);
    expect(r.kpis.map((k) => k.label)).not.toContain("Llegadas puntuales");
    expect(r.kpis.at(-1)).toEqual({ label: "Cobertura de los próximos 14 días", value: "50 %" });
  });
});

describe("secciones", () => {
  it("siempre trae servicio, inversión, calidad y equipo; el pronóstico solo si se calculó", () => {
    const r = build({ bookings: good() });
    expect(r.sections.map((s) => s.id)).toEqual([
      "service",
      "investment",
      "quality",
      "team",
      "forecast",
    ]);
    const noForecast = buildExecutiveReport({ ...inputFor({ bookings: good() }), forecast: null });
    expect(noForecast.sections.map((s) => s.id)).toEqual([
      "service",
      "investment",
      "quality",
      "team",
    ]);
  });

  it("servicio: cancelaciones por quién, y lo que sigue sin iniciar o cerrar", () => {
    const bookings = [
      ...good(),
      cancelled(10, CANCEL_REASONS.professional[0].label),
      cancelled(11, CANCEL_REASONS.client[0].label),
      cancelled(12, "otro"),
      ahead(0, { scheduled_at: new Date(NOW - 3 * HOUR).toISOString() }),
      ib(2, { status: "in_progress", completed_at: null }),
    ];
    const lines = build({ bookings }).sections[0].lines;
    expect(lines[0]).toBe("8 servicios terminados (48 h) en los últimos 30 días.");
    expect(lines).toContain(
      "3 servicios cancelados: 1 por profesionales, 1 por la institución y 1 sin motivo identificable.",
    );
    expect(lines).toContain("1 profesional prestó servicios en el periodo.");
    expect(lines).toContain("1 servicio confirmado sigue sin iniciar.");
    expect(lines).toContain("1 servicio en curso sin cerrar.");
  });

  it("inversión: costo por hora, periodo anterior con variación, mercado, renglones y lo acordado", () => {
    const bookings = [...good(), ...Array.from({ length: 4 }, (_, i) => ib(35 + i)), ahead(3)];
    const lines = build({ bookings }).sections[1].lines;
    expect(lines).toContain(`Inversión del periodo: ${formatCOP(1_200_000)} en 8 servicios.`);
    expect(lines).toContain(`Costo por hora: ${formatCOP(25_000)}.`);
    expect(lines).toContain(`Periodo anterior: ${formatCOP(600_000)} (+100 %).`);
    expect(lines).toContain("El costo por hora está dentro del rango de la ciudad.");
    expect(lines.some((l) => l.startsWith("- UCI noches") || l.startsWith("- Servicios sin"))).toBe(
      true,
    );
    expect(lines).toContain(
      `Acordado para los próximos 30 días: ${formatCOP(150_000)} en 1 servicio.`,
    );
    expect(lines.some((l) => l.startsWith("Mes en curso (oct 2026):"))).toBe(true);
  });

  it("inversión: por encima del mercado lo dice con la mediana y aclara que no distingue especialidades", () => {
    const bookings = Array.from({ length: 5 }, (_, i) =>
      ib(i + 1, { hourly_rate: 35_000, total_amount: 210_000 }),
    );
    const lines = build({ bookings }).sections[1].lines;
    expect(lines).toContain(
      `El costo por hora está 46 % por encima de la mediana de la ciudad (${formatCOP(24_000)}); referencia sin distinguir especialidades.`,
    );
  });

  it("calidad: cada indicador con su estado y meta, o «sin datos suficientes»", () => {
    const r = build({ bookings: [ib(1), ib(2), late(ib(3), 45)] });
    const lines = r.sections[2].lines;
    expect(lines.some((l) => l.startsWith("- Llegadas puntuales: sin datos suficientes."))).toBe(
      true,
    );
    const full = build({ bookings: [...good(), late(ib(9), 45), late(ib(10), 50)] }).sections[2]
      .lines;
    const punctual = full.find((l) => l.startsWith("- Llegadas puntuales:"))!;
    expect(punctual).toContain("80 % (por mejorar; meta 90 %).");
  });

  it("calidad: horas con menos registro y alertas del parte", () => {
    const short = ib(5, {
      completed_at: new Date(new Date(ib(5).scheduled_at).getTime() + 2 * HOUR).toISOString(),
    });
    const bookings = [...good(), short];
    const input = inputFor({ bookings });
    input.quality = buildQualityReport({
      bookings,
      logs: {
        rows: [logFor(bookings[0].id, { is_alert: true })],
        queried: bookings.map((b) => b.id),
      },
      contractShifts: [],
      pros: null,
      period,
      now: NOW,
    });
    const lines = buildExecutiveReport(input).sections[2].lines;
    expect(
      lines.some(
        (l) =>
          l.includes("1 servicio con menos horas registradas que las contratadas") &&
          l.includes("4 h"),
      ),
    ).toBe(true);
    expect(lines).toContain("1 alerta registrada en el parte, en 1 servicio.");
  });

  it("equipo: dependencia, equipo de confianza y candidatos, sin nombres", () => {
    const lines = build({ bookings: good() }).sections[3].lines;
    expect(lines[0]).toBe("1 profesional activo en el periodo.");
    expect(lines.some((l) => l.includes("dependencia total"))).toBe(true);
    expect(lines).toContain(
      "Equipo de confianza: 1 persona, 1 con servicios en los últimos 30 días.",
    );
    const empty = build({ bookings: [] }).sections[3].lines;
    expect(empty).toContain(
      "Equipo de confianza: 1 persona, 0 con servicios en los últimos 30 días.",
    );
    const noTeam = buildExecutiveReport({
      ...inputFor({ bookings: [] }),
      team: buildTeamReport({ bookings: [], pros: null, teamIds: [], period, now: NOW }),
    }).sections[3].lines;
    expect(noTeam).toEqual(["Aún no hay equipo de confianza."]);
  });
});

describe("para atender y lo que va bien", () => {
  it("los avisos salen de los hallazgos de cada motor y los buenos, también", () => {
    const bookings = [...good(), late(ib(9), 50), late(ib(10), 50), late(ib(11), 50)];
    const r = build({ bookings });
    expect(r.attention.length).toBeGreaterThan(0);
    expect(r.attention.length).toBeLessThanOrEqual(6);
    expect(r.attention.some((a) => a.includes("llegadas fueron tarde"))).toBe(true);
    const calm = build({ bookings: good() });
    expect(calm.highlights).toEqual(
      expect.arrayContaining(["El 100 % de las llegadas fue puntual"]),
    );
    expect(calm.highlights.length).toBeLessThanOrEqual(4);
  });
});

describe("texto del informe", () => {
  it("lleva título, periodo, resumen, cifras, secciones, avisos y la nota final", () => {
    const r = build({ bookings: [...good(), late(ib(9), 50), late(ib(10), 50), late(ib(11), 50)] });
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("INFORME DE GESTIÓN · CLÍNICA DEL NORTE");
    expect(lines[1]).toBe("Últimos 30 días · Generado el 14 oct 2026");
    for (const heading of [
      "RESUMEN",
      "CIFRAS CLAVE",
      "SERVICIO PRESTADO",
      "INVERSIÓN",
      "CALIDAD Y CUMPLIMIENTO",
      "EQUIPO",
      "PRÓXIMOS 14 DÍAS",
      "PARA ATENDER",
    ]) {
      expect(lines).toContain(heading);
    }
    expect(r.text).toContain("- Servicios prestados: 11");
    expect(r.text).toContain("(Meta: 90 %)");
    expect(r.text.endsWith("se muestra como tal.")).toBe(true);
  });

  it("no revela nombres de profesionales ni habla de pagos por fuera ni de WhatsApp", () => {
    const r = build({ bookings: [...good(), cancelled(12, CANCEL_REASONS.professional[0].label)] });
    expect(r.text).not.toContain("Marta");
    expect(r.text).not.toMatch(/whatsapp|efectivo|transferencia|nequi|daviplata/i);
    expect(r.text).not.toMatch(/NaN|undefined|\[object/);
  });

  describe("el informe no nombra a nadie", () => {
    const pros = {
      p1: { name: "Marta Ruiz", rethusVerified: true },
      p2: { name: "Luis Soto", rethusVerified: true },
      p3: { name: "Carmen Vega", rethusVerified: true },
    };
    const withTeam = (rows: InstBooking[]) => {
      const input = inputFor({ bookings: rows });
      input.team = buildTeamReport({
        bookings: rows,
        pros,
        teamIds: ["p1"],
        period,
        now: NOW,
      });
      return { input, r: buildExecutiveReport(input) };
    };
    const lateOnes = (days: number[], pro: string) =>
      days.map((d) => late(ib(d, { professional_id: pro }), 40));
    const NAMES = /Marta|Luis|Carmen|Ruiz|Soto|Vega/;

    it("una dependencia alta y quien llega tarde se resumen en cifras, sin nombres", () => {
      const rows = [...[1, 2, 3, 4, 5].map((d) => ib(d)), ...lateOnes([6, 7, 8], "p2")];
      const { input, r } = withTeam(rows);
      // El motor del equipo sí nombra (es para la propia institución)…
      expect(input.team.insights.some((i) => /Luis Soto/.test(i.title + i.detail))).toBe(true);
      expect(input.team.insights.some((i) => /Marta Ruiz/.test(i.title + i.detail))).toBe(true);
      // …el informe no.
      expect(r.attention).toContain("Una sola persona prestó el 63 % de las horas");
      expect(r.attention).toContain("1 profesional tiene puntualidad o cumplimiento por revisar");
      expect(r.highlights).toContain("1 profesional muy confiable en el periodo");
      expect(r.text).not.toMatch(NAMES);
      expect(r.attention.join(" ")).not.toMatch(NAMES);
      expect(r.highlights.join(" ")).not.toMatch(NAMES);
    });

    it("varias personas por revisar se cuentan en plural", () => {
      const rows = [
        ...[1, 2, 3, 4].map((d) => ib(d)),
        ...lateOnes([5, 6, 7], "p2"),
        ...lateOnes([8, 9, 10], "p3"),
      ];
      const { r } = withTeam(rows);
      expect(r.attention).toContain(
        "2 profesionales tienen puntualidad o cumplimiento por revisar",
      );
      expect(r.attention.join(" ")).not.toContain("Una sola persona");
      expect(r.text).not.toMatch(NAMES);
    });

    it("la dependencia total sí se dice (el título no nombra a nadie)", () => {
      const { r } = withTeam([1, 2, 3, 4].map((d) => ib(d)));
      expect(r.attention).toEqual(["Todo el cuidado depende de una sola persona"]);
      expect(r.text).not.toMatch(NAMES);
    });

    it("varias personas muy confiables se cuentan en plural", () => {
      const rows = [
        ...[1, 2, 3].map((d) => ib(d)),
        ...[4, 5, 6].map((d) => ib(d, { professional_id: "p2" })),
      ];
      const { r } = withTeam(rows);
      expect(r.highlights).toContain("2 profesionales muy confiables en el periodo");
      expect(r.text).not.toMatch(NAMES);
    });

    it("conserva los hallazgos del equipo que no nombran a nadie y descarta los que sí", () => {
      const { input } = withTeam([]);
      const insight = (id: string, severity: "warn" | "good", title: string, pro?: string) => ({
        id,
        severity,
        title,
        detail: "",
        ...(pro ? { professionalId: pro } : {}),
      });
      input.team = {
        ...input.team,
        insights: [
          insight("generic_warn", "warn", "Hallazgo general del equipo"),
          insight("generic_good", "good", "Equipo bien repartido"),
          insight("named_warn", "warn", "Revisa con Alguien Con Nombre", "p9"),
          insight("named_good", "good", "Agradece a Alguien Con Nombre", "p9"),
          insight("single", "warn", "Todo el cuidado depende de una sola persona", "p1"),
        ],
      };
      const r = buildExecutiveReport(input);
      expect(r.attention).toEqual([
        "Hallazgo general del equipo",
        "Todo el cuidado depende de una sola persona",
      ]);
      expect(r.highlights).toEqual(["Equipo bien repartido"]);
    });

    it("sin personas por revisar ni muy confiables no se agrega nada", () => {
      const { r } = withTeam([]);
      expect(r.attention.join(" ")).not.toMatch(/tienen? puntualidad/);
      expect(r.highlights.join(" ")).not.toMatch(/muy confiable/);
    });
  });

  it("sin servicios no hay secciones de avisos ni de lo bueno", () => {
    const r = build({ bookings: [] });
    expect(r.text).not.toContain("LO QUE VA BIEN");
  });
});

describe("CSV de servicios para auditoría", () => {
  const names = { p1: "Marta Ruiz", p2: "Luis Soto" };
  const csvInput = (
    bookings: InstBooking[],
    over: Partial<Parameters<typeof servicesCsv>[0]> = {},
  ) => ({
    bookings,
    period,
    now: NOW,
    names,
    offers: { o1: { title: "UCI noches", specialty: "Enfermería" } },
    documented: new Set<string>(),
    signed: new Set<string>(),
    verified: { p1: true, p2: false } as Record<string, boolean | null>,
    ...over,
  });
  const lines = (csv: string) =>
    csv
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");

  it("empieza con BOM, usa «;» y lleva el encabezado en español", () => {
    const csv = servicesCsv(csvInput([ib(1)]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines(csv)[0]).toBe(
      "Fecha;Estado;Profesional;Especialidad;Turno u oferta;Horas contratadas;Horas registradas;Minutos de retraso;Valor (COP);Parte del turno;Contrato firmado;RETHUS verificado;Quién canceló;Motivo de cancelación",
    );
  });

  it("un renglón por servicio del periodo, del más reciente al más antiguo", () => {
    const rows = [ib(5), ib(1), ib(3), ib(60), ahead(2)];
    const out = lines(servicesCsv(csvInput(rows)));
    expect(out).toHaveLength(1 + 3);
    const dates = out.slice(1).map((l) => l.split(";")[0]);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("llena los datos del servicio: profesional, horas, retraso, valor y banderas", () => {
    const b = late(ib(1, { professional_id: "p1" }), 25);
    const line = lines(
      servicesCsv(csvInput([b], { documented: new Set([b.id]), signed: new Set([b.id]) })),
    )[1].split(";");
    expect(line[1]).toBe("Completado");
    expect(line[2]).toBe("Marta Ruiz");
    expect(line[3]).toBe("Enfermería");
    expect(line[4]).toBe("UCI noches");
    expect(line[5]).toBe("6");
    expect(line[6]).toBe("5,58");
    expect(line[7]).toBe("25");
    expect(line[8]).toBe("150000");
    expect(line.slice(9, 12)).toEqual(["Sí", "Sí", "Sí"]);
  });

  it("«No» solo cuando el dato se cargó; si no se cargó, la celda queda vacía", () => {
    const b = ib(1, { professional_id: "p2" });
    const loaded = lines(servicesCsv(csvInput([b])))[1].split(";");
    expect(loaded.slice(9, 12)).toEqual(["No", "No", "No"]);
    const missing = lines(
      servicesCsv(csvInput([b], { documented: null, signed: null, verified: null })),
    )[1].split(";");
    expect(missing.slice(9, 12)).toEqual(["", "", ""]);
  });

  it("un servicio cuyo parte no se consultó queda en blanco, no en «No»", () => {
    const a = ib(1, { professional_id: "p1" });
    const b = ib(2, { professional_id: "p1" });
    const csv = servicesCsv(
      csvInput([a, b], { documented: new Set([a.id]), queried: new Set([a.id]) }),
    );
    const rows = lines(csv)
      .slice(1)
      .map((l) => l.split(";")[9]);
    // el más reciente (a) tiene parte; el otro no se consultó
    expect(rows).toEqual(["Sí", ""]);
    const asked = servicesCsv(
      csvInput([a, b], { documented: new Set([a.id]), queried: new Set([a.id, b.id]) }),
    );
    expect(
      lines(asked)
        .slice(1)
        .map((l) => l.split(";")[9]),
    ).toEqual(["Sí", "No"]);
  });

  it("una reserva directa, sin turno publicado, dice «No aplica» en el contrato", () => {
    const direct = ib(1, { job_offer_id: null });
    const line = lines(servicesCsv(csvInput([direct])))[1].split(";");
    expect(line[10]).toBe("No aplica");
    const published = lines(servicesCsv(csvInput([ib(1)], { signed: null })))[1].split(";");
    expect(published[10]).toBe(""); // contratos sin cargar: en blanco
  });

  it("los cancelados dicen quién canceló y el motivo, y no llevan valor", () => {
    const b = cancelled(2, CANCEL_REASONS.professional[0].label, { professional_id: "p2" });
    const line = lines(servicesCsv(csvInput([b])))[1].split(";");
    expect(line[1]).toBe("Cancelado");
    expect(line[8]).toBe("");
    expect(line[12]).toBe("Profesional");
    expect(line[13]).toBe(CANCEL_REASONS.professional[0].label);
    const unknown = lines(servicesCsv(csvInput([cancelled(2, "Me salió algo")])))[1].split(";");
    expect(unknown[12]).toBe("Sin dato");
  });

  it("neutraliza las fórmulas que alguien pudo escribir en un título o en un motivo", () => {
    const b = cancelled(2, '=HYPERLINK("http://x")', { job_offer_id: "o9" });
    const csv = servicesCsv(csvInput([b], { offers: { o9: { title: "+cmd|' /C calc'!A0" } } }));
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'=HYPERLINK");
  });

  it("sin servicios solo trae el encabezado", () => {
    expect(lines(servicesCsv(csvInput([])))).toHaveLength(1);
  });
});

describe("nombre de los archivos", () => {
  it("usa la fecha de Colombia, también a las 23:30", () => {
    expect(reportFilename("informe", "txt", NOW)).toBe("informe-de-gestion-2026-10-14.txt");
    expect(reportFilename("servicios", "csv", NOW)).toBe("servicios-2026-10-14.csv");
    // 03:00 UTC del 15 todavía es el 14 en Colombia
    expect(reportFilename("informe", "txt", Date.parse("2026-10-15T03:00:00Z"))).toBe(
      "informe-de-gestion-2026-10-14.txt",
    );
    expect(reportFilename("informe", "txt", Date.parse("2026-10-15T05:00:00Z"))).toBe(
      "informe-de-gestion-2026-10-15.txt",
    );
  });
});

describe("informe completo: tres escenarios revisados a mano", () => {
  const rich = () => {
    const base = [
      ...good(),
      late(ib(9), 50),
      late(ib(10), 50),
      ib(11, {
        completed_at: new Date(new Date(ib(11).scheduled_at).getTime() + 2 * HOUR).toISOString(),
      }),
      cancelled(12, CANCEL_REASONS.professional[0].label),
      cancelled(13, CANCEL_REASONS.client[0].label),
      cancelled(14, "otro"),
      ahead(0, { scheduled_at: new Date(NOW - 3 * HOUR).toISOString() }),
      ib(2, { id: "open1", status: "in_progress", completed_at: null }),
      ahead(3),
      ...Array.from({ length: 4 }, (_, i) => ib(35 + i)),
    ];
    return base.map((b, i) => (i === 3 ? { ...b, hourly_rate: 35_000, total_amount: 210_000 } : b));
  };
  const golden = (which: "clean" | "few" | "rich") => {
    if (which === "clean") return buildExecutiveReport(inputFor({ bookings: good() }));
    if (which === "few") return buildExecutiveReport(inputFor({ bookings: [ib(1), ib(2)] }));
    const bookings = rich();
    const input = inputFor({ bookings });
    input.quality = buildQualityReport({
      bookings,
      logs: {
        rows: [logFor(bookings[0].id, { is_alert: true })],
        queried: bookings.map((b) => b.id),
      },
      contractShifts: [],
      pros: { p1: { name: "Marta Ruiz", rethusVerified: false } },
      period,
      now: NOW,
    });
    return buildExecutiveReport(input);
  };

  it("periodo sin tropiezos: cada sección, aviso y logro, línea por línea", () => {
    const r = golden("clean");
    expect(Object.fromEntries(r.sections.map((s) => [s.id, s.lines]))).toEqual({
      service: [
        "8 servicios terminados (48 h) en los últimos 30 días.",
        "1 profesional prestó servicios en el periodo.",
      ],
      investment: [
        "Inversión del periodo: $ 1.200.000 en 8 servicios.",
        "Costo por hora: $ 25.000.",
        "El costo por hora está dentro del rango de la ciudad.",
        "- UCI noches: $ 1.200.000 (100 % del gasto).",
        "Mes en curso (oct 2026): $ 1.200.000 a la fecha; proyección de $ 1.200.000 a $ 1.928.571.",
      ],
      quality: [
        "- Turnos cumplidos: 100 % (en verde; meta 92 %). 8 de 8 turnos se cumplieron.",
        "- Llegadas puntuales: 100 % (en verde; meta 90 %). 8 de 8 llegadas fueron a tiempo (hasta 10 min de margen).",
        "- Horas registradas: 100 % (en verde; meta 95 %). Entre el inicio y el cierre del parte quedaron 48 h de 48 h contratadas.",
        "- Servicios documentados: 100 % (en verde; meta 90 %). 8 de 8 servicios terminados tienen parte del turno.",
        "- Con contrato firmado: 100 % (en verde; meta 95 %). 8 de 8 servicios de turnos publicados tienen contrato firmado por ambas partes.",
        "- Horas con RETHUS verificado: 100 % (en verde; meta 98 %). El 100 % de las horas las prestó personal con RETHUS verificado.",
      ],
      team: [
        "1 profesional activo en el periodo.",
        "El profesional con más horas prestó el 100 % del total (dependencia total).",
        "Equipo de confianza: 1 persona, 1 con servicios en los últimos 30 días.",
      ],
      forecast: ["Sin turnos publicados para los próximos 14 días."],
    });
    expect(r.kpis.map((k) => `${k.label}: ${k.value}`)).toEqual([
      "Servicios prestados: 8",
      "Horas atendidas: 48 h",
      "Inversión: $ 1.200.000",
      "Costo por hora: $ 25.000",
      "Turnos cumplidos: 100 %",
      "Llegadas puntuales: 100 %",
      "Horas registradas: 100 %",
      "Servicios documentados: 100 %",
      "Con contrato firmado: 100 %",
      "Horas con RETHUS verificado: 100 %",
    ]);
    expect(r.attention).toEqual(["Todo el cuidado depende de una sola persona"]);
    expect(r.highlights).toEqual([
      "El 100 % de las llegadas fue puntual",
      "El 100 % de los turnos se cumplió",
      "1 profesional muy confiable en el periodo",
    ]);
    expect(r.headline).toBe(
      "En los últimos 30 días se prestaron 8 servicios (48 h), con una inversión de $ 1.200.000. En calidad: se cumplió el 100 % de los turnos, el 100 % de las llegadas fue puntual, el 100 % de los servicios quedó documentado y el 100 % de los turnos publicados tiene contrato firmado.",
    );
  });

  it("pocos servicios: cada sección, aviso y logro, línea por línea", () => {
    const r = golden("few");
    expect(Object.fromEntries(r.sections.map((s) => [s.id, s.lines]))).toEqual({
      service: [
        "2 servicios terminados (12 h) en los últimos 30 días.",
        "1 profesional prestó servicios en el periodo.",
      ],
      investment: [
        "Inversión del periodo: $ 300.000 en 2 servicios.",
        "- UCI noches: $ 300.000 (100 % del gasto).",
        "Mes en curso (oct 2026): $ 300.000 a la fecha; proyección de $ 300.000 a $ 482.143.",
      ],
      quality: [
        "- Turnos cumplidos: sin datos suficientes.",
        "- Llegadas puntuales: sin datos suficientes.",
        "- Horas registradas: sin datos suficientes.",
        "- Servicios documentados: sin datos suficientes.",
        "- Con contrato firmado: sin datos suficientes.",
        "- Horas con RETHUS verificado: sin datos suficientes.",
      ],
      team: [
        "1 profesional activo en el periodo.",
        "Equipo de confianza: 1 persona, 1 con servicios en los últimos 30 días.",
      ],
      forecast: ["Sin turnos publicados para los próximos 14 días."],
    });
    expect(r.kpis.map((k) => `${k.label}: ${k.value}`)).toEqual([
      "Servicios prestados: 2",
      "Horas atendidas: 12 h",
      "Inversión: $ 300.000",
    ]);
    expect(r.attention).toEqual([]);
    expect(r.highlights).toEqual([]);
    expect(r.headline).toBe(
      "En los últimos 30 días se prestaron 2 servicios (12 h), con una inversión de $ 300.000.",
    );
  });

  it("periodo con problemas de todo tipo: cada sección, aviso y logro, línea por línea", () => {
    const r = golden("rich");
    expect(Object.fromEntries(r.sections.map((s) => [s.id, s.lines]))).toEqual({
      service: [
        "11 servicios terminados (66 h) en los últimos 30 días.",
        "3 servicios cancelados: 1 por profesionales, 1 por la institución y 1 sin motivo identificable.",
        "1 profesional prestó servicios en el periodo.",
        "1 servicio confirmado sigue sin iniciar.",
        "1 servicio en curso sin cerrar.",
      ],
      investment: [
        "Inversión del periodo: $ 1.710.000 en 11 servicios.",
        "Costo por hora: $ 25.909.",
        "Periodo anterior: $ 600.000 (+185 %).",
        "El costo por hora está dentro del rango de la ciudad.",
        "- UCI noches: $ 1.710.000 (100 % del gasto).",
        "Acordado para los próximos 30 días: $ 150.000 en 1 servicio.",
        "Mes en curso (oct 2026): $ 1.710.000 a la fecha; proyección de $ 2.160.000 a $ 2.748.214.",
      ],
      quality: [
        "- Turnos cumplidos: 85 % (por mejorar; meta 92 %). 11 de 13 turnos se cumplieron; 1 lo canceló el profesional; 1 sigue sin iniciar.",
        "- Llegadas puntuales: 83 % (por mejorar; meta 90 %). 10 de 12 llegadas fueron a tiempo (hasta 10 min de margen).",
        "- Horas registradas: 91 % (por mejorar; meta 95 %). Entre el inicio y el cierre del parte quedaron 60,3 h de 66 h contratadas.",
        "- Servicios documentados: 9 % (en rojo; meta 90 %). 1 de 11 servicios terminados tienen parte del turno.",
        "- Con contrato firmado: 0 % (en rojo; meta 95 %). 0 de 13 servicios de turnos publicados tienen contrato firmado por ambas partes.",
        "- Horas con RETHUS verificado: 0 % (en rojo; meta 98 %). El 0 % de las horas las prestó personal con RETHUS verificado.",
        "1 servicio con menos horas registradas que las contratadas: 4 h, unos $ 100.000 para revisar.",
        "1 alerta registrada en el parte, en 1 servicio.",
      ],
      team: [
        "1 profesional activo en el periodo.",
        "El profesional con más horas prestó el 100 % del total (dependencia total).",
        "Equipo de confianza: 1 persona, 1 con servicios en los últimos 30 días.",
      ],
      forecast: ["Sin turnos publicados para los próximos 14 días."],
    });
    expect(r.kpis.map((k) => `${k.label}: ${k.value}`)).toEqual([
      "Servicios prestados: 11",
      "Horas atendidas: 66 h",
      "Inversión: $ 1.710.000",
      "Costo por hora: $ 25.909",
      "Turnos cumplidos: 85 %",
      "Llegadas puntuales: 83 %",
      "Horas registradas: 91 %",
      "Servicios documentados: 9 %",
      "Con contrato firmado: 0 %",
      "Horas con RETHUS verificado: 0 %",
    ]);
    expect(r.attention).toEqual([
      "1 servicio confirmado sin inicio",
      "1 servicio en curso sin cerrar",
      "2 de 12 llegadas fueron tarde",
      "10 de 11 servicios sin parte del turno",
      "11 servicios se prestaron sin contrato firmado por ambas partes",
      "1 profesional sin RETHUS verificado prestó el 100 % de las horas",
    ]);
    expect(r.highlights).toEqual([]);
    expect(r.headline).toBe(
      "En los últimos 30 días se prestaron 11 servicios (66 h), con una inversión de $ 1.710.000. En calidad: se cumplió el 85 % de los turnos, el 83 % de las llegadas fue puntual, el 9 % de los servicios quedó documentado y el 0 % de los turnos publicados tiene contrato firmado.",
    );
  });

  it("el nombre de la institución se recorta y, si falta, se dice «la institución»", () => {
    const named = buildExecutiveReport({
      ...inputFor({ bookings: good() }),
      institutionName: "  Clínica Sur  ",
    });
    expect(named.title).toBe("Informe de gestión · Clínica Sur");
    const unnamed = buildExecutiveReport({
      ...inputFor({ bookings: good() }),
      institutionName: "   ",
    });
    expect(unnamed.title).toBe("Informe de gestión · la institución");
  });

  it("un turno publicado sin cupos no muestra una cobertura «null»", () => {
    const base = inputFor({ bookings: good() });
    const odd = buildExecutiveReport({
      ...base,
      forecast: buildForecast({
        inputs: [
          {
            offerId: "o1",
            title: "UCI",
            serviceArea: null,
            specialty: null,
            city: "Bogotá",
            modality: "shift",
            amount: 180_000,
            isUrgent: false,
            shiftId: "s1",
            startsAt: new Date(NOW + 2 * DAY).toISOString(),
            endsAt: new Date(NOW + 2 * DAY + 6 * HOUR).toISOString(),
            positions: 0,
            filled: 0,
            applicants: 0,
            awaitingResponse: 0,
            oldestWaitingAt: null,
          },
        ],
        now: NOW,
      }),
    });
    expect(odd.kpis.map((k) => k.label)).not.toContain("Cobertura de los próximos 14 días");
    expect(odd.text).not.toMatch(/null|NaN|undefined/);
  });

  it("el pronóstico aparece en el texto con sus horas urgentes y su patrón", () => {
    const base = inputFor({ bookings: good() });
    const sat = (i: number) => ({
      offerId: "o1",
      title: "UCI",
      serviceArea: null,
      specialty: null,
      city: "Bogotá",
      modality: "shift" as const,
      amount: 180_000,
      isUrgent: false,
      shiftId: `h${i}`,
      startsAt: new Date(
        Date.parse("2026-10-14T00:00:00-05:00") - (4 + 7 * i) * DAY + 20 * HOUR,
      ).toISOString(),
      endsAt: new Date(
        Date.parse("2026-10-14T00:00:00-05:00") - (4 + 7 * i) * DAY + 30 * HOUR,
      ).toISOString(),
      positions: 1,
      filled: 0,
      applicants: 0,
      awaitingResponse: 0,
      oldestWaitingAt: null,
    });
    const urgent = {
      ...sat(99),
      shiftId: "u1",
      startsAt: new Date(NOW + 20 * HOUR).toISOString(),
      endsAt: new Date(NOW + 26 * HOUR).toISOString(),
    };
    const r = buildExecutiveReport({
      ...base,
      forecast: buildForecast({ inputs: [urgent, sat(0), sat(1), sat(2)], now: NOW }),
    });
    const lines = r.sections.find((s) => s.id === "forecast")!.lines;
    expect(lines).toEqual([
      "Próximos 14 días: 0 % cubierto, 6 h por cubrir.",
      "6 h sin cubrir en las próximas 48 horas.",
      "Los sábados por la noche suelen quedar sin cubrir.",
    ]);
    // los avisos del pronóstico también llegan a «para atender»
    expect(r.attention).toEqual(
      expect.arrayContaining([
        "6 h sin cubrir en las próximas 48 horas",
        "Los sábados por la noche suelen quedar sin cubrir",
      ]),
    );
  });

  it("un indicador de equipo «sano» o «moderado» se nombra con su porcentaje", () => {
    const mixed = [
      ...Array.from({ length: 4 }, (_, i) => ib(i + 1, { professional_id: "p1" })),
      ...Array.from({ length: 3 }, (_, i) => ib(i + 10, { professional_id: "p2" })),
      ...Array.from({ length: 3 }, (_, i) => ib(i + 20, { professional_id: "p3" })),
    ];
    const lines = buildExecutiveReport(inputFor({ bookings: mixed })).sections.find(
      (s) => s.id === "team",
    )!.lines;
    expect(lines).toContain(
      "El profesional con más horas prestó el 40 % del total (concentración moderada).",
    );
  });

  it("sin servicios, cada sección dice lo justo y nada más", () => {
    const r = buildExecutiveReport(inputFor({ bookings: [] }));
    const lines = Object.fromEntries(r.sections.map((s) => [s.id, s.lines]));
    expect(lines.service).toEqual(["0 servicios terminados (0 h) en los últimos 30 días."]);
    expect(lines.investment).toEqual(["No hubo servicios terminados en el periodo."]);
  });

  it("cancelaciones sin motivo desconocido no mencionan «sin motivo identificable»", () => {
    const rows = [...good(), cancelled(12, CANCEL_REASONS.professional[0].label)];
    const lines = buildExecutiveReport(inputFor({ bookings: rows })).sections[0].lines;
    expect(lines).toContain("1 servicio cancelado: 1 por profesionales y 0 por la institución.");
  });

  it("la variación contra el periodo anterior se redondea y no aparece si el anterior fue de $0", () => {
    const prev = (total: number, n = 3) =>
      Array.from({ length: n }, (_, i) => ib(35 + i, { total_amount: total }));
    const cur = Array.from({ length: 4 }, (_, i) => ib(i + 1, { total_amount: 250_000 })); // $1.000.000
    const up = buildExecutiveReport(inputFor({ bookings: [...cur, ...prev(200_000)] })).sections[1]
      .lines; // anterior $600.000 en 3 servicios
    expect(up).toContain(`Periodo anterior: ${formatCOP(600_000)} (+67 %).`); // 66,67 → 67
    const zero = buildExecutiveReport(inputFor({ bookings: [...cur, ...prev(0)] })).sections[1]
      .lines;
    expect(zero).toContain(`Periodo anterior: ${formatCOP(0)} (3 servicios).`);
  });

  it("con menos de 3 servicios antes, el porcentaje no dice nada y se cuentan los servicios", () => {
    const cur = Array.from({ length: 4 }, (_, i) => ib(i + 1, { total_amount: 250_000 }));
    const one = [ib(35, { total_amount: 150_000 })];
    const two = [ib(35, { total_amount: 300_000 }), ib(36, { total_amount: 300_000 })];
    const lines = (prev: InstBooking[]) =>
      buildExecutiveReport(inputFor({ bookings: [...cur, ...prev] })).sections[1].lines;
    expect(lines(one)).toContain(`Periodo anterior: ${formatCOP(150_000)} (1 servicio).`);
    expect(lines(two)).toContain(`Periodo anterior: ${formatCOP(600_000)} (2 servicios).`);
    expect(lines(one).join(" ")).not.toMatch(/\+\d+ %/);
  });

  it("por debajo del rango del mercado lo dice así, y no como «por encima»", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      ib(i + 1, { hourly_rate: 15_000, total_amount: 90_000 }),
    );
    const lines = buildExecutiveReport(inputFor({ bookings: rows })).sections[1].lines;
    expect(lines).toContain("El costo por hora está por debajo del rango de la ciudad.");
    expect(lines.join(" ")).not.toContain("por encima");
  });

  it("lista a lo sumo los tres renglones de gasto más grandes", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      ib(i + 1, { job_offer_id: `x${i}`, total_amount: (i + 1) * 100_000 }),
    );
    const base = inputFor({ bookings: rows });
    base.cost = buildCostReport({
      bookings: rows,
      offers: Object.fromEntries(rows.map((_, i) => [`x${i}`, { title: `Oferta ${i}` }])),
      market: MARKET,
      period,
      now: NOW,
    });
    const lines = buildExecutiveReport(base).sections[1].lines.filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Oferta 3");
  });

  it("la proyección del mes es una cifra cuando no hay rango, y un rango cuando lo hay", () => {
    const single = [...good(), ...[1, 2, 3, 4, 5, 6, 7, 8].map((d) => ahead(d))];
    const one = buildExecutiveReport(inputFor({ bookings: single })).sections[1].lines.find((l) =>
      l.startsWith("Mes en curso"),
    )!;
    expect(one).toBe(
      `Mes en curso (oct 2026): ${formatCOP(1_200_000)} a la fecha; proyección de ${formatCOP(2_400_000)}.`,
    );
    const range = buildExecutiveReport(inputFor({ bookings: good() })).sections[1].lines.find((l) =>
      l.startsWith("Mes en curso"),
    )!;
    expect(range).toContain(" a ");
  });

  it("sin movimiento este mes no hay línea del mes en curso", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ib(20 + i)); // septiembre
    const lines = buildExecutiveReport(inputFor({ bookings: rows })).sections[1].lines;
    expect(lines.some((l) => l.startsWith("Mes en curso"))).toBe(false);
  });

  it("los logros son cuatro como máximo, aunque haya más de cuatro buenas noticias", () => {
    const rows = [
      ...good(),
      ...Array.from({ length: 4 }, (_, i) =>
        ib(35 + i, { hourly_rate: 30_000, total_amount: 180_000 }),
      ),
    ];
    const covered = {
      offerId: "o1",
      title: "UCI",
      serviceArea: null,
      specialty: null,
      city: "Bogotá",
      modality: "shift" as const,
      amount: 180_000,
      isUrgent: false,
      shiftId: "c1",
      startsAt: new Date(NOW + 3 * DAY).toISOString(),
      endsAt: new Date(NOW + 3 * DAY + 6 * HOUR).toISOString(),
      positions: 1,
      filled: 1,
      applicants: 0,
      awaitingResponse: 0,
      oldestWaitingAt: null,
    };
    const base = inputFor({ bookings: rows });
    const r = buildExecutiveReport({
      ...base,
      forecast: buildForecast({ inputs: [covered], now: NOW }),
    });
    expect(r.highlights).toHaveLength(4);
    expect(r.highlights).not.toContain("Tus próximos 14 días están cubiertos"); // el quinto queda fuera
  });

  it("con pocas horas no se habla de reparto", () => {
    const lines = buildExecutiveReport(inputFor({ bookings: [ib(1), ib(2)] })).sections.find(
      (s) => s.id === "team",
    )!.lines;
    expect(lines.some((l) => l.includes("más horas"))).toBe(false);
  });

  it("los avisos y logros del texto salen de los cuatro motores, con tope", () => {
    const r = golden("rich");
    expect(r.attention).toHaveLength(6);
    const calm = golden("clean");
    expect(calm.attention).toEqual(["Todo el cuidado depende de una sola persona"]);
    expect(r.text).toContain("PARA ATENDER");
    expect(golden("few").text).not.toContain("PARA ATENDER");
    expect(golden("few").text).not.toContain("LO QUE VA BIEN");
  });
});

describe("datos del CSV a partir de lo leído", () => {
  const rows = [ib(1), ib(2), ib(3, { professional_id: "p2" })];
  const logs = {
    rows: [logFor(rows[0].id), logFor(rows[0].id), logFor(rows[2].id)],
    queried: [rows[0].id, rows[1].id],
  };
  const pros = {
    p1: { name: "Marta Ruiz", rethusVerified: true },
    p2: { name: null, rethusVerified: false },
    p3: {},
  };

  it("junta nombres, partes, consultados, contratos firmados y verificación", () => {
    const ctx = csvContext({
      logs,
      contractShifts: [contractOf(rows[0].id), contractOf(rows[1].id, "pending_signature")],
      pros,
    });
    expect(ctx.names).toEqual({ p1: "Marta Ruiz" });
    expect([...(ctx.documented ?? [])].sort()).toEqual([rows[0].id, rows[2].id].sort());
    expect([...(ctx.queried ?? [])].sort()).toEqual([rows[0].id, rows[1].id].sort());
    expect([...(ctx.signed ?? [])]).toEqual([rows[0].id]);
    expect(ctx.verified).toEqual({ p1: true, p2: false, p3: null });
  });

  it("un dato que no se cargó queda en nulo y no se confunde con un «No»", () => {
    const ctx = csvContext({ logs: null, contractShifts: null, pros: null });
    expect(ctx).toEqual({
      names: {},
      documented: null,
      queried: null,
      signed: null,
      verified: null,
    });
    const out = servicesCsv({ bookings: rows, period, now: NOW, offers: {}, ...ctx })
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(";"));
    for (const cells of out) {
      expect(cells[9]).toBe(""); // Parte del turno
      expect(cells[10]).toBe(""); // Contrato firmado
      expect(cells[11]).toBe(""); // RETHUS verificado
    }
  });

  it("alimenta el CSV: Sí para lo que está, No para lo que falta, vacío para lo que no se consultó", () => {
    const ctx = csvContext({
      logs,
      contractShifts: [contractOf(rows[0].id)],
      pros,
    });
    const out = servicesCsv({ bookings: rows, period, now: NOW, offers: {}, ...ctx })
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(";"));
    // Se ordena del más reciente al más antiguo: rows[0] (1 día), rows[1] (2 días), rows[2] (3 días).
    expect(out.map((c) => c[9])).toEqual(["Sí", "No", ""]); // parte: tiene, consultado sin registros, no consultado
    expect(out.map((c) => c[10])).toEqual(["Sí", "No", "No"]); // contrato firmado
    expect(out.map((c) => c[11])).toEqual(["Sí", "Sí", "No"]); // RETHUS verificado
  });
});

describe("horas con coma decimal", () => {
  const halfHours = (d: number) => ib(d, { duration_hours: 5.5, total_amount: 137_500 });
  const rows = [1, 2, 3, 4, 5].map(halfHours); // 27,5 h

  it("la frase de apertura, la cifra clave y la sección del servicio usan coma", () => {
    const r = buildExecutiveReport(inputFor({ bookings: rows }));
    expect(r.headline).toContain("(27,5 h)");
    expect(r.kpis.find((k) => k.label === "Horas atendidas")!.value).toBe("27,5 h");
    expect(r.sections[0].lines[0]).toBe("5 servicios terminados (27,5 h) en los últimos 30 días.");
  });

  it("las horas registradas de menos se escriben con coma", () => {
    const short = (d: number) => late(ib(d), 150); // quedaron 3,5 h de 6 h
    const r = buildExecutiveReport(inputFor({ bookings: [short(1), short(2), short(3)] }));
    const line = r.sections.find((s) => s.id === "quality")!.lines.join(" ");
    expect(line).toContain("7,5 h, unos");
  });

  it("las horas sin cubrir de las próximas 48 h se escriben con coma", () => {
    const start = bogota("2026-10-15T08:00:00");
    const input = inputFor({ bookings: rows });
    input.forecast = buildForecast({
      inputs: [
        {
          offerId: "o1",
          title: "Turno",
          serviceArea: null,
          specialty: null,
          city: "Bogotá",
          modality: "shift",
          amount: 180_000,
          isUrgent: false,
          shiftId: "s1",
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + 5.5 * HOUR).toISOString(),
          positions: 1,
          filled: 0,
          applicants: 0,
          awaitingResponse: 0,
          oldestWaitingAt: null,
        },
      ],
      now: NOW,
    });
    const lines = buildExecutiveReport(input).sections.find((s) => s.id === "forecast")!.lines;
    expect(lines).toContain("5,5 h sin cubrir en las próximas 48 horas.");
  });
});
