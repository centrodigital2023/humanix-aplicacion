// Lógica de servidor del formulario de validación de mercado: envío, código de verificación y canje del mes
// gratis del plan Esencial.
//
// Vive aparte de `marketValidation.functions.ts` por dos razones: no viaja al navegador y se puede probar con
// Vitest inyectando la base de datos, los encabezados, el reloj y las llamadas externas (WhatsApp y correo).
//
// Reemplaza a las funciones de borde `send-validation-otp` y `verify-validation-otp` (la regla del proyecto es no
// crear Edge Functions nuevas) y corrige lo que tenían de riesgoso:
//   · eran públicas y enviaban un código a CUALQUIER contacto sin límite por IP (un canal de spam);
//   · guardaban el código en claro y lo generaban con Math.random();
//   · el navegador insertaba directamente en la tabla, así que cualquiera podía fabricar respuestas «verificadas».
// Ahora solo este servidor escribe (service role). El beneficio nace al verificar el contacto, hay uno por
// contacto y por cuenta, y activarlo pasa por `redeem_validation_benefit` (único camino hacia `mp_subscriptions`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientIp } from "./clientIp";
import {
  BENEFIT,
  CONSENT_VERSION,
  MIN_FILL_MS,
  assessQuality,
  cleanSubmission,
  isDisposableEmail,
  isNearDuplicate,
  marketValidationSchema,
  normalizeContact,
  PROFILE_META,
  signalOf,
  signalScore,
  type ContactKind,
  type NormalizedContact,
} from "./marketValidation";
import { isHotLead } from "./marketInsights";

export type Db = SupabaseClient;

export interface OtpConfig {
  whatsappToken?: string;
  whatsappPhoneId?: string;
  /**
   * Plantilla de AUTENTICACIÓN aprobada en WhatsApp Business (cuerpo con el código y botón «copiar código»).
   * Sin plantilla solo se puede escribir a quien habló con el número en las últimas 24 horas.
   */
  whatsappTemplate?: string;
  resendKey?: string;
}

export interface MarketDeps {
  admin: Db;
  /** Lee un encabezado de la petición actual (minúsculas). */
  header: (name: string) => string | undefined;
  /** Sal para las huellas de IP y de código (nunca se guarda la IP en claro). */
  salt: string | undefined;
  otp: OtpConfig;
  now?: () => number;
  fetch?: typeof fetch;
  /** Bytes aleatorios criptográficos (inyectable para pruebas). */
  random?: (n: number) => Uint8Array;
}

const MAX_BODY_CHARS = 20_000;
const HOUR = 3_600_000;
export const LIMITS_SERVER = {
  /**
   * Por IP solo cuentan los intentos SIN verificar: quien confirma su contacto no gasta el cupo de los demás.
   * Así un hospital o una conexión de datos móviles (miles de personas tras una misma IP) no se bloquea sola, y
   * quien manda a números ajenos (que nunca verifican) sí topa el límite.
   */
  submitPerIpHour: 20,
  submitPerContactHour: 3,
  otpPerResponse: 4,
  otpPerContactHour: 5,
  otpPerIpHour: 20,
  /**
   * Freno de costo SOLO para WhatsApp (cada mensaje cuesta): códigos de WhatsApp enviados en la última hora que nadie
   * verificó. Al llegar al tope, WhatsApp queda «no disponible» y la persona puede usar su correo: un abuso no apaga
   * todo el formulario.
   */
  otpGlobalWhatsappHour: 300,
  otpTtlMs: 15 * 60_000,
  otpMaxAttempts: 5,
  resendMs: 30_000,
  responseMaxAgeMs: 24 * HOUR,
} as const;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 símbolos, sin I, L, O, 0 ni 1

// ─── Utilidades ──────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const rnd = (deps: MarketDeps) =>
  deps.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

/** Entero uniforme de 0 a max-1 sin sesgo (rechaza los bytes que sesgarían el módulo). */
function randomBelow(deps: MarketDeps, max: number): number {
  const limit = 256 - (256 % max);
  for (;;) {
    for (const b of rnd(deps)(32)) if (b < limit) return b % max;
  }
}

