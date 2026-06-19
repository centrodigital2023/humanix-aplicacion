// CV Extractor — extrae perfil profesional desde un PDF/imagen de hoja de vida
// usando un modelo multimodal con tool calling.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const ALLOWED_MIME_PREFIXES = ["application/pdf", "image/"];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (límite Gemini inline)
const FETCH_TIMEOUT_MS = 15_000;

const TOOL = {
  type: "function",
  function: {
    name: "save_cv_profile",
    description:
      "Extrae datos estructurados de una hoja de vida de un profesional de la salud en Colombia.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        specialty: { type: "string" },
        sub_specialties: { type: "array", items: { type: "string" } },
        years_experience: { type: "number" },
        rethus_number: { type: "string" },
        certifications: { type: "array", items: { type: "string" } },
        languages: { type: "array", items: { type: "string" } },
        service_cities: { type: "array", items: { type: "string" } },
        bio: {
          type: "string",
          description:
            "Bio profesional 2-3 frases en primera persona, en español, cálida y precisa.",
        },
        work_experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              employer: { type: "string" },
              city: { type: "string" },
              start: { type: "string", description: "YYYY o YYYY-MM" },
              end: { type: "string", description: "YYYY, YYYY-MM o 'Actual'" },
              description: { type: "string" },
            },
            required: ["role", "employer"],
            additionalProperties: false,
          },
        },
      },
      required: ["specialty"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { file_url, mime_type } = await req.json();
    if (!file_url || typeof file_url !== "string") {
      return new Response(JSON.stringify({ error: "file_url requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SSRF protection: only allow Supabase Storage URLs from this project
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
    const allowedHost = new URL(supabaseUrl).hostname;
    if (parsed.protocol !== "https:" || parsed.hostname !== allowedHost) {
      return new Response(JSON.stringify({ error: "URL de archivo no permitida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    // HEAD request para validar tipo y tamaño SIN cargar el archivo en memoria.
    // El gateway descarga la URL firmada por su cuenta (es pública temporalmente),
    // así evitamos el "Memory limit exceeded" al hacer base64 en el worker.
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
      return new Response(JSON.stringify({ error: "Archivo demasiado grande (máx 20MB)" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gemini acepta image_url solo para PNG/JPEG/WebP/GIF. Para PDFs hay que
    // enviar el binario como data URL en una parte `file`. Descargamos el PDF
    // (tope 8MB) y lo codificamos en base64 de forma chunked para no agotar RAM.
    let userContent: unknown;
    if (mt.startsWith("image/")) {
      userContent = [
        { type: "text", text: "Extrae el perfil profesional de esta hoja de vida." },
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
        return new Response(JSON.stringify({ error: "Archivo demasiado grande (máx 20MB)" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // base64 chunked para evitar "Maximum call stack size exceeded"
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const dataUrl = `data:${mt};base64,${btoa(bin)}`;
      userContent = [
        { type: "text", text: "Extrae el perfil profesional de esta hoja de vida (PDF adjunto)." },
        { type: "file", file: { filename: "cv.pdf", file_data: dataUrl } },
      ];
    }

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
              "Eres un extractor de hojas de vida del sector salud en Colombia. " +
              "Lee el documento y completa la herramienta. NO inventes datos: si un campo no aparece, omítelo. " +
              "Para tarifas, no las inventes. Para bio, redacta 2-3 frases en español neutro y profesional.",
          },
          { role: "user", content: userContent },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_cv_profile" } },
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
      return new Response(JSON.stringify({ profile: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profile = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ profile }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cv-extractor error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
