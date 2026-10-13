// Moderación de ofertas: «sin groserías, sin artículos, solo salud y cuidado».
//
// Espejo de `public.hx_text_norm` / `public.hx_offer_text_issue` / `public.hx_offer_guard` (migración
// 20261012180000_offer_moderation.sql). La base es la que decide (un disparador en cada tabla de texto público); esto da el aviso al
// instante, sin viajar al servidor. Si cambias una lista, cambia la otra: `contentModeration.test.ts` compara ambas.
//
// Es un filtro de primera línea (palabras y frases), no un clasificador: no lee variaciones muy disfrazadas. Para eso siguen la
// revisión humana (`moderate_offer`) y los reportes.

import { checkOutgoingMessage } from "./opportunities";

export type OfferIssue = "rude" | "sale" | "offtopic" | "contact";

/** Lo que dice la base (mismo texto que `hx_offer_guard`) y lo que mostramos al instante. */
export const OFFER_ISSUE_MESSAGE: Record<OfferIssue, string> = {
  rude: "Tu texto tiene lenguaje ofensivo. Escríbelo con respeto.",
  sale: "En Humanix solo se publican ofertas de salud y cuidado: no se venden, compran ni arriendan artículos.",
  offtopic:
    "Tu oferta no parece de salud o cuidado. Cuéntanos qué cuidado necesitas (por ejemplo: enfermería, acompañamiento, curaciones, terapias).",
  contact:
    "No incluyas teléfonos, correos, enlaces ni direcciones en el texto: el contacto se desbloquea según tu plan y los pagos se hacen solo en la página web.",
};

// ─── Listas (sobre el texto ya normalizado) ──────────────────────────────────

/** Palabras y frases completas ofensivas o sexuales. */
export const RUDE_TERMS =
  "puta|putas|puto|putos|hdp|gonorrea|gonorreas|mierda|mierdas|carajo|verga|pirobo|pirobos|piroba|cabron|cabrona|cabrones|chingar|chingada|chingado|joder|jodete|pendejo|pendeja|pendejos|pendejas|imbecil|imbeciles|estupido|estupida|estupidos|idiota|idiotas|zorra|zorras|maldito|maldita|malditos|desgraciado|desgraciada|bastardo|bastarda|lambon|mamagallo|maricon|maricones|escort|prepago|prepagos|porno|pornografia|onlyfans|erotico|erotica|eroticos|eroticas|sexuales|desnudo|desnuda|desnudos".split(
    "|",
  );
/** Inicios de palabra ofensivos (cubren sus variantes). */
export const RUDE_STEMS = "hijueput|hijoput|hijoeput|mamaverg|malparid".split("|");
/** Venta, compra, alquiler o rifa de artículos (y esquemas de dinero fácil). */
export const SALE_TERMS =
  "vendo|vendemos|se vende|se venden|en venta|a la venta|venta de|ventas de|remato|rematamos|en remate|compro|compramos|se compra|se compran|permuto|distribuidor|distribuidora|mayorista|catalogo|mercancia|envio gratis|2x1|oferta imperdible|ofertas imperdibles|precio de fabrica|se arrienda|se arriendan|se alquila|se alquilan|arriendo|alquilo|alquiler de|dropshipping|multinivel|red de mercadeo|herbalife|tupperware|forex|bitcoin|criptomonedas|apuestas|rifa|casino|dinero facil|gana dinero".split(
    "|",
  );
/** «vendo … artículos», «compramos productos», «distribuimos mercancía»: un verbo de venta cerca de la cosa vendida. */
export const SALE_CONTEXT =
  "(vend|compr|ofrezc|remat|venta|distribu|fabric)\\w*( \\w+){0,4} (articulo|articulos|producto|productos|mercancia)";
/** Inicios de palabra de salud y cuidado. */
export const CARE_STEMS =
  "enferm|cuid|medic|terap|fisio|kinesi|geriatr|paliativ|ancian|paciente|salud|clinic|hospital|urgenc|ventilad|sonda|curacion|inyect|glucos|glucomet|oxigen|tension|postoperat|rehabilit|psicolog|psiquiatr|nutric|pediatr|neonat|maternid|lactanc|fonoaudiolog|ocupacional|respirator|alzheimer|demenc|discapacit|parkinson|diabet|hipertens|acompan|movilizac|higiene|banar|dialisis|quimioterap|oncolog|cardiolog|neurolog|domiciliari|dependiente|postrad|ulcera|escara|cirug|herida|odontolog|panal|nebuliz|insulina".split(
    "|",
  );
