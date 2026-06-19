// Document Verifier — usa IA multimodal para verificar autenticidad y coincidencia
// del tipo de documento subido por un profesional.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const ALLOWED_MIME_PREFIXES = ["application/pdf", "image/"];
const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

const TOOL = {
  type: "function",
  function: {
    name: "verify_document",
    description:
      "Verifica si el documento corresponde al tipo declarado y si parece auténtico (sin signos de manipulación o información incoherente).",
    parameters: {
      type: "object",
      properties: {
        is_valid: {
          type: "boolean",
          description: "true si el documento es real, legible y coincide con el tipo declarado.",
        },
        document_type_detected: {
          type: "string",
          description:
            "Qué tipo de documento detectó la IA (cv, rethus, diploma, cedula, recibo_servicios, referencia_laboral, otro).",
        },
        confidence: {
          type: "number",
          description: "0-100, qué tan seguro está el modelo de su veredicto.",
        },
        issues: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista de problemas detectados (ej: 'documento ilegible', 'fecha vencida', 'tipo no coincide', 'parece editado').",
        },
        extracted: {
          type: "object",
          description:
            "Datos clave extraídos del documento. Ej: { name, document_number, issue_date, issuer, address, account_number }.",
          additionalProperties: true,
        },
        reason: {
          type: "string",
          description:
            "Resumen breve (1-2 frases) explicando el veredicto, en español, dirigido al profesional.",
        },
      },
      required: ["is_valid", "confidence", "issues", "reason"],
      additionalProperties: false,
    },
  },
} as const;

const TYPE_HINTS: Record<string, string> = {
  cv: "Hoja de vida (CV). Debe listar formación, experiencia y datos de contacto.",
  rethus:
    "Certificado RETHUS (Registro Único Nacional del Talento Humano en Salud, Colombia). Debe contener nombre, número de registro, profesión y fecha.",
  diploma: "Diploma o certificación profesional/de curso (BLS, ACLS, título universitario, etc.).",
  id_document:
    "Cédula de ciudadanía colombiana (frente o reverso). Debe verse el nombre, número y foto.",
  utility_bill:
    "Recibo de servicios públicos (luz, agua, gas, internet) reciente — máximo 60 días — donde aparezca dirección y nombre.",
  work_reference:
    "Carta de referencia laboral firmada con nombre del referente, cargo, empresa, contacto y descripción del desempeño.",
  family_reference:
    "Carta o constancia de referencia familiar/personal con nombre, contacto y relación.",
  other: "Documento profesional genérico.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { file_url, mime_type, doc_type } = await req.json();
    if (!file_url || typeof file_url !== "string") {
      return new Response(JSON.stringify({ error: "file_url requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!doc_type || typeof doc_type !== "string") {
      return new Response(JSON.stringify({ error: "doc_type requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL no configurada");
    let parsed: URL;
    try {
      parsed = new URL(file_url);
    } catch {
      return new Response(JSON.stringify({ error: "URL inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== new URL(supabaseUrl).hostname) {
      return new Response(JSON.stringify({ error: "URL no permitida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let headResp: Response;
    try {
      headResp = await fetch(file_url, { method: "HEAD", signal: ctrl.signal, redirect: "error" });
    } finally {
      clearTimeout(timer);
    }
    if (!headResp.ok) throw new Error("No se pudo acceder al archivo");

    const mt = mime_type || headResp.headers.get("content-type") || "application/pdf";
    if (!ALLOWED_MIME_PREFIXES.some((p) => mt.startsWith(p))) {
      return new Response(JSON.stringify({ error: "Tipo de archivo no permitido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sizeHeader = headResp.headers.get("content-length");
    if (sizeHeader && Number(sizeHeader) > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Archivo demasiado grande (máx 15MB)" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userContent: unknown;
    if (mt.startsWith("image/")) {
      userContent = [
        { type: "text", text: `Verifica este documento. Tipo declarado: ${doc_type}.` },
        { type: "image_url", image_url: { url: file_url } },
      ];
    } else {
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), FETCH_TIMEOUT_MS);
      let fileResp: Response;
      try {
        fileResp = await fetch(file_url, { signal: ctrl2.signal, redirect: "error" });
      } finally {
        clearTimeout(timer2);
      }
      if (!fileResp.ok || !fileResp.body) throw new Error("No se pudo descargar el archivo");
      const buf = new Uint8Array(await fileResp.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        return new Response(JSON.stringify({ error: "Archivo demasiado grande" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const dataUrl = `data:${mt};base64,${btoa(bin)}`;
      userContent = [
        { type: "text", text: `Verifica este documento PDF. Tipo declarado: ${doc_type}.` },
        { type: "file", file: { filename: "doc.pdf", file_data: dataUrl } },
      ];
    }

    const hint = TYPE_HINTS[doc_type] ?? TYPE_HINTS.other;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content:
              "Eres un verificador estricto de documentos para una plataforma de salud en Colombia. " +
              "Tu tarea: revisar si el documento corresponde al tipo declarado y si es auténtico, legible y vigente. " +
              "Rechaza si hay señales de manipulación, escaneo borroso, datos faltantes, fecha vencida, " +
              "o si el contenido no coincide con el tipo. Sé exigente: marca is_valid=false ante cualquier duda razonable. " +
              `Tipo esperado: "${doc_type}" — ${hint}`,
          },
          { role: "user", content: userContent },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "verify_document" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 402) {
        return new Response(
          JSON.stringify({
            error: resp.status === 429 ? "Demasiadas solicitudes." : "Créditos IA agotados.",
          }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await resp.text();
      console.error("Gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(
        JSON.stringify({
          verification: {
            is_valid: false,
            confidence: 0,
            issues: ["La IA no pudo evaluar el documento."],
            reason: "No fue posible verificar el documento. Vuelve a subirlo más nítido.",
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const verification = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ verification }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("document-verifier error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
