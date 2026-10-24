// Sonido, vibración y aviso del sistema para las alertas en vivo, sin archivos de audio.
// Todo es "mejor esfuerzo": si el navegador lo bloquea (sin interacción previa, sin permiso), no pasa nada.
import type { LiveAlertTone } from "@/lib/serviceFlow";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Los navegadores solo dejan sonar audio después de un toque. Se "despierta" el contexto en el primer
 * gesto de la persona, así la siguiente alerta ya suena aunque llegue sin tocar nada.
 */
export function primeAlertSound() {
  if (typeof window === "undefined") return;
  const wake = () => {
    try {
      void audio()?.resume();
    } catch {
      /* sin audio */
    }
  };
  window.addEventListener("pointerdown", wake, { once: true, passive: true });
  window.addEventListener("keydown", wake, { once: true });
}

const PATTERNS: Record<LiveAlertTone, number[]> = {
  request: [880, 1175, 880, 1175],
  alert: [988, 740, 988, 740],
  good: [659, 988],
  info: [784],
};

export function playAlertSound(tone: LiveAlertTone) {
  try {
    const ac = audio();
    if (!ac) return;
    void ac.resume();
    const start = ac.currentTime + 0.02;
    PATTERNS[tone].forEach((freq, i) => {
      const t = start + i * 0.18;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  } catch {
    /* sin audio */
  }
  try {
    if (tone === "request" || tone === "alert") navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* sin vibración */
  }
}

/** Aviso del sistema operativo cuando la pestaña no está a la vista (solo si la persona ya dio permiso). */
export function showSystemNotification(title: string, body: string, link: string | null) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: link ?? title });
    n.onclick = () => {
      window.focus();
      if (link) window.location.assign(link);
      n.close();
    };
  } catch {
    /* sin notificaciones del sistema */
  }
}

export function canAskSystemNotifications(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "default";
}

export async function askSystemNotifications(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
