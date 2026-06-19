// Chat ligero scoped a un service_booking. Reutiliza la tabla `messages`,
// pero como ésta vive bajo `conversations`, creamos una conversación "satélite"
// vinculada por id determinístico una vez que ambos participantes están definidos.
// Para simplicidad y para no inventar tablas nuevas, este componente usa
// directamente Realtime sobre `messages` filtrando por una conversación creada
// on-the-fly cuando aceptan el booking. Si todavía no existe, se muestra estado vacío.
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Msg = { id: string; sender_id: string; content: string; created_at: string };

export function BookingChat({
  conversationId,
  currentUserId,
  peerName,
}: {
  conversationId: string | null;
  currentUserId: string;
  peerName: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!cancelled) {
        setMessages((data ?? []) as Msg[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (p) => setMessages((prev) => [...prev, p.new as Msg]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !conversationId) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: text.trim(),
    });
    if (!error) setText("");
    setSending(false);
  };

  const grouped = useMemo(() => messages, [messages]);

  if (!conversationId) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        El chat se habilita en cuanto el profesional acepta el servicio.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card flex flex-col h-[420px]">
      <header className="px-4 py-3 border-b border-border">
        <p className="text-xs text-muted-foreground">Conversación con</p>
        <p className="font-semibold text-sm">{peerName}</p>
      </header>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center">
            Sé el primero en escribir un mensaje.
          </p>
        ) : (
          grouped.map((m) => {
            const mine = m.sender_id === currentUserId;
            return (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "ml-auto bg-foreground text-background"
                    : "mr-auto bg-muted text-foreground"
                }`}
              >
                {m.content}
                <span className="block text-[10px] opacity-60 mt-0.5">
                  {new Date(m.created_at).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={send} className="border-t border-border p-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje…"
          className="flex-1 bg-background border border-input rounded-xl px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-biosensor text-biosensor-foreground px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
