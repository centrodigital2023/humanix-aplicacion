import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_OFFER_FILTERS,
  hasActiveOfferFilters,
  type OfferFilters,
  type OfferParty,
} from "@/lib/institutionOffers";
import { MODALITY_NAME, isOfferModality } from "@/lib/institutionNegotiation";

const COPY: Record<
  OfferParty,
  { placeholder: string; searchLabel: string; verified: string; verifiedLabel: string }
> = {
  institution: {
    placeholder: "Buscar servicio, institución o especialidad (UCI, urgencias…)",
    searchLabel: "Buscar ofertas de instituciones",
    verified: "Solo verificadas",
    verifiedLabel: "Solo instituciones verificadas",
  },
  family: {
    placeholder: "Buscar cuidado, familia o especialidad (adulto mayor, curaciones…)",
    searchLabel: "Buscar ofertas de familias",
    verified: "Solo con identidad verificada",
    verifiedLabel: "Solo familias con identidad verificada",
  },
};

interface Props {
  filters: OfferFilters;
  onChange: (next: OfferFilters) => void;
  cities: string[];
  party: OfferParty;
  /** Solo las ofertas con turnos pueden cruzarse con la agenda del profesional. */
  showConflicts?: boolean;
}

/** Búsqueda, ciudad, orden y filtros de las ofertas que ve el profesional (instituciones y familias). */
export function OfferFilterBar({ filters, onChange, cities, party, showConflicts = true }: Props) {
  const copy = COPY[party];
  const set = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder={copy.placeholder}
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            aria-label={copy.searchLabel}
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
        <Select value={filters.sort} onValueChange={(v) => set("sort", v as OfferFilters["sort"])}>
          <SelectTrigger aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="match">Mejor compatibilidad</SelectItem>
            <SelectItem value="soonest">Más próximos</SelectItem>
            <SelectItem value="nearest">Más cerca de ti</SelectItem>
            <SelectItem value="hourly">Mejor pago por hora</SelectItem>
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
            aria-label={copy.verifiedLabel}
          />
          {copy.verified}
        </label>
        {showConflicts && (
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.hideConflicts}
              onCheckedChange={(v) => set("hideConflicts", v)}
              aria-label="Ocultar cruces de agenda"
            />
            Ocultar cruces con mi agenda
          </label>
        )}
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
        {hasActiveOfferFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_OFFER_FILTERS)}>
            <ListFilter className="mr-1 h-3.5 w-3.5" aria-hidden /> Limpiar filtros
          </Button>
        )}
      </div>
    </Card>
  );
}
