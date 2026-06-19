import { useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Loader2,
  Trash2,
  Share2,
  ArrowLeftRight,
  ArrowUpDown,
  Image as ImageIcon,
  Wand2,
  Copy as CopyIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ShareButtons } from "@/components/humanix/ShareButtons";
import { supabase as _sb } from "@/integrations/supabase/client";
import { toast } from "sonner";

const supabase: any = _sb;

export type PromoContext = {
  institutionName?: string;
  city?: string;
  offersCount?: number;
  specialties?: string[];
  requirements?: string[];
  extraSpecs?: string;
};

type AdCopy = {
  headline?: string;
  subheadline?: string;
  body?: string;
  cta?: string;
  hashtags?: string[];
  image_prompt?: string;
};

type Slide = {
  id: string;
  url: string;
  caption?: string;
  source: "ai" | "upload";
  copy?: AdCopy;
};

type Props = {
  shareTitle?: string;
  shareUrl?: string;
  context?: PromoContext;
};

export function PromoCarousel({ shareTitle = "Conoce Humanix", shareUrl, context }: Props) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [prompt, setPrompt] = useState("");
  const [extraSpecs, setExtraSpecs] = useState("");
  const [aspect, setAspect] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [busy, setBusy] = useState(false);
  const [busyCopy, setBusyCopy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const buildContext = (): PromoContext => ({
    ...(context ?? {}),
    extraSpecs: extraSpecs.trim() || context?.extraSpecs,
  });

  const autoBriefing = () => {
    const c = buildContext();
    const parts: string[] = [];
    if (c.institutionName) parts.push(`Institución ${c.institutionName}`);
    if (c.city) parts.push(`en ${c.city}`);
    if (c.offersCount) parts.push(`${c.offersCount} vacantes activas`);
    if (c.specialties?.length) parts.push(`especialidades: ${c.specialties.slice(0, 3).join(", ")}`);
    return parts.join(", ");
  };

  const generate = async () => {
    const briefing = prompt.trim() || autoBriefing();
    if (!briefing) {
      toast.error("Describe la pieza o completa el contexto");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("promo-image-gen", {
        body: { prompt: briefing, aspect, context: buildContext() },
      });
      if (error) throw error;
      const url: string | undefined = data?.image;
      if (!url) throw new Error("Sin imagen");
      setSlides((s) => [
        ...s,
        { id: crypto.randomUUID(), url, caption: briefing, source: "ai" },
      ]);
      toast.success("Imagen generada");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar la imagen");
    } finally {
      setBusy(false);
    }
  };

  const generateCopyAndImage = async () => {
    const briefing = prompt.trim() || autoBriefing();
    if (!briefing) {
      toast.error("Describe la pieza o completa el contexto");
      return;
    }
    setBusyCopy(true);
    try {
      const ctx = buildContext();
      const { data: copyData, error: copyErr } = await supabase.functions.invoke("promo-image-gen", {
        body: { prompt: briefing, mode: "copy", context: ctx },
      });
      if (copyErr) throw copyErr;
      const copy: AdCopy = copyData?.copy ?? {};
      const imgPrompt = copy.image_prompt || briefing;
      const { data: imgData, error: imgErr } = await supabase.functions.invoke("promo-image-gen", {
        body: { prompt: imgPrompt, aspect, context: ctx },
      });
      if (imgErr) throw imgErr;
      const url: string | undefined = imgData?.image;
      if (!url) throw new Error("Sin imagen");
      const caption = [copy.headline, copy.subheadline].filter(Boolean).join(" — ") || briefing;
      setSlides((s) => [
        ...s,
        { id: crypto.randomUUID(), url, caption, source: "ai", copy },
      ]);
      toast.success("Pieza publicitaria lista (copy + imagen)");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar la pieza");
    } finally {
      setBusyCopy(false);
    }
  };

  const copyToClipboard = (slide: Slide) => {
    const c = slide.copy;
    if (!c) return;
    const text = [
      c.headline,
      c.subheadline,
      "",
      c.body,
      "",
      c.cta,
      "",
      (c.hashtags ?? []).join(" "),
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Copy publicitario copiado");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const next: Slide[] = await Promise.all(
      files.map(
        (f) =>
          new Promise<Slide>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                url: String(reader.result),
                caption: f.name,
                source: "upload",
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          }),
      ),
    );
    setSlides((s) => [...s, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = (id: string) => setSlides((s) => s.filter((x) => x.id !== id));

  const isVertical = orientation === "vertical";
  const hasContext = !!(context && (context.institutionName || context.offersCount || context.city));

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Carrusel promocional
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Genera copy + imagen con IA usando el contexto de tus ofertas, o sube tus propias piezas.
          </p>
          {hasContext && (
            <div className="mt-2 flex flex-wrap gap-1">
              {context?.institutionName && (
                <Badge variant="outline" className="text-[10px]">{context.institutionName}</Badge>
              )}
              {context?.city && (
                <Badge variant="outline" className="text-[10px]">{context.city}</Badge>
              )}
              {typeof context?.offersCount === "number" && context.offersCount > 0 && (
                <Badge variant="outline" className="text-[10px]">{context.offersCount} vacantes</Badge>
              )}
              {(context?.specialties ?? []).slice(0, 3).map((s) => (
                <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"))}
            title="Cambiar orientación"
          >
            {isVertical ? (
              <ArrowUpDown className="h-4 w-4 mr-1.5" />
            ) : (
              <ArrowLeftRight className="h-4 w-4 mr-1.5" />
            )}
            {isVertical ? "Vertical" : "Horizontal"}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-2">
        <div className="md:col-span-2 space-y-2">
          <Textarea
            className="min-h-[64px]"
            placeholder={hasContext
              ? "Briefing (opcional). Si lo dejas vacío, la IA usa el contexto de la institución y ofertas."
              : "Describe la pieza: ej. 'Promoción cuidadores 24/7 en Bogotá, estilo cálido y profesional'"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Textarea
            className="min-h-[52px] text-sm"
            placeholder="Especificaciones adicionales: tono, audiencia, oferta destacada, promoción, paleta… (opcional)"
            value={extraSpecs}
            onChange={(e) => setExtraSpecs(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            {(["1:1", "16:9", "9:16"] as const).map((a) => (
              <Button
                key={a}
                type="button"
                size="sm"
                variant={aspect === a ? "default" : "outline"}
                onClick={() => setAspect(a)}
                className="flex-1"
              >
                {a}
              </Button>
            ))}
          </div>
          <Button onClick={generateCopyAndImage} disabled={busyCopy || busy} variant="hero">
            {busyCopy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1.5" />
            )}
            Copy + imagen IA
          </Button>
          <Button onClick={generate} disabled={busy || busyCopy} variant="outline">
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            Solo imagen IA
          </Button>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />
            Subir imagen
          </Button>
          <Input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
          Aún no hay piezas. Genera con IA o sube una imagen para empezar.
        </div>
      ) : (
        <div
          className={
            isVertical
              ? "max-h-[520px] overflow-y-auto flex flex-col gap-3 pr-1 snap-y snap-mandatory"
              : "overflow-x-auto flex gap-3 pb-2 snap-x snap-mandatory"
          }
        >
          {slides.map((s) => (
            <div
              key={s.id}
              className={
                isVertical
                  ? "snap-start w-full rounded-lg border bg-card overflow-hidden flex flex-col"
                  : "snap-start shrink-0 w-64 sm:w-72 rounded-lg border bg-card overflow-hidden flex flex-col"
              }
            >
              <div className="relative bg-muted">
                <img
                  src={s.url}
                  alt={s.caption || "Promo"}
                  className={
                    isVertical
                      ? "w-full max-h-[360px] object-cover"
                      : "w-full h-44 object-cover"
                  }
                  loading="lazy"
                />
                <Badge variant="secondary" className="absolute top-2 left-2 text-[10px]">
                  {s.source === "ai" ? "IA" : "Subida"}
                </Badge>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute top-1 right-1 h-7 w-7 bg-background/80 hover:bg-background"
                  onClick={() => remove(s.id)}
                  title="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="p-2 space-y-2">
                {s.copy ? (
                  <div className="space-y-1">
                    {s.copy.headline && (
                      <p className="text-sm font-semibold leading-tight line-clamp-2">{s.copy.headline}</p>
                    )}
                    {s.copy.subheadline && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{s.copy.subheadline}</p>
                    )}
                    {s.copy.body && (
                      <p className="text-[11px] text-muted-foreground line-clamp-3">{s.copy.body}</p>
                    )}
                    {s.copy.hashtags && s.copy.hashtags.length > 0 && (
                      <p className="text-[10px] text-primary line-clamp-1">{s.copy.hashtags.join(" ")}</p>
                    )}
                  </div>
                ) : (
                  s.caption && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{s.caption}</p>
                  )
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Share2 className="h-3 w-3" /> Compartir
                  </span>
                  <div className="flex items-center gap-1">
                    {s.copy && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => copyToClipboard(s)}
                        title="Copiar copy publicitario"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <ShareButtons
                      url={shareUrl || s.url}
                      title={s.copy?.headline || s.caption || shareTitle}
                      description={s.copy?.body || shareTitle}
                      targets={["whatsapp", "facebook", "twitter", "copy"]}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default PromoCarousel;