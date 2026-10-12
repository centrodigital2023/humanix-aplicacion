import { describe, expect, it } from "vitest";
import {
  buildApplicants,
  firstName,
  type ApplicationSource,
  type OfferSource,
  type ProFacts,
  type ProposalSource,
} from "./applicantSources";
import { rankApplicants } from "./applicantRanking";
import { HOUR, NOW, iso } from "./familyIntel.fixture";

const proposal = (over: Partial<ProposalSource> = {}): ProposalSource => ({
  id: "pr1",
  professional_id: "pro-1",
  status: "pending",
  proposed_by: "professional",
  hourly_rate: 24_000,
  posted_rate: 22_000,
  created_at: iso(-2 * HOUR),
  expires_at: iso(10 * HOUR),
  peer_name: "Laura Pérez",
  ...over,
});

const application = (over: Partial<ApplicationSource> = {}): ApplicationSource => ({
  id: "ap1",
  professional_id: "pro-2",
  status: "pending",
  created_at: iso(-5 * HOUR),
  proposed_amount: 2_900_000,
  job_offer_id: "of1",
  ...over,
});

const offer = (over: Partial<OfferSource> = {}): OfferSource => ({
  id: "of1",
  amount: 2_800_000,
  modality: "month",
  ...over,
});

const facts = (over: Partial<ProFacts> = {}): ProFacts => ({
  user_id: "pro-1",
  avg_rating: 4.8,
  total_jobs: 20,
  trust_score: 90,
  rethus_verified: true,
  verified: true,
  years_experience: 8,
  available: true,
  lat: 4.61,
  lng: -74.08,
  ...over,
});

type Args = Parameters<typeof buildApplicants>[0];
const base: Args = {
  proposals: [],
  applications: [],
  offers: [],
  facts: {},
  names: {},
  teamIds: [],
  completedWith: {},
  origin: { lat: 4.6097, lng: -74.0817 },
  now: NOW,
};
const build = (over: Partial<Args> = {}) => buildApplicants({ ...base, ...over });

describe("firstName", () => {
  it("toma el primer nombre y no inventa uno", () => {
    expect(firstName("Laura Pérez Gómez")).toBe("Laura");
    expect(firstName("  Ana  ")).toBe("Ana");
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });
});

