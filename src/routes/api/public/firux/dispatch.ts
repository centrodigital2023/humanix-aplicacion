import { createFileRoute } from "@tanstack/react-router";
import { handleDispatchRequest } from "@/lib/dispersion.server";

// Despachador de la dispersión automática. Lo despierta la base (pg_net, en el mismo segundo en que se libera un pago)
// y un reloj de respaldo cada minuto (pg_cron). Protegido con FIRUX_DISPATCH_SECRET, el mismo valor guardado en
// `hx_dispersion_config.secret`. Sin FIRUX_PAYOUTS_ENABLED=true no envía nada.
export const Route = createFileRoute("/api/public/firux/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { dispersionDepsFromEnv } = await import("@/lib/dispersion.server");
        return handleDispatchRequest(request, {
          secret: process.env.FIRUX_DISPATCH_SECRET,
          deps: dispersionDepsFromEnv,
        });
      },
    },
  },
});
