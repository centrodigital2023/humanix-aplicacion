// Enviar mensaje manual desde el CRM (requiere usuario autenticado dueño del contacto).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { contact_id, body } = await req.json();
    if (!contact_id || !body) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: contact, error: contactErr } = await supabase
      .from("whatsapp_contacts")
      .select("id, phone, owner_id")
      .eq("id", contact_id)
      .maybeSingle();
    if (contactErr || !contact) {
      return new Response(JSON.stringify({ error: "contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (contact.owner_id !== user.id) {
      // staff puede; valida is_staff
      const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: user.id });
      if (!isStaff) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let waId: string | null = null;
    if (ACCESS_TOKEN && PHONE_ID) {
      const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: contact.phone,
          type: "text",
          text: { body },
        }),
      });
      if (!res.ok) {
        const errTxt = await res.text();
        console.error("[wa send manual]", res.status, errTxt);
        return new Response(
          JSON.stringify({ error: `WhatsApp API ${res.status}`, detail: errTxt }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const json = await res.json();
      waId = json?.messages?.[0]?.id ?? null;
    }

    await supabase.from("whatsapp_messages").insert({
      contact_id: contact.id,
      direction: "out",
      body,
      is_ai: false,
      wa_message_id: waId,
    });
    await supabase
      .from("whatsapp_contacts")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 120),
      })
      .eq("id", contact.id);

    return new Response(JSON.stringify({ ok: true, wa_message_id: waId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[wa send]", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
