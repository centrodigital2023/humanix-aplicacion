// Planes por perfil con la pasarela real (Mercado Pago, edge function
// mp-create-subscription). Reutiliza computeCta (lógica probada de /planes).
// Precio visible antes de pagar, sin casillas preseleccionadas.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { pathForRole, type AppUser } from "@/hooks/use-app-user";
import { usePlan } from "@/hooks/use-plan";
import { computeCta } from "@/lib/planCta";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";
import { AUDIENCE_COPY, type Audience } from "@/lib/audience";
import { CONTACT } from "@/lib/social";
import { whatsappLink } from "@/lib/audience";
import { useVoice } from "./voice";

type Card = { key: PlanKey; emoji: string; perks: string[] };

const BY_AUDIENCE: Record<Audience, Card[]> = {
  familias: [
    { key: "free", emoji: "🌱", perks: ["Buscar y pedir", "Mapa en vivo"] },
    {
      key: "essential_monthly",
      emoji: "💎",
      perks: ["WhatsApp directo", "Ver quién llega y cuándo", "Verificación RETHUS"],
    },
  ],
  instituciones: [
    { key: "free", emoji: "🌱", perks: ["Publicar turnos", "Ver candidatos"] },
    {
      key: "institution_monthly",
      emoji: "🏥",
      perks: ["Varios usuarios", "Puntaje IA de candidatos", "Alertas de documentos"],
    },
  ],
  profesionales: [
    {
      key: "essential_monthly",
      emoji: "💎",
      perks: ["Postulaciones sin límite", "WhatsApp directo", "Sin comisión"],
    },
    {
      key: "pro_monthly",
      emoji: "🚀",
      perks: ["Sales primero", "Coach de carrera IA", "Mensajes con IA"],
    },
  ],
};

export function PlanStrip({ audience, user }: { audience: Audience; user: AppUser | null }) {
  const navigate = useNavigate();
  const { say } = useVoice();
  const plan = usePlan(user?.id);
  const [busy, setBusy] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: PlanKey) => {
    const cta = computeCta(key, {
      userId: user?.id,
      currentPlan: plan.plan,
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    });
    const { action } = cta;
    setError(null);
    if (action.kind === "current") return;
    if (action.kind === "sales") {
      window.open(
        whatsappLink(CONTACT.whatsappNumber, "Hola Humanix, quiero el plan para IPS."),
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (action.kind === "free") {
      if (user) navigate({ to: "/dashboard" });
      else
        navigate({
          to: "/auth",
          search: {
            role: AUDIENCE_COPY[audience].authRole,
            mode: "signup",
          } as never,
        });
      return;
    }
    if (action.kind === "login") {
      navigate({
        to: "/auth",
        search: {
          role: AUDIENCE_COPY[audience].authRole,
          mode: "signup",
          redirect: `/?para=${audience}`,
        } as never,
      });
      return;
    }
    // checkout / reactivate → Mercado Pago
    setBusy(key);
    say("Te llevamos a pagar de forma segura.");
    try {
      const { data, error: err } = await supabase.functions.invoke("mp-create-subscription", {
        body: {
          plan: key,
          amount: PLAN_CATALOG[key].amountCOP,
          email: user?.email,
          return_to: user ? pathForRole(user.primaryRole) : "/dashboard/profesional",
        },
      });
      if (err) throw err;
      const url =
        (data as { init_point?: string; sandbox_init_point?: string })?.init_point ??
        (data as { sandbox_init_point?: string })?.sandbox_init_point;
      if (!url) throw new Error("sin URL");
      window.location.href = url;
    } catch (e) {
      console.error(e);
      setError("No pudimos abrir el pago. Intenta otra vez.");
      setBusy(null);
    }
  };

  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {BY_AUDIENCE[audience].map((c) => {
          const def = PLAN_CATALOG[c.key];
          const cta = computeCta(c.key, {
            userId: user?.id,
            currentPlan: plan.plan,
            cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
          });
          const paid = def.amountCOP > 0;
          return (
            <li
              key={c.key}
              className={`flex flex-col rounded-[2rem] p-6 shadow-sm ${
                paid ? "bg-trust text-trust-foreground shadow-xl shadow-trust/20" : "bg-card"
              }`}
            >
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="text-4xl">
                  {c.emoji}
                </span>
                <div>
                  <p className="text-xl font-bold">{def.label}</p>
                  <p className="font-display text-3xl font-bold">
                    {def.priceLabel}
                    <span className="text-base font-semibold opacity-80"> {def.priceNote}</span>
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-base">
                {c.perks.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => act(c.key)}
                disabled={cta.disabled || busy !== null}
                className={`mt-6 flex min-h-14 items-center justify-center gap-2 rounded-2xl px-4 text-lg font-bold transition active:scale-[0.98] disabled:opacity-60 ${
                  paid ? "bg-white text-trust-deep" : "bg-trust text-trust-foreground"
                }`}
              >
                {busy === c.key && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                {cta.label}
              </button>
              {paid && c.key !== "institution_monthly" && (
                <p className="mt-2 text-center text-sm opacity-85">
                  🔒 Pago seguro con Mercado Pago
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-base font-semibold text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
