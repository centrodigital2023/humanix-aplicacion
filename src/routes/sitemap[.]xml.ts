// Dynamic sitemap index: static public routes + open job offers + active
// verified professional profiles. Served at `/sitemap.xml`. Cached 30 minutes
// at CDN to reduce database load.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SITE_URL } from "@/lib/seo";

type StaticEntry = {
  path: string;
  priority: number;
  changefreq: "daily" | "weekly" | "monthly";
};

const STATIC_ROUTES: StaticEntry[] = [
  { path: "/", priority: 1.0, changefreq: "daily" },
  { path: "/buscar", priority: 0.95, changefreq: "daily" },
  { path: "/profesionales", priority: 0.9, changefreq: "daily" },
  { path: "/familias", priority: 0.88, changefreq: "weekly" },
  { path: "/talento-humano", priority: 0.88, changefreq: "weekly" },
  { path: "/planes", priority: 0.85, changefreq: "weekly" },
  { path: "/calculadora", priority: 0.9, changefreq: "monthly" },
  { path: "/verificar", priority: 0.92, changefreq: "daily" },
  // Specialty landings
  { path: "/enfermeria-domiciliaria", priority: 0.9, changefreq: "weekly" },
  { path: "/cuidado-adulto-mayor", priority: 0.9, changefreq: "weekly" },
  { path: "/cuidado-postoperatorio", priority: 0.88, changefreq: "weekly" },
  { path: "/cuidado-pediatrico", priority: 0.85, changefreq: "weekly" },
  { path: "/cuidado-paliativo", priority: 0.82, changefreq: "weekly" },
  { path: "/cuidador-domicilio", priority: 0.85, changefreq: "weekly" },
  { path: "/auxiliar-enfermeria", priority: 0.82, changefreq: "weekly" },
  // City landings
  { path: "/enfermeria-bogota", priority: 0.9, changefreq: "weekly" },
  { path: "/enfermeria-medellin", priority: 0.88, changefreq: "weekly" },
  { path: "/enfermeria-cali", priority: 0.86, changefreq: "weekly" },
  { path: "/enfermeria-barranquilla", priority: 0.84, changefreq: "weekly" },
  { path: "/enfermeria-cartagena", priority: 0.82, changefreq: "weekly" },
  { path: "/enfermeria-bucaramanga", priority: 0.8, changefreq: "weekly" },
  { path: "/enfermeria-pereira", priority: 0.78, changefreq: "weekly" },
  // Resources hub + articles
  { path: "/recursos", priority: 0.85, changefreq: "weekly" },
  { path: "/recursos/cuanto-cuesta-enfermera-domicilio", priority: 0.78, changefreq: "monthly" },
  { path: "/recursos/como-verificar-rethus", priority: 0.78, changefreq: "monthly" },
  { path: "/recursos/cuidado-adulto-mayor-guia", priority: 0.78, changefreq: "monthly" },
  { path: "/recursos/postoperatorio-en-casa", priority: 0.78, changefreq: "monthly" },
  { path: "/recursos/signos-alarma-paciente-cronico", priority: 0.78, changefreq: "monthly" },
  { path: "/recursos/contratar-cuidador-confianza", priority: 0.78, changefreq: "monthly" },
  { path: "/tecnologia", priority: 0.8, changefreq: "weekly" },
  { path: "/sobre", priority: 0.8, changefreq: "weekly" },
  { path: "/carreras", priority: 0.78, changefreq: "weekly" },
  { path: "/contacto", priority: 0.8, changefreq: "weekly" },
  { path: "/prensa", priority: 0.75, changefreq: "weekly" },
  { path: "/cosmos", priority: 0.6, changefreq: "daily" },
  { path: "/terminos", priority: 0.65, changefreq: "monthly" },
  { path: "/privacidad", priority: 0.65, changefreq: "monthly" },
  { path: "/habeas-data", priority: 0.62, changefreq: "monthly" },
  { path: "/cumplimiento", priority: 0.62, changefreq: "monthly" },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(
  loc: string,
  lastmod?: string,
  changefreq?: string,
  priority?: number,
  hreflang = false,
): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  const changefreqTag = changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : "";
  const priorityTag = priority != null ? `\n    <priority>${priority.toFixed(2)}</priority>` : "";
  const hreflangTags = hreflang
    ? `\n    <xhtml:link rel="alternate" hreflang="es-CO" href="${escapeXml(loc)}"/>` +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}"/>`
    : "";
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}${changefreqTag}${priorityTag}${hreflangTags}\n  </url>`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const urls: string[] = [];

        // 1) Static pages
        for (const r of STATIC_ROUTES) {
          urls.push(
            urlEntry(
              r.path === "/" ? `${SITE_URL}/` : `${SITE_URL}${r.path}`,
              today,
              r.changefreq,
              r.priority,
              r.path === "/",
            ),
          );
        }

        // 2) Active verified professional profiles
        try {
          const { data: pros } = await supabaseAdmin
            .from("professional_profiles")
            .select("user_id, updated_at, active, verified")
            .eq("active", true)
            .eq("verified", true)
            .limit(5000);
          for (const p of pros ?? []) {
            const lastmod = (p.updated_at ?? today).toString().slice(0, 10);
            urls.push(urlEntry(`${SITE_URL}/profesional/${p.user_id}`, lastmod, "weekly", 0.7));
          }
        } catch (err) {
          // Non-fatal: keep serving static + offers even if profiles fail.
          console.error("sitemap: failed to fetch professionals", err);
        }

        // 3) Open job offers (non-blocked)
        try {
          const { data: offers } = await supabaseAdmin
            .from("job_offers")
            .select("id, updated_at, status, blocked")
            .eq("status", "open")
            .eq("blocked", false)
            .limit(5000);
          for (const o of offers ?? []) {
            const lastmod = (o.updated_at ?? today).toString().slice(0, 10);
            urls.push(urlEntry(`${SITE_URL}/oferta/${o.id}`, lastmod, "daily", 0.75));
          }
        } catch (err) {
          console.error("sitemap: failed to fetch offers", err);
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=3600",
          },
        });
      },
    },
  },
});
