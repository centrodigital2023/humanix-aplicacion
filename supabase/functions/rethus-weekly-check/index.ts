// Re-verificación semanal automatizada de certificados RETHUS.
//
// No existe una API pública confiable de SISPRO/RETHUS, así que en lugar de
// un scraper frágil reusamos el mismo mecanismo de verificación por IA que ya
// usa document-verifier (Lovable AI Gateway · Gemini 2.5 Pro, mismo prompt y
// herramienta de verificación): le volvemos a pasar el certificado RETHUS ya
// aprobado de cada profesional para detectar si quedó vencido, ilegible o ya
// no es válido — sin esperar a que alguien lo reporte.
//
// Disparado semanalmente por pg_cron + pg_net (ver migración
// 20260606200000_rethus_periodic_reverification.sql) con un secreto compartido
// (X-Rethus-Cron-Secret), igual que wearable-ingest.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

const CRON_SECRET = Deno.env.get("RETHUS_CRON_SECRET") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const RECHECK_INTERVAL_DAYS = 180;
const BATCH_SIZE = 25;
const MIN_CONFIDENCE = 60;

const VERIFY_TOOL = {
  type: "function",
  function: {
    name: "verify_document",
    description: "Verifica si el certificado RETHUS sigue siendo válido y vigente.",
    parameters: {
      type: "object",
      properties: {
        is_valid: {
          type: "boolean",
          description: "true si el documento sigue siendo auténtico, legible y vigente.",
        },
        confidence: {
          type: "number",
          description: "0-100, qué tan seguro está el modelo de su veredicto.",
        },
        issues: { type: "array", items: { type: "string" } },
        reason: {
          type: "string",
          description: "Resumen breve (1-2 frases) en español del veredicto.",
        },
      },
      required: ["is_valid", "confidence", "issues", "reason"],
      additionalProperties: false,
    },
  },
} as const;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizePhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return clean.startsWith("57") ? clean : `57${clean}`;
}

async function sendWa(phone: string, body: string): Promise<boolean> {
  if (!WA_TOKEN || !WA_PHONE_ID) return false;
  const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(phone),
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) console.error("[rethus-weekly-check] WA error:", res.status, await res.text());
  return res.ok;
}

interface Verdict {
  is_valid: boolean;
  confidence: number;
  issues: string[];
  reason: string;
}

async function reverifyDocument(fileUrl: string): Promise<Verdict | null> {
  const headResp = await fetch(fileUrl, { method: "HEAD", redirect: "error" });
  if (!headResp.ok) return null;
  const mt = headResp.headers.get("content-type") || "application/pdf";

  let userContent: unknown;
  if (mt.startsWith("image/")) {
    userContent = [
      { type: "text", text: "Verifica si este certificado RETHUS sigue siendo válido y vigente." },
      { type: "image_url", image_url: { url: fileUrl } },
    ];
  } else {
    const fileResp = await fetch(fileUrl, { redirect: "error" });
    if (!fileResp.ok) return null;
    const buf = new Uint8Array(await fileResp.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK)
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    const dataUrl = `data:${mt};base64,${btoa(bin)}`;
    userContent = [
      {
        type: "text",
        text: "Verifica si este certificado RETHUS (PDF) sigue siendo válido y vigente.",
      },
      { type: "file", file: { filename: "rethus.pdf", file_data: dataUrl } },
    ];
  }

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        {
          role: "system",
          content:
            "Eres un verificador estricto de certificados RETHUS (Registro Único Nacional del Talento Humano " +
            "en Salud, Colombia) para una plataforma de salud. Esta es una RE-verificación periódica de un " +
            "documento que ya fue aprobado antes: marca is_valid=false si detectas fecha vencida, datos " +
            "inconsistentes, señales de manipulación, o si el documento ya no es legible. Sé exigente.",
        },
        { role: "user", content: userContent },
      ],
      tools: [VERIFY_TOOL],
      tool_choice: { type: "function", function: { name: "verify_document" } },
    }),
  });

  if (!resp.ok) {
    console.error("[rethus-weekly-check] Gateway error:", resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    return JSON.parse(args) as Verdict;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (
    !CRON_SECRET ||
    !timingSafeEqual(req.headers.get("x-rethus-cron-secret") ?? "", CRON_SECRET)
  ) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cutoff = new Date(Date.now() - RECHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: due, error: dueError } = await supabase
      .from("professional_profiles")
      .select("user_id, rethus_verified_at")
      .eq("rethus_verified", true)
      .or(`rethus_verified_at.is.null,rethus_verified_at.lt.${cutoff}`)
      .limit(BATCH_SIZE);

    if (dueError) throw dueError;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, checked: 0, renewed: 0, flagged: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let renewed = 0;
    let flagged = 0;

    for (const pro of due) {
      const { data: doc } = await supabase
        .from("professional_documents")
        .select("id, file_url")
        .eq("user_id", pro.user_id)
        .eq("doc_type", "rethus")
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (!doc?.file_url) {
        await supabase.from("rethus_checks").insert({
          professional_id: pro.user_id,
          previous_verified: true,
          new_verified: false,
          action: "no_document",
        });
        await supabase
          .from("professional_profiles")
          .update({ rethus_verified: false })
          .eq("user_id", pro.user_id);
        flagged++;
        continue;
      }

      const verdict = await reverifyDocument(doc.file_url);
      const isValid = !!verdict && verdict.is_valid && verdict.confidence >= MIN_CONFIDENCE;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("user_id", pro.user_id)
        .maybeSingle();

      let notified = false;
      if (isValid) {
        await supabase
          .from("professional_profiles")
          .update({ rethus_verified_at: new Date().toISOString() })
          .eq("user_id", pro.user_id);
        renewed++;
      } else {
        await supabase
          .from("professional_profiles")
          .update({ rethus_verified: false })
          .eq("user_id", pro.user_id);

        if (profile?.phone) {
          notified = await sendWa(
            profile.phone,
            `🔔 HUMANIX · RETHUS\n\n` +
              `Hola ${profile.full_name ?? ""}, en nuestra revisión periódica no pudimos confirmar que tu ` +
              `certificado RETHUS siga vigente${verdict?.reason ? ` (${verdict.reason})` : ""}.\n\n` +
              `Tu insignia de "verificado" quedó pausada. Sube un certificado actualizado desde tu panel ` +
              `(Documentos → RETHUS) para restaurarla:\nhttps://humanix.lat/dashboard/profesional`,
          );
        }
        flagged++;
      }

      await supabase.from("rethus_checks").insert({
        professional_id: pro.user_id,
        document_id: doc.id,
        previous_verified: true,
        new_verified: isValid,
        ai_score: verdict?.confidence ?? null,
        ai_notes: verdict?.reason ?? null,
        action: isValid ? "renewed" : "renewal_requested",
        notified_whatsapp: notified,
      });
    }

    return new Response(JSON.stringify({ ok: true, checked: due.length, renewed, flagged }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[rethus-weekly-check]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
