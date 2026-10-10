// Validación de mercado — solo superadmin. Cada formulario lleno de /validacion llega aquí y se tabula solo:
// perfiles, ¿paga hoy por algo similar?, disposición a pagar, alternativas, dónde buscan, palabras del dolor y
// beneficios. Las cifras se recalculan en vivo (Realtime) con funciones puras de `src/lib/marketValidation.ts`.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Download, Gift, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightsTab } from "@/components/humanix/validation/InsightsTab";
import { nf } from "@/components/humanix/validation/format";
import { Bar, Panel } from "@/components/humanix/validation/panels";
import { useValidationResponses } from "@/hooks/use-validation-responses";
import {
  CHANNEL_LABEL,
  PAY_LABEL,
  PROFILES,
  PROFILE_META,
  QUALITY_FLAG_LABEL,
  SIGNAL_TIER_LABEL,
  alternativesOf,
  filterRows,
  responsesFilename,
  responsesToCsv,
  signalOf,
  tabulate,
  tierFor,
  type ChannelValue,
  type CountedItem,
  type Profile,
  type ResponseRow,
  type RowFilter,
  type SignalTier,
} from "@/lib/marketValidation";

export const Route = createFileRoute("/superadmin/validacion")({
  head: () => ({
    meta: [
      { title: "Validación de mercado · Humanix" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ValidationDashboard,
});

const TIER_CLASS: Record<SignalTier, string> = {
  strong: "bg-ok/15 text-ok",
  medium: "bg-warn/15 text-warn",
  weak: "bg-destructive/15 text-destructive",
};

function RankTable({
  title,
  caption,
  head,
  items,
}: {
  title: string;
  caption?: string;
  head: string;
  items: CountedItem[];
}) {
  return (
    <Panel title={title} caption={caption}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{head}</TableHead>
            <TableHead className="text-right">Respuestas</TableHead>
            <TableHead className="w-40">% de quienes respondieron</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.name}>
              <TableCell className="font-semibold">{it.name}</TableCell>
              <TableCell className="text-right tabular-nums">{nf.format(it.count)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Bar pct={it.pct} label={`${it.pct}%`} />
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                    {it.pct}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                Aún no hay datos.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Panel>
  );
}

function contactOf(r: ResponseRow): string {
  return r.email ?? r.whatsapp ?? "—";
}

function dateEs(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Bogota",
  });
}

const PAY_SHORT = { yes: "Sí", no: "No", not_researched: "Sin investigar" } as const;
const PROFILE_SHORT: Record<Profile, string> = {
  familia: "Familia",
  ips_eps: "IPS / EPS",
  profesional: "Profesional",
};

function SignalBadge({ row }: { row: ResponseRow }) {
  const s = signalOf(row);
  if (s === null) return <span className="text-muted-foreground">—</span>;
  const tier = tierFor(s);
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${TIER_CLASS[tier]}`}
    >
      {s} · {SIGNAL_TIER_LABEL[tier]}
    </span>
  );
}

function downloadCsv(rows: ResponseRow[]) {
  const blob = new Blob([responsesToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = responsesFilename();
  a.click();
  URL.revokeObjectURL(url);
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function ValidationDashboard() {
  const { data, isLoading, isError, isFetching, refetch, live, truncated } =
    useValidationResponses();
  const rows = useMemo(() => data ?? [], [data]);
  const t = useMemo(() => tabulate(rows), [rows]);
  const [filter, setFilter] = useState<RowFilter>({
    profile: "all",
    verified: "all",
    tier: "all",
    q: "",
  });
  const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const [selected, setSelected] = useState<ResponseRow | null>(null);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando" />
      </div>
    );
  }

  const kpis = [
    {
      label: "Respuestas",
      value: nf.format(t.total),
      sub: `${nf.format(t.verified)} con contacto verificado (${t.verifiedPct}%)`,
    },
    {
      label: "Señal de demanda",
      value: `${t.avgSignal} / 100`,
      sub: `${t.tiers.strong} fuertes · ${t.tiers.medium} medias · ${t.tiers.weak} débiles`,
    },
    { label: "Disposición a pagar", value: `${t.avgWtp}%`, sub: `Mediana ${t.medianWtp}%` },
    {
      label: "Ya pagan por algo similar",
      value: `${t.payingPct}%`,
      sub: `${t.pays.yes} sí · ${t.pays.no} no · ${t.pays.not_researched} sin investigar`,
    },
    {
      label: "Beneficios del plan Esencial",
      value: `${nf.format(t.withBenefit)} emitidos`,
      sub: `${nf.format(t.redeemed)} canjeados`,
    },
  ];

  const recentComments = rows.filter((r) => r.comments && r.comments.trim()).slice(0, 12);

  return (
    <div className="min-h-screen bg-canvas p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-trust sm:text-4xl">
              Validación de mercado
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Cada formulario lleno de <strong>/validacion</strong> llega aquí y se tabula solo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${live ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground"}`}
              role="status"
            >
              <span
                className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-ok" : "bg-muted-foreground"}`}
                aria-hidden="true"
              />
              {live ? "En vivo" : "Sin conexión en vivo"}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="min-h-10 rounded-xl"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />{" "}
              Actualizar
            </Button>
            <Button
              type="button"
              onClick={() => downloadCsv(filtered)}
              disabled={filtered.length === 0}
              className="min-h-10 rounded-xl"
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Exportar a Excel (
              {filtered.length})
            </Button>
          </div>
        </header>

        {isError && (
          <p
            role="alert"
            className="rounded-2xl bg-destructive/10 p-4 text-sm font-semibold text-destructive"
          >
            No pudimos cargar las respuestas. Si acabas de publicar el formulario, confirma que la
            migración 20261011100000 esté aplicada.
          </p>
        )}

        {truncated && (
          <p role="status" className="rounded-2xl bg-warn/10 p-4 text-sm font-semibold text-warn">
            Se muestran las {nf.format(rows.length)} respuestas más recientes: hay más en la base y
            las cifras de abajo no las incluyen.
          </p>
        )}

        <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm"
            >
              <p className="text-sm font-semibold text-muted-foreground">{k.label}</p>
              <p className="mt-2 font-display text-2xl font-bold text-trust">{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
            </div>
          ))}
        </section>

        <Tabs defaultValue="hallazgos" className="space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="hallazgos">Hallazgos</TabsTrigger>
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="mercado">Mercado y competencia</TabsTrigger>
            <TabsTrigger value="dolor">Dolor y requisitos</TabsTrigger>
            <TabsTrigger value="respuestas">Respuestas ({nf.format(rows.length)})</TabsTrigger>
          </TabsList>

          <TabsContent value="hallazgos">
            <InsightsTab rows={rows} />
          </TabsContent>

          <TabsContent value="resumen" className="space-y-4">
            <Panel
              title="Por perfil"
              caption="Familias, IPS/EPS y profesionales: cuántos son, cuánto pagarían y qué tan fuerte es la señal."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Perfil</TableHead>
                    <TableHead className="text-right">Respuestas</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Verificados</TableHead>
                    <TableHead className="text-right">Señal media</TableHead>
                    <TableHead className="text-right">Pagarían (media / mediana)</TableHead>
                    <TableHead className="text-right">Ya pagan hoy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.byProfile.map((p) => (
                    <TableRow key={p.profile}>
                      <TableCell className="font-semibold">
                        <span aria-hidden="true">{PROFILE_META[p.profile].emoji} </span>
                        {p.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.pct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{p.verified}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.count ? p.avgSignal : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.count ? `${p.avgWtp}% / ${p.medianWtp}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.count ? `${p.payingPct}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Disposición a pagar" caption="Cuántas personas eligieron cada tramo.">
                <Table>
                  <TableBody>
                    {t.wtpBuckets.map((b) => (
                      <TableRow key={b.label}>
                        <TableCell className="w-28 font-semibold">{b.label}</TableCell>
                        <TableCell>
                          <Bar pct={b.pct} label={`${b.pct}%`} />
                        </TableCell>
                        <TableCell className="w-24 text-right tabular-nums">
                          {b.count}{" "}
                          <span className="text-xs text-muted-foreground">({b.pct}%)</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>

              <Panel title="Respuestas por día" caption="Últimos 14 días (hora de Colombia).">
                <Table>
                  <TableBody>
                    {t.daily.map((d) => {
                      const max = Math.max(1, ...t.daily.map((x) => x.count));
                      return (
                        <TableRow key={d.day}>
                          <TableCell className="w-28 text-muted-foreground">
                            {d.day.slice(5).split("-").reverse().join("/")}
                          </TableCell>
                          <TableCell>
                            <Bar
                              pct={Math.round((d.count / max) * 100)}
                              label={`${d.count} respuestas`}
                            />
                          </TableCell>
                          <TableCell className="w-12 text-right tabular-nums">{d.count}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Panel>
            </div>

            <RankTable
              title="Ciudades"
              caption="De dónde vienen las respuestas (campo opcional)."
              head="Ciudad"
              items={t.byCity}
            />
          </TabsContent>

          <TabsContent value="mercado" className="space-y-4">
            <Panel
              title="¿Actualmente pagan o invierten en una solución similar?"
              caption="Pregunta 3.1, por perfil."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Perfil</TableHead>
                    <TableHead className="text-right">{PAY_LABEL.yes}</TableHead>
                    <TableHead className="text-right">{PAY_LABEL.no}</TableHead>
                    <TableHead className="text-right">{PAY_LABEL.not_researched}</TableHead>
                    <TableHead className="text-right">Sin dato (formularios antiguos)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.byProfile.map((p) => (
                    <TableRow key={p.profile}>
                      <TableCell className="font-semibold">{p.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.pays.yes}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.pays.no}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.pays.not_researched}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.pays.unknown}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-bold">
                    <TableCell>Todos</TableCell>
                    <TableCell className="text-right tabular-nums">{t.pays.yes}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.pays.no}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.pays.not_researched}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {t.pays.unknown}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <RankTable
                title="Alternativas más mencionadas"
                caption="Pregunta 3.2: se unen los nombres parecidos (por ejemplo «whatsapp» y «grupos de WhatsApp»)."
                head="Alternativa"
                items={t.topAlternatives}
              />
              <RankTable
                title="Dónde buscan información o invierten"
                caption="Pregunta 3.3: lugares marcados y escritos."
                head="Lugar"
                items={t.topChannels}
              />
            </div>
          </TabsContent>

          <TabsContent value="dolor" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <RankTable
                title="Palabras que más se repiten"
                caption="En el problema, el beneficio y los comentarios (sin palabras vacías)."
                head="Palabra"
                items={t.keywords}
              />
              <Panel
                title="Comentarios y requisitos recientes"
                caption="Pregunta 4.2: lo que necesitan para confiar y pagar."
              >
                <ul className="divide-y divide-border">
                  {recentComments.map((r) => (
                    <li key={r.id} className="p-4">
                      <p className="whitespace-pre-wrap text-sm">{r.comments}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {PROFILE_META[r.profile_type as Profile]?.label ?? r.profile_type}
                        {r.city ? ` · ${r.city}` : ""} · {dateEs(r.created_at)}
                      </p>
                    </li>
                  ))}
                  {recentComments.length === 0 && (
                    <li className="p-6 text-center text-muted-foreground">
                      Aún no hay comentarios.
                    </li>
                  )}
                </ul>
              </Panel>
            </div>
          </TabsContent>

          <TabsContent value="respuestas" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-[1.5rem] border border-border bg-card p-4">
              <div className="relative min-w-56 flex-1">
                <label
                  htmlFor="v-search"
                  className="mb-1 block text-xs font-bold text-muted-foreground"
                >
                  Buscar
                </label>
                <Search
                  className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="v-search"
                  value={filter.q ?? ""}
                  onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Nombre, contacto, ciudad o texto"
                  className="min-h-11 w-full rounded-xl border-2 border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-trust"
                />
              </div>
              {(
                [
                  {
                    id: "v-profile",
                    label: "Perfil",
                    key: "profile",
                    options: [["all", "Todos"], ...PROFILES.map((p) => [p, PROFILE_META[p].label])],
                  },
                  {
                    id: "v-verified",
                    label: "Contacto",
                    key: "verified",
                    options: [
                      ["all", "Todos"],
                      ["yes", "Verificado"],
                      ["no", "Sin verificar"],
                    ],
                  },
                  {
                    id: "v-tier",
                    label: "Señal",
                    key: "tier",
                    options: [
                      ["all", "Todas"],
                      ["strong", "Fuerte"],
                      ["medium", "Media"],
                      ["weak", "Débil"],
                    ],
                  },
                ] as const
              ).map((f) => (
                <div key={f.id}>
                  <label
                    htmlFor={f.id}
                    className="mb-1 block text-xs font-bold text-muted-foreground"
                  >
                    {f.label}
                  </label>
                  <select
                    id={f.id}
                    value={(filter[f.key] as string) ?? "all"}
                    onChange={(e) => setFilter((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="min-h-11 rounded-xl border-2 border-border bg-background px-3 text-sm outline-none focus:border-trust"
                  >
                    {f.options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <Panel
              title="Respuestas"
              caption={`${nf.format(filtered.length)} de ${nf.format(rows.length)} registros. Toca una fila para leerla completa.`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "Fecha",
                      "Perfil",
                      "Nombre / contacto",
                      "¿Paga hoy?",
                      "Pagarían",
                      "Señal",
                      "Contacto",
                      "Beneficio",
                      "Ciudad",
                    ].map((h) => (
                      <TableHead key={h} className="whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow
                      key={r.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setSelected(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(r);
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateEs(r.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-semibold">
                        {PROFILE_SHORT[r.profile_type as Profile] ?? r.profile_type}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <p className="flex items-center gap-1.5 truncate font-semibold">
                          {r.quality_flags && r.quality_flags.length > 0 && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 shrink-0 text-warn"
                              aria-label={`Aviso de calidad: ${r.quality_flags
                                .map((f) => QUALITY_FLAG_LABEL[f] ?? f)
                                .join(", ")}`}
                            />
                          )}
                          <span className="truncate">{r.full_name ?? "—"}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{contactOf(r)}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.pays_currently && r.pays_currently in PAY_SHORT
                          ? PAY_SHORT[r.pays_currently as keyof typeof PAY_SHORT]
                          : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.willingness_pct ?? "—"}
                        {r.willingness_pct !== null && r.willingness_pct !== undefined ? "%" : ""}
                      </TableCell>
                      <TableCell>
                        <SignalBadge row={r} />
                      </TableCell>
                      <TableCell>
                        {r.contact_verified_at ? (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            Verificado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="whitespace-nowrap">
                            Sin verificar
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.premium_activated || r.redeemed_at ? (
                          <span className="inline-flex items-center gap-1 font-bold text-ok">
                            <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Canjeado
                          </span>
                        ) : r.promo_code ? (
                          <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                            {r.promo_code}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.city ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        {rows.length === 0 ? (
                          <>
                            Aún no hay respuestas. Comparte el enlace <strong>/validacion</strong>{" "}
                            para comenzar.
                          </>
                        ) : (
                          "Ninguna respuesta coincide con los filtros."
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.full_name ?? "Sin nombre"}</SheetTitle>
                <SheetDescription>
                  {PROFILE_META[selected.profile_type as Profile]?.label ?? selected.profile_type} ·{" "}
                  {dateEs(selected.created_at)}
                </SheetDescription>
              </SheetHeader>
              <dl className="mt-6 space-y-5">
                <Detail
                  label="Contacto"
                  value={`${contactOf(selected)}${selected.contact_verified_at ? " (verificado)" : " (sin verificar)"}`}
                />
                <Detail label="Ciudad" value={selected.city} />
                <Detail label="Señal de demanda" value={<SignalBadge row={selected} />} />
                <Detail label="2.1 Qué busca contratar u ofrecer" value={selected.service_offer} />
                <Detail label="2.2 Problema que le resuelve Humanix" value={selected.pain_point} />
                <Detail
                  label="2.3 Quiénes enfrentan la necesidad"
                  value={selected.target_customer}
                />
                <Detail label="2.4 Qué cambia en su día a día" value={selected.key_benefit} />
                <Detail
                  label="3.1 ¿Paga hoy por algo similar?"
                  value={
                    selected.pays_currently && selected.pays_currently in PAY_LABEL
                      ? PAY_LABEL[selected.pays_currently as keyof typeof PAY_LABEL]
                      : null
                  }
                />
                <Detail label="3.2 Alternativas" value={alternativesOf(selected).join("\n")} />
                <Detail
                  label="3.3 Dónde busca"
                  value={[
                    ...(selected.search_channels ?? []).map(
                      (c) => CHANNEL_LABEL[c as ChannelValue] ?? c,
                    ),
                    selected.retention_channels ?? "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
                <Detail
                  label="4.1 Disposición a pagar"
                  value={
                    selected.willingness_pct === null || selected.willingness_pct === undefined
                      ? null
                      : `${selected.willingness_pct}%`
                  }
                />
                <Detail label="4.2 Comentarios y requisitos" value={selected.comments} />
                {selected.quality_flags && selected.quality_flags.length > 0 && (
                  <Detail
                    label="Avisos de calidad"
                    value={selected.quality_flags.map((f) => QUALITY_FLAG_LABEL[f] ?? f).join(", ")}
                  />
                )}
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
