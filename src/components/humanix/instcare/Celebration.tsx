// Celebrar lo que importa: una tarjeta que aparece un momento cuando el equipo alcanza un hito real (primer paciente, primer caso cerrado,
// primera valoración, una racha…) y la vitrina de logros. Con movimiento reducido no hay confeti. Nada se inventa: los hitos salen de las
// cifras del servidor (ver `lib/instCelebrate`).
import { useEffect, useMemo, useState } from "react";
import { Lock, Share2, Sparkles, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CelebrationPlan, MilestoneGroup, MilestoneState } from "@/lib/instCelebrate";
import { cn } from "@/lib/utils";
import { MILESTONE_ICON, milestoneShareText } from "./milestoneUi";
import { TONE } from "./tones";

const CONFETTI = ["bg-ok", "bg-biosensor", "bg-copper", "bg-fuchsia-neural", "bg-warn", "bg-trust"];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

async function shareOrCopy(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Texto copiado");
  } catch {
    toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
  }
}

export function CelebrationToast({
  plan,
  institution,
  onDismiss,
}: {
  plan: CelebrationPlan | null;
  institution?: string | null;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [calm, setCalm] = useState(false);
  useEffect(() => setCalm(prefersReducedMotion()), []);
  useEffect(() => {
    if (!plan || paused) return;
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [plan, paused, onDismiss]);

  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        left: `${(i * 41 + 7) % 100}%`,
        delay: `${(i % 8) * 70}ms`,
        color: CONFETTI[i % CONFETTI.length]!,
        drift: ((i % 5) - 2) * 14,
      })),
    [],
  );

  if (!plan) return null;
  const m = plan.headline;
  const Icon = MILESTONE_ICON[m.icon];
  const t = TONE[m.tone];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 sm:bottom-6">
      <div
        role="status"
        aria-live="polite"
        data-testid="celebration"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className={cn(
          "pointer-events-auto relative w-full max-w-md overflow-hidden rounded-3xl border bg-card p-4 shadow-2xl motion-safe:animate-fade-up",
          t.border,
        )}
      >
        {plan.confetti && !calm && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0">
            {particles.map((p, i) => (
              <span
                key={i}
                className={cn("confetti-particle", p.color)}
                style={{ left: p.left, animationDelay: p.delay, translate: `${p.drift}px 0` }}
              />
            ))}
          </div>
        )}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl",
            t.soft,
          )}
        />
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar"
          className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="relative flex items-start gap-3">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              t.soft,
              t.text,
              plan.confetti && "motion-safe:animate-pulse-ring",
            )}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 pr-6">
            <p className={cn("text-[10px] font-bold uppercase tracking-widest", t.text)}>
              Hito desbloqueado
            </p>
            <p className="font-display text-lg font-bold leading-tight">{m.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m.message}</p>
            {plan.more > 0 && (
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                y {plan.more} {plan.more === 1 ? "logro más" : "logros más"}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="hero" onClick={onDismiss}>
                <Sparkles aria-hidden /> Seguir
              </Button>
              {m.big && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void shareOrCopy(milestoneShareText(m, institution))}
                >
                  <Share2 aria-hidden /> Compartir
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<MilestoneGroup, string> = {
  start: "Primeros pasos",
  growth: "Crecimiento",
  quality: "Calidad del servicio",
  streak: "Rachas de respuesta",
};
const GROUP_ORDER: MilestoneGroup[] = ["start", "growth", "quality", "streak"];

/** Vitrina de logros: los ganados en color, los que faltan en gris con su avance. */
export function AchievementsDialog({
  open,
  onOpenChange,
  states,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: MilestoneState[];
}) {
  const earned = states.filter((s) => s.earned).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-copper" aria-hidden /> Logros del equipo
          </DialogTitle>
          <DialogDescription>
            {earned} de {states.length}. Cada uno sale de cifras reales de tu institución; se
            recuerdan en este navegador.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUP_ORDER.map((g) => {
            const list = states.filter((s) => s.group === g);
            if (list.length === 0) return null;
            return (
              <section key={g} aria-label={GROUP_LABEL[g]}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABEL[g]}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {list.map((s) => {
                    const Icon = s.earned ? MILESTONE_ICON[s.icon] : Lock;
                    const t = TONE[s.earned ? s.tone : "muted"];
                    const pct =
                      s.progress && s.progress.target > 0
                        ? Math.round((s.progress.current / s.progress.target) * 100)
                        : null;
                    return (
                      <li
                        key={s.key}
                        data-earned={s.earned}
                        className={cn(
                          "rounded-2xl border p-3",
                          s.earned
                            ? cn(t.border, "bg-gradient-to-br", t.wash)
                            : "border-border bg-muted/30",
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                              t.soft,
                              t.text,
                            )}
                          >
                            <Icon className="h-4.5 w-4.5" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "text-sm font-semibold leading-tight",
                                !s.earned && "text-muted-foreground",
                              )}
                            >
                              {s.title}
                            </p>
                            {s.earned ? (
                              <p className="text-[11px] text-muted-foreground">Logrado</p>
                            ) : s.progress ? (
                              <p className="text-[11px] tabular-nums text-muted-foreground">
                                {s.progress.current} de {s.progress.target}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">Por lograr</p>
                            )}
                          </div>
                        </div>
                        {!s.earned && pct !== null && (
                          <div
                            className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
                            aria-hidden
                          >
                            <div
                              className="h-full rounded-full bg-copper/70"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
