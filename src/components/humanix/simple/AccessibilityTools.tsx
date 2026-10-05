// Herramientas de accesibilidad cognitiva de la home:
//  - 🔊 "Escuchar esta pantalla": lee en voz alta el contenido visible (Web Speech API).
//  - "Lectura fácil": agranda texto y espaciado (clase .easy-read en <html>).
import { useCallback, useEffect, useState } from "react";
import { Volume2, Square, Type } from "lucide-react";

const EASY_READ_KEY = "humanix-easy-read";

export function useEasyRead() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(EASY_READ_KEY) === "1";
    } catch {
      /* ignore */
    }
    setOn(stored);
    document.documentElement.classList.toggle("easy-read", stored);
  }, []);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("easy-read", next);
      try {
        localStorage.setItem(EASY_READ_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { on, toggle };
}

export function EasyReadToggle() {
  const { on, toggle } = useEasyRead();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 ${
        on
          ? "border-trust bg-trust text-trust-foreground"
          : "border-border bg-card text-foreground hover:border-trust"
      }`}
    >
      <Type className="h-4 w-4" aria-hidden="true" />
      <span>Letra grande</span>
    </button>
  );
}

function pickSpanishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "es-CO") ??
    voices.find((v) => v.lang.startsWith("es-4") || v.lang === "es-MX" || v.lang === "es-US") ??
    voices.find((v) => v.lang.startsWith("es"))
  );
}

/** Lee el texto visible del elemento `targetId`, saltando lo marcado con data-no-read. */
export function ListenButton({ targetId }: { targetId: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const clone = root.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("[data-no-read], [aria-hidden='true'], script, style")
      .forEach((n) => n.remove());
    const text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-CO";
    utterance.rate = 0.92;
    const voice = pickSpanishVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [targetId]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={speaking ? stop : speak}
      aria-pressed={speaking}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 ${
        speaking
          ? "border-trust bg-trust text-trust-foreground"
          : "border-border bg-card text-foreground hover:border-trust"
      }`}
    >
      {speaking ? (
        <Square className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{speaking ? "Detener audio" : "Escuchar esta pantalla"}</span>
    </button>
  );
}
