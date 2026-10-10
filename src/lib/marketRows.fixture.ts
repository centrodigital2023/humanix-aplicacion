// Datos de prueba compartidos por las pruebas de la validación de mercado (no es una prueba: no se carga en la app).
import { CHANNEL_VALUES, PAY_VALUES, PROFILES, type ResponseRow } from "./marketValidation";

export const NOW = Date.parse("2026-10-11T15:00:00Z");

/** Una respuesta completa y verificada; cada prueba cambia solo lo que le importa. */
export const row = (over: Partial<ResponseRow> = {}): ResponseRow => ({
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

// Generador pseudoaleatorio con semilla: la prueba es repetible.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "cuidado",
  "turno",
  "caro",
  "confianza",
  "antecedentes",
  "rápido",
  "pago",
  "Medellín",
  "=SUMA(1+1)",
  "+57",
  "-5",
  "@cmd",
  "a;b",
  'comillas "dobles"',
  "línea\nnueva",
  "tab\tulador",
];

function randomRow(rnd: () => number, i: number): ResponseRow {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const maybe = <T>(v: T, p = 0.25): T | null => (rnd() < p ? null : v);
  const text = () =>
    maybe(Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(WORDS)).join(" "), 0.2);
  const day = Math.floor(rnd() * 40);
  const created =
    rnd() < 0.03
      ? "fecha-rota"
      : new Date(NOW - day * 86_400_000 - rnd() * 86_400_000).toISOString();
  return {
    id: `r${i}`,
    created_at: created,
    profile_type: rnd() < 0.05 ? "otro_perfil" : pick(PROFILES),
    full_name: text(),
    whatsapp: maybe("573001234567"),
    email: maybe("x@y.co"),
    city: maybe(pick(["Bogotá", "Cali", "  ", "Medellín"])),
    service_offer: text(),
    pain_point: text(),
    target_customer: text(),
    key_benefit: text(),
    pays_currently: rnd() < 0.1 ? "talvez" : maybe(pick(PAY_VALUES)),
    alternatives: maybe(
      Array.from({ length: Math.floor(rnd() * 4) }, () => pick(WORDS)),
      0.3,
    ),
    competitors: text(),
    search_channels: maybe(
      Array.from({ length: Math.floor(rnd() * 5) }, () =>
        rnd() < 0.1 ? "canal_desconocido" : pick(CHANNEL_VALUES),
      ),
      0.3,
    ),
    retention_channels: text(),
    willingness_pct: maybe(Math.round(rnd() * 140 - 20), 0.2), // incluye valores fuera de 0–100
    comments: text(),
    signal_score: maybe(Math.round(rnd() * 130 - 15), 0.3),
    total_score: maybe(Math.round(rnd() * 40), 0.6),
    quality_flags: maybe(rnd() < 0.3 ? ["low_effort"] : [], 0.4),
    contact_verified_at: maybe(new Date(NOW - rnd() * 86_400_000).toISOString(), 0.5),
    verified_channel: maybe(pick(["whatsapp", "email"])),
    promo_code: maybe(`MLP-${i}`, 0.5),
    benefit_status: maybe(pick(["none", "available", "redeemed", "expired", "duplicate_contact"])),
    premium_activated: maybe(rnd() < 0.2, 0.2),
    redeemed_at: maybe(new Date(NOW - rnd() * 86_400_000).toISOString(), 0.8),
  };
}

export const makeRows = (seed: number, n: number) => {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => randomRow(rnd, i));
};
