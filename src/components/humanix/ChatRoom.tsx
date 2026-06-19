import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_ai_suggestion: boolean;
  created_at: string;
};

export function ChatRoom({
  conversationId,
  currentUserId,
}: {
  conversationId: string;
  currentUserId: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (!cancelled) setMsgs((data ?? []) as Msg[]);
    })();
    const ch = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => setMsgs((prev) => [...prev, payload.new as Msg]),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [conversationId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = async (content?: string) => {
    const body = (content ?? text).trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { error } = await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, sender_id: currentUserId, content: body });
      if (error) throw error;
      setText("");
      setSuggestions([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  const askCopilot = async () => {
    setLoadingSug(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-copilot", {
        body: { conversation_id: conversationId },
      });
      if (error) throw error;
      setSuggestions((data?.suggestions ?? []) as string[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error copiloto");
    } finally {
      setLoadingSug(false);
    }
  };

  return (
    <div className="flex flex-col h-[60vh] rounded-2xl border border-border bg-card overflow-hidden">
      <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {msgs.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-8">
            Aún no hay mensajes. Saluda y coordinen el primer encuentro.
          </p>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.sender_id === currentUserId ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.sender_id === currentUserId
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="border-t border-border bg-biosensor/5 p-2 flex gap-2 overflow-x-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => send(s)}
              className="text-xs whitespace-nowrap px-3 py-1.5 rounded-full bg-background border border-biosensor/30 hover:bg-biosensor/10"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-border p-2 flex gap-2"
      >
        <Button type="button" variant="glass" size="sm" onClick={askCopilot} disabled={loadingSug}>
          {loadingSug ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          IA
        </Button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje…"
          className="flex-1 rounded-lg bg-background border border-input px-3 py-2 text-sm outline-none"
          disabled={sending}
        />
        <Button type="submit" size="sm" disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
