// El pago con PSE sale al banco y vuelve a /pago/exito sin el id del pago en la URL. /pagar lo guarda aquí antes de
// salir (solo en este navegador, sessionStorage) para que /pago/exito lo confirme con Mercado Pago al volver.
const KEY = "humanix:pago-pendiente";
const ID_RE = /^\d{1,20}$/;

export function savePendingPayment(id: string): void {
  try {
    if (ID_RE.test(id)) sessionStorage.setItem(KEY, id);
  } catch {
    // Sin almacenamiento (modo privado): el webhook igual activa el plan.
  }
}

export function readPendingPayment(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && ID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nada que limpiar
  }
}
