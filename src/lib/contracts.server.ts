// Lógica de servidor del contrato inteligente: firma con segundo factor reciente.
//
// Vive aparte de `contracts.functions.ts` por dos razones: no viaja al navegador y se puede probar con
// Vitest inyectando el cliente de base de datos y los encabezados de la petición.
//
// Qué verifica ANTES de llamar a `record_contract_signature` (que solo puede ejecutar el service role):
//   1. sesión autenticada (la aplica el middleware) y que la persona sea parte del contrato;
//   2. segundo factor RECIENTE en el token (código de un solo uso confirmado hace ≤ 10 min);
//   3. que el hash de los términos coincida con el vigente (nadie firma una versión vieja);
//   4. que el texto que vio la persona sea el que produce la plantilla para esos términos (bodyHash);
//   5. que haya aceptado de forma explícita todas las declaraciones requeridas.
// La base de datos vuelve a validar estado, plazo, identidad (RETHUS / NIT) y dobles firmas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  contractBodyHash,
  isSupportedTemplate,
  missingAcceptances,
  parseContractTerms,
} from "./contractTemplate";
import { stepUpFromClaims, type JwtClaimsLike } from "./contractIdentity";

export type Db = SupabaseClient;

export interface ContractDeps {
  admin: Db;
  /** Lee un encabezado de la petición actual (minúsculas). */
  header: (name: string) => string | undefined;
  /** Sal para el hash de la IP (nunca se guarda la IP en claro). */
  salt: string | undefined;
  now?: () => number;
}

export type SignErrorCode =
  | "invalid_input"
  | "not_found"
  | "step_up_required"
  | "terms_changed"
  | "body_mismatch"
  | "clauses_required"
  | "identity_not_verified"
  | "contract_closed"
  | "contract_expired"
  | "already_signed"
  | "unsupported_template"
  | "failed";

export type SignResult =
  | {
      ok: true;
      status: "partially_signed" | "active";
      fullySigned: boolean;
      party: "institution" | "professional";
      signedAt: string;
      signatureHash: string;
    }
  | { ok: false; code: SignErrorCode; message: string; missing?: string[] };

const input = z.object({
  contractId: z.string().uuid(),
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
  accepted: z.array(z.string().max(40)).max(20),
});

const MESSAGES: Record<SignErrorCode, string> = {
  invalid_input: "Los datos de la firma no son válidos. Recarga la página e inténtalo de nuevo.",
  not_found: "No encontramos ese contrato.",
  step_up_required: "Confirma el código que enviamos a tu correo para poder firmar.",
  terms_changed: "El contrato cambió desde que lo abriste. Vuelve a revisarlo antes de firmar.",
  body_mismatch:
    "El texto que viste no coincide con el contrato vigente. Recarga y vuelve a revisarlo.",
  clauses_required: "Debes aceptar de forma explícita todas las declaraciones.",
  identity_not_verified:
    "Tu identidad aún no está validada: completa las verificaciones pendientes.",
  contract_closed: "Este contrato ya no admite firmas.",
  contract_expired: "El plazo para firmar venció.",
  already_signed: "Ya firmaste este contrato.",
  unsupported_template: "Este contrato usa una plantilla que esta versión no puede mostrar.",
  failed: "No se pudo registrar la firma. Inténtalo de nuevo en unos minutos.",
};

function fail(
  code: SignErrorCode,
  extra: { message?: string; missing?: string[] } = {},
): SignResult {
  return { ok: false, code, message: extra.message ?? MESSAGES[code], missing: extra.missing };
}

/** HMAC-SHA256 hexadecimal (truncado): permite comparar IPs sin guardarlas. */
async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

export function clientIp(header: ContractDeps["header"]): string {
  return (
    (header("cf-connecting-ip") ?? "").trim() ||
    (header("x-forwarded-for") ?? "").split(",")[0].trim() ||
    (header("x-real-ip") ?? "").trim() ||
    "unknown"
  );
}

