import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  ShieldAlert,
  Users,
  Briefcase,
  FileCheck,
  LayoutDashboard,
  ScrollText,
  Search,
  Megaphone,
  Sparkles,
  Mail,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/superadmin/auditoria")({
  head: () => ({ meta: [{ title: "Auditoría · Superadmin · Humanix" }] }),
  component: AuditoriaPage,
});

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
];

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  severity: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

const SEVERITY_TONE: Record<string, string> = {
  info: "bg-biosensor/15 text-biosensor border-biosensor/30",
  warn: "bg-copper/15 text-copper border-copper/30",
  error: "bg-fuchsia-neural/15 text-fuchsia-neural border-fuchsia-neural/30",
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
};

function AuditoriaPage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin"] });
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [days, setDays] = useState<string>("30");

  useEffect(() => {
    if (!user) return;
    void load();
    // realtime: nuevas entradas
    const ch = supabase
      .channel("audit-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        (payload) => {
          setRows((prev) => [payload.new as AuditRow, ...prev].slice(0, 500));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, days, severity]);

  const load = async () => {
    setFetching(true);
    const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
    let query = supabase
      .from("audit_log")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300);
    if (severity !== "all") query = query.eq("severity", severity);
    const { data, error } = await query;
    if (!error) setRows((data ?? []) as AuditRow[]);
    setFetching(false);
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.action.toLowerCase().includes(term) ||
        (r.actor_email ?? "").toLowerCase().includes(term) ||
        (r.resource_type ?? "").toLowerCase().includes(term) ||
        (r.resource_id ?? "").toLowerCase().includes(term),
    );
  }, [q, rows]);

  const exportCSV = () => {
    const header = ["fecha", "actor", "accion", "recurso", "id_recurso", "severidad"];
    const lines = filtered.map((r) =>
      [
        new Date(r.created_at).toISOString(),
        r.actor_email ?? r.actor_id ?? "",
        r.action,
        r.resource_type ?? "",
        r.resource_id ?? "",
        r.severity,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      title="Auditoría"
      subtitle="Registro inmutable de acciones sensibles. Realtime + filtros + exportación."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Auditoría" }]}
      badge={{ label: "Gobernanza", tone: "fuchsia" }}
    >
      <div className="space-y-6">
        <Card className="p-4">
          <div className="grid md:grid-cols-[1fr_180px_140px_auto] gap-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por acción, actor, recurso…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las severidades</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Último día</SelectItem>
                <SelectItem value="7">7 días</SelectItem>
                <SelectItem value="30">30 días</SelectItem>
                <SelectItem value="90">90 días</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCSV}>
              Exportar CSV
            </Button>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="font-display font-semibold">
              Eventos ({filtered.length})
              {fetching && (
                <Loader2 className="inline h-3.5 w-3.5 animate-spin ml-2 text-muted-foreground" />
              )}
            </h2>
            <Badge variant="outline" className="text-[10px]">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Realtime
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Fecha</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Recurso</TableHead>
                  <TableHead className="w-[100px]">Severidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Sin eventos en este rango.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("es-CO", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.actor_email ?? (
                          <span className="text-muted-foreground italic">sistema</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{r.action}</TableCell>
                      <TableCell className="text-xs">
                        {r.resource_type && (
                          <>
                            <span className="text-muted-foreground">{r.resource_type}</span>
                            {r.resource_id && (
                              <span className="ml-1 font-mono text-foreground/70">
                                · {r.resource_id.slice(0, 8)}
                              </span>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            SEVERITY_TONE[r.severity] ?? SEVERITY_TONE.info
                          }`}
                        >
                          {r.severity}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