describe("propuestas", () => {
  it("una propuesta vigente de un profesional pasa tal cual, con tarifa por hora", () => {
    const [a] = build({ proposals: [proposal()], facts: { "pro-1": facts() } });
    expect(a).toMatchObject({
      id: "pr1",
      source: "proposal",
      professionalId: "pro-1",
      name: "Laura",
      offeredRate: 24_000,
      postedRate: 22_000,
      hourly: true,
      avgRating: 4.8,
      totalJobs: 20,
      trustScore: 90,
      rethusVerified: true,
      verified: true,
      yearsExperience: 8,
      available: true,
      inTeam: false,
      servicesTogether: 0,
    });
    expect(a.km).toBeLessThan(1);
  });

  it("no pasan las propias de la familia, las ya resueltas ni las vencidas", () => {
    const rows = build({
      proposals: [
        proposal({ id: "a", proposed_by: "family" }),
        proposal({ id: "b", status: "accepted" }),
        proposal({ id: "c", status: "countered" }),
        proposal({ id: "d", expires_at: iso(-HOUR) }),
        proposal({ id: "e", expires_at: iso(0) }), // vence ahora mismo
        proposal({ id: "ok", expires_at: null }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
  });

  it("una tarifa vacía o en cero no cuenta como tarifa", () => {
    const rows = build({
      proposals: [
        proposal({ id: "a", hourly_rate: 0, posted_rate: null }),
        proposal({ id: "b", hourly_rate: "abc" }),
      ],
    });
    expect(rows.map((r) => [r.offeredRate, r.postedRate])).toEqual([
      [null, null],
      [null, 22_000],
    ]);
  });

  it("sin nombre en la lista usa el que trae la propuesta, solo el primer nombre", () => {
    expect(build({ proposals: [proposal({ peer_name: "Marta Ruiz" })] })[0].name).toBe("Marta");
    expect(build({ proposals: [proposal({ peer_name: null })] })[0].name).toBeNull();
    expect(build({ proposals: [proposal()], names: { "pro-1": "Beatriz Cano" } })[0].name).toBe(
      "Beatriz",
    );
  });
});

describe("postulaciones", () => {
  it("la tarifa se compara con lo publicado en la oferta; por mes no es una tarifa por hora", () => {
    const [a] = build({ applications: [application()], offers: [offer()] });
    expect(a).toMatchObject({
      source: "application",
      offeredRate: 2_900_000,
      postedRate: 2_800_000,
      hourly: false,
    });
  });

  it("una oferta por hora sí se compara con el rango de la ciudad", () => {
    const [a] = build({
      applications: [application({ proposed_amount: 26_000 })],
      offers: [offer({ amount: 24_000, modality: "hour" })],
    });
    expect(a).toMatchObject({ offeredRate: 26_000, postedRate: 24_000, hourly: true });
  });

  it("si no propuso otro monto, acepta el publicado", () => {
    const [a] = build({
      applications: [application({ proposed_amount: null })],
      offers: [offer()],
    });
    expect(a.offeredRate).toBe(2_800_000);
    expect(a.postedRate).toBe(2_800_000);
  });

  it("si la oferta no está en la lista no se inventan montos", () => {
    const [a] = build({ applications: [application({ proposed_amount: null })], offers: [] });
    expect(a).toMatchObject({ offeredRate: null, postedRate: null, hourly: false });
  });

  it("solo pasan las pendientes", () => {
    const rows = build({
      applications: [
        application({ id: "a", status: "accepted" }),
        application({ id: "b", status: "rejected" }),
        application({ id: "c", status: "withdrawn" }),
        application({ id: "ok" }),
      ],
      offers: [offer()],
    });
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("lo que se sabe del profesional y de la familia", () => {
  it("sin datos del perfil quedan en null (no se inventan ni se acusan)", () => {
    const [a] = build({ proposals: [proposal()] });
    expect(a).toMatchObject({
      avgRating: null,
      totalJobs: null,
      trustScore: null,
      rethusVerified: null,
      verified: null,
      yearsExperience: null,
      available: null,
      km: null,
    });
  });

  it("lee números como texto y conserva los falsos como falsos", () => {
    const [a] = build({
      proposals: [proposal()],
      facts: {
        "pro-1": facts({
          avg_rating: "4.50",
          total_jobs: "12",
          trust_score: "77",
          years_experience: "3",
          rethus_verified: false,
          verified: false,
          available: false,
        }),
      },
    });
    expect(a).toMatchObject({
      avgRating: 4.5,
      totalJobs: 12,
      trustScore: 77,
      yearsExperience: 3,
      rethusVerified: false,
      verified: false,
      available: false,
    });
  });

  it("la distancia solo se calcula si se conocen las dos ubicaciones", () => {
    const withFacts = { "pro-1": facts({ lat: 6.2442, lng: -75.5812 }) }; // Medellín
    expect(build({ proposals: [proposal()], facts: withFacts })[0].km).toBeGreaterThan(230);
    expect(build({ proposals: [proposal()], facts: withFacts })[0].km).toBeLessThan(250);
    expect(
      build({ proposals: [proposal()], facts: withFacts, origin: { lat: null, lng: null } })[0].km,
    ).toBeNull();
    expect(
      build({ proposals: [proposal()], facts: withFacts, origin: { lat: 4.6, lng: null } })[0].km,
    ).toBeNull();
    expect(
      build({ proposals: [proposal()], facts: { "pro-1": facts({ lat: null }) } })[0].km,
    ).toBeNull();
  });

  it("equipo de confianza y servicios juntos", () => {
    const [a, b] = build({
      proposals: [
        proposal({ id: "a", professional_id: "pro-1" }),
        proposal({ id: "b", professional_id: "pro-9" }),
      ],
      teamIds: new Set(["pro-1"]),
      completedWith: { "pro-1": 3, "pro-9": 0 },
    });
    expect(a).toMatchObject({ inTeam: true, servicesTogether: 3 });
    expect(b).toMatchObject({ inTeam: false, servicesTogether: 0 });
  });

  it("conteos negativos o decimales no se cuelan", () => {
    const [a] = build({ proposals: [proposal()], completedWith: { "pro-1": -2 } });
    expect(a.servicesTogether).toBe(0);
    const [b] = build({ proposals: [proposal()], completedWith: { "pro-1": 2.9 } });
    expect(b.servicesTogether).toBe(2);
  });
});

describe("de punta a punta con el comparador", () => {
  it("el candidato conocido y verificado le gana al desconocido sin verificar", () => {
    const rows = build({
      proposals: [
        proposal({ id: "conocido", professional_id: "pro-1" }),
        proposal({ id: "nuevo", professional_id: "pro-3", hourly_rate: 20_000 }),
      ],
      facts: {
        "pro-1": facts(),
        "pro-3": facts({
          user_id: "pro-3",
          rethus_verified: false,
          verified: false,
          trust_score: 30,
          avg_rating: 0,
          total_jobs: 0,
          years_experience: 0,
          available: true,
        }),
      },
      teamIds: ["pro-1"],
      completedWith: { "pro-1": 2 },
    });
    const ranked = rankApplicants(rows, {
      market: { n: 12, p25: 20_000, median: 24_000, p75: 28_000 },
    });
    expect(ranked.map((r) => r.applicant.id)).toEqual(["conocido", "nuevo"]);
    expect(ranked[0].isTop).toBe(true);
    expect(ranked[1].cautions).toContain("Sin verificación RETHUS");
  });

  it("propuestas y postulaciones conviven en la misma lista", () => {
    const rows = build({
      proposals: [proposal()],
      applications: [application()],
      offers: [offer()],
      facts: { "pro-1": facts(), "pro-2": facts({ user_id: "pro-2" }) },
    });
    expect(rows.map((r) => r.source)).toEqual(["proposal", "application"]);
    expect(rankApplicants(rows)).toHaveLength(2);
  });
});
