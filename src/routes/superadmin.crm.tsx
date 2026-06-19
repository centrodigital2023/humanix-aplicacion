import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  LayoutDashboard,
  ShieldAlert,
  ScrollText,
  Megaphone,
  Users,
  FileCheck,
  Briefcase,
  MessageSquare,
  Plus,
  Sparkles,
  Send,
  Mail,
  CheckCircle2,
  Clock,
  BarChart3,
  ListTodo,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/crm")({
  head: () => ({ meta: [{ title: "CRM · Superadmin" }] }),
  component: CRMPage,
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

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  segment: string | null;
  lead_score: number | null;
  ai_sentiment: string | null;
  ai_summary: string | null;
  tags: string[] | null;
  source: string | null;
  last_contacted_at: string | null;
  created_at: string;
};

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  content: string | null;
  channel: string;
  status: string;
  recipients_count: number | null;
  delivered_count: number | null;
  sent_at: string | null;
  created_at: string;
};

type Task = {
  id: string;
  contact_id: string | null;
  title: string;
  due_at: string | null;
  status: string;
  priority: string;
  created_at: string;
};

function CRMPage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin", "hr_staff"] });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contactDlg, setContactDlg] = useState(false);
  const [campaignDlg, setCampaignDlg] = useState(false);
  const [taskDlg, setTaskDlg] = useState(false);
  const [editingContact, setEditingContact] = useState<Partial<Contact>>({});
  const [editingCampaign, setEditingCampaign] = useState<Partial<Campaign>>({});
  const [editingTask, setEditingTask] = useState<Partial<Task>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void load();
    const ch = supabase
      .channel("crm-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_contacts" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_campaigns" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_tasks" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user]);

  const load = async () => {
    const [{ data: c }, { data: cp }, { data: t }] = await Promise.all([
      supabase
        .from("crm_contacts")
        .select("*")
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(100),
      supabase
        .from("crm_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("crm_tasks")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(50),
    ]);
    setContacts((c ?? []) as Contact[]);
    setCampaigns((cp ?? []) as Campaign[]);
    setTasks((t ?? []) as Task[]);
  };

  const saveContact = async () => {
    if (!editingContact.full_name) {
      toast.error("Nombre requerido");
      return;
    }
    const payload = {
      full_name: editingContact.full_name!,
      email: editingContact.email ?? null,
      phone: editingContact.phone ?? null,
      city: editingContact.city ?? null,
      source: editingContact.source ?? "manual",
      tags: editingContact.tags ?? [],
    };
    const { error } = editingContact.id
      ? await supabase.from("crm_contacts").update(payload).eq("id", editingContact.id)
      : await supabase.from("crm_contacts").insert({ ...payload, created_by: user?.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contacto guardado");
    setContactDlg(false);
    setEditingContact({});
    await load();
  };

  const segmentContact = async (id: string) => {
    setAiBusy(id);
    try {
      const { error } = await supabase.functions.invoke("crm-segment-ai", {
        body: { contact_id: id },
      });
      if (error) throw error;
      toast.success("Contacto segmentado por IA");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error IA");
    } finally {
      setAiBusy(null);
    }
  };

  const saveCampaign = async () => {
    if (!editingCampaign.name) {
      toast.error("Nombre requerido");
      return;
    }
    const payload = {
      name: editingCampaign.name!,
      subject: editingCampaign.subject ?? null,
      content: editingCampaign.content ?? null,
      channel: editingCampaign.channel ?? "email",
      status: "draft",
    };
    const { error } = editingCampaign.id
      ? await supabase.from("crm_campaigns").update(payload).eq("id", editingCampaign.id)
      : await supabase.from("crm_campaigns").insert({ ...payload, created_by: user?.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Campaña guardada");
    setCampaignDlg(false);
    setEditingCampaign({});
    await load();
  };

  const sendCampaign = async (c: Campaign) => {
    if (!c.subject || !c.content) {
      toast.error("Falta asunto o contenido");
      return;
    }
    if (
      !confirm(
        `Enviar la campaña "${c.name}" a TODOS los contactos con email? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setSendingId(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-campaign", {
        body: { campaign_id: c.id },
      });
      if (error) throw error;
      const result = data as { delivered: number; total: number };
      toast.success(`Enviada a ${result.delivered}/${result.total} contactos`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSendingId(null);
    }
  };

  const saveTask = async () => {
    if (!editingTask.title) {
      toast.error("Título requerido");
      return;
    }
    const { error } = await supabase.from("crm_tasks").insert({
      title: editingTask.title!,
      contact_id: editingTask.contact_id ?? null,
      due_at: editingTask.due_at ?? null,
      priority: editingTask.priority ?? "normal",
      status: "open",
      created_by: user?.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tarea creada");
    setTaskDlg(false);
    setEditingTask({});
    await load();
  };

  const completeTask = async (id: string) => {
    await supabase
      .from("crm_tasks")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    toast.success("Tarea completada");
    await load();
  };

  // Reportes
  const segmentDist = contacts.reduce(
    (acc, c) => {
      const s = c.segment ?? "sin_segmentar";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const avgScore =
    contacts.length > 0
      ? Math.round(contacts.reduce((s, c) => s + (c.lead_score ?? 0), 0) / contacts.length)
      : 0;
  const sentCampaigns = campaigns.filter((c) => c.status === "sent");
  const totalDelivered = sentCampaigns.reduce((s, c) => s + (c.delivered_count ?? 0), 0);

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
      title="CRM"
      subtitle="Contactos con segmentación IA, campañas Resend, tareas y reportes."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "CRM" }]}
      badge={{ label: "CRM", tone: "fuchsia" }}
    >
      <Tabs defaultValue="contacts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="contacts" className="gap-2">
            <Users className="h-3.5 w-3.5" /> Contactos ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2">
            <Mail className="h-3.5 w-3.5" /> Campañas ({campaigns.length})
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <ListTodo className="h-3.5 w-3.5" /> Tareas (
            {tasks.filter((t) => t.status === "open").length})
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <BarChart3 className="h-3.5 w-3.5" /> Reportes
          </TabsTrigger>
        </TabsList>

        {/* CONTACTOS */}
        <TabsContent value="contacts" className="space-y-3">
          <div className="flex justify-end">
            <Dialog
              open={contactDlg}
              onOpenChange={(v) => {
                setContactDlg(v);
                if (!v) setEditingContact({});
              }}
            >
              <DialogTrigger asChild>
                <Button variant="hero" onClick={() => setEditingContact({})} className="gap-1.5">
                  <Plus className="h-4 w-4" /> Nuevo contacto
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuevo contacto</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Nombre completo</Label>
                    <Input
                      value={editingContact.full_name ?? ""}
                      onChange={(e) =>
                        setEditingContact({ ...editingContact, full_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={editingContact.email ?? ""}
                        onChange={(e) =>
                          setEditingContact({ ...editingContact, email: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Teléfono</Label>
                      <Input
                        value={editingContact.phone ?? ""}
                        onChange={(e) =>
                          setEditingContact({ ...editingContact, phone: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Ciudad</Label>
                      <Input
                        value={editingContact.city ?? ""}
                        onChange={(e) =>
                          setEditingContact({ ...editingContact, city: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Origen</Label>
                      <Input
                        value={editingContact.source ?? ""}
                        onChange={(e) =>
                          setEditingContact({ ...editingContact, source: e.target.value })
                        }
                        placeholder="web, ads, referido…"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setContactDlg(false)}>
                    Cancelar
                  </Button>
                  <Button variant="hero" onClick={saveContact}>
                    Guardar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {contacts.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin contactos.</Card>
          ) : (
            contacts.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{c.full_name}</h3>
                      {c.segment && (
                        <Badge
                          className={`text-[10px] ${
                            c.segment === "hot_lead"
                              ? "bg-fuchsia-neural text-fuchsia-neural-foreground"
                              : c.segment === "warm_lead"
                                ? "bg-copper text-copper-foreground"
                                : c.segment === "customer"
                                  ? "bg-biosensor text-biosensor-foreground"
                                  : "bg-secondary text-secondary-foreground"
                          }`}
                        >
                          {c.segment}
                        </Badge>
                      )}
                      {c.lead_score !== null && (
                        <Badge variant="outline" className="text-[10px]">
                          Score {c.lead_score}/100
                        </Badge>
                      )}
                      {c.ai_sentiment && (
                        <Badge variant="outline" className="text-[10px]">
                          {c.ai_sentiment}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {c.email} {c.phone && `· ${c.phone}`} {c.city && `· ${c.city}`}
                    </p>
                    {c.ai_summary && (
                      <p className="text-xs text-foreground/80 mt-1">{c.ai_summary}</p>
                    )}
                    {c.tags && c.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.tags.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => segmentContact(c.id)}
                    disabled={aiBusy === c.id}
                    className="gap-1.5"
                  >
                    {aiBusy === c.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 text-biosensor" />
                    )}
                    Segmentar IA
                  </Button>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* CAMPAÑAS */}
        <TabsContent value="campaigns" className="space-y-3">
          <div className="flex justify-end">
            <Dialog
              open={campaignDlg}
              onOpenChange={(v) => {
                setCampaignDlg(v);
                if (!v) setEditingCampaign({});
              }}
            >
              <DialogTrigger asChild>
                <Button variant="hero" onClick={() => setEditingCampaign({})} className="gap-1.5">
                  <Plus className="h-4 w-4" /> Nueva campaña
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nueva campaña</DialogTitle>
                  <DialogDescription>
                    Usa <code>{"{{nombre}}"}</code> para personalizar el contenido HTML.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Nombre interno</Label>
                    <Input
                      value={editingCampaign.name ?? ""}
                      onChange={(e) =>
                        setEditingCampaign({ ...editingCampaign, name: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Asunto</Label>
                    <Input
                      value={editingCampaign.subject ?? ""}
                      onChange={(e) =>
                        setEditingCampaign({ ...editingCampaign, subject: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Contenido HTML</Label>
                    <Textarea
                      rows={6}
                      value={editingCampaign.content ?? ""}
                      onChange={(e) =>
                        setEditingCampaign({ ...editingCampaign, content: e.target.value })
                      }
                      placeholder="<h2>Hola {{nombre}}</h2><p>…</p>"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCampaignDlg(false)}>
                    Cancelar
                  </Button>
                  <Button variant="hero" onClick={saveCampaign}>
                    Guardar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {campaigns.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin campañas.</Card>
          ) : (
            campaigns.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{c.name}</h3>
                      <Badge
                        variant={c.status === "sent" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {c.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {c.channel}
                      </Badge>
                    </div>
                    {c.subject && <p className="text-xs text-muted-foreground mt-1">{c.subject}</p>}
                    {c.status === "sent" && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Enviada {c.sent_at && new Date(c.sent_at).toLocaleDateString("es-CO")} ·{" "}
                        {c.delivered_count}/{c.recipients_count} entregados
                      </p>
                    )}
                  </div>
                  {c.status !== "sent" && (
                    <Button
                      size="sm"
                      variant="hero"
                      onClick={() => sendCampaign(c)}
                      disabled={sendingId === c.id}
                      className="gap-1.5"
                    >
                      {sendingId === c.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      Enviar
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* TAREAS */}
        <TabsContent value="tasks" className="space-y-3">
          <div className="flex justify-end">
            <Dialog
              open={taskDlg}
              onOpenChange={(v) => {
                setTaskDlg(v);
                if (!v) setEditingTask({});
              }}
            >
              <DialogTrigger asChild>
                <Button variant="hero" onClick={() => setEditingTask({})} className="gap-1.5">
                  <Plus className="h-4 w-4" /> Nueva tarea
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nueva tarea</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Título</Label>
                    <Input
                      value={editingTask.title ?? ""}
                      onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Contacto</Label>
                    <Select
                      value={editingTask.contact_id ?? ""}
                      onValueChange={(v) => setEditingTask({ ...editingTask, contact_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="(opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {contacts.slice(0, 50).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Vence</Label>
                      <Input
                        type="datetime-local"
                        value={editingTask.due_at?.slice(0, 16) ?? ""}
                        onChange={(e) =>
                          setEditingTask({
                            ...editingTask,
                            due_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Prioridad</Label>
                      <Select
                        value={editingTask.priority ?? "normal"}
                        onValueChange={(v) => setEditingTask({ ...editingTask, priority: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Baja</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                          <SelectItem value="urgent">Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setTaskDlg(false)}>
                    Cancelar
                  </Button>
                  <Button variant="hero" onClick={saveTask}>
                    Crear
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {tasks.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin tareas.</Card>
          ) : (
            tasks.map((t) => (
              <Card key={t.id} className={`p-3 ${t.status === "done" ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => completeTask(t.id)}
                    disabled={t.status === "done"}
                    className="shrink-0"
                  >
                    {t.status === "done" ? (
                      <CheckCircle2 className="h-5 w-5 text-biosensor" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-border hover:border-biosensor transition-colors" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium ${t.status === "done" ? "line-through" : ""}`}
                    >
                      {t.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">
                        {t.priority}
                      </Badge>
                      {t.due_at && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(t.due_at).toLocaleString("es-CO", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* REPORTES */}
        <TabsContent value="reports" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-2xl font-bold font-display">{contacts.length}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Contactos
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-bold font-display">{avgScore}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Lead Score Avg
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-bold font-display">{sentCampaigns.length}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Campañas enviadas
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-bold font-display">{totalDelivered}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Emails entregados
              </p>
            </Card>
          </div>
          <Card className="p-6">
            <h3 className="font-display font-semibold mb-3">Distribución por segmento</h3>
            {Object.entries(segmentDist).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(segmentDist)
                  .sort((a, b) => b[1] - a[1])
                  .map(([seg, n]) => {
                    const pct = (n / contacts.length) * 100;
                    return (
                      <div key={seg}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium">{seg}</span>
                          <span className="text-muted-foreground">
                            {n} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-biosensor to-copper"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
