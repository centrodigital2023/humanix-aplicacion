// «Héroe del día» compartido por los paneles de familia, profesional e institución: saludo cálido, la calma del día en
// un anillo, una frase de acompañamiento y la lista de pendientes ordenada por prioridad.
//
// Es solo presentación. Cada panel arma su titular, sus cifras y sus acciones con su propia lógica pura y pasa aquí el
// botón de cada acción ya hecho (enlace con ruta con tipos o botón que baja a una sección). La calma, el tono y las
// frases salen de `lib/dayHero`, así los tres paneles hablan igual.
import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Info,
  ListChecks,
  Moon,
  Sparkles,
  Sun,
  Sunset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  TONE_LABEL,
  calmAriaLabel,
  cleanStats,
  dayPart,
  splitVisible,
  warmGreeting,
  warmLine,
  type DayPart,
  type HeroPriority,
  type HeroRole,
  type HeroStat,
  type HeroTone,
} from "@/lib/dayHero";
import { cn } from "@/lib/utils";

export interface HeroAction {
  id: string;
  priority: HeroPriority;
  title: string;
  detail: string;
  /** Etiqueta pequeña junto al título (por ejemplo «Esencial»). */
  badge?: string;
  /** El botón o enlace de la acción, ya construido por el panel. */
  cta: ReactNode;
}

const PRIORITY: Record<
  HeroPriority,
  { Icon: typeof Info; icon: string; ring: string; label: string }
> = {
  critical: {
    Icon: AlertTriangle,
    icon: "text-sos bg-sos/10",
    ring: "border-sos/40",
    label: "Urgente",
  },
  high: {
    Icon: BellRing,
    icon: "text-warn bg-warn/10",
    ring: "border-warn/30",
    label: "Importante",
  },
  medium: {
    Icon: ListChecks,
    icon: "text-trust bg-trust/10",
    ring: "border-border",
    label: "Pendiente",
  },
  low: {
    Icon: Info,
    icon: "text-muted-foreground bg-muted",
    ring: "border-border",
    label: "Para tu información",
  },
};

const TONE: Record<HeroTone, { ring: string; chip: string; stroke: string; headline: string }> = {
  calm: {
    ring: "ring-ok/30",
    chip: "bg-ok/15 text-ok",
    stroke: "stroke-ok",
    headline: "text-foreground",
  },
  attention: {
    ring: "ring-warn/40",
    chip: "bg-warn/15 text-warn",
    stroke: "stroke-warn",
    headline: "text-foreground",
  },
  urgent: {
    ring: "ring-sos/40",
    chip: "bg-sos/15 text-sos",
    stroke: "stroke-sos",
    headline: "text-sos",
  },
};

const PART_ICON: Record<DayPart, typeof Sun> = { morning: Sun, afternoon: Sunset, evening: Moon };

/** Anillo de calma: el número va al centro y se lee completo para quien usa lector de pantalla. */
function CalmRing({ calm, tone }: { calm: number; tone: HeroTone }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <div
      role="img"
      aria-label={calmAriaLabel(calm, tone)}
      className="relative mx-auto h-24 w-24 shrink-0 sm:mx-0"
    >
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={r} className="fill-none stroke-muted" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - calm / 100)}
          className={cn(
            "fill-none transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none",
            TONE[tone].stroke,
          )}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        aria-hidden="true"
      >
        <span className="font-display text-2xl font-bold tabular-nums">{calm}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">calma</span>
      </div>
    </div>
  );
}

export interface DayHeroProps {
  /** Nombre corto de la sección («Tu centro de cuidado»). */
  eyebrow: string;
  role: HeroRole;
  /** Instante actual (de `useNow`): fija el saludo y la frase del día. */
  now: number;
  name?: string | null;
  /** La frase que resume el día, con las cifras (la arma cada panel). */
  headline: string;
  calm: number;
  tone: HeroTone;
  stats?: HeroStat[];
  actions: HeroAction[];
  /** Lo que se lee cuando no hay nada pendiente. */
  emptyMessage: string;
  /** Cuántas acciones se ven de entrada (lo crítico entra siempre). */
  maxVisible?: number;
  /** Algo a la derecha de la etiqueta (por ejemplo la insignia del plan). */
  aside?: ReactNode;
  footer?: ReactNode;
  id?: string;
  className?: string;
}

export function DayHero({
  eyebrow,
  role,
  now,
  name,
  headline,
  calm,
  tone,
  stats,
  actions,
  emptyMessage,
  maxVisible = 4,
  aside,
  footer,
  id,
  className,
}: DayHeroProps) {
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const PartIcon = PART_ICON[dayPart(now)];
  const t = TONE[tone];
  const shownStats = cleanStats(stats ?? []);

  // Lo crítico entra siempre aunque pase del límite.
  const { shown, hidden } = splitVisible(actions, maxVisible);
  const list = expanded ? actions : shown;

  return (
    <Card
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "relative overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-primary/10 via-background to-trust/10 p-5 ring-1 sm:p-6",
        t.ring,
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-copper/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-trust/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <CalmRing calm={calm} tone={tone} />

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <PartIcon className="h-3.5 w-3.5 text-copper" aria-hidden="true" />
              {eyebrow}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", t.chip)}>
              {TONE_LABEL[tone]}
            </span>
            {aside}
          </div>
          <h2 id={titleId} className="mt-1 font-display text-2xl font-bold leading-tight">
            {warmGreeting(now, name, role === "institution")}
          </h2>
          <p className={cn("mt-1 text-base font-medium", t.headline)}>{headline}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{warmLine(role, tone, now)}</p>

          {shownStats.length > 0 && (
            <dl
              className={cn(
                "mt-3 grid gap-2",
                shownStats.length >= 3 ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              {shownStats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl bg-background/70 px-3 py-2 text-center ring-1 ring-border"
                >
                  <dd className="font-display text-xl font-bold tabular-nums">{s.value}</dd>
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <div className="relative mt-5">
        <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Lo que te sugerimos ahora
        </p>

        {actions.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl border border-ok/30 bg-ok/5 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
            {emptyMessage}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Cosas para hacer hoy">
            {list.map((a) => {
              const p = PRIORITY[a.priority];
              return (
                <li
                  key={a.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between",
                    p.ring,
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        p.icon,
                      )}
                      aria-hidden="true"
                    >
                      <p.Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold leading-snug">
                        <span className="sr-only">{p.label}: </span>
                        {a.title}
                        {a.badge && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-copper">
                            <Sparkles className="h-3 w-3" aria-hidden="true" /> {a.badge}
                          </span>
                        )}
                      </p>
                      <p className="text-muted-foreground">{a.detail}</p>
                    </div>
                  </div>
                  {a.cta}
                </li>
              );
            })}
          </ul>
        )}

        {hidden.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 gap-1.5"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
              aria-hidden="true"
            />
            {expanded ? "Ver menos" : `Ver ${hidden.length} más`}
          </Button>
        )}
      </div>

      {footer && <div className="relative mt-4">{footer}</div>}
    </Card>
  );
}
