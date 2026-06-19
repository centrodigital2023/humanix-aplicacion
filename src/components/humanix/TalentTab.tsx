import { useMemo, useState } from "react";
import { usePlan } from "@/hooks/use-plan";
import { PlanNameGate } from "@/components/humanix/PlanNameGate";
import { Link } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  Loader2,
  Star,
  MapPin,
  Phone,
  CheckCircle2,
  X,
  BadgeCheck,
  ShieldCheck,
  Briefcase,
  SlidersHorizontal,
  LayoutGrid,
  LayoutList,
  Users,
  ChevronDown,
  ChevronUp,
  Send,
  RefreshCw,
  Clock,
  DollarSign,
  AlertCircle,
  Award,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { LiveMarketplaceMap } from "@/components/humanix/LiveMarketplaceMap";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProSummary = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
  specialty: string | null;
  sub_specialties: string[] | null;
  avg_rating: number | null;
  trust_score: number | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  monthly_rate: number | null;
  phone: string | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  ai_preapproved: boolean | null;
  available: boolean;
  years_experience: number | null;
  bio: string | null;
  total_jobs: number | null;
  certifications: string[] | null;
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

type Offer = { id: string; title: string };

type SortKey = "trust" | "rating" | "rate" | "jobs" | "date";
type ViewMode = "cards" | "table";
type PoolTab = "all" | "pending" | "accepted" | "market";

interface TalentTabProps {
  userId: string;
  applications: ApplicationRow[];
  proMap: Record<string, ProSummary>;
  offers: Offer[];
  instCity?: string;
  updatingApp: string | null;
  onUpdateApp: (appId: string, status: AppStatus) => void;
  /** True while Phase 2 (professional profiles) is still loading */
  loading?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const COP = (n: number | null | undefined) =>
  typeof n === "number"
    ? new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n)
    : "—";

function waLink(phone: string | null | undefined, name: string, context = "una oportunidad") {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "");
  const num = clean.startsWith("57") ? clean : `57${clean}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(
    `Hola ${name}, te contacto desde Humanix porque tu perfil encaja con ${context}. ¿Tienes disponibilidad para hablar?`,
  )}`;
}

function waInvite(phone: string | null | undefined, name: string, instName = "nuestra institución") {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "");
  const num = clean.startsWith("57") ? clean : `57${clean}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(
    `Hola ${name}, encontré tu perfil en Humanix y me interesa invitarte a postularte a una vacante en ${instName}. ¿Podemos hablar?`,
  )}`;
}

function isNew(dateStr: string | undefined) {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < 24 * 60 * 60 * 1000;
}

const SPECIALTIES = [
  "Enfermería",
  "Medicina general",
  "Cuidado adulto mayor",
  "Fisioterapia",
  "Fonoaudiología",
  "Terapia ocupacional",
  "Auxiliar enfermería",
  "Psicología",
  "Nutrición",
  "Trabajo social",
  "Odontología",
  "Optometría",
];

// ── Main component ─────────────────────────────────────────────────────────

