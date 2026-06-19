// semantic-match — búsqueda semántica bidireccional.
// mode="offer-to-pros": dado un offer_id devuelve top profesionales.
// mode="pro-to-offers": dado el user autenticado, top ofertas.
// mode="text-to-pros": dado un texto libre (necesidad de familia), genera embedding ad-hoc y busca pros.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

async function embed(text: string): Promise<number[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/text-embedding-004", input: text.slice(0, 8000) }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  const j = await r.json();
  return j.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { mode, offer_id, text, limit = 8, min_similarity = 0.45 } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (mode === "offer-to-pros") {
      if (!offer_id) throw new Error("offer_id requerido");
      const { data: matches, error } = await admin.rpc("match_professionals_for_offer", {
        _offer_id: offer_id,
        _match_count: limit,
        _min_similarity: min_similarity,
      });
      if (error) throw error;
      const ids = (matches ?? []).map((m: { user_id: string }) => m.user_id);
      const { data: pros } = await admin
        .from("professional_profiles")
        .select(
          "user_id,specialty,sub_specialties,years_experience,avatar_url,trust_score,avg_rating,hourly_rate,shift_rate,monthly_rate,service_cities,bio,verified,rethus_verified",
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
      const result = (matches ?? [])
        .map((m: { user_id: string; similarity: number }) => ({
          ...byId.get(m.user_id),
          profile: profMap.get(m.user_id),
          similarity: m.similarity,
        }))
        .filter((r: { user_id?: string }) => r.user_id);
      return new Response(JSON.stringify({ matches: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "pro-to-offers") {
      const { data: matches, error } = await admin.rpc("match_offers_for_professional", {
        _user_id: auth.userId,
        _match_count: limit,
        _min_similarity: min_similarity,
      });
      if (error) throw error;
      const ids = (matches ?? []).map((m: { offer_id: string }) => m.offer_id);
      const { data: offers } = await admin
        .from("job_offers")
        .select("id,title,description,modality,amount,city,specialty_required,status,created_at")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("status", "open");
      const byId = new Map((offers ?? []).map((o) => [o.id, o]));
      const result = (matches ?? [])
        .map((m: { offer_id: string; similarity: number }) => ({
          ...byId.get(m.offer_id),
          similarity: m.similarity,
        }))
        .filter((r: { id?: string }) => r.id);
      return new Response(JSON.stringify({ matches: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "text-to-pros") {
      if (!text) throw new Error("text requerido");
      const v = await embed(text);
      // Hacemos consulta directa por similitud usando SQL embebido.
      const { data: pros, error: e2 } = await admin
        .from("profile_embeddings")
        .select("user_id, embedding")
        .limit(200);
      if (e2) throw e2;
      const scored = (pros ?? [])
        .map((p) => {
          const emb = p.embedding as unknown as number[];
          if (!Array.isArray(emb)) return null;
          // similitud coseno
          let dot = 0,
            na = 0,
            nb = 0;
          for (let i = 0; i < v.length; i++) {
            dot += v[i] * emb[i];
            na += v[i] * v[i];
            nb += emb[i] * emb[i];
          }
          const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
          return { user_id: p.user_id, similarity: sim };
        })
        .filter(
          (x): x is { user_id: string; similarity: number } =>
            !!x && x.similarity >= min_similarity,
        )
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
      const ids = scored.map((s) => s.user_id);
      const { data: rich } = await admin
        .from("professional_profiles")
        .select(
          "user_id,specialty,sub_specialties,years_experience,avatar_url,trust_score,avg_rating,hourly_rate,shift_rate,monthly_rate,service_cities,bio,verified,rethus_verified",
        )
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("active", true)
        .eq("published", true)
        .eq("blocked", false);
      const { data: profiles } = await admin
        .from("public_profiles_safe")
        .select("user_id,full_name,city,avatar_url")
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const byId = new Map((rich ?? []).map((p) => [p.user_id, p]));
      const profMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const result = scored
        .map((s) => ({
          ...byId.get(s.user_id),
          profile: profMap.get(s.user_id),
          similarity: s.similarity,
        }))
        .filter((r) => r.user_id);
      await admin.from("ai_credits_ledger").insert({
        user_id: auth.userId,
        feature: "semantic-match-text",
        credits_used: 1,
      });
      return new Response(JSON.stringify({ matches: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "mode inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("semantic-match error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
