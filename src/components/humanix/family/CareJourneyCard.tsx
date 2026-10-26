// Ruta de cuidado del panel de familia: una guía pensada para la necesidad de cada familia (adulto mayor, niño o niña,
// recuperación tras cirugía, enfermedad, condición crónica). Lógica pura en `lib/careJourney`, `lib/careDays`,
// `lib/weeklyLetter` y `lib/visitPrep`.
//
// Qué ve cada familia:
//  - Todas: la ruta, la etapa, los «días con cuidado» (un contador que solo suma), qué mirar, cuándo llamar y la
//    carta de la semana con lo que ya consta en las reservas.
//  - Con el plan Familiar (el mismo `family_wellbeing_report`; no hay precio nuevo): las metas de la semana y la carta
//    y la hoja para la cita enriquecidas con los partes del turno.
//
// No diagnostica ni recomienda medicamentos. El 123 está siempre a un toque junto a las señales de alarma. Compartir
// por WhatsApp solo prepara el mensaje (nada se envía solo) y nunca habla de pagos.
import { useMemo, useState } from "react";
import {
  Baby,
  CalendarHeart,
  Check,
  ClipboardCopy,
  Download,
  Eye,
  Sparkles,
  HeartHandshake,
  HeartPulse,
  Phone,
  Share2,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { UpgradeCta } from "@/components/humanix/PlanGate";
import { downloadText } from "@/components/humanix/premium/download";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CareDaysReport } from "@/lib/careDays";
import { momentsShareText, type CareMoment } from "@/lib/careMoments";
import {
  CARE_ROUTES,
  EMERGENCY_LINE,
  ROUTES,
  ROUTE_DISCLAIMER,
  goalLine,
  isCareRoute,
  journeyStage,
  type CareRoute,
  type GoalProgress,
} from "@/lib/careJourney";
import { bogotaYmd, dateEs } from "@/lib/intelShared";
import { EMERGENCY_NUMBER, EMERGENCY_TEL, whatsappLink } from "@/lib/sos";
import { cn } from "@/lib/utils";
import { buildVisitPrep } from "@/lib/visitPrep";
import type { WellbeingReport } from "@/lib/wellbeing";
import {
  LETTER_SHARE_NOTICE,
  buildWeeklyLetter,
  type LetterBooking,
  type LetterLog,
} from "@/lib/weeklyLetter";

const ICONS = {
  HeartHandshake,
  Baby,
  Stethoscope,
  HeartPulse,
  CalendarHeart,
} as const;

export interface CareJourneyCardProps {
  /** Ruta elegida por la familia o, si no eligió, la que sugiere su agenda. */
  route: CareRoute | null;
  /** Rutas que sugiere la agenda (la primera es la más probable). */
  inferred: readonly CareRoute[];
  onRouteChange: (route: CareRoute) => void;
  /** Día del episodio de cuidado en curso (1 = el primero), o `null` si no hay uno. */
  episodeDay: number | null;
  careDays: CareDaysReport;
  /** Buenos momentos que ya constan (de `buildCareMoments`), del más reciente al más antiguo. */
  moments?: readonly CareMoment[];
  /** Metas de la semana (solo con plan); `null` muestra la invitación. */
  goals: GoalProgress[] | null;
  bookings: LetterBooking[];
  logs: LetterLog[];
  /** Informe de bienestar (solo con plan) para enriquecer la hoja de la cita. */
  report: WellbeingReport | null;
  premium: boolean;
  now: number;
  personName?: string | null;
  loading?: boolean;
}

/** Anillo de «días con cuidado»: avanza hacia el siguiente umbral y nunca retrocede. */
function CareDaysRing({ report, tone }: { report: CareDaysReport; tone: "warm" | "sober" }) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const from = report.reached ?? 0;
  const progress =
    report.next === null
      ? 1
      : Math.min(1, Math.max(0, (report.total - from) / (report.next - from)));
  return (
    <div
      role="img"
      aria-label={`${report.headline}${report.next !== null && tone === "warm" ? `; el siguiente hito es ${report.next} días` : ""}`}
      className="relative h-24 w-24 shrink-0"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (tone === "warm" ? progress : report.total > 0 ? 1 : 0))}
          className={cn(
            "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700",
            tone === "warm" ? "stroke-biosensor" : "stroke-muted-foreground/50",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold leading-none">{report.total}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {report.total === 1 ? "día" : "días"}
        </span>
      </div>
    </div>
  );
}

function fileDate(now: number): string {
  const { y, m, d } = bogotaYmd(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("No pude copiar. Selecciona el texto y cópialo a mano.");
  }
}

