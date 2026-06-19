import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  Building2,
  Briefcase,
  Users,
  CheckCircle2,
  Inbox,
  Phone,
  Star,
  LayoutDashboard,
  CalendarDays,
  BarChart3,
  UserCircle,
  LogOut,
  X,
  ChevronRight,
  BadgeCheck,
  MapPin,
  Plus,
  RefreshCw,
  Bell,
  DollarSign,
  Target,
  Stethoscope,
  ClipboardList,
  Wallet,
  Sparkles,
  Heart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/humanix/Logo";
import { HiringCopilot } from "@/components/humanix/HiringCopilot";
import { EnhancedBulkOffersModule } from "@/components/humanix/EnhancedBulkOffersModule";
import { EnhancedPatientsModule } from "@/components/humanix/EnhancedPatientsModule";
import { EnhancedAgendaModule } from "@/components/humanix/EnhancedAgendaModule";
import { EnhancedReportsWithCRMModule } from "@/components/humanix/EnhancedReportsWithCRMModule";
import { TalentTab, type ProSummary } from "@/components/humanix/TalentTab";
import { EnhancedInstitutionOperations } from "@/components/humanix/EnhancedInstitutionOperations";
import { WalletPanel } from "@/components/humanix/WalletPanel";
import { AiCreditsBalance } from "@/components/humanix/AiCreditsBalance";
import { IpsBranchBilling } from "@/components/humanix/IpsBranchBilling";
import { SmartInstitutionProfileForm } from "@/components/humanix/SmartInstitutionProfileForm";
import { HumanixAssistant } from "@/components/humanix/HumanixAssistant";
import { NotificationsBell } from "@/components/humanix/NotificationsBell";
import { OffersMap, type MapPoint } from "@/components/humanix/OffersMap";
import { InstitutionClinicalMonitoring } from "@/components/humanix/InstitutionClinicalMonitoring";

import { useAppUser } from "@/hooks/use-app-user";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { LivePulseBar } from "@/components/humanix/LivePulseBar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/institucion")({
  head: () => ({ meta: [{ title: "Panel Institución · Humanix" }] }),
  component: InstitutionDashboard,
});

type Tab =
  | "inicio"
  | "ofertas"
  | "talento"
  | "operaciones"
  | "pacientes"
  | "monitoreo"
  | "agenda"
  | "perfil";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "inicio",     label: "Inicio",     icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: "ofertas",    label: "Ofertas",    icon: <Briefcase className="h-5 w-5" /> },
  { id: "talento",    label: "Talento",    icon: <Users className="h-5 w-5" /> },
  { id: "operaciones",label: "Ops",        icon: <BarChart3 className="h-5 w-5" /> },
  { id: "pacientes",  label: "Pacientes",  icon: <Stethoscope className="h-5 w-5" /> },
  { id: "monitoreo",  label: "Monitoreo",  icon: <Heart className="h-5 w-5" /> },
  { id: "agenda",     label: "Agenda",     icon: <CalendarDays className="h-5 w-5" /> },
  { id: "perfil",     label: "Perfil",     icon: <UserCircle className="h-5 w-5" /> },
];

type Offer = {
  id: string;
  title: string;
  city: string;
  modality: string;
  amount: number;
  status: "open" | "filled" | "closed" | "reserved";
  specialty_required: string | null;
  description: string | null;
  shifts_count: number | null;
  lat: number | null;
  lng: number | null;
  reserved_until: string | null;
  created_at: string;
};

type AppStatus = "pending" | "accepted" | "rejected" | "withdrawn";

type ApplicationRow = {
  id: string;
  status: AppStatus;
  created_at: string;
  proposed_amount: number | null;
  message: string | null;
  professional_id: string;
  job_offer_id: string;
};

// ProSummary imported from TalentTab

type InstitutionProfile = {
  institution_name: string;
  institution_type: string | null;
  city: string | null;
  verified: boolean | null;
  nit: string | null;
  compliance_fuid: boolean;
};

const COP = (n: number | null | undefined) =>
  typeof n === "number"
    ? new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n)
    : "—";

function waLink(phone: string | null | undefined, name: string, offerTitle: string) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "");
  const normalized = clean.startsWith("57") ? clean : `57${clean}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(
    `Hola ${name}, te escribo desde Humanix por tu postulación a "${offerTitle}". ¿Cuándo podemos hablar?`,
  )}`;
}

// Supabase returns a nested `job_offers` object when using the join select.
// We strip it so downstream code only sees plain ApplicationRow.
type ApplicationRowRaw = ApplicationRow & { job_offers?: unknown };

