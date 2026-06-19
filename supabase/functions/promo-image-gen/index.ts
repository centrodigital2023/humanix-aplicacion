// promo-image-gen — genera una imagen base de fondo para tarjetas promocionales
// usando Lovable AI (google/gemini-3-flash-image-preview / nano-banana-2).
import { corsHeaders, requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { prompt, aspect, mode, context } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aspectHint =
      aspect === "9:16"
        ? "vertical 9:16, optimizada para Stories y Reels"
        : aspect === "16:9"
          ? "horizontal 16:9, optimizada para Facebook y LinkedIn"
          : "cuadrada 1:1, optimizada para Instagram feed";

    const contextBlock = context && typeof context === "object"
      ? `\nContexto institucional:\n- Institución: ${context.institutionName ?? "—"}\n- Ciudad: ${context.city ?? "—"}\n- Vacantes activas: ${context.offersCount ?? 0}\n- Especialidades: ${(context.specialties ?? []).join(", ") || "—"}\n- Requisitos clave: ${(context.requirements ?? []).slice(0, 6).join(", ") || "—"}\n- Especificaciones extra: ${context.extraSpecs ?? "—"}`
      : "";

    // ---- MODO COPY: devolver headline + body + hashtags ----
    if (mode === "copy") {
      const copyPrompt = `Eres un copywriter senior de marketing de salud en Colombia. Crea una pieza publicitaria persuasiva (AIDA + storytelling breve) para reclutar talento y atraer familias en Humanix.${contextBlock}\n\nBriefing del usuario: ${prompt}\n\nDevuelve EXACTAMENTE este JSON (sin markdown):\n{\n  "headline": "máx 60 caracteres, gancho emocional",\n  "subheadline": "máx 90 caracteres, refuerza beneficio",\n  "body": "2-3 frases vendedoras, tono cálido y profesional, incluye llamado a la confianza",\n  "cta": "verbo de acción corto",\n  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],\n  "image_prompt": "prompt visual cinematográfico para generar la imagen, sin texto sobre la imagen"\n}`;

      const copyResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: copyPrompt }],
        }),
      });

      if (!copyResp.ok) {
        const status = copyResp.status;
        return new Response(
          JSON.stringify({ error: status === 429 ? "Demasiadas solicitudes" : status === 402 ? "Créditos IA agotados" : "Error IA" }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const copyData = await copyResp.json();
      const raw: string = copyData.choices?.[0]?.message?.content ?? "";
      const cleaned = raw.replace(/```json|```/g, "").trim();
      let parsed: any = null;
      try { parsed = JSON.parse(cleaned); } catch { parsed = { body: cleaned }; }
      return new Response(JSON.stringify({ copy: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fullPrompt = `Imagen profesional de marketing para Humanix (plataforma colombiana de cuidadores de salud a domicilio). ${aspectHint}. Estilo: minimalista, moderno, cálido, colores acordes a salud (azul biosensor, cobre, fucsia neuronal). Composición publicitaria con foco claro, iluminación premium, sensación de confianza y cercanía. Sin texto sobreimpreso (el texto se añadirá después).${contextBlock}\n\nBriefing: ${prompt}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content: fullPrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Demasiadas solicitudes, intenta en un momento" : "Créditos IA agotados",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiResp.text();
      console.error("AI gateway error:", status, t);
      throw new Error("AI error");
    }

    const data = await aiResp.json();
    const imageUrl: string | undefined =
      data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      console.error("No image in response", JSON.stringify(data).slice(0, 500));
      throw new Error("Sin imagen generada");
    }

    return new Response(JSON.stringify({ image: imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("promo-image-gen error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
