// «Rituales que unen»: la parte emocional de la ruta de cuidado.
//
//  - Ritual de hoy (las cinco rutas): una acción pequeña que cambia sola cada día; se marca «lo hicimos» y se puede
//    invitar al círculo a sumarse a distancia. El contador solo suma (nunca racha).
//  - Plan «cuando… entonces…» (adulto mayor, posoperatorio, crónicos): frases sencillas que atan un hábito a un
//    momento del día. Nada clínico: organiza lo que el equipo de salud ya indicó.
//  - Pasaporte de valentía (niño o niña): sellos por cada paso, con un certificado sin datos del menor.
//  - ¿Y tú, cómo estás? (quien cuida): el clima de la semana en un toque; privado, solo en este navegador.
//
// Lógica pura y probada en `lib/careRituals`, `lib/courageStamps` y `lib/caregiverPulse`. Todo lo que se guarda vive
// en este navegador (comodidad de quien lo usa) y nada se envía solo: compartir prepara el mensaje en WhatsApp.
import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Check,
  ClipboardCopy,
  Clock,
  CloudLightning,
  CloudRain,
  CloudSun,
  HandHeart,
  Phone,
  Pill,
  Plus,
  Puzzle,
  Rainbow,
  Rocket,
  Shield,
  Smile,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ROUTES, type CareRoute } from "@/lib/careJourney";
import {
  CUES,
  MAX_PLANS,
  actionsFor,
  addPlan,
  hasIfThen,
  nextRitual,
  planSentence,
  plansShareText,
  removePlan,
  ritualInvite,
  ritualOfDay,
  ritualSummary,
  sanitizePlans,
  sanitizeRitualDays,
  toggleRitualToday,
  type IfThenPlan,
} from "@/lib/careRituals";
import {
  PULSE_PRIVACY,
  STORM_SUPPORT,
  WEATHERS,
  WEATHER_META,
  isWeather,
  pulseSummary,
  recordPulse,
  sanitizePulse,
  type PulseEntry,
  type Weather,
} from "@/lib/caregiverPulse";
import {
  buildPassport,
  passportCertificate,
  type PassportBooking,
  type PassportLog,
  type StampIcon,
} from "@/lib/courageStamps";
import { EMERGENCY_NUMBER, EMERGENCY_TEL, whatsappLink } from "@/lib/sos";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

const WEATHER_ICONS: Record<Weather, IconType> = {
  sunny: Sun,
  cloudy: CloudSun,
  rainy: CloudRain,
  stormy: CloudLightning,
};

const STAMP_ICONS: Record<StampIcon, IconType> = {
  Sunrise,
  Star,
  Rocket,
  Utensils,
  Puzzle,
  Smile,
  Rainbow,
  Shield,
  Pill,
};

export interface CareRitualsCardProps {
  route: CareRoute | null;
  userId: string;
  bookings: readonly PassportBooking[];
  /** Partes del turno (solo con plan); `null` si no se cargan. */
  logs: readonly PassportLog[] | null;
  premium: boolean;
  now: number;
  /** Lleva a «Pedir ayuda al círculo». */
  onAskHelp?: () => void;
}

// ── Almacenamiento local, siempre a prueba de fallos ───────────────────────────
function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("No pude copiar. Selecciona el texto y cópialo a mano.");
  }
}

