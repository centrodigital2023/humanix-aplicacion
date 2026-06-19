// embed-offer — genera y guarda el embedding de una oferta del usuario autenticado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";
import { embedText } from "../_shared/embed.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { offer_id } = await req.json();
    if (!offer_id)
      return new Response(JSON.stringify({ error: "offer_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: o } = await admin
      .from("job_offers")
      .select("id,title,description,specialty_required,city,modality,amount,requirements,posted_by")
      .eq("id", offer_id)
      .maybeSingle();
    if (!o)
      return new Response(JSON.stringify({ error: "Oferta no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    if (o.posted_by !== auth.userId) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = [
      `Título: ${o.title}`,
      `Especialidad requerida: ${o.specialty_required ?? "general"}`,
      `Ciudad: ${o.city}`,
      `Modalidad: ${o.modality}`,
      `Monto COP: ${o.amount}`,
      `Requisitos: ${(o.requirements ?? []).join(", ")}`,
      `Descripción: ${o.description ?? ""}`,
    ].join("\n");

    const embedding = embedText(text);
    const { error } = await admin.from("offer_embeddings").upsert({
      offer_id: o.id,
      embedding,
      source_text: text.slice(0, 4000),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    await admin.from("ai_credits_ledger").insert({
      user_id: auth.userId,
      feature: "embed-offer",
      credits_used: 1,
      meta: { offer_id: o.id },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("embed-offer error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
