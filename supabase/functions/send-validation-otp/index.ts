// Genera y envía un OTP de 6 dígitos al contacto indicado (WhatsApp o email).
// Anonimo — no requiere sesión. Rate limit: 5 por contacto por hora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

const WA_TOKEN  = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE  = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = "Humanix <noreply@humanix.lat>";

function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskContact(contact: string): string {
  if (contact.includes("@")) {
    const [user, domain] = contact.split("@");
    return (user.slice(0, 2) || "**") + "***@" + domain;
  }
  const clean = contact.replace(/\D/g, "");
  if (clean.length >= 8) return clean.slice(0, 3) + "***" + clean.slice(-3);
  return clean.slice(0, 2) + "***";
}

async function sendWhatsapp(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!WA_TOKEN || !WA_PHONE) return { ok: false, error: "WhatsApp no configurado" };
  // Normalizar número: quitar espacios/guiones, asegurar código de país
  const clean = phone.replace(/\D/g, "");
  const number = clean.startsWith("57") ? clean : `57${clean}`;
  const body = `🔐 Tu código de verificación *Humanix* es:\n\n*${code}*\n\nVálido 15 minutos. No lo compartas con nadie.\n\nhumanix.lat`;
  const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: number, type: "text", text: { body } }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("[otp-wa]", res.status, txt);
    return { ok: false, error: `WhatsApp API ${res.status}` };
  }
  return { ok: true };
}

async function sendEmail(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_KEY) return { ok: false, error: "Email no configurado" };
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
<h2 style="color:#1e3a5f">Tu código de verificación Humanix</h2>
<div style="background:#f0f6ff;border-radius:16px;padding:32px;text-align:center;margin:20px 0">
  <p style="font-size:52px;font-weight:700;letter-spacing:10px;color:#1d4ed8;margin:0">${code}</p>
</div>
<p style="color:#374151">Este código es válido por <strong>15 minutos</strong>.</p>
<p style="color:#9ca3af;font-size:12px">Si no solicitaste esto, ignora este mensaje. · humanix.lat</p>
</body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: `Tu código Humanix: ${code}`, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("[otp-email]", res.status, txt);
    return { ok: false, error: `Email API ${res.status}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { contact, channel, response_id } = await req.json() as {
      contact: string; channel: "whatsapp" | "email"; response_id?: string;
    };

    if (!contact || !channel) return json({ error: "Faltan campos obligatorios" }, 400);
    if (!["whatsapp", "email"].includes(channel)) return json({ error: "Canal inválido" }, 400);

    // Rate limit: max 5 OTPs por contacto por hora
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin
      .from("validation_otps")
      .select("id", { count: "exact", head: true })
      .eq("contact", contact)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Demasiados intentos. Espera una hora." }, 429);

    const code = randomOtp();
    const expires_at = new Date(Date.now() + 15 * 60_000).toISOString();

    const { data: otp, error: insertErr } = await admin
      .from("validation_otps")
      .insert({ contact, channel, code, expires_at, response_id: response_id ?? null })
      .select("id")
      .single();
    if (insertErr || !otp) throw insertErr ?? new Error("No se pudo crear OTP");

    // Enviar por el canal indicado
    const sent = channel === "whatsapp"
      ? await sendWhatsapp(contact, code)
      : await sendEmail(contact, code);

    if (!sent.ok) {
      // Limpiar OTP inútil
      await admin.from("validation_otps").delete().eq("id", otp.id);
      return json({ error: sent.error ?? "No se pudo enviar" }, 502);
    }

    return json({ sent: true, otp_id: otp.id, masked: maskContact(contact) });
  } catch (e) {
    console.error("[send-validation-otp]", e);
    return json({ error: "Error interno" }, 500);
  }
});
