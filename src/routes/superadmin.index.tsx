import { useEffect, useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2, ShieldAlert, Users, Briefcase, FileCheck, Mail, Plus, Copy,
  LayoutDashboard, TrendingUp, Mic, AlertOctagon, Star, ScrollText,
  Megaphone, Sparkles, MessageSquare, MapPin, CheckCircle2, Volume2,
  ExternalLink, Clock, PhoneCall, Activity, ArrowRight, Trash2, Send,
  Bell, UserCircle, Shield, Zap, Globe, BarChart3, DollarSign,
  TrendingDown, Heart, Award, Eye, Lock, Cpu, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { AnimatedCounter } from "@/components/humanix/AnimatedCounter";
import { useSuperadmin } from "@/hooks/use-superadmin";

export const Route = createFileRoute("/superadmin/")({
  head: () => ({ meta: [{ title: "Control Center · Humanix" }] }),
  component: SuperadminPage,
});

type AppRole = "professional" | "family" | "institution" | "superadmin" | "hr_staff" | "evaluator";

const NAV: NavItem[] = [
  { label: "Control Center", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Validación MLP", to: "/superadmin/validacion", icon: TrendingUp },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/buscar", icon: Briefcase },
];

type Invitation = {
  id: string; email: string; role: AppRole; token: string;
  used_at: string | null; created_at: string;
};
type AiRating = {
  id: string; booking_id: string; rated_id: string; stars: number;
  ai_sentiment: string | null; ai_summary: string | null;
  voice_transcript: string | null; voice_url: string | null; created_at: string;
};
type Emergency = {
  id: string; booking_id: string | null; triggered_by: string;
  incident_type: string; lat: number | null; lng: number | null;
  resolved: boolean; created_at: string;
};
type RegisteredUser = {
  user_id: string; full_name: string | null; email: string | null;
  avatar_url: string | null; city: string | null; created_at: string; role: AppRole;
};

function SuperadminPage() {
  const { user, loading, logout } = useSuperadmin();

  const [stats, setStats] = useState({
    users: 0, professionals: 0, offers: 0, docs: 0,
    pending_pros: 0, blocked_pros: 0, families: 0, institutions: 0,
  });
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [aiAlerts, setAiAlerts] = useState<AiRating[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [recentAudit, setRecentAudit] = useState<
    { id: string; action: string; actor_email: string | null; severity: string; created_at: string }[]
  >([]);
  const [fraudCount, setFraudCount] = useState(0);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("hr_staff");
  const [creating, setCreating] = useState(false);
  const [noteTarget, setNoteTarget] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "ops" | "comms">("overview");

  // ── Derived platform health score (0–100) ────────────────────────────────
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      100
        - (emergencies.length * 15)
        - (fraudCount * 5)
        - (stats.blocked_pros * 2)
        - (aiAlerts.length * 3),
    ),
  );

  const loadUsers = useCallback(async () => {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email, avatar_url, city, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, AppRole>(
      (roles ?? []).map((r) => [r.user_id, r.role as AppRole]),
    );
    setRegisteredUsers(
      (profiles ?? []).map((p) => ({ ...p, role: roleMap.get(p.user_id) ?? "family" })),
    );
  }, []);

  const loadData = useCallback(async () => {
    const [
      { count: users }, { count: professionals }, { count: offers }, { count: docs },
      { count: pending_pros }, { count: blocked_pros }, { count: families },
      { count: institutions }, { data: inv }, { data: alerts }, { data: emerg },
      { data: audit }, { count: fraud },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("professional_profiles").select("*", { count: "exact", head: true }),
      supabase.from("job_offers").select("*", { count: "exact", head: true }),
      supabase.from("professional_documents").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("professional_profiles").select("*", { count: "exact", head: true }).eq("published", false).eq("blocked", false),
      supabase.from("professional_profiles").select("*", { count: "exact", head: true }).eq("blocked", true),
      supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "family"),
      supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "institution"),
      supabase.from("staff_invitations").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("service_ratings").select("id, booking_id, rated_id, stars, ai_sentiment, ai_summary, voice_transcript, voice_url, created_at").eq("ai_alert", true).order("created_at", { ascending: false }).limit(15),
      supabase.from("emergency_incidents").select("id, booking_id, triggered_by, incident_type, lat, lng, resolved, created_at").eq("resolved", false).order("created_at", { ascending: false }).limit(10),
      supabase.from("audit_log").select("id, action, actor_email, severity, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("fraud_flags").select("*", { count: "exact", head: true }).eq("resolved", false),
    ]);
    setStats({
      users: users ?? 0, professionals: professionals ?? 0,
      offers: offers ?? 0, docs: docs ?? 0,
      pending_pros: pending_pros ?? 0, blocked_pros: blocked_pros ?? 0,
      families: families ?? 0, institutions: institutions ?? 0,
    });
    setInvitations((inv ?? []) as Invitation[]);
    setAiAlerts((alerts ?? []) as AiRating[]);
    setEmergencies((emerg ?? []) as Emergency[]);
    setRecentAudit((audit ?? []) as typeof recentAudit);
    setFraudCount(fraud ?? 0);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadData(), loadUsers()]);
    setRefreshing(false);
    toast.success("Panel actualizado");
  };

  useEffect(() => {
    if (!user) return;
    void loadData();
    void loadUsers();
    const ch = supabase.channel("superadmin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_incidents" }, () => void loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_ratings" }, () => void loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_flags" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void loadData(); void loadUsers(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void loadUsers())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user, loadData, loadUsers]);

  const resolveEmergency = async (id: string) => {
    await supabase.from("emergency_incidents").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    setEmergencies((prev) => prev.filter((e) => e.id !== id));
    toast.success("Emergencia resuelta");
  };

  const createInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setCreating(true);
    const { error } = await supabase.from("staff_invitations").insert({ email, role, created_by: user?.id });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Invitación creada para ${email}`);
    setEmail("");
    await loadData();
  };

  const deleteUser = async (uid: string, name: string) => {
    if (!window.confirm(`¿Eliminar completamente a "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(uid);
    try {
      const { error } = await supabase.functions.invoke("delete-account", { body: { target_user_id: uid } });
      if (error) throw error;
      toast.success(`Usuario "${name}" eliminado`);
      setRegisteredUsers((prev) => prev.filter((u) => u.user_id !== uid));
      setStats((s) => ({ ...s, users: Math.max(0, s.users - 1) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(null);
    }
  };

  const sendNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!noteTarget || !noteTitle) return;
    setSendingNote(true);
    const { error } = await supabase.from("notifications").insert({
      user_id: noteTarget, title: noteTitle, body: noteBody || null,
      type: "evaluator_note", channel: "app",
    });
    setSendingNote(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Notificación enviada");
    setNoteTitle(""); setNoteBody(""); setNoteTarget("");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030712]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-900/60">
            <Shield className="h-7 w-7 text-white animate-pulse" />
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
          <p className="text-xs text-white/40 tracking-widest uppercase">Cargando panel</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030712] px-4">
        <Card className="max-w-md w-full p-6 text-center space-y-3 bg-white/[0.04] border-white/[0.08]">
          <h1 className="text-lg font-semibold text-white">Acceso restringido</h1>
          <p className="text-sm text-white/50">Este panel es exclusivo para administradores.</p>
          <div className="pt-2">
            <Link to="/admin" className="inline-flex">
              <Button variant="hero">Ir al acceso de administrador</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const healthColor = healthScore >= 80 ? "text-emerald-400" : healthScore >= 60 ? "text-amber-400" : "text-red-400";
  const healthBg = healthScore >= 80 ? "from-emerald-500/20 to-emerald-500/5" : healthScore >= 60 ? "from-amber-500/20 to-amber-500/5" : "from-red-500/20 to-red-500/5";
  const healthBorder = healthScore >= 80 ? "border-emerald-500/30" : healthScore >= 60 ? "border-amber-500/30" : "border-red-500/30";

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Control Center"
      subtitle="Inteligencia operativa de la plataforma en tiempo real."
      crumbs={[{ label: "Inicio", to: "/" }, { label: "Superadmin" }]}
      badge={{ label: "Superadmin", tone: "fuchsia" }}
    >
      <div className="space-y-6">

        {/* ── Header bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/5">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Realtime activo
            </Badge>
            {emergencies.length > 0 && (
              <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] gap-1.5 animate-pulse">
                <AlertOctagon className="h-3 w-3" />
                {emergencies.length} emergencia{emergencies.length !== 1 && "s"}
              </Badge>
            )}
            {fraudCount > 0 && (
              <Link to="/superadmin/fraude">
                <Badge className="bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30 text-[10px] gap-1.5">
                  <ShieldAlert className="h-3 w-3" />
                  {fraudCount} fraude{fraudCount !== 1 && "s"}
                </Badge>
              </Link>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>

        {/* ── Platform Health Score ────────────────────────────────────────── */}
        <div className={`rounded-2xl border bg-gradient-to-r ${healthBg} ${healthBorder} p-5 flex flex-col sm:flex-row sm:items-center gap-4`}>
          <div className="flex items-center gap-4 flex-1">
            <div className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${healthBorder} bg-black/20`}>
              <span className={`text-2xl font-black font-display ${healthColor}`}>{healthScore}</span>
              <span className={`absolute -bottom-0.5 -right-0.5 text-[8px] font-bold ${healthColor}`}>/100</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white/90">Salud de la plataforma</p>
              <p className={`text-xs font-semibold ${healthColor}`}>
                {healthScore >= 80 ? "Operando óptimamente" : healthScore >= 60 ? "Requiere atención" : "Estado crítico — acción inmediata"}
              </p>
              <div className="mt-2 h-1.5 w-48 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${healthScore >= 80 ? "bg-emerald-500" : healthScore >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${healthScore}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]">
            <HealthPill label="Emergencias" value={emergencies.length} bad={emergencies.length > 0} />
            <HealthPill label="Fraudes" value={fraudCount} bad={fraudCount > 0} />
            <HealthPill label="Bloqueados" value={stats.blocked_pros} bad={stats.blocked_pros > 0} />
            <HealthPill label="Alertas IA" value={aiAlerts.length} bad={aiAlerts.length > 0} />
          </div>
        </div>

        {/* ── KPI Grid ─────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard icon={Users} label="Usuarios" value={stats.users} tone="violet" span={1} />
          <KpiCard icon={Briefcase} label="Profesionales" value={stats.professionals} tone="fuchsia" span={1} />
          <KpiCard icon={Heart} label="Familias" value={stats.families} tone="rose" span={1} />
          <KpiCard icon={Globe} label="IPS/EPS" value={stats.institutions} tone="blue" span={1} />
          <KpiCard icon={FileCheck} label="Ofertas activas" value={stats.offers} tone="emerald" span={1} />
          <KpiCard icon={Clock} label="Docs pendientes" value={stats.docs} tone="amber" urgent={stats.docs > 0} span={1} />
          <KpiCard icon={Eye} label="Rev. pendiente" value={stats.pending_pros} tone="cyan" urgent={stats.pending_pros > 0} span={1} />
          <KpiCard icon={Lock} label="Bloqueados" value={stats.blocked_pros} tone="red" urgent={stats.blocked_pros > 0} span={1} />
        </section>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1 w-fit">
          {(["overview", "users", "ops", "comms"] as const).map((tab) => {
            const labels = { overview: "Overview", users: "Usuarios", ops: "Operaciones", comms: "Comunicaciones" };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === tab
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-900/40"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <div className="space-y-6">

            {/* Emergencias + Alertas IA */}
            <div className="grid lg:grid-cols-2 gap-4">
              <PremiumCard
                title="Emergencias activas"
                icon={AlertOctagon}
                count={emergencies.length}
                urgentColor="red"
                liveLabel={emergencies.length > 0}
                subtitle="Botones de pánico activados · Línea 123 notificada"
              >
                {emergencies.length === 0 ? (
                  <EmptyState icon={CheckCircle2} text="Sin emergencias activas" sub="La plataforma opera sin incidentes." color="emerald" />
                ) : emergencies.map((e) => (
                  <div key={e.id} className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <PhoneCall className="h-4 w-4 text-red-400 shrink-0" />
                        <p className="text-sm font-bold text-red-300">{e.incident_type === "panic" ? "Botón de pánico" : e.incident_type}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => resolveEmergency(e.id)}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Resolver
                      </Button>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-white/40 flex-wrap">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(e.created_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {e.lat && e.lng && (
                        <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-400 hover:underline font-medium">
                          <MapPin className="h-3 w-3" /> Ver ubicación <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    {e.booking_id && (
                      <Link to="/servicio/$bookingId" params={{ bookingId: e.booking_id }} className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:underline font-medium">
                        <ArrowRight className="h-3 w-3" /> Ver servicio
                      </Link>
                    )}
                  </div>
                ))}
              </PremiumCard>

              <PremiumCard
                title="Alertas IA · Voz"
                icon={Mic}
                count={aiAlerts.length}
                urgentColor="amber"
                liveLabel={aiAlerts.length > 0}
                subtitle="Valoraciones marcadas por Gemini con sentimiento negativo"
              >
                {aiAlerts.length === 0 ? (
                  <EmptyState icon={CheckCircle2} text="Sin alertas de voz" sub="Valoraciones recientes saludables." color="emerald" />
                ) : aiAlerts.slice(0, 4).map((a) => (
                  <div key={a.id} className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-3.5 w-3.5 ${i < a.stars ? "fill-amber-400 text-amber-400" : "text-white/20"}`} />
                        ))}
                        <span className="text-xs font-semibold text-amber-400 ml-1">{a.stars}/5</span>
                      </div>
                      {a.ai_sentiment && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 capitalize">{a.ai_sentiment}</Badge>}
                    </div>
                    {a.ai_summary && <p className="text-xs text-white/70 border-l-2 border-amber-500/40 pl-2 leading-relaxed">{a.ai_summary}</p>}
                    <div className="flex items-center gap-3 flex-wrap">
                      {a.voice_url && <a href={a.voice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:underline font-medium"><Volume2 className="h-3 w-3" /> Audio</a>}
                      <Link to="/servicio/$bookingId" params={{ bookingId: a.booking_id }} className="inline-flex items-center gap-1 text-[11px] text-fuchsia-400 hover:underline font-medium"><ArrowRight className="h-3 w-3" /> Servicio</Link>
                    </div>
                  </div>
                ))}
              </PremiumCard>
            </div>

            {/* Auditoría + Shortcuts */}
            <div className="grid lg:grid-cols-2 gap-4">
              <PremiumCard title="Auditoría reciente" icon={ScrollText} subtitle="Registro inmutable en tiempo real" action={{ label: "Ver todo", to: "/superadmin/auditoria" }}>
                {recentAudit.length === 0 ? (
                  <EmptyState icon={ScrollText} text="Sin eventos aún" sub="Aparecerán en tiempo real." color="violet" />
                ) : (
                  <div className="divide-y divide-white/[0.05]">
                    {recentAudit.map((e) => {
                      const sevColors: Record<string, { dot: string; text: string }> = {
                        critical: { dot: "bg-red-500", text: "text-red-400" },
                        error: { dot: "bg-fuchsia-500", text: "text-fuchsia-400" },
                        warn: { dot: "bg-amber-500", text: "text-amber-400" },
                        info: { dot: "bg-violet-500", text: "text-violet-400" },
                      };
                      const c = sevColors[e.severity] ?? { dot: "bg-white/30", text: "text-white/40" };
                      return (
                        <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${c.dot}`} />
                            <span className="font-mono text-xs truncate text-white/70">{e.action}</span>
                            {e.actor_email && <span className="text-[11px] text-white/30 truncate hidden sm:inline">· {e.actor_email}</span>}
                          </div>
                          <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${c.text}`}>{e.severity}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </PremiumCard>

              {/* Quick access grid */}
              <div>
                <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Acceso rápido</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { icon: ShieldAlert, title: "Anti-fraude", to: "/superadmin/fraude", tone: "fuchsia", count: fraudCount > 0 ? fraudCount : undefined },
                    { icon: ScrollText, title: "Auditoría", to: "/superadmin/auditoria", tone: "violet" },
                    { icon: Megaphone, title: "Publicidad", to: "/superadmin/publicidad", tone: "amber" },
                    { icon: Sparkles, title: "Marketing", to: "/superadmin/marketing", tone: "fuchsia" },
                    { icon: MessageSquare, title: "CRM", to: "/superadmin/crm", tone: "blue" },
                    { icon: TrendingUp, title: "Validación MLP", to: "/superadmin/validacion", tone: "emerald" },
                    { icon: Star, title: "Reseñas", to: "/superadmin/resenas", tone: "amber" },
                    { icon: Mic, title: "Testimonios", to: "/superadmin/testimonios", tone: "violet" },
                    { icon: BarChart3, title: "Marketplace", to: "/superadmin/marketplace", tone: "blue" },
                    { icon: Users, title: "Talento Humano", to: "/talento-humano", tone: "fuchsia" },
                  ].map(({ icon: Icon, title, to, tone, count }) => (
                    <Link
                      key={to}
                      to={to}
                      className="group flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/[0.12] transition"
                    >
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                        { fuchsia: "bg-fuchsia-500/15 text-fuchsia-400", violet: "bg-violet-500/15 text-violet-400", amber: "bg-amber-500/15 text-amber-400", blue: "bg-blue-500/15 text-blue-400", emerald: "bg-emerald-500/15 text-emerald-400" }[tone]
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-medium text-white/70 group-hover:text-white/90 transition flex-1 min-w-0 truncate">{title}</span>
                      {count != null && count > 0 && (
                        <span className="text-[9px] font-bold bg-fuchsia-500/20 text-fuchsia-400 rounded-full px-1.5 py-0.5">{count}</span>
                      )}
                      <ChevronRight className="h-3 w-3 text-white/20 group-hover:text-white/50 transition" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "users" && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-3 gap-3">
              <RoleDistCard label="Familias" count={stats.families} total={stats.users} color="rose" icon={Heart} />
              <RoleDistCard label="Profesionales" count={stats.professionals} total={stats.users} color="violet" icon={Briefcase} />
              <RoleDistCard label="IPS / EPS" count={stats.institutions} total={stats.users} color="blue" icon={Globe} />
            </div>

            <PremiumCard
              title="Usuarios registrados"
              icon={UserCircle}
              subtitle={`${registeredUsers.length} cuentas en la plataforma`}
            >
              {registeredUsers.length === 0 ? (
                <div className="flex items-center gap-2 text-white/30 text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                </div>
              ) : (
                <div className="divide-y divide-white/[0.05] max-h-[520px] overflow-y-auto">
                  {registeredUsers.map((u) => {
                    const roleStyle: Record<string, string> = {
                      superadmin: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
                      evaluator: "bg-amber-500/20 text-amber-300 border-amber-500/30",
                      hr_staff: "bg-blue-500/20 text-blue-300 border-blue-500/30",
                      institution: "bg-violet-500/20 text-violet-300 border-violet-500/30",
                      family: "bg-rose-500/20 text-rose-300 border-rose-500/30",
                      professional: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                    };
                    return (
                      <div key={u.user_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt={u.full_name ?? ""} className="h-9 w-9 rounded-full object-cover border border-white/10 shrink-0" />
                          : <div className="h-9 w-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-xs font-semibold text-white/50 shrink-0">{(u.full_name ?? u.email ?? "?").slice(0, 1).toUpperCase()}</div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white/90 truncate">{u.full_name ?? "Sin nombre"}</p>
                          <p className="text-[11px] text-white/40 truncate">{u.email ?? "—"}{u.city ? ` · ${u.city}` : ""}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${roleStyle[u.role] ?? "bg-white/10 text-white/40 border-white/20"}`}>{u.role}</Badge>
                        <span className="text-[10px] text-white/30 whitespace-nowrap hidden sm:inline">
                          {new Date(u.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "2-digit" })}
                        </span>
                        <Button size="sm" variant="outline" className="h-7 px-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 shrink-0" disabled={deleting === u.user_id} onClick={() => deleteUser(u.user_id, u.full_name ?? u.email ?? u.user_id)}>
                          {deleting === u.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </PremiumCard>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "ops" && (
          <div className="space-y-5">
            <div className="grid lg:grid-cols-2 gap-4">
              {/* Invitar staff */}
              <PremiumCard title="Invitar staff" icon={Plus} subtitle="Genera tokens de acceso para el equipo interno">
                <form onSubmit={createInvitation} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/50 uppercase tracking-wider">Correo</Label>
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@humanix.lat" className="bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 focus:border-violet-500/60" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/50 uppercase tracking-wider">Rol</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                      <SelectTrigger className="bg-white/[0.04] border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hr_staff">RRHH · Talento humano</SelectItem>
                        <SelectItem value="evaluator">Evaluador</SelectItem>
                        <SelectItem value="superadmin">Superadmin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={creating} variant="hero" className="w-full">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1.5" /> Crear invitación</>}
                  </Button>
                </form>
              </PremiumCard>

              {/* Invitaciones recientes */}
              <PremiumCard title="Invitaciones recientes" icon={Mail} subtitle="Tokens activos y usados">
                {invitations.length === 0
                  ? <EmptyState icon={Mail} text="Sin invitaciones aún" sub="Genera la primera arriba." color="violet" />
                  : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {invitations.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white/80 truncate">{inv.email}</p>
                            <p className="text-[11px] text-white/40">{inv.role}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {inv.used_at
                              ? <Badge variant="outline" className="text-[10px] border-white/20 text-white/40">Usada</Badge>
                              : <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Activa</Badge>
                            }
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-white/70" onClick={() => { navigator.clipboard.writeText(inv.token); toast.success("Token copiado"); }}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }
              </PremiumCard>
            </div>

            {/* Docs y revisión de profesionales */}
            <div className="grid sm:grid-cols-2 gap-3">
              <ActionCard
                icon={FileCheck}
                title="Documentos pendientes"
                desc={`${stats.docs} doc${stats.docs !== 1 ? "s" : ""} esperando revisión`}
                to="/evaluador"
                urgent={stats.docs > 0}
                cta="Revisar ahora"
              />
              <ActionCard
                icon={Eye}
                title="Profesionales en revisión"
                desc={`${stats.pending_pros} perfil${stats.pending_pros !== 1 ? "es" : ""} esperando publicación`}
                to="/talento-humano"
                urgent={stats.pending_pros > 0}
                cta="Revisar perfiles"
              />
              <ActionCard
                icon={ShieldAlert}
                title="Casos de fraude"
                desc={`${fraudCount} flag${fraudCount !== 1 ? "s" : ""} sin resolver`}
                to="/superadmin/fraude"
                urgent={fraudCount > 0}
                cta="Investigar"
              />
              <ActionCard
                icon={Lock}
                title="Profesionales bloqueados"
                desc={`${stats.blocked_pros} cuenta${stats.blocked_pros !== 1 ? "s" : ""} bloqueada${stats.blocked_pros !== 1 ? "s" : ""}`}
                to="/talento-humano"
                urgent={stats.blocked_pros > 0}
                cta="Revisar bloqueos"
              />
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "comms" && (
          <div className="space-y-5">
            <div className="grid lg:grid-cols-2 gap-4">
              <PremiumCard title="Enviar nota / petición" icon={Bell} subtitle="Notificación interna en tiempo real a cualquier usuario">
                <form onSubmit={sendNote} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/50 uppercase tracking-wider">Destinatario</Label>
                    <Select value={noteTarget} onValueChange={setNoteTarget}>
                      <SelectTrigger className="bg-white/[0.04] border-white/10 text-white">
                        <SelectValue placeholder="Selecciona un usuario…" />
                      </SelectTrigger>
                      <SelectContent>
                        {registeredUsers
                          .filter((u) => ["professional", "family", "institution"].includes(u.role))
                          .map((u) => (
                            <SelectItem key={u.user_id} value={u.user_id}>
                              {u.full_name ?? u.email ?? u.user_id} · {u.role}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/50 uppercase tracking-wider">Asunto</Label>
                    <Input required value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Documentación pendiente, revisión de perfil…" className="bg-white/[0.04] border-white/10 text-white placeholder:text-white/20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/50 uppercase tracking-wider">Mensaje (opcional)</Label>
                    <Textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Detalle de la nota…" className="bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 resize-none" />
                  </div>
                  <Button type="submit" disabled={sendingNote || !noteTarget || !noteTitle} variant="hero" className="w-full gap-2">
                    {sendingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> Enviar notificación</>}
                  </Button>
                </form>
              </PremiumCard>

              <PremiumCard title="Canales de comunicación" icon={Zap} subtitle="Herramientas de marketing y CRM">
                <div className="space-y-2.5">
                  {[
                    { icon: Megaphone, title: "Publicidad", desc: "CRUD de banners con recomendación IA", to: "/superadmin/publicidad", color: "amber" },
                    { icon: Sparkles, title: "Marketing", desc: "8 plantillas + tarjetas dinámicas para redes", to: "/superadmin/marketing", color: "fuchsia" },
                    { icon: MessageSquare, title: "CRM", desc: "Contactos, segmentación IA y campañas masivas", to: "/superadmin/crm", color: "blue" },
                    { icon: Star, title: "Reseñas", desc: "Gestión de valoraciones y testimonios", to: "/superadmin/resenas", color: "amber" },
                    { icon: Mic, title: "Testimonios en voz", desc: "Audio-testimonios con transcripción IA", to: "/superadmin/testimonios", color: "violet" },
                  ].map(({ icon: Icon, title, desc, to, color }) => (
                    <Link key={to} to={to} className="group flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.12] transition">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                        { amber: "bg-amber-500/15 text-amber-400", fuchsia: "bg-fuchsia-500/15 text-fuchsia-400", blue: "bg-blue-500/15 text-blue-400", violet: "bg-violet-500/15 text-violet-400" }[color]
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/80 group-hover:text-white transition">{title}</p>
                        <p className="text-[11px] text-white/40">{desc}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  ))}
                </div>
              </PremiumCard>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, tone, urgent, span: _span }: {
  icon: typeof Users; label: string; value: number; tone: string; urgent?: boolean; span?: number;
}) {
  const colors: Record<string, { icon: string; text: string; bg: string; border: string }> = {
    violet: { icon: "text-violet-400 bg-violet-500/15", text: "text-violet-300", bg: "bg-violet-500/[0.04]", border: "border-violet-500/20" },
    fuchsia: { icon: "text-fuchsia-400 bg-fuchsia-500/15", text: "text-fuchsia-300", bg: "bg-fuchsia-500/[0.04]", border: "border-fuchsia-500/20" },
    rose: { icon: "text-rose-400 bg-rose-500/15", text: "text-rose-300", bg: "bg-rose-500/[0.04]", border: "border-rose-500/20" },
    blue: { icon: "text-blue-400 bg-blue-500/15", text: "text-blue-300", bg: "bg-blue-500/[0.04]", border: "border-blue-500/20" },
    emerald: { icon: "text-emerald-400 bg-emerald-500/15", text: "text-emerald-300", bg: "bg-emerald-500/[0.04]", border: "border-emerald-500/20" },
    amber: { icon: "text-amber-400 bg-amber-500/15", text: "text-amber-300", bg: "bg-amber-500/[0.04]", border: "border-amber-500/20" },
    cyan: { icon: "text-cyan-400 bg-cyan-500/15", text: "text-cyan-300", bg: "bg-cyan-500/[0.04]", border: "border-cyan-500/20" },
    red: { icon: "text-red-400 bg-red-500/15", text: "text-red-300", bg: "bg-red-500/[0.04]", border: "border-red-500/20" },
  };
  const c = colors[tone] ?? colors.violet;
  return (
    <Card className={`p-4 border ${urgent && value > 0 ? "border-fuchsia-500/40 bg-fuchsia-500/[0.04]" : `${c.border} ${c.bg}`} relative overflow-hidden`}>
      {urgent && value > 0 && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-fuchsia-500 animate-ping" />}
      <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${c.icon}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className={`mt-3 text-2xl font-black font-display ${urgent && value > 0 ? "text-fuchsia-300" : c.text}`}>
        <AnimatedCounter value={value} />
      </p>
      <p className="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">{label}</p>
    </Card>
  );
}

function HealthPill({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 border ${bad && value > 0 ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
      {bad && value > 0 ? <ArrowUpRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      <span className="font-semibold">{value}</span>
      <span className="text-white/50">{label}</span>
    </div>
  );
}

function PremiumCard({ title, icon: Icon, subtitle, count, urgentColor, liveLabel, action, children }: {
  title: string; icon: typeof Users; subtitle?: string; count?: number;
  urgentColor?: "red" | "amber" | "fuchsia"; liveLabel?: boolean;
  action?: { label: string; to: string }; children: React.ReactNode;
}) {
  const urgentStyles = {
    red: "border-red-500/30 bg-red-500/[0.04]",
    amber: "border-amber-500/30 bg-amber-500/[0.04]",
    fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/[0.04]",
  };
  const borderClass = urgentColor && (count ?? 0) > 0 ? urgentStyles[urgentColor] : "border-white/[0.08] bg-white/[0.02]";
  return (
    <div className={`rounded-2xl border ${borderClass} p-5`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-white/50" />
            <h2 className="text-sm font-bold text-white/90">{title}</h2>
            {count != null && count > 0 && (
              <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                urgentColor === "red" ? "bg-red-500/20 text-red-400" :
                urgentColor === "amber" ? "bg-amber-500/20 text-amber-400" :
                "bg-fuchsia-500/20 text-fuchsia-400"
              }`}>{count}</span>
            )}
          </div>
          {subtitle && <p className="text-[11px] text-white/30 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {liveLabel && (count ?? 0) > 0 && (
            <span className="text-[9px] uppercase tracking-widest font-bold text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
            </span>
          )}
          {action && (
            <Link to={action.to} className="text-[11px] text-violet-400 hover:underline font-medium flex items-center gap-1">
              {action.label} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub, color }: { icon: typeof CheckCircle2; text: string; sub: string; color: "emerald" | "violet" | "amber" }) {
  const colors = { emerald: "bg-emerald-500/10 text-emerald-400", violet: "bg-violet-500/10 text-violet-400", amber: "bg-amber-500/10 text-amber-400" };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-5">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium text-white/70">{text}</p>
        <p className="text-xs text-white/30">{sub}</p>
      </div>
    </div>
  );
}

function RoleDistCard({ label, count, total, color, icon: Icon }: {
  label: string; count: number; total: number; color: "rose" | "violet" | "blue"; icon: typeof Heart;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const colors = {
    rose: { text: "text-rose-400", bg: "bg-rose-500", border: "border-rose-500/30", iconBg: "bg-rose-500/15 text-rose-400" },
    violet: { text: "text-violet-400", bg: "bg-violet-500", border: "border-violet-500/30", iconBg: "bg-violet-500/15 text-violet-400" },
    blue: { text: "text-blue-400", bg: "bg-blue-500", border: "border-blue-500/30", iconBg: "bg-blue-500/15 text-blue-400" },
  }[color];
  return (
    <div className={`rounded-2xl border ${colors.border} bg-white/[0.02] p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${colors.iconBg}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold text-white/80">{label}</span>
        </div>
        <span className={`text-lg font-black font-display ${colors.text}`}>
          <AnimatedCounter value={count} />
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <div className={`h-full rounded-full ${colors.bg} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-white/30 mt-1.5">{pct}% del total de usuarios</p>
    </div>
  );
}

function ActionCard({ icon: Icon, title, desc, to, urgent, cta }: {
  icon: typeof FileCheck; title: string; desc: string; to: string; urgent: boolean; cta: string;
}) {
  return (
    <Link to={to} className={`group flex items-center gap-3 p-4 rounded-xl border transition ${urgent ? "border-fuchsia-500/30 bg-fuchsia-500/[0.04] hover:bg-fuchsia-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"}`}>
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${urgent ? "bg-fuchsia-500/20 text-fuchsia-400" : "bg-white/[0.06] text-white/40"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/80 group-hover:text-white transition">{title}</p>
        <p className="text-[11px] text-white/40">{desc}</p>
      </div>
      <span className={`text-[11px] font-semibold ${urgent ? "text-fuchsia-400" : "text-white/30"} group-hover:text-white/70 transition whitespace-nowrap`}>{cta} →</span>
    </Link>
  );
}
