// Abre el pago de un plan de Humanix en Mercado Pago, en COP, de una de dos formas (`body.mode`):
//  - "once" (por defecto): un mes con Checkout Pro; admite PSE, Nequi, tarjeta y efectivo sin cuenta de Mercado Pago.
//  - "recurring": suscripción (`/preapproval`) con cobro automático mensual con tarjeta.
// Devuelve init_point para redirigir al checkout.
// La lógica de qué se puede pagar vive en `_shared/planBilling.ts` (probada con Vitest): abrir un pago nunca le quita
// a nadie un plan vigente, con un plan vigente no se baja de plan y no se abre una segunda suscripción del mismo plan.
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import {
  checkoutDecision,
  checkoutModeOf,
  preapprovalRequest,
  preferenceRequest,
  returnPathFor,
  type SubscriptionRow,
} from "../_shared/planBilling.ts";

const MP_BASE = "https://api.mercadopago.com";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN no configurado");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const userId = auth.userId;
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    const srv = (path: string, init: RequestInit = {}) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

    // Suscripción actual y roles: leídos en el servidor, nunca del navegador.
    const [subRes, rolesRes] = await Promise.all([
      srv(
        `mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end,mp_preapproval_id`,
      ),
      srv(`user_roles?user_id=eq.${userId}&select=role`),
    ]);
    if (!subRes.ok) throw new Error(`mp_subscriptions ${subRes.status}`);
    const current = ((await subRes.json()) as SubscriptionRow[])[0] ?? null;
    const roles = rolesRes.ok
      ? ((await rolesRes.json()) as Array<{ role: string }>).map((r) => r.role)
      : [];

    const decision = checkoutDecision(current, body.plan, Date.now());
    if (!decision.ok) {
      return json(
        decision.error === "unknown_plan"
          ? { error: "unknown_plan" }
          : { error: decision.error, current_plan: decision.current, ends_at: decision.endsAt },
        decision.error === "unknown_plan" ? 400 : 409,
      );
    }
    const { plan, amount } = decision;
    const mode = checkoutModeOf(body.mode);
    // El correo de la cuenta (servidor) o el que envió la web. La suscripción lo exige; el pago único no.
    const emailRaw = (auth.email ?? (typeof body.email === "string" ? body.email : ""))
      .trim()
      .slice(0, 120);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
    if (mode === "recurring" && !email) return json({ error: "missing_email" }, 400);

    // Anti open-redirect: solo se aceptan orígenes de humanix.lat. Si el
    // header Origin viene de otro dominio, forzamos el canónico.
    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(rawOrigin)
      ? rawOrigin
      : "https://humanix.lat";

    // Panel al que vuelve cada perfil tras pagar: el de su rol (lista cerrada, sin open-redirect).
    const returnPath = returnPathFor(roles, body.return_to);

    // Suscripción: Mercado Pago agrega `preapproval_id` a la URL al volver. Pago único: `payment_id`.
    const [endpoint, mpBody] =
      mode === "recurring"
        ? [
            "/preapproval",
            preapprovalRequest({
              userId,
              plan,
              email: email!,
              backUrl: `${origin}/pago/exito?tipo=plan&plan=${plan}&from=${encodeURIComponent(returnPath)}`,
            }),
          ]
        : [
            "/checkout/preferences",
            preferenceRequest({
              userId,
              plan,
              email,
              origin,
              returnPath,
              notificationUrl: `${SUPABASE_URL}/functions/v1/mp-webhook`,
            }),
          ];

    const r = await fetch(`${MP_BASE}${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(mpBody),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error(`MP ${endpoint} error:`, r.status, t);
      return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const pre = await r.json();

    // Marcar «pendiente» solo a quien no tiene un plan vigente: abrir un pago no puede quitar lo ya pagado.
    if (decision.writePending) {
      await srv("mp_subscriptions?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          user_id: userId,
          plan,
          amount,
          currency: "COP",
          status: "pending",
          mp_payer_email: email,
        }),
      });
    }

    return new Response(
      JSON.stringify({
        kind: decision.kind,
        mode,
        init_point: pre.init_point,
        sandbox_init_point: pre.sandbox_init_point,
        ...(mode === "recurring" ? { preapproval_id: pre.id } : { preference_id: pre.id }),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mp-create-subscription:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
