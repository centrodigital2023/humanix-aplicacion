// Salir hacia la página del banco (PSE). PSE no se deja abrir dentro de un marco (iframe): si Humanix está dentro de
// uno (vista previa del editor, una app que la incrusta), cambiar la URL del marco muestra «registro.pse.com.co ha
// rechazado la conexión». Fuera de un marco se navega en la misma pestaña; dentro de uno la persona abre su banco en
// una pestaña nueva con un botón (un clic suyo: el navegador no lo bloquea, y saltar la ventana principal desde un
// marco de otro dominio sí suele bloquearse en silencio).

export interface FrameWindow {
  self: unknown;
  top: unknown;
  location: { assign: (url: string) => void };
}

/** `true` si la página está dentro de un marco. Si no se puede saber (acceso bloqueado), se asume que sí. */
export function isFramed(win: Pick<FrameWindow, "self" | "top">): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/**
 * Lleva a la página del banco. Devuelve `true` si ya salió (misma pestaña) y `false` si hace falta que la persona
 * toque «Abrir mi banco» (pestaña nueva).
 */
export function goToBank(url: string, win: FrameWindow): boolean {
  if (isFramed(win)) return false;
  win.location.assign(url);
  return true;
}
