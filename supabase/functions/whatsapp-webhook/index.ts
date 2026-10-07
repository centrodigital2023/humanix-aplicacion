// WhatsApp Cloud API webhook — hiperconectado a la plataforma Humanix.
// GET = verificación Meta. POST = mensaje entrante + autorespuesta IA.
// verify_jwt = false: Meta llama sin token de Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const SITE_URL = "https://humanix.lat";

async function verifyMetaSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!APP_SECRET) {
    console.error("[wa] WHATSAPP_APP_SECRET no configurado: rechazando.");
    return false;
  }
  const header = req.headers.get("x-hub-signature-256");
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const got = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── INTENT DETECTION ────────────────────────────────────────────────────────

type Intent =
  | "pago" | "mis_citas" | "vitales" | "notas" | "buscar_pro"
  | "mi_plan" | "agendar" | "profesional" | "paciente"
  | "soporte" | "cancelar" | "confirmar" | "general";

function detectIntent(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (/^(si|sí|confirmo|confirmar|ok|dale|listo|claro|exacto|correcto)$/i.test(t)) return "confirmar";
  if (/^(no|cancelar|cancela|anular|salir|volver|atrás|atras)$/i.test(t)) return "cancelar";
  if (/pago|cobro|mercado\s?pago|factur|tarjet|precio.*plan|suscripci|cuanto\s+cuesta|valor.*mes/i.test(t)) return "pago";
  if (/mis\s+citas|mis\s+turnos|mis\s+visitas|tengo\s+cita|próxima\s+cita|ver\s+citas/i.test(t)) return "mis_citas";
  if (/signos?\s+vitales?|presión\s+arterial|temperatura\s+corporal|saturaci|glucosa|pulso|oximetría/i.test(t)) return "vitales";
  if (/notas?\s+de?\s+enferme|informe\s+de\s+visita|reporte\s+(médico|enfermería)|evolución\s+clínica/i.test(t)) return "notas";
  if (/busca[r]?\s+(una?|enferme|cuidad|fisio|médic)|necesito\s+(una?|enferme|cuidad)|quiero\s+contra/i.test(t)) return "buscar_pro";
  if (/mi\s+plan|mi\s+suscripci|créditos?\s+ia|saldo\s+ia|cuántos\s+crédito/i.test(t)) return "mi_plan";
  if (/agendar|cita|turno|visita|cuando|horario|disponibil|reservar/i.test(t)) return "agendar";
  if (/soy\s+enfermer|soy\s+médic|soy\s+profesional|trabajo\s+como\s+(enfermer|cuidad|fisio)|mi\s+perfil/i.test(t)) return "profesional";
  if (/mi\s+paciente|mi\s+familiar|necesito\s+cuidado/i.test(t)) return "paciente";
  if (/problem|error|no\s+funciona|ayuda|soporte|bug|fallo|no\s+puedo/i.test(t)) return "soporte";
  return "general";
}

// ─── BOOKING STATE MACHINE ────────────────────────────────────────────────────

type WaState = {
  flow?: "booking";
  step?: "type" | "city" | "date" | "confirm";
  service_type?: string;
  city?: string;
  date_hint?: string;
};

// ─── PLATFORM DATA QUERIES ────────────────────────────────────────────────────

