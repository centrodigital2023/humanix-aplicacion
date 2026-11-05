import { createFileRoute } from "@tanstack/react-router";
import { handleWompiWebhook } from "@/lib/wompiWebhook";

// Avisos firmados de cobros de Wompi (`transaction.updated`). Registrar en Wompi → Desarrolladores → URL de eventos:
// https://humanix.lat/api/public/wompi/webhook (una para Sandbox y otra para Producción).
export const Route = createFileRoute("/api/public/wompi/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WOMPI_EVENTS_SECRET;
        let store = null;
        if (secret && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { supabaseWebhookStore } = await import("@/lib/wompiWebhook");
          store = await supabaseWebhookStore(supabaseAdmin as never);
        }
        return handleWompiWebhook(request, { secret, store });
      },
    },
  },
});
