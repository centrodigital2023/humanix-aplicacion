// Moderación de calificaciones/reseñas: ver, filtrar, reportar y eliminar.
import { useEffect, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Star,
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
import { useSuperadmin } from "@/hooks/use-superadmin";
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
  status: "published" | "flagged";
  flagged_reason: string | null;
  created_at: string;
  reviewer_name?: string;
  reviewed_name?: string;
};

type StatusFilter = "all" | "published" | "flagged";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/superadmin/resenas")({
  head: () =>
    buildSeo({
      title: "Moderación reseñas · Superadmin",
      path: "/superadmin/resenas",
      noindex: true,
    }),
  component: ResenasPage,
});

function ResenasPage() {
  const { user, logout } = useSuperadmin();
  const [rows, setRows] = useState<Row[]>([]);
  const [fetching, setFetching] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const q = sb
        .from("service_ratings")
        .select(
          "id, reviewer_id:rater_id, reviewed_id:rated_id, stars, comment, status, flagged_reason, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as Row[]) ?? []);
    } catch (err) {
      toast.error("No pudimos cargar las reseñas. Inténtalo de nuevo.");
    } finally {
      setFetching(false);
    }
  }, [user, filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Mantener la deja publicada (ya no se puede volver a reportar); eliminar la borra y sale de los promedios. Queda en auditoría.
  const moderate = async (ids: string[], keep: boolean) => {
    if (
      !keep &&
      !window.confirm(
        `¿Eliminar ${ids.length} reseña${ids.length > 1 ? "s" : ""}? No se puede deshacer.`,
      )
    ) {
      return;
    }
    try {
      const results = await Promise.all(
        ids.map((id) => sb.rpc("moderate_rating", { p_rating_id: id, p_keep: keep })),
      );
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
      toast.success(`${ids.length} reseña${ids.length > 1 ? "s" : ""} actualizadas.`);
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error("No pudimos guardar el cambio. Inténtalo de nuevo.");
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
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!user) return null;

  return (
    <AppShell nav={NAV} title="Moderación de Reseñas" user={user} onLogout={logout}>
      <div className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-3">
          {(["all", "published", "flagged"] as StatusFilter[]).map((s) => (
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
                {s === "all" ? "Total" : s === "published" ? "Publicadas" : "Reportadas"}
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
              <Button size="sm" variant="outline" onClick={() => moderate([...selected], true)}>
                <CheckSquare className="h-4 w-4 mr-1.5 text-biosensor" />
                Mantener {selected.size}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/5"
                onClick={() => moderate([...selected], false)}
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
                        setSelected(
                          e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set(),
                        )
                      }
                      checked={selected.size === filtered.length && filtered.length > 0}
                      className="accent-biosensor"
                    />
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">
                    Revisor
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">
                    Calificado
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">
                    Puntuación
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">
                    Comentario
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">
                    Estado
                  </th>
                  <th className="py-3 px-3 text-left font-semibold text-muted-foreground">Fecha</th>
                  <th className="py-3 px-3 text-right font-semibold text-muted-foreground">
                    Acciones
                  </th>
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
                          {r.reviewer_name ?? r.reviewer_id.slice(0, 8)}
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
                          {r.comment ?? (
                            <span className="italic text-muted-foreground">Sin comentario</span>
                          )}
                        </p>
                        {r.flagged_reason && (
                          <p className="text-xs text-destructive mt-0.5">⚑ {r.flagged_reason}</p>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant={r.status === "published" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {r.status === "published" ? "Publicada" : "Reportada"}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("es-CO")}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.status === "flagged" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-biosensor hover:bg-biosensor/10"
                              onClick={() => moderate([r.id], true)}
                              title="Mantener"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-destructive hover:bg-destructive/10"
                            onClick={() => moderate([r.id], false)}
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
