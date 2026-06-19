import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  ShieldAlert,
  Users,
  Briefcase,
  FileCheck,
  Mail,
  Plus,
  Copy,
  LayoutDashboard,
  TrendingUp,
  Mic,
  AlertOctagon,
  Star,
  ScrollText,
  Megaphone,
  Sparkles,
  MessageSquare,
  MapPin,
  CheckCircle2,
  Volume2,
  ExternalLink,
  Clock,
  PhoneCall,
  Activity,
  ArrowRight,
  Trash2,
  Send,
  Bell,
  UserCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/superadmin/")({
  head: () => ({ meta: [{ title: "Superadmin · Humanix" }] }),
  component: SuperadminPage,
});

type AppRole = "professional" | "family" | "institution" | "superadmin" | "hr_staff" | "evaluator";

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/buscar", icon: Briefcase },
];

type Invitation = {
  id: string;
  email: string;
  role: AppRole;
  token: string;
  used_at: string | null;
  created_at: string;
};

type AiRating = {
  id: string;
  booking_id: string;
  rated_id: string;
  stars: number;
  ai_sentiment: string | null;
  ai_summary: string | null;
  voice_transcript: string | null;
  voice_url: string | null;
  created_at: string;
};

type Emergency = {
  id: string;
  booking_id: string | null;
  triggered_by: string;
  incident_type: string;
  lat: number | null;
  lng: number | null;
  resolved: boolean;
  created_at: string;
};

type RegisteredUser = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  city: string | null;
  created_at: string;
  role: AppRole;
};