function stripJoin(rows: ApplicationRowRaw[]): ApplicationRow[] {
  return rows.map(({ job_offers: _j, ...a }) => a as ApplicationRow);
}

// Merge professional_profiles + profiles rows into a ProSummary map
function buildProMap(
  proRows: Record<string, unknown>[],
  profileRows: Record<string, unknown>[],
): Record<string, ProSummary> {
  const map: Record<string, ProSummary> = {};
  proRows.forEach((r) => {
    map[r.user_id as string] = {
      user_id: r.user_id as string,
      full_name: null,
      avatar_url: null,
      city: null,
      phone: null,
      specialty: (r.specialty as string) ?? null,
      sub_specialties: Array.isArray(r.sub_specialties) ? (r.sub_specialties as string[]) : null,
      avg_rating: (r.avg_rating as number) ?? null,
      trust_score: (r.trust_score as number) ?? null,
      hourly_rate: (r.hourly_rate as number) ?? null,
      shift_rate: (r.shift_rate as number) ?? null,
      monthly_rate: (r.monthly_rate as number) ?? null,
      verified: (r.verified as boolean) ?? null,
      rethus_verified: (r.rethus_verified as boolean) ?? null,
      ai_preapproved: (r.ai_preapproved as boolean) ?? null,
      available: Boolean(r.available),
      years_experience: (r.years_experience as number) ?? null,
      bio: (r.bio as string) ?? null,
      total_jobs: (r.total_jobs as number) ?? null,
      certifications: Array.isArray(r.certifications) ? (r.certifications as string[]) : null,
    };
  });
  profileRows.forEach((p) => {
    const uid = p.user_id as string;
    const existing = map[uid] ?? {
      user_id: uid, full_name: null, avatar_url: null, city: null, phone: null,
      specialty: null, sub_specialties: null, avg_rating: null, trust_score: null,
      hourly_rate: null, shift_rate: null, monthly_rate: null, verified: null,
      rethus_verified: null, ai_preapproved: null, available: false,
      years_experience: null, bio: null, total_jobs: null, certifications: null,
    };
    map[uid] = {
      ...existing,
      full_name: (p.full_name as string) ?? null,
      avatar_url: (p.avatar_url as string) ?? null,
      city: (p.city as string) ?? null,
      phone: (p.phone as string) ?? null,
    };
  });
  return map;
}

