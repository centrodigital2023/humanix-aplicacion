// Crea la preferencia de Mercado Pago para pagar UN mes de un plan de Humanix (no es un cobro automático).
// Devuelve init_point para redirigir al checkout. La lógica de qué se puede pagar vive en `_shared/planBilling.ts`
// (probada con Vitest): abrir un pago nunca le quita a nadie un plan vigente y con un plan vigente no se baja de plan.
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import {
  PLAN_TITLE,
  checkoutDecision,
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
      srv(`mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end`),
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
        decision.error === "downgrade_while_active"
          ? {
              error: "downgrade_while_active",
              current_plan: decision.current,
              ends_at: decision.endsAt,
            }
          : { error: "unknown_plan" },
        decision.error === "downgrade_while_active" ? 409 : 400,
      );
    }
    const { plan, amount } = decision;
    // Validación ligera del email: solo se usa como "payer hint" para MP.
    const emailRaw = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)
      ? emailRaw
      : "comprador@humanix.lat";

    // Anti open-redirect: solo se aceptan orígenes de humanix.lat. Si el
    // header Origin viene de otro dominio, forzamos el canónico.
    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(rawOrigin)
      ? rawOrigin
      : "https://humanix.lat";

    // Panel al que vuelve cada perfil tras pagar: el de su rol (lista cerrada, sin open-redirect).
    const returnPath = returnPathFor(roles, body.return_to);
    const title = PLAN_TITLE[plan];

    // Preferencia simple (no recurrente). Para recurrente se usa /preapproval.
    const prefBody = {
      items: [
        {
          id: plan,
          title,
          quantity: 1,
          unit_price: amount,
          currency_id: "COP",
        },
      ],
      payer: { email },
      back_urls: {
        success: `${origin}/pago/exito?tipo=plan&plan=${plan}&from=${encodeURIComponent(returnPath)}`,
        failure: `${origin}/pago/fallo?tipo=plan&plan=${plan}&from=${encodeURIComponent(returnPath)}`,
        pending: `${origin}/pago/exito?tipo=plan&plan=${plan}&estado=pending&from=${encodeURIComponent(returnPath)}`,
      },
      auto_return: "approved",
      // Pago como invitado (sin cuenta de Mercado Pago): PSE abierto por defecto, sin excluir medios.
      // binary_mode false: PSE queda "pendiente" mientras el banco confirma.
      payment_methods: { excluded_payment_types: [], installments: 1, default_payment_method_id: "pse" },
      binary_mode: false,
      external_reference: userId,
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "HUMANIX",
      // Lo que el webhook usa para activar: el plan y el precio que fijó este servidor.
      metadata: { user_id: userId, plan, price_cop: amount },
    };

    const r = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(prefBody),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("MP preference error:", r.status, t);
      return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const pref = await r.json();

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
        init_point: pref.init_point,
        sandbox_init_point: pref.sandbox_init_point,
        preference_id: pref.id,
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
