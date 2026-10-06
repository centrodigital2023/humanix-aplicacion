// embed-text — utilidad interna: dado un texto, devuelve un embedding 768-d
// determinístico (hash projection) sin depender del gateway externo.
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import { embedText } from "../_shared/embed.ts";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { text } = await req.json();
    if (typeof text !== "string" || !text.trim()) {
      return new Response(JSON.stringify({ error: "text requerido" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const embedding = embedText(text);
    return new Response(JSON.stringify({ embedding }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("embed-text error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
