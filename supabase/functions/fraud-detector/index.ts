// fraud-detector — analiza el perfil profesional y los documentos del usuario
// (heurísticas + IA) y crea fraud_flags si encuentra inconsistencias.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "report_fraud_signals",
    description: "Devuelve señales de posible fraude o inconsistencia en el perfil.",
    parameters: {
      type: "object",
      properties: {
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              reason: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              evidence: { type: "string" },
            },
            required: ["reason", "severity", "evidence"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["flags", "summary"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { user_id } = await req.json().catch(() => ({}));
    const target = user_id || auth.userId;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Determinar si el caller es staff
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isStaff = (roles ?? []).some((r) =>
      ["superadmin", "hr_staff", "evaluator"].includes(r.role),
    );

    // Si el target no es el caller, exigir staff
    if (target !== auth.userId && !isStaff) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: pro }, { data: docs }, { data: profile }] = await Promise.all([
      admin.from("professional_profiles").select("*").eq("user_id", target).maybeSingle(),
      admin
        .from("professional_documents")
        .select("doc_type,file_name,status,created_at")
        .eq("user_id", target),
      admin
        .from("profiles")
        .select("full_name,email,phone,city")
        .eq("user_id", target)
        .maybeSingle(),
    ]);
    if (!pro) {
      return new Response(JSON.stringify({ error: "Perfil profesional no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Heurísticas locales rápidas
    const heuristics: Array<{ reason: string; severity: string; evidence: string }> = [];
    if (pro.rethus_number && !/^\d{4,}$/.test(pro.rethus_number)) {
      heuristics.push({
        reason: "Formato RETHUS sospechoso",
        severity: "medium",
        evidence: `Valor: ${pro.rethus_number}`,
      });
    }
    if ((pro.years_experience ?? 0) > 50) {
      heuristics.push({
        reason: "Años de experiencia improbables",
        severity: "high",
        evidence: `${pro.years_experience} años`,
      });
    }
    const hasRethusDoc = (docs ?? []).some((d) => d.doc_type === "rethus");
    if (pro.rethus_number && !hasRethusDoc) {
      heuristics.push({
        reason: "Declara RETHUS pero no subió documento",
        severity: "medium",
        evidence: "Falta doc rethus",
      });
    }
    if (pro.specialty && (pro.bio ?? "").length < 20) {
      heuristics.push({
        reason: "Bio extremadamente corta",
        severity: "low",
        evidence: `${(pro.bio ?? "").length} chars`,
      });
    }

    // IA: validación cruzada
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Eres auditor anti-fraude para una plataforma de salud en Colombia. " +
              "Detecta inconsistencias entre perfil declarado, documentos y experiencia. " +
              "Sé conservador: no marques nada que no tenga evidencia clara.",
          },
          {
            role: "user",
            content:
              "PERFIL:\n" +
              JSON.stringify(
                {
                  nombre: profile?.full_name,
                  ciudad: profile?.city,
                  especialidad: pro.specialty,
                  sub: pro.sub_specialties,
                  años: pro.years_experience,
                  rethus: pro.rethus_number,
                  bio: pro.bio,
                  certificaciones: pro.certifications,
                  experiencia: pro.work_experience,
                  tarifas: { hora: pro.hourly_rate, turno: pro.shift_rate, mes: pro.monthly_rate },
                },
                null,
                2,
              ) +
              "\n\nDOCUMENTOS:\n" +
              JSON.stringify(docs ?? [], null, 2) +
              "\n\nHEURÍSTICAS LOCALES YA DETECTADAS:\n" +
              JSON.stringify(heuristics, null, 2),
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "report_fraud_signals" } },
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
      throw new Error("Error IA");
    }
    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = call ? JSON.parse(call.function.arguments || "{}") : { flags: [], summary: "" };
    const allFlags = [
      ...heuristics.map((h) => ({ ...h, evidence: h.evidence })),
      ...(parsed.flags ?? []),
    ];

    // Guardar flags activas. Sólo staff puede eliminar flags previas no resueltas
    // (evita que un usuario marcado por fraude limpie sus propias señales).
    if (isStaff) {
      await admin.from("fraud_flags").delete().eq("user_id", target).eq("resolved", false);
    }
    if (allFlags.length) {
      await admin.from("fraud_flags").insert(
        allFlags.map((f) => ({
          user_id: target,
          reason: f.reason,
          severity: f.severity,
          meta: { evidence: f.evidence },
        })),
      );
    }

    await admin.from("ai_credits_ledger").insert({
      user_id: auth.userId,
      feature: "fraud-detector",
      credits_used: 2,
    });

    return new Response(JSON.stringify({ flags: allFlags, summary: parsed.summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fraud-detector error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
