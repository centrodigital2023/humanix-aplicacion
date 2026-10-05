// Botones de accesibilidad: 🔊 Voz (guía hablada) y Aa (letra grande).
import { useCallback, useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useVoice } from "./voice";

const EASY_READ_KEY = "humanix-easy-read";

const pill =
  "inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2";
const pillOn = "border-trust bg-trust text-trust-foreground shadow-md";
const pillOff = "border-border bg-card text-foreground hover:border-trust";

export function VoiceToggle() {
  const { supported, on, toggle } = useVoice();
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`${pill} ${on ? pillOn : pillOff}`}
    >
      {on ? (
        <Volume2 className="h-5 w-5" aria-hidden="true" />
      ) : (
        <VolumeX className="h-5 w-5" aria-hidden="true" />
      )}
      Voz
    </button>
  );
}

export function EasyReadToggle() {
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

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label="Letra grande"
      className={`${pill} ${on ? pillOn : pillOff}`}
    >
      <span aria-hidden="true" className="font-display text-lg leading-none">
        A<span className="text-2xl">A</span>
      </span>
      Grande
    </button>
  );
}