async function getUpcomingBookings(userId: string, role: string): Promise<string> {
  try {
    const field = role === "professional" ? "professional_id" : "client_id";
    const { data } = await supabase
      .from("service_bookings")
      .select("id, scheduled_at, status, service_type")
      .eq(field, userId)
      .in("status", ["pending", "confirmed", "pending_assignment"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(5);

    if (!data?.length) {
      return `No tienes citas programadas próximamente.\n¿Quieres agendar? Responde *agendar*.`;
    }

    const lines = data.map((b) => {
      const dt = b.scheduled_at
        ? new Date(b.scheduled_at as string).toLocaleString("es-CO", {
            timeZone: "America/Bogota",
            dateStyle: "medium",
            timeStyle: "short",
          } as Intl.DateTimeFormatOptions)
        : "Fecha por confirmar";
      return `• ${dt} — ${(b.service_type as string) ?? "Servicio"} (${b.status})`;
    });

    return `📅 *Tus próximas citas:*\n\n${lines.join("\n")}\n\nDetalles: ${SITE_URL}/dashboard`;
  } catch (e) {
    console.error("[wa] getUpcomingBookings:", e);
    return `Ver tus citas en: ${SITE_URL}/dashboard`;
  }
}

async function getRecentVitals(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("vital_signs_readings")
      .select("reading_type, value, unit, severity, patient_label, recorded_at")
      .eq("recorded_by", userId)
      .order("recorded_at", { ascending: false })
      .limit(8);

    if (!data?.length) {
      return `No hay registros de signos vitales.\nAñádelos desde: ${SITE_URL}/dashboard`;
    }

    // Group by patient
    const grouped = new Map<string, typeof data>();
    for (const r of data) {
      const p = (r.patient_label as string) ?? "Paciente";
      if (!grouped.has(p)) grouped.set(p, []);
      grouped.get(p)!.push(r);
    }

    const sections: string[] = [];
    for (const [patient, readings] of grouped) {
      if (sections.length >= 2) break;
      const lines = readings.slice(0, 3).map((r) => {
        const dt = r.recorded_at
          ? new Date(r.recorded_at as string).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })
          : "";
        const sev = r.severity === "critical" ? "🔴" : r.severity === "warning" ? "🟡" : "🟢";
        return `  ${r.reading_type}: ${r.value} ${(r.unit as string) ?? ""} ${sev} (${dt})`;
      });
      sections.push(`*${patient}:*\n${lines.join("\n")}`);
    }

    return `📊 *Signos vitales recientes:*\n\n${sections.join("\n\n")}\n\nHistorial: ${SITE_URL}/dashboard`;
  } catch (e) {
    console.error("[wa] getRecentVitals:", e);
    return `Ver signos vitales en: ${SITE_URL}/dashboard`;
  }
}

async function getRecentNotes(userId: string, role: string): Promise<string> {
  try {
    const field = role === "professional" ? "professional_id" : "client_id";
    const { data } = await supabase
      .from("service_bookings")
      .select("notes, service_type, scheduled_at")
      .eq(field, userId)
      .eq("status", "completed")
      .not("notes", "is", null)
      .order("scheduled_at", { ascending: false })
      .limit(3);

    if (!data?.length) {
      return `No hay notas de enfermería recientes.\nVer panel: ${SITE_URL}/dashboard`;
    }

    const lines = data.map((b) => {
      const dt = b.scheduled_at
        ? new Date(b.scheduled_at as string).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })
        : "";
      const note = String(b.notes).slice(0, 120);
      return `📋 *${(b.service_type as string) ?? "Servicio"} (${dt}):*\n${note}${String(b.notes).length > 120 ? "…" : ""}`;
    });

    return `${lines.join("\n\n")}\n\nVer todas las notas: ${SITE_URL}/dashboard`;
  } catch (e) {
    console.error("[wa] getRecentNotes:", e);
    return `Ver notas de enfermería en: ${SITE_URL}/dashboard`;
  }
}

async function searchProfessionals(specialty?: string, city?: string): Promise<string> {
  try {
    // deno-lint-ignore no-explicit-any
    let query: any = supabase
      .from("professional_profiles")
      .select("user_id, full_name, specialty, city, hourly_rate, verified")
      .eq("active", true)
      .eq("verified", true);

    if (city) query = query.ilike("city", `%${city}%`);
    if (specialty) query = query.ilike("specialty", `%${specialty}%`);

    const { data } = await query.limit(3);

    if (!data?.length) {
      return `No encontramos profesionales${specialty ? ` de ${specialty}` : ""}${city ? ` en ${city}` : ""} en este momento.\n\nBusca más opciones: ${SITE_URL}/buscar`;
    }

    const lines = data.map((p: Record<string, unknown>) => {
      const rate = Number(p.hourly_rate) > 0
        ? ` · desde $${Number(p.hourly_rate).toLocaleString("es-CO")}/hr`
        : "";
      return `👩‍⚕️ *${p.full_name}* — ${(p.specialty as string) ?? "Salud"}${rate}\n   ${SITE_URL}/profesional/${p.user_id}`;
    });

    return `Profesionales verificados:\n\n${lines.join("\n\n")}\n\nVer más: ${SITE_URL}/buscar`;
  } catch (e) {
    console.error("[wa] searchProfessionals:", e);
    return `Busca profesionales en: ${SITE_URL}/buscar`;
  }
}

