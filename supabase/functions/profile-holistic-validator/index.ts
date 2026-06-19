// Validador holístico: cruza datos del formulario con documentos y referencias.
// Bloquea publicación solo ante errores críticos. Advertencias no bloquean.
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "validate_profile",
    description:
      "Evalúa si el perfil profesional puede publicarse, detectando errores graves y advertencias menores.",
    parameters: {
      type: "object",
      properties: {
        is_publishable: { type: "boolean", description: "true solo si NO hay errores críticos." },
        score: { type: "number", description: "0-100, calidad global del perfil." },
        critical_errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              message: { type: "string" },
            },
            required: ["field", "message"],
            additionalProperties: false,
          },
          description:
            "Errores que BLOQUEAN publicación: documento falso, datos contradictorios graves, RETHUS no coincide, faltan obligatorios.",
        },
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              message: { type: "string" },
            },
            required: ["field", "message"],
            additionalProperties: false,
          },
          description: "Advertencias menores: bio corta, certificaciones sin documento, etc.",
        },
        ai_summary: { type: "string", description: "Resumen 1-2 frases en español del veredicto." },
      },
      required: ["is_publishable", "score", "critical_errors", "warnings", "ai_summary"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { profile, documents, references } = await req.json();
    if (!profile) {
      return new Response(JSON.stringify({ error: "profile requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const docsSummary = (documents ?? []).map((d: Record<string, unknown>) => ({
      type: d.doc_type,
      status: d.status,
      ai_verified: d.ai_verified,
      ai_score: d.ai_score,
      ai_notes: d.ai_notes,
      extracted: d.ai_extracted,
    }));

    const refsByType = (references ?? []).reduce(
      (acc: Record<string, unknown[]>, r: Record<string, unknown>) => {
        const k = String(r.ref_type ?? "other");
        acc[k] = acc[k] ?? [];
        acc[k].push({ name: r.full_name, phone: r.phone, relation: r.relation });
        return acc;
      },
      {},
    );

    const REQUIRED_DOCS = ["cv", "id_document", "utility_bill"];
    const has = (t: string) =>
      docsSummary.some((d: Record<string, unknown>) => d.type === t && d.status !== "rejected");
    const missingDocs = REQUIRED_DOCS.filter((t) => !has(t));
    if (!has("rethus") && !has("diploma")) missingDocs.push("rethus_o_diploma");
    const workRefs = (refsByType.work ?? []).length;
    const familyRefs = (refsByType.family ?? []).length;

    const sysPrompt =
      "Eres un revisor estricto pero justo de perfiles profesionales de salud en Colombia. " +
      "Tu trabajo: validar que el formulario, los documentos y las referencias sean COHERENTES y SUFICIENTES para publicar el perfil. " +
      "REGLAS CRÍTICAS (bloquean publicación, is_publishable=false):\n" +
      "- Algún documento obligatorio (cv, id_document, utility_bill) está rechazado, falso o ausente.\n" +
      "- No hay NI documento RETHUS NI diploma profesional (al menos uno es obligatorio).\n" +
      "- El nombre del CV o cédula NO coincide con el nombre del perfil.\n" +
      "- Si declaró número RETHUS, NO coincide con el extraído del documento RETHUS.\n" +
      "- Hay menos de 2 referencias laborales o menos de 2 familiares.\n" +
      "- Especialidad o años de experiencia están vacíos.\n" +
      "ADVERTENCIAS (NO bloquean): bio menor a 50 caracteres, certificaciones sin documento, tarifas vacías, sub-especialidades vacías.\n" +
      `Documentos obligatorios faltantes detectados: ${JSON.stringify(missingDocs)}.\n` +
      `Referencias: ${workRefs} laborales, ${familyRefs} familiares (mínimo 2 de cada).`;

    const userMsg = `PERFIL DEL FORMULARIO:\n${JSON.stringify(profile, null, 2)}\n\nDOCUMENTOS:\n${JSON.stringify(docsSummary, null, 2)}\n\nREFERENCIAS:\n${JSON.stringify(refsByType, null, 2)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userMsg },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "validate_profile" } },
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
      console.error("gateway:", resp.status, t);
      return new Response(JSON.stringify({ error: "Error IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const validation = call
      ? JSON.parse(call.function.arguments || "{}")
      : {
          is_publishable: false,
          score: 0,
          critical_errors: [{ field: "system", message: "No se pudo evaluar." }],
          warnings: [],
          ai_summary: "Sin respuesta de IA.",
        };

    return new Response(JSON.stringify({ validation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validator:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
