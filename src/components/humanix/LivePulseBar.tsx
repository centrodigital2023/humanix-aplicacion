import { useActiveUsersCount } from "@/hooks/use-active-users-count";
import { HeartPulse, Users, Building2 } from "lucide-react";

type LivePulseBarProps = {
  /** Which role is viewing — only shows relevant counters */
  role: "professional" | "family" | "institution" | "guest";
};

/**
 * Uber-style live activity bar.
 * - Green = disponibles ahora (pulsing dot)
 * - Muted = total registrados
 * Always synced with Supabase Realtime.
 */
export function LivePulseBar({ role }: LivePulseBarProps) {
  const {
    professionals, professionalsAvailable,
    families, familiesVisible,
    institutions, institutionsVisible,
    loading,
  } = useActiveUsersCount();

  if (loading) return null;

  const items = role === "professional"
    ? [
        { icon: Users,      color: "#f2b705", label: "familias activas",      avail: familiesVisible,     total: families },
        { icon: Building2,  color: "#d4145a", label: "instituciones activas", avail: institutionsVisible, total: institutions },
      ]
    : role === "family" || role === "institution"
    ? [
        { icon: HeartPulse, color: "#2563eb", label: "profesionales",         avail: professionalsAvailable, total: professionals },
        { icon: Building2,  color: "#d4145a", label: "instituciones activas", avail: institutionsVisible, total: institutions },
      ]
    : [
        { icon: HeartPulse, color: "#2563eb", label: "profesionales",         avail: professionalsAvailable, total: professionals },
        { icon: Users,      color: "#f2b705", label: "familias activas",      avail: familiesVisible,     total: families },
        { icon: Building2,  color: "#d4145a", label: "instituciones activas", avail: institutionsVisible, total: institutions },
      ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs">
      <span className="flex items-center gap-1.5 font-semibold text-emerald-500 shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        En vivo
      </span>
      <span className="hidden sm:block h-3 w-px bg-border" />
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-muted-foreground">
          <it.icon className="h-3.5 w-3.5 shrink-0" style={{ color: it.color }} />
          <span className="font-bold" style={{ color: "#22c55e" }}>{it.avail}</span>
          {it.total > it.avail && (
            <span className="text-muted-foreground/60">/ {it.total}</span>
          )}
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}