/** Palabras y frases completas de salud y cuidado. */
export const CARE_TERMS =
  "ips|eps|uci|ucin|epoc|acv|ecg|ekg|cpap|bipap|signos vitales|adulto mayor|adultos mayores|persona mayor|personas mayores|tercera edad|recien nacido|cama hospitalaria|silla de ruedas|trabajo social|presion arterial".split(
    "|",
  );

// ─── Normalización y comprobación ────────────────────────────────────────────

const ACCENTED = "áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ";
const PLAIN = "aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN";
const ACCENT_MAP = new Map([...ACCENTED].map((ch, i) => [ch, PLAIN[i]]));

/** Espejo de `hx_text_norm`: sin tildes ni ñ, minúsculas, letras repetidas (3+) reducidas a una y signos fuera. */
export function normalizeForModeration(text: string | null | undefined): string {
  const plain = [...String(text ?? "")].map((ch) => ACCENT_MAP.get(ch) ?? ch).join("");
  return plain
    .toLowerCase()
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const rudeTerms = new RegExp(`\\b(${RUDE_TERMS.join("|")})\\b`);
const rudeStems = new RegExp(`\\b(${RUDE_STEMS.join("|")})`);
const saleTerms = new RegExp(`\\b(${SALE_TERMS.join("|")})\\b`);
const saleContext = new RegExp(`\\b${SALE_CONTEXT}\\b`);
const careStems = new RegExp(`\\b(${CARE_STEMS.join("|")})`);
const careTerms = new RegExp(`\\b(${CARE_TERMS.join("|")})\\b`);

/** Espejo de `hx_offer_text_issue`: null si el texto está bien, o el motivo. */
export function offerTextIssue(
  text: string | null | undefined,
  opts: { requireCare?: boolean } = {},
): Exclude<OfferIssue, "contact"> | null {
  const t = normalizeForModeration(text);
  if (!t) return null;
  if (rudeTerms.test(t) || rudeStems.test(t)) return "rude";
  if (saleTerms.test(t) || saleContext.test(t)) return "sale";
  if (opts.requireCare && !(careStems.test(t) || careTerms.test(t))) return "offtopic";
  return null;
}

export type OfferCheck = { ok: true } | { ok: false; issue: OfferIssue; message: string };

/**
 * Revisa los textos de una oferta como lo hace el disparador de la base: todos juntos (la regla «es de salud o cuidado» mira el
 * conjunto) y, si se pide, también teléfonos, correos, enlaces, direcciones y datos de pago.
 */
export function checkOfferText(
  fields: Array<string | null | undefined>,
  opts: { requireCare?: boolean; checkContact?: boolean } = {},
): OfferCheck {
  const all = fields.map((f) => f ?? "").join(" ");
  let issue: OfferIssue | null = offerTextIssue(all, { requireCare: opts.requireCare });
  if (!issue && opts.checkContact) {
    const c = checkOutgoingMessage(all, { maxChars: 100_000 });
    if (!c.ok && (c.reason === "contact_info" || c.reason === "payment_instruction")) {
      issue = "contact";
    }
  }
  return issue ? { ok: false, issue, message: OFFER_ISSUE_MESSAGE[issue] } : { ok: true };
}

/** El motivo que reporta la base en la pista del error (`offer_rude`, `offer_sale`, `offer_offtopic`, `offer_contact`). */
export function offerIssueFromError(
  err: { hint?: string | null; message?: string | null } | null | undefined,
): OfferIssue | null {
  const hint = (err?.hint ?? "").toLowerCase();
  const m = /^offer_(rude|sale|offtopic|contact)$/.exec(hint);
  if (m) return m[1] as OfferIssue;
  const msg = err?.message ?? "";
  for (const k of Object.keys(OFFER_ISSUE_MESSAGE) as OfferIssue[]) {
    if (msg === OFFER_ISSUE_MESSAGE[k]) return k;
  }
  return null;
}
