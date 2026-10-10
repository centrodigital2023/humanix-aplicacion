// Piezas visuales compartidas por las pestañas del panel de validación de mercado.
import type { ReactNode } from "react";

export function Bar({ pct, label }: { pct: number; label?: string }) {
  return (
    <div
      className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={label ?? `${pct}%`}
    >
      <div
        className="h-2 rounded-full bg-trust"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function Panel({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <h2 className="text-lg font-bold">{title}</h2>
        {caption && <p className="text-sm text-muted-foreground">{caption}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}