function SuperadminPage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin"] });
  const [stats, setStats] = useState({ users: 0, professionals: 0, offers: 0, docs: 0, pending_pros: 0, blocked_pros: 0 });
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [aiAlerts, setAiAlerts] = useState<AiRating[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("hr_staff");
  const [creating, setCreating] = useState(false);
  const [recentAudit, setRecentAudit] = useState<
    { id: string; action: string; actor_email: string | null; severity: string; created_at: string }[]
  >([]);
  const [fraudCount, setFraudCount] = useState(0);

  // Users management
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Evaluator notes
  const [noteTarget, setNoteTarget] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [sendingNote, setSendingNote] = useState(false);

  const loadUsers = async () => {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, city, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, AppRole>(
      (roles ?? []).map((r) => [r.user_id, r.role as AppRole]),
    );
    setRegisteredUsers(
      (profiles ?? []).map((p) => ({
        ...p,
        role: roleMap.get(p.user_id) ?? "family",
      })),
    );
  };

  const deleteUser = async (uid: string, name: string) => {
    if (!window.confirm(`¿Eliminar completamente a "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(uid);
    try {
      await Promise.all([
        supabase.from("professional_profiles").delete().eq("user_id", uid),
        supabase.from("family_profiles").delete().eq("user_id", uid),
        supabase.from("institution_profiles").delete().eq("user_id", uid),
        supabase.from("user_roles").delete().eq("user_id", uid),
      ]);
      await supabase.from("profiles").delete().eq("user_id", uid);
      toast.success(`Usuario "${name}" eliminado de la plataforma`);
      setRegisteredUsers((prev) => prev.filter((u) => u.user_id !== uid));
      setStats((s) => ({ ...s, users: Math.max(0, s.users - 1) }));
    } catch (err) {
      toast.error("Error al eliminar usuario");
      console.error(err);
    } finally {
      setDeleting(null);
    }
  };

  const sendNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!noteTarget || !noteTitle) return;
    setSendingNote(true);
    const { error } = await supabase.from("notifications").insert({
      user_id: noteTarget,
      title: noteTitle,
      body: noteBody || null,
      type: "evaluator_note",
      channel: "app",
    });
    setSendingNote(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Nota/petición enviada al usuario");
    setNoteTitle("");
    setNoteBody("");
    setNoteTarget("");
  };

  useEffect(() => {
    if (!user) return;
    void loadData();
    void loadUsers();

    const ch = supabase
      .channel("superadmin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_incidents" }, () => void loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_ratings" }, () => void loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_flags" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void loadData(); void loadUsers(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void loadUsers())
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadData = async () => {
    const [
      { count: users },
      { count: professionals },
      { count: offers },
      { count: docs },
      { count: pending_pros },
      { count: blocked_pros },
      { data: inv },
      { data: alerts },
      { data: emerg },
      { data: audit },
      { count: fraud },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("professional_profiles").select("*", { count: "exact", head: true }),
      supabase.from("job_offers").select("*", { count: "exact", head: true }),
      supabase
        .from("professional_documents")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("professional_profiles")
        .select("*", { count: "exact", head: true })
        .eq("published", false)
        .eq("blocked", false),
      supabase
        .from("professional_profiles")
        .select("*", { count: "exact", head: true })
        .eq("blocked", true),
      supabase
        .from("staff_invitations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("service_ratings")
        .select(
          "id, booking_id, rated_id, stars, ai_sentiment, ai_summary, voice_transcript, voice_url, created_at",
        )
        .eq("ai_alert", true)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("emergency_incidents")
        .select("id, booking_id, triggered_by, incident_type, lat, lng, resolved, created_at")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("audit_log")
        .select("id, action, actor_email, severity, created_at")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("fraud_flags")
        .select("*", { count: "exact", head: true })
        .eq("resolved", false),
    ]);
    setStats({
      users: users ?? 0,
      professionals: professionals ?? 0,
      offers: offers ?? 0,
      docs: docs ?? 0,
      pending_pros: pending_pros ?? 0,
      blocked_pros: blocked_pros ?? 0,
    });
    setInvitations((inv ?? []) as Invitation[]);
    setAiAlerts((alerts ?? []) as AiRating[]);
    setEmergencies((emerg ?? []) as Emergency[]);
    setRecentAudit((audit ?? []) as typeof recentAudit);
    setFraudCount(fraud ?? 0);
  };

  const resolveEmergency = async (id: string) => {
    await supabase
      .from("emergency_incidents")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", id);
    setEmergencies((prev) => prev.filter((e) => e.id !== id));
    toast.success("Emergencia marcada como resuelta");
  };

  const createInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setCreating(true);
    const { error } = await supabase.from("staff_invitations").insert({
      email,
      role,
      created_by: user?.id,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Invitación creada para ${email}`);
    setEmail("");
    await loadData();
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    toast.success("Token copiado");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold">Necesitas iniciar sesión</h1>
          <p className="text-sm text-muted-foreground">
            Este módulo requiere permisos de superadmin.
          </p>
          <div className="pt-2">
            <Link to="/auth" className="inline-flex">
              <Button variant="hero">Ir a iniciar sesión</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Centro de control"
      subtitle="Métricas globales, gobernanza de roles y salud operativa de la plataforma."
      crumbs={[{ label: "Inicio", to: "/" }, { label: "Superadmin" }]}
      badge={{ label: "Superadmin", tone: "fuchsia" }}
    >
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[10px]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Realtime activo
          </Badge>
          {fraudCount > 0 && (
            <Link to="/superadmin/fraude">
              <Badge className="bg-fuchsia-neural text-fuchsia-neural-foreground gap-1.5">
                <ShieldAlert className="h-3 w-3" />
                {fraudCount} fraude{fraudCount === 1 ? "" : "s"} sin resolver
              </Badge>
            </Link>
          )}
        </div>
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat icon={Users} label="Usuarios" value={stats.users} tone="bio" />
          <Stat icon={Briefcase} label="Profesionales" value={stats.professionals} tone="copper" />
          <Stat icon={CheckCircle2} label="Pendientes rev." value={stats.pending_pros} tone="copper" urgent={stats.pending_pros > 0} />
          <Stat icon={ShieldAlert} label="Bloqueados" value={stats.blocked_pros} tone="fuchsia" urgent={stats.blocked_pros > 0} />
          <Stat icon={FileCheck} label="Ofertas" value={stats.offers} tone="bio" />
          <Stat icon={Mail} label="Docs pendientes" value={stats.docs} tone="fuchsia" urgent={stats.docs > 0} />
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-biosensor" /> Invitar staff
            </h2>
            <form onSubmit={createInvitation} className="space-y-3">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@humanix.lat"
                />
              </div>
              <div>
                <Label>Rol</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hr_staff">RRHH (Talento humano)</SelectItem>
                    <SelectItem value="evaluator">Evaluador</SelectItem>
                    <SelectItem value="superadmin">Superadmin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={creating} variant="hero" className="w-full">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear invitación"}
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Invitaciones recientes</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {invitations.length === 0 && (
                <p className="text-sm text-muted-foreground">Aún no hay invitaciones.</p>
              )}
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">{inv.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {inv.used_at ? <Badge variant="secondary">Usada</Badge> : <Badge>Activa</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => copyToken(inv.token)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <Card
            className={`p-6 transition-colors ${emergencies.length > 0 ? "border-fuchsia-neural/50 bg-fuchsia-neural/[0.03]" : "border-border"}`}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <span className="relative flex h-5 w-5 items-center justify-center">
                  {emergencies.length > 0 ? (
                    <>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-fuchsia-neural opacity-40 animate-ping" />
                      <AlertOctagon className="h-4 w-4 text-fuchsia-neural relative" />
                    </>
                  ) : (
                    <AlertOctagon className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                Emergencias activas
                {emergencies.length > 0 && (
                  <Badge className="bg-fuchsia-neural text-white text-[10px] px-1.5 h-5">
                    {emergencies.length}
                  </Badge>
                )}
              </h2>
              {emergencies.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-fuchsia-neural font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-neural animate-pulse" /> En
                  vivo
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Botones de pánico activados. Línea 123 contactada por el usuario.
            </p>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {emergencies.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5">
                  <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      Sin emergencias activas
                    </p>
                    <p className="text-xs text-muted-foreground">
                      La plataforma opera sin incidentes en este momento.
                    </p>
                  </div>
                </div>
              ) : (
                emergencies.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-xl border border-fuchsia-neural/40 bg-fuchsia-neural/[0.06] p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <PhoneCall className="h-4 w-4 text-fuchsia-neural shrink-0" />
                        <p className="text-sm font-bold text-fuchsia-neural">
                          {e.incident_type === "panic" ? "Botón de pánico" : e.incident_type}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] border-fuchsia-neural/40 text-fuchsia-neural hover:bg-fuchsia-neural/10"
                        onClick={() => resolveEmergency(e.id)}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Resolver
                      </Button>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(e.created_at).toLocaleString("es-CO", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {e.lat && e.lng && (
                        <a
                          href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-biosensor hover:underline font-medium"
                        >
                          <MapPin className="h-3 w-3" /> Ver ubicación{" "}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    {e.booking_id && (
                      <Link
                        to="/servicio/$bookingId"
                        params={{ bookingId: e.booking_id }}
                        className="inline-flex items-center gap-1 text-[11px] text-fuchsia-neural hover:underline font-medium"
                      >
                        <ArrowRight className="h-3 w-3" /> Ver servicio relacionado
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card
            className={`p-6 transition-colors ${aiAlerts.length > 0 ? "border-copper/50 bg-copper/[0.03]" : "border-border"}`}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <span className="relative flex h-5 w-5 items-center justify-center">
                  {aiAlerts.length > 0 ? (
                    <>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-copper opacity-40 animate-ping" />
                      <Mic className="h-4 w-4 text-copper relative" />
                    </>
                  ) : (
                    <Mic className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                Alertas IA · Voz
                {aiAlerts.length > 0 && (
                  <Badge className="bg-copper text-white text-[10px] px-1.5 h-5">
                    {aiAlerts.length}
                  </Badge>
                )}
              </h2>
              {aiAlerts.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-copper font-semibold">
                  <Activity className="h-3 w-3" /> Gemini
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Valoraciones por voz marcadas por Gemini con sentimiento negativo o riesgo.
            </p>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {aiAlerts.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5">
                  <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      Sin alertas de voz
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Las valoraciones recientes están saludables.
                    </p>
                  </div>
                </div>
              ) : (
                aiAlerts.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-copper/30 bg-copper/[0.06] p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${i < a.stars ? "fill-copper text-copper" : "text-muted-foreground/30"}`}
                          />
                        ))}
                        <span className="text-xs font-semibold text-copper ml-1">{a.stars}/5</span>
                      </div>
                      {a.ai_sentiment && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-copper/40 text-copper capitalize"
                        >
                          {a.ai_sentiment}
                        </Badge>
                      )}
                    </div>
                    {a.ai_summary && (
                      <p className="text-xs text-foreground/90 leading-relaxed border-l-2 border-copper/40 pl-2">
                        {a.ai_summary}
                      </p>
                    )}
                    {a.voice_transcript && (
                      <p className="text-[11px] italic text-muted-foreground leading-relaxed">
                        "{a.voice_transcript.slice(0, 180)}
                        {a.voice_transcript.length > 180 ? "…" : ""}"
                      </p>
                    )}
                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                      {a.voice_url && (
                        <a
                          href={a.voice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-biosensor hover:underline font-medium"
                        >
                          <Volume2 className="h-3 w-3" /> Escuchar audio
                        </a>
                      )}
                      <Link
                        to="/servicio/$bookingId"
                        params={{ bookingId: a.booking_id }}
                        className="inline-flex items-center gap-1 text-[11px] text-fuchsia-neural hover:underline font-medium"
                      >
                        <ArrowRight className="h-3 w-3" /> Ver servicio
                      </Link>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(a.created_at).toLocaleDateString("es-CO", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>

        <section>
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-biosensor" />
                Auditoría reciente
              </h2>
              <Link
                to="/superadmin/auditoria"
                className="inline-flex items-center gap-1 text-xs text-biosensor hover:underline font-medium"
              >
                Ver todo <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recentAudit.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5">
                <div className="h-9 w-9 rounded-xl bg-biosensor/10 text-biosensor flex items-center justify-center shrink-0">
                  <ScrollText className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Sin eventos registrados aún</p>
                  <p className="text-xs text-muted-foreground">
                    Los eventos aparecerán aquí en tiempo real.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentAudit.map((e) => {
                  const sev = e.severity;
                  const sevConfig = {
                    critical: {
                      dot: "bg-red-500",
                      badge: "bg-red-500/15 text-red-600 border-red-500/30",
                    },
                    error: {
                      dot: "bg-fuchsia-neural",
                      badge: "bg-fuchsia-neural/15 text-fuchsia-neural border-fuchsia-neural/30",
                    },
                    warn: { dot: "bg-copper", badge: "bg-copper/15 text-copper border-copper/30" },
                    info: {
                      dot: "bg-biosensor",
                      badge: "bg-biosensor/15 text-biosensor border-biosensor/30",
                    },
                  }[sev as string] ?? {
                    dot: "bg-muted-foreground",
                    badge: "bg-muted/40 text-muted-foreground border-border",
                  };
                  return (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${sevConfig.dot}`} />
                        <span className="font-mono text-xs truncate text-foreground/80">
                          {e.action}
                        </span>
                        {e.actor_email && (
                          <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                            · {e.actor_email}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-[9px] uppercase tracking-wide h-4 px-1.5 border ${sevConfig.badge}`}
                        >
                          {sev}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {new Date(e.created_at).toLocaleTimeString("es-CO", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ShortcutCard
            icon={ShieldAlert}
            title="Anti-fraude"
            desc="Revisa y resuelve flags de fraude detectadas por IA."
            to="/superadmin/fraude"
            tone="fuchsia"
            badge={
              fraudCount > 0
                ? { label: `${fraudCount} pendiente${fraudCount === 1 ? "" : "s"}`, urgent: true }
                : undefined
            }
          />
          <ShortcutCard
            icon={ScrollText}
            title="Auditoría"
            desc="Registro inmutable de acciones sensibles con realtime."
            to="/superadmin/auditoria"
            tone="bio"
            badge={recentAudit.length > 0 ? { label: `${recentAudit.length} eventos` } : undefined}
          />
          <ShortcutCard
            icon={Megaphone}
            title="Publicidad"
            desc="CRUD de banners con recomendación IA y publicación."
            to="/superadmin/publicidad"
            tone="copper"
          />
          <ShortcutCard
            icon={Sparkles}
            title="Marketing"
            desc="8 plantillas + tarjetas dinámicas de profesionales y ofertas para redes."
            to="/superadmin/marketing"
            tone="fuchsia"
          />
          <ShortcutCard
            icon={MessageSquare}
            title="CRM"
            desc="Contactos, segmentación IA y campañas masivas."
            to="/superadmin/crm"
            tone="bio"
          />
          <ShortcutCard
            icon={Users}
            title="Talento Humano"
            desc="Verifica profesionales y gestiona el roster activo."
            to="/talento-humano"
            tone="copper"
          />
          <ShortcutCard
            icon={FileCheck}
            title="Evaluador"
            desc="Revisa documentos pendientes y aprueba RETHUS."
            to="/evaluador"
            tone="fuchsia"
            badge={
              stats.docs > 0
                ? {
                    label: `${stats.docs} doc${stats.docs === 1 ? "" : "s"} pendiente${stats.docs === 1 ? "" : "s"}`,
                    urgent: true,
                  }
                : undefined
            }
          />
          <ShortcutCard
            icon={TrendingUp}
            title="Marketplace"
            desc="Inspecciona ofertas en vivo y métricas de match."
            to="/superadmin/marketplace"
            tone="bio"
            badge={stats.offers > 0 ? { label: `${stats.offers} ofertas` } : undefined}
          />
        </section>

        {/* ── Gestión de usuarios ── */}
        <section>
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <UserCircle className="h-4 w-4 text-biosensor" />
                Usuarios registrados
                <Badge variant="secondary" className="ml-1 text-xs">{registeredUsers.length}</Badge>
              </h2>
              <span className="text-[11px] text-muted-foreground">Eliminar borra perfil y roles de la plataforma</span>
            </div>

            {registeredUsers.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Cargando usuarios…</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50 max-h-[480px] overflow-y-auto">
                {registeredUsers.map((u) => {
                  const roleColors: Record<string, string> = {
                    superadmin: "bg-fuchsia-neural/15 text-fuchsia-neural border-fuchsia-neural/30",
                    evaluator:  "bg-amber-500/15 text-amber-600 border-amber-500/30",
                    hr_staff:   "bg-blue-500/15 text-blue-600 border-blue-500/30",
                    institution:"bg-violet-500/15 text-violet-600 border-violet-500/30",
                    family:     "bg-copper/15 text-copper border-copper/30",
                    professional:"bg-biosensor/15 text-biosensor border-biosensor/30",
                  };
                  return (
                    <div key={u.user_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt={u.full_name ?? ""} className="h-9 w-9 rounded-full object-cover border border-border shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                          {(u.full_name ?? u.email ?? "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.full_name ?? "Sin nombre"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{u.email ?? "—"}{u.city ? ` · ${u.city}` : ""}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${roleColors[u.role] ?? "bg-muted/40 text-muted-foreground border-border"}`}>
                        {u.role}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                        {new Date(u.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "2-digit" })}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500/60 shrink-0"
                        disabled={deleting === u.user_id}
                        onClick={() => deleteUser(u.user_id, u.full_name ?? u.email ?? u.user_id)}
                      >
                        {deleting === u.user_id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        {/* ── Notas y peticiones del evaluador ── */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
              <Bell className="h-4 w-4 text-copper" />
              Enviar nota / petición
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              El evaluador puede enviar mensajes internos a cualquier profesional, familia o institución registrada.
            </p>
            <form onSubmit={sendNote} className="space-y-3">
              <div>
                <Label>Destinatario</Label>
                <Select value={noteTarget} onValueChange={setNoteTarget}>
                  <SelectTrigger>
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
              <div>
                <Label>Asunto / título</Label>
                <Input
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Ej: Documentación pendiente, Revisión de perfil…"
                />
              </div>
              <div>
                <Label>Mensaje (opcional)</Label>
                <Textarea
                  rows={3}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Detalle de la nota o petición…"
                />
              </div>
              <Button type="submit" disabled={sendingNote || !noteTarget || !noteTitle} variant="hero" className="w-full gap-2">
                {sendingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar notificación
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-biosensor" />
              ¿Cómo funciona?
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Guía rápida del módulo de comunicación interna.</p>
            <ul className="space-y-3 text-sm">
              {[
                { icon: Bell, text: "El usuario recibe la nota en su panel como notificación (campana) en tiempo real." },
                { icon: UserCircle, text: "Solo se muestran profesionales, familias e instituciones como destinatarios." },
                { icon: Send, text: "Puedes enviar peticiones de documentos, recordatorios o revisiones de perfil." },
                { icon: CheckCircle2, text: "Las notas quedan registradas en la tabla notifications con tipo evaluator_note." },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-muted-foreground">
                  <Icon className="h-4 w-4 text-biosensor shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  urgent,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: "bio" | "copper" | "fuchsia";
  urgent?: boolean;
}) {
  const colors = {
    bio: "text-biosensor bg-biosensor/10",
    copper: "text-copper bg-copper/10",
    fuchsia: "text-fuchsia-neural bg-fuchsia-neural/10",
  }[tone];
  return (
    <Card className={`p-4 transition-colors ${urgent && value > 0 ? "border-fuchsia-neural/40 bg-fuchsia-neural/[0.02]" : ""}`}>
      <div className="relative inline-flex">
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}>
          <Icon className="h-4 w-4" />
        </div>
        {urgent && value > 0 && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-fuchsia-neural animate-pulse" />
        )}
      </div>
      <p className={`mt-3 text-2xl font-bold font-display ${urgent && value > 0 ? "text-fuchsia-neural" : ""}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </Card>
  );
}

function ShortcutCard({
  icon: Icon,
  title,
  desc,
  to,
  tone = "bio",
  badge,
}: {
  icon: typeof Users;
  title: string;
  desc: string;
  to: string;
  tone?: "bio" | "copper" | "fuchsia";
  badge?: { label: string; urgent?: boolean };
}) {
  const toneStyles = {
    bio: {
      icon: "bg-biosensor/10 text-biosensor",
      hover: "hover:border-biosensor/40",
      link: "text-biosensor",
    },
    copper: {
      icon: "bg-copper/10 text-copper",
      hover: "hover:border-copper/40",
      link: "text-copper",
    },
    fuchsia: {
      icon: "bg-fuchsia-neural/10 text-fuchsia-neural",
      hover: "hover:border-fuchsia-neural/40",
      link: "text-fuchsia-neural",
    },
  }[tone];

  return (
    <Link
      to={to}
      className={`group relative flex flex-col rounded-2xl border border-border bg-card p-5 hover:-translate-y-0.5 transition-all shadow-[var(--shadow-card)] ${toneStyles.hover}`}
    >
      {badge && (
        <span
          className={`absolute top-3 right-3 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${
            badge.urgent
              ? "bg-fuchsia-neural/15 text-fuchsia-neural border-fuchsia-neural/30"
              : "bg-muted text-muted-foreground border-border"
          }`}
        >
          {badge.urgent && (
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-fuchsia-neural animate-pulse" />
          )}
          {badge.label}
        </span>
      )}
      <div
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${toneStyles.icon}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 font-display font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed flex-1">{desc}</p>
      <p className={`mt-3 text-xs font-semibold inline-flex items-center gap-1 ${toneStyles.link}`}>
        Abrir <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
      </p>
    </Link>
  );
}
