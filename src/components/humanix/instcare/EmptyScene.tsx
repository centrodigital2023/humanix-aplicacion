// Estado vacío con alma: una escena con luz, una ilustración que respira y una invitación clara. Un tablero sin datos no es un error, es el
// comienzo: aquí se invita a empezar (con los textos que da cada módulo). Las dos ilustraciones son SVG con los colores del tema.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function PatientArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect
        x="14"
        y="26"
        width="92"
        height="72"
        rx="16"
        className="fill-card stroke-border"
        strokeWidth="2"
      />
      <circle cx="40" cy="50" r="8.5" className="fill-trust/15 stroke-trust" strokeWidth="2" />
      <path
        d="M24 78c1.2-10 8-15 16-15s14.8 5 16 15"
        className="fill-trust/10 stroke-trust"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="60" y="45" width="34" height="5" rx="2.5" className="fill-muted" />
      <rect x="60" y="57" width="26" height="5" rx="2.5" className="fill-muted" />
      <rect x="28" y="84" width="64" height="6" rx="3" className="fill-ok/20" />
      <rect x="28" y="84" width="34" height="6" rx="3" className="fill-ok" />
      <circle cx="98" cy="30" r="15" className="fill-biosensor stroke-card" strokeWidth="3" />
      <path
        d="M98 23v14M91 30h14"
        className="stroke-biosensor-foreground"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MonitorArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <circle cx="60" cy="60" r="46" className="fill-card stroke-muted" strokeWidth="7" />
      <circle
        cx="60"
        cy="60"
        r="46"
        fill="none"
        className="stroke-biosensor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="289"
        strokeDashoffset="190"
        transform="rotate(-90 60 60)"
      />
      <path
        d="M16 64h20l8-20 12 40 10-28 6 8h32"
        fill="none"
        className="animate-ecg-loop stroke-fuchsia-neural"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="98" cy="22" r="7" className="fill-ok stroke-card" strokeWidth="3" />
      <circle cx="22" cy="98" r="5" className="fill-copper stroke-card" strokeWidth="3" />
    </svg>
  );
}

export function EmptyScene({
  variant,
  title,
  description,
  actions,
  footer,
  className,
  testId,
}: {
  variant: "patients" | "monitoring";
  title: string;
  description: string;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "relative overflow-hidden rounded-3xl border border-dashed border-border bg-gradient-to-br from-biosensor/5 via-background to-fuchsia-neural/5 px-5 py-10 text-center sm:py-14",
        className,
      )}
    >
      <div aria-hidden="true" className="orb-bio -left-12 -top-12 h-48 w-48" />
      <div aria-hidden="true" className="orb-fuchsia -bottom-14 -right-12 h-52 w-52" />
      <div className="relative">
        <div className="mx-auto mb-5 h-28 w-28 motion-safe:animate-float">
          {variant === "patients" ? <PatientArt /> : <MonitorArt />}
        </div>
        <h3 className="font-display text-lg font-bold sm:text-xl">{title}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {actions && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
        {footer && <div className="mx-auto mt-6 max-w-lg text-left">{footer}</div>}
      </div>
    </div>
  );
}
