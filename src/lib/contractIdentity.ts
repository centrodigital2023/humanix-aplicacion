// Validación de identidad y segundo factor para firmar el contrato inteligente.
//
// La identidad se valida con lo que ya verifica Humanix: RETHUS del profesional; NIT, representante legal
// y verificación del equipo para la institución (`contract_signer_readiness`, SQL). El segundo factor es un
// código de un solo uso enviado al correo de la propia cuenta: Supabase Auth lo emite, lo valida y deja la
// huella en el token (`amr`: método `otp` + marca de tiempo). El servidor exige que esa huella sea RECIENTE
// antes de registrar la firma, así que nadie puede firmar solo con una sesión que quedó abierta.

import type { ContractParty } from "./contractTemplate";

// ─── Identidad ───────────────────────────────────────────────────────────────

export interface ReadinessCheck {
  id: string;
  ok: boolean;
}

export interface SignerReadiness {
  party: ContractParty;
  ready: boolean;
  checks: ReadinessCheck[];
  missing: string[];
}

export interface ReadinessItem {
  id: string;
  ok: boolean;
  label: string;
  /** Qué hacer para resolverlo (null si no depende de la persona). */
  fix: string | null;
  href: string | null;
}

const COPY: Record<string, { label: string; fix: string | null; href: string | null }> = {
  contract_open: { label: "El contrato admite firmas", fix: null, href: null },
  not_signed_yet: { label: "Aún no has firmado", fix: null, href: null },
  full_name: {
    label: "Nombre completo en tu perfil",
    fix: "Completa tu nombre completo en el perfil.",
    href: "/dashboard",
  },
  rethus: {
    label: "Inscripción RETHUS verificada",
    fix: "Completa la verificación RETHUS en tu perfil para poder firmar.",
    href: "/dashboard/profesional",
  },
  not_blocked: {
    label: "Cuenta sin bloqueos",
    fix: "Tu cuenta está en revisión: contacta a soporte.",
    href: "/contacto",
  },
  institution_verified: {
    label: "Institución verificada por Humanix",
    fix: "El equipo de Humanix debe aprobar tus documentos. Súbelos o revisa su estado en el perfil.",
    href: "/dashboard/institucion",
  },
  nit: {
    label: "NIT registrado",
    fix: "Registra el NIT de la institución en el perfil.",
    href: "/dashboard/institucion/onboarding",
  },
  legal_representative: {
    label: "Representante legal registrado",
    fix: "Registra el nombre del representante legal en el perfil.",
    href: "/dashboard/institucion/onboarding",
  },
};

export function parseReadiness(value: unknown): SignerReadiness | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const party = v.party === "institution" || v.party === "professional" ? v.party : null;
  if (!party || !Array.isArray(v.checks)) return null;
  const checks: ReadinessCheck[] = v.checks.flatMap((c) =>
    typeof c === "object" && c !== null && typeof (c as ReadinessCheck).id === "string"
      ? [{ id: (c as ReadinessCheck).id, ok: (c as ReadinessCheck).ok === true }]
      : [],
  );
  return {
    party,
    ready: v.ready === true,
    checks,
    missing: checks.filter((c) => !c.ok).map((c) => c.id),
  };
}

export function describeReadiness(r: SignerReadiness): ReadinessItem[] {
  return r.checks.map((c) => {
    const copy = COPY[c.id] ?? { label: c.id, fix: null, href: null };
    return {
      id: c.id,
      ok: c.ok,
      label: copy.label,
      fix: c.ok ? null : copy.fix,
      href: c.ok ? null : copy.href,
    };
  });
}

/** Lo que la persona puede resolver por su cuenta (excluye el estado del contrato). */
export function fixableItems(r: SignerReadiness): ReadinessItem[] {
  return describeReadiness(r).filter(
    (i) => !i.ok && i.id !== "contract_open" && i.id !== "not_signed_yet",
  );
}

// ─── Segundo factor ──────────────────────────────────────────────────────────

export interface JwtClaimsLike {
  sub?: string;
  email?: string;
  amr?: unknown;
}

export interface StepUp {
  method: "email_otp";
  /** Momento en que la persona confirmó el código (ISO). */
  authenticated_at: string;
  /** Método tal como lo reporta Supabase Auth. */
  amr_method: string;
}

/** Métodos de Supabase Auth que prueban control del correo en este momento. */
export const STEP_UP_AMR_METHODS: readonly string[] = ["otp", "magiclink"];
/** Antigüedad máxima del código confirmado para poder firmar. */
export const STEP_UP_MAX_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 120;

/**
 * Lee del token la confirmación de código más reciente y la acepta solo si es fresca. Devuelve null si
 * el token no trae `amr`, si solo hay contraseña / sesión antigua, o si el código es viejo.
 */
export function stepUpFromClaims(
  claims: JwtClaimsLike | null | undefined,
  now = Date.now(),
  maxAgeSeconds = STEP_UP_MAX_AGE_SECONDS,
): StepUp | null {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return null;
  const nowSec = Math.floor(now / 1000);
  let best: { method: string; ts: number } | null = null;
  for (const entry of amr) {
    if (typeof entry !== "object" || entry === null) continue;
    const method = (entry as { method?: unknown }).method;
    const ts = (entry as { timestamp?: unknown }).timestamp;
    if (typeof method !== "string" || !STEP_UP_AMR_METHODS.includes(method)) continue;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (ts > nowSec + CLOCK_SKEW_SECONDS || nowSec - ts > maxAgeSeconds) continue;
    if (!best || ts > best.ts) best = { method, ts };
  }
  return best
    ? {
        method: "email_otp",
        authenticated_at: new Date(best.ts * 1000).toISOString(),
        amr_method: best.method,
      }
    : null;
}

export function stepUpSecondsLeft(step: StepUp | null, now = Date.now()): number {
  if (!step) return 0;
  const left =
    STEP_UP_MAX_AGE_SECONDS - Math.floor((now - new Date(step.authenticated_at).getTime()) / 1000);
  return Math.max(0, left);
}

/** «ma***@gmail.com»: se muestra a dónde se envió el código sin exponer el correo completo. */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  const at = value.indexOf("@");
  if (at < 1) return "tu correo";
  const user = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${user.slice(0, Math.min(2, user.length))}***@${domain}`;
}

const OTP_RE = /^\d{6,8}$/;

/** El código que envía Supabase Auth tiene entre 6 y 8 dígitos (según la configuración del proyecto). */
export function normalizeOtp(input: string): string | null {
  const digits = input.replace(/\s+/g, "");
  return OTP_RE.test(digits) ? digits : null;
}

const METHOD_LABEL: Record<string, string> = {
  "rethus_verified+email_otp": "RETHUS verificado + código por correo",
  "institution_verified+email_otp": "Institución verificada (NIT) + código por correo",
};

export function identityMethodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/**
 * Lee las declaraciones (claims) de un token de acceso SIN verificar la firma: sirve solo para mostrar en
 * pantalla si el código de verificación sigue vigente. Quien decide es el servidor, que sí lo verifica.
 */
export function decodeJwtClaims(token: string | null | undefined): JwtClaimsLike | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JwtClaimsLike)
      : null;
  } catch {
    return null;
  }
}
