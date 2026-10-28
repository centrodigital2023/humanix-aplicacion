// Baja a una sección del panel; si está dentro de un bloque plegable («Más herramientas», «Mis datos»), lo abre antes.
// Los plegables del panel de familia montan su contenido al abrirse: si la sección todavía no existe, se abre el
// plegable que la anuncia en `data-anchors` y se espera a que pinte. El desplazamiento descuenta la cabecera fija
// (en móvil mide más de 150 px y tapaba el título de la sección).
const RETRIES = 12;
const RETRY_MS = 50;

function headerOffset(): number {
  const header = document.querySelector("header.sticky");
  return header ? header.getBoundingClientRect().height + 12 : 12;
}

function scrollToElement(el: Element): void {
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

export function scrollToId(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) return scrollToElement(el);

  const fold = document.querySelector<HTMLDetailsElement>(
    `details[data-anchors~="${CSS.escape(id)}"]`,
  );
  if (!fold) return;
  fold.open = true;
  let tries = 0;
  const wait = () => {
    const target = document.getElementById(id);
    if (target) return scrollToElement(target);
    if (++tries < RETRIES) return void setTimeout(wait, RETRY_MS);
    scrollToElement(fold);
  };
  setTimeout(wait, 0);
}
