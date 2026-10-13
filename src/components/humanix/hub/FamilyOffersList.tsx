import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Flame, HandCoins, Home, MapPin, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFamilyOffersFeed } from "@/hooks/use-family-offers";
import { usePlan } from "@/hooks/use-plan";
import {
  DEFAULT_OFFER_FILTERS,
  distinctOfferCities,
  type InstitutionOffer,
  type OfferFilters,
  type OfferMatch,
} from "@/lib/institutionOffers";
import { formatCOP } from "@/lib/pricing";
import { FREE_COMMISSION_PCT } from "@/lib/proIncome";
import { distanceBandLabel } from "@/lib/trustScore";
import { ApplyOfferDialog } from "./ApplyOfferDialog";
import { InstitutionOfferCard } from "./InstitutionOfferCard";
import { OfferFilterBar } from "./OfferFilterBar";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-0.5 text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Ofertas que publican las familias: las más cercanas y las mejor pagadas primero, con el Trust Score de la familia, la
 * negociación en curso y la postulación con el valor que tú propones (plan Esencial o superior). La dirección exacta llega con la
 * reserva aceptada; el WhatsApp, con plan Esencial o superior. Los pagos se hacen solo en la página web.
 */
export function FamilyOffersList({ userId }: { userId: string }) {
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_OFFER_FILTERS);
  const feed = useFamilyOffersFeed(userId, filters);
  const { plan, can, loading: planLoading } = usePlan(userId);
  const [applying, setApplying] = useState<{ offer: InstitutionOffer; match: OfferMatch } | null>(
    null,
  );

  const model = feed.model;
  const commissionPct = can("no_commission") ? 0 : FREE_COMMISSION_PCT;
  const cities = useMemo(() => (model ? distinctOfferCities(model.offers) : []), [model]);

  if (feed.isLoading || planLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando ofertas de familias">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (feed.error || !model) {
    const message = feed.error?.message ?? "";
    const notReady = /list_open_family_offers|schema cache|Could not find the function/i.test(
      message,
    );
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
          {notReady
            ? "Estamos activando las ofertas de familias"
            : "No pudimos cargar las ofertas de familias"}
        </p>
        <p className="text-muted-foreground">
          {notReady
            ? "Esta función se está habilitando en tu cuenta. Vuelve a intentarlo en unos minutos."
            : message || "Revisa tu conexión e inténtalo de nuevo."}
        </p>
        <Button size="sm" variant="outline" onClick={feed.refetch}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reintentar
        </Button>
      </Card>
    );
  }

  const { summary, bundle } = model;
  const noLocation = model.offers.length > 0 && model.offers.every((o) => o.distanceBand == null);

  return (
    <section className="space-y-4" aria-label="Ofertas de familias">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Home className="h-4 w-4 text-biosensor" aria-hidden /> Ofertas de familias
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Cuidado que las familias publican con su valor. Ordena por las más cercanas o las mejor
            pagadas, mira el Trust Score de la familia y postúlate; con plan Esencial o superior
            propones tu valor por hora y desbloqueas el contacto. Al aceptarte, la reserva queda con
            la dirección.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link to="/buscar" search={{ tab: "ofertas" }}>
              Marketplace →
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={feed.refetch}
            aria-label="Actualizar las ofertas de familias"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={<Send className="h-3 w-3" aria-hidden />}
          label="Para postularte"
          value={String(summary.open)}
        />
        <Stat
          icon={<Flame className="h-3 w-3" aria-hidden />}
          label="Urgentes"
          value={String(summary.urgent)}
        />
        <Stat
          icon={<HandCoins className="h-3 w-3" aria-hidden />}
          label="Mejor pago por hora"
          value={summary.bestHourly != null ? formatCOP(summary.bestHourly) : "—"}
        />
        <Stat
          icon={<MapPin className="h-3 w-3" aria-hidden />}
          label="La más cercana"
          value={summary.nearestBand != null ? distanceBandLabel(summary.nearestBand) : "—"}
        />
      </div>

      {noLocation && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          <span>
            Todavía no podemos medir qué tan cerca están: guarda tu ubicación en el mapa de tu panel
            (solo se muestra en rangos de distancia, nunca tu dirección) y ordenaremos por cercanía.
          </span>
        </p>
      )}

      {bundle.pro.cities.length === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          <span>
            Aún no indicaste en qué ciudades trabajas. Complétalo en tu perfil para que el puntaje
            de compatibilidad sea más preciso.
          </span>
        </p>
      )}

      <OfferFilterBar
        filters={filters}
        onChange={setFilters}
        cities={cities}
        party="family"
        showConflicts={false}
      />

      {model.ranked.length === 0 ? (
        <Card className="space-y-2 p-6 text-center text-sm">
          <p className="font-semibold">Aún no hay ofertas abiertas de familias</p>
          <p className="text-xs text-muted-foreground">
            Las familias publican a diario. Crea una alerta en la pestaña «Turnos de familias» y te
            avisamos cuando aparezca una que coincida contigo.
          </p>
        </Card>
      ) : model.visible.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Ninguna oferta coincide con los filtros.{" "}
          <button
            type="button"
            className="font-medium text-biosensor hover:underline"
            onClick={() => setFilters(DEFAULT_OFFER_FILTERS)}
          >
            Ver todas
          </button>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="family-offers">
          {model.visible.map((r) => (
            <InstitutionOfferCard
              key={r.offer.id}
              ranked={r}
              userId={userId}
              plan={plan}
              commissionPct={commissionPct}
              intro={bundle.intro}
              onApply={() => setApplying({ offer: r.offer, match: r.match })}
            />
          ))}
        </div>
      )}

      {plan === "free" && (
        <Card className="flex flex-col gap-2 border-biosensor/30 bg-biosensor/5 p-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>Plan Free:</strong> pagas {FREE_COMMISSION_PCT}% de comisión, te postulas al
            valor publicado y ves la dirección cuando te aceptan. Con <strong>Esencial</strong> (COP
            9.000/mes) no pagas comisión, propones tu valor por hora y desbloqueas el WhatsApp de la
            familia.
          </p>
          <Button asChild size="sm" variant="hero">
            <Link to="/planes">Ver planes</Link>
          </Button>
        </Card>
      )}

      {applying && (
        <ApplyOfferDialog
          key={applying.offer.id}
          offer={applying.offer}
          match={applying.match}
          open
          onOpenChange={(o) => !o && setApplying(null)}
          userId={userId}
          intro={bundle.intro}
          canNegotiate={can("negotiate_rate")}
          commissionPct={commissionPct}
        />
      )}
    </section>
  );
}
