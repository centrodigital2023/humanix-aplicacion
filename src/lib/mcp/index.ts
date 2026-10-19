import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listMyNotifications from "./tools/list-my-notifications";
import listMyServices from "./tools/list-my-services";
import listOpenOffers from "./tools/list-open-offers";

// Vite inlines the stable ref; the published SUPABASE_URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "humanix-aplicacion",
  title: "Humanix Aplicacion",
  version: "0.1.0",
  instructions:
    "Herramientas de Humanix (cuidado en casa, Colombia). Consulta tus notificaciones, tus servicios de cuidado y ofertas de trabajo abiertas. Actúan como la cuenta que inició sesión y respetan sus permisos.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listMyNotifications, listMyServices, listOpenOffers],
});
