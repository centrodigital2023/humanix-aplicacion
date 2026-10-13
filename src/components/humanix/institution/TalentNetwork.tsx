// «Red de profesionales» de una EPS / IPS: contadores reales en vivo (disponibles, en vivo, ocupados de los registrados), el mapa en tiempo real
// de los profesionales cercanos y las ofertas de servicio que ellos publican, con su Trust Score. Los datos salen de las funciones seguras
// de la base: la posición siempre llega en cuadrícula de ~1 km, sin teléfono ni dirección.
import { LivePulseBar } from "@/components/humanix/LivePulseBar";
import { LiveMapSection } from "@/components/humanix/LiveMapSection";
import { ServiceOffersFeed } from "@/components/humanix/service/ServiceOffersFeed";

export function TalentNetwork({ userId }: { userId: string }) {
  return (
    <div className="space-y-5" data-testid="talent-network">
      <LivePulseBar role="institution" />
      <LiveMapSection role="institution" userId={userId} height={420} />
      <div className="rounded-2xl border border-border bg-card/95 p-4">
        <ServiceOffersFeed viewerId={userId} audience="institution" />
      </div>
    </div>
  );
}
