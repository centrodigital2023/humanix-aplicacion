// Barrera de salida: ningún mensaje automático (WhatsApp) puede contener enlaces
// o instrucciones de pago. Los pagos ocurren solo en la página web.
// Módulo puro (sin APIs de Deno) para poder probarlo con Vitest.

const PAYMENT_PATTERNS: RegExp[] = [
  /mercado\s?pago/i,
  /mpago\.la/i,
  /init_point/i,
  /checkout_url/i,
  /payment_link/i,
  /preference_id/i,
  /(enlace|link|liga)\s+de\s+pago/i,
  /transfiere|transferencia|consigna/i,
  /n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente/i,
  /(nequi|daviplata)\s*[:=]?\s*\d{7,}/i,
  /llave\s+bre-?b/i,
  /paga\s+(aqu[ií]|por\s+whatsapp)/i,
];

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;

export function containsPaymentInstruction(text: string): boolean {
  return PAYMENT_PATTERNS.some((re) => re.test(text));
}

export function hasDisallowedUrl(text: string, allowedHosts: string[]): boolean {
  const urls = text.match(URL_RE) ?? [];
  return urls.some((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return !allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return true;
    }
  });
}

export type GuardResult = {
  text: string;
  blocked: boolean;
  reason?: "payment_instruction" | "disallowed_url";
};

export function guardOutgoing(
  text: string,
  safeReply: string,
  allowedHosts: string[],
): GuardResult {
  if (containsPaymentInstruction(text))
    return { text: safeReply, blocked: true, reason: "payment_instruction" };
  if (hasDisallowedUrl(text, allowedHosts))
    return { text: safeReply, blocked: true, reason: "disallowed_url" };
  return { text, blocked: false };
}

export function buildPlanInquiryMessage(plan?: string): string {
  const safePlan = (plan ?? "planes de Humanix").replace(/[^\p{L}\p{N}\s.,-]/gu, "").slice(0, 60);
  return [
    "Hola, quiero consultar información sobre los planes de Humanix.",
    `Interés: ${safePlan}`,
    "Esta es una consulta informativa. No deseo realizar un pago todavía.",
  ].join("\n");
}
