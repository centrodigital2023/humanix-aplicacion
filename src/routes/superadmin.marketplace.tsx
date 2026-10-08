import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Briefcase,
  FileCheck,
  Inbox,
  LayoutDashboard,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  LayoutGrid,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useSuperadmin } from "@/hooks/use-superadmin";
import { MarketOverview } from "@/components/humanix/marketplace/MarketOverview";
import { OffersPanel } from "@/components/humanix/marketplace/OffersPanel";
import { PqrsPanel } from "@/components/humanix/marketplace/PqrsPanel";
import { buildOfferInsights, buildTicketInsights } from "@/components/humanix/marketplace/insights";
import { relativeTime } from "@/components/humanix/marketplace/format";
import {
  OFFER_COLUMNS,
  TICKET_COLUMNS,
  type MarketTab,
  type TicketRow,
} from "@/components/humanix/marketplace/types";
import {
  buildRecommendations,
  computeMarketKpis,
  evaluateCityBalance,
  type ApplicationRow,
  type CityRowRaw,
  type OfferRow,
} from "@/lib/marketplaceInsights";
import { computePqrsKpis } from "@/lib/pqrsKpis";
import { categoryTrends } from "@/lib/pqrsRules";

export const Route = createFileRoute("/superadmin/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace · Superadmin" }] }),
  component: MarketplacePage,
});

const sb = supabase as unknown as SupabaseClient;

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: MessageSquare },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
];

const DAY = 86_400_000;
const MIGRATION = "20261008100000_pqrs_marketplace_intelligence.sql";
const LEGACY_TICKET_COLUMNS =
  "id,subject,description,type,ai_category,ai_priority,ai_sentiment,ai_summary,status,created_at,contact_email,contact_phone,contact_name,user_id,assigned_to,resolution,resolved_at";

interface LoadIssue {
  scope: string;
  message: string;
  hint?: string;
}

interface MarketData {
  offers: OfferRow[];
  apps: ApplicationRow[];
  tickets: TicketRow[];
  cities: CityRowRaw[];
}

const EMPTY: MarketData = { offers: [], apps: [], tickets: [], cities: [] };

const isMissingSchema = (e: { code?: string; message?: string } | null) =>
  !!e &&
  (e.code === "42703" ||
    e.code === "42883" ||
    e.code === "42P01" ||
    e.code === "PGRST202" ||
    /does not exist|could not find/i.test(e.message ?? ""));

function withTicketDefaults(row: Partial<TicketRow>): TicketRow {
  return {
    radicado: null,
    assigned_at: null,
    due_at: null,
    first_response_at: null,
    safety_level: "none",
    safety_categories: [],
    duplicate_of: null,
    ai_reply_draft: null,
    reply_draft_edited: null,
    resolved_at: null,
    resolution: null,
    contact_email: null,
    contact_phone: null,
    contact_name: null,
    user_id: null,
    assigned_to: null,
    ...row,
  } as TicketRow;
}

