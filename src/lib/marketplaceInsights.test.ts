import { describe, it, expect } from "vitest";
import {
  buildRecommendations,
  cityKey,
  computeMarketKpis,
  evaluateCityBalance,
  explainMatch,
  median,
  offerQuality,
  offerRiskSignals,
  priceBenchmark,
  type ApplicationRow,
  type OfferRow,
  type SuggestedPro,
} from "./marketplaceInsights";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
const offer = (o: Partial<OfferRow> = {}): OfferRow => ({
  id: `o${++seq}`,
  title: "Enfermera para turno nocturno",
  description:
    "Se requiere enfermera con experiencia en cuidado de adulto mayor, manejo de oxígeno domiciliario y movilización segura.",
  city: "Bogotá",
  amount: 21000,
  modality: "hour",
  status: "open",
  created_at: iso(NOW - 2 * DAY),
  updated_at: iso(NOW - 2 * DAY),
  poster_type: "family",
  specialty_required: "Enfermería",
  start_date: iso(NOW + 5 * DAY),
  requirements: ["RETHUS"],
  address: "Chapinero",
  posted_by: "u1",
  ...o,
});
const app = (
  job_offer_id: string,
  status: ApplicationRow["status"],
  createdMs: number,
  updatedMs = createdMs,
): ApplicationRow => ({
  job_offer_id,
  status,
  created_at: iso(createdMs),
  updated_at: iso(updatedMs),
});

describe("utilidades", () => {
  it("calcula la mediana", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("normaliza ciudades igual que en SQL", () => {
    expect(cityKey("Bogotá D.C.")).toBe("bogota");
    expect(cityKey("BOGOTÁ")).toBe("bogota");
    expect(cityKey("Medellín")).toBe("medellin");
  });
});

describe("computeMarketKpis", () => {
  it("calcula cobertura por cohorte y tiempos", () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      offer({ id: `old${i}`, created_at: iso(NOW - 40 * DAY), status: i < 3 ? "filled" : "open" }),
    );
    const apps: ApplicationRow[] = [
      app("old0", "accepted", NOW - 40 * DAY + 2 * HOUR, NOW - 40 * DAY + 5 * HOUR),
      app("old1", "accepted", NOW - 40 * DAY + 4 * HOUR, NOW - 40 * DAY + 20 * HOUR),
      app("old2", "accepted", NOW - 40 * DAY + 6 * HOUR, NOW - 40 * DAY + 30 * HOUR),
    ];
    const k = computeMarketKpis(old, apps, NOW);
    expect(k.fill7).toEqual({ rate: 0.5, cohort: 6, filled: 3 });
    expect(k.fill30.rate).toBe(0.5);
    expect(k.medianHoursToFirstApplication).toBe(4);
    expect(k.medianHoursToFill).toBe(20);
  });

  it("no da tasas con muestra insuficiente", () => {
    const k = computeMarketKpis([offer({ created_at: iso(NOW - 40 * DAY) })], [], NOW);
    expect(k.fill7.rate).toBeNull();
    expect(k.medianHoursToFill).toBeNull();
    expect(k.applicationsPerOffer).toBeNull();
  });

  it("detecta ofertas sin postulantes y postulaciones sin respuesta", () => {
    const a = offer({ id: "a", created_at: iso(NOW - 2 * DAY) });
    const b = offer({ id: "b", created_at: iso(NOW - 5 * DAY) });
    const k = computeMarketKpis([a, b], [app("b", "pending", NOW - 3 * DAY)], NOW);
    expect(k.openWithoutApplications24h).toBe(1);
    expect(k.pendingApplicationsOver48h).toBe(1);
  });

  it("excluye ofertas bloqueadas", () => {
    const k = computeMarketKpis([offer(), offer({ blocked: true })], [], NOW);
    expect(k.total).toBe(1);
    expect(k.blocked).toBe(1);
  });
});

describe("evaluateCityBalance", () => {
  const row = (label: string, open: number, pros: number) => ({
    city_key: cityKey(label),
    city_label: label,
    open_offers: open,
    offers_30d: open,
    professionals_published: pros,
    professionals_available: pros,
  });
  it("clasifica y ordena las ciudades", () => {
    const r = evaluateCityBalance([
      row("Pasto", 1, 1),
      row("Pereira", 2, 2),
      row("Cali", 1, 12),
      row("Bogotá", 10, 3),
    ]);
    expect(r.map((x) => [x.city_label, x.status])).toEqual([
      ["Bogotá", "supply_gap"],
      ["Cali", "demand_gap"],
      ["Pereira", "balanced"],
      ["Pasto", "insufficient_data"],
    ]);
  });
  it("trata la ausencia total de profesionales como déficit", () => {
    const r = evaluateCityBalance([row("Leticia", 4, 0)]);
    expect(r[0].status).toBe("supply_gap");
    expect(r[0].ratio).toBeNull();
  });
});

