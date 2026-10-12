// Baja a una sección del panel; si está dentro de un bloque plegable («Más herramientas», «Mi perfil»), lo abre antes.
export function scrollToId(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
