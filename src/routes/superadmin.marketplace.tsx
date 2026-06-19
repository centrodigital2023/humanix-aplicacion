import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  ShieldAlert,
  Users,
  Briefcase,
  FileCheck,
  Mail,
  LayoutDashboard,
  ScrollText,
  Megaphone,
  MessageSquare,
  Sparkles,
  Search,
  Inbox,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { ShareButtons } from "@/components/humanix/ShareButtons";

export const Route = createFileRoute("/superadmin/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace · Superadmin" }] }),
  component: MarketplacePage,
});

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: MessageSquare },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
];

type Offer = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  amount: number;
  modality: string;
  status: string;
  created_at: string;
  poster_type: string;
  specialty_required: string | null;
};

type Pqrs = {
  id: string;
  subject: string;
  description: string;
  type: string;
  ai_category: string | null;
  ai_priority: string | null;
  ai_sentiment: string | null;
  ai_summary: string | null;
  status: string;
  created_at: string;
  contact_email: string | null;
  contact_name: string | null;
};

function MarketplacePage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin", "hr_staff"] });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tickets, setTickets] = useState<Pqrs[]>([]);
  const [search, setSearch] = useState("");
  const [classifying, setClassifying] = useState<string | null>(null);
  const [matching, setMatching] = useState<string | null>(null);
  const [matchResults, setMatchResults] = useState<
    Record<string, { user_id: string; similarity: number }[]>
  >({});
  const origin = typeof window !== "undefined" ? window.location.origin : "https://humanix.lat";

  useEffect(() => {
    if (!user) return;
    void load();
    const ch = supabase
      .channel("superadmin-mkt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_offers" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pqrs_tickets" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user]);

  const load = async () => {
    const [{ data: o }, { data: t }] = await Promise.all([
      supabase
        .from("job_offers")
        .select(
          "id,title,description,city,amount,modality,status,created_at,poster_type,specialty_required",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("pqrs_tickets")
        .select(
          "id,subject,description,type,ai_category,ai_priority,ai_sentiment,ai_summary,status,created_at,contact_email,contact_name",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setOffers((o ?? []) as Offer[]);
    setTickets((t ?? []) as Pqrs[]);
  };

  const runMatch = async (offerId: string) => {
    setMatching(offerId);
    try {
      const { data, error } = await supabase.rpc("match_professionals_for_offer", {
        _offer_id: offerId,
        _match_count: 5,
        _min_similarity: 0.4,
      });
      if (error) throw error;
      setMatchResults((p) => ({ ...p, [offerId]: data ?? [] }));
      toast.success(`${(data ?? []).length} profesionales sugeridos por IA`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error matchmaking");
    } finally {
      setMatching(null);
    }
  };

  const classifyTicket = async (id: string) => {
    setClassifying(id);
    try {
      const { error } = await supabase.functions.invoke("pqrs-classifier", {
        body: { ticket_id: id },
      });
      if (error) throw error;
      toast.success("Ticket clasificado por IA");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error IA");
    } finally {
      setClassifying(null);
    }
  };

  const updateTicketStatus = async (id: string, status: string) => {
    await supabase
      .from("pqrs_tickets")
      .update({
        status,
        ...(status === "resolved" ? { resolved_at: new Date().toISOString() } : {}),
      })
      .eq("id", id);
    toast.success("Estado actualizado");
    await load();
  };

  const filteredOffers = offers.filter(
    (o) =>
      !search ||
      o.title.toLowerCase().includes(search.toLowerCase()) ||
      o.city.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredTickets = tickets.filter(
    (t) => !search || t.subject.toLowerCase().includes(search.toLowerCase()),
  );

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

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Marketplace + PQRS"
      subtitle="Ofertas en vivo con matchmaking IA y tickets PQRS clasificados por Gemini."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Marketplace" }]}
      badge={{ label: "Marketplace", tone: "bio" }}
    >
      <div className="space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar ofertas o tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Tabs defaultValue="offers" className="space-y-4">
          <TabsList>
            <TabsTrigger value="offers" className="gap-2">
              <Briefcase className="h-3.5 w-3.5" /> Ofertas ({offers.length})
            </TabsTrigger>
            <TabsTrigger value="pqrs" className="gap-2">
              <Inbox className="h-3.5 w-3.5" /> PQRS (
              {tickets.filter((t) => t.status !== "resolved").length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="offers" className="space-y-3">
            {filteredOffers.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Sin ofertas.</Card>
            ) : (
              filteredOffers.map((o) => (
                <Card key={o.id} className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold font-display">{o.title}</h3>
                        <Badge
                          variant={o.status === "open" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {o.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {o.poster_type}
                        </Badge>
                        {o.specialty_required && (
                          <Badge variant="outline" className="text-[10px]">
                            {o.specialty_required}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {o.city} · {o.modality} · ${o.amount.toLocaleString("es-CO")}
                      </p>
                      {o.description && (
                        <p className="text-xs text-foreground/80 mt-2 line-clamp-2">
                          {o.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runMatch(o.id)}
                        disabled={matching === o.id}
                        className="gap-1.5"
                      >
                        {matching === o.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 text-biosensor" />
                        )}
                        Matchmaking IA
                      </Button>
                      <ShareButtons
                        url={`${origin}/buscar?offer=${o.id}`}
                        title={`${o.title} · ${o.city}`}
                        description={o.description ?? ""}
                      />
                    </div>
                  </div>
                  {matchResults[o.id]?.length ? (
                    <div className="mt-3 pt-3 border-t border-border space-y-1">
                      <p className="text-[11px] uppercase tracking-wider text-biosensor font-semibold">
                        Top profesionales sugeridos
                      </p>
                      {matchResults[o.id].map((m) => (
                        <Link
                          key={m.user_id}
                          to="/profesional/$proId"
                          params={{ proId: m.user_id }}
                          className="flex items-center justify-between text-xs py-1 hover:underline"
                        >
                          <span className="font-mono truncate">{m.user_id.slice(0, 8)}…</span>
                          <Badge variant="outline" className="text-[10px]">
                            {(m.similarity * 100).toFixed(0)}% match
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="pqrs" className="space-y-3">
            {filteredTickets.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Sin tickets PQRS.
              </Card>
            ) : (
              filteredTickets.map((t) => (
                <Card key={t.id} className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{t.subject}</h3>
                        <Badge variant="outline" className="text-[10px]">
                          {t.type}
                        </Badge>
                        {t.ai_priority && (
                          <Badge
                            className={`text-[10px] ${
                              t.ai_priority === "urgent"
                                ? "bg-fuchsia-neural text-fuchsia-neural-foreground"
                                : t.ai_priority === "high"
                                  ? "bg-copper text-copper-foreground"
                                  : "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            {t.ai_priority}
                          </Badge>
                        )}
                        {t.ai_sentiment && (
                          <Badge variant="outline" className="text-[10px]">
                            {t.ai_sentiment}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t.contact_name || t.contact_email || "Anónimo"} ·{" "}
                        {new Date(t.created_at).toLocaleDateString("es-CO")}
                      </p>
                      <p className="text-xs text-foreground/80 mt-2 line-clamp-3">
                        {t.ai_summary || t.description}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => classifyTicket(t.id)}
                        disabled={classifying === t.id}
                        className="gap-1.5"
                      >
                        {classifying === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 text-biosensor" />
                        )}
                        Clasificar IA
                      </Button>
                      <Select value={t.status} onValueChange={(v) => updateTicketStatus(t.id, v)}>
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Abierto</SelectItem>
                          <SelectItem value="in_progress">En curso</SelectItem>
                          <SelectItem value="resolved">Resuelto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
