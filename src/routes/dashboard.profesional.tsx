import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppUser } from "@/hooks/use-app-user";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  Loader2,
  Sparkles,
  Stethoscope,
  Star,
  Briefcase,
  MapPin,
  Wand2,
  Send,
  LogOut,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Plus,
  X,
  Home,
  User,
  FileText,
  ListChecks,
  CalendarDays,
  ChevronRight,
  Clock,
  AlertCircle,
  CircleCheck,
  BadgeCheck,
  Wallet,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/humanix/Logo";
import { HumanixAssistant } from "@/components/humanix/HumanixAssistant";
import { AvatarUploader } from "@/components/humanix/AvatarUploader";
import { DocumentsManager } from "@/components/humanix/DocumentsManager";
import { HealthComplianceCard } from "@/components/humanix/HealthComplianceCard";
import { AvailabilityCalendar } from "@/components/humanix/AvailabilityCalendar";
import { OnboardingTour } from "@/components/humanix/OnboardingTour";
import { AiFingerprintCard } from "@/components/humanix/AiFingerprintCard";
import { SemanticOffers } from "@/components/humanix/SemanticOffers";
import { LiveMapSection } from "@/components/humanix/LiveMapSection";
import { LocationPicker } from "@/components/humanix/LocationPicker";
import { ReferencesManager } from "@/components/humanix/ReferencesManager";
import { MercadoPagoSubscription } from "@/components/humanix/MercadoPagoSubscription";
import { WalletPanel } from "@/components/humanix/WalletPanel";
import { AiCreditsBalance } from "@/components/humanix/AiCreditsBalance";
import { NotificationsBell } from "@/components/humanix/NotificationsBell";
import { PublishGate } from "@/components/humanix/PublishGate";
import { DangerZoneCard } from "@/components/humanix/DangerZoneCard";
import { PendingRatingsCard } from "@/components/humanix/PendingRatingsCard";
import { OpenFamilyNeedsList } from "@/components/humanix/OpenFamilyNeedsList";
import { ProposalsInbox } from "@/components/humanix/ProposalsInbox";
import { ReferralCard } from "@/components/humanix/ReferralCard";
import { ClinicalMonitor } from "@/components/humanix/ClinicalMonitor";
import { LivePulseBar } from "@/components/humanix/LivePulseBar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/profesional")({
  head: () => ({
    meta: [{ title: "Mi panel profesional · Humanix" }],
  }),
  component: ProDashboard,
});

type Tab = "inicio" | "perfil" | "documentos" | "ofertas" | "agenda";

type WorkExp = {
  role: string;
  employer: string;
  city?: string;
  start?: string;
  end?: string;
  description?: string;
};

type ProProfile = {
  user_id: string;
  specialty: string | null;
  sub_specialties: string[] | null;
  years_experience: number | null;
  rethus_number: string | null;
  rethus_verified: boolean | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  monthly_rate: number | null;
  service_cities: string[] | null;
  languages: string[] | null;
  certifications: unknown;
  trust_score: number | null;
  ai_summary: string | null;
  ai_strengths: string[] | null;
  ai_suggestions: string[] | null;
  ai_preapproved: boolean | null;
  verified: boolean | null;
  active: boolean | null;
  total_jobs: number | null;
  avg_rating: number | null;
  avatar_url: string | null;
  bio: string | null;
  work_experience: WorkExp[] | null;
  lat: number | null;
  lng: number | null;
  home_city: string | null;
  published: boolean | null;
};

type Offer = {
  id: string;
  title: string;
  description: string | null;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  city: string;
  specialty_required: string | null;
  shifts_count: number | null;
  status: "open" | "closed" | "filled";
  created_at: string;
  posted_by: string;
};

type AppRow = {
  id: string;
  job_offer_id: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
};

const COP = (n: number | null | undefined) =>
  typeof n === "number"
    ? new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n)
    : "—";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "inicio", label: "Inicio", icon: <Home className="h-5 w-5" /> },
  { id: "perfil", label: "Perfil", icon: <User className="h-5 w-5" /> },
  { id: "documentos", label: "Docs", icon: <FileText className="h-5 w-5" /> },
  { id: "ofertas", label: "Ofertas", icon: <ListChecks className="h-5 w-5" /> },
  { id: "agenda", label: "Agenda", icon: <CalendarDays className="h-5 w-5" /> },
];

