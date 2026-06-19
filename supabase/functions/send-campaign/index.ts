// send-campaign — envía una campaña de email a contactos CRM filtrados, vía Resend gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { campaign_id, from_email, segment } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isStaff = (roles ?? []).some((r) => ["superadmin", "hr_staff"].includes(r.role));
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Resend no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: campaign } = await admin
      .from("crm_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .maybeSingle();
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaña no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let q = admin.from("crm_contacts").select("id,email,full_name").not("email", "is", null);
    if (segment) q = q.eq("segment", segment);
    const { data: contacts } = await q.limit(500);
    const recipients = (contacts ?? []).filter((c) => c.email);

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "Sin destinatarios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromAddr = from_email || "Humanix <onboarding@resend.dev>";
    let delivered = 0;
    const errors: string[] = [];

    for (const r of recipients) {
      try {
        const personalizedHtml = (campaign.content || "")
          .replace(/{{nombre}}/gi, r.full_name || "amigo")
          .replace(/{{email}}/gi, r.email!);

        const resp = await fetch(`${RESEND_GATEWAY}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [r.email],
            subject: campaign.subject || campaign.name,
            html: personalizedHtml || `<p>${campaign.subject || campaign.name}</p>`,
          }),
        });

        if (resp.ok) {
          delivered++;
          await admin.from("crm_interactions").insert({
            contact_id: r.id,
            type: "email",
            direction: "outbound",
            subject: campaign.subject,
            body: personalizedHtml.slice(0, 500),
            campaign_id,
            created_by: auth.userId,
          });
        } else {
          const errBody = await resp.text();
          errors.push(`${r.email}: ${resp.status} ${errBody.slice(0, 100)}`);
        }
      } catch (e) {
        errors.push(`${r.email}: ${e instanceof Error ? e.message : "err"}`);
      }
    }

    await admin
      .from("crm_campaigns")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        recipients_count: recipients.length,
        delivered_count: delivered,
      })
      .eq("id", campaign_id);

    await admin.rpc("log_audit", {
      _action: "crm.campaign.sent",
      _resource_type: "crm_campaigns",
      _resource_id: campaign_id,
      _severity: "info",
      _meta: { delivered, total: recipients.length, errors_count: errors.length },
    });

    return new Response(
      JSON.stringify({ delivered, total: recipients.length, errors: errors.slice(0, 10) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("send-campaign error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
