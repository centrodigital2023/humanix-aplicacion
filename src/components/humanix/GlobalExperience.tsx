// Coherencia en todo el sitio:
//  - "Letra grande" (elegida en la home) se mantiene en todas las páginas.
//  - Al volver de Mercado Pago (?mp=success|pending|failure) se muestra un
//    aviso claro y se limpia la URL.
import { useEffect } from "react";
import { toast } from "sonner";

const MP_MESSAGES: Record<string, { kind: "success" | "info" | "error"; text: string }> = {
  success: { kind: "success", text: "✅ Pago aprobado. Tu plan ya está activo." },
  pending: { kind: "info", text: "⏳ Pago en proceso. Te avisamos al confirmarse." },
  failure: { kind: "error", text: "❌ El pago no se completó. No se te cobró nada." },
};

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

    const url = new URL(window.location.href);
    const mp = url.searchParams.get("mp");
    const msg = mp ? MP_MESSAGES[mp] : undefined;
    if (msg) {
      toast[msg.kind](msg.text, { duration: 8000 });
      url.searchParams.delete("mp");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, []);
  return null;
}