export function makeOtp(deps: MarketDeps): string {
  return Array.from({ length: 6 }, () => String(randomBelow(deps, 10))).join("");
}

export function makeBenefitCode(deps: MarketDeps): string {
  const chunk = () =>
    Array.from({ length: 5 }, () => CODE_ALPHABET[randomBelow(deps, CODE_ALPHABET.length)]).join(
      "",
    );
  return `MLP-${chunk()}-${chunk()}`;
}

const otpHash = (salt: string, responseId: string, code: string) =>
  sha256Hex(`${salt}:otp:${responseId}:${code}`);

/** Registro de ejecución para observabilidad. Nunca rompe la acción principal. */
async function logExec(
  admin: Db,
  entry: {
    fn: string;
    status: "success" | "error" | "rejected" | "blocked";
    startedAt: number;
    errorCode?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("function_execution_logs").insert({
      function_name: entry.fn,
      trigger_type: "frontend",
      status: entry.status,
      duration_ms: Date.now() - entry.startedAt,
      error_code: entry.errorCode ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    /* el registro nunca debe romper la acción */
  }
}

async function count(
  admin: Db,
  table: string,
  filters: Array<[string, string]>,
  sinceCol: string,
  sinceIso: string,
  /** Columnas que deben ser nulas (por ejemplo `verified_at`: solo lo que nadie verificó). */
  nullCols: string[] = [],
): Promise<number> {
  let q = admin.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of filters) q = q.eq(k, v);
  for (const c of nullCols) q = q.is(c, null);
  const { count: n } = await q.gte(sinceCol, sinceIso);
  return n ?? 0;
}

async function userIdFromAuth(admin: Db, header: MarketDeps["header"]): Promise<string | null> {
  const auth = header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    const { data } = await admin.auth.getUser(auth.slice(7));
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Canje ───────────────────────────────────────────────────────────────────

export type RedeemError =
  | "invalid_code"
  | "not_verified"
  | "already_redeemed"
  | "expired"
  | "user_already_rewarded"
  | "plan_active"
  | "unauthenticated"
  | "rate_limited"
  | "server";

export type RedeemResult =
  | { ok: true; plan: string; endsAt: string }
  | { ok: false; error: RedeemError };

async function redeem(admin: Db, userId: string, code: string): Promise<RedeemResult> {
  const { data, error } = await admin.rpc("redeem_validation_benefit", {
    p_user: userId,
    p_code: code,
  });
  if (error || !data) {
    console.error("[redeem_validation_benefit]", error?.code ?? "sin datos");
    return { ok: false, error: "server" };
  }
  const r = data as { ok: boolean; error?: RedeemError; plan?: string; ends_at?: string };
  return r.ok
    ? { ok: true, plan: r.plan ?? BENEFIT.plan, endsAt: r.ends_at ?? "" }
    : { ok: false, error: r.error ?? "server" };
}

const redeemSchema = z.object({ code: z.string().trim().min(8).max(32) });

export async function handleRedeem(
  data: unknown,
  userId: string,
  deps: Pick<MarketDeps, "admin">,
): Promise<RedeemResult> {
  const startedAt = Date.now();
  const p = redeemSchema.safeParse(data);
  if (!p.success) return { ok: false, error: "invalid_code" };
  const result = await redeem(deps.admin, userId, p.data.code);
  await logExec(deps.admin, {
    fn: "market-validation-redeem",
    status: result.ok ? "success" : "rejected",
    startedAt,
    errorCode: result.ok ? undefined : result.error,
  });
  return result;
}

// ─── Enviar el formulario ─────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true; responseId: string; contact: { kind: ContactKind; masked: string } }
  | { ok: false; error: "validation" | "low_quality"; fields: string[] }
  | { ok: false; error: "rate_limited" | "too_large" | "server" };

function failedFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? "form")))];
}

