// Bienvenida de la familia recién registrada: una página corta con dos botones grandes, que se muestra una sola vez.
// El panel la abre solo si la cuenta es nueva (creada hace menos de WELCOME_WINDOW_MS) y la persona todavía no la vio
// en este navegador. Una cuenta vieja que entra desde otro equipo no la vuelve a ver.
export const WELCOME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const welcomeSeenKey = (userId: string) => `humanix-family-welcome:${userId}`;

export function shouldShowFamilyWelcome({
  createdAt,
  now,
  seen,
}: {
  createdAt: string | null | undefined;
  now: number;
  seen: boolean;
}): boolean {
  if (seen || !createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= 0 && now - t < WELCOME_WINDOW_MS;
}

/** Lee la marca de «ya vio la bienvenida»; sin almacenamiento cuenta como vista, para no insistir en cada visita. */
export function readWelcomeSeen(storage: Pick<Storage, "getItem"> | null, userId: string): boolean {
  try {
    return storage ? storage.getItem(welcomeSeenKey(userId)) === "1" : true;
  } catch {
    return true;
  }
}

export function markWelcomeSeen(storage: Pick<Storage, "setItem"> | null, userId: string): void {
  try {
    storage?.setItem(welcomeSeenKey(userId), "1");
  } catch {
    /* sin almacenamiento: la bienvenida no se vuelve a abrir sola igual (ver readWelcomeSeen) */
  }
}

/** Qué falta del perfil, en tres pasos cortos. */
export function welcomeSteps(profile: {
  idNumber?: string | null;
  address?: string | null;
  emergencyPhone?: string | null;
}): { key: "identity" | "address" | "emergency"; label: string; done: boolean }[] {
  return [
    { key: "identity", label: "Tu cédula", done: !!profile.idNumber?.trim() },
    { key: "address", label: "Dirección", done: !!profile.address?.trim() },
    { key: "emergency", label: "Contacto de emergencia", done: !!profile.emergencyPhone?.trim() },
  ];
}

/** `localStorage` del navegador, o null si no existe o está bloqueado (modo privado, permisos). */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
