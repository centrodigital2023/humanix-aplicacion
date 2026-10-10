// Formulario inteligente de validación de mercado — lógica pura (sin red ni base de datos).
//
// «Registro de usuario y beneficio premium»: la persona cuenta qué necesita (o qué ofrece), cómo resuelve hoy
// ese problema y cuánto pagaría; al verificar su contacto gana 1 mes del plan Esencial (el plan básico de pago).
// Cada formulario lleno llega al panel de superadmin, que lo tabula solo.
//
// Este archivo concentra TODO lo que se puede probar sin servidor:
//   · el esquema Zod (una sola validación: la usa el formulario y la repite el servidor),
//   · textos y ejemplos que se adaptan al perfil (familia, IPS/EPS, profesional),
//   · normalización de contactos (un mismo WhatsApp o correo = una sola persona),
//   · filtro de calidad (respuestas vacías, repetidas o sin sentido) y «señal de demanda» explicable,
//   · tabulación automática para el panel (perfiles, ¿paga hoy?, disposición a pagar, alternativas, canales,
//     palabras del dolor) y el CSV seguro para Excel.

import { z } from "zod";
import { bogotaDateTime, toCsv, type CsvColumn } from "./careExport";

// ─── Constantes del formulario ─────────────────────────────────────────────────

export const PROFILES = ["familia", "ips_eps", "profesional"] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_META: Record<Profile, { label: string; emoji: string }> = {
  familia: { label: "Familia / Usuario", emoji: "👨‍👩‍👧" },
  ips_eps: { label: "IPS / EPS", emoji: "🏥" },
  profesional: { label: "Profesional de Salud", emoji: "👩‍⚕️" },
};

export const PAY_VALUES = ["yes", "no", "not_researched"] as const;
export type PayAnswer = (typeof PAY_VALUES)[number];
export const PAY_LABEL: Record<PayAnswer, string> = {
  yes: "Sí",
  no: "No",
  not_researched: "Aún no lo he investigado",
};

export const CHANNEL_VALUES = [
  "facebook_groups",
  "whatsapp_groups",
  "recommendations",
  "employment_agencies",
  "job_boards",
  "directories",
  "google",
  "social_media",
  "institutions",
] as const;
export type ChannelValue = (typeof CHANNEL_VALUES)[number];
export const CHANNEL_LABEL: Record<ChannelValue, string> = {
  facebook_groups: "Grupos de Facebook",
  whatsapp_groups: "Grupos de WhatsApp",
  recommendations: "Recomendaciones de conocidos",
  employment_agencies: "Agencias de empleo o de enfermería",
  job_boards: "Bolsas de empleo en línea",
  directories: "Directorios y páginas web",
  google: "Búsqueda en Google",
  social_media: "Instagram, TikTok u otras redes",
  institutions: "Contactos de hospitales o clínicas",
};
export const CHANNELS = CHANNEL_VALUES.map((value) => ({ value, label: CHANNEL_LABEL[value] }));

export const CITIES = [
  "Bogotá",
  "Medellín",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga",
  "Pereira",
  "Otra ciudad",
] as const;

/** Beneficio por llenar el formulario: 1 mes del plan Esencial (el plan básico de pago). */
export const BENEFIT = {
  plan: "essential_monthly",
  months: 1,
  label: "1 mes del plan Esencial",
  /** Días que el código sigue vigente tras verificar el contacto. */
  validDays: 60,
} as const;

/** Versión del texto de autorización de datos (Ley 1581 de 2012) que aceptó la persona. */
export const CONSENT_VERSION = "2026-10";

/** Un formulario con 8 respuestas escritas no se llena en menos de esto: es un robot. */
export const MIN_FILL_MS = 8_000;

export const LIMITS = {
  fullName: 120,
  serviceOffer: 300,
  painPoint: 800,
  targetAudience: 500,
  dailyChange: 800,
  alternative: 80,
  channelsOther: 300,
  comments: 1000,
} as const;

// ─── Texto y palabras ──────────────────────────────────────────────────────────

/** Minúsculas, sin tildes y con espacios simples: para comparar y contar. */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return normalizeText(text).match(/[a-zñ0-9]+/g) ?? [];
}

