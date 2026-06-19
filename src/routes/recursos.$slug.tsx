import { createFileRoute, notFound } from "@tanstack/react-router";
import { Article } from "@/components/humanix/Article";
import { buildSeo, SITE_URL } from "@/lib/seo";
import { articleLd } from "@/lib/seo-landing";
import { ARTICLES } from "@/content/recursos";

export const Route = createFileRoute("/recursos/$slug")({
  loader: ({ params }) => {
    const article = ARTICLES[params.slug];
    if (!article) throw notFound();
    return { article };
  },
  head: ({ loaderData, params }) => {
    const article = loaderData?.article;
    if (!article) {
      return buildSeo({
        title: "Recurso no encontrado",
        path: `/recursos/${params.slug}`,
        noindex: true,
      });
    }
    return buildSeo({
      title: article.title,
      description: article.excerpt,
      path: `/recursos/${params.slug}`,
      type: "article",
    });
  },
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-3xl font-bold">Artículo no encontrado</h1>
        <p className="mt-2 text-muted-foreground">
          El recurso que buscas no existe o fue movido.
        </p>
        <a href="/recursos" className="mt-4 inline-block underline text-biosensor">
          Ver todos los recursos
        </a>
      </div>
    </div>
  ),
  component: ArticlePage,
});

function ArticlePage() {
  const { article } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <Article
      title={article.title}
      subtitle={article.excerpt}
      publishedDate={article.publishedDate}
      readingMinutes={article.readingMinutes}
      jsonLd={articleLd({
        title: article.title,
        description: article.excerpt,
        path: `/recursos/${slug}`,
        datePublished: article.publishedDate,
        image: `${SITE_URL}/og/familias.svg`,
      })}
      related={article.related}
    >
      {article.body}
    </Article>
  );
}