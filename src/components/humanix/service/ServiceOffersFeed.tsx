import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  HandCoins,
  ListFilter,
  MapPin,
  RefreshCw,
  Search,
  Star,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TrustBadge } from "@/components/humanix/TrustBadge";
import { useServiceOffersFeed } from "@/hooks/use-service-offers";
import { MODALITY_NAME, isOfferModality } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import {
  AVAILABILITY_LABEL,
  DEFAULT_SERVICE_FILTERS,
  applyServiceOfferFilters,
  distinctServiceOfferCities,
  hasActiveServiceFilters,
  serviceOfferPriceLabel,
  type ServiceOffer,
  type ServiceOfferFilters,
} from "@/lib/serviceOffers";
import { distanceBandLabel } from "@/lib/trustScore";
import { cn } from "@/lib/utils";

const INITIAL_VISIBLE = 6;

const AVAILABILITY_STYLE = {
  available: "border-ok/40 bg-ok/10 text-ok",
  busy: "border-warn/40 bg-warn/10 text-warn",
  unavailable: "border-border bg-muted text-muted-foreground",
} as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "P";

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

function ServiceOfferCard({ offer }: { offer: ServiceOffer }) {
  const hasRating = offer.rating.stars != null;
  return (
    <Card className="space-y-3 p-4" aria-label={`Oferta de ${offer.name}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-11 w-11">
          {offer.avatarUrl && <AvatarImage src={offer.avatarUrl} alt="" />}
          <AvatarFallback className="text-xs">{initials(offer.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            {offer.name}
            {offer.rethusVerified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> RETHUS verificado
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {[offer.specialty, offer.city].filter(Boolean).join(" · ")}
            {offer.distanceBand != null && (
              <span data-testid="distance-band"> · {distanceBandLabel(offer.distanceBand)}</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge
            variant="outline"
            className={cn("text-[11px]", AVAILABILITY_STYLE[offer.availability])}
          >
            {AVAILABILITY_LABEL[offer.availability]}
          </Badge>
          {offer.live && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">{offer.title}</p>
        {offer.description && (
          <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{offer.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <TrustBadge kind="professional" summary={offer.trust} />
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
            hasRating ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted-foreground",
          )}
        >
          <Star className={cn("h-3 w-3", hasRating && "fill-current")} aria-hidden />
          {hasRating
            ? `${offer.rating.stars?.toFixed(1)}${offer.rating.jobs > 0 ? ` · ${offer.rating.jobs} servicios` : ""}`
            : "Sin calificaciones aún"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" data-testid="service-offer-price">
          {serviceOfferPriceLabel(offer)}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/profesional/$proId" params={{ proId: offer.professionalId }}>
            Ver perfil
          </Link>
        </Button>
      </div>
    </Card>
  );
}

/**
 * «Profesionales que se ofrecen»: las ofertas de servicio que publican los profesionales, con su Trust Score, RETHUS, calificación,
 * estado en vivo y cercanía por rangos. No trae teléfono ni dirección: el perfil público es donde se reserva y se paga (en la página
 * web, nunca por WhatsApp).
 */
export function ServiceOffersFeed({
  viewerId,
  audience,
  title = "Profesionales que se ofrecen",
}: {
  viewerId: string;
  audience: "family" | "institution";
  title?: string;
}) {
  const feed = useServiceOffersFeed(viewerId);
  const [filters, setFilters] = useState<ServiceOfferFilters>(DEFAULT_SERVICE_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const set = <K extends keyof ServiceOfferFilters>(key: K, value: ServiceOfferFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const all = feed.data;
  const cities = useMemo(() => (all ? distinctServiceOfferCities(all) : []), [all]);
  const visible = useMemo(
    () => (all ? applyServiceOfferFilters(all, filters) : []),
    [all, filters],
  );
  const shown = showAll ? visible : visible.slice(0, INITIAL_VISIBLE);

  if (feed.isLoading) {
    return (
      <div
        className="space-y-3"
        aria-busy="true"
        aria-label="Cargando profesionales que se ofrecen"
      >
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (feed.error || !all) {
    const message = feed.error?.message ?? "";
    const notReady = /list_open_service_offers|schema cache|Could not find the function/i.test(
      message,
    );
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
          {notReady
            ? "Estamos activando las ofertas de profesionales"
            : "No pudimos cargar las ofertas de profesionales"}
        </p>
        <p className="text-muted-foreground">
          {notReady
            ? "Esta función se está habilitando en tu cuenta. Vuelve a intentarlo en unos minutos."
            : message || "Revisa tu conexión e inténtalo de nuevo."}
        </p>
        <Button size="sm" variant="outline" onClick={() => void feed.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reintentar
        </Button>
      </Card>
    );
  }

  const { summary } = feed;

  return (
    <section
      id="profesionales-ofrecen"
      className="scroll-mt-4 space-y-4"
      aria-label="Profesionales que se ofrecen"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Briefcase className="h-4 w-4 text-biosensor" aria-hidden /> {title}
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {audience === "family"
              ? "Profesionales de la salud que publican su servicio y su valor. Mira su Trust Score, su RETHUS y su calificación, y escoge a quien mejor se ajuste a tu familia."
              : "Profesionales de la salud que publican su servicio y su valor. Compara su Trust Score, RETHUS, calificación y cercanía para reforzar tus equipos."}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void feed.refetch()}
          aria-label="Actualizar las ofertas de profesionales"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {all.length === 0 ? (
        <Card className="space-y-2 p-6 text-center text-sm">
          <p className="font-semibold">Aún no hay profesionales con una oferta publicada</p>
          <p className="text-xs text-muted-foreground">
            Cuando un profesional publique la suya, aparecerá aquí con su Trust Score.{" "}
            <Link to="/buscar" className="font-medium text-biosensor hover:underline">
              Buscar profesionales
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              icon={<Users className="h-3 w-3" aria-hidden />}
              label="Ofertas"
              value={String(summary.total)}
            />
            <Stat
              icon={<span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />}
              label="Disponibles ahora"
              value={String(summary.available)}
            />
            <Stat
              icon={<HandCoins className="h-3 w-3" aria-hidden />}
              label="Valor por hora"
              value={
                summary.hourly
                  ? summary.hourly.min === summary.hourly.max
                    ? formatCOP(summary.hourly.min)
                    : `${formatCOP(summary.hourly.min)} – ${formatCOP(summary.hourly.max)}`
                  : "—"
              }
            />
            <Stat
              icon={<MapPin className="h-3 w-3" aria-hidden />}
              label="El más cercano"
              value={summary.nearestBand != null ? distanceBandLabel(summary.nearestBand) : "—"}
            />
          </div>

          <Card className="space-y-3 p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="relative sm:col-span-2">
                <Search
                  className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  className="pl-8"
                  placeholder="Buscar por especialidad, cuidado o nombre"
                  value={filters.query}
                  onChange={(e) => set("query", e.target.value)}
                  aria-label="Buscar ofertas de profesionales"
                />
              </div>
              <Select
                value={filters.city || "all"}
                onValueChange={(v) => set("city", v === "all" ? "" : v)}
              >
                <SelectTrigger aria-label="Ciudad del profesional">
                  <SelectValue placeholder="Ciudad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.sort}
                onValueChange={(v) => set("sort", v as ServiceOfferFilters["sort"])}
              >
                <SelectTrigger aria-label="Ordenar profesionales por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nearest">Más cerca de ti</SelectItem>
                  <SelectItem value="trust">Mayor Trust Score</SelectItem>
                  <SelectItem value="rating">Mejor calificados</SelectItem>
                  <SelectItem value="price">Más económicos por hora</SelectItem>
                  <SelectItem value="recent">Más nuevas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <Select
                value={filters.modality}
                onValueChange={(v) =>
                  set("modality", v === "all" ? "all" : isOfferModality(v) ? v : "all")
                }
              >
                <SelectTrigger className="h-8 w-40" aria-label="Modalidad de cobro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las modalidades</SelectItem>
                  {(["hour", "shift", "month", "package"] as const).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODALITY_NAME[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2">
                <Switch
                  checked={filters.availableOnly}
                  onCheckedChange={(v) => set("availableOnly", v)}
                  aria-label="Solo profesionales disponibles ahora"
                />
                Solo disponibles
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={filters.rethusOnly}
                  onCheckedChange={(v) => set("rethusOnly", v)}
                  aria-label="Solo con RETHUS verificado"
                />
                Solo con RETHUS
              </label>
              <label className="flex items-center gap-2">
                Hasta
                <Input
                  className="h-8 w-28"
                  type="number"
                  inputMode="numeric"
                  step={500}
                  placeholder="$ / hora"
                  value={filters.maxHourly ?? ""}
                  onChange={(e) =>
                    set("maxHourly", e.target.value === "" ? null : Number(e.target.value))
                  }
                  aria-label="Valor máximo por hora"
                />
              </label>
              {hasActiveServiceFilters(filters) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFilters(DEFAULT_SERVICE_FILTERS)}
                >
                  <ListFilter className="mr-1 h-3.5 w-3.5" aria-hidden /> Limpiar filtros
                </Button>
              )}
            </div>
          </Card>

          {visible.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Ninguna oferta coincide con los filtros.{" "}
              <button
                type="button"
                className="font-medium text-biosensor hover:underline"
                onClick={() => setFilters(DEFAULT_SERVICE_FILTERS)}
              >
                Ver todas
              </button>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="service-offers">
              {shown.map((o) => (
                <ServiceOfferCard key={o.id} offer={o} />
              ))}
              {visible.length > INITIAL_VISIBLE && (
                <div className="text-center">
                  <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Ver menos" : `Ver ${visible.length - INITIAL_VISIBLE} más`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
