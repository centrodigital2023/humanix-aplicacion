// Mensajes de error para personas, no para programadores. Lógica pura y probada (`friendlyError.test.ts`).
//
// Antes, 131 avisos mostraban el texto crudo de la base o de la red («relation "x" does not exist», «new row violates row-level
// security policy», «Failed to fetch»). Aquí se traduce cada tipo de fallo a una frase cálida y útil. Los mensajes que ya escribimos para
// personas (las validaciones de la base en español, p. ej. «El profesional ya tiene un servicio en ese horario») pasan tal cual.

const DEFAULT = "Algo no salió como esperábamos. Inténtalo de nuevo en un momento.";

const MSG = {
  offline: "Parece que no hay conexión. Revisa tu internet e inténtalo de nuevo.",
  session: "Tu sesión se cerró. Vuelve a entrar para continuar.",
  forbidden: "No tienes permiso para hacer esto. Si crees que es un error, escríbenos.",
  duplicate: "Esto ya estaba registrado.",
  unavailable: "Esta función aún no está disponible. Ya estamos trabajando en ella.",
  invalid: "Revisa los datos: hay un valor que no tiene el formato correcto.",
  related: "Falta un dato relacionado. Recarga la página e inténtalo de nuevo.",
  tooBig: "El archivo es muy grande. Prueba con uno más liviano (máximo 10 MB).",
  fileType: "Ese tipo de archivo no está permitido. Usa PDF, JPG o PNG.",
  busy: "Hay mucha actividad en este momento. Espera unos segundos e inténtalo de nuevo.",
} as const;

// Señales de que un texto es técnico (no se debe mostrar a una persona).
const TECHNICAL =
  /relation |column |violates|constraint|syntax|schema|null value|duplicate key|permission denied|jwt|fetch|network|pgrst|\buuid\b|invalid input|typeerror|cannot read|row-level|timeout|econn|status code|edge function|non-2xx|undefined|unexpected token|\bsql\b|stack|function [a-z_]+\(|\b[a-z]+_[a-z_]+\(|->|https?:\/\/|\berror:/i;
// Palabras en inglés frecuentes en mensajes de librerías.
const ENGLISH = /\b(the|is|was|failed|could not|unable|not found|invalid|unknown|request|object|value|must be|please)\b/i;

function parts(err: unknown): { code: string; message: string; status: number | null } {
  if (typeof err === "string") return { code: "", message: err, status: null };
  if (typeof err !== "object" || err === null) return { code: "", message: "", status: null };
  const e = err as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  const status = Number(e.status ?? e.statusCode);
  return {
    code: typeof e.code === "string" ? e.code : "",
    message: typeof e.message === "string" ? e.message : "",
    status: Number.isFinite(status) ? status : null,
  };
}

/** ¿Es un mensaje escrito para personas? Corto, sin señales técnicas y en español. */
export function isHumanMessage(message: string): boolean {
  const m = message.trim();
  if (m.length < 6 || m.length > 220) return false;
  if (TECHNICAL.test(m) || ENGLISH.test(m)) return false;
  return /^[¡¿A-ZÁÉÍÓÚÑ0-9]/.test(m);
}

/**
 * Frase para mostrar a la persona a partir de cualquier error. `fallback` es lo que se quería decir si no hay nada más específico
 * (p. ej. «No se pudo guardar la fecha»).
 */
export function friendlyError(err: unknown, fallback: string = DEFAULT): string {
  const { code, message, status } = parts(err);
  const m = message.toLowerCase();

  if (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /failed to fetch|networkerror|network request failed|load failed|failed to send a request|err_internet|econnrefused|timeout|timed out/.test(m)
  )
    return MSG.offline;
  if (status === 401 || code === "PGRST301" || code === "PGRST303" || /jwt|token (is )?expired|invalid token|unauthorized|not authenticated|no autenticado/.test(m))
    return MSG.session;
  if (code === "42501" || status === 403 || /row-level security|permission denied|forbidden|no autorizado/.test(m))
    return MSG.forbidden;
  if (code === "23505" || /duplicate key|already exists|already registered/.test(m)) return MSG.duplicate;
  if (["PGRST205", "PGRST202", "42P01", "42883", "42703", "PGRST204"].includes(code) || /could not find the (table|function)|does not exist|bucket not found/.test(m))
    return MSG.unavailable;
  if (code === "23503") return MSG.related;
  if (code === "22P02" || code === "22007" || code === "22008" || code === "23502") return MSG.invalid;
  if (status === 413 || /payload too large|exceeded the maximum allowed size|file size/.test(m)) return MSG.tooBig;
  if (/mime type|invalid file type|not supported.*(type|format)/.test(m)) return MSG.fileType;
  if (status === 429 || /rate limit|too many requests/.test(m)) return MSG.busy;

  // Validaciones de la base o del servidor escritas en español para personas: se muestran tal cual.
  if (message && isHumanMessage(message)) return message.trim();
  return fallback;
}

/**
 * Errores de inicio de sesión y registro (Supabase Auth responde en inglés). Lo que no se reconoce cae a `friendlyError`.
 */
export function friendlyAuthError(err: unknown, fallback: string = DEFAULT): string {
  const { message } = parts(err);
  const m = message.toLowerCase();
  if (/invalid login credentials|invalid email or password/.test(m))
    return "El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.";
  if (/already (been )?registered|user already exists|email address is already/.test(m))
    return "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.";
  if (/email not confirmed/.test(m))
    return "Confirma tu correo: te enviamos un enlace. Revisa también la carpeta de spam.";
  const min = m.match(/password should be at least (\d+)/);
  if (min) return `La contraseña debe tener al menos ${min[1]} caracteres.`;
  if (/weak|pwned|known to be/.test(m) && /password/.test(m))
    return "Esa contraseña es fácil de adivinar. Prueba con una más larga, con números y símbolos.";
  if (/new password should be different/.test(m)) return "La nueva contraseña debe ser distinta a la anterior.";
  if (/token has expired|otp.*(expired|invalid)|invalid.*otp|token.*invalid/.test(m))
    return "El código venció o no es correcto. Pide uno nuevo.";
  if (/for security purposes|rate limit|too many/.test(m))
    return "Espera unos segundos antes de intentarlo otra vez.";
  if (/unable to validate email|invalid format|email.*invalid/.test(m)) return "Ese correo no parece válido. Revísalo.";
  if (/signups? not allowed|signup is disabled/.test(m))
    return "Por ahora no estamos aceptando registros nuevos. Escríbenos y te ayudamos.";
  return friendlyError(err, fallback);
}
