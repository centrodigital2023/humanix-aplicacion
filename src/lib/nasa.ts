// Helper cliente para llamar a la edge function nasa-proxy.
// Reutilizable desde PromoCards, Publicidad, /cosmos, etc.

import { supabase } from "@/integrations/supabase/client";

export type NasaApod = {
  kind: "apod";
  title: string;
  title_es: string | null;
  explanation: string;
  explanation_es: string | null;
  date: string;
  media_type: "image" | "video";
  url: string;
  hdurl?: string;
  thumbnail_url?: string;
  copyright?: string | null;
};

export type NasaEpic = {
  kind: "epic";
  caption: string;
  caption_es: string | null;
  date: string;
  url: string | null;
};

export type NasaMars = {
  kind: "mars";
  url: string | null;
  sol?: number;
  earth_date?: string;
  camera?: string;
  rover?: string;
};

export type NasaResource = NasaApod | NasaEpic | NasaMars;

export async function fetchNasa(
  endpoint: "apod" | "epic" | "mars",
  opts: { translate?: boolean; date?: string; sol?: string } = {},
): Promise<NasaResource> {
  const params = new URLSearchParams({ endpoint });
  if (opts.translate) params.set("translate", "true");
  if (opts.date) params.set("date", opts.date);
  if (opts.sol) params.set("sol", opts.sol);

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nasa-proxy?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });
  if (!res.ok) throw new Error(`NASA proxy: ${res.status}`);
  return (await res.json()) as NasaResource;
}

/** Devuelve una URL de imagen lista para usar como fondo (skips videos). */
export async function fetchNasaImage(
  endpoint: "apod" | "epic" | "mars" = "apod",
): Promise<{ url: string; credit: string } | null> {
  try {
    const data = await fetchNasa(endpoint);
    if (data.kind === "apod" && data.media_type === "image") {
      return {
        url: data.hdurl || data.url,
        credit: `NASA APOD${data.copyright ? ` © ${data.copyright}` : ""}`,
      };
    }
    if (data.kind === "epic" && data.url) {
      return { url: data.url, credit: "NASA EPIC / DSCOVR" };
    }
    if (data.kind === "mars" && data.url) {
      return { url: data.url, credit: `NASA · ${data.rover} (${data.camera})` };
    }
    return null;
  } catch (e) {
    console.warn("NASA fetch failed", e);
    return null;
  }
}

/** Genera una imagen cósmica de respaldo con Gemini cuando NASA no sirve. */
export async function generateCosmicImage(
  prompt = "Vista astronómica épica del cosmos: nebulosa colorida con estrellas brillantes, estilo NASA, fotografía espacial profesional",
  aspect: "1:1" | "16:9" | "9:16" = "1:1",
): Promise<{ url: string; credit: string } | null> {
  try {
    const { data, error } = await supabase.functions.invoke("promo-image-gen", {
      body: { prompt, aspect },
    });
    if (error) throw error;
    const img = (data as { image?: string })?.image;
    if (!img) return null;
    return { url: img, credit: "Generado por IA · inspirado en NASA" };
  } catch (e) {
    console.warn("Cosmic AI fallback failed", e);
    return null;
  }
}

/** Pide imagen NASA y, si falla o no aplica, genera una con IA estilo cósmico. */
export async function fetchNasaImageWithFallback(
  endpoint: "apod" | "epic" | "mars" = "apod",
  aspect: "1:1" | "16:9" | "9:16" = "1:1",
): Promise<{ url: string; credit: string; source: "nasa" | "ai" } | null> {
  const nasa = await fetchNasaImage(endpoint);
  if (nasa) return { ...nasa, source: "nasa" };
  const ai = await generateCosmicImage(undefined, aspect);
  if (ai) return { ...ai, source: "ai" };
  return null;
}

// Ensure supabase import is used (for future signed calls).
void supabase;