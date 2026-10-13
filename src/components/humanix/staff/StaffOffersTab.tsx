// Módulo «ofertas» del personal: las ofertas de la institución, publicar turnos y responder postulaciones.
// Todo corre con las MISMAS funciones de la institución (la base de datos actúa como la institución solo si la persona es de su equipo,
// está activa, tiene este módulo y la institución conserva el plan). Los contratos no se ven ni se firman aquí.
import { useMemo, useState } from "react";
import { BadgeCheck, CalendarClock, Inbox, Plus, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApplicantsInbox } from "@/components/humanix/hub/ApplicantsInbox";
import { PublishShiftsDialog } from "@/components/humanix/hub/PublishShiftsDialog";
import { useCoverageOffers } from "@/hooks/use-institution-hub";
import { MODALITY_LABEL } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import { summarizeStaffOffers, type StaffOfferSummary } from "@/lib/staffPanel";

const WHEN = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function modalityLabel(modality: string): string {
  return (MODALITY_LABEL as Record<string, string>)[modality] ?? "";
}

function OfferRow({ offer }: { offer: StaffOfferSummary }) {
  const covered = offer.status === "filled";
  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      data-testid="staff-offer-row"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {offer.title}
          {offer.urgent && (
            <Badge variant="outline" className="border-sos/40 text-sos">
              <Siren className="mr-1 h-3 w-3" aria-hidden /> Urgente
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {offer.city} · {formatCOP(offer.amount)} {modalityLabel(offer.modality)}
        </p>
        {offer.nextShiftAt && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Próximo turno:{" "}
            {WHEN.format(new Date(offer.nextShiftAt))}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        {offer.positions > 0 && (
          <span
            className="text-muted-foreground"
            aria-label={`${offer.filled} de ${offer.positions} cupos cubiertos`}
          >
            {offer.filled}/{offer.positions} cupos
          </span>
        )}
        <Badge
          variant={covered ? "secondary" : "outline"}
          className={covered ? "text-ok" : "text-biosensor"}
        >
          {covered ? (
            <>
              <BadgeCheck className="mr-1 h-3 w-3" aria-hidden /> Cubierta
            </>
          ) : (
            "Recibiendo postulaciones"
          )}
        </Badge>
      </div>
    </li>
  );
}

export function StaffOffersTab({
  institutionId,
  defaultCity,
}: {
  institutionId: string;
  defaultCity?: string | null;
}) {
  const offers = useCoverageOffers(institutionId);
  const [publishOpen, setPublishOpen] = useState(false);
  const summary = useMemo(() => summarizeStaffOffers(offers.data ?? []), [offers.data]);

  return (
    <div className="space-y-5" data-testid="staff-offers">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Ofertas y postulaciones</h2>
          <p className="text-sm text-muted-foreground">
            Publica turnos y responde a quienes se postulan, en nombre de la institución.
          </p>
        </div>
        <Button variant="hero" onClick={() => setPublishOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Publicar turnos
        </Button>
      </div>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">Ofertas de la institución</h3>
        {offers.isLoading ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : offers.error ? (
          <p role="alert" className="py-3 text-sm text-sos">
            No pudimos cargar las ofertas. Revisa tu conexión e inténtalo de nuevo.
          </p>
        ) : summary.length === 0 ? (
          <p
            className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
            data-testid="staff-offers-empty"
          >
            <Inbox className="h-4 w-4" aria-hidden /> Aún no hay ofertas abiertas. Publica los
            primeros turnos.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {summary.map((o) => (
              <OfferRow key={o.id} offer={o} />
            ))}
          </ul>
        )}
      </Card>

      <ApplicantsInbox userId={institutionId} readOnlyContracts />

      <PublishShiftsDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        defaultCity={defaultCity ?? undefined}
        onPublished={() => void offers.refetch()}
      />
    </div>
  );
}