export function TalentTab({
  userId,
  applications,
  proMap,
  offers,
  instCity = "",
  updatingApp,
  onUpdateApp,
  loading = false,
}: TalentTabProps) {
  const { can: canPlan } = usePlan(userId);
  const canViewNames = canPlan("view_full_names");

  // Pool quick-filter tab
  const [poolTab, setPoolTab] = useState<PoolTab>("all");

  // Filter / search state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSpecialty, setFilterSpecialty] = useState("");
  const [filterCity, setFilterCity] = useState(instCity);
  const [filterOffer, setFilterOffer] = useState("");
  const [filterAvailable, setFilterAvailable] = useState(false);
  const [filterMinTrust, setFilterMinTrust] = useState(0);
  const [filterRethus, setFilterRethus] = useState(false);
  const [filterVerified, setFilterVerified] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("trust");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [showAi, setShowAi] = useState(false);

  // AI search
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResults, setAiResults] = useState<ProSummary[]>([]);
  const [aiMode, setAiMode] = useState(false);

  // Marketplace search
  const [searching, setSearching] = useState(false);
  const [extraPros, setExtraPros] = useState<ProSummary[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Derived: applicant IDs (from proMap)
  const applicantIds = useMemo(() => new Set(Object.keys(proMap)), [proMap]);

  // All apps grouped by professional
  const appByPro = useMemo(() => {
    const m: Record<string, ApplicationRow[]> = {};
    applications.forEach((a) => {
      if (!m[a.professional_id]) m[a.professional_id] = [];
      m[a.professional_id].push(a);
    });
    return m;
  }, [applications]);

  // Most recent app per professional
  const latestAppByPro = useMemo(() => {
    const m: Record<string, ApplicationRow> = {};
    Object.entries(appByPro).forEach(([pid, apps]) => {
      m[pid] = [...apps].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
    });
    return m;
  }, [appByPro]);

  // Merged pool: applicants first, then marketplace extras not already in pool
  const rawPool = useMemo(() => {
    return [
      ...Object.values(proMap),
      ...extraPros.filter((p) => !applicantIds.has(p.user_id)),
    ];
  }, [proMap, extraPros, applicantIds]);

  const filteredPool = useMemo(() => {
    const base = aiMode && aiResults.length > 0 ? aiResults : rawPool;
    return base
      .filter((p) => {
        // Pool tab filter
        if (poolTab === "pending") {
          const app = latestAppByPro[p.user_id];
          if (!app || app.status !== "pending") return false;
        }
        if (poolTab === "accepted") {
          const app = latestAppByPro[p.user_id];
          if (!app || app.status !== "accepted") return false;
        }
        if (poolTab === "market") {
          if (applicantIds.has(p.user_id)) return false;
        }
        // Offer filter
        if (filterOffer) {
          const proApps = appByPro[p.user_id] ?? [];
          if (!proApps.some((a) => a.job_offer_id === filterOffer)) return false;
        }
        // Text search
        if (
          searchQuery &&
          !p.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !p.specialty?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !p.city?.toLowerCase().includes(searchQuery.toLowerCase())
        )
          return false;
        if (filterSpecialty && !p.specialty?.toLowerCase().includes(filterSpecialty.toLowerCase()))
          return false;
        if (filterCity && !p.city?.toLowerCase().includes(filterCity.toLowerCase()))
          return false;
        if (filterAvailable && !p.available) return false;
        if (filterMinTrust > 0 && (p.trust_score ?? 0) < filterMinTrust) return false;
        if (filterRethus && !p.rethus_verified) return false;
        if (filterVerified && !p.verified) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "trust") return (b.trust_score ?? 0) - (a.trust_score ?? 0);
        if (sortBy === "rating") return (b.avg_rating ?? 0) - (a.avg_rating ?? 0);
        if (sortBy === "rate")
          return (b.shift_rate ?? b.hourly_rate ?? 0) - (a.shift_rate ?? a.hourly_rate ?? 0);
        if (sortBy === "jobs") return (b.total_jobs ?? 0) - (a.total_jobs ?? 0);
        if (sortBy === "date") {
          const ad = latestAppByPro[a.user_id]?.created_at ?? "";
          const bd = latestAppByPro[b.user_id]?.created_at ?? "";
          return bd.localeCompare(ad);
        }
        return 0;
      });
  }, [
    rawPool,
    aiMode,
    aiResults,
    poolTab,
    applicantIds,
    filterOffer,
    appByPro,
    latestAppByPro,
    searchQuery,
    filterSpecialty,
    filterCity,
    filterAvailable,
    filterMinTrust,
    filterRethus,
    filterVerified,
    sortBy,
  ]);

  // KPIs
  const kpis = useMemo(() => {
    const pool = Object.values(proMap);
    const available = pool.filter((p) => p.available).length;
    const pending = applications.filter((a) => a.status === "pending").length;
    const accepted = applications.filter((a) => a.status === "accepted").length;
    const rethusCount = pool.filter((p) => p.rethus_verified).length;
    const ratings = pool.map((p) => p.avg_rating ?? 0).filter((r) => r > 0);
    const avgRating = ratings.length
      ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)
      : "—";
    return { total: pool.length, available, pending, accepted, rethusCount, avgRating };
  }, [proMap, applications]);

  const pendingApps = useMemo(
    () => applications.filter((a) => a.status === "pending"),
    [applications],
  );

  const activeFiltersCount = [
    filterSpecialty,
    filterCity !== instCity && filterCity,
    filterOffer,
    filterAvailable,
    filterMinTrust > 0,
    filterRethus,
    filterVerified,
  ].filter(Boolean).length;

  // ------ Marketplace search ------
  const searchMarketplace = async () => {
    setSearching(true);
    setHasSearched(true);
    setAiMode(false);
    try {
      let q = supabase
        .from("professional_profiles")
        .select(
          "user_id, specialty, sub_specialties, avg_rating, trust_score, hourly_rate, shift_rate, monthly_rate, verified, rethus_verified, ai_preapproved, available, years_experience, bio, total_jobs, certifications",
        )
        .eq("published", true)
        .order("trust_score", { ascending: false, nullsFirst: false })
        .limit(40);

      if (filterSpecialty) q = q.ilike("specialty", `%${filterSpecialty}%`);
      if (filterAvailable) q = q.eq("available", true);
      if (filterMinTrust > 0) q = q.gte("trust_score", filterMinTrust);
      if (filterRethus) q = q.eq("rethus_verified", true);

      const { data: proData } = await q;
      if (!proData?.length) {
        toast.info("No se encontraron profesionales con esos filtros.");
        return;
      }

      const ids = proData.map((r) => r.user_id);
      const { data: profileData } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url, city, phone")
        .in("user_id", ids);

      type ProfileRow = {
        user_id: string;
        full_name: string | null;
        avatar_url: string | null;
        city: string | null;
        phone: string | null;
      };
      const byUid: Record<string, ProfileRow> = {};
      (profileData ?? []).forEach((p) => {
        byUid[p.user_id] = p as ProfileRow;
      });

      const merged: ProSummary[] = proData
        .filter((r) => {
          if (!filterCity) return true;
          return byUid[r.user_id]?.city?.toLowerCase().includes(filterCity.toLowerCase());
        })
        .map((r) => {
          const prof = byUid[r.user_id];
          return {
            user_id: r.user_id,
            full_name: prof?.full_name ?? null,
            avatar_url: prof?.avatar_url ?? null,
            city: prof?.city ?? null,
            phone: prof?.phone ?? null,
            specialty: r.specialty,
            sub_specialties: Array.isArray(r.sub_specialties)
              ? (r.sub_specialties as string[])
              : null,
            avg_rating: r.avg_rating,
            trust_score: r.trust_score,
            hourly_rate: r.hourly_rate,
            shift_rate: r.shift_rate,
            monthly_rate: (r as { monthly_rate?: number }).monthly_rate ?? null,
            verified: r.verified,
            rethus_verified: r.rethus_verified,
            ai_preapproved: (r as { ai_preapproved?: boolean }).ai_preapproved ?? null,
            available: Boolean(r.available),
            years_experience: (r as { years_experience?: number }).years_experience ?? null,
            bio: (r as { bio?: string }).bio ?? null,
            total_jobs: (r as { total_jobs?: number }).total_jobs ?? null,
            certifications: Array.isArray(r.certifications)
              ? (r.certifications as string[])
              : null,
          };
        });

      setExtraPros(merged);
      setPoolTab("market");
      toast.success(`${merged.length} profesionales del marketplace encontrados.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en búsqueda");
    } finally {
      setSearching(false);
    }
  };

  // ------ AI search ------
  const runAiSearch = async () => {
    if (!aiQuery.trim()) return;
    setAiSearching(true);
    setAiMode(true);
    setPoolTab("all");
    try {
      const { data, error } = await supabase.functions.invoke("hiring-copilot", {
        body: { brief: aiQuery, city: filterCity || instCity, findCandidates: true },
      });
      if (error) throw error;
      const candidates = (data?.candidates ?? []) as Array<{
        user_id: string;
        full_name?: string;
        city?: string;
        avatar_url?: string;
        specialty?: string;
        years_experience?: number;
        trust_score?: number;
        avg_rating?: number;
        rethus_verified?: boolean;
        hourly_rate?: number;
        shift_rate?: number;
        monthly_rate?: number;
        phone?: string;
        verified?: boolean;
      }>;

      if (!candidates.length) {
        toast.info("La IA no encontró candidatos. Intenta con otros criterios.");
        setAiMode(false);
        return;
      }

      const mapped: ProSummary[] = candidates.map((c) => ({
        user_id: c.user_id,
        full_name: c.full_name ?? null,
        avatar_url: c.avatar_url ?? null,
        city: c.city ?? null,
        specialty: c.specialty ?? null,
        sub_specialties: null,
        avg_rating: c.avg_rating ?? null,
        trust_score: c.trust_score ?? null,
        hourly_rate: c.hourly_rate ?? null,
        shift_rate: c.shift_rate ?? null,
        monthly_rate: c.monthly_rate ?? null,
        phone: c.phone ?? null,
        verified: c.verified ?? null,
        rethus_verified: c.rethus_verified ?? null,
        ai_preapproved: null,
        available: true,
        years_experience: c.years_experience ?? null,
        bio: null,
        total_jobs: null,
        certifications: null,
      }));

      setAiResults(mapped);
      toast.success(`✨ IA encontró ${mapped.length} candidatos.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en búsqueda IA");
      setAiMode(false);
    } finally {
      setAiSearching(false);
    }
  };

  const clearAiMode = () => {
    setAiMode(false);
    setAiResults([]);
    setAiQuery("");
  };

  const clearFilters = () => {
    setFilterSpecialty("");
    setFilterCity(instCity);
    setFilterOffer("");
    setFilterAvailable(false);
    setFilterMinTrust(0);
    setFilterRethus(false);
    setFilterVerified(false);
  };

  // Pool tab counts
  const pendingCount = kpis.pending;
  const acceptedCount = kpis.accepted;
  const marketCount = extraPros.filter((p) => !applicantIds.has(p.user_id)).length;

  return (
    <div className="space-y-4">

      {/* ── Pending alert banner ── */}
      {pendingApps.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {pendingApps.length} postulación{pendingApps.length !== 1 ? "es" : ""} pendiente{pendingApps.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Revisa y responde para no perder talento valioso.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setPoolTab("pending"); setShowFilters(false); }}
            className="shrink-0 text-amber-600 hover:bg-amber-500/10 text-xs h-7 px-3"
          >
            Ver ahora →
          </Button>
        </div>
      )}

      {/* ── LiveMarketplaceMap ── */}
      <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-fuchsia-neural/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-fuchsia-neural" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Mapa en tiempo real</p>
              <p className="text-xs text-muted-foreground">Profesionales disponibles · actualización automática</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium ml-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              En vivo
            </span>
          </div>
          {showMap
            ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>
        {showMap && (
          <div className="border-t border-border">
            <LiveMarketplaceMap role="institution" userId={userId} height={400} />
          </div>
        )}
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <TalentKpi
          icon={<Users className="h-4 w-4" />}
          label="En tu pool"
          value={kpis.total}
          tone="fuchsia"
          onClick={() => setPoolTab("all")}
        />
        <TalentKpi
          icon={<span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
          label="Disponibles"
          value={kpis.available}
          tone="bio"
          onClick={() => { setPoolTab("all"); setFilterAvailable(true); }}
        />
        <TalentKpi
          icon={<Clock className="h-4 w-4" />}
          label="Pendientes"
          value={kpis.pending}
          tone="amber"
          urgent={kpis.pending > 0}
          onClick={() => setPoolTab("pending")}
        />
        <TalentKpi
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Aceptados"
          value={kpis.accepted}
          tone="bio"
          onClick={() => setPoolTab("accepted")}
        />
        <TalentKpi
          icon={<Award className="h-4 w-4" />}
          label="Con RETHUS"
          value={kpis.rethusCount}
          tone="fuchsia"
          onClick={() => { setPoolTab("all"); setFilterRethus(true); }}
        />
        <TalentKpi
          icon={<Star className="h-4 w-4" />}
          label="Rating ★"
          value={kpis.avgRating}
          tone="amber"
        />
      </div>

      {/* ── Pool quick-filter tabs ── */}
      <div className="flex items-center gap-0 border-b border-border overflow-x-auto">
        {(
          [
            { id: "all" as PoolTab, label: "Todos", count: rawPool.length },
            { id: "pending" as PoolTab, label: "Pendientes", count: pendingCount },
            { id: "accepted" as PoolTab, label: "Aceptados", count: acceptedCount },
            { id: "market" as PoolTab, label: "Mercado", count: marketCount, icon: <Globe className="h-3 w-3" /> },
          ] as { id: PoolTab; label: string; count: number; icon?: React.ReactNode }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setPoolTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors shrink-0",
              poolTab === t.id
                ? "border-fuchsia-neural text-fuchsia-neural"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
            )}
          >
            {t.icon}
            {t.label}
            {t.count > 0 && (
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  poolTab === t.id
                    ? "bg-fuchsia-neural/15 text-fuchsia-neural"
                    : t.id === "pending" && t.count > 0
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Search bar + sort + controls ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, especialidad o ciudad…"
            className="pl-9 pr-8"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="trust">↓ Trust Score</option>
          <option value="rating">↓ Rating</option>
          <option value="rate">↓ Tarifa</option>
          <option value="jobs">↓ Turnos</option>
          <option value="date">Más recientes</option>
        </select>

        <Button
          variant={showFilters ? "glass" : "outline"}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          className="shrink-0"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Filtros
          {activeFiltersCount > 0 && (
            <span className="ml-1.5 h-4 w-4 rounded-full bg-fuchsia-neural text-white text-[9px] font-bold flex items-center justify-center">
              {activeFiltersCount}
            </span>
          )}
        </Button>

        <div className="flex rounded-md border border-border overflow-hidden shrink-0">
          <button
            onClick={() => setViewMode("cards")}
            className={cn(
              "px-2.5 py-1.5 transition-colors",
              viewMode === "cards"
                ? "bg-fuchsia-neural/10 text-fuchsia-neural"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "px-2.5 py-1.5 border-l border-border transition-colors",
              viewMode === "table"
                ? "bg-fuchsia-neural/10 text-fuchsia-neural"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutList className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Filters panel ── */}
      {showFilters && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Specialty */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Especialidad</label>
              <select
                value={filterSpecialty}
                onChange={(e) => setFilterSpecialty(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none"
              >
                <option value="">Todas</option>
                {SPECIALTIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* City */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Ciudad</label>
              <Input
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
                placeholder="Bogotá, Cali…"
                className="h-9"
              />
            </div>

            {/* Filter by offer */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Filtrar por oferta</label>
              <select
                value={filterOffer}
                onChange={(e) => setFilterOffer(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none"
              >
                <option value="">Todas las ofertas</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </div>

            {/* Min trust */}
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">
                Trust Score mínimo:{" "}
                <span className="text-fuchsia-neural font-semibold">
                  {filterMinTrust > 0 ? `≥${filterMinTrust}` : "cualquiera"}
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={10}
                value={filterMinTrust}
                onChange={(e) => setFilterMinTrust(Number(e.target.value))}
                className="w-full h-1.5 accent-fuchsia-neural"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
            </div>
          </div>

          {/* Toggle chips */}
          <div className="flex flex-wrap gap-2">
            <FilterChip label="Disponible ahora" active={filterAvailable} icon="🟢" onClick={() => setFilterAvailable((v) => !v)} />
            <FilterChip label="RETHUS verificado" active={filterRethus} icon="🛡️" onClick={() => setFilterRethus((v) => !v)} />
            <FilterChip label="Perfil verificado" active={filterVerified} icon="✅" onClick={() => setFilterVerified((v) => !v)} />
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 rounded-full border border-border"
              >
                <X className="h-3 w-3" /> Limpiar filtros
              </button>
            )}
          </div>

          {/* Marketplace search */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <p className="text-xs font-medium">Búsqueda en marketplace</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {hasSearched
                  ? `${marketCount} profesionales del marketplace cargados`
                  : "Amplía la búsqueda más allá de tus aplicantes"}
              </p>
            </div>
            <Button size="sm" variant="glass" onClick={searchMarketplace} disabled={searching}>
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              {hasSearched ? "Actualizar" : "Buscar mercado"}
            </Button>
          </div>
        </div>
      )}

      {/* ── AI Smart Search (collapsible) ── */}
      <div className="rounded-2xl border border-fuchsia-neural/25 bg-fuchsia-neural/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAi((v) => !v)}
          className="w-full flex items-center justify-between p-3.5 text-left hover:bg-fuchsia-neural/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-fuchsia-neural" />
            <span className="text-sm font-semibold text-fuchsia-neural">Búsqueda IA · Lenguaje Natural</span>
            {aiMode && (
              <span className="text-[11px] bg-fuchsia-neural/15 text-fuchsia-neural px-2 py-0.5 rounded-full font-medium">
                ✨ {aiResults.length} resultados activos
              </span>
            )}
          </div>
          {showAi
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showAi && (
          <div className="px-4 pb-4 border-t border-fuchsia-neural/15 pt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Describe el perfil que necesitas y la IA busca los mejores candidatos en toda la plataforma.
            </p>
            <div className="flex gap-2">
              <Textarea
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                rows={2}
                placeholder='Ej: "Enfermera con RETHUS para UCI en Bogotá, disponible turno nocturno, mínimo 3 años de experiencia"'
                className="flex-1 text-sm resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void runAiSearch();
                  }
                }}
              />
              <Button
                onClick={runAiSearch}
                disabled={aiSearching || !aiQuery.trim()}
                variant="hero"
                className="shrink-0 self-end"
              >
                {aiSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {aiMode && (
              <button
                onClick={clearAiMode}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Limpiar resultados IA y volver al pool
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Results header ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {aiMode ? (
            <>
              <Sparkles className="inline h-3.5 w-3.5 text-fuchsia-neural mr-1 -mt-px" />
              <span className="text-fuchsia-neural font-medium">Resultados IA</span>
              {" · "}{filteredPool.length} candidato{filteredPool.length !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              {filteredPool.length} profesional{filteredPool.length !== 1 ? "es" : ""}
              {poolTab === "pending" && " pendientes de respuesta"}
              {poolTab === "accepted" && " aceptados"}
              {poolTab === "market" && " del marketplace"}
            </>
          )}
        </p>
        {filteredPool.length !== rawPool.length && !aiMode && (
          <span className="text-xs text-muted-foreground">
            de {rawPool.length} total
          </span>
        )}
      </div>

      {/* ── Pool grid / table ── */}
      {loading && rawPool.length === 0 ? (
        /* Skeleton while Phase 2 (professional profiles) is in flight */
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card/95 p-4 animate-pulse space-y-3">
              <div className="h-4 w-20 bg-muted rounded-full" />
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3.5 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
                <div className="h-12 w-12 rounded-full bg-muted shrink-0" />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <div className="h-5 bg-muted rounded-full w-16" />
                <div className="h-5 bg-muted rounded-full w-20" />
                <div className="h-5 bg-muted rounded-full w-14" />
              </div>
              <div className="flex gap-2 pt-1">
                <div className="h-8 bg-muted rounded-xl flex-1" />
                <div className="h-8 bg-muted rounded-xl w-14" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredPool.length === 0 ? (
        <EmptyPool
          poolTab={poolTab}
          hasSearched={hasSearched}
          onSearch={() => { setShowFilters(true); void searchMarketplace(); }}
          onShowAll={() => setPoolTab("all")}
        />
      ) : viewMode === "cards" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPool.map((pro) => (
            <ProCard
              key={pro.user_id}
              pro={pro}
              appHistory={appByPro[pro.user_id] ?? []}
              latestApp={latestAppByPro[pro.user_id]}
              offers={offers}
              updatingApp={updatingApp}
              onUpdateApp={onUpdateApp}
              isApplicant={applicantIds.has(pro.user_id)}
              canViewNames={canViewNames}
            />
          ))}
        </div>
      ) : (
        <TalentTable
          pool={filteredPool}
          latestAppByPro={latestAppByPro}
          offers={offers}
          updatingApp={updatingApp}
          onUpdateApp={onUpdateApp}
          applicantIds={applicantIds}
          canViewNames={canViewNames}
        />
      )}
    </div>
  );
}

// ── ProCard ────────────────────────────────────────────────────────────────

function ProCard({
  pro,
  appHistory,
  latestApp,
  offers,
  updatingApp,
  onUpdateApp,
  isApplicant,
  canViewNames,
}: {
  pro: ProSummary;
  appHistory: ApplicationRow[];
  latestApp: ApplicationRow | undefined;
  offers: Offer[];
  updatingApp: string | null;
  onUpdateApp: (appId: string, status: AppStatus) => void;
  isApplicant: boolean;
  canViewNames: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const trust = pro.trust_score ?? 0;
  const appliedOffer = offers.find((o) => o.id === latestApp?.job_offer_id);
  const wa = isApplicant
    ? waLink(pro.phone, pro.full_name ?? "profesional", appliedOffer?.title ?? "tu oferta")
    : waInvite(pro.phone, pro.full_name ?? "profesional");
  const cardIsNew = isApplicant && isNew(latestApp?.created_at);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/95 overflow-hidden transition-all flex flex-col",
        latestApp?.status === "pending"
          ? "border-amber-500/30 shadow-sm shadow-amber-500/5"
          : latestApp?.status === "accepted"
            ? "border-biosensor/30"
            : "border-border",
      )}
    >
      {/* Header */}
      <div className="p-4 flex-1">
        {/* Top row: source + new badges */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
              isApplicant
                ? "bg-biosensor/10 text-biosensor"
                : "bg-fuchsia-neural/10 text-fuchsia-neural",
            )}
          >
            {isApplicant ? "✓ Aplicó" : "🌐 Mercado"}
          </span>
          {cardIsNew && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 animate-pulse">
              Nuevo
            </span>
          )}
        </div>

        {/* Avatar + info + trust ring */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative shrink-0">
            {pro.avatar_url ? (
              <img
                src={pro.avatar_url}
                alt={pro.full_name ?? ""}
                className="h-12 w-12 rounded-full object-cover border-2 border-border"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-fuchsia-neural/10 border-2 border-fuchsia-neural/20 flex items-center justify-center text-base font-bold text-fuchsia-neural">
                {(pro.full_name ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            {pro.available && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background" title="Disponible ahora" />
            )}
          </div>

          {/* Name + specialty + city */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-sm truncate">
                <PlanNameGate name={pro.full_name} canView={canViewNames} fallback="—" />
              </p>
              {pro.verified && <BadgeCheck className="h-3.5 w-3.5 text-biosensor shrink-0" />}
              {pro.rethus_verified && <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-neural shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {pro.specialty ?? "—"}
              {pro.years_experience != null && ` · ${pro.years_experience} años`}
            </p>
            {pro.city && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" /> {pro.city}
              </p>
            )}
          </div>

          {/* Trust score ring */}
          <div className="shrink-0 text-center">
            <div className="relative h-12 w-12">
              <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
                <circle
                  cx="22" cy="22" r="18"
                  fill="none" stroke="currentColor" strokeWidth="3.5"
                  className="text-muted/30"
                />
                <circle
                  cx="22" cy="22" r="18"
                  fill="none" stroke="currentColor" strokeWidth="3.5"
                  strokeDasharray={`${2 * Math.PI * 18 * trust / 100} ${2 * Math.PI * 18 * (1 - trust / 100)}`}
                  strokeLinecap="round"
                  className={cn(
                    "transition-all",
                    trust >= 70 ? "text-biosensor" : trust >= 50 ? "text-amber-500" : "text-muted-foreground",
                  )}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] font-bold leading-none">{trust}</span>
                <span className="text-[8px] text-muted-foreground">Trust</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chips row */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pro.avg_rating != null && (
            <Chip
              icon={<Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
              label={`${pro.avg_rating.toFixed(1)} ★`}
            />
          )}
          {pro.total_jobs != null && (
            <Chip icon={<Briefcase className="h-3 w-3 text-muted-foreground" />} label={`${pro.total_jobs} turnos`} />
          )}
          {(pro.shift_rate ?? pro.hourly_rate) ? (
            <Chip
              icon={<DollarSign className="h-3 w-3 text-muted-foreground" />}
              label={pro.shift_rate ? `${COP(pro.shift_rate)}/turno` : `${COP(pro.hourly_rate)}/h`}
            />
          ) : null}
          {pro.rethus_verified && (
            <Chip icon={<ShieldCheck className="h-3 w-3 text-fuchsia-neural" />} label="RETHUS" accent />
          )}
          {pro.available ? (
            <Chip icon={<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />} label="Disponible" bio />
          ) : (
            <Chip icon={<Clock className="h-3 w-3 text-muted-foreground" />} label="No disponible" muted />
          )}
        </div>

        {/* Application status strip */}
        {latestApp && (
          <div
            className={cn(
              "mt-3 rounded-lg px-3 py-2 text-xs",
              latestApp.status === "pending"
                ? "bg-amber-500/10"
                : latestApp.status === "accepted"
                  ? "bg-biosensor/10"
                  : latestApp.status === "rejected"
                    ? "bg-rose-500/10"
                    : "bg-muted/30",
            )}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium">
                {latestApp.status === "pending"
                  ? "⏳ Pendiente de respuesta"
                  : latestApp.status === "accepted"
                    ? "✅ Aceptado"
                    : latestApp.status === "rejected"
                      ? "❌ Rechazado"
                      : "Retirado"}
              </span>
              <AppStatusBadge status={latestApp.status} />
            </div>
            {appliedOffer && (
              <p className="mt-1 text-muted-foreground truncate">
                Oferta: <span className="font-medium text-foreground">{appliedOffer.title}</span>
              </p>
            )}
            {latestApp.proposed_amount != null && (
              <p className="mt-0.5 text-muted-foreground">
                Propone: <span className="font-medium text-foreground">{COP(latestApp.proposed_amount)}</span>
              </p>
            )}
            {latestApp.message && (
              <p className="mt-1 italic text-muted-foreground line-clamp-2">
                "{latestApp.message}"
              </p>
            )}
            {appHistory.length > 1 && (
              <p className="mt-1 text-muted-foreground">
                {appHistory.length} postulaciones en total
              </p>
            )}
          </div>
        )}

        {/* Expanded: bio + sub-specialties + certs */}
        {expanded && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {pro.bio && (
              <p className="text-xs text-muted-foreground">{pro.bio}</p>
            )}
            {pro.sub_specialties && pro.sub_specialties.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">Sub-especialidades</p>
                <div className="flex flex-wrap gap-1">
                  {pro.sub_specialties.map((s) => (
                    <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {pro.certifications && pro.certifications.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">Certificaciones</p>
                <div className="flex flex-wrap gap-1">
                  {pro.certifications.map((c) => (
                    <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {pro.monthly_rate && (
              <p className="text-xs text-muted-foreground">
                Mensual: <span className="font-semibold text-foreground">{COP(pro.monthly_rate)}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 space-y-2">
        <div className="flex gap-2">
          <Button size="sm" variant="glass" className="flex-1" asChild>
            <Link to="/profesional/$proId" params={{ proId: pro.user_id }}>
              Ver perfil
            </Link>
          </Button>
          {wa && (
            <Button
              size="sm"
              variant="outline"
              className="border-biosensor/30 text-biosensor hover:bg-biosensor/5 gap-1.5"
              asChild
            >
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <Phone className="h-3.5 w-3.5" />
                WA
              </a>
            </Button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-2 text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? "Ocultar detalles" : "Ver más detalles"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Accept / reject for pending */}
        {latestApp?.status === "pending" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-biosensor hover:bg-biosensor/90 text-biosensor-foreground"
              onClick={() => onUpdateApp(latestApp.id, "accepted")}
              disabled={updatingApp === latestApp.id}
            >
              {updatingApp === latestApp.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              Aceptar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/5"
              onClick={() => onUpdateApp(latestApp.id, "rejected")}
              disabled={updatingApp === latestApp.id}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Rechazar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TalentTable ────────────────────────────────────────────────────────────

function TalentTable({
  pool,
  latestAppByPro,
  offers,
  updatingApp,
  onUpdateApp,
  applicantIds,
  canViewNames,
}: {
  pool: ProSummary[];
  latestAppByPro: Record<string, ApplicationRow>;
  offers: Offer[];
  updatingApp: string | null;
  onUpdateApp: (appId: string, status: AppStatus) => void;
  applicantIds: Set<string>;
  canViewNames: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[2.5rem_1fr_4rem_4rem_5.5rem_auto] gap-x-3 px-4 py-2.5 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
        <span />
        <span>Profesional</span>
        <span className="text-center hidden sm:block">Trust</span>
        <span className="text-center hidden md:block">Rating</span>
        <span className="text-right hidden lg:block">Tarifa</span>
        <span>Acción</span>
      </div>

      <div className="divide-y divide-border">
        {pool.map((pro) => {
          const latestApp = latestAppByPro[pro.user_id];
          const appliedOffer = offers.find((o) => o.id === latestApp?.job_offer_id);
          const isApplicant = applicantIds.has(pro.user_id);
          const wa = isApplicant
            ? waLink(pro.phone, pro.full_name ?? "profesional", appliedOffer?.title ?? "tu oferta")
            : waInvite(pro.phone, pro.full_name ?? "profesional");
          const trust = pro.trust_score ?? 0;

          return (
            <div
              key={pro.user_id}
              className="grid grid-cols-[2.5rem_1fr_4rem_4rem_5.5rem_auto] gap-x-3 items-center px-4 py-3 hover:bg-muted/20 transition-colors"
            >
              {/* Avatar */}
              <div className="relative w-8">
                {pro.avatar_url ? (
                  <img src={pro.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover border border-border" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-fuchsia-neural/10 flex items-center justify-center text-xs font-bold">
                    {(pro.full_name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                {pro.available && (
                  <span className="absolute -bottom-0 -right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                )}
              </div>

              {/* Name + info */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-medium truncate">
                    <PlanNameGate name={pro.full_name} canView={canViewNames} fallback="—" />
                  </p>
                  {pro.verified && <BadgeCheck className="h-3.5 w-3.5 text-biosensor shrink-0" />}
                  {pro.rethus_verified && <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-neural shrink-0" />}
                  <span
                    className={cn(
                      "text-[9px] font-semibold px-1.5 py-px rounded-full",
                      isApplicant ? "bg-biosensor/10 text-biosensor" : "bg-fuchsia-neural/10 text-fuchsia-neural",
                    )}
                  >
                    {isApplicant ? "Aplicó" : "Mercado"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {pro.specialty}
                  {pro.city && ` · ${pro.city}`}
                  {pro.years_experience != null && ` · ${pro.years_experience}a exp`}
                </p>
                {latestApp && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <AppStatusBadge status={latestApp.status} />
                    {appliedOffer && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                        → {appliedOffer.title}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Trust */}
              <div className="hidden sm:block text-center">
                <span
                  className={cn(
                    "text-sm font-bold",
                    trust >= 70 ? "text-biosensor" : trust >= 50 ? "text-amber-500" : "text-muted-foreground",
                  )}
                >
                  {pro.trust_score ?? "—"}
                </span>
              </div>

              {/* Rating */}
              <div className="hidden md:flex items-center gap-1 justify-center">
                {pro.avg_rating ? (
                  <>
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span className="text-sm font-medium">{pro.avg_rating.toFixed(1)}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>

              {/* Rate */}
              <div className="hidden lg:block text-right text-sm text-muted-foreground">
                {COP(pro.shift_rate ?? pro.hourly_rate)}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <Button size="sm" variant="glass" className="h-7 px-2 text-xs" asChild>
                  <Link to="/profesional/$proId" params={{ proId: pro.user_id }}>
                    Perfil
                  </Link>
                </Button>
                {wa && (
                  <Button size="sm" variant="outline" className="h-7 px-2 border-biosensor/30 text-biosensor" asChild>
                    <a href={wa} target="_blank" rel="noopener noreferrer" title="Contactar por WhatsApp">
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                {latestApp?.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      className="h-7 px-2 bg-biosensor hover:bg-biosensor/90 text-biosensor-foreground"
                      onClick={() => onUpdateApp(latestApp.id, "accepted")}
                      disabled={updatingApp === latestApp.id}
                      title="Aceptar"
                    >
                      {updatingApp === latestApp.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-muted-foreground hover:text-rose-600"
                      onClick={() => onUpdateApp(latestApp.id, "rejected")}
                      disabled={updatingApp === latestApp.id}
                      title="Rechazar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EmptyPool ──────────────────────────────────────────────────────────────

function EmptyPool({
  poolTab,
  hasSearched,
  onSearch,
  onShowAll,
}: {
  poolTab: PoolTab;
  hasSearched: boolean;
  onSearch: () => void;
  onShowAll: () => void;
}) {
  const messages: Record<PoolTab, { title: string; sub: string }> = {
    all: {
      title: "Aún no tienes candidatos",
      sub: hasSearched
        ? "Ajusta los filtros o la búsqueda."
        : "Publica ofertas para recibir postulaciones, o busca en el marketplace.",
    },
    pending: {
      title: "Sin postulaciones pendientes",
      sub: "Estás al día. Todas las postulaciones han sido respondidas.",
    },
    accepted: {
      title: "Ningún profesional aceptado",
      sub: "Acepta postulantes desde la vista \"Todos\" o \"Pendientes\".",
    },
    market: {
      title: "Marketplace vacío",
      sub: "Usa los filtros y haz clic en \"Buscar mercado\" para ampliar tu búsqueda.",
    },
  };
  const m = messages[poolTab];

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-10 text-center">
      <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-30" />
      <p className="font-semibold">{m.title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">{m.sub}</p>
      <div className="flex gap-2 justify-center mt-4 flex-wrap">
        {poolTab !== "all" && (
          <Button variant="outline" size="sm" onClick={onShowAll}>
            Ver todos
          </Button>
        )}
        {(poolTab === "all" || poolTab === "market") && (
          <Button variant="glass" size="sm" onClick={onSearch}>
            <Search className="h-3.5 w-3.5 mr-1.5" /> Buscar en marketplace
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Micro-components ───────────────────────────────────────────────────────

function TalentKpi({
  icon,
  label,
  value,
  tone,
  urgent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "fuchsia" | "bio" | "amber";
  urgent?: boolean;
  onClick?: () => void;
}) {
  const colors = {
    fuchsia: "text-fuchsia-neural bg-fuchsia-neural/10",
    bio: "text-biosensor bg-biosensor/10",
    amber: "text-amber-500 bg-amber-500/10",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-2xl border border-border bg-card/95 p-3.5 text-left transition-colors w-full",
        onClick && "hover:border-fuchsia-neural/30 hover:bg-muted/20 cursor-pointer",
        urgent && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-xl mb-2", colors)}>
        {icon}
      </div>
      <p className={cn("text-xl font-bold", urgent && value !== 0 && "text-amber-600")}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </button>
  );
}

function Chip({
  icon,
  label,
  accent,
  bio,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  bio?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
        accent
          ? "bg-fuchsia-neural/10 text-fuchsia-neural"
          : bio
            ? "bg-biosensor/10 text-biosensor"
            : muted
              ? "bg-muted text-muted-foreground"
              : "bg-muted/50 text-muted-foreground",
      )}
    >
      {icon} {label}
    </span>
  );
}

function FilterChip({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-fuchsia-neural/10 border-fuchsia-neural/30 text-fuchsia-neural"
          : "bg-background border-border text-muted-foreground hover:border-fuchsia-neural/30",
      )}
    >
      <span>{icon}</span> {label}
    </button>
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
