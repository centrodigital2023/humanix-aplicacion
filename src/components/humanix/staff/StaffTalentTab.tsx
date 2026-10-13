// Módulo «talento» del personal (solo lectura): los números reales en vivo, el mapa de profesionales y las ofertas de servicio que ellos
// publican, con su Trust Score. El mapa va en modo visitante: no registra la ubicación de la persona ni la de la institución.
import { LivePulseBar } from "@/components/humanix/LivePulseBar";
import { LiveMapSection } from "@/components/humanix/LiveMapSection";
import { ServiceOffersFeed } from "@/components/humanix/service/ServiceOffersFeed";

export function StaffTalentTab({ viewerId }: { viewerId: string }) {
  return (
    <div className="space-y-5" data-testid="staff-talent">
      <div>
        <h2 className="font-display text-lg font-semibold">Red de profesionales</h2>
        <p className="text-sm text-muted-foreground">
          Quiénes están disponibles ahora y qué servicios ofrecen. Es solo de consulta.
        </p>
      </div>
      <LivePulseBar role="institution" />
      <LiveMapSection role="guest" height={380} />
      <div className="rounded-2xl border border-border bg-card/95 p-4">
        <ServiceOffersFeed viewerId={viewerId} audience="institution" />
      </div>
    </div>
  );
}