export function CareRitualsCard({
  route,
  userId,
  bookings,
  logs,
  premium,
  now,
  onAskHelp,
}: CareRitualsCardProps) {
  const ritualKey = `humanix-rituals:${userId}`;
  const plansKey = route ? `humanix-ifthen:${userId}:${route}` : null;
  const pulseKey = `humanix-carer-pulse:${userId}`;

  const [ritualDays, setRitualDays] = useState<number[]>([]);
  const [plans, setPlans] = useState<IfThenPlan[]>([]);
  const [pulse, setPulse] = useState<PulseEntry[]>([]);
  const [justDone, setJustDone] = useState(false);

  useEffect(() => {
    setRitualDays(sanitizeRitualDays(readJson(ritualKey)));
    setPulse(sanitizePulse(readJson(pulseKey)));
  }, [ritualKey, pulseKey]);

  useEffect(() => {
    setPlans(route && plansKey ? sanitizePlans(route, readJson(plansKey)) : []);
  }, [route, plansKey]);

  const tone = route ? ROUTES[route].tone : "warm";
  const ritual = route ? ritualOfDay(route, now) : null;
  const tomorrow = route ? nextRitual(route, now) : null;
  const summary = useMemo(() => ritualSummary(ritualDays, now, tone), [ritualDays, now, tone]);
  const pulseState = useMemo(() => pulseSummary(pulse, now), [pulse, now]);
  const passport = useMemo(
    () => (route === "child" ? buildPassport({ bookings, logs, now }) : null),
    [route, bookings, logs, now],
  );

  if (!route || !ritual || !tomorrow) return null;

  const sober = tone === "sober";

  const onToggleRitual = () => {
    const next = toggleRitualToday(ritualDays, now);
    setRitualDays(next);
    writeJson(ritualKey, next);
    const nowDone = next.length > ritualDays.length;
    setJustDone(nowDone && !sober);
    if (nowDone) toast.success(sober ? "Momento guardado" : "¡Ritual guardado!");
  };

  const onPulse = (v: string) => {
    if (!isWeather(v)) return;
    const next = recordPulse(pulse, now, v);
    setPulse(next);
    writeJson(pulseKey, next);
  };

  const invite = ritualInvite(ritual, tone);

  return (
    <Card
      aria-label="Rituales que unen"
      className="relative overflow-hidden rounded-3xl border-trust/20 bg-gradient-to-br from-trust/5 via-background to-biosensor/5 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500 sm:p-6"
    >
      {/* Halo decorativo: solo estética, sin significado */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-biosensor/10 blur-3xl"
      />

      <div className="relative grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {/* ── Ritual de hoy ─────────────────────────────────── */}
          <section aria-labelledby="ritual-hoy" className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-trust/10 text-trust">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold leading-tight">
                  {sober ? "Un momento juntos" : "Rituales que unen"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {sober
                    ? "Algo sencillo para acompañar hoy, sin prisa."
                    : "Algo pequeño para hoy que acerca a toda la familia."}
                </p>
              </div>
            </div>

            <div
              key={ritual.id}
              className={cn(
                "relative rounded-2xl border bg-background/80 p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500",
                summary.doneToday ? "border-ok/40" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-trust/10 px-2 py-0.5 font-semibold text-trust">
                  Hoy
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" /> {ritual.minutes} min
                </span>
              </div>
              <p id="ritual-hoy" className="mt-2 font-display text-xl font-bold leading-snug">
                {ritual.title}
              </p>
              <p className="mt-1 text-sm">{ritual.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-semibold">Desde lejos:</span> {ritual.remote}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={summary.doneToday ? "secondary" : "default"}
                  aria-pressed={summary.doneToday}
                  onClick={onToggleRitual}
                  className="gap-1.5"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      summary.doneToday &&
                        justDone &&
                        "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500",
                    )}
                    aria-hidden="true"
                  />
                  {summary.doneToday ? "Lo hicimos hoy" : "Lo hicimos"}
                </Button>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a
                    href={whatsappLink(null, invite)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Preparar la invitación en WhatsApp (tú eliges a quién enviarla)"
                  >
                    <HandHeart className="h-4 w-4" aria-hidden="true" /> Invitar al círculo
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => void copyText(invite, "Invitación copiada")}
                >
                  <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
                </Button>
              </div>

              {justDone && summary.doneToday && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-4 flex gap-1 text-copper"
                >
                  {[0, 1, 2].map((i) => (
                    <Sparkles
                      key={i}
                      style={{ animationDelay: `${i * 120}ms` }}
                      className="h-4 w-4 motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:fade-in-0 motion-safe:fill-mode-backwards motion-safe:duration-700"
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-muted-foreground" aria-live="polite">
                {summary.line}
              </p>
              <p className="text-muted-foreground">
                Mañana: <span className="font-medium text-foreground">{tomorrow.title}</span>
              </p>
            </div>
          </section>

          {/* ── Plan «cuando… entonces…» ───────────────────────── */}
          {hasIfThen(route) && (
            <IfThenSection
              key={route}
              route={route}
              plans={plans}
              onChange={(next) => {
                setPlans(next);
                if (plansKey) writeJson(plansKey, next);
              }}
            />
          )}

          {/* ── Pasaporte de valentía ──────────────────────────── */}
          {passport && (
            <section
              aria-labelledby="pasaporte"
              className="space-y-3 rounded-2xl border border-copper/25 bg-gradient-to-br from-copper/10 via-background to-background p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 id="pasaporte" className="flex items-center gap-2 text-sm font-semibold">
                    <Star className="h-4 w-4 text-copper" aria-hidden="true" /> Pasaporte de
                    valentía
                  </h4>
                  <p className="text-xs text-muted-foreground">{passport.line}</p>
                </div>
                {passport.earned > 0 && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() =>
                        void copyText(passportCertificate(passport), "Certificado copiado")
                      }
                    >
                      <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Certificado
                    </Button>
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a
                        href={whatsappLink(null, passportCertificate(passport))}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Preparar el certificado en WhatsApp (tú eliges a quién enviarlo)"
                      >
                        <HandHeart className="h-4 w-4" aria-hidden="true" /> Compartir
                      </a>
                    </Button>
                  </div>
                )}
              </div>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
                {passport.stamps.map((s, i) => {
                  const SIcon = STAMP_ICONS[s.icon];
                  return (
                    <li
                      key={s.id}
                      title={s.how}
                      style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-2xl p-2 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:fill-mode-backwards motion-safe:duration-500",
                        s.earned
                          ? "bg-background shadow-sm ring-1 ring-copper/30"
                          : "border border-dashed border-border",
                      )}
                    >
                      <span
                        className={cn(
                          "relative flex h-11 w-11 items-center justify-center rounded-full",
                          s.earned
                            ? "bg-gradient-to-br from-copper to-copper/70 text-copper-foreground"
                            : "bg-muted text-muted-foreground/50",
                        )}
                      >
                        <SIcon className="h-5 w-5" aria-hidden="true" />
                        {s.fresh && passport.newest?.id === s.id && (
                          <span className="absolute -right-1 -top-1 rounded-full bg-biosensor px-1 text-[9px] font-bold text-biosensor-foreground">
                            nuevo
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] leading-tight",
                          s.earned ? "font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {s.earned ? s.title : "Por descubrir"}
                      </span>
                      <span className="sr-only">
                        {s.earned ? "Ganado." : `Se gana así: ${s.how}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                {passport.usesLogs || premium
                  ? "El certificado no lleva nombre, fechas ni datos de salud."
                  : "Con el plan Familiar también cuentan comidas, juego y controles de los partes. El certificado no lleva nombre, fechas ni datos de salud."}
              </p>
            </section>
          )}
        </div>

        {/* ── ¿Y tú, cómo estás? ────────────────────────────────── */}
        <section
          aria-labelledby="como-estas"
          className="space-y-3 rounded-2xl border border-border bg-background/80 p-4 lg:col-span-2 lg:self-start"
        >
          <div>
            <h4 id="como-estas" className="font-display text-base font-bold">
              ¿Y tú, cómo estás?
            </h4>
            <p className="text-xs text-muted-foreground">El clima de tu semana, en un toque.</p>
          </div>

          <ToggleGroup
            type="single"
            value={pulseState.thisWeek ?? ""}
            onValueChange={onPulse}
            aria-label="Cómo va tu semana"
            className="grid grid-cols-4 gap-1.5"
          >
            {WEATHERS.map((w) => {
              const WIcon = WEATHER_ICONS[w];
              return (
                <ToggleGroupItem
                  key={w}
                  value={w}
                  aria-label={WEATHER_META[w].label}
                  className="flex h-auto flex-col gap-1 rounded-xl border border-border px-1 py-2 text-[11px] data-[state=on]:border-trust/40 data-[state=on]:bg-trust/10 data-[state=on]:text-trust"
                >
                  <WIcon className="h-5 w-5" aria-hidden="true" />
                  {WEATHER_META[w].label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          <p className="text-sm" aria-live="polite">
            {pulseState.line}
          </p>

          {pulseState.suggestHelp && onAskHelp && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onAskHelp}
            >
              <HandHeart className="h-4 w-4" aria-hidden="true" /> Pedir un relevo al círculo
            </Button>
          )}

          {pulseState.showSupport && (
            <div className="space-y-2 rounded-xl border border-sos/30 bg-sos/5 p-3">
              <p className="text-xs">{STORM_SUPPORT}</p>
              <Button asChild size="sm" variant="destructive" className="gap-1.5">
                <a href={EMERGENCY_TEL} aria-label={`Llamar al ${EMERGENCY_NUMBER}`}>
                  <Phone className="h-4 w-4" aria-hidden="true" /> Llamar al {EMERGENCY_NUMBER}
                </a>
              </Button>
            </div>
          )}

          {pulseState.strip.some((w) => w !== null) && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Tus últimas semanas
              </p>
              <ol className="mt-1 flex items-end gap-1" aria-label="Clima de tus últimas semanas">
                {pulseState.strip.map((w, i) => {
                  const WIcon = w ? WEATHER_ICONS[w] : null;
                  const last = i === pulseState.strip.length - 1;
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex h-8 flex-1 items-center justify-center rounded-lg",
                        w ? "bg-trust/10 text-trust" : "bg-muted/60",
                        last && "ring-1 ring-trust/40",
                      )}
                    >
                      {WIcon ? (
                        <>
                          <WIcon className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">
                            {last
                              ? "Esta semana"
                              : `Hace ${pulseState.strip.length - 1 - i} semanas`}
                            : {WEATHER_META[w as Weather].label}
                          </span>
                        </>
                      ) : (
                        <span className="sr-only">Sin marcar</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">{PULSE_PRIVACY}</p>
        </section>
      </div>
    </Card>
  );
}

function IfThenSection({
  route,
  plans,
  onChange,
}: {
  route: CareRoute;
  plans: IfThenPlan[];
  onChange: (plans: IfThenPlan[]) => void;
}) {
  const actions = actionsFor(route);
  const [cue, setCue] = useState<string>(CUES[1].id);
  const [action, setAction] = useState<string>(actions[0]?.id ?? "");
  const preview = planSentence({ cue, action });
  const full = plans.length >= MAX_PLANS;
  const shareText = plansShareText(route, plans);

  return (
    <section
      aria-labelledby="plan-cuando"
      className="space-y-3 rounded-2xl border border-biosensor/25 bg-background/70 p-4"
    >
      <div>
        <h4 id="plan-cuando" className="text-sm font-semibold">
          Plan «cuando… entonces…»
        </h4>
        <p className="text-xs text-muted-foreground">
          Atar un hábito a un momento del día ayuda a no olvidarlo. Hasta {MAX_PLANS} planes.
        </p>
      </div>

      {plans.length > 0 && (
        <ul className="space-y-1.5">
          {plans.map((p, i) => (
            <li
              key={`${p.cue}-${p.action}`}
              className="flex items-start justify-between gap-2 rounded-xl bg-biosensor/5 px-3 py-2 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:duration-300"
            >
              <span>{planSentence(p)}</span>
              <button
                type="button"
                onClick={() => onChange(removePlan(plans, i))}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Quitar: ${planSentence(p) ?? "plan"}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Select value={cue} onValueChange={setCue}>
            <SelectTrigger aria-label="Cuándo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger aria-label="Entonces">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preview && (
            <p className="rounded-xl border border-dashed border-biosensor/30 px-3 py-2 text-sm text-muted-foreground sm:col-span-2">
              Quedaría: <span className="text-foreground">{preview}</span>
            </p>
          )}
          <Button
            type="button"
            size="sm"
            className="h-9 gap-1.5 sm:col-span-2 sm:justify-self-end"
            disabled={!preview}
            onClick={() => {
              const next = addPlan(route, plans, { cue, action });
              if (next.length === plans.length) toast("Ese plan ya está en tu lista");
              onChange(next);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Agregar
          </Button>
        </div>
      )}

      {shareText && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void copyText(shareText, "Plan copiado")}
          >
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a
              href={whatsappLink(null, shareText)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Preparar el plan en WhatsApp para quien acompaña (tú eliges a quién enviarlo)"
            >
              <HandHeart className="h-4 w-4" aria-hidden="true" /> Compartir con quien acompaña
            </a>
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Solo organiza lo que ya indicó su equipo de salud; no cambia tratamientos.
      </p>
    </section>
  );
}
