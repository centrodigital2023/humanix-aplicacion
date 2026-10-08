import { AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  CityBalanceRow,
  CityStatus,
  MarketKpis,
  RateStat,
  Recommendation,
  RecSeverity,
} from "@/lib/marketplaceInsights";
import { MIN_SAMPLE } from "@/lib/marketplaceInsights";
import { formatHours, formatPct } from "./format";
import type { MarketTab } from "./types";

const SEVERITY_STYLE: Record<RecSeverity, { box: string; label: string; text: string }> = {
  critical: { box: "border-red-500/40 bg-red-500/5", label: "Crítico", text: "text-red-600" },
  high: { box: "border-amber-500/40 bg-amber-500/5", label: "Alto", text: "text-amber-600" },
  medium: { box: "border-copper/40 bg-copper/5", label: "Medio", text: "text-copper" },
  info: { box: "border-border bg-card", label: "Info", text: "text-muted-foreground" },
};

const CITY_STYLE: Record<CityStatus, { label: string; cls: string }> = {
  supply_gap: {
    label: "Faltan profesionales",
    cls: "bg-red-500/10 text-red-700 border-red-500/30",
  },
  demand_gap: { label: "Falta demanda", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  balanced: {
    label: "Equilibrada",
    cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  },
  insufficient_data: { label: "Pocos datos", cls: "bg-muted text-muted-foreground border-border" },
};

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "ok";
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-bold ${tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-foreground"}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

const rateSub = (r: RateStat) =>
  r.rate === null
    ? `Se requieren ${MIN_SAMPLE}+ ofertas (hay ${r.cohort})`
    : `${r.filled} de ${r.cohort} ofertas`;

interface Props {
  kpis: MarketKpis;
  cities: CityBalanceRow[];
  recommendations: Recommendation[];
  onGoTab: (tab: MarketTab) => void;
}

export function MarketOverview({ kpis, cities, recommendations, onGoTab }: Props) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="mk-actions">
        <h2
          id="mk-actions"
          className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
        >
          Qué atender hoy
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {recommendations.map((r) => {
            const st = SEVERITY_STYLE[r.severity];
            return (
              <div key={r.id} className={`rounded-xl border p-4 ${st.box}`}>
                <div className="flex items-start gap-3">
                  {r.id === "ok" ? (
                    <CheckCircle2
                      className="h-5 w-5 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle className={`h-5 w-5 shrink-0 ${st.text}`} aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{r.title}</p>
                      <span className={`text-[10px] font-semibold uppercase ${st.text}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                  {r.tab !== "overview" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => onGoTab(r.tab)}
                    >
                      Ver <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="mk-kpis">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2
            id="mk-kpis"
            className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Liquidez del marketplace
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {kpis.open} abiertas
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {kpis.filled} cubiertas
          </Badge>
          {kpis.blocked > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {kpis.blocked} bloqueadas
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Cobertura a 7 días"
            value={formatPct(kpis.fill7.rate)}
            sub={rateSub(kpis.fill7)}
          />
          <Kpi
            label="Cobertura a 14 días"
            value={formatPct(kpis.fill14.rate)}
            sub={rateSub(kpis.fill14)}
          />
          <Kpi
            label="Cobertura a 30 días"
            value={formatPct(kpis.fill30.rate)}
            sub={rateSub(kpis.fill30)}
          />
          <Kpi
            label="Postulaciones por oferta"
            value={
              kpis.applicationsPerOffer === null
                ? "Datos insuficientes"
                : kpis.applicationsPerOffer.toFixed(1).replace(".", ",")
            }
          />
          <Kpi
            label="Mediana hasta 1.ª postulación"
            value={formatHours(kpis.medianHoursToFirstApplication)}
            sub={`${kpis.sampleFirstApplication} ofertas con postulantes`}
          />
          <Kpi
            label="Mediana hasta cubrir"
            value={formatHours(kpis.medianHoursToFill)}
            sub={`${kpis.sampleFill} ofertas cubiertas`}
          />
          <Kpi
            label="Abiertas sin postulantes +24 h"
            value={String(kpis.openWithoutApplications24h)}
            tone={kpis.openWithoutApplications24h > 0 ? "warn" : "ok"}
          />
          <Kpi
            label="Postulaciones sin respuesta +48 h"
            value={String(kpis.pendingApplicationsOver48h)}
            tone={kpis.pendingApplicationsOver48h > 0 ? "warn" : "ok"}
          />
        </div>
        <p className="mt-3 flex gap-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Cobertura a N días: de las ofertas creadas hace N días o más, la proporción que quedó
            cubierta dentro de ese plazo (postulación aceptada u oferta marcada como cubierta). Las
            tasas se muestran con {MIN_SAMPLE}+ ofertas y los tiempos (mediana) con 3+ casos; si no,
            «Datos insuficientes». Se analizan las ofertas de los últimos 90 días y las abiertas.
          </span>
        </p>
      </section>

      <section aria-labelledby="mk-cities">
        <h2
          id="mk-cities"
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Oferta y demanda por ciudad
        </h2>
        {cities.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Aún no hay ciudades con ofertas ni profesionales publicados.
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Ciudad</th>
                  <th className="px-3 py-2 text-right font-medium">Ofertas abiertas</th>
                  <th className="px-3 py-2 text-right font-medium">Profesionales disponibles</th>
                  <th className="px-3 py-2 text-right font-medium">Relación</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">Acción sugerida</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => (
                  <tr key={c.city_key} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 font-medium">{c.city_label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.open_offers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.professionals_available}
                      <span className="text-muted-foreground"> / {c.professionals_published}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.ratio === null ? "—" : c.ratio.toFixed(1).replace(".", ",")}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${CITY_STYLE[c.status].cls}`}
                      >
                        {CITY_STYLE[c.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {c.status === "balanced" || c.status === "insufficient_data" ? "—" : c.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Relación = ofertas abiertas ÷ profesionales disponibles (publicados, activos y marcados
          como disponibles que atienden la ciudad). «Disponibles / publicados».
        </p>
      </section>
    </div>
  );
}