export function CareJourneyCard({
  route,
  inferred,
  onRouteChange,
  episodeDay,
  careDays,
  moments = [],
  goals,
  bookings,
  logs,
  report,
  premium,
  now,
  personName,
  loading = false,
}: CareJourneyCardProps) {
  const [includeName, setIncludeName] = useState(false);
  const [includeTeam, setIncludeTeam] = useState(false);

  const def = route ? ROUTES[route] : null;
  const tone = def?.tone ?? "warm";

  const letter = useMemo(
    () =>
      buildWeeklyLetter({
        route,
        bookings,
        logs,
        now,
        options: { personName, includeName, includeTeam },
      }),
    [route, bookings, logs, now, personName, includeName, includeTeam],
  );
  const memories = useMemo(() => momentsShareText(moments, { tone }), [moments, tone]);
  const visit = useMemo(() => buildVisitPrep({ route, report }), [route, report]);
  const stage = route && episodeDay !== null ? journeyStage(route, episodeDay) : null;

  if (loading) {
    return (
      <Skeleton
        className="h-72 w-full rounded-3xl"
        aria-busy="true"
        aria-label="Preparando tu ruta de cuidado"
      />
    );
  }

  const Icon = def ? ICONS[def.icon] : HeartHandshake;
  const canNameChild = route !== "child";

  return (
    <Card
      aria-label="Tu ruta de cuidado"
      className="space-y-5 overflow-hidden rounded-3xl border-biosensor/20 bg-gradient-to-br from-biosensor/5 via-background to-copper/5 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:p-6"
    >
      {/* Encabezado y elección de ruta */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-biosensor/15 text-biosensor">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-tight">Tu ruta de cuidado</h3>
            <p className="text-sm text-muted-foreground">
              {def
                ? def.tagline
                : "Elige qué necesita tu familia y te mostramos una guía a su medida."}
            </p>
          </div>
        </div>

        <ToggleGroup
          type="single"
          value={route ?? ""}
          onValueChange={(v) => {
            if (isCareRoute(v)) onRouteChange(v);
          }}
          aria-label="Qué necesita tu familia"
          className="flex flex-wrap justify-start gap-1.5"
        >
          {CARE_ROUTES.map((r) => {
            const RIcon = ICONS[ROUTES[r].icon];
            return (
              <ToggleGroupItem
                key={r}
                value={r}
                aria-label={ROUTES[r].label}
                className="h-auto gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs data-[state=on]:border-biosensor/40 data-[state=on]:bg-biosensor/10 data-[state=on]:text-biosensor"
              >
                <RIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {ROUTES[r].label}
                {route !== r && inferred[0] === r && (
                  <span className="rounded-full bg-copper/15 px-1.5 text-[10px] font-semibold text-copper">
                    sugerida
                  </span>
                )}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      {!def ? null : (
        <>
          {/* Días con cuidado y etapa */}
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-background/70 p-4">
            <CareDaysRing report={careDays} tone={tone} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-display text-base font-semibold">
                {careDays.headline}
                {careDays.crossedThisWeek !== null && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-copper/15 px-2 py-0.5 align-middle text-[11px] font-semibold text-copper motion-safe:animate-in motion-safe:zoom-in-90 motion-safe:duration-500">
                    <Sparkles className="h-3 w-3" aria-hidden="true" /> Nuevo hito
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {careDays.line}
              </p>
              {stage && (
                <div className="pt-2">
                  <div
                    className="flex gap-1"
                    role="img"
                    aria-label={`Etapa ${stage.index + 1} de ${stage.total}: ${stage.label}`}
                  >
                    {Array.from({ length: stage.total }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-1.5 flex-1 rounded-full",
                          i <= stage.index ? "bg-biosensor" : "bg-muted",
                        )}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs">
                    <span className="font-semibold">
                      Día {episodeDay} · {stage.label}.
                    </span>{" "}
                    <span className="text-muted-foreground">{stage.note}</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Momentos memorables */}
          {!memories.empty && (
            <section
              aria-label="Momentos memorables"
              className="space-y-3 rounded-2xl border border-copper/25 bg-background/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-copper" aria-hidden="true" /> Momentos
                  memorables
                </h4>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void copyText(memories.text, "Recuerdos copiados")}
                  >
                    <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
                  </Button>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a
                      href={whatsappLink(null, memories.text)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Preparar los recuerdos en WhatsApp (tú eliges a quién enviarlos)"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" /> Compartir
                    </a>
                  </Button>
                </div>
              </div>
              <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
                {moments.map((m, i) => (
                  <li
                    key={m.id}
                    style={{ animationDelay: `${Math.min(i, 5) * 80}ms` }}
                    className="w-52 shrink-0 snap-start rounded-2xl border border-border bg-gradient-to-br from-copper/10 to-background p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:fill-mode-backwards motion-safe:duration-500"
                  >
                    <p className="text-xs font-medium text-copper">{dateEs(m.at)}</p>
                    <p className="mt-1 font-display text-sm font-semibold leading-snug">
                      {m.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{m.body}</p>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Solo buenos momentos que ya constan: sin nombres, avisos ni datos de salud.
              </p>
            </section>
          )}

          {/* Metas de la semana */}
          {def.goals.length > 0 &&
            (goals ? (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Metas pequeñas de esta semana</h4>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {goals.map((g) => (
                    <li key={g.id} className="rounded-xl border border-border bg-background/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{g.label}</span>
                        {g.met ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Lograda
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{goalLine(g)}</span>
                        )}
                      </div>
                      <div
                        role="progressbar"
                        aria-label={g.label}
                        aria-valuemin={0}
                        aria-valuemax={g.target}
                        aria-valuenow={Math.min(g.days, g.target)}
                        aria-valuetext={goalLine(g)}
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className={cn(
                            "h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500",
                            g.met ? "bg-ok" : "bg-biosensor",
                          )}
                          style={{ width: `${Math.min(100, (g.days / g.target) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">{g.hint}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Metas pequeñas de la semana, calculadas con los partes del turno.
                </span>
                <UpgradeCta min="essential_monthly" compact />
              </div>
            ))}

          {/* Qué mirar y cuándo llamar */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Eye className="h-4 w-4 text-trust" aria-hidden="true" /> Qué conviene mirar
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm">
                {def.watch.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-trust"
                    />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-sos/30 bg-sos/5 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-sos">
                <Phone className="h-4 w-4" aria-hidden="true" /> Llama a tu equipo médico el mismo
                día si…
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm">
                {def.callSameDay.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sos"
                    />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">{EMERGENCY_LINE}</p>
              <Button asChild variant="destructive" size="sm" className="mt-2 gap-1.5">
                <a href={EMERGENCY_TEL} aria-label={`Llamar al ${EMERGENCY_NUMBER}`}>
                  <Phone className="h-4 w-4" aria-hidden="true" /> Llamar al {EMERGENCY_NUMBER}
                </a>
              </Button>
            </div>
          </div>

          {/* Carta de la semana */}
          <div className="space-y-3 rounded-2xl border border-copper/30 bg-copper/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Share2 className="h-4 w-4 text-copper" aria-hidden="true" /> Carta de la semana
                para tu círculo
              </h4>
              {!premium && (
                <span className="text-xs text-muted-foreground">
                  Con el plan Familiar suma comidas, medicamentos y ánimo.
                </span>
              )}
            </div>
            {letter.empty ? (
              <p className="text-sm text-muted-foreground">
                Cuando haya un servicio esta semana, aquí queda lista una carta corta para contarle
                a la familia cómo estuvo.
              </p>
            ) : (
              <>
                <pre
                  aria-label="Vista previa de la carta"
                  className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3 font-sans text-sm"
                >
                  {letter.text}
                </pre>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={includeName && canNameChild}
                      onCheckedChange={setIncludeName}
                      disabled={!canNameChild || !personName}
                      aria-label="Incluir el nombre de la persona"
                    />
                    Incluir el nombre
                    {!canNameChild && (
                      <span className="text-xs text-muted-foreground">(no se usa con menores)</span>
                    )}
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={includeTeam}
                      onCheckedChange={setIncludeTeam}
                      aria-label="Incluir quién los acompañó"
                    />
                    Incluir quién los acompañó
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{LETTER_SHARE_NOTICE}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void copyText(letter.text, "Carta copiada")}
                  >
                    <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
                  </Button>
                  <Button asChild size="sm" className="gap-1.5">
                    <a
                      href={whatsappLink(null, letter.text)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Preparar la carta en WhatsApp (tú eliges a quién enviarla)"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" /> Preparar en WhatsApp
                    </a>
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Hoja para la cita */}
          <div className="space-y-2 rounded-2xl border border-border bg-background/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{visit.title}</h4>
              {visit.hasReportData ? (
                <span className="text-xs text-ok">Incluye lo que cambió en los partes</span>
              ) : !premium ? (
                <span className="text-xs text-muted-foreground">
                  Con el plan Familiar añade lo que cambió en los partes.
                </span>
              ) : null}
            </div>
            {visit.sections
              .filter((s) => s.heading === "Preguntas para llevar" || s.heading === "Lo que cambió")
              .map((s) => (
                <div key={s.heading}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.heading}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {s.items.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void copyText(visit.text, "Hoja copiada")}
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => downloadText(`hoja-para-la-cita-${fileDate(now)}.txt`, visit.text)}
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Descargar
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{ROUTE_DISCLAIMER}</p>
        </>
      )}
    </Card>
  );
}
