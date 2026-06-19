import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ScrollText,
  LayoutDashboard,
  Mail,
  Users,
  FileCheck,
  Briefcase,
  Megaphone,
  Sparkles,
  Quote,
  Check,
  X,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";

const sb = supabase as unknown as SupabaseClient;

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
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
  user_id: string;
  author_name: string;
  author_role: "professional" | "family" | "institution";
  author_city: string | null;
  content: string;
  rating: number;
  status: "pending" | "published" | "rejected";
  trust_score_snapshot: number;
  plan_snapshot: string | null;
  created_at: string;
};

export const Route = createFileRoute("/superadmin/testimonios")({
  head: () => ({ meta: [{ title: "Moderación testimonios · Humanix" }] }),
  component: ModeracionPage,
});

function ModeracionPage() {
  const { user, logout } = useAppUser({ allow: ["superadmin"] });
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "published" | "rejected">("pending");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await sb
      .from("community_testimonials")
      .select(
        "id, user_id, author_name, author_role, author_city, content, rating, status, trust_score_snapshot, plan_snapshot, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = sb
      .channel("ct_admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_testimonials" },
        () => void load(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, []);

  const setStatus = async (id: string, status: "published" | "rejected") => {
    setBusy(id);
    const { error } = await sb
      .from("community_testimonials")
      .update({ status, moderated_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success(status === "published" ? "Publicado" : "Rechazado");
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar este testimonio permanentemente?")) return;
    setBusy(id);
    const { error } = await sb.from("community_testimonials").delete().eq("id", id);
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success("Eliminado");
  };

  const visible = rows.filter((r) => r.status === tab);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Verificando…
      </div>
    );
  }

  return (
    <AppShell nav={NAV} title="Moderación de testimonios" user={user} onLogout={logout}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {(["pending", "published", "rejected"] as const).map((s) => {
            const count = rows.filter((r) => r.status === s).length;
            return (
              <Button
                key={s}
                variant={tab === s ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(s)}
              >
                {s === "pending" ? "Pendientes" : s === "published" ? "Publicados" : "Rechazados"}{" "}
                <Badge variant="secondary" className="ml-2">
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Cargando…
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground">
            Sin testimonios en esta categoría.
          </Card>
        ) : (
          <div className="grid gap-3">
            {visible.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{r.author_name}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {r.author_role}
                      </Badge>
                      {r.author_city ? (
                        <span className="text-[11px] text-muted-foreground">{r.author_city}</span>
                      ) : null}
                      <span className="inline-flex items-center gap-1 text-[11px] text-biosensor">
                        <ShieldCheck className="h-3 w-3" /> {r.trust_score_snapshot}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{r.rating}★</span>
                      {r.plan_snapshot ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {r.plan_snapshot}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm flex gap-2">
                      <Quote className="h-4 w-4 shrink-0 text-biosensor/40" />
                      <span>{r.content}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("es-CO")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {r.status !== "published" ? (
                      <Button
                        size="sm"
                        onClick={() => setStatus(r.id, "published")}
                        disabled={busy === r.id}
                      >
                        <Check className="h-3 w-3 mr-1" /> Publicar
                      </Button>
                    ) : null}
                    {r.status !== "rejected" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(r.id, "rejected")}
                        disabled={busy === r.id}
                      >
                        <X className="h-3 w-3 mr-1" /> Rechazar
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(r.id)}
                      disabled={busy === r.id}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Eliminar
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
