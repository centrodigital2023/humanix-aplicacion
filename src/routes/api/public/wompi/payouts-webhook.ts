import { createFileRoute } from "@tanstack/react-router";
import { handleWompiPayoutWebhook } from "@/lib/wompiWebhook";

// Avisos firmados de Pagos a Terceros de Wompi (dispersión Bre-B: `transaction.updated`, `payout.updated`). Registrar en
// Wompi → Desarrolladores → Pagos a Terceros → URL de eventos: https://humanix.lat/api/public/wompi/payouts-webhook
export const Route = createFileRoute("/api/public/wompi/payouts-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WOMPI_PAYOUTS_EVENTS_SECRET;
        let store = null;
        if (secret && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { supabasePayoutWebhookStore } = await import("@/lib/wompiWebhook");
          store = supabasePayoutWebhookStore(supabaseAdmin as never);
        }
        return handleWompiPayoutWebhook(request, { secret, store });
      },
    },
  },
});
