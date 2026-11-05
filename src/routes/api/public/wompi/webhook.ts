import { createFileRoute } from "@tanstack/react-router";

// Aviso firmado de Wompi (`transaction.updated`). Registrar en Wompi → Desarrolladores → URL de eventos:
// https://humanix.lat/api/public/wompi/webhook
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/wompi/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WOMPI_EVENTS_SECRET;
        if (!secret) return json(503, { error: "not_configured" });
        const raw = await request.text();
        const { verifyWompiEvent } = await import("@/lib/wompi");
        const ev = await verifyWompiEvent(raw, secret);
        if (!ev) return json(401, { error: "invalid_signature" });
        if (ev.event !== "transaction.updated" || !ev.reference) return json(200, { result: "ignored" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as never as import("@supabase/supabase-js").SupabaseClient;
        const eventId = `${ev.transactionId}:${ev.status}`.slice(0, 120);
        await admin.from("payment_webhook_events").insert({
          provider: "wompi",
          external_event_id: eventId,
          event_type: `transaction.${ev.status.toLowerCase()}`,
          signature_valid: true,
        });
        try {
          let result = "ignored";
          if (ev.status === "APPROVED") {
            const { data, error } = await admin.rpc("hx_firux_charge_paid", {
              p_firux_id: ev.reference,
              p_amount_paid: ev.amountCop,
            });
            if (error) throw new Error(error.message);
            result = String(data);
          } else if (["DECLINED", "VOIDED", "ERROR"].includes(ev.status)) {
            await admin
              .from("firux_charges")
              .update({ status: "failed" })
              .eq("firux_id", ev.reference)
              .eq("status", "pending");
            result = "marked";
          }
          await admin
            .from("payment_webhook_events")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq("provider", "wompi")
            .eq("external_event_id", eventId);
          return json(200, { received: true, result });
        } catch (e) {
          console.error("[wompi-webhook]", e instanceof Error ? e.message : e);
          return json(500, { error: "apply_failed" });
        }
      },
    },
  },
});
