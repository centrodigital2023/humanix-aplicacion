// hiring-copilot — la familia/IPS describe en lenguaje natural lo que necesita
// y la IA devuelve: { offer_draft, suggested_amount_cop, candidates: [{user_id, reason}] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "hiring_brief",
    description: "Genera borrador de oferta y razones de match.",
    parameters: {
      type: "object",
      properties: {
        offer_draft: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            specialty_required: { type: "string" },
            modality: { type: "string", enum: ["hour", "shift", "month", "package"] },
            suggested_amount_cop: { type: "number" },
            city: { type: "string" },
            requirements: { type: "array", items: { type: "string" } },
          },
          required: [
            "title",
            "description",
            "specialty_required",
            "modality",
            "suggested_amount_cop",
            "city",
            "requirements",
          ],
          additionalProperties: false,
        },
        candidate_reasons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              user_id: { type: "string" },
              score: { type: "number" },
              reason: { type: "string" },
            },
            required: ["user_id", "score", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["offer_draft", "candidate_reasons"],
      additionalProperties: false,
    },
  },
} as const;

async function embed(text: string): Promise<number[] | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  const models = ["google/text-embedding-004", "text-embedding-3-small"];
  for (const model of models) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.warn(`embed ${model} failed ${r.status}: ${t.slice(0, 200)}`);
        continue;
      }
      const j = await r.json();
      const emb = j?.data?.[0]?.embedding;
      if (Array.isArray(emb)) return emb as number[];
    } catch (err) {
      console.warn(`embed ${model} threw:`, err);
    }
  }
  return null;
}

function cosine(a: number[], b: number[]) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { brief, city } = await req.json();
    if (!brief) throw new Error("brief requerido");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Embedding del brief y top candidatos por similitud (con fallback si embeddings no disponibles)
    const v = await embed(brief);
    const { data: pes } = await admin
      .from("profile_embeddings")
      .select("user_id,embedding")
      .limit(300);
    let scored: { user_id: string; similarity: number }[] = [];
    if (v && pes && pes.length) {
      scored = (pes ?? [])
        .map((p) => {
          const emb = p.embedding as unknown as number[];
          if (!Array.isArray(emb)) return null;
          return { user_id: p.user_id, similarity: cosine(v, emb) };
        })
        .filter((x): x is { user_id: string; similarity: number } => !!x)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 12);
    }
    // Fallback: sin embeddings, tomar profesionales activos top por rating
    if (scored.length === 0) {
      const { data: fallbackPros } = await admin
        .from("professional_profiles")
        .select("user_id")
        .eq("active", true)
        .eq("published", true)
        .eq("blocked", false)
        .order("avg_rating", { ascending: false })
        .limit(12);
      scored = (fallbackPros ?? []).map((p) => ({ user_id: p.user_id, similarity: 0.5 }));
    }

    const ids = scored.map((s) => s.user_id);
    const { data: pros } = await admin
      .from("professional_profiles")
      .select(
        "user_id,specialty,sub_specialties,years_experience,trust_score,avg_rating,hourly_rate,shift_rate,monthly_rate,service_cities,verified,rethus_verified,bio",
      )
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .eq("active", true)
      .eq("published", true)
      .eq("blocked", false);
    const { data: profiles } = await admin
      .from("public_profiles_safe")
      .select("user_id,full_name,city,avatar_url")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((pros ?? []).map((p) => [p.user_id, p]));
    const profMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const candidates = scored
      .map((s) => ({
        user_id: s.user_id,
        similarity: s.similarity,
        ...byId.get(s.user_id),
        profile: profMap.get(s.user_id),
      }))
      .filter((c) => c.user_id && byId.get(c.user_id));

    // 2) Llamar al LLM con tool calling
    const sys =
      "Eres copiloto de contratación de Humanix (Colombia, salud en casa). " +
      "A partir del brief del solicitante y de los candidatos disponibles, devuelve: " +
      "1) un borrador de oferta claro y profesional en español, con monto COP justo de mercado " +
      "(hora 25-45k, turno 12h 120-220k, mes 2.5-4.5M COP según especialidad y experiencia); " +
      "2) razones específicas (1-2 frases) de por qué cada candidato encaja, con score 0-100. " +
      "Solo elige máximo 5 candidatos verdaderamente relevantes. Nunca inventes user_id: " +
      "usa exactamente los que aparecen en CANDIDATOS.";

    const userMsg =
      `BRIEF DEL SOLICITANTE:\n${brief}\n\nCIUDAD PREFERIDA: ${city ?? "no especificada"}\n\n` +
      `CANDIDATOS DISPONIBLES (${candidates.length}):\n` +
      candidates
        .map((c) =>
          JSON.stringify({
            user_id: c.user_id,
            nombre: c.profile?.full_name,
            ciudad: c.profile?.city,
            especialidad: c.specialty,
            sub: c.sub_specialties,
            años: c.years_experience,
            trust: c.trust_score,
            rating: c.avg_rating,
            rethus: c.rethus_verified,
            verified: c.verified,
            tarifas: { hora: c.hourly_rate, turno: c.shift_rate, mes: c.monthly_rate },
            ciudades_servicio: c.service_cities,
            similitud: c.similarity.toFixed(2),
          }),
        )
        .join("\n");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "hiring_brief" } },
      }),
    });
    if (!aiResp.ok) {
      if (aiResp.status === 429 || aiResp.status === 402) {
        return new Response(
          JSON.stringify({
            error: aiResp.status === 429 ? "Demasiadas solicitudes" : "Créditos IA agotados",
          }),
          {
            status: aiResp.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const t = await aiResp.text();
      console.error("gateway:", aiResp.status, t);
      throw new Error("Error IA");
    }
    const aiData = await aiResp.json();
    const call = aiData.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = call ? JSON.parse(call.function.arguments || "{}") : {};

    // Enriquecer candidate_reasons con datos públicos
    const reasonMap = new Map<string, { score: number; reason: string }>(
      (parsed.candidate_reasons ?? []).map(
        (r: { user_id: string; score: number; reason: string }) => [r.user_id, r],
      ),
    );
    const enrichedCandidates = candidates
      .filter((c) => reasonMap.has(c.user_id))
      .map((c) => ({
        user_id: c.user_id,
        full_name: c.profile?.full_name,
        city: c.profile?.city,
        avatar_url: c.profile?.avatar_url ?? null,
        specialty: c.specialty,
        years_experience: c.years_experience,
        trust_score: c.trust_score,
        avg_rating: c.avg_rating,
        rethus_verified: c.rethus_verified,
        hourly_rate: c.hourly_rate,
        shift_rate: c.shift_rate,
        monthly_rate: c.monthly_rate,
        score: reasonMap.get(c.user_id)!.score,
        reason: reasonMap.get(c.user_id)!.reason,
      }))
      .sort((a, b) => b.score - a.score);

    await admin.from("ai_credits_ledger").insert({
      user_id: auth.userId,
      feature: "hiring-copilot",
      credits_used: 3,
    });

    return new Response(
      JSON.stringify({
        offer_draft: parsed.offer_draft,
        candidates: enrichedCandidates,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("hiring-copilot error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
