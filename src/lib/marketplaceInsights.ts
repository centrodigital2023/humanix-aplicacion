// Inteligencia de mercado para el panel de superadmin. Funciones puras y explicables:
// usan únicamente datos reales y devuelven `null` cuando la muestra es insuficiente.

import { normalizeText } from "./pqrsRules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Tamaño mínimo de muestra para mostrar una tasa. Debajo de esto, «datos insuficientes». */
export const MIN_SAMPLE = 5;
const MIN_TIME_SAMPLE = 3;

export type OfferStatus = "open" | "closed" | "filled";

export interface OfferRow {
  id: string;
  title: string;
  description: string | null;
  city: string;
  amount: number;
  modality: string;
  status: OfferStatus;
  created_at: string;
  updated_at?: string | null;
  poster_type: string;
  specialty_required: string | null;
  start_date?: string | null;
  end_date?: string | null;
  shifts_count?: number | null;
  blocked?: boolean | null;
  blocked_reason?: string | null;
  posted_by?: string | null;
  requirements?: string[] | null;
  /** Ya no se publica en la oferta (vive en `job_offer_private`); solo quedan filas antiguas. */
  address?: string | null;
  service_area?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface ApplicationRow {
  job_offer_id: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
  updated_at: string;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Misma normalización que `public.city_key` en SQL, para cruzar datos del servidor con el cliente. */
export function cityKey(city: string | null | undefined): string {
  return normalizeText(city ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/( d c| dc| distrito capital)$/, "")
    .trim();
}

const ts = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

// ─── KPIs de liquidez ────────────────────────────────────────────────────────

export interface RateStat {
  rate: number | null;
  cohort: number;
  filled: number;
}

export interface MarketKpis {
  total: number;
  open: number;
  filled: number;
  blocked: number;
  fill7: RateStat;
  fill14: RateStat;
  fill30: RateStat;
  medianHoursToFirstApplication: number | null;
  sampleFirstApplication: number;
  medianHoursToFill: number | null;
  sampleFill: number;
  applicationsPerOffer: number | null;
  openWithoutApplications24h: number;
  pendingApplicationsOver48h: number;
}

function groupApps(apps: ApplicationRow[]): Map<string, ApplicationRow[]> {
  const m = new Map<string, ApplicationRow[]>();
  for (const a of apps) {
    const list = m.get(a.job_offer_id);
    if (list) list.push(a);
    else m.set(a.job_offer_id, [a]);
  }
  return m;
}

/** Instante en que la oferta quedó cubierta: primera postulación aceptada o, si no hay, su cierre como «filled». */
export function fillTime(offer: OfferRow, apps: ApplicationRow[]): number | null {
  const accepted = apps
    .filter((a) => a.status === "accepted")
    .map((a) => ts(a.updated_at))
    .filter(Number.isFinite);
  if (accepted.length) return Math.min(...accepted);
  if (offer.status === "filled") {
    const t = ts(offer.updated_at);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function computeMarketKpis(
  offers: OfferRow[],
  apps: ApplicationRow[],
  now: number = Date.now(),
): MarketKpis {
  const live = offers.filter((o) => !o.blocked);
  const byOffer = groupApps(apps);

  const rate = (days: number): RateStat => {
    const cohort = live.filter((o) => now - ts(o.created_at) >= days * DAY);
    const filled = cohort.filter((o) => {
      const f = fillTime(o, byOffer.get(o.id) ?? []);
      return f !== null && f - ts(o.created_at) <= days * DAY;
    }).length;
    return {
      rate: cohort.length >= MIN_SAMPLE ? filled / cohort.length : null,
      cohort: cohort.length,
      filled,
    };
  };

  const firstAppHours: number[] = [];
  const fillHours: number[] = [];
  let totalApps = 0;
  let openWithoutApps24h = 0;
  let pendingOver48h = 0;

  for (const o of live) {
    const list = byOffer.get(o.id) ?? [];
    const created = ts(o.created_at);
    totalApps += list.length;
    if (list.length) {
      const first = Math.min(...list.map((a) => ts(a.created_at)));
      if (Number.isFinite(first) && first >= created) firstAppHours.push((first - created) / HOUR);
    }
    const f = fillTime(o, list);
    if (f !== null && f >= created) fillHours.push((f - created) / HOUR);
    if (o.status === "open") {
      if (!list.length && now - created > DAY) openWithoutApps24h++;
      pendingOver48h += list.filter(
        (a) => a.status === "pending" && now - ts(a.created_at) > 2 * DAY,
      ).length;
    }
  }

  return {
    total: live.length,
    open: live.filter((o) => o.status === "open").length,
    filled: live.filter((o) => o.status === "filled").length,
    blocked: offers.length - live.length,
    fill7: rate(7),
    fill14: rate(14),
    fill30: rate(30),
    medianHoursToFirstApplication:
      firstAppHours.length >= MIN_TIME_SAMPLE ? median(firstAppHours) : null,
    sampleFirstApplication: firstAppHours.length,
    medianHoursToFill: fillHours.length >= MIN_TIME_SAMPLE ? median(fillHours) : null,
    sampleFill: fillHours.length,
    applicationsPerOffer: live.length >= MIN_SAMPLE ? totalApps / live.length : null,
    openWithoutApplications24h: openWithoutApps24h,
    pendingApplicationsOver48h: pendingOver48h,
  };
}

// ─── Oferta vs. demanda por ciudad ───────────────────────────────────────────

export interface CityRowRaw {
  city_key: string;
  city_label: string;
  open_offers: number;
  offers_30d: number;
  professionals_published: number;
  professionals_available: number;
}

export type CityStatus = "supply_gap" | "demand_gap" | "balanced" | "insufficient_data";

export interface CityBalanceRow extends CityRowRaw {
  /** Ofertas abiertas por profesional disponible. `null` si no hay profesionales. */
  ratio: number | null;
  status: CityStatus;
  action: string;
}

export function evaluateCityBalance(rows: CityRowRaw[]): CityBalanceRow[] {
  const out = rows.map((r): CityBalanceRow => {
    const pros = r.professionals_available;
    const volume = r.open_offers + pros;
    const ratio = pros > 0 ? r.open_offers / pros : null;
    let status: CityStatus = "balanced";
    if (volume < 4) status = "insufficient_data";
    else if (pros === 0 && r.open_offers > 0) status = "supply_gap";
    else if (ratio !== null && ratio > 1.5) status = "supply_gap";
    else if (ratio !== null && ratio < 0.34 && pros >= 5) status = "demand_gap";

    const action =
      status === "supply_gap"
        ? `Reclutar y activar profesionales en ${r.city_label}: ${r.open_offers} oferta(s) abierta(s) para ${pros} disponible(s).`
        : status === "demand_gap"
          ? `Atraer familias e IPS en ${r.city_label}: hay ${pros} profesionales disponibles para ${r.open_offers} oferta(s).`
          : status === "insufficient_data"
            ? "Muestra insuficiente para una conclusión."
            : "Oferta y demanda equilibradas.";
    return { ...r, ratio, status, action };
  });
  const rank: Record<CityStatus, number> = {
    supply_gap: 0,
    demand_gap: 1,
    balanced: 2,
    insufficient_data: 3,
  };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.open_offers - a.open_offers);
}

// ─── Precio frente al mercado ────────────────────────────────────────────────

export type PriceVerdict = "below" | "in_range" | "above" | "insufficient";

export interface PriceBenchmark {
  verdict: PriceVerdict;
  median: number | null;
  deltaPct: number | null;
  peers: number;
  scope: string;
}

export function priceBenchmark(offer: OfferRow, all: OfferRow[]): PriceBenchmark {
  const key = cityKey(offer.city);
  const spec = normalizeText(offer.specialty_required ?? "");
  const comparable = all.filter(
    (o) => o.id !== offer.id && !o.blocked && o.modality === offer.modality && o.amount > 0,
  );
  const tiers: Array<{ scope: string; peers: OfferRow[] }> = [];
  if (spec) {
    tiers.push({
      scope: "misma ciudad y especialidad",
      peers: comparable.filter(
        (o) => cityKey(o.city) === key && normalizeText(o.specialty_required ?? "") === spec,
      ),
    });
  }
  tiers.push({ scope: "misma ciudad", peers: comparable.filter((o) => cityKey(o.city) === key) });
  tiers.push({ scope: "todo el país", peers: comparable });

  const tier = tiers.find((t) => t.peers.length >= 3);
  if (!tier)
    return {
      verdict: "insufficient",
      median: null,
      deltaPct: null,
      peers: comparable.length,
      scope: "sin pares suficientes",
    };

  const med = median(tier.peers.map((p) => p.amount)) as number;
  const delta = (offer.amount - med) / med;
  return {
    verdict: delta < -0.15 ? "below" : delta > 0.25 ? "above" : "in_range",
    median: Math.round(med),
    deltaPct: Math.round(delta * 100),
    peers: tier.peers.length,
    scope: tier.scope,
  };
}

// ─── Calidad de la oferta ────────────────────────────────────────────────────

export function offerQuality(offer: OfferRow): { score: number; missing: string[] } {
  const checks: Array<{ ok: boolean; weight: number; missing: string }> = [
    {
      ok: (offer.description ?? "").trim().length >= 80,
      weight: 25,
      missing: "Descripción de al menos 80 caracteres",
    },
    { ok: !!offer.specialty_required, weight: 15, missing: "Especialidad requerida" },
    { ok: !!offer.start_date, weight: 15, missing: "Fecha de inicio" },
    { ok: (offer.requirements?.length ?? 0) > 0, weight: 10, missing: "Requisitos del cargo" },
    {
      // La dirección exacta es privada: la ubicación pública es el área del servicio o el punto aproximado del mapa.
      ok: !!(
        offer.address?.trim() ||
        offer.service_area?.trim() ||
        (offer.lat != null && offer.lng != null)
      ),
      weight: 10,
      missing: "Zona del servicio (área o ubicación en el mapa)",
    },
    { ok: offer.title.trim().length >= 12, weight: 10, missing: "Título descriptivo" },
    { ok: offer.amount > 0, weight: 15, missing: "Valor ofrecido" },
  ];
  return {
    score: checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0),
    missing: checks.filter((c) => !c.ok).map((c) => c.missing),
  };
}

// ─── Señales de riesgo de la oferta ──────────────────────────────────────────

export type RiskSeverity = "low" | "medium" | "high";
export interface RiskSignal {
  code: string;
  severity: RiskSeverity;
  label: string;
}

const PHONE_RE = /(?:\+?57[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const URL_RE = /(https?:\/\/|www\.)\S+/i;
const WHATSAPP_RE = /(whats ?app|wa\.me)/i;
const UPFRONT_FEE_RE =
  /(anticipo|deposito previo|consigna(r)? (antes|primero)|pagar para (trabajar|aplicar)|costo de inscripcion|pago de inscripcion)/;
const AVOID_PLATFORM_RE =
  /(evitar la comision|sin comision|pago por fuera|fuera de la plataforma|sin pasar por humanix)/;

export function offerRiskSignals(
  offer: OfferRow,
  all: OfferRow[],
  now: number = Date.now(),
): RiskSignal[] {
  const out: RiskSignal[] = [];
  const text = `${offer.title} ${offer.description ?? ""}`;
  const norm = normalizeText(text);

  if (UPFRONT_FEE_RE.test(norm))
    out.push({
      code: "upfront_fee",
      severity: "high",
      label: "Solicita dinero por adelantado (patrón típico de estafa laboral)",
    });
  if (AVOID_PLATFORM_RE.test(norm))
    out.push({
      code: "avoid_platform",
      severity: "high",
      label: "Invita a evitar la plataforma o su comisión",
    });
  if (PHONE_RE.test(text) || EMAIL_RE.test(text) || WHATSAPP_RE.test(text)) {
    out.push({
      code: "contact_leak",
      severity: "medium",
      label: "Datos de contacto en el texto (riesgo de desintermediación)",
    });
  }
  if (URL_RE.test(text))
    out.push({ code: "external_link", severity: "medium", label: "Enlace externo en la oferta" });

  const bench = priceBenchmark(offer, all);
  if (bench.median && offer.amount < bench.median * 0.5) {
    out.push({
      code: "price_too_low",
      severity: "medium",
      label: `Valor muy inferior al mercado (${bench.deltaPct}% vs. mediana de ${bench.scope})`,
    });
  } else if (bench.median && offer.amount > bench.median * 3) {
    out.push({
      code: "price_too_high",
      severity: "medium",
      label: "Valor atípicamente alto frente al mercado",
    });
  }

  if (offer.posted_by) {
    // Solo duplicados exactos (mismo autor, título, ciudad, día de inicio y valor): una IPS que publica
    // turnos iguales en distintas fechas es un uso legítimo de la publicación masiva.
    const dupKey = (o: OfferRow) =>
      [
        o.posted_by,
        normalizeText(o.title),
        cityKey(o.city),
        (o.start_date ?? "").slice(0, 10),
        o.amount,
      ].join("|");
    const key = dupKey(offer);
    const dupes = all.filter(
      (o) =>
        o.id !== offer.id &&
        dupKey(o) === key &&
        Math.abs(ts(o.created_at) - ts(offer.created_at)) <= 2 * DAY,
    ).length;
    if (dupes >= 3)
      out.push({
        code: "repeated_post",
        severity: "medium",
        label: `Publicación repetida (${dupes + 1} veces idéntica en 48 h)`,
      });
    else if (dupes >= 1)
      out.push({
        code: "possible_duplicate",
        severity: "low",
        label: "Posible publicación duplicada (mismo autor, día y valor)",
      });
  }

  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letters.length >= 20 && letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length / letters.length > 0.7) {
    out.push({ code: "all_caps", severity: "low", label: "Texto en mayúsculas (posible spam)" });
  }

  if (offer.status === "open" && ts(offer.start_date) < now - DAY) {
    out.push({
      code: "stale_start",
      severity: "low",
      label: "La fecha de inicio ya pasó y la oferta sigue abierta",
    });
  }

  const rank: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const maxSeverity = (signals: RiskSignal[]): RiskSeverity | null =>
  signals.some((s) => s.severity === "high")
    ? "high"
    : signals.some((s) => s.severity === "medium")
      ? "medium"
      : signals.length
        ? "low"
        : null;

// ─── Matchmaking explicable ──────────────────────────────────────────────────

export interface SuggestedPro {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  home_city: string | null;
  hourly_rate: number | null;
  avg_rating: number | null;
  total_jobs: number | null;
  rethus_verified: boolean | null;
  available: boolean | null;
  matches_specialty: boolean;
  serves_city: boolean;
  similarity: number | null;
  rule_score: number;
  final_score: number;
  source: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

export function explainMatch(
  offer: OfferRow,
  pro: SuggestedPro,
): { reasons: string[]; cautions: string[] } {
  const reasons: string[] = [];
  const cautions: string[] = [];

  if (pro.matches_specialty)
    reasons.push(`Especialidad coincide${pro.specialty ? ` (${pro.specialty})` : ""}`);
  else if (offer.specialty_required)
    cautions.push(`No declara la especialidad requerida (${offer.specialty_required})`);
  if (pro.serves_city) reasons.push(`Atiende en ${offer.city}`);
  else cautions.push(`No registra ${offer.city} como zona de servicio`);
  if (pro.available) reasons.push("Disponible ahora");
  else cautions.push("No está marcado como disponible");
  if (pro.rethus_verified) reasons.push("RETHUS verificado");
  else cautions.push("Sin RETHUS verificado");
  if ((pro.avg_rating ?? 0) >= 4.5 && (pro.total_jobs ?? 0) >= 3) {
    reasons.push(
      `Alta calificación (${Number(pro.avg_rating).toFixed(1)} · ${pro.total_jobs} servicios)`,
    );
  } else if ((pro.total_jobs ?? 0) === 0) {
    cautions.push("Aún sin servicios completados en Humanix");
  }
  if ((pro.similarity ?? 0) >= 0.6)
    reasons.push(`Perfil muy similar a la oferta (${Math.round((pro.similarity ?? 0) * 100)}% IA)`);

  if (offer.modality === "hour" && pro.hourly_rate && offer.amount > 0) {
    if (pro.hourly_rate <= offer.amount * 1.05)
      reasons.push(`Su tarifa (${money(pro.hourly_rate)}/h) es compatible con la oferta`);
    else
      cautions.push(
        `Su tarifa (${money(pro.hourly_rate)}/h) supera la oferta en ${Math.round((pro.hourly_rate / offer.amount - 1) * 100)}%`,
      );
  }
  return { reasons, cautions };
}

// ─── Recomendaciones priorizadas ─────────────────────────────────────────────

export type RecSeverity = "critical" | "high" | "medium" | "info";
export interface Recommendation {
  id: string;
  severity: RecSeverity;
  title: string;
  detail: string;
  tab: "overview" | "offers" | "pqrs";
  count?: number;
}

export interface RecommendationInput {
  kpis: MarketKpis;
  riskyOffers: number;
  urgentUncovered: number;
  cities: CityBalanceRow[];
  pqrs: {
    breached: number;
    atRisk: number;
    criticalSafety: number;
    unclassified: number;
    unassigned: number;
    spikes: Array<{ key: string; current: number; changePct: number | null }>;
  };
}

export function buildRecommendations(i: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = [];
  const add = (r: Recommendation) => recs.push(r);

  if (i.pqrs.criticalSafety > 0) {
    add({
      id: "safety",
      severity: "critical",
      tab: "pqrs",
      count: i.pqrs.criticalSafety,
      title: `${i.pqrs.criticalSafety} PQRS con señales de seguridad críticas`,
      detail:
        "Revísalos primero: mencionan posible daño físico, emergencia médica, acoso o riesgo personal.",
    });
  }
  if (i.pqrs.breached > 0) {
    add({
      id: "breached",
      severity: "critical",
      tab: "pqrs",
      count: i.pqrs.breached,
      title: `${i.pqrs.breached} PQRS con plazo legal vencido`,
      detail:
        "Responde de inmediato o comunica la prórroga con sus motivos; valida el plazo aplicable con asesoría jurídica.",
    });
  }
  if (i.urgentUncovered > 0) {
    add({
      id: "urgent-uncovered",
      severity: "high",
      tab: "offers",
      count: i.urgentUncovered,
      title: `${i.urgentUncovered} oferta(s) sin candidatos que empiezan en menos de 48 h`,
      detail: "Usa el matchmaking para invitar a los profesionales más compatibles.",
    });
  }
  if (i.pqrs.atRisk > 0) {
    add({
      id: "at-risk",
      severity: "high",
      tab: "pqrs",
      count: i.pqrs.atRisk,
      title: `${i.pqrs.atRisk} PQRS en riesgo de incumplir su plazo`,
      detail: "Ordenadas por riesgo en la cola de PQRS.",
    });
  }
  if (i.riskyOffers > 0) {
    add({
      id: "risky-offers",
      severity: "high",
      tab: "offers",
      count: i.riskyOffers,
      title: `${i.riskyOffers} oferta(s) con señales de riesgo`,
      detail:
        "Posible desintermediación, cobros por adelantado o precios atípicos. Revisa y modera.",
    });
  }
  for (const c of i.cities.filter((c) => c.status === "supply_gap").slice(0, 3)) {
    add({
      id: `gap-${c.city_key}`,
      severity: "medium",
      tab: "overview",
      count: c.open_offers,
      title: `Faltan profesionales en ${c.city_label}`,
      detail: c.action,
    });
  }
  if (i.kpis.pendingApplicationsOver48h > 0) {
    add({
      id: "pending-apps",
      severity: "medium",
      tab: "offers",
      count: i.kpis.pendingApplicationsOver48h,
      title: `${i.kpis.pendingApplicationsOver48h} postulación(es) sin respuesta del contratante por más de 48 h`,
      detail:
        "Las respuestas lentas enfrían al profesional y reducen la conversión. Considera un recordatorio.",
    });
  }
  for (const s of i.pqrs.spikes.slice(0, 2)) {
    add({
      id: `spike-${s.key}`,
      severity: "medium",
      tab: "pqrs",
      count: s.current,
      title: `Pico de PQRS de «${s.key}»`,
      detail: `${s.current} esta semana${s.changePct !== null ? ` (${s.changePct >= 0 ? "+" : ""}${s.changePct}% vs. la semana previa)` : " (sin casos la semana anterior)"}. Busca una causa común.`,
    });
  }
  if (i.pqrs.unassigned > 0) {
    add({
      id: "unassigned",
      severity: "info",
      tab: "pqrs",
      count: i.pqrs.unassigned,
      title: `${i.pqrs.unassigned} PQRS abiertos sin responsable`,
      detail: "Asigna cada caso a una persona.",
    });
  }
  if (i.pqrs.unclassified > 0) {
    add({
      id: "unclassified",
      severity: "info",
      tab: "pqrs",
      count: i.pqrs.unclassified,
      title: `${i.pqrs.unclassified} PQRS sin clasificar por IA`,
      detail: "Usa «Clasificar pendientes» para priorizarlos.",
    });
  }
  for (const c of i.cities.filter((c) => c.status === "demand_gap").slice(0, 2)) {
    add({
      id: `demand-${c.city_key}`,
      severity: "info",
      tab: "overview",
      title: `Hay profesionales sin demanda en ${c.city_label}`,
      detail: c.action,
    });
  }
  if (!recs.length) {
    add({
      id: "ok",
      severity: "info",
      tab: "overview",
      title: "Todo en orden",
      detail: "No hay alertas pendientes con los datos actuales.",
    });
  }
  const rank: Record<RecSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  return recs.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