function ProDashboard() {
  const {
    user,
    loading: authLoading,
    logout: appLogout,
  } = useAppUser({ allow: ["professional", "superadmin"] });

  const [tab, setTab] = useState<Tab>("inicio");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>("");
  const [profile, setProfile] = useState<ProProfile | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [showTour, setShowTour] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [docSummary, setDocSummary] = useState<Record<string, boolean>>({});

  // IA onboarding
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  // Form fields
  const [specialty, setSpecialty] = useState("");
  const [years, setYears] = useState<number | "">("");
  const [rethus, setRethus] = useState("");
  const [hourly, setHourly] = useState<number | "">("");
  const [shift, setShift] = useState<number | "">("");
  const [monthly, setMonthly] = useState<number | "">("");
  const [cities, setCities] = useState("");
  const [subs, setSubs] = useState("");
  const [certs, setCerts] = useState("");
  const [bio, setBio] = useState("");
  const [workExp, setWorkExp] = useState<WorkExp[]>([]);

  const trust = profile?.trust_score ?? 0;
  const greetingName = useMemo(() => fullName.split(" ")[0] || "profesional", [fullName]);

  // Profile completion steps
  const completionSteps = useMemo(() => [
    { label: "Foto de perfil", done: !!profile?.avatar_url },
    { label: "Especialidad", done: !!specialty },
    { label: "Bio profesional", done: bio.trim().length > 10 },
    { label: "Años de experiencia", done: years !== "" && Number(years) > 0 },
    { label: "Ciudades de servicio", done: cities.trim().length > 0 },
    { label: "Hoja de vida", done: !!docSummary["cv"] },
    { label: "Cédula", done: !!docSummary["id_document"] },
    { label: "Recibo servicios", done: !!docSummary["utility_bill"] },
    { label: "RETHUS o Diploma", done: !!(docSummary["rethus"] || docSummary["diploma"]) },
  ], [profile?.avatar_url, specialty, bio, years, cities, docSummary]);

  const completionPct = Math.round(
    (completionSteps.filter((s) => s.done).length / completionSteps.length) * 100,
  );
  const pendingSteps = completionSteps.filter((s) => !s.done);

  const loadAll = async (uid: string) => {
    try {
      const [p, pr, off, ap, docs] = await Promise.all([
        supabase.from("professional_profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("profiles").select("full_name").eq("user_id", uid).maybeSingle(),
        supabase
          .from("job_offers")
          .select("*")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("applications")
          .select("id, job_offer_id, status, created_at")
          .eq("professional_id", uid)
          .order("created_at", { ascending: false }),
        supabase
          .from("professional_documents")
          .select("doc_type, status")
          .eq("user_id", uid)
          .neq("status", "rejected"),
      ]);

      if (pr.data?.full_name) setFullName(pr.data.full_name);
      if (off.data) setOffers(off.data as Offer[]);
      if (ap.data) setApps(ap.data as AppRow[]);

      const summary: Record<string, boolean> = {};
      (docs.data ?? []).forEach((d: { doc_type: string }) => {
        summary[d.doc_type] = true;
      });
      setDocSummary(summary);

      if (p.data) {
        const pp = p.data as unknown as ProProfile;
        setProfile(pp);
        setIsOnline(pp.active ?? false);
        setSpecialty(pp.specialty ?? "");
        setYears(pp.years_experience ?? "");
        setRethus(pp.rethus_number ?? "");
        setHourly(pp.hourly_rate ?? "");
        setShift(pp.shift_rate ?? "");
        setMonthly(pp.monthly_rate ?? "");
        setCities((pp.service_cities ?? []).join(", "));
        setSubs((pp.sub_specialties ?? []).join(", "));
        setCerts(
          Array.isArray(pp.certifications) ? (pp.certifications as string[]).join(", ") : "",
        );
        setBio(pp.bio ?? "");
        setWorkExp(Array.isArray(pp.work_experience) ? pp.work_experience : []);
      } else {
        const ins = await supabase.from("professional_profiles").insert({ user_id: uid });
        if (ins.error) console.warn("[pro dashboard] could not create empty profile:", ins.error.message);
      }
    } catch (err) {
      console.error("[pro dashboard] loadAll failed:", err);
      toast.error("No pudimos cargar todos tus datos. Intenta refrescar.");
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    let active = true;
    const uid = user.id;
    setUserId(uid);
    setFullName(user.fullName);
    (async () => {
      try {
        await loadAll(uid);
      } finally {
        if (active) setLoading(false);
      }
      try {
        const seen = localStorage.getItem(`hx_tour_${uid}`);
        if (!seen && active) setShowTour(true);
      } catch { /* ignore */ }
    })();
    const safety = setTimeout(() => { if (active) setLoading(false); }, 6000);
    return () => { active = false; clearTimeout(safety); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  useRealtimeRefresh(
    `pro-dash-realtime-${userId ?? "anon"}`,
    [
      { table: "professional_profiles", event: "UPDATE", filter: userId ? `user_id=eq.${userId}` : undefined },
      { table: "applications", event: "*", filter: userId ? `professional_id=eq.${userId}` : undefined },
      { table: "job_offers", event: "*" },
    ],
    () => { if (userId) void loadAll(userId); },
    !!userId,
  );

  const closeTour = () => {
    setShowTour(false);
    if (userId) {
      try { localStorage.setItem(`hx_tour_${userId}`, "1"); } catch { /* ignore */ }
    }
  };

  const toggleOnline = async () => {
    if (!userId) return;
    setTogglingOnline(true);
    const next = !isOnline;
    try {
      await supabase
        .from("professional_profiles")
        .update({ active: next } as never)
        .eq("user_id", userId);
      setIsOnline(next);
      setProfile((prev) => (prev ? { ...prev, active: next } : prev));
      toast.success(next ? "¡Estás disponible! Las familias pueden encontrarte." : "Cambiaste a no disponible.");
    } catch {
      toast.error("No se pudo actualizar tu disponibilidad.");
    } finally {
      setTogglingOnline(false);
    }
  };

  const applyExtraction = (p: Record<string, unknown>) => {
    if (typeof p.specialty === "string") setSpecialty(p.specialty);
    if (typeof p.years_experience === "number") setYears(p.years_experience);
    if (typeof p.rethus_number === "string") setRethus(p.rethus_number);
    if (typeof p.hourly_rate === "number") setHourly(p.hourly_rate);
    if (typeof p.shift_rate === "number") setShift(p.shift_rate);
    if (typeof p.monthly_rate === "number") setMonthly(p.monthly_rate);
    if (Array.isArray(p.service_cities)) setCities((p.service_cities as string[]).join(", "));
    if (Array.isArray(p.sub_specialties)) setSubs((p.sub_specialties as string[]).join(", "));
    if (Array.isArray(p.certifications)) setCerts((p.certifications as string[]).join(", "));
    if (typeof p.bio === "string" && !bio) setBio(p.bio);
    if (Array.isArray(p.work_experience)) setWorkExp(p.work_experience as WorkExp[]);
    if (typeof p.full_name === "string" && !fullName) setFullName(p.full_name);
  };

  const extractFromText = async () => {
    const text = aiText.trim();
    if (!text) { toast.error("Cuéntame primero sobre tu experiencia"); return; }
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("onboarding-extractor", { body: { text } });
      if (error) throw error;
      applyExtraction(data?.profile ?? {});
      toast.success("✨ Listo. Revisa los campos antes de guardar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error procesando con IA");
    } finally {
      setAiBusy(false);
    }
  };

  const buildPayload = () => ({
    specialty: specialty || null,
    years_experience: years === "" ? null : Number(years),
    rethus_number: rethus || null,
    hourly_rate: hourly === "" ? null : Number(hourly),
    shift_rate: shift === "" ? null : Number(shift),
    monthly_rate: monthly === "" ? null : Number(monthly),
    service_cities: cities.split(",").map((s) => s.trim()).filter(Boolean),
    sub_specialties: subs.split(",").map((s) => s.trim()).filter(Boolean),
    certifications: certs.split(",").map((s) => s.trim()).filter(Boolean),
    bio: bio || null,
    work_experience: workExp,
  });

  const saveProfile = async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("professional_profiles")
      .update(buildPayload())
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (data) setProfile(data as unknown as ProProfile);
    toast.success("Perfil guardado");
  };

  const validateWithAI = async () => {
    if (!userId) return;
    setValidating(true);
    try {
      const payload = buildPayload();
      const { data, error } = await supabase.functions.invoke("profile-validator", {
        body: { profile: { ...payload, rethus_verified: profile?.rethus_verified ?? false } },
      });
      if (error) throw error;
      const ev = data?.evaluation ?? {};
      const score = typeof ev.trust_score === "number" ? Math.round(ev.trust_score) : 0;
      const upd = await supabase
        .from("professional_profiles")
        .update({ ai_summary: ev.ai_summary ?? null, ai_strengths: ev.ai_strengths ?? [], ai_suggestions: ev.ai_suggestions ?? [], trust_score: score, ai_preapproved: score >= 70 })
        .eq("user_id", userId)
        .select()
        .maybeSingle();
      if (upd.data) setProfile(upd.data as unknown as ProProfile);
      toast.success(score >= 70 ? "✨ Pre-aprobado por IA. Nuestro equipo confirmará pronto." : "Trust Score actualizado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en validación IA");
    } finally {
      setValidating(false);
    }
  };

  const suggestRatesAndBio = async () => {
    if (!userId) return;
    setSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("rate-suggester", { body: { profile: buildPayload() } });
      if (error) throw error;
      const s = data?.suggestion ?? {};
      if (typeof s.hourly_rate === "number") setHourly(s.hourly_rate);
      if (typeof s.shift_rate === "number") setShift(s.shift_rate);
      if (typeof s.monthly_rate === "number") setMonthly(s.monthly_rate);
      if (typeof s.bio === "string") setBio(s.bio);
      toast.success("✨ Sugerencias aplicadas. Revisa antes de guardar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error sugiriendo tarifas");
    } finally {
      setSuggesting(false);
    }
  };

  const apply = async (offerId: string) => {
    if (!userId) return;
    const { error } = await supabase.from("applications").insert({ job_offer_id: offerId, professional_id: userId });
    if (error) { toast.error(error.message); return; }
    const { error: rpcErr } = await supabase.rpc("set_offer_reserved", { _offer_id: offerId, _professional_id: userId });
    if (rpcErr) console.warn("[reserve]", rpcErr.message);
    toast.success("✓ Aplicación enviada · oferta reservada 15 días");
    const [{ data: appsData }, { data: offersData }] = await Promise.all([
      supabase.from("applications").select("id, job_offer_id, status, created_at").eq("professional_id", userId),
      supabase.from("job_offers").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(20),
    ]);
    if (appsData) setApps(appsData as AppRow[]);
    if (offersData) setOffers(offersData as Offer[]);
  };

  const logout = async () => { await appLogout(); };

  const appliedIds = new Set(apps.map((a) => a.job_offer_id));

  const addExp = () => setWorkExp((prev) => [...prev, { role: "", employer: "", city: "", start: "", end: "" }]);
  const updateExp = (i: number, k: keyof WorkExp, v: string) =>
    setWorkExp((prev) => prev.map((e, idx) => (idx === i ? { ...e, [k]: v } : e)));
  const removeExp = (i: number) => setWorkExp((prev) => prev.filter((_, idx) => idx !== i));

  if (authLoading || loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-biosensor/10 flex items-center justify-center">
            <Stethoscope className="h-6 w-6 text-biosensor animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">Cargando tu panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora pb-20 sm:pb-0">
      {showTour && <OnboardingTour onClose={closeTour} />}

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/20 font-medium">
              <Stethoscope className="h-3 w-3" /> Profesional
            </span>
          </div>

          {/* Online toggle */}
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-semibold transition-colors", isOnline ? "text-emerald-500" : "text-muted-foreground")}>
              {togglingOnline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isOnline ? "Disponible" : "No disponible"}
            </span>
            <Switch
              checked={isOnline}
              onCheckedChange={toggleOnline}
              disabled={togglingOnline}
              className={cn("data-[state=checked]:bg-emerald-500")}
            />
          </div>

          <div className="flex items-center gap-1">
            {userId && <NotificationsBell userId={userId} />}
            <Button variant="ghost" size="icon" onClick={logout} title="Salir">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Desktop tab bar ── */}
        <div className="hidden sm:flex border-t border-border">
          <div className="mx-auto max-w-4xl w-full px-4 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  tab === t.id
                    ? "border-biosensor text-biosensor"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="mx-auto max-w-4xl px-4 py-6">

        {/* ══ TAB: INICIO ══ */}
        {tab === "inicio" && (
          <div className="space-y-4">

            <LivePulseBar role="professional" />

            {/* Hero card */}
            <div className="rounded-2xl bg-gradient-to-br from-biosensor/10 via-background to-fuchsia-neural/10 border border-border p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={greetingName}
                      className="h-14 w-14 rounded-full object-cover border-2 border-biosensor/30"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-biosensor/10 border-2 border-biosensor/20 flex items-center justify-center">
                      <User className="h-7 w-7 text-biosensor" />
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-lg leading-tight">{greetingName}</p>
                    <p className="text-sm text-muted-foreground">{specialty || "Completa tu especialidad"}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {profile?.verified && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                          <BadgeCheck className="h-3 w-3" /> Verificado
                        </span>
                      )}
                      {profile?.ai_preapproved && !profile?.verified && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural font-medium">
                          <Sparkles className="h-3 w-3" /> Pre-aprobado IA
                        </span>
                      )}
                      {isOnline && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          En línea
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Trust ring */}
                <div className="shrink-0 text-center">
                  <div className="relative h-16 w-16">
                    <svg className="h-16 w-16 -rotate-90" viewBox="0 0 60 60">
                      <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
                      <circle
                        cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="4"
                        strokeDasharray={`${2 * Math.PI * 26 * trust / 100} ${2 * Math.PI * 26 * (1 - trust / 100)}`}
                        strokeLinecap="round"
                        className="text-biosensor transition-all duration-700"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-base font-bold leading-none">{trust}</span>
                      <span className="text-[9px] text-muted-foreground">Trust</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatPill icon={<Briefcase className="h-3.5 w-3.5" />} label="Turnos" value={String(profile?.total_jobs ?? 0)} />
                <StatPill icon={<Star className="h-3.5 w-3.5" />} label="Rating" value={(profile?.avg_rating ?? 0).toFixed(1)} />
                <StatPill icon={<TrendingUp className="h-3.5 w-3.5" />} label="Ofertas" value={String(offers.length)} />
              </div>
            </div>

            {/* Profile completion */}
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Completitud del perfil</p>
                <span className={cn("text-sm font-bold", completionPct >= 80 ? "text-emerald-500" : completionPct >= 50 ? "text-amber-500" : "text-rose-500")}>
                  {completionPct}%
                </span>
              </div>
              <Progress value={completionPct} className="h-2" />
              {pendingSteps.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {pendingSteps.slice(0, 3).map((s) => (
                    <div key={s.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span>Falta: <strong>{s.label}</strong></span>
                    </div>
                  ))}
                  {pendingSteps.length > 3 && (
                    <p className="text-xs text-muted-foreground">+{pendingSteps.length - 3} más pendientes</p>
                  )}
                </div>
              )}
              {completionPct === 100 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
                  <CircleCheck className="h-4 w-4" /> ¡Perfil completo! Estás listo para recibir ofertas.
                </div>
              )}
            </div>

            {/* AI suggestions strip */}
            {(profile?.ai_suggestions?.length ?? 0) > 0 && (
              <div className="rounded-2xl border border-fuchsia-neural/20 bg-fuchsia-neural/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-fuchsia-neural" />
                  <p className="text-sm font-semibold text-fuchsia-neural">Sugerencias IA para ti</p>
                </div>
                <ul className="space-y-1.5">
                  {(profile?.ai_suggestions ?? []).slice(0, 3).map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2">
                      <ChevronRight className="h-3.5 w-3.5 text-fuchsia-neural mt-0.5 shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Top matching offers preview */}
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-biosensor" />
                  <p className="text-sm font-semibold">Ofertas para ti</p>
                </div>
                <button onClick={() => setTab("ofertas")} className="text-xs text-biosensor hover:underline flex items-center gap-1">
                  Ver todas <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {offers.slice(0, 3).map((o) => (
                <OfferCard key={o.id} offer={o} applied={appliedIds.has(o.id)} onApply={apply} />
              ))}
              {offers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No hay ofertas activas en este momento.</p>
              )}
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-3">
              <QuickAction icon={<User className="h-5 w-5 text-biosensor" />} label="Completar perfil" sub="Datos + foto + bio" onClick={() => setTab("perfil")} />
              <QuickAction icon={<FileText className="h-5 w-5 text-fuchsia-neural" />} label="Subir documentos" sub={`${Object.keys(docSummary).length} subidos`} onClick={() => setTab("documentos")} />
              <QuickAction icon={<CalendarDays className="h-5 w-5 text-biosensor" />} label="Mi agenda" sub="Disponibilidad" onClick={() => setTab("agenda")} />
              <QuickAction icon={<TrendingUp className="h-5 w-5 text-fuchsia-neural" />} label="Re-evaluar Trust" sub={`Score: ${trust}/100`} onClick={validateWithAI} loading={validating} />
              <QuickAction icon={<HeartPulse className="h-5 w-5 text-rose-500" />} label="Monitoreo de pacientes" sub="Signos vitales y alertas en vivo" to="/dashboard/monitoreo" />
            </div>

            {/* Monitoreo Clínico propio del profesional */}
            {userId && (
              <div className="space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <HeartPulse className="h-4 w-4 text-rose-500 animate-pulse" />
                  Mis signos vitales
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                </p>
                <ClinicalMonitor patientId={userId} showDeviceGuide compact />
              </div>
            )}

            {/* Billetera — saldo, movimientos y retiros Nequi/PSE/RappiPay */}
            {userId && (
              <div className="space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-emerald-600" /> Mi billetera
                </p>
                <WalletPanel userId={userId} />
              </div>
            )}

            {/* Créditos IA — saldo y consumo del cupo mensual */}
            {userId && <AiCreditsBalance userId={userId} />}

            {/* Referidos — gana meses gratis */}
            {userId && <ReferralCard userId={userId} />}

            {/* Suscripción */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 overflow-hidden">
                <MercadoPagoSubscription userId={userId} />
              </div>
            )}
          </div>
        )}

        {/* ══ TAB: PERFIL ══ */}
        {tab === "perfil" && (
          <div className="space-y-4">

            {/* Avatar */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-5">
                <p className="text-sm font-semibold mb-4">Foto de perfil</p>
                <AvatarUploader
                  userId={userId}
                  initialUrl={profile?.avatar_url ?? null}
                  onChange={(url) => {
                    setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
                    setDocSummary((prev) => ({ ...prev, _avatar: true }));
                  }}
                />
              </div>
            )}

            {/* IA onboarding */}
            <div className="rounded-2xl border border-fuchsia-neural/20 bg-fuchsia-neural/5 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Wand2 className="h-4 w-4 text-fuchsia-neural" />
                <p className="text-sm font-semibold">Llena tu perfil con IA</p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Cuéntame en una frase tu experiencia y completo los campos por ti. O sube tu hoja de vida en Documentos.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Textarea
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  rows={2}
                  placeholder='Ej: "Soy enfermera, 7 años en cuidado adulto mayor, RETHUS 12345, atiendo Bogotá y Soacha, tengo BLS vigente."'
                  className="flex-1 text-sm"
                />
                <Button onClick={extractFromText} disabled={aiBusy} variant="hero" className="shrink-0">
                  {aiBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                  Extraer
                </Button>
              </div>
            </div>

            {/* Profile form */}
            <div className="rounded-2xl border border-border bg-card/95 p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <p className="text-sm font-semibold">Datos profesionales</p>
                <Button size="sm" variant="glass" onClick={suggestRatesAndBio} disabled={suggesting || !specialty} title={!specialty ? "Llena la especialidad primero" : undefined}>
                  {suggesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
                  Sugerir tarifas con IA
                </Button>
              </div>

              <div className="space-y-5">
                {/* Identidad profesional */}
                <FormSection label="Identidad profesional">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Especialidad principal *">
                      <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Cuidado adulto mayor" />
                    </Field>
                    <Field label="Años de experiencia">
                      <Input type="number" value={years} onChange={(e) => setYears(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
                    </Field>
                    <Field label="Número RETHUS">
                      <Input value={rethus} onChange={(e) => setRethus(e.target.value)} placeholder="RN-XXXXXXX" />
                    </Field>
                    <Field label="Sub-especialidades">
                      <Input value={subs} onChange={(e) => setSubs(e.target.value)} placeholder="Heridas, EPOC" />
                    </Field>
                    <Field label="Certificaciones" className="sm:col-span-2">
                      <Input value={certs} onChange={(e) => setCerts(e.target.value)} placeholder="BLS, ACLS" />
                    </Field>
                  </div>
                </FormSection>

                {/* Cobertura */}
                <FormSection label="Cobertura geográfica">
                  <Field label="Ciudades de servicio (separadas por coma)">
                    <Input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Bogotá, Soacha, Chía" />
                  </Field>
                </FormSection>

                {/* Tarifas */}
                <FormSection label="Tarifas (COP)">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Por hora">
                      <Input type="number" value={hourly} onChange={(e) => setHourly(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
                    </Field>
                    <Field label="Por turno">
                      <Input type="number" value={shift} onChange={(e) => setShift(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
                    </Field>
                    <Field label="Mensual">
                      <Input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value === "" ? "" : Number(e.target.value))} placeholder="0" />
                    </Field>
                  </div>
                  {(hourly || shift || monthly) && (
                    <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                      {hourly ? <p className="text-center">{COP(Number(hourly))}/h</p> : <span />}
                      {shift ? <p className="text-center">{COP(Number(shift))}/turno</p> : <span />}
                      {monthly ? <p className="text-center">{COP(Number(monthly))}/mes</p> : <span />}
                    </div>
                  )}
                </FormSection>

                {/* Bio */}
                <FormSection label="Bio profesional">
                  <Field label="Lo que ven familias e IPS">
                    <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Cuéntale al mundo quién eres en 2-3 frases." />
                  </Field>
                </FormSection>
              </div>

              {/* Work experience */}
              <div className="mt-5 pt-5 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold">Experiencia laboral</p>
                  <Button size="sm" variant="glass" onClick={addExp}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
                  </Button>
                </div>
                {workExp.length === 0 ? (
                  <button
                    onClick={addExp}
                    className="w-full rounded-xl border-2 border-dashed border-border hover:border-biosensor/50 transition-colors py-6 text-center text-sm text-muted-foreground"
                  >
                    <Briefcase className="h-5 w-5 mx-auto mb-1 opacity-40" />
                    Agrega tu experiencia laboral<br />
                    <span className="text-xs">O sube tu CV en Documentos y la IA la llena por ti</span>
                  </button>
                ) : (
                  <ul className="space-y-3">
                    {workExp.map((e, i) => (
                      <li key={i} className="rounded-xl border border-border bg-background p-3">
                        <div className="flex justify-between items-center mb-2">
                          <p className="text-xs text-muted-foreground font-medium">Experiencia {i + 1}</p>
                          <button onClick={() => removeExp(i)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Eliminar">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <Input placeholder="Cargo / Rol" value={e.role} onChange={(ev) => updateExp(i, "role", ev.target.value)} />
                          <Input placeholder="Empresa / IPS / Clínica" value={e.employer} onChange={(ev) => updateExp(i, "employer", ev.target.value)} />
                          <Input placeholder="Ciudad" value={e.city ?? ""} onChange={(ev) => updateExp(i, "city", ev.target.value)} />
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder="Inicio (2020)" value={e.start ?? ""} onChange={(ev) => updateExp(i, "start", ev.target.value)} />
                            <Input placeholder="Fin (Actual)" value={e.end ?? ""} onChange={(ev) => updateExp(i, "end", ev.target.value)} />
                          </div>
                        </div>
                        <Textarea className="mt-2" rows={2} placeholder="Logros y responsabilidades clave" value={e.description ?? ""} onChange={(ev) => updateExp(i, "description", ev.target.value)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Save + publish */}
              {userId && (
                <div className="mt-5 pt-5 border-t border-border">
                  <PublishGate
                    userId={userId}
                    profilePayload={{ ...buildPayload(), full_name: fullName, rethus_verified: profile?.rethus_verified ?? false }}
                    published={profile?.published ?? false}
                    onSaved={saveProfile}
                    onPublished={async () => { setProfile((prev) => (prev ? { ...prev, published: true } : prev)); }}
                  />
                </div>
              )}
            </div>

            {/* AI feedback */}
            {(profile?.ai_summary || (profile?.ai_strengths?.length ?? 0) > 0) && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border bg-card/95 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-medium">Resumen IA</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown>{profile?.ai_summary ?? ""}</ReactMarkdown>
                  </div>
                  {!!profile?.ai_strengths?.length && (
                    <ul className="mt-3 space-y-1.5">
                      {profile.ai_strengths.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-biosensor mt-0.5 shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-2xl border border-border bg-card/95 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-medium">Para subir tu Trust Score</p>
                  <ul className="space-y-1.5">
                    {(profile?.ai_suggestions ?? []).map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-fuchsia-neural mt-0.5 shrink-0" /> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Trust re-evaluate */}
            <div className="rounded-2xl border border-border bg-card/95 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Trust Score: <span className="text-biosensor">{trust}/100</span></p>
                <p className="text-xs text-muted-foreground">≥70 = pre-aprobado por IA</p>
              </div>
              <Button variant="glass" size="sm" onClick={validateWithAI} disabled={validating}>
                {validating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                Re-evaluar
              </Button>
            </div>

            {/* References */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-5">
                <p className="text-sm font-semibold mb-1">Referencias laborales y familiares</p>
                <p className="text-xs text-muted-foreground mb-4">Mínimo 2 laborales y 2 familiares (nombre y celular).</p>
                <ReferencesManager userId={userId} />
              </div>
            )}

            {/* AI Fingerprint */}
            {userId && <AiFingerprintCard userId={userId} />}

            {/* Danger zone */}
            {userId && <DangerZoneCard userId={userId} role="professional" />}
          </div>
        )}

        {/* ══ TAB: DOCUMENTOS ══ */}
        {tab === "documentos" && (
          <div className="space-y-4">
            {/* Progreso docs */}
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Documentos requeridos</p>
                <span className="text-sm font-bold text-biosensor">
                  {[docSummary["cv"], docSummary["id_document"], docSummary["utility_bill"]].filter(Boolean).length}/3
                </span>
              </div>
              <Progress
                value={([docSummary["cv"], docSummary["id_document"], docSummary["utility_bill"]].filter(Boolean).length / 3) * 100}
                className="h-2"
              />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { key: "cv", label: "CV" },
                  { key: "id_document", label: "Cédula" },
                  { key: "utility_bill", label: "Recibo" },
                ].map((d) => (
                  <div key={d.key} className={cn("rounded-lg p-2.5 text-center text-xs font-medium border", docSummary[d.key] ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-amber-500/10 border-amber-500/20 text-amber-600")}>
                    {docSummary[d.key] ? <CheckCircle2 className="h-4 w-4 mx-auto mb-1" /> : <Clock className="h-4 w-4 mx-auto mb-1" />}
                    {d.label}
                  </div>
                ))}
              </div>
            </div>

            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-5">
                <DocumentsManager userId={userId} onCvExtracted={(p) => { applyExtraction(p); setTab("perfil"); }} />
              </div>
            )}

            {userId && <HealthComplianceCard professionalId={userId} />}
          </div>
        )}

        {/* ══ TAB: OFERTAS ══ */}
        {tab === "ofertas" && (
          <div className="space-y-4">

            {/* My applications */}
            {apps.length > 0 && (
              <div className="rounded-2xl border border-border bg-card/95 p-4">
                <p className="text-sm font-semibold mb-3">Mis aplicaciones ({apps.length})</p>
                <ul className="space-y-2">
                  {apps.slice(0, 5).map((a) => {
                    const offer = offers.find((o) => o.id === a.job_offer_id);
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium">{offer?.title ?? "Oferta"}</p>
                          <p className="text-xs text-muted-foreground">{offer?.city}</p>
                        </div>
                        <AppStatusBadge status={a.status} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Semantic matches */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-fuchsia-neural" />
                  <p className="text-sm font-semibold">Matches semánticos · Huella IA</p>
                </div>
                <SemanticOffers userId={userId} appliedIds={appliedIds} onApply={apply} />
              </div>
            )}

            {/* All offers */}
            <div className="rounded-2xl border border-border bg-card/95 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Todas las ofertas activas ({offers.length})</p>
                <Link to="/buscar" search={{ tab: "ofertas" }} className="text-xs text-biosensor hover:underline">
                  Marketplace →
                </Link>
              </div>
              {offers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No hay ofertas activas en este momento.</p>
              ) : (
                <div className="space-y-2">
                  {offers.map((o) => (
                    <OfferCard key={o.id} offer={o} applied={appliedIds.has(o.id)} onApply={apply} />
                  ))}
                </div>
              )}
            </div>

            {/* Proposals + family needs */}
            {userId && (
              <>
                <div className="rounded-2xl border border-border bg-card/95 p-4">
                  <ProposalsInbox userId={userId} role="professional" />
                </div>
                <div className="rounded-2xl border border-border bg-card/95 p-4">
                  <OpenFamilyNeedsList professionalId={userId} />
                </div>
                <div className="rounded-2xl border border-border bg-card/95 p-4">
                  <PendingRatingsCard userId={userId} role="professional" />
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ TAB: AGENDA ══ */}
        {tab === "agenda" && (
          <div className="space-y-4">
            {/* Availability calendar */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold">Tu agenda de disponibilidad</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Marca las horas en que estás disponible. Las familias e instituciones lo verán al buscarte.</p>
                </div>
                <AvailabilityCalendar userId={userId} />
              </div>
            )}

            {/* Location */}
            {userId && (
              <div className="rounded-2xl border border-border bg-card/95 p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold">Tu ubicación principal</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Marca dónde prestas servicio. Aparecerás en el mapa del marketplace.</p>
                </div>
                <LocationPicker
                  lat={profile?.lat ?? null}
                  lng={profile?.lng ?? null}
                  defaultCity={profile?.home_city ?? undefined}
                  onChange={async (lat, lng, address) => {
                    await supabase
                      .from("professional_profiles")
                      .update({ lat, lng, home_city: address ?? profile?.home_city ?? null } as never)
                      .eq("user_id", userId);
                    setProfile((prev) => prev ? { ...prev, lat, lng, home_city: address ?? prev.home_city } : prev);
                    toast.success("Ubicación guardada");
                  }}
                />
              </div>
            )}

            {/* Map */}
            {userId && (
              <LiveMapSection
                role="professional"
                userId={userId}
                height={440}
                pickLocation={{
                  lat: profile?.lat ?? null,
                  lng: profile?.lng ?? null,
                  defaultCity: profile?.home_city ?? undefined,
                  onChange: async (lat, lng, address) => {
                    await supabase
                      .from("professional_profiles")
                      .update({ lat, lng, home_city: address ?? profile?.home_city ?? null } as never)
                      .eq("user_id", userId);
                    setProfile((prev) => prev ? { ...prev, lat, lng, home_city: address ?? prev.home_city } : prev);
                  },
                }}
              />
            )}
          </div>
        )}
      </main>

      {/* ── Bottom nav (mobile only) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-background/95 backdrop-blur-xl border-t border-border safe-area-bottom">
        <div className="grid grid-cols-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                tab === t.id ? "text-biosensor" : "text-muted-foreground",
              )}
            >
              <span className={cn("transition-transform", tab === t.id && "scale-110")}>
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <HumanixAssistant
        persona="professional"
        greeting={`¡Hola ${greetingName}! Soy tu coach IA. Pídeme: preparar entrevista, mejorar mi perfil, resumir un historial clínico, o explicar trámites RETHUS.`}
      />
    </div>
  );
}

// ── Sub-components ──

function OfferCard({ offer: o, applied, onApply }: { offer: Offer; applied: boolean; onApply: (id: string) => void }) {
  return (
    <div className={cn("rounded-xl border bg-background p-4 transition-all", applied ? "border-biosensor/30" : "border-border hover:border-biosensor/20")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm truncate">{o.title}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
              {labelModality(o.modality)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            {o.city}
            {o.specialty_required && <span>· {o.specialty_required}</span>}
          </p>
          {o.description && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{o.description}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm text-biosensor">{COP(o.amount)}</p>
          <Button
            size="sm"
            variant={applied ? "glass" : "hero"}
            disabled={applied}
            onClick={() => onApply(o.id)}
            className="mt-1.5"
          >
            {applied ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aplicada</> : "Aplicar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/60 border border-border/50 px-3 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">{icon}</div>
      <p className="font-bold text-sm">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function QuickAction({ icon, label, sub, onClick, loading, to }: {
  icon: React.ReactNode; label: string; sub: string; onClick?: () => void; loading?: boolean; to?: string;
}) {
  const className = "rounded-2xl border border-border bg-card/95 p-4 text-left hover:border-biosensor/30 transition-colors active:scale-[0.98] block";
  const content = (
    <>
      <div className="flex items-center gap-2 mb-1">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : icon}
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function AppStatusBadge({ status }: { status: AppRow["status"] }) {
  const map = {
    pending: { label: "Pendiente", cls: "bg-amber-500/10 text-amber-600" },
    accepted: { label: "Aceptada", cls: "bg-emerald-500/10 text-emerald-600" },
    rejected: { label: "Rechazada", cls: "bg-rose-500/10 text-rose-600" },
    withdrawn: { label: "Retirada", cls: "bg-muted text-muted-foreground" },
  } as const;
  const s = map[status];
  return <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", s.cls)}>{s.label}</span>;
}

function labelModality(m: Offer["modality"]) {
  return m === "hour" ? "Por hora" : m === "shift" ? "Por turno" : m === "month" ? "Mensual" : "Paquete";
}
