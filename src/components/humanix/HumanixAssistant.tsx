import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };

export function HumanixAssistant({
  persona = "default",
  greeting = "¡Hola! Soy Humanix Assistant. ¿En qué te ayudo?",
}: {
  persona?: "professional" | "family" | "institution" | "default";
  greeting?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: greeting }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);

    let accum = "";
    const upsert = (chunk: string) => {
      accum += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content !== greeting) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: accum } : m));
        }
        return [...prev, { role: "assistant", content: accum }];
      });
    };

    try {
      abortRef.current = new AbortController();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/humanix-assistant`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          persona,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: abortRef.current.signal,
      });

      if (resp.status === 429) {
        upsert("⏳ Demasiadas solicitudes. Intenta en un minuto.");
        return;
      }
      if (resp.status === 402) {
        upsert("💳 Créditos IA agotados. Contacta soporte.");
        return;
      }
      if (!resp.ok || !resp.body) {
        upsert("❌ No pude conectarme al asistente.");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) upsert(c);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        upsert("❌ Error: " + (e instanceof Error ? e.message : "desconocido"));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir asistente Humanix"
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-biosensor to-fuchsia-neural text-background shadow-[var(--shadow-elegant)] flex items-center justify-center hover:scale-105 transition"
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,70vh)] rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)] flex flex-col overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
            <Sparkles className="h-4 w-4 text-biosensor" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Humanix Assistant</p>
              <p className="text-[10px] text-muted-foreground">
                IA conversacional · respuestas en vivo
              </p>
            </div>
          </header>

          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-muted/50 text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&>*]:my-1">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Pensando...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="p-3 border-t border-border flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              className="flex-1 rounded-lg bg-background border border-input px-3 py-2 text-sm outline-none focus:border-foreground/40"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-9 w-9 rounded-lg bg-foreground text-background inline-flex items-center justify-center disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
