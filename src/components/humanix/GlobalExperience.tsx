// Coherencia en todo el sitio:
//  - "Letra grande" (elegida en la home) se mantiene en todas las páginas.
//  - Al volver de Mercado Pago (?mp=success|pending|failure) se muestra un
//    aviso claro y se limpia la URL.
import { useEffect } from "react";

export function GlobalExperience() {
  useEffect(() => {
    try {
      document.documentElement.classList.toggle(
        "easy-read",
        localStorage.getItem("humanix-easy-read") === "1",
      );
    } catch {
      /* ignore */
    }

  }, []);
  return null;
}