function InstitutionDashboard() {
  const { user, loading: authLoading, logout } = useAppUser({
    allow: ["institution", "superadmin"],
  });

  const [tab, setTab] = useState<Tab>("inicio");
  // dataLoading: Phase 1 (profile + offers + apps) pending — shows inbox skeleton
  const [dataLoading, setDataLoading] = useState(true);
  // talentLoading: Phase 2 (professional profiles) pending — shows talent skeleton
  const [talentLoading, setTalentLoading] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [proMap, setProMap] = useState<Record<string, ProSummary>>({});
  const [instProfile, setInstProfile] = useState<InstitutionProfile | null>(null);
  const [updatingApp, setUpdatingApp] = useState<string | null>(null);

  // Abort guard — mutable ref shared across async callbacks
  const signal = useRef({ cancelled: false });

  // ── Phase 2: load professional profiles for a set of proIds ───────────────
  const loadTalent = useCallback(
    async (proIds: string[]) => {
      if (!proIds.length) {
        setProMap({});
        setTalentLoading(false);
        return;
      }
      setTalentLoading(true);
      try {
        const [proRowsRes, profilesRes] = await Promise.all([
          supabase
            .from("professional_profiles")
            .select(
              "user_id, specialty, sub_specialties, avg_rating, trust_score, hourly_rate, shift_rate, monthly_rate, verified, rethus_verified, ai_preapproved, available, years_experience, bio, total_jobs, certifications",
            )
            .in("user_id", proIds),
          supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url, city, phone")
            .in("user_id", proIds),
        ]);

        if (signal.current.cancelled) return;
        setProMap(
          buildProMap(
            (proRowsRes.data ?? []) as Record<string, unknown>[],
            (profilesRes.data ?? []) as Record<string, unknown>[],
          ),
        );
      } catch (err) {
        console.error("[inst] talent load failed:", err);
      } finally {
        if (!signal.current.cancelled) setTalentLoading(false);
      }
    },
    [],
  );

  // ── Full load: Phase 1 (3-way parallel) → Phase 2 ─────────────────────────
  //
  // OLD flow:  [offers + profile] → [apps] → [pro_profiles + profiles]   (3 rounds)
  // NEW flow:  [offers + profile + apps(join)] → [pro_profiles + profiles] (2 rounds)
  //
  // Applications are fetched with an inner join on job_offers.posted_by so
  // we never need offerIds first, eliminating one full network round-trip.
  // State is committed per-phase so each UI section renders as soon as its
  // data arrives instead of waiting for the entire cascade.
  const loadAll = useCallback(
    async (uid: string) => {
      try {
        // ── Phase 1: profile + offers + applications — all parallel ──────────
        const [offersRes, instRes, appsRes] = await Promise.all([
          supabase
            .from("job_offers")
            .select(
              "id, title, city, modality, amount, status, specialty_required, description, shifts_count, lat, lng, reserved_until, created_at",
            )
            .eq("posted_by", uid)
            .order("created_at", { ascending: false }),

          supabase
            .from("institution_profiles")
            .select("institution_name, institution_type, city, verified, nit, compliance_fuid")
            .eq("user_id", uid)
            .maybeSingle(),

          // Inner join lets us filter by posted_by without a prior offerIds fetch.
          // The nested job_offers object is stripped by stripJoin() below.
          supabase
            .from("applications")
            .select(
              "id, status, created_at, proposed_amount, message, professional_id, job_offer_id, job_offers!inner(posted_by)",
            )
            .eq("job_offers.posted_by", uid)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);

        if (signal.current.cancelled) return;

        // Commit Phase 1 state — inbox + offers tabs render immediately
        if (instRes.data) setInstProfile(instRes.data as InstitutionProfile);
        setOffers((offersRes.data ?? []) as Offer[]);

        const apps = stripJoin((appsRes.data ?? []) as ApplicationRowRaw[]);
        setApplications(apps);
        setDataLoading(false); // ← inbox renders NOW, before talent is ready

        // ── Phase 2: professional profiles — parallel pair ───────────────────
        const proIds = [...new Set(apps.map((a) => a.professional_id))];
        await loadTalent(proIds);
      } catch (err) {
        console.error("[inst] loadAll failed:", err);
        toast.error("Error cargando datos. Intenta refrescar.");
      } finally {
        if (!signal.current.cancelled) setDataLoading(false);
      }
    },
    [loadTalent],
  );

  useEffect(() => {
    if (authLoading || !user) return;
    signal.current = { cancelled: false };
    const uid = user.id;
    void loadAll(uid);
    // Safety valve: never leave inbox spinner past 10 s
    const safety = setTimeout(() => {
      if (!signal.current.cancelled) setDataLoading(false);
    }, 10_000);
    return () => {
      signal.current.cancelled = true;
      clearTimeout(safety);
    };
  }, [authLoading, user?.id, loadAll]);

  // Applications changes (most frequent) — reload apps then talent only.
  // Avoids re-fetching offers and institution profile on every status flip.
  useRealtimeRefresh(
    `inst-apps-${user?.id ?? "anon"}`,
    [{ table: "applications", event: "*" }],
    async () => {
      if (!user?.id || signal.current.cancelled) return;
      const { data } = await supabase
        .from("applications")
        .select(
          "id, status, created_at, proposed_amount, message, professional_id, job_offer_id, job_offers!inner(posted_by)",
        )
        .eq("job_offers.posted_by", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      const apps = stripJoin((data ?? []) as ApplicationRowRaw[]);
      setApplications(apps);
      const proIds = [...new Set(apps.map((a) => a.professional_id))];
      await loadTalent(proIds);
    },
    !!user?.id,
  );

  // Offer changes — reload offers only (status, fills, new offers).
  // Applications and talent are unaffected by offer metadata changes.
  useRealtimeRefresh(
    `inst-offers-${user?.id ?? "anon"}`,
    [{ table: "job_offers", event: "*" }],
    async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("job_offers")
        .select(
          "id, title, city, modality, amount, status, specialty_required, description, shifts_count, lat, lng, reserved_until, created_at",
        )
        .eq("posted_by", user.id)
        .order("created_at", { ascending: false });
      setOffers((data ?? []) as Offer[]);
    },
    !!user?.id,
  );

  const updateAppStatus = async (appId: string, newStatus: AppStatus) => {
    setUpdatingApp(appId);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: newStatus })
        .eq("id", appId);
      if (error) throw error;
      setApplications((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, status: newStatus } : a)),
      );
      toast.success(
        newStatus === "accepted"
          ? "✅ Profesional aceptado. Se le notificará."
          : "Postulación rechazada.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error actualizando estado");
    } finally {
      setUpdatingApp(null);
    }
  };

  const updateOfferStatus = async (offerId: string, newStatus: "open" | "closed" | "filled") => {
    try {
      const { error } = await supabase
        .from("job_offers")
        .update({ status: newStatus })
        .eq("id", offerId);
      if (error) throw error;
      setOffers((prev) =>
        prev.map((o) => (o.id === offerId ? { ...o, status: newStatus } : o)),
      );
      toast.success(
        newStatus === "open"
          ? "Oferta reactivada"
          : newStatus === "filled"
            ? "Oferta marcada como cubierta"
            : "Oferta cerrada",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error actualizando oferta");
    }
  };

  // Derived metrics
  const metrics = useMemo(() => {
    const open = offers.filter((o) => o.status === "open").length;
    const filled = offers.filter((o) => o.status === "filled").length;
    const pending = applications.filter((a) => a.status === "pending").length;
    const accepted = applications.filter((a) => a.status === "accepted").length;
    const convRate = applications.length
      ? Math.round((accepted / applications.length) * 100)
      : 0;
    const totalBudget = offers
      .filter((o) => o.status === "open" || o.status === "filled")
      .reduce((s, o) => s + (o.amount ?? 0), 0);
    return { open, filled, pending, accepted, convRate, totalBudget };
  }, [offers, applications]);

  const pendingApps = useMemo(
    () => applications.filter((a) => a.status === "pending"),
    [applications],
  );

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-fuchsia-neural/10 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-fuchsia-neural animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">Cargando panel institución…</p>
        </div>
      </div>
    );
  }

  const instName =
    instProfile?.institution_name || user.fullName || "Mi institución";
  const instType = instProfile?.institution_type ?? "IPS / Clínica";

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora pb-20 lg:pb-0">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <Logo />
            <div className="hidden sm:block min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate max-w-[200px]">{instName}</p>
                {instProfile?.verified && (
                  <BadgeCheck className="h-4 w-4 text-fuchsia-neural shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{instType}</p>
            </div>
          </div>

          {/* Center: pending badge */}
          {pendingApps.length > 0 && (
            <button
              onClick={() => setTab("inicio")}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
            >
              <Bell className="h-3.5 w-3.5 animate-pulse" />
              {pendingApps.length} postulación{pendingApps.length > 1 ? "es" : ""} nueva{pendingApps.length > 1 ? "s" : ""}
            </button>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {user.id && <NotificationsBell userId={user.id} />}
            <div className="hidden sm:block">
              <HiringCopilot />
            </div>
            <Button variant="ghost" size="icon" onClick={logout} title="Salir">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop tab bar */}
        <div className="hidden lg:flex border-t border-border">
          <div className="mx-auto max-w-7xl w-full px-4 flex gap-0.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                  tab === t.id
                    ? "border-fuchsia-neural text-fuchsia-neural"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
                {t.id === "inicio" && pendingApps.length > 0 && (
                  <span className="ml-1 h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {pendingApps.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="mx-auto max-w-7xl px-4 py-6">

        {/* ══ TAB: INICIO ══ */}
        {tab === "inicio" && (
          <div className="space-y-5">

            <LivePulseBar role="institution" />

            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard
                icon={<Briefcase className="h-5 w-5" />}
                label="Ofertas abiertas"
                value={metrics.open}
                tone="fuchsia"
                sub={`${offers.length} totales`}
              />
              <KpiCard
                icon={<Inbox className="h-5 w-5" />}
                label="Nuevas postulaciones"
                value={metrics.pending}
                tone="amber"
                sub="requieren respuesta"
                urgent={metrics.pending > 0}
              />
              <KpiCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                label="Turnos cubiertos"
                value={metrics.filled}
                tone="bio"
                sub={`${metrics.accepted} aceptados`}
              />
              <KpiCard
                icon={<Target className="h-5 w-5" />}
                label="Tasa de conversión"
                value={`${metrics.convRate}%`}
                tone="cyber"
                sub={`${applications.length} postulaciones`}
              />
            </div>

            {/* Budget bar */}
            {metrics.totalBudget > 0 && (
              <div className="rounded-2xl border border-border bg-card/95 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-fuchsia-neural" />
                    <p className="text-sm font-semibold">Presupuesto en ofertas activas</p>
                  </div>
                  <p className="text-sm font-bold text-fuchsia-neural">{COP(metrics.totalBudget)}</p>
                </div>
                <Progress value={Math.min(100, (metrics.filled / Math.max(offers.length, 1)) * 100)} className="h-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {metrics.filled} de {offers.length} ofertas cubiertas · conversión {metrics.convRate}%
                </p>
              </div>
            )}

            {/* Pending applications inbox */}
            {dataLoading ? (
              <div className="rounded-2xl border border-border bg-card/95 p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">Cargando postulaciones…</p>
              </div>
            ) : pendingApps.length === 0 && applications.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card/95 p-10 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="font-semibold">Sin postulaciones aún</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  Publica una oferta o busca talento directamente en el marketplace.
                </p>
                <div className="mt-4 flex justify-center">
                  <HiringCopilot />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Inbox className="h-4 w-4 text-fuchsia-neural" />
                    <p className="text-sm font-semibold">Buzón de postulaciones</p>
                    {pendingApps.length > 0 && (
                      <span className="h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center">
                        {pendingApps.length} nuevas
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{applications.length} en total</p>
                </div>
                <div className="divide-y divide-border">
                  {applications.slice(0, 15).map((a) => (
                    <ApplicationCard
                      key={a.id}
                      app={a}
                      pro={proMap[a.professional_id]}
                      offer={offers.find((o) => o.id === a.job_offer_id)}
                      updating={updatingApp === a.id}
                      onAccept={() => updateAppStatus(a.id, "accepted")}
                      onReject={() => updateAppStatus(a.id, "rejected")}
                    />
                  ))}
                  {applications.length > 15 && (
                    <div className="p-3 text-center">
                      <button
                        onClick={() => setTab("ofertas")}
                        className="text-xs text-fuchsia-neural hover:underline"
                      >
                        Ver todas ({applications.length}) →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recent offers strip */}
            <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-fuchsia-neural" />
                  <p className="text-sm font-semibold">Mis ofertas</p>
                </div>
                <button onClick={() => setTab("ofertas")} className="text-xs text-fuchsia-neural hover:underline flex items-center gap-1">
                  Gestionar <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {offers.length === 0 ? (
                <div className="p-8 text-center">
                  <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-semibold">Sin ofertas publicadas</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Publica <span className="text-biosensor font-medium">gratis</span> y la IA distribuye a los mejores profesionales.
                  </p>
                  <div className="mt-3 flex justify-center">
                    <HiringCopilot />
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {offers.slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{o.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {o.city} · {COP(o.amount)} ·{" "}
                          {applications.filter((a) => a.job_offer_id === o.id).length} postulaciones
                        </p>
                      </div>
                      <OfferStatusBadge status={o.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <QuickAction icon={<Plus className="h-5 w-5 text-fuchsia-neural" />} label="Nueva oferta" sub="IA copilot" onClick={() => setTab("ofertas")} />
              <QuickAction icon={<Users className="h-5 w-5 text-biosensor" />} label="Ver talento" sub="Mapa en vivo" onClick={() => setTab("talento")} />
              <QuickAction icon={<ClipboardList className="h-5 w-5 text-fuchsia-neural" />} label="Pacientes" sub="Casos activos" onClick={() => setTab("pacientes")} />
              <QuickAction icon={<BarChart3 className="h-5 w-5 text-biosensor" />} label="Reportes" sub="Métricas operativas" onClick={() => setTab("operaciones")} />
            </div>
          </div>
        )}

        {/* ══ TAB: OFERTAS ══ */}
        {tab === "ofertas" && (
          <div className="space-y-5">

            {/* Create offer */}
            <div className="rounded-2xl border border-fuchsia-neural/20 bg-fuchsia-neural/5 p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold">Publicar nueva oferta</p>
                <p className="text-xs text-muted-foreground">La IA escribe la descripción y encuentra los mejores candidatos.</p>
              </div>
              <div className="flex gap-2">
                <HiringCopilot />
              </div>
            </div>

            {/* Bulk offers */}
            <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
              <div className="p-4 border-b border-border">
                <p className="text-sm font-semibold">Ofertas masivas con IA</p>
                <p className="text-xs text-muted-foreground">Publica múltiples turnos a la vez y calcula automáticamente cuántos profesionales disponibles hay.</p>
              </div>
              <div className="p-4">
                <EnhancedBulkOffersModule userId={user.id} defaultCity={instProfile?.city ?? undefined} />
              </div>
            </div>

            {/* All offers list */}
            <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <p className="text-sm font-semibold">Todas mis ofertas ({offers.length})</p>
                <button
                  onClick={() => user.id && loadAll(user.id)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" /> Actualizar
                </button>
              </div>
              {offers.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">Sin ofertas aún.</div>
              ) : (
                <div className="divide-y divide-border">
                  {offers.map((o) => {
                    const offerApps = applications.filter((a) => a.job_offer_id === o.id);
                    const pendingCount = offerApps.filter((a) => a.status === "pending").length;
                    return (
                      <div key={o.id} className="p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{o.title}</p>
                              <OfferStatusBadge status={o.status} />
                              {pendingCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                                  {pendingCount} pendiente{pendingCount > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                              <MapPin className="h-3 w-3 shrink-0" /> {o.city}
                              {o.specialty_required && <span>· {o.specialty_required}</span>}
                              <span>· {COP(o.amount)} / {labelModality(o.modality as never)}</span>
                              <span>· {offerApps.length} postulaciones</span>
                            </p>
                            {o.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{o.description}</p>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {o.status === "open" && (
                              <Button
                                size="sm"
                                variant="glass"
                                onClick={() => updateOfferStatus(o.id, "filled")}
                              >
                                Marcar cubierta
                              </Button>
                            )}
                            {o.status === "filled" && (
                              <Button
                                size="sm"
                                variant="glass"
                                onClick={() => updateOfferStatus(o.id, "open")}
                              >
                                Reabrir
                              </Button>
                            )}
                            {o.status === "open" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground"
                                onClick={() => updateOfferStatus(o.id, "closed")}
                              >
                                Cerrar
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Mini applicants list under each offer */}
                        {offerApps.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {offerApps.slice(0, 5).map((a) => {
                              const pro = proMap[a.professional_id];
                              return (
                                <div
                                  key={a.id}
                                  className={cn(
                                    "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border",
                                    a.status === "pending"
                                      ? "border-amber-500/30 bg-amber-500/5"
                                      : a.status === "accepted"
                                        ? "border-biosensor/30 bg-biosensor/5"
                                        : "border-border bg-muted/30",
                                  )}
                                >
                                  <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {(pro?.full_name ?? "?").charAt(0).toUpperCase()}
                                  </div>
                                  <span className="max-w-[80px] truncate">{pro?.full_name ?? "—"}</span>
                                  <AppStatusDot status={a.status} />
                                </div>
                              );
                            })}
                            {offerApps.length > 5 && (
                              <span className="text-xs text-muted-foreground self-center">
                                +{offerApps.length - 5} más
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Map */}
            {offers.some((o) => o.lat != null && o.lng != null) && (
              <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-sm font-semibold">Mapa de tus ofertas</p>
                </div>
                <OffersMap
                  points={offers
                    .filter((o) => o.lat != null && o.lng != null)
                    .map<MapPoint>((o) => ({
                      id: o.id,
                      lat: o.lat as number,
                      lng: o.lng as number,
                      title: o.title,
                      subtitle: `${o.city} · ${o.status === "open" ? "Disponible" : o.status === "filled" ? "Cubierta" : "Cerrada"}`,
                      status: o.status === "filled" ? "reserved" : "available",
                    }))}
                  height={360}
                />
              </div>
            )}

            {/* Full applications table */}
            {applications.length > 0 && (
              <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-sm font-semibold">Todas las postulaciones ({applications.length})</p>
                </div>
                <div className="divide-y divide-border">
                  {applications.map((a) => (
                    <ApplicationCard
                      key={a.id}
                      app={a}
                      pro={proMap[a.professional_id]}
                      offer={offers.find((o) => o.id === a.job_offer_id)}
                      updating={updatingApp === a.id}
                      onAccept={() => updateAppStatus(a.id, "accepted")}
                      onReject={() => updateAppStatus(a.id, "rejected")}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB: TALENTO ══ */}
        {tab === "talento" && (
          <div className="space-y-5">
            
            <TalentTab
              userId={user.id}
              applications={applications}
              proMap={proMap}
              offers={offers.map((o) => ({ id: o.id, title: o.title }))}
              instCity={instProfile?.city ?? ""}
              updatingApp={updatingApp}
              onUpdateApp={updateAppStatus}
              loading={talentLoading}
            />
          </div>
        )}

        {/* ══ TAB: OPERACIONES ══ */}
        {tab === "operaciones" && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <p className="text-sm font-semibold mb-4">Métricas operativas</p>
              <EnhancedInstitutionOperations userId={user.id} />
            </div>
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <p className="text-sm font-semibold mb-4">Reportes y CRM</p>
              <EnhancedReportsWithCRMModule userId={user.id} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-emerald-600" /> Billetera institucional
              </p>
              <WalletPanel userId={user.id} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-fuchsia-neural" /> Bolsa de créditos IA
              </p>
              <AiCreditsBalance userId={user.id} />
            </div>
          </div>
        )}

        {/* ══ TAB: PACIENTES ══ */}
        {tab === "pacientes" && (
          <div className="rounded-2xl border border-border bg-card/95 p-4">
            <EnhancedPatientsModule userId={user.id} />
          </div>
        )}

        {/* ══ TAB: MONITOREO ══ */}
        {tab === "monitoreo" && (
          <InstitutionClinicalMonitoring institutionId={user.id} />
        )}

        {/* ══ TAB: AGENDA ══ */}
        {tab === "agenda" && (
          <div className="rounded-2xl border border-border bg-card/95 p-4">
            <EnhancedAgendaModule userId={user.id} />
          </div>
        )}

        {/* ══ TAB: PERFIL ══ */}
        {tab === "perfil" && (
          <div className="space-y-5">
            {/* Institution header card */}
            <div className="rounded-2xl bg-gradient-to-br from-fuchsia-neural/10 via-background to-biosensor/5 border border-border p-5">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-fuchsia-neural/10 border border-fuchsia-neural/20 flex items-center justify-center shrink-0">
                  <Building2 className="h-7 w-7 text-fuchsia-neural" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-lg">{instName}</p>
                    {instProfile?.verified && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural font-medium">
                        <BadgeCheck className="h-3 w-3" /> Verificada
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{instType}</p>
                  {instProfile?.city && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" /> {instProfile.city}
                    </p>
                  )}
                </div>
              </div>

              {instProfile?.nit && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-background/60 border border-border/50 px-3 py-2">
                    <p className="text-muted-foreground">NIT</p>
                    <p className="font-semibold mt-0.5">{instProfile.nit}</p>
                  </div>
                  <div className="rounded-lg bg-background/60 border border-border/50 px-3 py-2">
                    <p className="text-muted-foreground">FUID</p>
                    <p className={cn("font-semibold mt-0.5", instProfile.compliance_fuid ? "text-biosensor" : "text-muted-foreground")}>
                      {instProfile.compliance_fuid ? "Completo" : "Pendiente"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background/60 border border-border/50 px-3 py-2">
                    <p className="text-muted-foreground">Estado</p>
                    <p className={cn("font-semibold mt-0.5", instProfile.verified ? "text-biosensor" : "text-amber-500")}>
                      {instProfile.verified ? "Verificada" : "En revisión"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-fuchsia-neural" /> Plan IPS Mejorado y sedes
              </p>
              <IpsBranchBilling institutionId={user.id} />
            </div>

            <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
              <div className="p-4 border-b border-border">
                <p className="text-sm font-semibold">Datos de la institución</p>
                <p className="text-xs text-muted-foreground mt-0.5">NIT, cámara de comercio, representante legal y compliance.</p>
              </div>
              <div className="p-4">
                <SmartInstitutionProfileForm userId={user.id} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Bottom nav (mobile/tablet) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border safe-area-bottom">
        <div className="grid grid-cols-7">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[9px] font-medium transition-colors relative",
                tab === t.id ? "text-fuchsia-neural" : "text-muted-foreground",
              )}
            >
              <span className={cn("transition-transform", tab === t.id && "scale-110")}>
                {t.icon}
              </span>
              {t.label}
              {t.id === "inicio" && pendingApps.length > 0 && (
                <span className="absolute top-1 right-1/4 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          ))}
        </div>
      </nav>

      <HumanixAssistant
        persona="institution"
        greeting={`Hola, soy el copiloto de ${instName}. Puedo ayudarte a redactar ofertas, analizar candidatos, o gestionar tus casos clínicos.`}
      />
    </div>
  );
}

// ── Sub-components ──

function ApplicationCard({
  app: a,
  pro,
  offer,
  updating,
  onAccept,
  onReject,
}: {
  app: ApplicationRow;
  pro: ProSummary | undefined;
  offer: Offer | undefined;
  updating: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const wa = waLink(pro?.phone, pro?.full_name ?? "", offer?.title ?? "nuestra oferta");
  const stars = pro?.avg_rating ?? 0;
  const isPending = a.status === "pending";

  return (
    <div
      className={cn(
        "p-4 transition-colors",
        isPending && "bg-amber-500/3 hover:bg-amber-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {pro?.avatar_url ? (
          <img
            src={pro.avatar_url}
            alt={pro.full_name ?? ""}
            className="h-10 w-10 rounded-full object-cover border border-border shrink-0"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
            {(pro?.full_name ?? "?").charAt(0).toUpperCase()}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{pro?.full_name ?? "Profesional"}</p>
            {pro?.verified && <BadgeCheck className="h-3.5 w-3.5 text-biosensor shrink-0" />}
            {stars > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-500">
                <Star className="h-3 w-3 fill-amber-500" />
                {Number(stars).toFixed(1)}
              </span>
            )}
            {pro?.trust_score != null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-biosensor/10 text-biosensor font-medium">
                Trust {pro.trust_score}
              </span>
            )}
            <AppStatusBadge status={a.status} />
          </div>

          <p className="text-xs text-muted-foreground mt-0.5">
            {pro?.specialty ?? "Profesional de la salud"}
            {pro?.city && ` · ${pro.city}`}
            {pro?.shift_rate && ` · ${COP(pro.shift_rate)}/turno`}
          </p>

          <p className="text-xs text-muted-foreground mt-0.5">
            Para:{" "}
            <span className="font-medium text-foreground">{offer?.title ?? "Oferta"}</span>
            {a.proposed_amount && ` · Propone ${COP(a.proposed_amount)}`}
          </p>

          {a.message && (
            <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">
              "{a.message}"
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Button size="sm" variant="glass" asChild>
            <Link to="/profesional/$proId" params={{ proId: a.professional_id }}>
              Ver perfil
            </Link>
          </Button>
          {wa && (
            <Button size="sm" variant="outline" asChild className="border-biosensor/30 text-biosensor hover:bg-biosensor/5">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <Phone className="h-3.5 w-3.5 mr-1" /> WA
              </a>
            </Button>
          )}
          {isPending && (
            <>
              <Button
                size="sm"
                variant="hero"
                onClick={onAccept}
                disabled={updating}
                className="bg-biosensor hover:bg-biosensor/90"
              >
                {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                Aceptar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onReject}
                disabled={updating}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Rechazar
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function KpiCard({
  icon,
  label,
  value,
  tone,
  sub,
  urgent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "fuchsia" | "bio" | "amber" | "cyber";
  sub?: string;
  urgent?: boolean;
}) {
  const colors = {
    fuchsia: "text-fuchsia-neural bg-fuchsia-neural/10",
    bio: "text-biosensor bg-biosensor/10",
    amber: "text-amber-600 bg-amber-500/10",
    cyber: "text-cyan-500 bg-cyan-500/10",
  }[tone];

  return (
    <div className={cn("rounded-2xl border bg-card/95 p-4 transition-all", urgent && "border-amber-500/30 shadow-sm shadow-amber-500/10")}>
      <div className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl", colors)}>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-bold font-display">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function QuickAction({ icon, label, sub, onClick }: {
  icon: React.ReactNode; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-border bg-card/95 p-4 text-left hover:border-fuchsia-neural/30 transition-colors active:scale-[0.98]"
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}

function OfferStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "Abierta", cls: "bg-biosensor/10 text-biosensor border-biosensor/20" },
    filled: { label: "Cubierta", cls: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/20" },
    closed: { label: "Cerrada", cls: "bg-muted text-muted-foreground border-border" },
    reserved: { label: "Reservada", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  };
  const s = map[status] ?? map.closed;
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap", s.cls)}>
      {s.label}
    </span>
  );
}

function AppStatusBadge({ status }: { status: AppStatus }) {
  const map: Record<AppStatus, { label: string; cls: string }> = {
    pending: { label: "Pendiente", cls: "bg-amber-500/10 text-amber-600" },
    accepted: { label: "Aceptado", cls: "bg-biosensor/10 text-biosensor" },
    rejected: { label: "Rechazado", cls: "bg-rose-500/10 text-rose-600" },
    withdrawn: { label: "Retirado", cls: "bg-muted text-muted-foreground" },
  };
  const s = map[status];
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap", s.cls)}>
      {s.label}
    </span>
  );
}

function AppStatusDot({ status }: { status: AppStatus }) {
  const colors: Record<AppStatus, string> = {
    pending: "bg-amber-500",
    accepted: "bg-biosensor",
    rejected: "bg-rose-500",
    withdrawn: "bg-muted-foreground",
  };
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors[status])} />;
}

function labelModality(m: "hour" | "shift" | "month" | "package") {
  return m === "hour" ? "hora" : m === "shift" ? "turno" : m === "month" ? "mes" : "paquete";
}