async function getMyPlan(userId: string): Promise<string> {
  try {
    const [{ data: planRow }, { data: credRow }] = await Promise.all([
      supabase
        .from("mp_subscriptions")
        .select("plan, status, current_period_end")
        .eq("user_id", userId)
        .maybeSingle(),
      // deno-lint-ignore no-explicit-any
      (supabase as any)
        .rpc("get_total_ai_credits_balance", { p_user_id: userId })
        .single(),
    ]);

    const plan = planRow?.status === "active" ? (planRow.plan as string) : "free";
    const planLabel: Record<string, string> = {
      free: "Free",
      essential_monthly: "Essential",
      pro_monthly: "Pro",
      institution_monthly: "Institución",
    };
    const credits = (credRow as Record<string, number> | null)?.balance ?? 0;
    let msg = `📋 *Tu plan Humanix:* ${planLabel[plan] ?? plan}`;
    if (planRow?.current_period_end && planRow.status === "active") {
      const renewal = new Date(planRow.current_period_end as string).toLocaleDateString("es-CO");
      msg += `\n🔄 Próxima renovación: ${renewal}`;
    }
    msg += `\n🤖 Créditos IA disponibles: ${credits}`;
    if (credits < 10) msg += " (bajo — recarga en humanix.lat/creditos)";
    msg += `\n\nDetalles: ${SITE_URL}/planes`;
    return msg;
  } catch (e) {
    console.error("[wa] getMyPlan:", e);
    return `Consulta tu plan en: ${SITE_URL}/planes`;
  }
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────

type UserContext = {
  role?: string;
  name?: string;
  plan?: string;
  linkedUserId?: string;
};

async function callAI(userText: string, systemPrompt: string): Promise<string> {
  if (!LOVABLE_API_KEY) {
    return "¡Hola! Recibimos tu mensaje. Un asesor Humanix te responderá en breve. Visita humanix.lat 🚀";
  }
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        max_tokens: 200,
        temperature: 0.6,
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const json = await res.json();
    return (
      json?.choices?.[0]?.message?.content?.trim() ??
      "¡Hola! Recibimos tu mensaje, te respondemos pronto."
    );
  } catch (e) {
    console.warn("[wa] AI fallback:", e);
    return "¡Hola! Recibimos tu mensaje. Un asesor te contactará pronto. humanix.lat 🚀";
  }
}

// ─── MAIN MESSAGE PROCESSOR ───────────────────────────────────────────────────

