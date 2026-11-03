// Plan por perfil en la portada: familias y profesionales, gratis; instituciones, plan anual por Bre-B (se paga en
// /planes, dentro de Humanix). Reutiliza computeCta (lógica probada).
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { AppUser } from "@/hooks/use-app-user";
import { usePlan } from "@/hooks/use-plan";
import { computeCta } from "@/lib/planCta";
import { PLAN_CATALOG, planValidity, segmentOfRoles, type PlanKey } from "@/lib/plans";
import { COP, INSTITUTION_PLANS, PRO_TIERS } from "@/lib/commissionMatrix";
import { AUDIENCE_COPY, type Audience } from "@/lib/audience";
import { useVoice } from "./voice";

type Card = { key: PlanKey; emoji: string; perks: string[] };

const BY_AUDIENCE: Record<Audience, Card[]> = {
  familias: [
    {
      key: "family_premium_monthly",
      emoji: "💚",
      perks: [
        "Gratis y sin comisión",
        "Paga con Bre-B desde tu banco, o en efectivo",
        "Círculo familiar, alertas y botón SOS",
      ],
    },
  ],
  profesionales: [
    {
      key: "pro_monthly",
      emoji: "🩺",
      perks: [
        `Sin mensualidad · comisión de ${PRO_TIERS[2].pct} % que baja hasta ${PRO_TIERS[0].pct} %`,
        "Tu primer turno con cada familia nueva: sin comisión",
        "Tu pago en segundos a tu llave Bre-B",
      ],
    },
  ],
  instituciones: [
    {
      key: "institution_monthly",
      emoji: "🏥",
      perks: [
        `${COP(INSTITUTION_PLANS.small.monthlyCOP)}/mes (1 a 9 profesionales) o ${COP(INSTITUTION_PLANS.large.monthlyCOP)}/mes (10 o más)`,
        "Un solo pago al año por Bre-B",
        "Multiusuario, agenda inteligente y monitoreo a escala",
      ],
    },
  ],
};

export function PlanStrip({ audience, user }: { audience: Audience; user: AppUser | null }) {
  const navigate = useNavigate();
  const { say } = useVoice();
  const plan = usePlan(user?.id);
  const renewSoon = planValidity(plan, Date.now()).renewSoon;
  const segment = segmentOfRoles(user?.roles);

  const act = (key: PlanKey) => {
    const { action } = computeCta(key, {
      userId: user?.id,
      currentPlan: plan.plan,
      segment,
      renewSoon,
    });
    if (action.kind === "current" || action.kind === "other_profile") return;
    if (action.kind === "free") {
      if (user) void navigate({ to: "/dashboard" });
      else
        void navigate({
          to: "/auth",
          search: { role: AUDIENCE_COPY[audience].authRole, mode: "signup" } as never,
        });
      return;
    }
    if (action.kind === "login") {
      void navigate({
        to: "/auth",
        search: {
          role: AUDIENCE_COPY[audience].authRole,
          mode: "signup",
          redirect: action.redirectTo,
        } as never,
      });
      return;
    }
    say("Te llevamos a activar el plan con Bre-B.");
    void navigate({ href: `/planes?plan=${key}` });
  };

  return (
    <ul className="grid gap-4">
      {BY_AUDIENCE[audience].map((c) => {
        const def = PLAN_CATALOG[c.key];
        const cta = computeCta(c.key, {
          userId: user?.id,
          currentPlan: plan.plan,
          segment,
          renewSoon,
        });
        return (
          <li
            key={c.key}
            className="flex flex-col rounded-[2rem] bg-trust p-6 text-trust-foreground shadow-xl shadow-trust/20"
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
              disabled={cta.disabled}
              className="mt-6 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-background px-4 text-lg font-bold text-trust transition active:scale-[0.98] disabled:opacity-70"
            >
              {cta.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
