// Verificación ReTHUS vía Verifik (acciones de servidor).
// - Profesional: UNA sola verificación automática cuando hay consentimiento Ley 1581,
//   plan vigente (solo mp_subscriptions) y documento registrado. Un error del proveedor
//   no consume el intento. Unicidad aplicada aquí y con índice único parcial en BD.
// - Admin (is_staff o superadmin): re-verifica a un profesional saltándose la regla,
//   sin exigir plan, con límite de 20 por hora; queda registrado requested_by + reverified.
// El documento se guarda cifrado (AES-GCM) en professional_identity_documents y como
// HMAC-SHA256 en professional_verifications; ambos derivados de DOCUMENT_HASH_KEY.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminRemaining, hasConsumedSingleAttempt, isActiveSubscription, isValidDocumentNumber,
  missingPrerequisite, namesMatch, RETHUS_ADMIN_WINDOW_MS, type RethusFinalStatus,
} from "./rethusVerification";

const VERIFIK_URL = "https://api.verifik.co/v2/co/rethus";
const DOC_TYPES = ["CC", "CE", "PA", "TI", "PPT"] as const;
type DocType = (typeof DOC_TYPES)[number];

const docNumber = z.string().transform((s) => s.replace(/\D/g, "")).refine(isValidDocumentNumber, "Documento inválido");

const proInput = z.object({
  documentNumber: docNumber.optional(),
  documentType: z.enum(DOC_TYPES).default("CC"),
  consent: z.boolean().default(false),
});
const adminInput = z.object({
  userId: z.string().uuid(),
  documentNumber: docNumber.optional(),
  documentType: z.enum(DOC_TYPES).default("CC"),
});

export type RethusErrorCode =
  | "already_verified" | "consent_required" | "plan_required" | "document_required"
  | "not_professional" | "not_configured" | "provider_error" | "forbidden" | "rate_limited";

