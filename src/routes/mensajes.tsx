import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, MessageSquare, LayoutDashboard, Search, Inbox, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { ChatRoom } from "@/components/humanix/ChatRoom";
import { useAppUser, pathForRole } from "@/hooks/use-app-user";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/mensajes")({
  validateSearch: (search: Record<string, unknown>): { c?: string } => ({
    c: typeof search.c === "string" ? search.c : undefined,
  }),
  head: () => ({
    meta: [{ title: "Mensajes · Humanix" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: MensajesPage,
});

type ConversationRow = {
  id: string;
  application_id: string | null;
  poster_id: string;
  professional_id: string;
  last_message_at: string;
  created_at: string;
};

type OtherProfile = { user_id: string; full_name: string | null; avatar_url: string | null };
type LastMsg = { conversation_id: string; content: string; created_at: string };
type OfferLite = { id: string; title: string };

function MensajesPage() {
  const { user, loading, logout } = useAppUser();
  const { c: requestedConvId } = Route.useSearch();
  const [convs, setConvs] = useState<ConversationRow[]>([]);
  const [others, setOthers] = useState<Record<string, OtherProfile>>({});
  const [lastMsgs, setLastMsgs] = useState<Record<string, LastMsg>>({});
  const [offers, setOffers] = useState<Record<string, OfferLite>>({});
  const [activeId, setActiveId] = useState<string | null>(requestedConvId ?? null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data: convData } = await supabase
        .from("conversations")
        .select("id, application_id, poster_id, professional_id, last_message_at, created_at")
        .or(`poster_id.eq.${user.id},professional_id.eq.${user.id}`)
        .order("last_message_at", { ascending: false });
      const list = (convData ?? []) as ConversationRow[];
      if (!active) return;
      setConvs(list);
      if (list.length > 0) {
        setActiveId((curr) => {
          if (curr && list.some((c) => c.id === curr)) return curr;
          if (requestedConvId && list.some((c) => c.id === requestedConvId)) return requestedConvId;
          return list[0].id;
        });
      }

      // Otros participantes
      const otherIds = Array.from(
        new Set(list.map((c) => (c.poster_id === user.id ? c.professional_id : c.poster_id))),
      );
      if (otherIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .in("user_id", otherIds);
        if (active && profs) {
          const map: Record<string, OtherProfile> = {};
          for (const p of profs) map[p.user_id] = p as OtherProfile;
          setOthers(map);
        }
      }

      // Últimos mensajes (uno por conv)
      if (list.length > 0) {
        const ids = list.map((c) => c.id);
        const { data: msgRows } = await supabase
          .from("messages")
          .select("conversation_id, content, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false });
        if (active && msgRows) {
          const map: Record<string, LastMsg> = {};
          for (const m of msgRows as LastMsg[]) {
            if (!map[m.conversation_id]) map[m.conversation_id] = m;
          }
          setLastMsgs(map);
        }

        const appIds = list.map((c) => c.application_id).filter((id): id is string => !!id);
        if (appIds.length > 0) {
          const { data: apps } = await supabase
            .from("applications")
            .select("id, job_offer_id")
            .in("id", appIds);
          const offerIds = (apps ?? []).map((a) => a.job_offer_id);
          if (offerIds.length > 0) {
            const { data: offerRows } = await supabase
              .from("job_offers")
              .select("id, title")
              .in("id", offerIds);
            const appToOffer = new Map((apps ?? []).map((a) => [a.id, a.job_offer_id]));
            const offerById = new Map((offerRows ?? []).map((o) => [o.id, o as OfferLite]));
            const final: Record<string, OfferLite> = {};
            for (const c of list) {
              if (!c.application_id) continue;
              const oid = appToOffer.get(c.application_id);
              if (oid) {
                const off = offerById.get(oid);
                if (off) final[c.id] = off;
              }
            }
            if (active) setOffers(final);
          }
        }
      }
      setDataLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Realtime: escuchar nuevos mensajes para reordenar la lista
  useEffect(() => {
    if (!user || convs.length === 0) return;
    const ids = convs.map((c) => c.id);
    const channel = supabase
      .channel(`inbox-messages-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as LastMsg;
          if (!ids.includes(m.conversation_id)) return;
          setLastMsgs((prev) => ({ ...prev, [m.conversation_id]: m }));
          setConvs((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;
            const updated = [...prev];
            const [moved] = updated.splice(idx, 1);
            return [{ ...moved, last_message_at: m.created_at }, ...updated];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, convs.length]);

  const NAV: NavItem[] = useMemo(() => {
    if (!user) return [];
    return [
      { label: "Mi panel", to: pathForRole(user.primaryRole), icon: LayoutDashboard },
      { label: "Mensajes", to: "/mensajes", icon: MessageSquare },
      { label: "Buscar", to: "/buscar", icon: Search },
    ];
  }, [user]);

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
      title="Mensajes"
      subtitle="Conversaciones con tus contrapartes y copiloto IA para responder mejor."
      crumbs={[{ label: "Inicio", to: "/" }, { label: "Mensajes" }]}
      badge={{ label: "Realtime", tone: "fuchsia" }}
    >
      {dataLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando conversaciones…
        </Card>
      ) : convs.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Aún no tienes conversaciones</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Cuando aceptes una aplicación o tu aplicación sea aceptada, abriremos un chat aquí con
            copiloto IA para sugerirte respuestas.
          </p>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          {/* Lista */}
          <aside className="rounded-2xl border border-border bg-card overflow-hidden">
            <ul className="divide-y divide-border max-h-[70vh] overflow-y-auto">
              {convs.map((c) => {
                const otherId = c.poster_id === user.id ? c.professional_id : c.poster_id;
                const other = others[otherId];
                const last = lastMsgs[c.id];
                const offer = offers[c.id];
                const isActive = c.id === activeId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      className={`w-full text-left p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors ${
                        isActive ? "bg-muted/60" : ""
                      }`}
                    >
                      <div className="h-10 w-10 rounded-full bg-muted overflow-hidden shrink-0">
                        {other?.avatar_url && (
                          <img
                            src={other.avatar_url}
                            alt={other.full_name ?? ""}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium truncate">{other?.full_name ?? "Usuario"}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {new Date(c.last_message_at).toLocaleDateString("es-CO", {
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                        </div>
                        {offer && (
                          <p className="text-[11px] text-biosensor truncate">{offer.title}</p>
                        )}
                        <p className="text-xs text-muted-foreground truncate">
                          {last?.content ?? "Sin mensajes aún"}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Chat */}
          <section>
            {activeId ? (
              <>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-fuchsia-neural" />
                  Pulsa <span className="font-semibold text-foreground">IA</span> para que el
                  copiloto sugiera respuestas adaptadas a la conversación.
                </div>
                <ChatRoom conversationId={activeId} currentUserId={user.id} />
              </>
            ) : (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                Selecciona una conversación.
              </Card>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