async function processMessage(
  text: string,
  ctx: UserContext,
  waState: WaState,
): Promise<{ reply: string; newState: WaState }> {
  const intent = detectIntent(text);

  // Reset stale state (older than 30 min = treat as idle)
  // The caller passes waState already reset if stale.

  // ── Active booking flow ──────────────────────────────────────────────────

  if (waState.flow === "booking") {
    // Cancel at any step
    if (intent === "cancelar" || /cancelar|salir|no\s+quiero|olvida/i.test(text.toLowerCase())) {
      return { reply: "De acuerdo, cancelé la solicitud. ¿En qué más te puedo ayudar?", newState: {} };
    }

    if (waState.step === "type") {
      const service_type = text.trim().slice(0, 60);
      return {
        reply: `Perfecto, *${service_type}*.\n\n¿En qué ciudad necesitas el servicio?`,
        newState: { flow: "booking", step: "city", service_type },
      };
    }

    if (waState.step === "city") {
      const city = text.trim().slice(0, 40);
      return {
        reply: `Anotado, *${city}*.\n\n¿Para qué fecha lo necesitas?\nEjemplo: _mañana_, _el lunes_, _el 15 de octubre_.`,
        newState: { ...waState, step: "date", city },
      };
    }

    if (waState.step === "date") {
      const date_hint = text.trim().slice(0, 60);
      return {
        reply:
          `Confirma tu solicitud:\n\n` +
          `📋 Servicio: *${waState.service_type}*\n` +
          `📍 Ciudad: *${waState.city}*\n` +
          `📅 Fecha preferida: *${date_hint}*\n\n` +
          `Responde *sí* para enviar o *no* para cancelar.`,
        newState: { ...waState, step: "confirm", date_hint },
      };
    }

    if (waState.step === "confirm") {
      if (intent === "confirmar") {
        if (ctx.linkedUserId) {
          try {
            await supabase.from("service_bookings").insert({
              client_id: ctx.linkedUserId,
              service_type: waState.service_type,
              status: "pending_assignment",
              notes: `Solicitud desde WhatsApp. Ciudad: ${waState.city ?? "no especificada"}. Fecha preferida: ${waState.date_hint ?? "no especificada"}.`,
            });
          } catch (err) {
            console.warn("[wa] booking insert:", err);
          }
        }
        return {
          reply:
            `✅ ¡Solicitud enviada!\n\n` +
            `Un profesional de *${waState.service_type}* en *${waState.city}* te contactará en menos de 2 horas.\n\n` +
            `Seguimiento: ${SITE_URL}/dashboard`,
          newState: {},
        };
      }
      return { reply: "De acuerdo, cancelé la solicitud. ¿En qué más te puedo ayudar?", newState: {} };
    }
  }

  // ── Respuestas directas (sin IA, latencia cero) ──────────────────────────

  if (intent === "pago") {
    return {
      reply:
        `Para ver planes y realizar tu pago:\n${SITE_URL}/planes\n\nTodos los pagos se hacen en la página: tarjeta, PSE, Nequi, Daviplata. ¿En qué más te ayudo?`,
      newState: {},
    };
  }

  if (intent === "agendar") {
    return {
      reply: `¿Qué tipo de servicio necesitas?\n\nEjemplos:\n• Enfermería domiciliaria\n• Cuidador adulto mayor\n• Fisioterapia\n• Cuidado postoperatorio\n\n(O escribe _cancelar_ para salir)`,
      newState: { flow: "booking", step: "type" },
    };
  }

  // Intents que usan datos de la plataforma (requieren usuario vinculado)

  if (intent === "mis_citas") {
    if (ctx.linkedUserId && ctx.role) {
      return { reply: await getUpcomingBookings(ctx.linkedUserId, ctx.role), newState: {} };
    }
    return { reply: `Para ver tus citas inicia sesión en: ${SITE_URL}/dashboard`, newState: {} };
  }

  if (intent === "vitales") {
    if (ctx.linkedUserId) {
      return { reply: await getRecentVitals(ctx.linkedUserId), newState: {} };
    }
    return { reply: `Los signos vitales están en tu panel: ${SITE_URL}/dashboard`, newState: {} };
  }

  if (intent === "notas") {
    if (ctx.linkedUserId && ctx.role) {
      return { reply: await getRecentNotes(ctx.linkedUserId, ctx.role), newState: {} };
    }
    return { reply: `Las notas de enfermería están en tu panel: ${SITE_URL}/dashboard`, newState: {} };
  }

  if (intent === "buscar_pro") {
    const cityMatch = text.match(/en\s+([A-Za-záéíóúÁÉÍÓÚñÑ\s]{3,25})(?:\.|,|$)/i);
    const city = cityMatch?.[1]?.trim();
    return { reply: await searchProfessionals(undefined, city), newState: {} };
  }

  if (intent === "mi_plan") {
    if (ctx.linkedUserId) {
      return { reply: await getMyPlan(ctx.linkedUserId), newState: {} };
    }
    return { reply: `Consulta tu plan en: ${SITE_URL}/planes`, newState: {} };
  }

  // ── IA contextual (intents generales) ───────────────────────────────────

  let systemPrompt =
    "Eres el asistente de WhatsApp de Humanix, plataforma colombiana de talento humano en salud. " +
    "Responde en español, cálido, profesional y muy conciso. Máximo 3 frases cortas. Sin markdown. " +
    "Nunca proceses pagos por WhatsApp: no envíes enlaces de pago, números de cuenta, Nequi ni Daviplata. " +
    "Para cualquier pago dirige únicamente a humanix.lat/planes.";

  if (ctx.role === "professional") {
    systemPrompt += ` El usuario es un profesional de salud de Humanix.`;
    if (ctx.plan && ctx.plan !== "free") systemPrompt += ` Su plan activo es ${ctx.plan}.`;
  } else if (ctx.role === "family") {
    systemPrompt += " El usuario busca servicios de salud para un familiar.";
  } else if (ctx.role === "institution") {
    systemPrompt += " El usuario representa una institución de salud.";
  }

  if (intent === "soporte") {
    systemPrompt += " El usuario tiene un problema técnico. Sé empático, pide detalles.";
  } else if (intent === "profesional") {
    systemPrompt += ` El usuario quiere publicar su perfil. Indícale que lo puede crear en ${SITE_URL}.`;
  }

  return { reply: guardPayments(await callAI(text, systemPrompt)), newState: {} };
}

// Los pagos se hacen solo en la página web. Si la IA llegara a mencionar un medio de pago
// fuera de la web, se reemplaza la respuesta por la redirección segura.
const PAYMENT_LEAK =
  /mercadopago|mpago\.la|init_point|checkout|transfiere|transferencia|consigna|n[uú]mero de cuenta|cuenta de ahorros|cuenta corriente|nequi\s*[:=]?\s*\d|daviplata\s*[:=]?\s*\d|llave\s+bre-?b|paga\s+(aqu[ií]|por\s+whatsapp)/i;

function guardPayments(reply: string): string {
  if (PAYMENT_LEAK.test(reply)) {
    return `Los pagos se realizan únicamente en la página: ${SITE_URL}/planes. ¿En qué más te ayudo?`;
  }
  return reply;
}

