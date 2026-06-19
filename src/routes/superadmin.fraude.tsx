import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
  Users,
  Briefcase,
  FileCheck,
  LayoutDashboard,
  AlertTriangle,
  ScrollText,
  Megaphone,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/superadmin/fraude")({
  head: () => ({ meta: [{ title: "Anti-fraude · Superadmin · Humanix" }] }),
  component: FraudePage,
});

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: MessageSquare },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
];

type Severity = "low" | "medium" | "high" | "critical";

type FraudFlag = {
  id: string;
  user_id: string;
  reason: string;
  severity: Severity;
  resolved: boolean;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type ProfileLite = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

const SEV_COLOR: Record<Severity, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-copper/10 text-copper border-copper/30",
  high: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

function FraudePage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin", "hr_staff"] });
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = async () => {
    setDataLoading(true);
    const { data } = await supabase
      .from("fraud_flags")
      .select("*")
      .eq("resolved", showResolved)
      .order("created_at", { ascending: false })
      .limit(200);
    const list = (data ?? []) as FraudFlag[];
    setFlags(list);

    const userIds = Array.from(new Set(list.map((f) => f.user_id)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url")
        .in("user_id", userIds);
      const map: Record<string, ProfileLite> = {};
      for (const p of profs ?? []) map[p.user_id] = p as ProfileLite;
      setProfiles(map);
    }
    setDataLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showResolved]);

  const resolve = async (id: string) => {
    setResolvingId(id);
    const { error } = await supabase.from("fraud_flags").update({ resolved: true }).eq("id", id);
    setResolvingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marcado como resuelto");
    setFlags((prev) => prev.filter((f) => f.id !== id));
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
            Este módulo requiere permisos de superadmin o rrhh.
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

  const counts = flags.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<Severity, number>,
  );

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Anti-fraude"
      subtitle="Alertas IA + heurísticas. Revisa, contacta al usuario o marca como resuelto."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Anti-fraude" }]}
      badge={{ label: "Seguridad", tone: "fuchsia" }}
      actions={
        <Button variant="outline" size="sm" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Ver pendientes" : "Ver resueltos"}
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["critical", "high", "medium", "low"] as Severity[]).map((sev) => (
            <Card key={sev} className="p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{sev}</p>
              <p className="mt-1 text-2xl font-bold font-display">{counts[sev] ?? 0}</p>
            </Card>
          ))}
        </section>

        {dataLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando alertas…
          </Card>
        ) : flags.length === 0 ? (
          <Card className="p-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-biosensor mx-auto mb-3" />
            <p className="font-semibold">
              {showResolved ? "Sin alertas resueltas registradas" : "Sin alertas pendientes"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              La IA seguirá revisando en segundo plano y marcará nuevas alertas aquí.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {flags.map((f) => {
              const profile = profiles[f.user_id];
              return (
                <Card key={f.id} className="p-4">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="h-10 w-10 rounded-full bg-muted overflow-hidden shrink-0">
                      {profile?.avatar_url && (
                        <img
                          src={profile.avatar_url}
                          alt={profile.full_name ?? ""}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold truncate">
                          {profile?.full_name ?? "Usuario sin nombre"}
                        </p>
                        <Badge variant="outline" className={SEV_COLOR[f.severity]}>
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {f.severity}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(f.created_at).toLocaleString("es-CO")}
                        </span>
                      </div>
                      {profile?.email && (
                        <p className="text-xs text-muted-foreground">{profile.email}</p>
                      )}
                      <p className="mt-2 text-sm">{f.reason}</p>
                      {f.meta && Object.keys(f.meta).length > 0 && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Ver evidencia
                          </summary>
                          <pre className="mt-1 p-2 rounded bg-muted/50 overflow-x-auto text-[11px]">
                            {JSON.stringify(f.meta, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <Link
                        to="/talento-humano"
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" /> Ver perfil
                      </Link>
                      {!f.resolved && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resolve(f.id)}
                          disabled={resolvingId === f.id}
                        >
                          {resolvingId === f.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          )}
                          Resolver
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
