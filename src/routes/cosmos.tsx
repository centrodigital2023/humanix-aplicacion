import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Sparkles, RefreshCw, Calendar, ExternalLink } from "lucide-react";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchNasa, type NasaApod } from "@/lib/nasa";
import { buildSeo, SITE_URL } from "@/lib/seo";
import { toast } from "sonner";

export const Route = createFileRoute("/cosmos")({
  head: () =>
    buildSeo({
      title: "Cosmos · Imagen astronómica del día",
      path: "/cosmos",
      description:
        "Imagen astronómica del día (APOD) de NASA traducida al español por IA. Una pausa cósmica para inspirar el cuidado humano.",
      image: `${SITE_URL}/og/tecnologia.svg`,
      imageAlt: "Humanix Cosmos · APOD de NASA",
    }),
  component: CosmosPage,
});

function CosmosPage() {
  const [data, setData] = useState<NasaApod | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>("");

  async function load(d?: string) {
    setLoading(true);
    try {
      const r = (await fetchNasa("apod", { translate: true, date: d })) as NasaApod;
      setData(r);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cargar la imagen de NASA");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-4xl py-12 space-y-8">
        <header className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            NASA · APOD del día · traducido por IA
          </div>
          <h1 className="text-4xl md:text-5xl font-bold">Una pausa cósmica</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            La misma humanidad que cuida vidas también mira al cielo. Cada día, una imagen astronómica
            curada por NASA y explicada en español neutro por nuestra IA.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              min="1995-06-16"
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(date || undefined)}
              disabled={loading}
            >
              Ver
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDate("");
              load();
            }}
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4 mr-2" /> Hoy
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {!loading && data && (
          <Card className="overflow-hidden">
            {data.media_type === "image" ? (
              <a href={data.hdurl || data.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={data.url}
                  alt={data.title}
                  className="w-full h-auto max-h-[600px] object-contain bg-black"
                  loading="lazy"
                />
              </a>
            ) : (
              <div className="aspect-video">
                <iframe
                  src={data.url}
                  title={data.title}
                  className="w-full h-full"
                  allow="encrypted-media"
                  allowFullScreen
                />
              </div>
            )}
            <CardContent className="space-y-4 p-6">
              <div>
                <p className="text-xs text-muted-foreground">{data.date}</p>
                <h2 className="text-2xl font-bold mt-1">{data.title_es || data.title}</h2>
                {data.title_es && (
                  <p className="text-xs text-muted-foreground italic mt-1">{data.title}</p>
                )}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {data.explanation_es || data.explanation}
              </p>
              {data.copyright && (
                <p className="text-xs text-muted-foreground">© {data.copyright}</p>
              )}
              {data.media_type === "image" && (
                <Button variant="outline" size="sm" asChild>
                  <a href={data.hdurl || data.url} target="_blank" rel="noopener noreferrer">
                    Ver en alta resolución <ExternalLink className="w-3.5 h-3.5 ml-2" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
}