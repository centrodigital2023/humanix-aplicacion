// Moderación de calificaciones/reseñas: ver, filtrar, reportar y eliminar.
import { useEffect, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Star,
  Flag,
  Trash2,
  ShieldCheck,
  LayoutDashboard,
  ShieldAlert,
  ScrollText,
  Megaphone,
  Mail,
  Users,
  FileCheck,
  Briefcase,
  Sparkles,
  MessageSquare,
  RefreshCw,
  CheckSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { StarDisplay } from "@/components/humanix/RatingCard";
import { buildSeo } from "@/lib/seo";

const sb = supabase as unknown as SupabaseClient;

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Reseñas", to: "/superadmin/resenas", icon: Star },
  { label: "Testimonios", to: "/superadmin/testimonios", icon: MessageSquare },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: Mail },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
  { label: "Marketplace", to: "/buscar", icon: Briefcase },
];

type Row = {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  stars: number;
  comment: string | null;
  is_anonymous: boolean;
  status: "published" | "flagged" | "removed";
  flagged_reason: string | null;
  created_at: string;
  reviewer_name?: string;
  reviewed_name?: string;
};

type StatusFilter = "all" | "published" | "flagged" | "removed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/superadmin/resenas")({
  head: () => buildSeo({ title: "Moderación reseñas · Superadmin", path: "/superadmin/resenas", noindex: true }),
  component: ResenasPage,
});

function ResenasPage() {
  const { user, logout } = useAppUser({ allow: ["superadmin"] });
  const [rows, setRows] = useState<Row[]>([]);
  const [fetching, setFetching] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const q = sb.from("ratings").select("*").order("created_at", { ascending: false }).limit(200);
      if (filter !== "all") q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as Row[]) ?? []);
    } catch (err) {
      toast.error("Error al cargar reseñas");
    } finally {
      setFetching(false);
    }
  }, [user, filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (ids: string[], status: "published" | "removed") => {
    try {
      const { error } = await sb
        .from("ratings")
        .update({ status, moderated_by: user?.id, moderated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} reseña${ids.length > 1 ? "s" : ""} actualizadas.`);
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error("Error al actualizar");
    }
  };

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.comment ?? "").toLowerCase().includes(q) ||
      (r.reviewer_name ?? "").toLowerCase().includes(q) ||
      (r.reviewed_name ?? "").toLowerCase().includes(q)
    );
  });

  const counts = {
    all: rows.length,
    published: rows.filter((r) => r.status === "published").length,
    flagged: rows.filter((r) => r.status === "flagged").length,
    removed: rows.filter((r) => r.status === "removed").length,
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!user) return null;

  return (
    <AppShell nav={NAV} title="Moderación de Reseñas" user={user} onLogout={logout}>
      <div className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["all", "published", "flagged", "removed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                filter === s
                  ? "border-biosensor bg-biosensor/5"
                  : "border-border bg-card hover:bg-muted/30"
              }`}
            >
              <p className="text-2xl font-bold font-display">{counts[s]}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                {s === "all" ? "Total" : s === "published" ? "Publicadas" : s === "flagged" ? "Reportadas" : "Eliminadas"}
              </p>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Buscar por comentario o usuario..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={fetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${fetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus([...selected], "published")}
              >
                <CheckSquare className="h-4 w-4 mr-1.5 text-biosensor" />
                Restaurar {selected.size}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/5"
                onClick={() => updateStatus([...selected], "removed")}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Eliminar {selected.size}
              </Button>
            </>
          )}
        </div>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="py-3 pl-4 pr-2 text-left w-8">
                    <input
                      type="checkbox"
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())
                      }
                      checked={selected.size === filtered.length && filtered.length > 0}
                      className="accent-biosensor"
                    />
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Revisor</th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Calificado</th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Puntuación</th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Comentario</th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Estado</th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Fecha</th>
                  <th className="py-3 px-3 text-right font-semibold text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {fetching ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      Cargando...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      No hay reseñas con ese filtro.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${
                        selected.has(r.id) ? "bg-biosensor/5" : ""
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="accent-biosensor"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs font-mono text-muted-foreground">
                          {r.is_anonymous ? "Anónimo" : (r.reviewer_name ?? r.reviewer_id.slice(0, 8))}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs font-mono text-muted-foreground">
                          {r.reviewed_name ?? r.reviewed_id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <StarDisplay value={r.stars} />
                      </td>
                      <td className="py-3 px-3 max-w-[200px]">
                        <p className="text-xs text-foreground/80 truncate" title={r.comment ?? ""}>
                          {r.comment ?? <span className="italic text-muted-foreground">Sin comentario</span>}
                        </p>
                        {r.flagged_reason && (
                          <p className="text-xs text-destructive mt-0.5">⚑ {r.flagged_reason}</p>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant={
                            r.status === "published"
                              ? "default"
                              : r.status === "flagged"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {r.status === "published"
                            ? "Publicada"
                            : r.status === "flagged"
                            ? "Reportada"
                            : "Eliminada"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("es-CO")}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.status !== "published" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-biosensor hover:bg-biosensor/10"
                              onClick={() => updateStatus([r.id], "published")}
                              title="Restaurar"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {r.status !== "flagged" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-amber-500 hover:bg-amber-500/10"
                              onClick={() => updateStatus([r.id], "removed")}
                              title="Reportar"
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {r.status !== "removed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-destructive hover:bg-destructive/10"
                              onClick={() => updateStatus([r.id], "removed")}
                              title="Eliminar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
