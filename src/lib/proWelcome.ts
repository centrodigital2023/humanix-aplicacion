// Bienvenida del profesional recién registrado: cuatro pasos cortos (foto, lo que haces, documentos, disponible).
// Se muestra al entrar hasta que la cierra o completa los pasos; desde el panel se vuelve a abrir con un botón.

export type ProWelcomeStepKey = "photo" | "work" | "docs" | "available";

export type ProWelcomeInput = {
  avatarUrl: string | null | undefined;
  specialty: string;
  cities: string;
  hourlyRate: number | "" | null | undefined;
  /** Tipos de documento subidos (no rechazados), como `docSummary` del panel. */
  docs: Record<string, boolean>;
  available: boolean;
};

export type ProWelcomeStep = { key: ProWelcomeStepKey; done: boolean };

/** Documentos que faltan para el paso «Tus documentos»: hoja de vida, cédula y RETHUS o diploma. */
export function missingWelcomeDocs(docs: Record<string, boolean>): string[] {
  const missing: string[] = [];
  if (!docs.id_document) missing.push("Cédula");
  if (!docs.rethus && !docs.diploma) missing.push("RETHUS o diploma");
  if (!docs.cv) missing.push("Hoja de vida");
  return missing;
}

export function proWelcomeSteps(input: ProWelcomeInput): ProWelcomeStep[] {
  const rate = input.hourlyRate === "" || input.hourlyRate == null ? 0 : Number(input.hourlyRate);
  return [
    { key: "photo", done: !!input.avatarUrl },
    {
      key: "work",
      done: input.specialty.trim().length > 0 && input.cities.trim().length > 0 && rate > 0,
    },
    { key: "docs", done: missingWelcomeDocs(input.docs).length === 0 },
    { key: "available", done: input.available },
  ];
}

export function shouldShowProWelcome(dismissed: boolean, steps: ProWelcomeStep[]): boolean {
  return !dismissed && steps.some((s) => !s.done);
}

export const proWelcomeStorageKey = (userId: string) => `hx_pro_welcome_${userId}`;

export function readWelcomeDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(proWelcomeStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function rememberWelcomeDismissed(userId: string): void {
  try {
    localStorage.setItem(proWelcomeStorageKey(userId), "1");
  } catch {
    /* almacenamiento bloqueado: la bienvenida vuelve a salir la próxima vez */
  }
}