describe("priceBenchmark", () => {
  const peers = [20000, 22000, 21000, 23000].map((amount) => offer({ amount }));
  it("compara con la mediana de pares", () => {
    expect(priceBenchmark(offer({ amount: 12000 }), peers).verdict).toBe("below");
    expect(priceBenchmark(offer({ amount: 21500 }), peers).verdict).toBe("in_range");
    expect(priceBenchmark(offer({ amount: 30000 }), peers).verdict).toBe("above");
  });
  it("declara datos insuficientes sin pares", () => {
    expect(priceBenchmark(offer(), []).verdict).toBe("insufficient");
  });
  it("no mezcla modalidades distintas", () => {
    const shifts = [90000, 95000, 100000].map((amount) => offer({ amount, modality: "shift" }));
    expect(priceBenchmark(offer({ amount: 21000, modality: "hour" }), shifts).verdict).toBe(
      "insufficient",
    );
  });
});

describe("offerQuality", () => {
  it("da 100 a una oferta completa y lista lo que falta", () => {
    expect(offerQuality(offer()).score).toBe(100);
    const q = offerQuality(
      offer({ description: "corta", specialty_required: null, start_date: null }),
    );
    expect(q.score).toBe(45);
    expect(q.missing).toEqual(
      expect.arrayContaining(["Especialidad requerida", "Fecha de inicio"]),
    );
  });
});

describe("offerRiskSignals", () => {
  const peers = [20000, 22000, 21000, 23000].map((amount, i) =>
    offer({ amount, posted_by: `peer-${i}` }),
  );
  it("no marca una oferta normal", () => {
    expect(offerRiskSignals(offer(), peers, NOW)).toEqual([]);
  });
  it("detecta teléfono, anticipo y precio muy bajo", () => {
    const phone = offerRiskSignals(
      offer({ description: "Escríbeme al 300 123 4567 para más detalles del turno" }),
      peers,
      NOW,
    );
    expect(phone.map((s) => s.code)).toContain("contact_leak");
    const fee = offerRiskSignals(
      offer({ description: "Debes consignar antes un anticipo para asegurar el cupo del turno" }),
      peers,
      NOW,
    );
    expect(fee[0]).toMatchObject({ code: "upfront_fee", severity: "high" });
    const cheap = offerRiskSignals(offer({ amount: 5000 }), peers, NOW);
    expect(cheap.map((s) => s.code)).toContain("price_too_low");
  });
  it("detecta publicaciones idénticas repetidas del mismo autor", () => {
    const a = offer({ id: "r1", title: "Cuidador urgente" });
    const dupes = [a, ...["r2", "r3", "r4"].map((id) => offer({ id, title: "Cuidador urgente" }))];
    expect(offerRiskSignals(a, dupes, NOW)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "repeated_post", severity: "medium" }),
      ]),
    );
  });
  it("una sola copia exacta es solo una advertencia leve", () => {
    const a = offer({ id: "d1", title: "Cuidador nocturno" });
    const signals = offerRiskSignals(a, [a, offer({ id: "d2", title: "Cuidador nocturno" })], NOW);
    expect(signals.map((s) => [s.code, s.severity])).toContainEqual(["possible_duplicate", "low"]);
  });
  it("no penaliza turnos iguales publicados para fechas distintas (publicación masiva)", () => {
    const shifts = [1, 2, 3, 4].map((n) =>
      offer({ id: `b${n}`, title: "Auxiliar turno noche", start_date: iso(NOW + n * DAY) }),
    );
    expect(offerRiskSignals(shifts[0], shifts, NOW).map((s) => s.code)).not.toContain(
      "repeated_post",
    );
    expect(offerRiskSignals(shifts[0], shifts, NOW).map((s) => s.code)).not.toContain(
      "possible_duplicate",
    );
  });
});

describe("explainMatch", () => {
  const pro: SuggestedPro = {
    user_id: "p1",
    full_name: "Ana",
    avatar_url: null,
    specialty: "Enfermería",
    home_city: "Bogotá",
    hourly_rate: 20000,
    avg_rating: 4.8,
    total_jobs: 12,
    rethus_verified: true,
    available: true,
    matches_specialty: true,
    serves_city: true,
    similarity: 0.72,
    rule_score: 95,
    final_score: 90,
    source: "embedding+reglas",
  };
  it("lista razones y advertencias", () => {
    const e = explainMatch(offer(), pro);
    expect(e.reasons.join(" | ")).toMatch(/Especialidad coincide/);
    expect(e.reasons.join(" | ")).toMatch(/RETHUS/);
    expect(e.cautions).toEqual([]);
    const e2 = explainMatch(offer(), {
      ...pro,
      matches_specialty: false,
      serves_city: false,
      hourly_rate: 40000,
      rethus_verified: false,
    });
    expect(e2.cautions.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildRecommendations", () => {
  const kpis = computeMarketKpis([], [], NOW);
  const base = {
    kpis,
    riskyOffers: 0,
    urgentUncovered: 0,
    cities: [],
    pqrs: { breached: 0, atRisk: 0, criticalSafety: 0, unclassified: 0, unassigned: 0, spikes: [] },
  };
  it("informa que todo está en orden", () => {
    expect(buildRecommendations(base)).toHaveLength(1);
    expect(buildRecommendations(base)[0].id).toBe("ok");
  });
  it("ordena por severidad", () => {
    const r = buildRecommendations({
      ...base,
      riskyOffers: 2,
      urgentUncovered: 1,
      pqrs: { ...base.pqrs, criticalSafety: 1, unclassified: 3 },
    });
    expect(r.map((x) => x.severity)).toEqual(["critical", "high", "high", "info"]);
    expect(r[0].id).toBe("safety");
  });
});