export async function handleSubmit(data: unknown, deps: MarketDeps): Promise<SubmitResult> {
  const startedAt = Date.now();
  if (JSON.stringify(data ?? null).length > MAX_BODY_CHARS)
    return { ok: false, error: "too_large" };

  const { admin, header, salt } = deps;
  const now = (deps.now ?? Date.now)();
  const raw = (data ?? {}) as Record<string, unknown>;

  // Campo trampa lleno o envío imposiblemente rápido: los robots creen que funcionó. La rapidez es una DURACIÓN
  // medida en el navegador (no una hora): así un reloj mal puesto en el celular no convierte a nadie en robot.
  // Nuestro formulario siempre la manda; quien llama sin ella (un script) cae en la misma trampa.
  const trap =
    (typeof raw.website === "string" && raw.website.length > 0) ||
    typeof raw.fillMs !== "number" ||
    raw.fillMs < MIN_FILL_MS;
  if (trap) {
    const c = normalizeContact(typeof raw.contact === "string" ? raw.contact : "");
    return {
      ok: true,
      responseId: crypto.randomUUID(),
      contact: { kind: c?.kind ?? "email", masked: c?.masked ?? "***" },
    };
  }

  const parsed = marketValidationSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: "validation", fields: failedFields(parsed.error) };
  const input = parsed.data;
  const clean = cleanSubmission(input);
  if (!clean) return { ok: false, error: "validation", fields: ["contact"] };

  if (!salt) {
    console.error("[submitMarketValidation] falta SUPABASE_SERVICE_ROLE_KEY");
    return { ok: false, error: "server" };
  }

  const quality = assessQuality(input);
  if (quality.severe) {
    await logExec(admin, {
      fn: "market-validation-submit",
      status: "rejected",
      startedAt,
      errorCode: "low_quality",
    });
    return { ok: false, error: "low_quality", fields: quality.fields };
  }

  const ipHash = await sha256Hex(`${salt}:ip:${clientIp(header)}`);
  const sinceHour = new Date(now - HOUR).toISOString();

  try {
    if (
      (await count(admin, "validation_responses", [["ip_hash", ipHash]], "created_at", sinceHour, [
        "contact_verified_at",
      ])) >= LIMITS_SERVER.submitPerIpHour ||
      (await count(
        admin,
        "validation_responses",
        [["contact_key", clean.contact.key]],
        "created_at",
        sinceHour,
      )) >= LIMITS_SERVER.submitPerContactHour
    ) {
      await logExec(admin, {
        fn: "market-validation-submit",
        status: "rejected",
        startedAt,
        errorCode: "rate_limited",
      });
      return { ok: false, error: "rate_limited" };
    }

    // Reenviar lo mismo (refrescar la página, doble clic): se reutiliza la respuesta de las últimas 24 horas.
    const { data: dup } = await admin
      .from("validation_responses")
      .select("id, quality_flags")
      .eq("contact_key", clean.contact.key)
      .eq("service_offer", clean.serviceOffer)
      .gte("created_at", new Date(now - 24 * HOUR).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Si la anterior se retuvo por parecer copiada, no se reutiliza: la persona puede reescribirla con sus palabras.
    const reusable =
      dup?.id && !((dup.quality_flags as string[] | null) ?? []).includes("duplicate_text");
    if (reusable && dup?.id) {
      return {
        ok: true,
        responseId: dup.id as string,
        contact: { kind: clean.contact.kind, masked: clean.contact.masked },
      };
    }

    const userId = await userIdFromAuth(admin, header);
    const signal = signalScore(
      {
        painPoint: clean.painPoint,
        targetAudience: clean.targetAudience,
        dailyChange: clean.dailyChange,
        paysCurrently: clean.paysCurrently,
        alternatives: clean.alternatives,
        willingnessPct: clean.willingnessPct,
        comments: clean.comments,
      },
      quality,
    );

    const { data: row, error } = await admin
      .from("validation_responses")
      .insert({
        profile_type: clean.profile,
        full_name: clean.fullName,
        whatsapp: clean.contact.kind === "whatsapp" ? clean.contact.value : null,
        email: clean.contact.kind === "email" ? clean.contact.value : null,
        contact_key: clean.contact.key,
        city: clean.city,
        service_offer: clean.serviceOffer,
        pain_point: clean.painPoint,
        target_customer: clean.targetAudience,
        key_benefit: clean.dailyChange,
        pays_currently: clean.paysCurrently,
        alternatives: clean.alternatives,
        competitors: clean.alternatives.join("\n") || null,
        search_channels: clean.searchChannels,
        retention_channels: clean.searchChannelsOther,
        willingness_pct: clean.willingnessPct,
        comments: clean.comments,
        signal_score: signal.score,
        quality_flags: quality.flags,
        consent_at: new Date(now).toISOString(),
        consent_version: CONSENT_VERSION,
        ip_hash: ipHash,
        source: input.source ?? null,
        user_id: userId,
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("[submitMarketValidation] insert falló:", error?.code);
      await logExec(admin, {
        fn: "market-validation-submit",
        status: "error",
        startedAt,
        errorCode: error?.code ?? "insert_failed",
      });
      return { ok: false, error: "server" };
    }

    await logExec(admin, {
      fn: "market-validation-submit",
      status: "success",
      startedAt,
      metadata: { profile: clean.profile, authenticated: Boolean(userId), signal: signal.score },
    });
    return {
      ok: true,
      responseId: row.id as string,
      contact: { kind: clean.contact.kind, masked: clean.contact.masked },
    };
  } catch (e) {
    console.error("[submitMarketValidation]", (e as Error).message);
    return { ok: false, error: "server" };
  }
}

// ─── Enviar el código ────────────────────────────────────────────────────────

const sendSchema = z.object({
  responseId: z.string().uuid(),
  contact: z.string().trim().max(254).optional(),
});

export type SendOtpResult =
  | { ok: true; channel: ContactKind; masked: string; resendInSeconds: number }
  | {
      ok: false;
      error:
        | "validation"
        | "not_found"
        | "already_verified"
        | "rate_limited"
        | "channel_unavailable"
        | "send_failed"
        | "server";
    };

const SEND_TIMEOUT_MS = 8_000;

/** POST con tope de espera: un proveedor colgado no debe dejar la petición abierta ni tumbar el flujo. */
async function postJson(
  deps: MarketDeps,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response | null> {
  try {
    return await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function sendWhatsapp(
  deps: MarketDeps,
  phone: string,
  code: string,
): Promise<"ok" | "unavailable" | "failed"> {
  const { whatsappToken, whatsappPhoneId, whatsappTemplate } = deps.otp;
  if (!whatsappToken || !whatsappPhoneId) return "unavailable";
  const body = whatsappTemplate
    ? {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: whatsappTemplate,
          language: { code: "es" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: code }],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: {
          body: `🔐 Tu código de verificación Humanix es *${code}*. Vale 15 minutos. No lo compartas con nadie.`,
        },
      };
  const res = await postJson(
    deps,
    `https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`,
    { Authorization: `Bearer ${whatsappToken}`, "Content-Type": "application/json" },
    body,
  );
  if (!res || !res.ok) {
    console.error("[market-otp-wa]", res ? res.status : "sin respuesta");
    return "failed";
  }
  return "ok";
}

async function sendEmail(
  deps: MarketDeps,
  email: string,
  code: string,
): Promise<"ok" | "unavailable" | "failed"> {
  const { resendKey } = deps.otp;
  if (!resendKey) return "unavailable";
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
<h2>Tu código de verificación Humanix</h2>
<p style="font-size:44px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</p>
<p>Este código es válido por <strong>15 minutos</strong>. Con él confirmas tu contacto para recibir tu mes del plan Esencial.</p>
<p style="color:#6b7280;font-size:12px">Si no lo solicitaste, ignora este mensaje. · humanix.lat</p>
</body></html>`;
  const res = await postJson(
    deps,
    "https://api.resend.com/emails",
    { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    {
      from: "Humanix <noreply@humanix.lat>",
      to: [email],
      subject: `Tu código Humanix: ${code}`,
      html,
    },
  );
  if (!res || !res.ok) {
    console.error("[market-otp-email]", res ? res.status : "sin respuesta");
    return "failed";
  }
  return "ok";
}

export async function handleSendOtp(data: unknown, deps: MarketDeps): Promise<SendOtpResult> {
  const startedAt = Date.now();
  const p = sendSchema.safeParse(data);
  if (!p.success) return { ok: false, error: "validation" };
  const { admin, header, salt } = deps;
  if (!salt) return { ok: false, error: "server" };
  const now = (deps.now ?? Date.now)();

  try {
    const { data: r } = await admin
      .from("validation_responses")
      .select("id, whatsapp, email, contact_key, contact_verified_at, created_at")
      .eq("id", p.data.responseId)
      .maybeSingle();
    if (!r) return { ok: false, error: "not_found" };
    if (r.contact_verified_at) return { ok: false, error: "already_verified" };
    if (now - new Date(r.created_at as string).getTime() > LIMITS_SERVER.responseMaxAgeMs) {
      return { ok: false, error: "not_found" };
    }

    // Contacto al que se envía: el del formulario o, si la persona lo corrigió, el nuevo.
    let contact: NormalizedContact | null = normalizeContact(
      (r.whatsapp as string | null) ?? (r.email as string | null) ?? "",
    );
    if (p.data.contact) {
      const changed = normalizeContact(p.data.contact);
      if (!changed || (changed.kind === "email" && isDisposableEmail(changed.value))) {
        return { ok: false, error: "validation" };
      }
      contact = changed;
    }
    if (!contact) return { ok: false, error: "validation" };

    const ipHash = await sha256Hex(`${salt}:ip:${clientIp(header)}`);
    const sinceHour = new Date(now - HOUR).toISOString();
    if (
      (await count(
        admin,
        "validation_otps",
        [["response_id", r.id as string]],
        "created_at",
        new Date(0).toISOString(),
      )) >= LIMITS_SERVER.otpPerResponse ||
      (await count(
        admin,
        "validation_otps",
        [["contact", contact.value]],
        "created_at",
        sinceHour,
      )) >= LIMITS_SERVER.otpPerContactHour ||
      (await count(admin, "validation_otps", [["ip_hash", ipHash]], "created_at", sinceHour, [
        "verified_at",
      ])) >= LIMITS_SERVER.otpPerIpHour
    ) {
      return { ok: false, error: "rate_limited" };
    }
    if (
      contact.kind === "whatsapp" &&
      (await count(admin, "validation_otps", [["channel", "whatsapp"]], "created_at", sinceHour, [
        "verified_at",
      ])) >= LIMITS_SERVER.otpGlobalWhatsappHour
    ) {
      // Tope de costo alcanzado: WhatsApp descansa y el correo sigue funcionando.
      return { ok: false, error: "channel_unavailable" };
    }
    const { data: last } = await admin
      .from("validation_otps")
      .select("created_at")
      .eq("response_id", r.id as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && now - new Date(last.created_at as string).getTime() < LIMITS_SERVER.resendMs) {
      return { ok: false, error: "rate_limited" };
    }

    if (p.data.contact && contact.key !== (r.contact_key as string | null)) {
      const { error: upErr } = await admin
        .from("validation_responses")
        .update({
          whatsapp: contact.kind === "whatsapp" ? contact.value : null,
          email: contact.kind === "email" ? contact.value : null,
          contact_key: contact.key,
        })
        .eq("id", r.id as string)
        .is("contact_verified_at", null);
      if (upErr) return { ok: false, error: "server" };
    }

    const code = makeOtp(deps);
    const { data: otp, error } = await admin
      .from("validation_otps")
      .insert({
        response_id: r.id,
        contact: contact.value,
        channel: contact.kind,
        code_hash: await otpHash(salt, r.id as string, code),
        expires_at: new Date(now + LIMITS_SERVER.otpTtlMs).toISOString(),
        ip_hash: ipHash,
      })
      .select("id")
      .single();
    if (error || !otp) return { ok: false, error: "server" };

    const sent =
      contact.kind === "whatsapp"
        ? await sendWhatsapp(deps, contact.value, code)
        : await sendEmail(deps, contact.value, code);
    if (sent !== "ok") {
      await admin
        .from("validation_otps")
        .delete()
        .eq("id", otp.id as string);
      await logExec(admin, {
        fn: "market-validation-otp",
        status: "error",
        startedAt,
        errorCode: `${contact.kind}_${sent}`,
      });
      return { ok: false, error: sent === "unavailable" ? "channel_unavailable" : "send_failed" };
    }

    // Limpieza oportunista de códigos viejos.
    if (Math.random() < 0.02) {
      await admin
        .from("validation_otps")
        .delete()
        .lt("created_at", new Date(now - 48 * HOUR).toISOString());
    }
    return {
      ok: true,
      channel: contact.kind,
      masked: contact.masked,
      resendInSeconds: LIMITS_SERVER.resendMs / 1000,
    };
  } catch (e) {
    console.error("[sendValidationOtp]", (e as Error).message);
    return { ok: false, error: "server" };
  }
}

// ─── Verificar el código ──────────────────────────────────────────────────────

const verifySchema = z.object({
  responseId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

/** `review`: las respuestas se parecen demasiado a las de otra persona; no hay código hasta que las reescriba. */
export type BenefitState = "available" | "already_redeemed" | "expired" | "review" | "none";

export type VerifyOtpResult =
  | {
      ok: true;
      benefit: BenefitState;
      promoCode: string | null;
      expiresAt: string | null;
      /** Si la persona tenía sesión, el canje se intenta de inmediato. */
      redeemed: RedeemResult | null;
    }
  | {
      ok: false;
      error:
        | "validation"
        | "not_found"
        | "no_code"
        | "invalid_code"
        | "expired"
        | "too_many_attempts"
        | "rate_limited"
        | "server";
      remaining?: number;
    };

type ResponseBenefitRow = {
  id: string;
  contact_key: string | null;
  contact_verified_at: string | null;
  promo_code: string | null;
  benefit_expires_at: string | null;
  benefit_status: string | null;
  redeemed_by: string | null;
  premium_activated: boolean | null;
  quality_flags?: string[] | null;
};

function benefitFrom(
  row: ResponseBenefitRow,
  now: number,
): { state: BenefitState; code: string | null; expiresAt: string | null } {
  if (!row.promo_code) {
    const held = (row.quality_flags ?? []).includes("duplicate_text");
    return { state: held ? "review" : "none", code: null, expiresAt: null };
  }
  if (row.redeemed_by || row.premium_activated)
    return { state: "already_redeemed", code: null, expiresAt: null };
  if (row.benefit_expires_at && new Date(row.benefit_expires_at).getTime() <= now) {
    return { state: "expired", code: null, expiresAt: row.benefit_expires_at };
  }
  return { state: "available", code: row.promo_code, expiresAt: row.benefit_expires_at };
}

const BENEFIT_COLS =
  "id, contact_key, contact_verified_at, promo_code, benefit_expires_at, benefit_status, redeemed_by, premium_activated, quality_flags";

/** Respuestas de otras personas ya verificadas en las últimas 24 horas con las que se compara. */
const DUPLICATE_LOOKBACK_MS = 24 * HOUR;
const DUPLICATE_SCAN_LIMIT = 300;

async function copiedFromAnotherPerson(
  admin: Db,
  response: ResponseBenefitRow,
  now: number,
): Promise<boolean> {
  try {
    const { data: mine } = await admin
      .from("validation_responses")
      .select("service_offer, pain_point, target_customer, key_benefit")
      .eq("id", response.id)
      .maybeSingle();
    if (!mine) return false;
    const { data: recent } = await admin
      .from("validation_responses")
      .select("contact_key, service_offer, pain_point, target_customer, key_benefit")
      .not("contact_verified_at", "is", null)
      .gte("created_at", new Date(now - DUPLICATE_LOOKBACK_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(DUPLICATE_SCAN_LIMIT);
    const texts = (r: Record<string, unknown>) => ({
      serviceOffer: r.service_offer as string | null,
      painPoint: r.pain_point as string | null,
      targetAudience: r.target_customer as string | null,
      dailyChange: r.key_benefit as string | null,
    });
    const a = texts(mine as Record<string, unknown>);
    return ((recent ?? []) as Array<Record<string, unknown>>).some(
      (r) => r.contact_key !== response.contact_key && isNearDuplicate(a, texts(r)),
    );
  } catch {
    return false; // ante un error de lectura no se castiga a nadie
  }
}

/** Tope de avisos por hora: un aviso nunca debe convertirse en ruido. */
const HOT_LEAD_NOTIFICATIONS_PER_HOUR = 30;

/**
 * Avisa en la campana de los superadmin cuando entra un contacto fuerte y verificado. Sin datos personales en el
 * aviso (solo perfil, ciudad y señal). Mejor esfuerzo: si algo falla, la verificación de la persona sigue igual.
 */
async function notifyHotLead(admin: Db, responseId: string, now: number): Promise<void> {
  try {
    const { data: r } = await admin
      .from("validation_responses")
      .select("signal_score, total_score, quality_flags, profile_type, city")
      .eq("id", responseId)
      .maybeSingle();
    if (!r || !isHotLead(r as Parameters<typeof isHotLead>[0])) return;
    const { data: admins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "superadmin");
    const ids = ((admins ?? []) as Array<{ user_id: string }>)
      .map((a) => a.user_id)
      .filter(Boolean);
    if (!ids.length) return;
    // Cada aviso deja una fila por superadmin: el tope se cuenta en avisos, no en filas.
    const since = new Date(now - HOUR).toISOString();
    if (
      (await count(admin, "notifications", [["type", "market_hot_lead"]], "created_at", since)) >=
      HOT_LEAD_NOTIFICATIONS_PER_HOUR * ids.length
    ) {
      return;
    }
    const row = r as { profile_type: string; city: string | null };
    const label = PROFILE_META[row.profile_type as keyof typeof PROFILE_META]?.label ?? "Contacto";
    await admin.from("notifications").insert(
      ids.map((user_id) => ({
        user_id,
        type: "market_hot_lead",
        title: "Nuevo contacto fuerte en la validación de mercado",
        body: `${label}${row.city ? ` en ${row.city}` : ""} · señal ${signalOf(r as Parameters<typeof signalOf>[0])} de 100 · contacto verificado.`,
        link: "/superadmin/validacion",
      })),
    );
  } catch {
    /* un aviso nunca debe romper la verificación */
  }
}

/** Entrega el código del contacto: el que ya tenía (idempotente) o uno nuevo. */
async function issueBenefit(
  deps: MarketDeps,
  response: ResponseBenefitRow,
  channel: ContactKind,
  now: number,
): Promise<{
  state: BenefitState;
  code: string | null;
  expiresAt: string | null;
  /** true solo cuando este contacto recibió su código ahora (no uno que ya tenía). */
  fresh?: boolean;
}> {
  const { admin } = deps;
  const verifiedAt = new Date(now).toISOString();

  // ¿Ya hay un código para este mismo contacto (otra respuesta suya)?
  if (response.contact_key) {
    const { data: prior } = await admin
      .from("validation_responses")
      .select(BENEFIT_COLS)
      .eq("contact_key", response.contact_key)
      .not("promo_code", "is", null)
      .limit(1)
      .maybeSingle();
    if (prior) {
      await admin
        .from("validation_responses")
        .update({
          contact_verified_at: verifiedAt,
          verified_channel: channel,
          benefit_status: "duplicate_contact",
        })
        .eq("id", response.id);
      return benefitFrom(prior as ResponseBenefitRow, now);
    }
  }

  // ¿Copió lo que acaba de contestar OTRA persona ya verificada? (granjas de premios): sin código, pero con camino.
  if (await copiedFromAnotherPerson(admin, response, now)) {
    const flags = [...new Set([...(response.quality_flags ?? []), "duplicate_text"])];
    await admin
      .from("validation_responses")
      .update({
        contact_verified_at: verifiedAt,
        verified_channel: channel,
        quality_flags: flags,
        benefit_status: "none",
      })
      .eq("id", response.id);
    return { state: "review", code: null, expiresAt: null };
  }

  const expiresAt = new Date(now + BENEFIT.validDays * 86_400_000).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeBenefitCode(deps);
    const { error } = await admin
      .from("validation_responses")
      .update({
        contact_verified_at: verifiedAt,
        verified_channel: channel,
        promo_code: code,
        benefit_status: "available",
        benefit_expires_at: expiresAt,
      })
      .eq("id", response.id);
    if (!error) return { state: "available", code, expiresAt, fresh: true };
    if (
      error.code === "23505" &&
      String(error.message).includes("uq_validation_benefit_contact") &&
      response.contact_key
    ) {
      // Dos verificaciones simultáneas del mismo contacto: gana la primera.
      const { data: prior } = await admin
        .from("validation_responses")
        .select(BENEFIT_COLS)
        .eq("contact_key", response.contact_key)
        .not("promo_code", "is", null)
        .limit(1)
        .maybeSingle();
      if (prior) return benefitFrom(prior as ResponseBenefitRow, now);
    }
    if (error.code !== "23505") break;
  }
  // Sin código no hay beneficio, pero el contacto queda verificado.
  await admin
    .from("validation_responses")
    .update({ contact_verified_at: verifiedAt, verified_channel: channel })
    .eq("id", response.id);
  return { state: "none", code: null, expiresAt: null };
}

export async function handleVerifyOtp(data: unknown, deps: MarketDeps): Promise<VerifyOtpResult> {
  const startedAt = Date.now();
  const p = verifySchema.safeParse(data);
  if (!p.success) return { ok: false, error: "validation" };
  const { admin, header, salt } = deps;
  if (!salt) return { ok: false, error: "server" };
  const now = (deps.now ?? Date.now)();

  try {
    const { data: r } = await admin
      .from("validation_responses")
      .select(BENEFIT_COLS)
      .eq("id", p.data.responseId)
      .maybeSingle();
    if (!r) return { ok: false, error: "not_found" };
    const response = r as ResponseBenefitRow;

    const userId = await userIdFromAuth(admin, header);
    const finish = async (b: {
      state: BenefitState;
      code: string | null;
      expiresAt: string | null;
    }): Promise<VerifyOtpResult> => {
      let redeemed: RedeemResult | null = null;
      if (userId && b.state === "available" && b.code) {
        redeemed = await redeem(admin, userId, b.code);
        if (redeemed.ok) {
          await admin
            .from("validation_responses")
            .update({ user_id: userId })
            .eq("id", response.id)
            .is("user_id", null);
        }
      }
      await logExec(admin, {
        fn: "market-validation-verify",
        status: "success",
        startedAt,
        metadata: { benefit: b.state, autoRedeemed: Boolean(redeemed?.ok) },
      });
      return { ok: true, benefit: b.state, promoCode: b.code, expiresAt: b.expiresAt, redeemed };
    };

    // Ya verificado: se devuelve el estado actual del beneficio (sirve si la persona recargó la página).
    if (response.contact_verified_at) return finish(benefitFrom(response, now));

    const { data: otp } = await admin
      .from("validation_otps")
      .select("id, code_hash, expires_at, verified_at, attempts, channel")
      .eq("response_id", response.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!otp) return { ok: false, error: "no_code" };
    if (otp.verified_at) return { ok: false, error: "invalid_code" };
    if (new Date(otp.expires_at as string).getTime() <= now) return { ok: false, error: "expired" };
    const attempts = Number(otp.attempts ?? 0);
    if (attempts >= LIMITS_SERVER.otpMaxAttempts) return { ok: false, error: "too_many_attempts" };

    // El intento se cuenta SIEMPRE y con control de concurrencia: sin esto, peticiones en paralelo adivinarían el código.
    const { data: bumped } = await admin
      .from("validation_otps")
      .update({ attempts: attempts + 1 })
      .eq("id", otp.id as string)
      .eq("attempts", attempts)
      .select("id");
    if (!bumped || bumped.length === 0) return { ok: false, error: "rate_limited" };

    const expected = await otpHash(salt, response.id, p.data.code);
    if (!timingSafeEqual(expected, String(otp.code_hash ?? ""))) {
      await logExec(admin, {
        fn: "market-validation-verify",
        status: "rejected",
        startedAt,
        errorCode: "invalid_code",
      });
      return {
        ok: false,
        error: "invalid_code",
        remaining: Math.max(0, LIMITS_SERVER.otpMaxAttempts - 1 - attempts),
      };
    }

    await admin
      .from("validation_otps")
      .update({ verified_at: new Date(now).toISOString() })
      .eq("id", otp.id as string);
    const issued = await issueBenefit(deps, response, otp.channel as ContactKind, now);
    if (issued.fresh && issued.state === "available") await notifyHotLead(admin, response.id, now);
    return finish(issued);
  } catch (e) {
    console.error("[verifyValidationOtp]", (e as Error).message);
    return { ok: false, error: "server" };
  }
}