export function countWords(text: string): number {
  return (text.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

// ─── Contactos ─────────────────────────────────────────────────────────────────

export type ContactKind = "whatsapp" | "email";

export interface NormalizedContact {
  kind: ContactKind;
  /** Lo que se guarda y a lo que se envía el código (correo en minúsculas; celular con 57). */
  value: string;
  /** Clave de unicidad: una persona = una clave (quita «+etiqueta» y los puntos de Gmail). */
  key: string;
  display: string;
  masked: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeContact(raw: string): NormalizedContact | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 254) return null;

  if (text.includes("@")) {
    if (!EMAIL_RE.test(text)) return null;
    const [localRaw, domainRaw] = [
      text.slice(0, text.lastIndexOf("@")),
      text.slice(text.lastIndexOf("@") + 1),
    ];
    const domain =
      domainRaw.toLowerCase() === "googlemail.com" ? "gmail.com" : domainRaw.toLowerCase();
    const local = localRaw.toLowerCase();
    const base = local.split("+")[0];
    const keyLocal = domain === "gmail.com" ? base.replace(/\./g, "") : base;
    if (!keyLocal) return null;
    const value = `${local}@${domainRaw.toLowerCase()}`;
    return {
      kind: "email",
      value,
      key: `${keyLocal}@${domain}`,
      display: value,
      masked: `${local.slice(0, 2) || "**"}***@${domainRaw.toLowerCase()}`,
    };
  }

  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("0057")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("57")) digits = digits.slice(2);
  if (!/^3\d{9}$/.test(digits)) return null; // celular colombiano: 10 dígitos que empiezan por 3
  return {
    kind: "whatsapp",
    value: `57${digits}`,
    key: `57${digits}`,
    display: `+57 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
    masked: `+57 ${digits.slice(0, 3)} *** ${digits.slice(7)}`,
  };
}

/**
 * Dominios de correo temporal («10 minutos», buzones públicos): sirven para cobrar el beneficio muchas veces.
 * Se rechazan también sus subdominios. La lista es corta a propósito: solo los más usados.
 */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "temp-mail.org",
  "temp-mail.io",
  "tmpmail.org",
  "tmpmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "trashmail.de",
  "trashmail.me",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "mohmal.com",
  "fakeinbox.com",
  "mintemail.com",
  "mytemp.email",
  "emailondeck.com",
  "spamgourmet.com",
  "burnermail.io",
  "discard.email",
  "mailcatch.com",
  "inboxkitten.com",
  "moakt.com",
  "tempinbox.com",
  "mail.tm",
  "owlymail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return false;
  const parts = domain.split(".");
  // «x.mailinator.com» también cuenta: se prueba cada sufijo del dominio
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

// ─── Textos por perfil (la pregunta es la misma; los ejemplos se adaptan) ────────

export interface QuestionCopy {
  label: string;
  hint: string;
  example: string;
}
export type QuestionKey =
  | "serviceOffer"
  | "painPoint"
  | "targetAudience"
  | "dailyChange"
  | "comments";

const BASE_QUESTIONS: Record<QuestionKey, Omit<QuestionCopy, "example">> = {
  serviceOffer: {
    label: "¿Qué producto o servicio buscas contratar u ofrecer en Humanix?",
    hint: "Descríbelo en una sola frase concisa.",
  },
  painPoint: {
    label: "¿Qué problema o punto de dolor específico te resuelve Humanix?",
    hint: "Explica la necesidad urgente o molestia que solucionamos.",
  },
  targetAudience: {
    label: "¿Quiénes enfrentan principalmente esta necesidad? (Público objetivo)",
    hint: "Especifica edad, ocupación, ciudad o barrio, o tipo de institución.",
  },
  dailyChange: {
    label: "¿Qué cambia en tu día a día al empezar a utilizar Humanix?",
    hint: "Explica el beneficio clave o la tranquilidad que obtienes.",
  },
  comments: {
    label: "Comentarios, sugerencias o requerimientos clave",
    hint: "Lo que sí o sí necesitas para confiar y pagar (opcional, pero es lo que más nos ayuda).",
  },
};

const EXAMPLES: Record<Profile, Record<QuestionKey, string>> = {
  familia: {
    serviceOffer: "Busco una auxiliar de enfermería para cuidar a mi mamá de noche, en Bogotá.",
    painPoint:
      "No sé en quién confiar para dejar sola a mi mamá, y las agencias cobran mucho y no responden rápido.",
    targetAudience:
      "Hijos de 35 a 55 años que trabajan todo el día y viven en una ciudad distinta a la de sus padres.",
    dailyChange:
      "Podría trabajar tranquilo sabiendo que alguien verificado la acompaña y me avisa cómo va el turno.",
    comments: "Es indispensable ver los antecedentes judiciales y la verificación del profesional.",
  },
  ips_eps: {
    serviceOffer:
      "Cubrir turnos de enfermería y auxiliares con personal verificado en menos de una hora.",
    painPoint:
      "Cuando alguien falla a último momento no encontramos reemplazo y el servicio queda descubierto.",
    targetAudience:
      "Coordinadores de talento humano de clínicas, IPS y hogares geriátricos de Bogotá y Medellín.",
    dailyChange:
      "Dejaríamos de llamar uno por uno: el turno se cubre y quedan el contrato y el parte registrados.",
    comments: "Necesitamos cubrir turnos en menos de 1 hora y con contrato firmado.",
  },
  profesional: {
    serviceOffer:
      "Ofrezco cuidado domiciliario de pacientes postoperatorios y adultos mayores en Medellín.",
    painPoint:
      "Consigo turnos por grupos de WhatsApp, sin garantía de pago ni de que la oferta sea real.",
    targetAudience:
      "Enfermeras y auxiliares de 25 a 45 años que buscan turnos extra cerca de su barrio.",
    dailyChange:
      "Tendría turnos verificados y un historial que respalde mi experiencia para cobrar mejor.",
    comments:
      "Quiero que el pago llegue el mismo día del turno y poder ver la dirección antes de aceptar.",
  },
};

export function questionsFor(profile: Profile): Record<QuestionKey, QuestionCopy> {
  const ex = EXAMPLES[profile] ?? EXAMPLES.familia;
  const out = {} as Record<QuestionKey, QuestionCopy>;
  (Object.keys(BASE_QUESTIONS) as QuestionKey[]).forEach((k) => {
    out[k] = { ...BASE_QUESTIONS[k], example: ex[k] };
  });
  return out;
}

export const ALTERNATIVE_SUGGESTIONS: Record<Profile, string[]> = {
  familia: [
    "Agencias de enfermería a domicilio",
    "Grupos de WhatsApp o Facebook",
    "Recomendación de un conocido",
    "Cuidadora de confianza del barrio",
  ],
  ips_eps: [
    "Agencias de talento en salud",
    "Bolsas de empleo en línea",
    "Referidos del personal",
    "Outsourcing de enfermería",
  ],
  profesional: [
    "Grupos de WhatsApp o Facebook de turnos",
    "Agencias de empleo en salud",
    "Bolsas de empleo en línea",
    "Recomendaciones de colegas",
  ],
};

/** Sugerencia de claridad bajo cada respuesta abierta (determinista, sin IA). */
export type ClarityLevel = "idle" | "short" | "ok" | "great";
export function clarityHint(
  text: string,
  { min, good }: { min: number; good: number },
): { level: ClarityLevel; message: string } {
  const n = countWords(text);
  if (n === 0) return { level: "idle", message: "" };
  if (n < min) {
    return {
      level: "short",
      message: `Un poco más de detalle ayuda: llevas ${n} palabra${n === 1 ? "" : "s"}. Cuenta quién, dónde o cuándo.`,
    };
  }
  if (n < good)
    return { level: "ok", message: "Se entiende. Un dato concreto más lo hace aún más útil." };
  return { level: "great", message: "¡Muy claro! Con este detalle podemos ayudarte mejor." };
}

// ─── Esquema Zod (única validación) ──────────────────────────────────────────────

export interface CrossIssue {
  path: "alternatives" | "searchChannels";
  message: string;
}

/**
 * Reglas que dependen de varios campos. Viven aquí (y el esquema las repite) porque Zod omite las reglas
 * cruzadas mientras haya un campo con tipo inválido, y el formulario valida paso a paso.
 */
export function crossFieldIssues(v: {
  paysCurrently?: PayAnswer;
  alternatives: string[];
  searchChannels: string[];
  searchChannelsOther: string;
}): CrossIssue[] {
  const out: CrossIssue[] = [];
  const alts = v.alternatives.map((a) => a.trim()).filter(Boolean);
  if (v.paysCurrently === "yes" && alts.length === 0) {
    out.push({
      path: "alternatives",
      message: "Si hoy pagas por algo similar, menciona al menos una alternativa",
    });
  } else if (alts.some((a) => a.length < 2)) {
    out.push({ path: "alternatives", message: "Cada alternativa necesita al menos 2 letras" });
  }
  if (v.searchChannels.length === 0 && countWords(v.searchChannelsOther) < 1) {
    out.push({ path: "searchChannels", message: "Elige al menos un lugar o cuéntanos cuál usas" });
  }
  return out;
}

const openText = (min: number, max: number, minWords: number, minMsg: string) =>
  z
    .string()
    .trim()
    .min(min, minMsg)
    .max(max, `Máximo ${max} caracteres`)
    .refine((v) => countWords(v) >= minWords, `Usa al menos ${minWords} palabras`);

export const marketValidationSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(5, "Escribe tu nombre completo")
      .max(LIMITS.fullName)
      .refine(
        (v) => v.split(/\s+/).filter((w) => w.length >= 2).length >= 2,
        "Escribe tu nombre y tu apellido",
      ),
    profile: z.enum(PROFILES, { error: "Elige tu perfil" }),
    contact: z
      .string()
      .trim()
      .min(1, "Escribe tu WhatsApp o tu correo")
      .max(254)
      .refine(
        (v) => normalizeContact(v) !== null,
        "Escribe un celular colombiano de 10 dígitos (3001234567) o un correo válido",
      )
      .refine((v) => {
        const c = normalizeContact(v);
        return !(c?.kind === "email" && isDisposableEmail(c.value));
      }, "Usa tu correo personal: no aceptamos correos temporales"),
    city: z.string().trim().max(80),
    serviceOffer: openText(
      15,
      LIMITS.serviceOffer,
      4,
      "Cuéntalo en una frase (mínimo 15 caracteres)",
    ),
    painPoint: openText(20, LIMITS.painPoint, 5, "Cuéntanos un poco más (mínimo 20 caracteres)"),
    targetAudience: openText(
      15,
      LIMITS.targetAudience,
      3,
      "Cuéntanos un poco más (mínimo 15 caracteres)",
    ),
    dailyChange: openText(
      20,
      LIMITS.dailyChange,
      5,
      "Cuéntanos un poco más (mínimo 20 caracteres)",
    ),
    paysCurrently: z.enum(PAY_VALUES, { error: "Elige una opción" }),
    alternatives: z.array(z.string().trim().max(LIMITS.alternative, "Máximo 80 caracteres")).max(3),
    searchChannels: z.array(z.enum(CHANNEL_VALUES)).max(CHANNEL_VALUES.length),
    searchChannelsOther: z.string().trim().max(LIMITS.channelsOther),
    willingnessPct: z
      .number({ error: "Indica un porcentaje de 0 a 100" })
      .int("Usa un número entero")
      .min(0, "Mínimo 0 %")
      .max(100, "Máximo 100 %"),
    comments: z.string().trim().max(LIMITS.comments),
    consent: z.literal(true, { error: "Debes autorizar el tratamiento de tus datos" }),
    /** Campo trampa: las personas no lo ven ni lo llenan. */
    website: z.string().max(0),
    /**
     * Milisegundos que la persona tardó en llenar el formulario, medidos en su navegador con un reloj que no se
     * desajusta. El servidor descarta envíos imposiblemente rápidos (no usa horas: un reloj mal puesto no cuenta).
     */
    fillMs: z.number().int().min(0).optional(),
    source: z.string().trim().max(60).optional(),
  })
  .superRefine((v, ctx) => {
    for (const issue of crossFieldIssues(v)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });

export type MarketValidationInput = z.infer<typeof marketValidationSchema>;

/** Valores iniciales del formulario (sin respuestas inventadas: el porcentaje arranca vacío a propósito). */
export function emptyForm(): Omit<
  MarketValidationInput,
  "willingnessPct" | "profile" | "paysCurrently" | "consent"
> & {
  profile: Profile | undefined;
  paysCurrently: PayAnswer | undefined;
  willingnessPct: number | undefined;
  consent: boolean;
} {
  return {
    fullName: "",
    profile: undefined,
    contact: "",
    city: "",
    serviceOffer: "",
    painPoint: "",
    targetAudience: "",
    dailyChange: "",
    paysCurrently: undefined,
    alternatives: ["", "", ""],
    searchChannels: [],
    searchChannelsOther: "",
    willingnessPct: undefined,
    comments: "",
    consent: false,
    website: "",
  };
}

/** Respuestas limpias para guardar: sin alternativas vacías ni repetidas y con el contacto ya normalizado. */
export interface CleanSubmission {
  fullName: string;
  profile: Profile;
  contact: NormalizedContact;
  city: string | null;
  serviceOffer: string;
  painPoint: string;
  targetAudience: string;
  dailyChange: string;
  paysCurrently: PayAnswer;
  alternatives: string[];
  searchChannels: ChannelValue[];
  searchChannelsOther: string | null;
  willingnessPct: number;
  comments: string | null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cleanSubmission(v: MarketValidationInput): CleanSubmission | null {
  const contact = normalizeContact(v.contact);
  if (!contact) return null;
  const seen = new Set<string>();
  const alternatives: string[] = [];
  for (const raw of v.alternatives) {
    const a = oneLine(raw);
    const k = normalizeText(a);
    if (a.length >= 2 && !seen.has(k)) {
      seen.add(k);
      alternatives.push(a);
    }
    if (alternatives.length === 3) break;
  }
  return {
    fullName: oneLine(v.fullName),
    profile: v.profile,
    contact,
    city: oneLine(v.city) || null,
    serviceOffer: oneLine(v.serviceOffer),
    painPoint: v.painPoint.trim(),
    targetAudience: v.targetAudience.trim(),
    dailyChange: v.dailyChange.trim(),
    paysCurrently: v.paysCurrently,
    alternatives,
    searchChannels: [...new Set(v.searchChannels)],
    searchChannelsOther: oneLine(v.searchChannelsOther) || null,
    willingnessPct: v.willingnessPct,
    comments: v.comments.trim() || null,
  };
}

// ─── Calidad: sin premio por respuestas vacías, repetidas o sin sentido ─────────────

export type QualityFlag = "gibberish" | "repeated_text" | "low_effort" | "example_copy";

export interface QualityReport {
  flags: QualityFlag[];
  /** Grave: se rechaza el envío (no vale como formulario lleno). */
  severe: boolean;
  /** Campos sospechosos, para señalarlos en el formulario. */
  fields: QuestionKey[];
}

const KEYBOARD_MASH = [
  "asdf",
  "qwer",
  "zxcv",
  "sdfg",
  "dfgh",
  "fghj",
  "ghjk",
  "hjkl",
  "lkjh",
  "poiu",
  "mnbv",
  "xcvb",
  "cvbn",
  "vbnm",
  "rtyu",
  "tyui",
  "yuio",
  "uiop",
  "jkjk",
];

function badToken(t: string): boolean {
  if (t.length >= 5 && !/[aeiou]/.test(t)) return true; // en español toda palabra larga lleva vocal
  if (/(.)\1{4,}/.test(t)) return true; // «aaaaaa»
  return KEYBOARD_MASH.some((k) => t.includes(k));
}

/** Conservador a propósito: solo marca texto evidentemente sin sentido, nunca respuestas cortas legítimas. */
export function looksLikeGibberish(text: string): boolean {
  const ts = tokens(text).filter((t) => /[a-zñ]/.test(t));
  if (ts.length === 0) return text.trim().length >= 6;
  if (ts.length === 1) return ts[0].length >= 6 && badToken(ts[0]);
  const bad = ts.filter(badToken).length;
  if (bad / ts.length >= 0.6) return true;
  const counts = new Map<string, number>();
  ts.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  const top = Math.max(...counts.values());
  return ts.length >= 5 && top / ts.length >= 0.7; // «si si si si si»
}

/** Parecido entre dos textos (0 a 1) por palabras distintas. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / (A.size + B.size - inter);
}

const ALL_EXAMPLES = new Set(
  (Object.values(EXAMPLES) as Array<Record<QuestionKey, string>>).flatMap((e) =>
    Object.values(e).map(normalizeText),
  ),
);

type QualityInput = Pick<
  MarketValidationInput,
  "serviceOffer" | "painPoint" | "targetAudience" | "dailyChange" | "comments"
>;

export function assessQuality(v: QualityInput): QualityReport {
  const fields = [
    "serviceOffer",
    "painPoint",
    "targetAudience",
    "dailyChange",
    "comments",
  ] as const;
  const filled = fields.filter((k) => v[k].trim().length > 0);
  const flags = new Set<QualityFlag>();
  const suspicious = new Set<QuestionKey>();

  const gib = filled.filter((k) => looksLikeGibberish(v[k]));
  if (gib.length) {
    flags.add("gibberish");
    gib.forEach((k) => suspicious.add(k));
  }

  const repeated = new Set<QuestionKey>();
  for (let i = 0; i < filled.length; i++) {
    for (let j = i + 1; j < filled.length; j++) {
      const a = v[filled[i]];
      const b = v[filled[j]];
      if (countWords(a) >= 3 && countWords(b) >= 3 && similarity(a, b) >= 0.8) {
        repeated.add(filled[i]);
        repeated.add(filled[j]);
      }
    }
  }
  if (repeated.size) {
    flags.add("repeated_text");
    repeated.forEach((k) => suspicious.add(k));
  }

  const copies = filled.filter((k) => ALL_EXAMPLES.has(normalizeText(v[k])));
  if (copies.length) {
    flags.add("example_copy");
    copies.forEach((k) => suspicious.add(k));
  }

  const core = ["serviceOffer", "painPoint", "targetAudience", "dailyChange"] as const;
  const avgWords = core.reduce((s, k) => s + countWords(v[k]), 0) / core.length;
  if (avgWords < 4.5) flags.add("low_effort");

  const severe = gib.length >= 2 || repeated.size >= 3 || copies.length >= 2;
  return { flags: [...flags], severe, fields: [...suspicious] };
}

// ─── Respuestas copiadas entre personas (granjas de premios) ────────────────────────────

export interface AnswerTexts {
  serviceOffer: string | null | undefined;
  painPoint: string | null | undefined;
  targetAudience: string | null | undefined;
  dailyChange: string | null | undefined;
}

export const DUPLICATE_RULE = {
  /** Parecido mínimo (0–1, por palabras distintas) para considerar que dos textos son el mismo. */
  threshold: 0.8,
  /** Un texto cuenta solo si tiene al menos estas palabras (las frases cortas coinciden por casualidad). */
  minWords: 5,
  /** Cuántas de las 4 respuestas abiertas deben parecerse para llamarlo copia. */
  minFields: 3,
} as const;

/**
 * ¿Una persona copió lo que escribió otra? Exige que parezcan iguales al menos 3 de las 4 respuestas abiertas, y
 * cada una con 5 o más palabras: dos personas distintas casi nunca coinciden así sin copiar y pegar.
 */
export function isNearDuplicate(a: AnswerTexts, b: AnswerTexts): boolean {
  const keys = ["serviceOffer", "painPoint", "targetAudience", "dailyChange"] as const;
  let same = 0;
  for (const k of keys) {
    const x = a[k] ?? "";
    const y = b[k] ?? "";
    if (
      countWords(x) >= DUPLICATE_RULE.minWords &&
      countWords(y) >= DUPLICATE_RULE.minWords &&
      similarity(x, y) >= DUPLICATE_RULE.threshold
    ) {
      same++;
    }
  }
  return same >= DUPLICATE_RULE.minFields;
}

/** Nombres claros de los avisos de calidad para el panel. */
export const QUALITY_FLAG_LABEL: Record<string, string> = {
  gibberish: "Texto sin sentido",
  repeated_text: "Misma respuesta en varias preguntas",
  low_effort: "Respuestas muy cortas",
  example_copy: "Copió el ejemplo",
  duplicate_text: "Parecida a la de otra persona",
};

// ─── Señal de demanda (explicable, 0 a 100) ────────────────────────────────────────

export type SignalTier = "strong" | "medium" | "weak";
export const SIGNAL_TIER_LABEL: Record<SignalTier, string> = {
  strong: "Señal fuerte",
  medium: "Señal media",
  weak: "Señal débil",
};

export function tierFor(score: number): SignalTier {
  return score >= 70 ? "strong" : score >= 45 ? "medium" : "weak";
}

export interface SignalPart {
  key: "clarity" | "spend" | "wtp" | "market" | "evidence";
  label: string;
  points: number;
  max: number;
}

type SignalInput = {
  painPoint: string;
  targetAudience: string;
  dailyChange: string;
  paysCurrently: PayAnswer;
  alternatives: string[];
  willingnessPct: number;
  comments: string | null | undefined;
};

export function signalScore(
  v: SignalInput,
  quality?: Pick<QualityReport, "severe">,
): { score: number; tier: SignalTier; parts: SignalPart[] } {
  const clarity = Math.round(
    10 * Math.min(1, countWords(v.painPoint) / 20) +
      8 * Math.min(1, countWords(v.targetAudience) / 12) +
      7 * Math.min(1, countWords(v.dailyChange) / 15),
  );
  const spend = v.paysCurrently === "yes" ? 20 : v.paysCurrently === "no" ? 8 : 4;
  const wtp = Math.round((Math.min(100, Math.max(0, v.willingnessPct)) / 100) * 30);
  const alts = v.alternatives.filter((a) => a.trim().length >= 2).length;
  const market = alts >= 3 ? 15 : alts === 2 ? 12 : alts === 1 ? 8 : 0;
  const cw = countWords(v.comments ?? "");
  const evidence = cw >= 15 ? 10 : cw >= 6 ? 6 : cw >= 1 ? 3 : 0;
  const parts: SignalPart[] = [
    { key: "clarity", label: "Claridad del problema", points: clarity, max: 25 },
    { key: "spend", label: "Gasto actual en algo similar", points: spend, max: 20 },
    { key: "wtp", label: "Disposición a pagar", points: wtp, max: 30 },
    { key: "market", label: "Conoce las alternativas", points: market, max: 15 },
    { key: "evidence", label: "Requisitos concretos", points: evidence, max: 10 },
  ];
  let score = parts.reduce((s, p) => s + p.points, 0);
  if (quality?.severe) score = Math.min(score, 20);
  return { score, tier: tierFor(score), parts };
}

// ─── Tabulación automática para el panel de superadmin ──────────────────────────────

export interface ResponseRow {
  id: string;
  created_at: string;
  profile_type: string;
  full_name: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  service_offer: string | null;
  pain_point: string | null;
  target_customer: string | null;
  key_benefit: string | null;
  pays_currently: string | null;
  alternatives: string[] | null;
  competitors: string | null;
  search_channels: string[] | null;
  retention_channels: string | null;
  willingness_pct: number | null;
  comments: string | null;
  signal_score: number | null;
  total_score: number | null;
  quality_flags: string[] | null;
  contact_verified_at: string | null;
  verified_channel: string | null;
  promo_code: string | null;
  benefit_status: string | null;
  /** Hasta cuándo vale el código (opcional: las filas de pruebas antiguas no lo traen). */
  benefit_expires_at?: string | null;
  premium_activated: boolean | null;
  redeemed_at: string | null;
}

/** Señal de la fila: la nueva (0-100) o, en filas antiguas, el puntaje del worksheet (0-30) llevado a 100. */
export function signalOf(r: Pick<ResponseRow, "signal_score" | "total_score">): number | null {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  if (typeof r.signal_score === "number" && Number.isFinite(r.signal_score)) {
    return clamp(r.signal_score);
  }
  if (typeof r.total_score === "number" && Number.isFinite(r.total_score) && r.total_score > 0) {
    return clamp(Math.round((r.total_score / 30) * 100));
  }
  return null;
}

/** Disposición a pagar válida (0 a 100). Un dato fuera de rango (fila antigua dañada) no cuenta. */
export function wtpOf(r: Pick<ResponseRow, "willingness_pct">): number | null {
  const v = r.willingness_pct;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** Colombia no tiene horario de verano: UTC-5 todo el año (se suma a un instante UTC para ver la hora de allá). */
const BOGOTA_OFFSET_MS = -5 * 3_600_000;

export const avg = (xs: number[]): number =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const CANON: Array<[RegExp, string]> = [
  [/whats\s?app|wasap|guasap/, "Grupos de WhatsApp"],
  [/facebook|\bface\b|\bfb\b/, "Grupos de Facebook"],
  [/instagram|tiktok|redes/, "Redes sociales"],
  [/computrabajo|elempleo|linkedin|indeed|magneto|bolsa/, "Bolsas de empleo en línea"],
  [/agencia|empresa de enfermeria|empresas de enfermeria/, "Agencias de empleo o de enfermería"],
  [
    /recomend|referid|conocid|voz a voz|boca a boca|amig|familiar|colega/,
    "Recomendaciones de conocidos",
  ],
  [/google|internet|director|pagina|web|buscador/, "Directorios y búsqueda web"],
  [/outsourcing|tercer|contratista/, "Outsourcing / terceros"],
  [/hospital|clinica|ips\b|eps\b/, "Contactos de hospitales o clínicas"],
];

export function canonicalName(raw: string): string {
  const t = normalizeText(raw);
  if (!t) return "";
  for (const [re, name] of CANON) if (re.test(t)) return name;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Filas antiguas guardaban las alternativas en un solo texto («1) …  2) …»). */
export function splitLegacyAlternatives(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n|;|\s\d\)\s|^\d\)\s|\s\d\.\s/)
    .map((s) =>
      s
        .replace(/^\s*\d[).]\s*/, "")
        .replace(/\s[—-]\s.*$/, "")
        .trim(),
    )
    .filter((s) => s.length >= 2)
    .slice(0, 3);
}

export function alternativesOf(r: ResponseRow): string[] {
  if (r.alternatives && r.alternatives.length) return r.alternatives;
  return splitLegacyAlternatives(r.competitors);
}

export function channelsOf(r: ResponseRow): string[] {
  const chips = (r.search_channels ?? []).map((c) =>
    c in CHANNEL_LABEL ? CHANNEL_LABEL[c as ChannelValue] : canonicalName(c),
  );
  const free = (r.retention_channels ?? "")
    .split(/[,;\n]/)
    .map((s) => canonicalName(s))
    .filter(Boolean);
  return [...new Set([...chips, ...free])];
}

const STOPWORDS = new Set(
  (
    "para como pero porque cuando donde desde hasta entre sobre tambien muy mas menos todo toda todos todas cada " +
    "esta este estos estas esto eso esos esas aqui alli algo alguien nada nadie otro otra otros otras mismo misma " +
    "tiene tengo tener tienen hacer hace hacen hago puedo puede pueden poder seria sera son soy estoy esta estan " +
    "fue ser ver vez veces cosa cosas solo sola siempre nunca ahora luego despues antes mientras aunque tanto " +
    "quiero quieren quisiera necesito necesita necesitan busco buscamos buscar humanix plataforma servicio " +
    "servicios persona personas gente casa dia dias"
  ).split(" "),
);

export interface CountedItem {
  name: string;
  count: number;
  pct: number;
}

function topCounts(map: Map<string, number>, total: number, limit: number): CountedItem[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, pct: pct(count, total) }));
}

export interface ProfileStats {
  profile: Profile;
  label: string;
  count: number;
  pct: number;
  verified: number;
  avgSignal: number;
  avgWtp: number;
  medianWtp: number;
  pays: Record<PayAnswer | "unknown", number>;
  payingPct: number;
}

export interface Tabulation {
  total: number;
  verified: number;
  verifiedPct: number;
  withBenefit: number;
  redeemed: number;
  avgSignal: number;
  avgWtp: number;
  medianWtp: number;
  payingPct: number;
  pays: Record<PayAnswer | "unknown", number>;
  byProfile: ProfileStats[];
  wtpBuckets: Array<{ label: string; from: number; to: number; count: number; pct: number }>;
  topAlternatives: CountedItem[];
  topChannels: CountedItem[];
  keywords: CountedItem[];
  byCity: CountedItem[];
  daily: Array<{ day: string; count: number }>;
  tiers: Record<SignalTier, number>;
}

const WTP_BUCKETS = [
  { label: "0 a 10 %", from: 0, to: 10 },
  { label: "11 a 25 %", from: 11, to: 25 },
  { label: "26 a 50 %", from: 26, to: 50 },
  { label: "51 a 75 %", from: 51, to: 75 },
  { label: "76 a 100 %", from: 76, to: 100 },
];

function emptyPays(): Record<PayAnswer | "unknown", number> {
  return { yes: 0, no: 0, not_researched: 0, unknown: 0 };
}

export function payOf(r: ResponseRow): PayAnswer | "unknown" {
  return (PAY_VALUES as readonly string[]).includes(r.pays_currently ?? "")
    ? (r.pays_currently as PayAnswer)
    : "unknown";
}

function profileStats(rows: ResponseRow[], profile: Profile, grandTotal: number): ProfileStats {
  const subset = rows.filter((r) => r.profile_type === profile);
  const signals = subset.map(signalOf).filter((x): x is number => x !== null);
  const wtps = subset.map(wtpOf).filter((x): x is number => x !== null);
  const pays = emptyPays();
  subset.forEach((r) => (pays[payOf(r)] += 1));
  const answered = pays.yes + pays.no + pays.not_researched;
  return {
    profile,
    label: PROFILE_META[profile].label,
    count: subset.length,
    pct: pct(subset.length, grandTotal),
    verified: subset.filter((r) => r.contact_verified_at).length,
    avgSignal: round1(avg(signals)),
    avgWtp: Math.round(avg(wtps)),
    medianWtp: Math.round(median(wtps)),
    pays,
    payingPct: pct(pays.yes, answered),
  };
}

export function tabulate(rows: ResponseRow[], now: number = Date.now()): Tabulation {
  const total = rows.length;
  const signals = rows.map(signalOf).filter((x): x is number => x !== null);
  const wtps = rows.map(wtpOf).filter((x): x is number => x !== null);
  const pays = emptyPays();
  rows.forEach((r) => (pays[payOf(r)] += 1));
  const answered = pays.yes + pays.no + pays.not_researched;

  const alt = new Map<string, number>();
  const chan = new Map<string, number>();
  const city = new Map<string, number>();
  const words = new Map<string, number>();
  const display = new Map<string, Map<string, number>>();

  rows.forEach((r) => {
    new Set(alternativesOf(r).map(canonicalName).filter(Boolean)).forEach((n) =>
      alt.set(n, (alt.get(n) ?? 0) + 1),
    );
    channelsOf(r).forEach((n) => chan.set(n, (chan.get(n) ?? 0) + 1));
    const c = (r.city ?? "").trim();
    if (c) city.set(c, (city.get(c) ?? 0) + 1);

    const text = [r.pain_point, r.key_benefit, r.comments, r.service_offer]
      .filter(Boolean)
      .join(" ");
    const seen = new Set<string>();
    (text.match(/[\p{L}]{4,}/gu) ?? []).forEach((w) => {
      const n = normalizeText(w);
      if (n.length < 4 || STOPWORDS.has(n) || seen.has(n)) return;
      seen.add(n);
      words.set(n, (words.get(n) ?? 0) + 1);
      const forms = display.get(n) ?? new Map<string, number>();
      const lower = w.toLowerCase();
      forms.set(lower, (forms.get(lower) ?? 0) + 1);
      display.set(n, forms);
    });
  });

  const keywords = topCounts(words, total, 15)
    .filter((k) => k.count >= 1)
    .map((k) => {
      const forms = display.get(k.name);
      const best = forms ? [...forms.entries()].sort((a, b) => b[1] - a[1])[0][0] : k.name;
      return { ...k, name: best };
    });

  // Días de Colombia (UTC-5, sin horario de verano): el último es «hoy» allá, aunque en UTC ya sea mañana.
  const dayMs = 86_400_000;
  const start = new Date(now + BOGOTA_OFFSET_MS);
  start.setUTCHours(0, 0, 0, 0);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(start.getTime() - (13 - i) * dayMs);
    return { day: d.toISOString().slice(0, 10), count: 0 };
  });
  const idx = new Map(daily.map((d, i) => [d.day, i]));
  rows.forEach((r) => {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) return; // una fecha dañada no debe tumbar el panel
    const i = idx.get(new Date(t + BOGOTA_OFFSET_MS).toISOString().slice(0, 10));
    if (i !== undefined) daily[i].count += 1;
  });

  const tiers: Record<SignalTier, number> = { strong: 0, medium: 0, weak: 0 };
  signals.forEach((s) => (tiers[tierFor(s)] += 1));

  return {
    total,
    verified: rows.filter((r) => r.contact_verified_at).length,
    verifiedPct: pct(rows.filter((r) => r.contact_verified_at).length, total),
    withBenefit: rows.filter((r) => r.promo_code && r.benefit_status && r.benefit_status !== "none")
      .length,
    redeemed: rows.filter((r) => r.premium_activated || r.redeemed_at).length,
    avgSignal: round1(avg(signals)),
    avgWtp: Math.round(avg(wtps)),
    medianWtp: Math.round(median(wtps)),
    payingPct: pct(pays.yes, answered),
    pays,
    byProfile: PROFILES.map((p) => profileStats(rows, p, total)),
    wtpBuckets: WTP_BUCKETS.map((b) => {
      const count = wtps.filter((w) => w >= b.from && w <= b.to).length;
      return { ...b, count, pct: pct(count, wtps.length) };
    }),
    topAlternatives: topCounts(alt, total, 10),
    topChannels: topCounts(chan, total, 10),
    keywords,
    byCity: topCounts(city, total, 8),
    daily,
    tiers,
  };
}

// ─── Filtros y exportación ───────────────────────────────────────────────────────────

export interface RowFilter {
  profile?: Profile | "all";
  verified?: "all" | "yes" | "no";
  tier?: SignalTier | "all";
  q?: string;
}

export function filterRows(rows: ResponseRow[], f: RowFilter): ResponseRow[] {
  const q = normalizeText(f.q ?? "");
  return rows.filter((r) => {
    if (f.profile && f.profile !== "all" && r.profile_type !== f.profile) return false;
    if (f.verified === "yes" && !r.contact_verified_at) return false;
    if (f.verified === "no" && r.contact_verified_at) return false;
    if (f.tier && f.tier !== "all") {
      const s = signalOf(r);
      if (s === null || tierFor(s) !== f.tier) return false;
    }
    if (q) {
      const hay = normalizeText(
        [
          r.full_name,
          r.email,
          r.whatsapp,
          r.city,
          r.service_offer,
          r.pain_point,
          r.target_customer,
          r.key_benefit,
          r.comments,
        ]
          .filter(Boolean)
          .join(" "),
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const BENEFIT_ES: Record<string, string> = {
  none: "Sin verificar",
  available: "Disponible",
  duplicate_contact: "Contacto repetido",
  redeemed: "Canjeado",
  expired: "Vencido",
};

export const RESPONSE_COLUMNS: Array<CsvColumn<ResponseRow>> = [
  { header: "Fecha", value: (r) => bogotaDateTime(r.created_at) },
  {
    header: "Perfil",
    value: (r) => PROFILE_META[r.profile_type as Profile]?.label ?? r.profile_type,
  },
  { header: "Nombre", value: (r) => r.full_name },
  { header: "WhatsApp", value: (r) => r.whatsapp },
  { header: "Correo", value: (r) => r.email },
  { header: "Ciudad", value: (r) => r.city },
  { header: "Contacto verificado", value: (r) => (r.contact_verified_at ? "Sí" : "No") },
  {
    header: "¿Paga hoy por algo similar?",
    value: (r) => (payOf(r) === "unknown" ? "" : PAY_LABEL[payOf(r) as PayAnswer]),
  },
  { header: "Alternativas", value: (r) => alternativesOf(r).join(" | ") },
  { header: "Dónde busca", value: (r) => channelsOf(r).join(" | ") },
  { header: "Disposición a pagar %", value: (r) => r.willingness_pct },
  { header: "Señal de demanda", value: (r) => signalOf(r) },
  { header: "Qué busca u ofrece", value: (r) => r.service_offer },
  { header: "Problema", value: (r) => r.pain_point },
  { header: "Público objetivo", value: (r) => r.target_customer },
  { header: "Qué cambia en su día a día", value: (r) => r.key_benefit },
  { header: "Comentarios", value: (r) => r.comments },
  { header: "Beneficio", value: (r) => BENEFIT_ES[r.benefit_status ?? "none"] ?? r.benefit_status },
];

export function responsesToCsv(rows: ResponseRow[]): string {
  return toCsv(rows, RESPONSE_COLUMNS);
}

export function responsesFilename(now: Date | number | string = Date.now()): string {
  const t = new Date(now).getTime();
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + BOGOTA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return `validacion-de-mercado-${d}.csv`;
}

// ─── Utilidades de la interfaz ───────────────────────────────────────────────────────

/** Frase corta que explica el porcentaje que eligió la persona. */
export function wtpSentence(pct: number | undefined | null): string {
  if (pct === undefined || pct === null || Number.isNaN(pct))
    return "Elige un porcentaje de 0 a 100.";
  if (pct === 0) return "Nadie de tu entorno pagaría por esto.";
  if (pct === 100) return "Todas las personas con las que lo hablaste pagarían.";
  const ten = Math.round(pct / 10);
  return `Más o menos ${ten} de cada 10 personas pagarían por esto.`;
}

export const DRAFT_KEY = "hx_market_validation_draft_v1";

/** Mensajes de error del canje, en español claro. */
export const REDEEM_ERRORS: Record<string, string> = {
  invalid_code: "Ese código no existe. Revisa que esté completo (MLP-XXXXX-XXXXX).",
  not_verified: "Ese código aún no está verificado: confirma tu contacto en el formulario.",
  already_redeemed: "Ese código ya fue canjeado.",
  expired: "Ese código venció. Puedes llenar el formulario de nuevo.",
  user_already_rewarded: "Tu cuenta ya recibió este beneficio una vez.",
  plan_active: "Ya tienes un plan activo. Guarda tu código y canjéalo cuando tu plan termine.",
  unauthenticated: "Inicia sesión para canjear tu código.",
  rate_limited: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
  server: "No pudimos canjear el código ahora. Inténtalo de nuevo en un momento.",
};
