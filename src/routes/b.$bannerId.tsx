// Página puente pública para compartir banners en redes sociales.
// Lee el banner desde Supabase (RLS público), emite OG tags dinámicas
// (título, descripción, imagen y URL canónica) y redirige al usuario
// real al CTA del banner. Los crawlers de Facebook/LinkedIn/X leen las
// OG tags antes de seguir la redirección, mostrando el preview correcto.
import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE_URL } from "@/lib/seo";

type BannerShare = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  active: boolean;
};

function normalizeHref(raw: string | null | undefined): string {
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "#") return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z]+:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

function absoluteImage(raw: string | null | undefined): string {
  if (!raw) return SOCIAL_IMAGE_URL;
  const t = raw.trim();
  if (!t) return SOCIAL_IMAGE_URL;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("/")) return `${SITE_URL}${t}`;
  return SOCIAL_IMAGE_URL;
}

export const Route = createFileRoute("/b/$bannerId")({
  loader: async ({ params }) => {
    const { data } = await supabase
      .from("ad_banners")
      .select("id,title,description,image_url,link_url,active")
      .eq("id", params.bannerId)
      .maybeSingle();
    return { banner: (data ?? null) as BannerShare | null };
  },
  head: ({ params, loaderData }) => {
    const b = loaderData?.banner;
    const canonical = `${SITE_URL}/b/${params.bannerId}`;
    const title = b ? `${b.title} · ${SITE_NAME}` : `${SITE_NAME}`;
    const description =
      b?.description?.trim() ||
      "Talento humano en salud verificado con IA en Colombia.";
    const image = absoluteImage(b?.image_url);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        {
          name: "robots",
          content: "index,follow,max-image-preview:large,max-snippet:-1",
        },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: SITE_NAME },
        { property: "og:url", content: canonical },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: b?.title ?? SITE_NAME },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: BannerSharePage,
});

function BannerSharePage() {
  const { banner } = Route.useLoaderData();
  const target = normalizeHref(banner?.link_url) || "/";

  // Registrar el clic ANTES de redirigir y luego enviar al destino real.
  // Los crawlers de redes sociales no ejecutan JS, así que solo leen las
  // OG tags y no disparan ni el tracking ni la redirección.
  useEffect(() => {
    if (!banner) return;
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      window.location.replace(target);
    };
    // Best-effort: esperamos como máximo 800 ms al RPC para no bloquear
    // al usuario si el backend está lento. Si el RPC termina antes,
    // redirigimos inmediatamente.
    const safety = window.setTimeout(go, 800);
    (async () => {
      try {
        const { error } = await supabase.rpc("ad_track", {
          _id: banner.id,
          _kind: "click",
        });
        if (error) console.warn("ad_track click failed", error.message);
      } catch (e) {
        console.warn("ad_track click error", e);
      } finally {
        window.clearTimeout(safety);
        go();
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, [banner, target]);

  if (!banner) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold mb-2">Banner no disponible</h1>
          <p className="text-sm text-muted-foreground mb-4">
            El enlace que abriste ya no está activo.
          </p>
          <Link to="/" className="text-biosensor hover:underline text-sm">
            Ir al inicio de Humanix
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="text-center max-w-lg">
        {banner.image_url && (
          <img
            src={banner.image_url}
            alt={banner.title}
            className="mx-auto mb-6 rounded-lg shadow-lg max-h-72 w-auto object-cover"
            loading="eager"
          />
        )}
        <h1 className="text-2xl font-bold mb-3">{banner.title}</h1>
        {banner.description && (
          <p className="text-muted-foreground mb-6">{banner.description}</p>
        )}
        <a
          href={target}
          className="inline-flex items-center justify-center rounded-md bg-biosensor text-biosensor-foreground px-6 py-3 font-semibold hover:opacity-90 transition"
        >
          Continuar →
        </a>
        <p className="mt-4 text-xs text-muted-foreground">Redirigiendo…</p>
      </div>
    </div>
  );
}
