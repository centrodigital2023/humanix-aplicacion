import { FunctionsHttpError } from "@supabase/supabase-js";

/** Extrae el mensaje que devolvió la función Edge (`{ error }`) o usa el texto de respaldo. */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === "string" && body.error) return body.error;
    } catch {
      // sin cuerpo JSON
    }
  }
  return fallback;
}
