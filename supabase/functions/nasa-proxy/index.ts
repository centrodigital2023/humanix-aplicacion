// nasa-proxy — proxy unificado a la API pública de NASA + enriquecimiento con IA.
// Endpoints soportados (parámetro `endpoint`):
//   - "apod"        → Astronomy Picture of the Day (acepta `date`)
//   - "epic"        → Última imagen EPIC de la Tierra
//   - "mars"        → Foto random Curiosity (acepta `sol`)
// Si se pasa `translate=true` se traduce/explica al español neutro colombiano con Lovable AI.
// Es público para lectura simple; la traducción con IA requiere JWT.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

async function translateEs(text: string): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key || !text) return text;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "Traduce al español neutro colombiano de forma clara y cercana. Conserva términos científicos. Devuelve SOLO el texto traducido, sin comillas ni preámbulo.",
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!r.ok) return text;
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const endpoint = (url.searchParams.get("endpoint") || "apod").toLowerCase();
    const translate = url.searchParams.get("translate") === "true";
    const NASA_API_KEY = (Deno.env.get("NASA_API_KEY") || "DEMO_KEY").trim();

    if (translate) {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;
    }

    let upstream: string;
    if (endpoint === "apod") {
      const date = url.searchParams.get("date");
      const params = new URLSearchParams({ api_key: NASA_API_KEY, thumbs: "true" });
      if (date) params.set("date", date);
      upstream = `https://api.nasa.gov/planetary/apod?${params}`;
    } else if (endpoint === "epic") {
      upstream = `https://api.nasa.gov/EPIC/api/natural?api_key=${NASA_API_KEY}`;
    } else if (endpoint === "mars") {
      const sol = url.searchParams.get("sol") || String(Math.floor(Math.random() * 3000) + 100);
      upstream = `https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos?sol=${sol}&api_key=${NASA_API_KEY}`;
    } else {
      return new Response(JSON.stringify({ error: "endpoint no soportado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch(upstream);
    if (!r.ok) {
      const t = await r.text();
      console.error("NASA upstream error", r.status, t.slice(0, 200));
      return new Response(JSON.stringify({ error: `NASA API: ${r.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();

    // Normalizamos a una forma simple para los consumidores.
    let normalized: Record<string, unknown> = {};
    if (endpoint === "apod") {
      normalized = {
        kind: "apod",
        title: data.title,
        title_es: translate ? await translateEs(data.title || "") : null,
        explanation: data.explanation,
        explanation_es: translate ? await translateEs(data.explanation || "") : null,
        date: data.date,
        media_type: data.media_type,
        url: data.url,
        hdurl: data.hdurl,
        thumbnail_url: data.thumbnail_url,
        copyright: data.copyright || null,
      };
    } else if (endpoint === "epic") {
      const first = Array.isArray(data) ? data[0] : null;
      const img = first?.image
        ? (() => {
            const d = first.date.split(" ")[0].split("-");
            return `https://api.nasa.gov/EPIC/archive/natural/${d[0]}/${d[1]}/${d[2]}/png/${first.image}.png?api_key=${NASA_API_KEY}`;
          })()
        : null;
      normalized = {
        kind: "epic",
        caption: first?.caption,
        caption_es: translate ? await translateEs(first?.caption || "") : null,
        date: first?.date,
        url: img,
      };
    } else if (endpoint === "mars") {
      const photos = data.photos || [];
      const pick = photos[Math.floor(Math.random() * Math.max(photos.length, 1))] || null;
      normalized = {
        kind: "mars",
        url: pick?.img_src || null,
        sol: pick?.sol,
        earth_date: pick?.earth_date,
        camera: pick?.camera?.full_name,
        rover: pick?.rover?.name,
      };
    }

    return new Response(JSON.stringify(normalized), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Auth-gated translated responses must never hit a shared cache.
        "Cache-Control": translate ? "private, no-store" : "public, max-age=1800",
      },
    });
  } catch (e) {
    console.error("nasa-proxy error", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});