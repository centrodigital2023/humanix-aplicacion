import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  MessageSquare,
  Phone,
  Search as SearchIcon,
  Send,
  Sparkles,
  LayoutDashboard,
  Users,
  Crown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp CRM · Humanix" }] }),
  component: WhatsAppCRM,
});

const NAV: NavItem[] = [
  { label: "Inicio", to: "/dashboard", icon: LayoutDashboard },
  { label: "WhatsApp", to: "/dashboard/whatsapp", icon: MessageSquare },
  { label: "Talento", to: "/buscar", icon: Users },
  { label: "Planes", to: "/planes", icon: Crown },
];

type Contact = {
  id: string;
  phone: string;
  display_name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  tag: string | null;
};

type Msg = {
  id: string;
  contact_id: string;
  direction: "in" | "out";
  body: string;
  is_ai: boolean;
  created_at: string;
};

function WhatsAppCRM() {
  const { user, loading, logout } = useAppUser({
    allow: ["superadmin", "hr_staff", "institution", "family"],
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Carga contactos
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("whatsapp_contacts")
        .select("id, phone, display_name, last_message_at, last_message_preview, unread_count, tag")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (!active) return;
      const list = (data ?? []) as Contact[];
      setContacts(list);
      if (list.length && !activeId) setActiveId(list[0].id);
    })();
    return () => {
      active = false;
    };
  }, [user, activeId]);

  // Realtime contactos
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("wa-contacts")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_contacts" }, () => {
        supabase
          .from("whatsapp_contacts")
          .select(
            "id, phone, display_name, last_message_at, last_message_preview, unread_count, tag",
          )
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(200)
          .then(({ data }) => setContacts((data ?? []) as Contact[]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Carga mensajes del activo + realtime
  useEffect(() => {
    if (!activeId) return;
    let active = true;
    setLoadingMsgs(true);
    (async () => {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("id, contact_id, direction, body, is_ai, created_at")
        .eq("contact_id", activeId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!active) return;
      setMessages((data ?? []) as Msg[]);
      setLoadingMsgs(false);
      // marcar leído
      await supabase.from("whatsapp_contacts").update({ unread_count: 0 }).eq("id", activeId);
    })();
    const ch = supabase
      .channel(`wa-msgs-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: `contact_id=eq.${activeId}`,
        },
        (payload) => {
          setMessages((m) => [...m, payload.new as Msg]);
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const filtered = contacts.filter(
    (c) =>
      !search ||
      c.phone.includes(search) ||
      (c.display_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );
  const active = contacts.find((c) => c.id === activeId);

  async function send() {
    if (!draft.trim() || !activeId || sending) return;
    setSending(true);
    const body = draft.trim();
    setDraft("");
    try {
      const { error } = await supabase.functions.invoke("whatsapp-send", {
        body: { contact_id: activeId, body },
      });
      if (error) throw error;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="WhatsApp CRM"
      subtitle="Conversaciones entrantes con autorespuesta IA y envío manual."
      crumbs={[{ label: "Inicio", to: "/" }, { label: "WhatsApp CRM" }]}
      badge={{ label: "WhatsApp Business", tone: "bio" }}
    >
      <div className="grid lg:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[520px]">
        {/* Lista contactos */}
        <aside className="rounded-2xl border border-border bg-card flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contacto…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-muted/50 outline-none focus:ring-2 focus:ring-biosensor/40"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
                Sin conversaciones aún
              </div>
            ) : (
              filtered.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left p-3 border-b border-border/50 transition-colors ${
                      isActive ? "bg-biosensor/10" : "hover:bg-foreground/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{c.display_name ?? c.phone}</p>
                      {c.unread_count > 0 && (
                        <span className="text-[10px] font-bold bg-biosensor text-biosensor-foreground rounded-full px-1.5 py-0.5">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.last_message_preview ?? c.phone}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Chat */}
        <section className="rounded-2xl border border-border bg-card flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground p-8">
              <div>
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Selecciona un contacto para ver la conversación.</p>
              </div>
            </div>
          ) : (
            <>
              <header className="p-3 border-b border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-biosensor/15 text-biosensor flex items-center justify-center">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {active.display_name ?? active.phone}
                    </p>
                    <p className="text-xs text-muted-foreground">{active.phone}</p>
                  </div>
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
                {loadingMsgs ? (
                  <div className="text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          m.direction === "out"
                            ? "bg-biosensor text-biosensor-foreground rounded-br-sm"
                            : "bg-card border border-border rounded-bl-sm"
                        }`}
                      >
                        {m.is_ai && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold opacity-80 mb-0.5">
                            <Sparkles className="h-3 w-3" /> IA
                          </span>
                        )}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="text-[10px] opacity-70 mt-0.5 text-right">
                          {new Date(m.created_at).toLocaleTimeString("es-CO", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="p-3 border-t border-border flex items-center gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribe un mensaje…"
                  className="flex-1 px-3 py-2 rounded-lg bg-muted/50 text-sm outline-none focus:ring-2 focus:ring-biosensor/40"
                />
                <Button type="submit" variant="hero" size="sm" disabled={sending || !draft.trim()}>
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>

      <p className="mt-4 text-xs text-muted-foreground text-center">
        Webhook entrante:{" "}
        <code className="font-mono bg-muted/50 px-1.5 py-0.5 rounded">
          /functions/v1/whatsapp-webhook
        </code>{" "}
        — configúralo en Meta WhatsApp Business →{" "}
        <Link to="/dashboard" className="text-biosensor hover:underline">
          Más info
        </Link>
      </p>
    </AppShell>
  );
}
