// Verificación ReTHUS vía Verifik (acción de servidor).
// Identidad desde la sesión. Exige consentimiento Ley 1581, plan activo
// (mp_subscriptions, escrito solo por mp-webhook) y máximo 3 consultas por 24 h.
// El documento se guarda solo como HMAC-SHA256 con DOCUMENT_HASH_KEY.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidDocumentNumber, namesMatch, RETHUS_MAX_ATTEMPTS, RETHUS_WINDOW_MS } from "./rethusVerification";

const VERIFIK_URL = "https://api.verifik.co/v2/co/rethus";

const inputSchema = z.object({
  documentNumber: z.string().transform((s) => s.replace(/\D/g, "")).refine(isValidDocumentNumber, "Documento inválido"),
  documentType: z.enum(["CC", "CE", "PA", "TI", "PPT"]).default("CC"),
  consent: z.boolean().default(false),
});

export type RethusResult =
  | { ok: true; status: "verified" | "not_found" | "name_mismatch"; remaining: number; titles: { program: string | null; type: string | null }[] }
  | { ok: false; code: "consent_required" | "plan_required" | "rate_limited" | "not_professional" | "not_configured" | "provider_error"; message: string; remaining?: number };

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const verifyRethus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<RethusResult> => {
    const userId = context.userId;
    const VERIFIK_TOKEN = process.env.VERIFIK_TOKEN;
    const HASH_KEY = process.env.DOCUMENT_HASH_KEY;
    if (!VERIFIK_TOKEN || !HASH_KEY) {
      return { ok: false, code: "not_configured", message: "La verificación aún no está configurada." };
    }
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "professional").maybeSingle();
    if (!role) return { ok: false, code: "not_professional", message: "Solo profesionales pueden verificarse." };

    const { data: pro } = await admin.from("professional_profiles").select("data_consent_at").eq("user_id", userId).maybeSingle();
    if (!pro) return { ok: false, code: "not_professional", message: "Perfil profesional no encontrado." };
    if (!pro.data_consent_at) {
      if (!data.consent) return { ok: false, code: "consent_required", message: "Debes aceptar el tratamiento de datos (Ley 1581)." };
      await admin.from("user_consents").insert({ user_id: userId, consent_type: "rethus_verifik_ley_1581_v1", granted: true });
      await admin.from("professional_profiles").update({ data_consent_at: new Date().toISOString() }).eq("user_id", userId);
    }

    const { data: sub } = await admin.from("mp_subscriptions").select("status, current_period_end").eq("user_id", userId).maybeSingle();
    const active = !!sub && ["active", "approved"].includes(String(sub.status)) &&
      (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
    if (!active) return { ok: false, code: "plan_required", message: "Necesitas un plan activo para verificar tu ReTHUS." };

    const since = new Date(Date.now() - RETHUS_WINDOW_MS).toISOString();
    const { count } = await admin.from("professional_verifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("check_type", "rethus").gte("created_at", since);
    const used = count ?? 0;
    if (used >= RETHUS_MAX_ATTEMPTS) {
      return { ok: false, code: "rate_limited", message: "Alcanzaste el límite de 3 consultas en 24 horas.", remaining: 0 };
    }
    const remaining = RETHUS_MAX_ATTEMPTS - used - 1;

    const documentHash = await hmacHex(HASH_KEY, `${data.documentType}:${data.documentNumber}`);
    const { data: profile } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();

    let status: "verified" | "not_found" | "name_mismatch" | "error" = "error";
    let titles: { program: string | null; type: string | null }[] = [];
    let httpStatus: number | null = null;
    try {
      const url = `${VERIFIK_URL}?documentType=${data.documentType}&documentNumber=${data.documentNumber}`;
      const r = await fetch(url, { headers: { Authorization: `JWT ${VERIFIK_TOKEN}`, Accept: "application/json" } });
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
        console.error("[verifyRethus] Verifik status", r.status);
      }
    } catch (e) {
      console.error("[verifyRethus] Verifik error", e instanceof Error ? e.message : "unknown");
    }

    await admin.from("professional_verifications").insert({
      user_id: userId, provider: "verifik", check_type: "rethus", document_hash: documentHash, status,
      result: status === "error" ? { http_status: httpStatus } : { titles_count: titles.length, titles },
    });

    if (status === "error") {
      return { ok: false, code: "provider_error", message: "No pudimos consultar ReTHUS. Intenta más tarde.", remaining };
    }
    await admin.from("professional_profiles").update({
      verification_status: status,
      rethus_verified: status === "verified",
      rethus_checked_at: new Date().toISOString(),
    }).eq("user_id", userId);

    return { ok: true, status, remaining, titles };
  });