function MarketplacePage() {
  const { user, loading, logout } = useSuperadmin();
  const [tab, setTab] = useState<MarketTab>("overview");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<MarketData>(EMPTY);
  const [issues, setIssues] = useState<LoadIssue[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setFetching(true);
    const found: LoadIssue[] = [];
    const since = new Date(Date.now() - 90 * DAY).toISOString();

    const [offersRes, ticketsRes, citiesRes] = await Promise.all([
      sb
        .from("job_offers")
        .select(OFFER_COLUMNS)
        .or(`created_at.gte.${since},status.eq.open`)
        .order("created_at", { ascending: false })
        .limit(600),
      sb
        .from("pqrs_tickets")
        .select(TICKET_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(500),
      sb.rpc("marketplace_city_balance"),
    ]);

    let offers: OfferRow[] = [];
    if (offersRes.error) {
      found.push({
        scope: "Ofertas",
        message: offersRes.error.message,
        hint: "Revisa los permisos (RLS) de job_offers para el rol superadmin.",
      });
    } else {
      offers = (offersRes.data ?? []) as OfferRow[];
    }

    let tickets: TicketRow[] = [];
    if (ticketsRes.error && isMissingSchema(ticketsRes.error)) {
      found.push({
        scope: "PQRS",
        message: "La base de datos no tiene las columnas nuevas de PQRS.",
        hint: `Aplica la migración ${MIGRATION}. Mientras tanto se muestran los datos básicos, sin plazos ni señales de seguridad.`,
      });
      const legacy = await sb
        .from("pqrs_tickets")
        .select(LEGACY_TICKET_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(500);
      if (legacy.error) found.push({ scope: "PQRS", message: legacy.error.message });
      else tickets = ((legacy.data ?? []) as Partial<TicketRow>[]).map(withTicketDefaults);
    } else if (ticketsRes.error) {
      found.push({
        scope: "PQRS",
        message: ticketsRes.error.message,
        hint: "Revisa los permisos (RLS) de pqrs_tickets para el rol superadmin.",
      });
    } else {
      tickets = ((ticketsRes.data ?? []) as Partial<TicketRow>[]).map(withTicketDefaults);
    }

    let cities: CityRowRaw[] = [];
    if (citiesRes.error) {
      found.push({
        scope: "Oferta y demanda por ciudad",
        message: citiesRes.error.message,
        hint: isMissingSchema(citiesRes.error) ? `Aplica la migración ${MIGRATION}.` : undefined,
      });
    } else {
      cities = (citiesRes.data ?? []) as CityRowRaw[];
    }

    // Postulaciones de las ofertas cargadas, en lotes para no exceder el límite de la URL ni de filas.
    let apps: ApplicationRow[] = [];
    if (offers.length) {
      const ids = offers.map((o) => o.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      const results = await Promise.all(
        chunks.map((c) =>
          sb
            .from("applications")
            .select("job_offer_id,status,created_at,updated_at")
            .in("job_offer_id", c),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) found.push({ scope: "Postulaciones", message: failed.error.message });
      apps = results.flatMap((r) => (r.data ?? []) as ApplicationRow[]);
    }

    setData({ offers, apps, tickets, cities });
    setIssues(found);
    setLoadedAt(Date.now());
    setFetching(false);
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 500);
  }, [load]);

  useEffect(() => {
    if (!user) return;
    void load();
    // pqrs_tickets no se publica por Realtime (contiene datos personales): se refresca por intervalo
    // y cuando llega una notificación de PQRS prioritario.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const channel = sb
      .channel("superadmin-mkt")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_offers" }, scheduleReload)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { type?: string; title?: string };
          if (row.type === "pqrs_critical") {
            toast.warning(row.title ?? "PQRS prioritario", {
              description: "Revisa la cola de PQRS.",
            });
            scheduleReload();
          }
        },
      )
      .subscribe();
    return () => {
      clearInterval(interval);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      void sb.removeChannel(channel);
    };
  }, [user, load, scheduleReload]);

  const now = loadedAt ?? Date.now();
  const { offers, apps, tickets } = data;

  const kpis = useMemo(() => computeMarketKpis(offers, apps, now), [offers, apps, now]);
  const offerInsights = useMemo(() => buildOfferInsights(offers, apps, now), [offers, apps, now]);
  const ticketInsights = useMemo(() => buildTicketInsights(tickets, now), [tickets, now]);
  const cities = useMemo(() => evaluateCityBalance(data.cities), [data.cities]);
  const pqrsKpis = useMemo(() => computePqrsKpis(tickets, now), [tickets, now]);

  const recommendations = useMemo(() => {
    const live = offers.filter((o) => o.status === "open" && !o.blocked);
    const riskyOffers = live.filter((o) => {
      const r = offerInsights.get(o.id)?.maxRisk;
      return r === "high" || r === "medium";
    }).length;
    const urgentUncovered = live.filter((o) => offerInsights.get(o.id)?.urgentUncovered).length;
    const active = tickets.filter((t) => ticketInsights.get(t.id)?.active);
    return buildRecommendations({
      kpis,
      riskyOffers,
      urgentUncovered,
      cities,
      pqrs: {
        breached: pqrsKpis.breached,
        atRisk: pqrsKpis.atRisk,
        criticalSafety: pqrsKpis.criticalSafety,
        unclassified: active.filter((t) => !t.ai_summary).length,
        unassigned: active.filter((t) => t.status === "open" && !t.assigned_to).length,
        spikes: categoryTrends(tickets, now).filter((t) => t.spike),
      },
    });
  }, [offers, tickets, offerInsights, ticketInsights, kpis, cities, pqrsKpis, now]);

  const offersNeedingAttention = useMemo(
    () => [...offerInsights.values()].filter((i) => i.attention > 0).length,
    [offerInsights],
  );
  const pqrsUrgent = pqrsKpis.breached + pqrsKpis.criticalSafety;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold">Acceso restringido</h1>
          <p className="text-sm text-muted-foreground">
            Este módulo es exclusivo para administradores.
          </p>
          <div className="pt-2">
            <Link to="/admin" className="inline-flex">
              <Button variant="hero">Ir al acceso de administrador</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const empty =
    !fetching &&
    loadedAt !== null &&
    offers.length === 0 &&
    tickets.length === 0 &&
    issues.length === 0;

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Marketplace + PQRS"
      subtitle="Liquidez del mercado, matchmaking explicable y atención de PQRS con plazos y señales de seguridad."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Marketplace" }]}
      badge={{ label: "Marketplace", tone: "bio" }}
    >
      <div className="space-y-5">
        {issues.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Algunos datos no se pudieron
              cargar
            </p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {issues.map((i, idx) => (
                <li key={idx}>
                  <strong>{i.scope}:</strong> {i.message}
                  {i.hint && <span className="block text-muted-foreground">{i.hint}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {empty && (
          <Card className="flex gap-3 p-4 text-sm">
            <LayoutGrid className="mt-0.5 h-5 w-5 shrink-0 text-biosensor" aria-hidden="true" />
            <p>
              El panel está conectado, pero todavía no hay datos: no hay ofertas publicadas ni
              solicitudes PQRS. Las ofertas aparecen cuando familias o IPS/EPS publican, y las PQRS
              cuando alguien radica una desde <strong>/contacto</strong>.
            </p>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Buscar por título, ciudad, radicado o contacto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Buscar ofertas y solicitudes"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={fetching}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />{" "}
            Actualizar
          </Button>
          {loadedAt && (
            <span className="text-[11px] text-muted-foreground">
              Actualizado {relativeTime(new Date(loadedAt).toISOString())}
            </span>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as MarketTab)} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" className="gap-2">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> Resumen
            </TabsTrigger>
            <TabsTrigger value="offers" className="gap-2">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" /> Ofertas ({offers.length})
              {offersNeedingAttention > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-700">
                  {offersNeedingAttention}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="pqrs" className="gap-2">
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" /> PQRS ({pqrsKpis.active})
              {pqrsUrgent > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-700">
                  {pqrsUrgent}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <MarketOverview
              kpis={kpis}
              cities={cities}
              recommendations={recommendations}
              onGoTab={setTab}
            />
          </TabsContent>

          <TabsContent value="offers">
            <OffersPanel
              offers={offers}
              insights={offerInsights}
              search={search}
              now={now}
              onChanged={() => void load()}
            />
          </TabsContent>

          <TabsContent value="pqrs">
            <PqrsPanel
              tickets={tickets}
              insights={ticketInsights}
              userId={user.id}
              search={search}
              now={now}
              onChanged={() => void load()}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
