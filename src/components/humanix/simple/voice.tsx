// Guía por voz para personas que no leen o leen con dificultad.
// Con el "Modo voz" activo, cada pantalla dice su pregunta en voz alta y
// cada toque confirma lo elegido ("Adulto mayor"). Usa la voz del teléfono
// (Web Speech API), sin servidores ni costos.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const VOICE_KEY = "humanix-voice";

type VoiceCtx = {
  supported: boolean;
  on: boolean;
  toggle: () => void;
  /** Habla solo si el modo voz está activo. `queue` espera a que termine lo anterior. */
  say: (text: string, queue?: boolean) => void;
};

const Ctx = createContext<VoiceCtx>({
  supported: false,
  on: false,
  toggle: () => {},
  say: () => {},
});

function pickSpanishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "es-CO") ??
    voices.find((v) => v.lang === "es-US" || v.lang === "es-MX" || v.lang.startsWith("es-4")) ??
    voices.find((v) => v.lang.startsWith("es"))
  );
}

function speak(text: string, queue = false) {
  if (!queue) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-CO";
  u.rate = 0.9;
  const v = pickSpanishVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const ok = "speechSynthesis" in window;
    setSupported(ok);
    if (!ok) return;
    try {
      setOn(localStorage.getItem(VOICE_KEY) === "1");
    } catch {
      /* ignore */
    }
    // Algunas plataformas cargan las voces de forma asíncrona.
    window.speechSynthesis.getVoices();
    return () => window.speechSynthesis.cancel();
  }, []);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(VOICE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) speak("Voz activada. Toca una imagen para elegir.");
      else window.speechSynthesis.cancel();
      return next;
    });
  }, []);

  const say = useCallback(
    (text: string, queue = false) => {
      if (on && supported) speak(text, queue);
    },
    [on, supported],
  );

  const value = useMemo(() => ({ supported, on, toggle, say }), [supported, on, toggle, say]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVoice() {
  return useContext(Ctx);
}

/** Dice `text` cada vez que cambia (p. ej. la pregunta de cada paso). */
// eslint-disable-next-line react-refresh/only-export-components
export function useSpeakOnChange(text: string) {
  const { say, on } = useVoice();
  useEffect(() => {
    if (text) say(text, true);
    // Solo al cambiar el texto o al activar el modo voz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, on]);
}
