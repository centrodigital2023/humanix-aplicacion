// El pago con PSE sale al banco y vuelve a /pago/exito sin el id del pago en la URL. /pagar lo guarda aquí antes de
// salir para que /pago/exito lo confirme con Mercado Pago al volver. En localStorage (no sessionStorage): el banco
// puede abrirse en otra pestaña y volver en ella. Vence a las 2 horas.
const KEY = "humanix:pago-pendiente";
const ID_RE = /^\d{1,20}$/;
const TTL_MS = 2 * 60 * 60 * 1000;

export function savePendingPayment(id: string, now = Date.now()): void {
  try {
    if (ID_RE.test(id)) localStorage.setItem(KEY, JSON.stringify({ id, at: now }));
  } catch {
    // Sin almacenamiento (modo privado): el webhook igual activa el plan.
  }
}

export function readPendingPayment(now = Date.now()): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      id?: unknown;
      at?: unknown;
    } | null;
    const id = typeof raw?.id === "string" ? raw.id : "";
    const at = typeof raw?.at === "number" ? raw.at : 0;
    return ID_RE.test(id) && now - at < TTL_MS ? id : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada que limpiar
  }
}
