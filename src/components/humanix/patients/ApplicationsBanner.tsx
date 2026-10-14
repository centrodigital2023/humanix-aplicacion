// «Acepta una postulación para iniciar coordinación»: las postulaciones aceptadas que aún no tienen caso, listas para empezar la coordinación
// con un clic. El nombre del profesional lo pone el servidor (con el plan Free se muestra abreviado).
import { ArrowRight, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AcceptedApplication } from "@/hooks/use-inst-care";
import { dayClockLabel } from "@/lib/instCare";
import { formatCOP } from "@/lib/pricing";

export function ApplicationsBanner({
  applications,
  now,
  onStartNew,
  onStartExisting,
}: {
  applications: AcceptedApplication[];
  now: number;
  /** Con un paciente nuevo. */
  onStartNew: (a: AcceptedApplication) => void;
  /** Con un paciente que ya está registrado. */
  onStartExisting: (a: AcceptedApplication) => void;
}) {
  if (applications.length === 0) return null;
  return (
    <Card
      className="rounded-2xl border-copper/30 bg-gradient-to-br from-copper/5 via-card to-card p-4"
      data-testid="applications-banner"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-copper/10 text-copper">
          <Handshake className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold">
            {applications.length === 1
              ? "Una postulación aceptada espera su caso"
              : `${applications.length} postulaciones aceptadas esperan su caso`}
          </p>
          <p className="text-xs text-muted-foreground">
            Inicia la coordinación y queda todo en un solo lugar.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {applications.slice(0, 4).map((a) => (
          <li
            key={a.application_id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <p className="truncate font-semibold">{a.offer_title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {a.professional_label ? `Con ${a.professional_label}` : "Profesional por confirmar"}
                {a.proposed_amount ? ` · ${formatCOP(a.proposed_amount)}` : ""} · aceptada{" "}
                {dayClockLabel(a.accepted_at, now)}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => onStartExisting(a)}>
                Para un paciente existente
              </Button>
              <Button type="button" size="sm" variant="copper" onClick={() => onStartNew(a)}>
                Con paciente nuevo <ArrowRight aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {applications.length > 4 && (
        <p className="mt-2 text-[11px] text-muted-foreground">Y {applications.length - 4} más.</p>
      )}
    </Card>
  );
}
