import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Flame,
  ListFilter,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInstitutionFeed } from "@/hooks/use-institution-hub";
import { usePlan } from "@/hooks/use-plan";
import {
  DEFAULT_OFFER_FILTERS,
  distinctOfferCities,
  groupOffersByDay,
  type InstitutionOffer,
  type OfferFilters,
  type OfferMatch,
} from "@/lib/institutionOffers";
import { MODALITY_NAME, isOfferModality } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import { FREE_COMMISSION_PCT } from "@/lib/proIncome";
import { ApplyOfferDialog } from "./ApplyOfferDialog";
import { InstitutionOfferCard } from "./InstitutionOfferCard";

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
 * Agenda de EPS, IPS, clínicas, hospitales y hogares geriátricos: turnos abiertos sin dirección,
 * compatibilidad explicada, postulación al valor publicado, negociación (plan Esencial o superior) y
 * desbloqueo auditado del contacto. La dirección exacta llega con la reserva aceptada.
 */
export function InstitutionAgenda({ userId }: { userId: string }) {
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_OFFER_FILTERS);
  const feed = useInstitutionFeed(userId, filters);
  const { plan, can, loading: planLoading } = usePlan(userId);
  const [applying, setApplying] = useState<{ offer: InstitutionOffer; match: OfferMatch } | null>(
    null,
  );

  const model = feed.model;
  const commissionPct = can("no_commission") ? 0 : FREE_COMMISSION_PCT;
  const set = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const cities = useMemo(() => (model ? distinctOfferCities(model.offers) : []), [model]);
  const days = useMemo(() => (model ? groupOffersByDay(model.visible) : []), [model]);
  const hasFilters =
    filters.city !== "" ||
    filters.query !== "" ||
    filters.modality !== "all" ||
    filters.minHourly != null ||
    filters.urgentOnly ||
    filters.verifiedOnly ||
    filters.hideConflicts ||
    filters.hideApplied;

  if (feed.isLoading || planLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando agenda de instituciones">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (feed.error || !model) {
    const message = feed.error?.message ?? "";
    const notReady = /list_open_institution_offers|schema cache|Could not find the function/i.test(
      message,
    );
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
          {notReady
            ? "Estamos activando la agenda de instituciones"
            : "No pudimos cargar la agenda de instituciones"}
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
  const renderCard = (r: (typeof model.visible)[number]) => (
    <InstitutionOfferCard
      key={r.offer.id}
      ranked={r}
      userId={userId}
      plan={plan}
      commissionPct={commissionPct}
      intro={bundle.intro}
      onApply={() => setApplying({ offer: r.offer, match: r.match })}
    />
  );

  return (
    <section className="space-y-4" aria-label="Agenda de instituciones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <CalendarDays className="h-4 w-4 text-biosensor" aria-hidden /> Agenda de EPS, IPS y
            clínicas
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Turnos de hospitales, clínicas, IPS y hogares geriátricos verificados. Postúlate al
            valor publicado; con plan Esencial o superior negocias el valor y desbloqueas el
            contacto. Al aceptarte, la reserva queda con la dirección y el contrato para firmar.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={feed.refetch} aria-label="Actualizar la agenda">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={<CalendarDays className="h-3 w-3" aria-hidden />}
          label="Turnos para ti"
          value={String(summary.shifts)}
        />
        <Stat
          icon={<Clock className="h-3 w-3" aria-hidden />}
          label="Horas abiertas"
          value={`${summary.hours} h`}
        />
        <Stat
          icon={<Wallet className="h-3 w-3" aria-hidden />}
          label="Potencial bruto"
          value={summary.potentialEarnings > 0 ? formatCOP(summary.potentialEarnings) : "—"}
        />
        <Stat
          icon={<Flame className="h-3 w-3" aria-hidden />}
          label="Urgentes"
          value={String(summary.urgent)}
        />
      </div>

      {bundle.pro.cities.length === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          <span>
            Aún no indicaste en qué ciudades trabajas, así que no podemos medir qué tan cerca están
            los turnos. Complétalo en tu perfil para que el puntaje de compatibilidad sea más
            preciso.
          </span>
        </p>
      )}

      <Card className="space-y-3 p-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Buscar servicio, institución o especialidad (UCI, urgencias…)"
              value={filters.query}
              onChange={(e) => set("query", e.target.value)}
              aria-label="Buscar ofertas de instituciones"
            />
          </div>
          <Select
            value={filters.city || "all"}
            onValueChange={(v) => set("city", v === "all" ? "" : v)}
          >
            <SelectTrigger aria-label="Ciudad">
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
            onValueChange={(v) => set("sort", v as OfferFilters["sort"])}
          >
            <SelectTrigger aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Mejor compatibilidad</SelectItem>
              <SelectItem value="soonest">Más próximos</SelectItem>
              <SelectItem value="pay">Mayor pago total</SelectItem>
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
            <SelectTrigger className="h-8 w-40" aria-label="Modalidad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las modalidades</SelectItem>
              {(["shift", "hour", "month", "package"] as const).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODALITY_NAME[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.urgentOnly}
              onCheckedChange={(v) => set("urgentOnly", v)}
              aria-label="Solo urgentes"
            />
            Solo urgentes
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.verifiedOnly}
              onCheckedChange={(v) => set("verifiedOnly", v)}
              aria-label="Solo instituciones verificadas"
            />
            Solo verificadas
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.hideConflicts}
              onCheckedChange={(v) => set("hideConflicts", v)}
              aria-label="Ocultar cruces de agenda"
            />
            Ocultar cruces con mi agenda
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.hideApplied}
              onCheckedChange={(v) => set("hideApplied", v)}
              aria-label="Ocultar a las que ya me postulé"
            />
            Ocultar las que ya apliqué
          </label>
          <label className="flex items-center gap-2">
            Desde
            <Input
              className="h-8 w-28"
              type="number"
              inputMode="numeric"
              step={500}
              placeholder="$ / hora"
              value={filters.minHourly ?? ""}
              onChange={(e) =>
                set("minHourly", e.target.value === "" ? null : Number(e.target.value))
              }
              aria-label="Valor mínimo por hora"
            />
          </label>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_OFFER_FILTERS)}>
              <ListFilter className="mr-1 h-3.5 w-3.5" aria-hidden /> Limpiar filtros
            </Button>
          )}
        </div>
      </Card>

      {model.ranked.length === 0 ? (
        <Card className="space-y-2 p-6 text-center text-sm">
          <p className="font-semibold">Aún no hay turnos abiertos de instituciones</p>
          <p className="text-xs text-muted-foreground">
            Las instituciones publican sus turnos a diario. Crea una alerta en la agenda de familias
            (también avisa de turnos de instituciones) y te avisamos cuando aparezca uno que
            coincida contigo.
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
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Lista ({model.visible.length})</TabsTrigger>
            <TabsTrigger value="days">Agenda por día</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="space-y-3">
            {model.visible.map(renderCard)}
          </TabsContent>
          <TabsContent value="days" className="space-y-5">
            {days.map((d) => (
              <div key={d.dayKey} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {d.label} · {d.items.length} oferta(s)
                </h3>
                {d.items.map(renderCard)}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      )}

      {plan === "free" && (
        <Card className="flex flex-col gap-2 border-biosensor/30 bg-biosensor/5 p-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>Plan Free:</strong> pagas {FREE_COMMISSION_PCT}% de comisión, te postulas al
            valor publicado y ves la dirección cuando te aceptan. Con <strong>Esencial</strong> (COP
            9.000/mes) no pagas comisión, negocias el valor con la institución y desbloqueas su
            WhatsApp y cómo ingresar.
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
