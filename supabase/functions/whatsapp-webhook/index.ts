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

async function aiReply(userText: string): Promise<string> {
  if (!LOVABLE_API_KEY)
    return "¡Hola! Hemos recibido tu mensaje. Un asesor Humanix te responderá en breve.";
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
          {
            role: "system",
            content:
              "Eres el asistente WhatsApp de Humanix, plataforma colombiana de talento humano en salud. Responde breve, cálido, profesional, en español. Si preguntan por contratar, sugiere que entren a humanix.lat. Máximo 2 frases.",
          },
          { role: "user", content: userText },
        ],
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
    return "¡Hola! Recibimos tu mensaje, te respondemos pronto.";
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

            // Autorespuesta IA
            const reply = await aiReply(text);
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
