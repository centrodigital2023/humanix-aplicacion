// "Todo en Humanix": accesos grandes con imagen a las funciones que ya existen
// en la plataforma, agrupadas por perfil. Cada ruta protege su propio acceso.
import { Link } from "@tanstack/react-router";
import type { Audience } from "@/lib/audience";
import { TINTS, type Tint } from "./ui";
import { useVoice } from "./voice";

type Item = {
  to: string;
  search?: Record<string, string>;
  emoji: string;
  label: string;
  tint: Tint;
};

const ITEMS: Record<Audience, Item[]> = {
  familias: [
    { to: "/dashboard/familia", emoji: "🏠", label: "Mi panel", tint: "sky" },
    { to: "/buscar", emoji: "🔎", label: "Buscar más", tint: "violet" },
    { to: "/mensajes", emoji: "💬", label: "Mensajes", tint: "emerald" },
    { to: "/dashboard/monitoreo", emoji: "❤️", label: "Salud en vivo", tint: "rose" },
    { to: "/verificar", emoji: "✅", label: "Verificar a alguien", tint: "emerald" },
    { to: "/calculadora", emoji: "🧮", label: "¿Cuánto cuesta?", tint: "amber" },
    { to: "/recursos", emoji: "📚", label: "Guías", tint: "sky" },
    { to: "/planes", emoji: "💎", label: "Planes", tint: "violet" },
  ],
  instituciones: [
    { to: "/dashboard/institucion", emoji: "🏥", label: "Panel IPS", tint: "sky" },
    { to: "/dashboard/eps", emoji: "🛡️", label: "Portal EPS", tint: "emerald" },
    { to: "/buscar", emoji: "🔎", label: "Buscar talento", tint: "violet" },
    { to: "/mensajes", emoji: "💬", label: "Mensajes", tint: "emerald" },
    { to: "/dashboard/monitoreo", emoji: "📈", label: "Monitoreo clínico", tint: "rose" },
    { to: "/institution/forms", emoji: "📝", label: "Formularios", tint: "amber" },
    { to: "/institution/profile", emoji: "🏢", label: "Mi sede", tint: "sky" },
    { to: "/verificar", emoji: "✅", label: "Verificar RETHUS", tint: "emerald" },
  ],
  profesionales: [
    { to: "/dashboard/profesional", emoji: "🙋", label: "Mi panel", tint: "sky" },
    {
      to: "/buscar",
      search: { tab: "ofertas" },
      emoji: "📋",
      label: "Todas las ofertas",
      tint: "violet",
    },
    { to: "/mensajes", emoji: "💬", label: "Mensajes", tint: "emerald" },
    { to: "/verificar", emoji: "✅", label: "Mi verificación", tint: "emerald" },
    { to: "/calculadora", emoji: "💵", label: "Calcular tarifa", tint: "amber" },
    { to: "/carreras", emoji: "💼", label: "Trabaja en Humanix", tint: "rose" },
    { to: "/recursos", emoji: "📚", label: "Guías", tint: "sky" },
    { to: "/planes", emoji: "🚀", label: "Planes", tint: "violet" },
  ],
};

export function FeatureHub({ audience }: { audience: Audience }) {
  const { say } = useVoice();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ITEMS[audience].map((it) => (
        <li key={it.label}>
          <Link
            to={it.to}
            search={it.search as never}
            onClick={() => say(it.label)}
            className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl bg-card p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
          >
            <span
              aria-hidden="true"
              className={`flex h-14 w-14 items-center justify-center rounded-full text-3xl ${TINTS[it.tint]}`}
            >
              {it.emoji}
            </span>
            <span className="text-base font-bold leading-tight">{it.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