export type RethusResult =
  | { ok: true; status: RethusFinalStatus; checkedAt: string }
  | { ok: false; code: RethusErrorCode; message: string; status?: string | null; remaining?: number };

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function aesKey(key: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`aes:${key}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptDoc(key: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(key), enc.encode(plain)));
  return `${toB64(iv)}.${toB64(ct)}`;
}
async function decryptDoc(key: string, payload: string) {
  const [iv, ct] = payload.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(key), fromB64(ct));
  return new TextDecoder().decode(pt);
}

async function storeDocument(admin: Admin, hashKey: string, userId: string, type: DocType, number: string) {
  await admin.from("professional_identity_documents").upsert({
    user_id: userId, document_type: type,
    document_enc: await encryptDoc(hashKey, number),
    document_hash: await hmacHex(hashKey, `${type}:${number}`),
    updated_at: new Date().toISOString(),
  });
}

async function loadDocument(admin: Admin, hashKey: string, userId: string): Promise<{ type: DocType; number: string } | null> {
  const { data } = await admin.from("professional_identity_documents").select("document_type, document_enc").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  try {
    return { type: data.document_type as DocType, number: await decryptDoc(hashKey, data.document_enc) };
  } catch {
    return null;
  }
}

/** Consulta Verifik, registra el intento y sincroniza el perfil si el resultado es final. */
async function runCheck(
  admin: Admin, env: { token: string; hashKey: string }, userId: string,
  doc: { type: DocType; number: string }, meta: { requestedBy: string; reverified: boolean },
): Promise<RethusResult> {
  const { data: profile } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  let status: RethusFinalStatus | "error" = "error";
  let titles: { program: string | null; type: string | null }[] = [];
  let httpStatus: number | null = null;
  try {
    const url = `${VERIFIK_URL}?documentType=${doc.type}&documentNumber=${doc.number}`;
    const r = await fetch(url, { headers: { Authorization: `JWT ${env.token}`, Accept: "application/json" } });
    httpStatus = r.status;
    if (r.status === 404) status = "not_found";
    else if (r.ok) {
      const payload = (await r.json()) as { data?: Record<string, unknown> };
      const d = payload?.data ?? {};
      const official = String(d.fullName ?? [d.firstName, d.lastName].filter(Boolean).join(" "));
      const rawTitles = (d.academicTitles ?? d.titles ?? []) as Record<string, unknown>[];
      titles = (Array.isArray(rawTitles) ? rawTitles : []).slice(0, 5).map((t) => ({
        program: (t.programName ?? t.program ?? null) as string | null,
        type: (t.titleType ?? t.type ?? null) as string | null,
      }));
      status = !official.trim() ? "not_found" : namesMatch(profile?.full_name ?? "", official) ? "verified" : "name_mismatch";
    } else {
      console.error("[rethus] Verifik status", r.status);
    }
  } catch (e) {
    console.error("[rethus] Verifik error", e instanceof Error ? e.message : "unknown");
  }

  const { error: insErr } = await admin.from("professional_verifications").insert({
    user_id: userId, provider: "verifik", check_type: "rethus",
    document_hash: await hmacHex(env.hashKey, `${doc.type}:${doc.number}`), status,
    requested_by: meta.requestedBy, reverified: meta.reverified,
    result: status === "error"
      ? { http_status: httpStatus, reverified: meta.reverified }
      : { titles_count: titles.length, titles, reverified: meta.reverified },
  });
  // Índice único parcial: una carrera concurrente del profesional termina aquí.
  if (insErr && !meta.reverified && insErr.code === "23505") {
    return { ok: false, code: "already_verified", message: "Tu verificación ReTHUS ya fue realizada." };
  }
  if (status === "error") {
    return { ok: false, code: "provider_error", message: "No pudimos consultar ReTHUS. Se reintentará automáticamente más tarde." };
  }
  const checkedAt = new Date().toISOString();
  await admin.from("professional_profiles").update({
    verification_status: status, rethus_verified: status === "verified", rethus_checked_at: checkedAt,
  }).eq("user_id", userId);
  return { ok: true, status, checkedAt };
}

function readEnv() {
  const token = process.env.VERIFIK_TOKEN;
  const hashKey = process.env.DOCUMENT_HASH_KEY;
  return token && hashKey ? { token, hashKey } : null;
}

/** Profesional: verificación única y automática. Sin reintento manual. */
export const verifyRethus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => proInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<RethusResult> => {
    const userId = context.userId;
    const env = readEnv();
    if (!env) return { ok: false, code: "not_configured", message: "La verificación aún no está configurada." };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "professional").maybeSingle();
    const { data: pro } = await admin.from("professional_profiles").select("data_consent_at, verification_status").eq("user_id", userId).maybeSingle();
    if (!role || !pro) return { ok: false, code: "not_professional", message: "Solo profesionales pueden verificarse." };

    const { data: prior } = await admin.from("professional_verifications").select("status, reverified")
      .eq("user_id", userId).eq("check_type", "rethus");
    if (hasConsumedSingleAttempt(prior ?? [])) {
      return { ok: false, code: "already_verified", message: "Tu verificación ReTHUS ya fue realizada.", status: pro.verification_status };
    }

    let hasConsent = !!pro.data_consent_at;
    if (!hasConsent && data.consent) {
      await admin.from("user_consents").insert({ user_id: userId, consent_type: "rethus_verifik_ley_1581_v1", granted: true });
      await admin.from("professional_profiles").update({ data_consent_at: new Date().toISOString() }).eq("user_id", userId);
      hasConsent = true;
    }
    if (data.documentNumber) await storeDocument(admin, env.hashKey, userId, data.documentType, data.documentNumber);

    const doc = await loadDocument(admin, env.hashKey, userId);
    const { data: sub } = await admin.from("mp_subscriptions").select("status, current_period_end").eq("user_id", userId).maybeSingle();
    const missing = missingPrerequisite({ hasConsent, hasActivePlan: isActiveSubscription(sub), hasDocument: !!doc });
    if (missing) {
      const msg = {
        consent_required: "Debes aceptar el tratamiento de datos (Ley 1581).",
        plan_required: "La verificación se hará automáticamente cuando tengas un plan activo.",
        document_required: "Registra tu número de documento para verificarte.",
      }[missing];
      return { ok: false, code: missing, message: msg };
    }
    return runCheck(admin, env, userId, doc!, { requestedBy: userId, reverified: false });
  });

/** Admin (is_staff o superadmin): re-verificación sin regla de una sola vez ni plan. */
export const adminReverifyRethus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => adminInput.parse(data))
  .handler(async ({ data, context }): Promise<RethusResult> => {
    const adminId = context.userId;
    const [{ data: staff }, { data: superadmin }] = await Promise.all([
      context.supabase.rpc("is_staff", { _user_id: adminId }),
      context.supabase.rpc("has_role", { _user_id: adminId, _role: "superadmin" }),
    ]);
    if (!staff && !superadmin) return { ok: false, code: "forbidden", message: "No autorizado." };

    const env = readEnv();
    if (!env) return { ok: false, code: "not_configured", message: "La verificación aún no está configurada." };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - RETHUS_ADMIN_WINDOW_MS).toISOString();
    const { data: recent } = await admin.from("professional_verifications").select("created_at")
      .eq("requested_by", adminId).eq("reverified", true).gte("created_at", since);
    const remaining = adminRemaining((recent ?? []).map((r) => r.created_at));
    if (remaining <= 0) return { ok: false, code: "rate_limited", message: "Límite de 20 re-verificaciones por hora alcanzado.", remaining: 0 };

    const { data: pro } = await admin.from("professional_profiles").select("user_id").eq("user_id", data.userId).maybeSingle();
    if (!pro) return { ok: false, code: "not_professional", message: "Perfil profesional no encontrado." };

    if (data.documentNumber) await storeDocument(admin, env.hashKey, data.userId, data.documentType, data.documentNumber);
    const doc = await loadDocument(admin, env.hashKey, data.userId);
    if (!doc) return { ok: false, code: "document_required", message: "El profesional no tiene documento registrado." };

    return runCheck(admin, env, data.userId, doc, { requestedBy: adminId, reverified: true });
  });
