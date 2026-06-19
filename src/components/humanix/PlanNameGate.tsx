import { Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";

/**
 * Muestra un nombre completo o lo enmascara según el plan del visor.
 * canView = usePlan(userId).can("view_full_names")
 *
 * Free:      "A••••" + candado + tooltip → /planes
 * Essential+: nombre completo
 */

function maskName(name: string | null, fallback: string): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + "••••" : "••••"))
    .join(" ");
}

type PlanNameGateProps = {
  /** Nombre real del usuario */
  name: string | null;
  /** Resultado de can("view_full_names") del visor */
  canView: boolean;
  /** Texto tipo cuando no hay nombre, ej "Profesional", "Familia" */
  fallback?: string;
  className?: string;
  /** Muestra solo la inicial + puntos sin candado (para avatares) */
  compact?: boolean;
};

export function PlanNameGate({
  name,
  canView,
  fallback = "Usuario",
  className = "",
  compact = false,
}: PlanNameGateProps) {
  if (canView) {
    return <span className={className}>{name ?? fallback}</span>;
  }

  const masked = maskName(name, fallback);

  if (compact) {
    return <span className={`text-muted-foreground/70 ${className}`}>{masked}</span>;
  }

  return (
    <span className={`group relative inline-flex items-center gap-1 ${className}`}>
      <span className="select-none">{masked}</span>
      <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      {/* Tooltip al hover */}
      <span className="pointer-events-none absolute -top-9 left-0 z-20 hidden group-hover:flex whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-lg gap-1.5 items-center">
        <Lock className="h-3 w-3 text-copper" />
        <span>
          Nombre visible con{" "}
          <Link to="/planes" className="font-semibold text-biosensor underline pointer-events-auto">
            Plan Esencial
          </Link>
        </span>
      </span>
    </span>
  );
}
