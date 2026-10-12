// Cifra con etiqueta y pista, la pieza común de los informes de los tres paneles. Va dentro de un <dl>.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "ok" | "warn" | "sos";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", className)}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-display text-lg font-bold leading-tight tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "sos" && "text-sos",
        )}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
