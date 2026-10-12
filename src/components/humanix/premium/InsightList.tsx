// Lista de hallazgos con tono (urgente · atención · bien · dato), compartida por el informe de bienestar, el
// presupuesto y el radar de cobertura. El tono se dice con palabras para lector de pantalla, no solo con color.
import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type InsightTone = "alert" | "warn" | "ok" | "info";

export interface InsightItem {
  id: string;
  tone: InsightTone;
  title: string;
  detail?: string;
  action?: string;
  /** Botones o enlaces que acompañan al hallazgo. */
  cta?: ReactNode;
}

const STYLE: Record<InsightTone, { box: string; text: string; Icon: typeof Info; label: string }> =
  {
    alert: {
      box: "border-sos/30 bg-sos/5",
      text: "text-sos",
      Icon: AlertTriangle,
      label: "Urgente",
    },
    warn: {
      box: "border-warn/30 bg-warn/5",
      text: "text-warn",
      Icon: AlertCircle,
      label: "Atención",
    },
    ok: { box: "border-ok/30 bg-ok/5", text: "text-ok", Icon: CheckCircle2, label: "Bien" },
    info: {
      box: "border-border bg-muted/40",
      text: "text-muted-foreground",
      Icon: Info,
      label: "Dato",
    },
  };

export function InsightList({
  items,
  label,
  className,
}: {
  items: InsightItem[];
  label: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={label} className={cn("space-y-2", className)}>
      {items.map((i) => {
        const st = STYLE[i.tone];
        return (
          <li key={i.id} className={cn("flex gap-3 rounded-xl border p-3", st.box)}>
            <st.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", st.text)} aria-hidden="true" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold leading-snug">
                <span className="sr-only">{st.label}: </span>
                {i.title}
              </p>
              {i.detail && <p className="mt-0.5 text-muted-foreground">{i.detail}</p>}
              {i.action && (
                <p className="mt-1">
                  <strong>Qué hacer:</strong> {i.action}
                </p>
              )}
              {i.cta && <div className="mt-2 flex flex-wrap gap-2">{i.cta}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
