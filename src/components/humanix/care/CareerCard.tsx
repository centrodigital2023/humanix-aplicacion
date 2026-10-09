// Mi trayectoria (profesional): nivel, sellos, racha, gracias recibidos y cómo compartirla. Las cifras salen del
// servidor (servicios completados en la plataforma): nada se autodeclara. El pasaporte imprimible es del plan Pro.
import { useState } from "react";
import { Award, Clock, Flame, Heart, HeartHandshake, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeCta } from "@/components/humanix/PlanGate";
import { useMyCareerStats, useReceivedKudos } from "@/hooks/use-care-loop";
import { usePlan } from "@/hooks/use-plan";
import {
  careerLevel,
  careerShareText,
  computeBadges,
  nextBadgeHint,
  streakWeeks,
} from "@/lib/careerStats";
import { kudosEmoji, kudosLabel, publicProfileUrl } from "@/lib/kudos";
import { BadgeTile } from "./BadgeTile";
import { CareerPassportDialog } from "./CareerPassportDialog";
import { ShareTextButtons } from "./ShareTextButtons";

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      <Icon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <p className="mt-1 font-display text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

export function CareerCard({
  userId,
  fullName,
  specialty,
  verified,
}: {
  userId: string;
  fullName: string;
  specialty: string | null;
  verified: boolean;
}) {
  const stats = useMyCareerStats(userId);
  const received = useReceivedKudos(userId, 3);
  const plan = usePlan(userId);
  const [passportOpen, setPassportOpen] = useState(false);

  if (stats.isLoading) return <Skeleton className="h-56 w-full" />;
  // Antes de aplicar la migración la función no existe: no se muestra un error al usuario.
  if (stats.error || !stats.data) return null;

  const s = stats.data;
  const level = careerLevel(s.completedServices);
  const badges = computeBadges(s);
  const hint = nextBadgeHint(badges);
  const streak = streakWeeks(s.weekStarts);
  const url = publicProfileUrl(userId);
  const fromClients = (received.data ?? []).filter((k) => k.from_role === "client");

  return (
    <Card className="space-y-5 p-4 sm:p-5" aria-label="Mi trayectoria">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Trophy className="h-5 w-5 text-copper" aria-hidden="true" /> Mi trayectoria
          </h2>
          <p className="text-xs text-muted-foreground">
            Calculada con tus servicios completados en Humanix.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-copper/10 px-3 py-1 text-xs font-bold text-copper">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Nivel {level.level} ·{" "}
          {level.label}
        </span>
      </div>

      <div>
        <Progress
          value={Math.round(level.progress * 100)}
          className="h-2"
          aria-label={`Avance hacia el nivel ${level.next?.level ?? level.level}`}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {level.next
            ? `Te ${level.remaining === 1 ? "falta" : "faltan"} ${level.remaining} ${level.remaining === 1 ? "servicio" : "servicios"} para «${level.next.label}».`
            : "Llegaste al nivel más alto. Gracias por cuidar."}
        </p>
      </div>

      {s.completedServices === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Completa tu primer servicio para empezar tu trayectoria: horas de cuidado, familias que
          vuelven, gracias y sellos.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat icon={Award} label="Servicios" value={String(s.completedServices)} />
          <Stat icon={Clock} label="Horas" value={String(Math.floor(s.hoursTotal))} />
          <Stat icon={Heart} label="Vuelven" value={String(s.repeatClients)} />
          <Stat icon={HeartHandshake} label="Gracias" value={String(s.kudosTotal)} />
          <Stat icon={Flame} label="Racha (sem.)" value={String(streak)} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Sellos</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {badges.map((b) => (
            <BadgeTile key={b.id} badge={b} />
          ))}
        </ul>
        {hint && <p className="mt-2 text-xs font-medium text-copper">{hint}</p>}
      </div>

      {fromClients.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Lo último que te agradecieron</h3>
          <ul className="space-y-2">
            {fromClients.map((k) => (
              <li key={k.id} className="rounded-xl border border-border bg-card p-3">
                <p className="text-sm font-semibold">💛 {k.from_name}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {k.kinds.map((kind) => (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1 rounded-full bg-copper/10 px-2 py-0.5 text-[11px] font-medium text-copper"
                    >
                      <span aria-hidden="true">{kudosEmoji(kind)}</span> {kudosLabel(kind)}
                    </span>
                  ))}
                </p>
                {k.message && (
                  <p className="mt-1.5 text-sm italic text-foreground/90">«{k.message}»</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.completedServices > 0 && (
        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <p className="text-sm font-semibold">Comparte tu trayectoria</p>
            <p className="text-xs text-muted-foreground">
              Tu perfil público muestra solo cifras agregadas, sin nombres de familias.
            </p>
          </div>
          <ShareTextButtons text={careerShareText(s, url)} whatsappLabel="Compartir por WhatsApp" />
          {plan.can("career_passport") ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPassportOpen(true)}
              >
                Pasaporte profesional (imprimir / PDF)
              </Button>
              <CareerPassportDialog
                open={passportOpen}
                onOpenChange={setPassportOpen}
                userId={userId}
                fullName={fullName}
                specialty={specialty}
                verified={verified}
                stats={s}
              />
            </>
          ) : (
            !plan.loading && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  El pasaporte imprimible con código QR es del plan Pro.
                </p>
                <UpgradeCta min="pro_monthly" compact />
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}
