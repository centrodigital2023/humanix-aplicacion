import { createFileRoute } from "@tanstack/react-router";
import { handleFiruxWebhook } from "@/lib/firuxWebhook";

// Aviso firmado de Firux (`charge.paid`, `charge.expired`, `charge.failed`). Registrar en Firux:
// https://humanix.lat/api/public/firux/webhook
export const Route = createFileRoute("/api/public/firux/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.FIRUX_WEBHOOK_SECRET;
        let store = null;
        if (secret && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { supabaseWebhookStore } = await import("@/lib/firuxWebhook");
          store = supabaseWebhookStore(supabaseAdmin as never);
        }
        return handleFiruxWebhook(request, {
          secret,
          store,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        });
      },
    },
  },
});
