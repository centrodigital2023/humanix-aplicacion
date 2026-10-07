// Webhook entrante de WhatsApp Cloud API + autorespuesta IA.
// GET = verificación de Meta. POST = mensaje entrante.
// Pública (verify_jwt = false) porque Meta llama sin token de Supabase.
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

// Valida la firma HMAC-SHA256 que Meta envía en X-Hub-Signature-256.
// Si WHATSAPP_APP_SECRET no está configurado, omite la validación (modo dev).
async function verifyMetaSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!APP_SECRET) {
    console.error(
      "[wa] WHATSAPP_APP_SECRET no está configurado: rechazando webhook (fail-closed).",
    );
    return false;
  }
  const header = req.headers.get("x-hub-signature-256");
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const got = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Comparación constant-time
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Detecta la intención del mensaje para responder con más precisión
function detectIntent(text: string): "pago" | "agendar" | "profesional" | "paciente" | "soporte" | "general" {
  const t = text.toLowerCase();
  if (/pago|cobro|mercado\s?pago|factur|tarjet|precio|plan|suscripci|crédito|cuanto|valor/i.test(t)) return "pago";
  if (/agendar|cita|turno|visita|cuando|horario|disponibil|reservar/i.test(t)) return "agendar";
  if (/soy\s+enfermer|soy\s+médico|soy\s+profesional|trabajo como|mi\s+perfil|publicar\s+perfil/i.test(t)) return "profesional";
  if (/mi\s+paciente|mi\s+familiar|cuidador|enfermero|busco\s+una?|contratar|necesito\s+una?/i.test(t)) return "paciente";
  if (/problem|error|no\s+funciona|ayuda|soporte|bug|fallo/i.test(t)) return "soporte";
  return "general";
}

type UserContext = {
  role?: string;
  name?: string;
  plan?: string;
  linkedUserId?: string;
};

async function aiReply(userText: string, ctx?: UserContext): Promise<string> {
  const intent = detectIntent(userText);

  // Respuestas directas para intenciones claras (sin llamar a la IA)
  if (intent === "pago") {
    return `Hola 👋 Para ver planes, precios y realizar tu pago entra a: https://humanix.lat/planes\n\nTodos los pagos se hacen directamente en la página de forma segura. ¿Te puedo ayudar con algo más?`;
  }
  if (intent === "agendar") {
    return `📅 Para agendar un servicio, entra a tu panel en humanix.lat e indica disponibilidad. Si ya tienes una cita, puedes verla en el tab Agenda. ¿En qué más te ayudo?`;
  }

  if (!LOVABLE_API_KEY) {
    return "¡Hola! Hemos recibido tu mensaje. Un asesor Humanix te responderá en breve. También puedes visitar humanix.lat";
  }

  // Construir contexto del sistema según el rol del usuario
  let systemContext = "Eres el asistente de WhatsApp de Humanix, plataforma colombiana de talento humano en salud. Responde en español, cálido, profesional y directo. Máximo 3 frases. No uses markdown. Al final, siempre ofrece ayuda adicional.";

  if (ctx?.role === "professional") {
    systemContext += " El usuario es un profesional de salud registrado en Humanix.";
    if (ctx.plan && ctx.plan !== "free") systemContext += ` Su plan activo es ${ctx.plan}.`;
  } else if (ctx?.role === "family" || intent === "paciente") {
    systemContext += " El usuario busca servicios de salud para un familiar. Sugiérele que explore perfiles verificados en humanix.lat.";
  } else if (ctx?.role === "institution") {
    systemContext += " El usuario representa una institución de salud. Si pregunta por planes institucionales, dirígelo a humanix.lat/planes.";
  }

  if (intent === "soporte") {
    systemContext += " El usuario tiene un problema técnico. Sé empático, pide detalles específicos y ofrece soporte vía humanix.lat o WhatsApp con un agente humano.";
  } else if (intent === "profesional") {
    systemContext += " El usuario quiere publicar su perfil profesional. Explícale que puede crear su perfil en humanix.lat y que la verificación RETHUS es gratis.";
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
          { role: "system", content: systemContext },
          { role: "user", content: userText },
        ],
        max_tokens: 180,
        temperature: 0.6,
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const json = await res.json();
    return (
      json?.choices?.[0]?.message?.content?.trim() ||
      "¡Hola! Recibimos tu mensaje, te respondemos pronto."
    );
  } catch (e) {
    console.warn("[wa] AI fallback:", e);
    return "¡Hola! Recibimos tu mensaje. Un asesor te contactará pronto. También puedes visitar humanix.lat 🚀";
  }
}

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
    return json?.messages?.[0]?.id ?? null;
  } catch (e) {
    console.error("[wa send] failed:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  // Verificación de webhook (GET de Meta)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // Mensaje entrante
  if (req.method === "POST") {
    try {
      const rawBody = await req.text();
      const ok = await verifyMetaSignature(req, rawBody);
      if (!ok) {
        console.warn("[wa] firma inválida, rechazando");
        return new Response("invalid signature", { status: 401, headers: corsHeaders });
      }
      const body = JSON.parse(rawBody);
      const entries = body?.entry ?? [];
      for (const entry of entries) {
        const changes = entry.changes ?? [];
        for (const change of changes) {
          const value = change.value ?? {};
          const messages = value.messages ?? [];
          const contacts = value.contacts ?? [];
          for (const msg of messages) {
            const from = String(msg.from ?? "");
            const text = msg.text?.body ?? "[mensaje no textual]";
            const contactName = contacts[0]?.profile?.name ?? null;
            if (!from) continue;

            // Buscar primer superadmin/hr_staff como dueño "global" del CRM
            const { data: roleRow } = await supabase
              .from("user_roles")
              .select("user_id")
              .in("role", ["superadmin", "hr_staff"])
              .order("created_at")
              .limit(1)
              .maybeSingle();
            const ownerId = roleRow?.user_id;
            if (!ownerId) {
              console.warn("[wa] sin owner staff registrado, mensaje descartado");
              continue;
            }

            // Buscar si este número está vinculado a un usuario registrado (para contexto IA)
            let userCtx: UserContext | undefined;
            try {
              const { data: linkedContact } = await supabase
                .from("whatsapp_contacts")
                .select("linked_user_id")
                .eq("phone", from)
                .maybeSingle();
              if (linkedContact?.linked_user_id) {
                const { data: roleRow2 } = await supabase
                  .from("user_roles")
                  .select("role")
                  .eq("user_id", linkedContact.linked_user_id)
                  .order("created_at")
                  .limit(1)
                  .maybeSingle();
                const { data: planRow } = await supabase
                  .from("mp_subscriptions")
                  .select("plan, status")
                  .eq("user_id", linkedContact.linked_user_id)
                  .maybeSingle();
                userCtx = {
                  role: roleRow2?.role,
                  linkedUserId: linkedContact.linked_user_id,
                  plan: planRow?.status === "active" ? planRow.plan : "free",
                };
              }
            } catch { /* context optional — don't fail the main flow */ }

            // Upsert contacto
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

            // Incrementar unread + insertar mensaje entrante
            await supabase
              .from("whatsapp_contacts")
              .update({ unread_count: (contact.unread_count ?? 0) + 1 })
              .eq("id", contact.id);

            await supabase.from("whatsapp_messages").insert({
              contact_id: contact.id,
              direction: "in",
              body: text,
              wa_message_id: msg.id ?? null,
            });

            // Autorespuesta IA con contexto enriquecido
            const reply = await aiReply(text, userCtx);
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