// ─── SEND WHATSAPP ────────────────────────────────────────────────────────────

async function sendWhatsApp(to: string, text: string): Promise<string | null> {
  if (!ACCESS_TOKEN || !PHONE_ID) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      console.error("[wa send]", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    return (json as Record<string, unknown[]>)?.messages?.[0] as string | null ?? null;
  } catch (e) {
    console.error("[wa send] failed:", e);
    return null;
  }
}

// ─── DENO SERVE ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      const ok = await verifyMetaSignature(req, rawBody);
      if (!ok) {
        console.warn("[wa] firma inválida");
        return new Response("invalid signature", { status: 401, headers: corsHeaders });
      }
      const body = JSON.parse(rawBody);

      for (const entry of body?.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const waContacts = value.contacts ?? [];
          for (const msg of value.messages ?? []) {
            const from = String(msg.from ?? "");
            const text = (msg.text?.body as string) ?? "[mensaje no textual]";
            const contactName = (waContacts[0] as Record<string, Record<string, string>>)?.profile?.name ?? null;
            if (!from) continue;

            // Owner CRM staff
            const { data: roleRow } = await supabase
              .from("user_roles")
              .select("user_id")
              .in("role", ["superadmin", "hr_staff"])
              .order("created_at")
              .limit(1)
              .maybeSingle();
            const ownerId = roleRow?.user_id;
            if (!ownerId) continue;

            // Load existing contact (state + ai_enabled + linked user)
            let existingState: WaState = {};
            let aiEnabled = true;
            let userCtx: UserContext = {};

            try {
              const { data: prev } = await supabase
                .from("whatsapp_contacts")
                .select("wa_state, ai_enabled, linked_user_id, wa_state_updated_at")
                .eq("owner_id", ownerId)
                .eq("phone", from)
                .maybeSingle();

              if (prev) {
                // Reset stale state (> 30 min)
                const stateAge = prev.wa_state_updated_at
                  ? Date.now() - new Date(prev.wa_state_updated_at as string).getTime()
                  : Infinity;
                existingState =
                  stateAge < 30 * 60 * 1000 ? ((prev.wa_state as WaState) ?? {}) : {};

                aiEnabled = (prev.ai_enabled as boolean) !== false;

                const linkedId = prev.linked_user_id as string | null;
                if (linkedId) {
                  const [{ data: r2 }, { data: planRow }] = await Promise.all([
                    supabase.from("user_roles").select("role").eq("user_id", linkedId).limit(1).maybeSingle(),
                    supabase.from("mp_subscriptions").select("plan, status").eq("user_id", linkedId).maybeSingle(),
                  ]);
                  userCtx = {
                    role: r2?.role as string | undefined,
                    linkedUserId: linkedId,
                    plan: planRow?.status === "active" ? (planRow.plan as string) : "free",
                  };
                }
              }
            } catch { /* context optional */ }

            // Upsert contact (wa_state not overwritten — not in upsert payload)
            const { data: contact } = await supabase
              .from("whatsapp_contacts")
              .upsert(
                {
                  owner_id: ownerId,
                  phone: from,
                  display_name: contactName,
                  last_message_at: new Date().toISOString(),
                  last_message_preview: text.slice(0, 120),
                },
                { onConflict: "owner_id,phone" },
              )
              .select()
              .single();

            if (!contact) continue;

            await supabase
              .from("whatsapp_contacts")
              .update({ unread_count: ((contact.unread_count as number) ?? 0) + 1 })
              .eq("id", contact.id);

            await supabase.from("whatsapp_messages").insert({
              contact_id: contact.id,
              direction: "in",
              body: text,
              wa_message_id: (msg.id as string) ?? null,
            });

            // Skip AI if disabled for this contact (human agent handles)
            if (!aiEnabled) {
              console.log(`[wa] ai_enabled=false para ${from}, dejado para agente humano`);
              continue;
            }

            const { reply, newState } = await processMessage(text, userCtx, existingState);

            // Persist conversation state
            try {
              await supabase
                .from("whatsapp_contacts")
                .update({ wa_state: newState, wa_state_updated_at: new Date().toISOString() })
                .eq("id", contact.id);
            } catch { /* non-fatal */ }

            const waId = await sendWhatsApp(from, reply);

            await supabase.from("whatsapp_messages").insert({
              contact_id: contact.id,
              direction: "out",
              body: reply,
              is_ai: true,
              wa_message_id: waId,
            });

            await supabase
              .from("whatsapp_contacts")
              .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: reply.slice(0, 120),
              })
              .eq("id", contact.id);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("[wa webhook]", e);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
