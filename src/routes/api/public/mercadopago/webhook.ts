import { createFileRoute } from "@tanstack/react-router";
import { handleMercadoPagoWebhook } from "@/lib/mpWebhook";

export const Route = createFileRoute("/api/public/mercadopago/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleMercadoPagoWebhook(request, {
          token: process.env.MERCADOPAGO_ACCESS_TOKEN,
          secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
          supabaseUrl: process.env.SUPABASE_URL,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        }),
    },
  },
});