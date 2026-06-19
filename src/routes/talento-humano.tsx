import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Loader2,
  Users,
  CheckCircle2,
  XCircle,
  Star,
  LayoutDashboard,
  FileCheck,
  Briefcase,
  Search,
  ShieldAlert,
  ScrollText,
  Megaphone,
  Mail,
  Sparkles,
  Shield,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/talento-humano")({
  head: () => ({
    meta: [{ title: "Talento Humano · Humanix" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: HRPage,
});

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
];

type Pro = {
  id: string;
  user_id: string;
  specialty: string | null;
  bio: string | null;
  verified: boolean | null;
  ai_preapproved: boolean | null;
  rethus_verified: boolean | null;
  trust_score: number | null;
  social_trust_score: number | null;
  social_trust_updated_at: string | null;
  years_experience: number | null;
  avg_rating: number | null;
  active: boolean | null;
};

function HRPage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin", "hr_staff"] });
  const [pros, setPros] = useState<Pro[]>([]);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"all" | "pending" | "verified">("all");

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  const load = async () => {
    const { data } = await supabase
      .from("professional_profiles")
      .select(
        "id, user_id, specialty, bio, verified, ai_preapproved, rethus_verified, trust_score, social_trust_score, social_trust_updated_at, years_experience, avg_rating, active",
      )
      .order("social_trust_score", { ascending: false, nullsFirst: false })
      .limit(100);
    setPros((data ?? []) as Pro[]);
  };

  const toggleVerified = async (id: string, current: boolean | null) => {
    const { error } = await supabase
      .from("professional_profiles")
      .update({ verified: !current })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(!current ? "Profesional verificado" : "Verificación retirada");
    await load();
  };

  const computeTrust = async (userId: string) => {
    toast.loading("Calculando Social Trust Score…", { id: `trust-${userId}` });
    const { data, error } = await supabase.functions.invoke("social-trust-score", {
      body: { user_id: userId },
    });
    toast.dismiss(`trust-${userId}`);
    if (error) return toast.error(error.message);
    toast.success(`Trust Score: ${data?.score ?? "?"}/100`);
    await load();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  const filtered = pros
    .filter((p) => (tab === "verified" ? p.verified : tab === "pending" ? !p.verified : true))
    .filter((p) =>
      filter
        ? `${p.specialty ?? ""} ${p.bio ?? ""}`.toLowerCase().includes(filter.toLowerCase())
        : true,
    );

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Talento Humano"
      subtitle="Verifica, activa y monitorea el roster de profesionales registrados."
      crumbs={[
        { label: "Inicio", to: "/" },
        { label: "Staff", to: "/superadmin" },
        { label: "Talento Humano" },
      ]}
      badge={{ label: "Staff", tone: "bio" }}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Total" value={pros.length} />
          <Stat label="Verificados" value={pros.filter((p) => p.verified).length} />
          <Stat label="Pre-aprobados IA" value={pros.filter((p) => p.ai_preapproved).length} />
          <Stat label="RETHUS" value={pros.filter((p) => p.rethus_verified).length} />
          <Stat
            label="Trust ≥ 80"
            value={pros.filter((p) => (p.social_trust_score ?? 0) >= 80).length}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl border border-border bg-card p-1 text-xs">
            {(["all", "pending", "verified"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  tab === k
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "all" ? "Todos" : k === "pending" ? "Pendientes" : "Verificados"}
              </button>
            ))}
          </div>
          <Input
            placeholder="Buscar por especialidad o bio…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <div className="grid gap-3">
          {filtered.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin resultados.</Card>
          )}
          {filtered.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{p.specialty || "Sin especialidad"}</h3>
                    {p.verified && (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Verificado
                      </Badge>
                    )}
                    {p.ai_preapproved && <Badge variant="secondary">IA pre-aprobado</Badge>}
                    {p.rethus_verified && <Badge variant="outline">RETHUS</Badge>}
                    {(p.social_trust_score ?? 0) >= 80 && (
                      <Badge className="bg-biosensor text-biosensor-foreground gap-1">
                        <Shield className="h-3 w-3" /> Trust {p.social_trust_score}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {p.bio || "Sin bio"}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Shield className="h-3 w-3" /> Social Trust {p.social_trust_score ?? 0}/100
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="h-3 w-3" /> Trust {p.trust_score ?? 0}/100
                    </span>
                    <span>Exp: {p.years_experience ?? 0} años</span>
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3" /> {p.avg_rating?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant={p.verified ? "outline" : "hero"}
                    onClick={() => toggleVerified(p.id, p.verified)}
                  >
                    {p.verified ? (
                      <>
                        <XCircle className="h-4 w-4 mr-1" /> Quitar
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Verificar
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => computeTrust(p.user_id)}>
                    <Sparkles className="h-4 w-4 mr-1" /> Trust IA
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-bold font-display">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </Card>
  );
}