/** Traduce el error de la base de datos (por la pista `HINT`) a un código estable. */
export function mapSignatureError(err: {
  message?: string | null;
  hint?: string | null;
  code?: string | null;
}): { code: SignErrorCode; message: string; missing?: string[] } {
  const hint = err.hint ?? "";
  const raw = err.message ?? "";
  if (hint === "terms_changed") return { code: "terms_changed", message: MESSAGES.terms_changed };
  if (hint === "clauses_required")
    return { code: "clauses_required", message: MESSAGES.clauses_required };
  if (hint === "step_up_required")
    return { code: "step_up_required", message: MESSAGES.step_up_required };
  if (hint === "contract_closed")
    return { code: "contract_closed", message: MESSAGES.contract_closed };
  if (hint === "contract_expired")
    return { code: "contract_expired", message: MESSAGES.contract_expired };
  if (hint === "identity_not_verified") {
    const missing = Array.from(raw.matchAll(/"([a-z_]+)"/g), (m) => m[1]);
    return { code: "identity_not_verified", message: MESSAGES.identity_not_verified, missing };
  }
  if (err.code === "23505") return { code: "already_signed", message: MESSAGES.already_signed };
  if (/No participas/i.test(raw)) return { code: "not_found", message: MESSAGES.not_found };
  return { code: "failed", message: MESSAGES.failed };
}

export async function handleSign(
  raw: unknown,
  ctx: { userId: string; claims: JwtClaimsLike },
  deps: ContractDeps,
): Promise<SignResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return fail("invalid_input");
  const { contractId, termsHash, bodyHash, accepted } = parsed.data;
  const now = deps.now?.() ?? Date.now();

  // 2. Segundo factor reciente (primero: es lo más barato y no revela nada del contrato).
  const stepUp = stepUpFromClaims(ctx.claims, now);
  if (!stepUp) return fail("step_up_required");

  // 1. Pertenencia al contrato. Mismo mensaje para «no existe» y «no eres parte»: no se enumera.
  const { data: row, error: readError } = await deps.admin
    .from("smart_contracts")
    .select("id, terms, terms_hash, template_version, institution_user_id, professional_id")
    .eq("id", contractId)
    .maybeSingle();
  if (readError) return fail("failed");
  const contract = row as {
    terms: unknown;
    terms_hash: string;
    template_version: string;
    institution_user_id: string;
    professional_id: string;
  } | null;
  if (
    !contract ||
    (contract.institution_user_id !== ctx.userId && contract.professional_id !== ctx.userId)
  ) {
    return fail("not_found");
  }

  // 3. Versión vigente.
  if (contract.terms_hash !== termsHash) return fail("terms_changed");

  // 4. Texto exacto que vio la persona.
  const terms = parseContractTerms(contract.terms);
  if (!terms || !isSupportedTemplate(terms.template)) return fail("unsupported_template");
  const expectedBody = await contractBodyHash(terms);
  if (expectedBody !== bodyHash) return fail("body_mismatch");

  // 5. Declaraciones explícitas.
  const missing = missingAcceptances(terms.required_clauses, accepted);
  if (missing.length > 0) return fail("clauses_required", { missing });

  const ip = clientIp(deps.header);
  const ipHash = deps.salt ? await hmacHex(deps.salt, ip) : null;
  const userAgent = (deps.header("user-agent") ?? "").slice(0, 200) || null;

  const { data, error } = await deps.admin.rpc("record_contract_signature", {
    p_contract_id: contractId,
    p_signer_id: ctx.userId,
    p_terms_hash: termsHash,
    p_body_hash: bodyHash,
    p_accepted_clauses: accepted,
    p_step_up: stepUp,
    p_ip_hash: ipHash,
    p_user_agent: userAgent,
  });
  if (error) {
    const mapped = mapSignatureError(error);
    return fail(mapped.code, { message: mapped.message, missing: mapped.missing });
  }

  const r = (data ?? {}) as {
    status?: string;
    party?: string;
    signed_at?: string;
    signature_hash?: string;
    fully_signed?: boolean;
  };
  if (!r.signature_hash || (r.status !== "active" && r.status !== "partially_signed")) {
    return fail("failed");
  }
  return {
    ok: true,
    status: r.status,
    fullySigned: r.fully_signed === true,
    party: r.party === "institution" ? "institution" : "professional",
    signedAt: r.signed_at ?? new Date(now).toISOString(),
    signatureHash: r.signature_hash,
  };
}
