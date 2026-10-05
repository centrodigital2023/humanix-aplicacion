// Accesos grandes del panel de familia: lo que más se usa, con imagen + 1-2 palabras.
import { Link } from "@tanstack/react-router";
import { TINTS, type Tint } from "./ui";

type Action = {
  emoji: string;
  label: string;
  tint: Tint;
  to?: string;
  search?: Record<string, string>;
  href?: string;
};

const ACTIONS: Action[] = [
  { emoji: "🙋", label: "Pedir cuidado", tint: "rose", to: "/", search: { para: "familias" } },
  { emoji: "💬", label: "Mensajes", tint: "emerald", to: "/mensajes" },
  { emoji: "❤️", label: "Salud en vivo", tint: "sky", to: "/dashboard/monitoreo" },
  { emoji: "👤", label: "Mis datos", tint: "amber", href: "#mis-datos" },
];

const tile =
  "flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl bg-card p-4 text-center shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

export function FamilyQuickActions() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const inner = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl ${TINTS[a.tint]}`}
            >
              {a.emoji}
            </span>
            <span className="text-lg font-bold leading-tight">{a.label}</span>
          </>
        );
        return (
          <li key={a.label}>
            {a.href ? (
              <a
                href={a.href}
                className={tile}
                onClick={() => {
                  const d = document.getElementById("mis-datos") as HTMLDetailsElement | null;
                  if (d) d.open = true;
                }}
              >
                {inner}
              </a>
            ) : (
              <Link to={a.to!} search={a.search as never} className={tile}>
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
