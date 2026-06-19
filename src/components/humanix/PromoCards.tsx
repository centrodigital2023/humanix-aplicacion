import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  Zap,
  Heart,
  Shield,
  TrendingUp,
  Users,
  Brain,
  Rocket,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Share2,
  MessageCircle,
  Link2,
  Check,
  Upload,
  Wand2,
  ImageIcon,
  Loader2,
  Trash2,
  Info,
  Images,
  FileArchive,
  Stethoscope,
  Briefcase,
  RefreshCw,
  Telescope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchNasaImageWithFallback } from "@/lib/nasa";

export type PromoTemplate = {
  id: string;
  headline: string;
  subline: string;
  hashtags: string;
  variant: "bio" | "copper" | "fuchsia" | "cyber";
  icon: typeof Sparkles;
  emoji: string;
  /** Optional dynamic data: when present the card was generated from DB. */
  dynamic?: {
    kind: "professional" | "offer";
    targetPath: string; // e.g. "/profesional/abc" or "/oferta/xyz"
    avatarUrl?: string | null;
  };
};

const STATIC_TEMPLATES: PromoTemplate[] = [
  {
    id: "ia-match",
    headline: "Encuentra al cuidador perfecto en menos de 150 ms",
    subline:
      "Humanix usa IA para conectar familias con profesionales verificados RETHUS en toda Colombia.",
    hashtags: "#HumanixCo #SaludDigital #Cuidadores #IAenSalud",
    variant: "bio",
    icon: Brain,
    emoji: "🧠💙",
  },
  {
    id: "verificado",
    headline: "100% verificados. 0% improvisación.",
    subline: "Cédula, RETHUS, antecedentes y biometría facial. Tu familia merece confianza real.",
    hashtags: "#CuidadoSeguro #Humanix #SaludEnCasa",
    variant: "copper",
    icon: Shield,
    emoji: "🛡️✅",
  },
  {
    id: "trabajo-pro",
    headline: "¿Eres enfermero o auxiliar? Tu próximo turno te espera.",
    subline: "Trabaja cuando quieras, cobra al instante en Nequi o PSE. Sin intermediarios.",
    hashtags: "#EnfermeríaCo #TrabajoSalud #Humanix #FreelanceSalud",
    variant: "fuchsia",
    icon: Rocket,
    emoji: "🚀💼",
  },
  {
    id: "monitoreo",
    headline: "Monitoreo en vivo del cuidado de tus seres queridos",
    subline: "ETA del cuidador, signos vitales y botón de emergencia 24/7. Tranquilidad real.",
    hashtags: "#TecnologíaQueCuida #Humanix #FamiliaSegura",
    variant: "cyber",
    icon: Heart,
    emoji: "❤️📍",
  },
  {
    id: "instituciones",
    headline: "Clínicas e IPS: cubre turnos críticos en minutos",
    subline:
      "Pool de talento certificado, contratos digitales y facturación electrónica integrada.",
    hashtags: "#IPSColombia #SaludB2B #Humanix #TalentoSalud",
    variant: "bio",
    icon: Users,
    emoji: "🏥⚡",
  },
  {
    id: "ia-bio",
    headline: "El cuidado humano, amplificado por IA",
    subline:
      "Match semántico, validación holística y trust score en tiempo real. Bienvenido al futuro.",
    hashtags: "#IAenSalud #HealthTech #Humanix #InnovaciónCo",
    variant: "fuchsia",
    icon: Sparkles,
    emoji: "✨🤖",
  },
  {
    id: "rapido",
    headline: "Cuidador a domicilio en 30 minutos",
    subline: "Bogotá, Medellín, Cali, Barranquilla y +20 ciudades. Reserva por WhatsApp o web.",
    hashtags: "#CuidadoExpress #Humanix #SaludADomicilio",
    variant: "copper",
    icon: Zap,
    emoji: "⚡🏠",
  },
  {
    id: "trust",
    headline: "Trust Score: la nueva reputación del cuidado en salud",
    subline: "Cada profesional Humanix tiene historial verificable, reseñas reales y respaldo IA.",
    hashtags: "#TrustScore #Humanix #SaludTransparente",
    variant: "bio",
    icon: TrendingUp,
    emoji: "📈⭐",
  },
];

type Aspect = "1:1" | "16:9" | "9:16";
const ASPECTS: { label: Aspect; desc: string; cls: string }[] = [
  { label: "1:1", desc: "Instagram · Feed", cls: "aspect-square" },
  { label: "16:9", desc: "Facebook · LinkedIn", cls: "aspect-video" },
  { label: "9:16", desc: "Stories · Reels", cls: "aspect-[9/16]" },
];

const NETWORKS: {
  id: "whatsapp" | "facebook" | "twitter" | "linkedin" | "copy";
  label: string;
  color: string;
  Icon: typeof Share2;
}[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: "bg-[#25D366] hover:bg-[#1da851] text-white border-transparent",
    Icon: MessageCircle,
  },
  {
    id: "facebook",
    label: "Facebook",
    color: "bg-[#1877F2] hover:bg-[#1464cc] text-white border-transparent",
    Icon: Share2,
  },
  {
    id: "twitter",
    label: "X / Twitter",
    color: "bg-black hover:bg-zinc-800 text-white border-transparent",
    Icon: Share2,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    color: "bg-[#0A66C2] hover:bg-[#0852a3] text-white border-transparent",
    Icon: Share2,
  },
  {
    id: "copy",
    label: "Copiar",
    color: "bg-muted hover:bg-muted/80 text-foreground border-border",
    Icon: Link2,
  },
];

const VARIANT_STYLES: Record<
  PromoTemplate["variant"],
  { bg: string; text: string; chip: string; glow: string }
> = {
  bio: {
    bg: "bg-gradient-to-br from-biosensor via-biosensor/85 to-biosensor/60",
    text: "text-biosensor-foreground",
    chip: "bg-white/15 text-white border-white/20",
    glow: "shadow-[0_0_40px_-8px_var(--color-biosensor)]",
  },
  copper: {
    bg: "bg-gradient-to-br from-copper via-copper/85 to-copper/60",
    text: "text-copper-foreground",
    chip: "bg-white/15 text-white border-white/20",
    glow: "shadow-[0_0_40px_-8px_var(--color-copper)]",
  },
  fuchsia: {
    bg: "bg-gradient-to-br from-fuchsia-neural via-fuchsia-neural/85 to-fuchsia-neural/60",
    text: "text-fuchsia-neural-foreground",
    chip: "bg-white/15 text-white border-white/20",
    glow: "shadow-[0_0_40px_-8px_var(--color-fuchsia-neural)]",
  },
  cyber: {
    bg: "bg-cyber",
    text: "text-cyber-foreground",
    chip: "bg-white/10 text-white border-white/20",
    glow: "shadow-[0_0_40px_-8px_#a78bfa]",
  },
};

function buildShareUrl(target: string, url: string, title: string, desc?: string): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const d = encodeURIComponent(desc || title);
  switch (target) {
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
    case "twitter":
      return `https://twitter.com/intent/tweet?url=${u}&text=${t}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    default:
      return url;
  }
}

export function PromoCards({ origin }: { origin: string }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [aspect, setAspect] = useState<Aspect>("1:1");
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bgImages, setBgImages] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [sharingNative, setSharingNative] = useState(false);
  const [carouselBusy, setCarouselBusy] = useState(false);
  const [dynamicCards, setDynamicCards] = useState<PromoTemplate[]>([]);
  const [loadingDynamic, setLoadingDynamic] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utm = "?utm_source=social&utm_medium=share&utm_campaign=promo";
  const baseUrl = useMemo(() => `${origin}/${utm}`, [origin]);

  // Combined templates: static + dynamic professionals/offers
  const TEMPLATES = useMemo<PromoTemplate[]>(
    () => [...STATIC_TEMPLATES, ...dynamicCards],
    [dynamicCards],
  );

  // Per-card share URL (uses dynamic targetPath when available)
  const shareUrlFor = useCallback(
    (tpl: PromoTemplate) => {
      const path = tpl.dynamic?.targetPath ?? "/";
      return `${origin}${path}${utm}&utm_content=${tpl.id}`;
    },
    [origin],
  );

  // Load dynamic cards (professionals + offers) from DB
  const loadDynamic = useCallback(async () => {
    setLoadingDynamic(true);
    try {
      const VARIANTS: PromoTemplate["variant"][] = ["bio", "copper", "fuchsia", "cyber"];
      const [prosRes, offersRes] = await Promise.all([
        supabase
          .from("professional_profiles")
          .select("user_id, specialty, home_city, avg_rating, total_jobs, avatar_url, bio, hourly_rate")
          .eq("published", true)
          .eq("active", true)
          .order("avg_rating", { ascending: false })
          .limit(4),
        supabase
          .from("job_offers")
          .select("id, title, city, amount, specialty_required, modality, description")
          .eq("status", "open")
          .eq("blocked", false)
          .order("created_at", { ascending: false })
          .limit(4),
      ]);

      const cards: PromoTemplate[] = [];
      (prosRes.data ?? []).forEach((p, i) => {
        const rating = Number(p.avg_rating ?? 0).toFixed(1);
        cards.push({
          id: `pro-${p.user_id}`,
          headline: `${p.specialty ?? "Profesional de salud"} verificado en ${p.home_city ?? "Colombia"}`,
          subline:
            (p.bio?.slice(0, 110) ?? "") ||
            `⭐ ${rating} · ${p.total_jobs ?? 0} servicios completados${p.hourly_rate ? ` · desde $${p.hourly_rate.toLocaleString("es-CO")}/h` : ""}.`,
          hashtags: "#HumanixCo #CuidadoEnCasa #SaludDigital #ProfesionalVerificado",
          variant: VARIANTS[i % VARIANTS.length],
          icon: Stethoscope,
          emoji: "👩‍⚕️✨",
          dynamic: {
            kind: "professional",
            targetPath: `/profesional/${p.user_id}`,
            avatarUrl: p.avatar_url,
          },
        });
      });
      (offersRes.data ?? []).forEach((o, i) => {
        cards.push({
          id: `offer-${o.id}`,
          headline: o.title,
          subline:
            (o.description?.slice(0, 110) ?? "") ||
            `📍 ${o.city} · ${o.specialty_required ?? "Salud"} · ${o.modality} · $${(o.amount ?? 0).toLocaleString("es-CO")}.`,
          hashtags: "#HumanixCo #TrabajoSalud #EnfermeríaCo #OfertaActiva",
          variant: VARIANTS[(i + 2) % VARIANTS.length],
          icon: Briefcase,
          emoji: "💼⚡",
          dynamic: {
            kind: "offer",
            targetPath: `/oferta/${o.id}`,
          },
        });
      });
      setDynamicCards(cards);
      if (cards.length) toast.success(`+${cards.length} tarjetas dinámicas cargadas`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDynamic(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    void loadDynamic();
  }, [loadDynamic]);

  // Keyboard navigation
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setActiveIdx((i) => (i + 1) % TEMPLATES.length);
      if (e.key === "ArrowLeft") setActiveIdx((i) => (i - 1 + TEMPLATES.length) % TEMPLATES.length);
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  const handleShare = useCallback(
    async (tpl: PromoTemplate, networkId: string) => {
      const shareText = `${tpl.emoji} ${tpl.headline}\n\n${tpl.subline}\n\n${tpl.hashtags}`;
      const url = shareUrlFor(tpl);
      if (!url || url.includes("undefined")) {
        toast.error("URL no válida para compartir");
        return;
      }
      try {
        if (networkId === "copy") {
          try {
            await navigator.clipboard.writeText(`${shareText}\n${url}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast.success("Texto y enlace copiados");
          } catch {
            toast.error("No se pudo copiar. Selecciona y copia manualmente.");
            return;
          }
        } else {
          const win = window.open(
            buildShareUrl(networkId, url, `${tpl.emoji} ${tpl.headline}`, shareText),
            "_blank",
            "noopener,noreferrer,width=640,height=560",
          );
          if (!win) {
            toast.error("Bloqueador de pop-ups activo. Permite ventanas emergentes.");
            return;
          }
        }
        setShareCounts((p) => ({ ...p, [tpl.id]: (p[tpl.id] ?? 0) + 1 }));
      } catch (e) {
        toast.error("No se pudo compartir: " + (e as Error).message);
      }
    },
    [shareUrlFor],
  );

  // Render card a PNG blob (para Web Share API y descarga)
  const renderCardBlob = useCallback(async (tpl: PromoTemplate): Promise<Blob | null> => {
    const node = cardRefs.current[tpl.id];
    if (!node) return null;
    const { toBlob } = await import("html-to-image");
    return await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
  }, []);

  // Compartir nativo con archivo (mobile: abre IG, FB, WhatsApp con la imagen)
  const handleNativeShare = useCallback(
    async (tpl: PromoTemplate) => {
      const shareText = `${tpl.emoji} ${tpl.headline}\n\n${tpl.subline}\n\n${tpl.hashtags}\n${shareUrlFor(tpl)}`;
      setSharingNative(true);
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      // Feature-detect synchronously. Web Share with files only works reliably
      // on mobile (Android/iOS). On desktop the gesture is lost after the
      // async render, throwing "Must be handling a user gesture". Detect that
      // up-front and go straight to the download fallback.
      const probeFile = new File(["x"], "probe.png", { type: "image/png" });
      const canShareFiles =
        typeof nav.share === "function" &&
        typeof nav.canShare === "function" &&
        nav.canShare({ files: [probeFile] });
      const isMobile =
        typeof navigator !== "undefined" &&
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      try {
        const blob = await renderCardBlob(tpl);
        if (!blob) throw new Error("No se pudo renderizar la tarjeta");
        const file = new File([blob], `humanix-${tpl.id}.png`, { type: "image/png" });
        const downloadFallback = async () => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `humanix-${tpl.id}.png`;
          a.click();
          URL.revokeObjectURL(url);
          try {
            await navigator.clipboard.writeText(shareText);
            toast.info("Imagen descargada y texto copiado. Súbela a tu red social.");
          } catch {
            toast.info("Imagen descargada. Súbela a tu red social.");
          }
        };
        // Only try Web Share with files on mobile where the gesture survives.
        if (canShareFiles && isMobile && nav.canShare!({ files: [file] })) {
          try {
            await nav.share!({
              files: [file],
              title: tpl.headline,
              text: shareText,
            });
            setShareCounts((p) => ({ ...p, [tpl.id]: (p[tpl.id] ?? 0) + 1 }));
            toast.success("Compartido");
          } catch (err) {
            const name = (err as Error).name;
            if (name === "AbortError") return;
            // NotAllowedError = gesture lost. Fall back silently.
            await downloadFallback();
          }
        } else {
          await downloadFallback();
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error("No se pudo compartir: " + (e as Error).message);
        }
      } finally {
        setSharingNative(false);
      }
    },
    [shareUrlFor, renderCardBlob],
  );

  // Subir imagen local
  const handleUploadImage = useCallback(
    (tpl: PromoTemplate, file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Selecciona una imagen válida");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error("Imagen demasiado grande (máx 8 MB)");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setBgImages((p) => ({ ...p, [tpl.id]: reader.result as string }));
        toast.success("Imagen agregada");
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  // Renderizar TODAS las tarjetas como blobs PNG (carrusel)
  const renderAllBlobs = useCallback(async (): Promise<{ name: string; blob: Blob }[]> => {
    const { toBlob } = await import("html-to-image");
    const out: { name: string; blob: Blob }[] = [];
    for (let i = 0; i < TEMPLATES.length; i++) {
      const tpl = TEMPLATES[i];
      const node = cardRefs.current[tpl.id];
      if (!node) continue;
      const blob = await toBlob(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      if (blob) {
        const idx = String(i + 1).padStart(2, "0");
        out.push({ name: `humanix-${idx}-${tpl.id}.png`, blob });
      }
    }
    return out;
  }, []);

  // Descargar carrusel completo como ZIP
  const handleDownloadCarousel = useCallback(async () => {
    setCarouselBusy(true);
    try {
      const blobs = await renderAllBlobs();
      if (!blobs.length) throw new Error("No se pudo renderizar");
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      blobs.forEach(({ name, blob }) => zip.file(name, blob));
      zip.file(
        "README.txt",
        `Carrusel Humanix · ${blobs.length} tarjetas listas para Instagram, Facebook y LinkedIn.\n\nSube las imágenes en orden numérico para mantener la secuencia narrativa.\n\n${origin}`,
      );
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `humanix-carrusel-${blobs.length}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Carrusel descargado (${blobs.length} imágenes)`);
    } catch (e) {
      toast.error("No se pudo crear el carrusel: " + (e as Error).message);
    } finally {
      setCarouselBusy(false);
    }
  }, [renderAllBlobs, origin]);

  // Compartir carrusel completo (Web Share API multi-archivo)
  const handleShareCarousel = useCallback(async () => {
    setCarouselBusy(true);
    try {
      const blobs = await renderAllBlobs();
      if (!blobs.length) throw new Error("No se pudo renderizar");
      const files = blobs.map(
        ({ name, blob }) => new File([blob], name, { type: "image/png" }),
      );
      const shareText = `Carrusel Humanix · ${TEMPLATES.length} tarjetas\n\n${origin}\n\n#HumanixCo #SaludDigital #IAenSalud`;
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files })) {
        await navigator.share({
          files,
          title: "Carrusel Humanix",
          text: shareText,
        });
        toast.success("Carrusel compartido");
      } else {
        // Fallback: descargar ZIP
        toast.info("Tu navegador no soporta compartir carrusel. Descargando ZIP.");
        await handleDownloadCarousel();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error("No se pudo compartir: " + (e as Error).message);
      }
    } finally {
      setCarouselBusy(false);
    }
  }, [renderAllBlobs, origin, handleDownloadCarousel]);

  // Generar imagen con IA
  const handleGenerateImage = useCallback(
    async (tpl: PromoTemplate) => {
      const prompt = aiPrompt.trim() || `Escena que represente: ${tpl.headline}. ${tpl.subline}`;
      setGenerating(true);
      try {
        const { data, error } = await supabase.functions.invoke("promo-image-gen", {
          body: { prompt, aspect },
        });
        if (error) throw error;
        const img = (data as { image?: string; error?: string })?.image;
        if (!img) throw new Error((data as { error?: string })?.error ?? "Sin imagen");
        setBgImages((p) => ({ ...p, [tpl.id]: img }));
        toast.success("Imagen generada con IA");
      } catch (e) {
        const msg = (e as Error).message ?? "Error generando imagen";
        if (msg.includes("402") || msg.toLowerCase().includes("crédit")) {
          toast.error("Créditos IA agotados. Recarga en Settings → Workspace → Usage.");
        } else if (msg.includes("429")) {
          toast.error("Demasiadas solicitudes, intenta en unos segundos.");
        } else {
          toast.error(msg);
        }
      } finally {
        setGenerating(false);
      }
    },
    [aiPrompt, aspect],
  );

  // Fondo desde NASA (APOD del día)
  const handleNasaImage = useCallback(
    async (tpl: PromoTemplate) => {
      setGenerating(true);
      try {
        const aspectKey = (aspect as "1:1" | "16:9" | "9:16") || "1:1";
        const r = await fetchNasaImageWithFallback("apod", aspectKey);
        if (!r) throw new Error("No se pudo obtener imagen NASA ni generar con IA");
        setBgImages((p) => ({ ...p, [tpl.id]: r.url }));
        if (r.source === "nasa") {
          toast.success(`Fondo NASA aplicado · ${r.credit}`);
        } else {
          toast.success(`NASA no disponible · usando imagen IA cósmica`);
        }
      } catch (e) {
        toast.error((e as Error).message || "No se pudo cargar NASA");
      } finally {
        setGenerating(false);
      }
    },
    [aspect],
  );

  const downloadCard = async (tpl: PromoTemplate) => {
    const node = cardRefs.current[tpl.id];
    if (!node) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: null, useCORS: true });
      const link = document.createElement("a");
      link.download = `humanix-${tpl.id}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("PNG descargado");
    } catch {
      const text = `${tpl.emoji} ${tpl.headline}\n\n${tpl.subline}\n\n${tpl.hashtags}\n${baseUrl}`;
      await navigator.clipboard.writeText(text);
      toast.info("Texto copiado al portapapeles");
    }
  };

  const active = TEMPLATES[activeIdx];
  const activeStyles = VARIANT_STYLES[active.variant];
  const ActiveIcon = active.icon;
  const aspectConfig = ASPECTS.find((a) => a.label === aspect)!;
  const activeBg = bgImages[active.id];

  return (
    <div className="space-y-5">
      {/* Off-screen render de TODAS las tarjetas (para carrusel/ZIP) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          top: 0,
          width: 540,
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        {TEMPLATES.map((tpl) => {
          const s = VARIANT_STYLES[tpl.variant];
          if (tpl.id === active.id) return null; // active ya tiene ref
          return (
            <div
              key={`hidden-${tpl.id}`}
              ref={(el) => {
                cardRefs.current[tpl.id] = el;
              }}
              className={cn(
                "w-[540px] aspect-square rounded-2xl overflow-hidden",
                s.bg,
                s.text,
              )}
            >
              <CardContent tpl={tpl} styles={s} bgImage={bgImages[tpl.id]} large />
            </div>
          );
        })}
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-fuchsia-neural" /> Tarjetas para redes sociales
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {TEMPLATES.length} plantillas con copy IA, hashtags y UTM. Un clic para compartir.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl border border-border p-1 bg-muted/30">
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              onClick={() => setAspect(a.label)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                aspect === a.label
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={a.desc}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tarjeta destacada central ──────────────────────────── */}
      <div className="grid md:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Preview principal */}
        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              "w-full max-w-sm mx-auto rounded-2xl overflow-hidden cursor-zoom-in select-none transition-transform hover:scale-[1.01]",
              aspect === "9:16" && "max-h-[70vh] max-w-[min(100%,calc(70vh*9/16))]",
              aspectConfig.cls,
              activeStyles.bg,
              activeStyles.text,
              activeStyles.glow,
            )}
            ref={(el) => {
              cardRefs.current[active.id] = el;
            }}
            onClick={() => setLightbox(true)}
          >
            <CardContent tpl={active} styles={activeStyles} bgImage={activeBg} />
          </div>

          {/* Dots navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveIdx((i) => (i - 1 + TEMPLATES.length) % TEMPLATES.length)}
              className="h-7 w-7 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-center gap-1.5">
              {TEMPLATES.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setActiveIdx(i)}
                  className={cn(
                    "rounded-full transition-all",
                    i === activeIdx
                      ? "w-5 h-2 bg-biosensor"
                      : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                  )}
                />
              ))}
            </div>
            <button
              onClick={() => setActiveIdx((i) => (i + 1) % TEMPLATES.length)}
              className="h-7 w-7 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {activeIdx + 1} / {TEMPLATES.length} · Clic para ampliar · ← → navegar
          </p>
        </div>

        {/* Panel de acciones */}
        <div className="space-y-4">
          <div className={cn("rounded-xl p-0.5", activeStyles.bg)}>
            <div className="rounded-[10px] bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center",
                    activeStyles.bg,
                    activeStyles.text,
                  )}
                >
                  <ActiveIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{active.headline}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {active.emoji} · {active.variant}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{active.subline}</p>
              <div className="flex flex-wrap gap-1">
                {active.hashtags.split(" ").map((h) => (
                  <span
                    key={h}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
                  >
                    {h}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
                <span>{shareCounts[active.id] ?? 0} veces compartida</span>
                <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                  {aspectConfig.desc}
                </Badge>
              </div>
            </div>
          </div>

          {/* Botones de red */}
          <div className="space-y-1.5">
            {NETWORKS.map(({ id, label, color, Icon }) => (
              <button
                key={id}
                onClick={() => void handleShare(active, id)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold border transition-all hover:-translate-y-0.5 hover:shadow-sm",
                  color,
                )}
              >
                {id === "copy" && copied ? (
                  <Check className="h-4 w-4 shrink-0" />
                ) : (
                  <Icon className="h-4 w-4 shrink-0" />
                )}
                {id === "copy" && copied ? "¡Copiado!" : label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => void downloadCard(active)}
          >
            <Download className="h-3.5 w-3.5" /> Descargar PNG
          </Button>

          {/* Web Share nativo (mobile) */}
          <Button
            size="sm"
            className="w-full gap-1.5 bg-gradient-to-r from-biosensor to-fuchsia-neural text-white"
            disabled={sharingNative}
            onClick={() => void handleNativeShare(active)}
          >
            {sharingNative ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            Compartir imagen (Instagram, FB, WhatsApp)
          </Button>

          {/* Carrusel completo */}
          <div className="rounded-xl border border-fuchsia-neural/30 bg-gradient-to-br from-fuchsia-neural/5 to-biosensor/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Images className="h-3.5 w-3.5 text-fuchsia-neural" />
              Carrusel completo ({TEMPLATES.length} tarjetas)
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Comparte o descarga las {TEMPLATES.length} tarjetas como un carrusel listo para
              Instagram, Facebook o LinkedIn.
            </p>
            <Button
              size="sm"
              className="w-full gap-1.5 bg-gradient-to-r from-fuchsia-neural to-biosensor text-white"
              disabled={carouselBusy}
              onClick={() => void handleShareCarousel()}
            >
              {carouselBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              Compartir carrusel
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={carouselBusy}
              onClick={() => void handleDownloadCarousel()}
            >
              {carouselBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileArchive className="h-3.5 w-3.5" />
              )}
              Descargar ZIP
            </Button>
          </div>

          {/* Bloque imagen: subir o generar con IA */}
          <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <ImageIcon className="h-3.5 w-3.5 text-fuchsia-neural" />
              Imagen de fondo (opcional)
            </div>
            <div className="flex gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadImage(active, f);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" /> Subir
              </Button>
              {activeBg && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs text-destructive"
                  onClick={() => {
                    setBgImages((p) => {
                      const next = { ...p };
                      delete next[active.id];
                      return next;
                    });
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Prompt IA (opcional, usa el copy si está vacío)"
              className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5"
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1 text-xs"
              disabled={generating}
              onClick={() => void handleGenerateImage(active)}
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3 text-fuchsia-neural" />
              )}
              {generating ? "Generando..." : "Generar con IA"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1 text-xs"
              disabled={generating}
              onClick={() => void handleNasaImage(active)}
              title="Usa la imagen astronómica del día de NASA"
            >
              <Telescope className="h-3 w-3 text-biosensor" />
              Fondo NASA (APOD)
            </Button>
          </div>

          {/* Aviso Facebook */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] text-muted-foreground flex gap-1.5">
            <Info className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Tip Facebook:</strong> si Facebook muestra
              "Enlace no disponible", verifica el dominio <code>humanix.lat</code> en
              Business Manager → Seguridad de marca → Dominios. Mientras tanto, usa el botón
              "Compartir imagen" para subir la tarjeta como foto directa.
            </span>
          </div>
        </div>
      </div>

      {/* ── Miniaturas horizontales ───────────────────────────── */}
      {/* ── Carrusel deslizable estilo Facebook / Temu ────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Images className="h-3.5 w-3.5 text-fuchsia-neural" />
            Carrusel deslizable ({TEMPLATES.length})
            {dynamicCards.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[9px] gap-1">
                <Sparkles className="h-2.5 w-2.5 text-fuchsia-neural" />
                {dynamicCards.length} dinámicas
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Desliza → como en Facebook · clic para seleccionar
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[10px]"
              disabled={loadingDynamic}
              onClick={() => void loadDynamic()}
              title="Recargar profesionales y ofertas activas"
            >
              {loadingDynamic ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Actualizar
            </Button>
          </div>
        </div>
        <div
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3 px-1 scroll-smooth touch-pan-x overscroll-x-contain"
          style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "thin" }}
        >
          {TEMPLATES.map((tpl, i) => {
            const s = VARIANT_STYLES[tpl.variant];
            const Ico = tpl.icon;
            const bg = bgImages[tpl.id];
            return (
              <button
                key={`swipe-${tpl.id}`}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "relative shrink-0 snap-center rounded-2xl overflow-hidden transition-all",
                  "w-[78%] sm:w-[55%] md:w-[42%] lg:w-[32%] aspect-square",
                  s.bg,
                  s.text,
                  i === activeIdx
                    ? "ring-2 ring-biosensor ring-offset-2 ring-offset-background scale-[1.01] shadow-xl"
                    : "opacity-90 hover:opacity-100",
                )}
              >
                {bg && (
                  <>
                    <img
                      src={bg}
                      alt=""
                      crossOrigin="anonymous"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/20" />
                  </>
                )}
                <div className="absolute inset-0 grid-pattern opacity-20" />
                <div className="relative h-full flex flex-col justify-between p-4 text-left">
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "flex items-center justify-center rounded-xl border h-9 w-9",
                        s.chip,
                      )}
                    >
                      <Ico className="h-4 w-4" />
                    </div>
                    <div
                      className={cn(
                        "font-mono px-2 py-1 rounded-full border text-[9px]",
                        s.chip,
                      )}
                    >
                      {String(i + 1).padStart(2, "0")} / {TEMPLATES.length}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-bold text-sm leading-snug line-clamp-3">
                      {tpl.headline}
                    </p>
                    <p className="text-[11px] opacity-90 line-clamp-2">{tpl.subline}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] opacity-75">humanix.lat</span>
                      <span className="text-base">{tpl.emoji}</span>
                    </div>
                  </div>
                </div>
                {(shareCounts[tpl.id] ?? 0) > 0 && (
                  <span className="absolute top-2 left-2 text-[9px] bg-black/40 text-white rounded-full px-1.5 py-0.5">
                    ↗ {shareCounts[tpl.id]}
                  </span>
                )}
                {tpl.dynamic && (
                  <span className="absolute top-2 right-2 text-[9px] bg-fuchsia-neural/90 text-white rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide">
                    {tpl.dynamic.kind === "professional" ? "Pro" : "Oferta"}
                  </span>
                )}
                {tpl.dynamic?.avatarUrl && (
                  <img
                    src={tpl.dynamic.avatarUrl}
                    alt=""
                    crossOrigin="anonymous"
                    className="absolute bottom-3 right-3 h-10 w-10 rounded-full border-2 border-white object-cover shadow-lg"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Miniaturas horizontales ───────────────────────────── */}
      <div className="overflow-x-auto scrollbar-thin pb-2">
        <div className="flex gap-3 w-max px-1">
          {TEMPLATES.map((tpl, i) => {
            const s = VARIANT_STYLES[tpl.variant];
            const Ico = tpl.icon;
            return (
              <button
                key={tpl.id}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "relative w-24 aspect-square rounded-xl overflow-hidden shrink-0 transition-all hover:scale-105",
                  s.bg,
                  s.text,
                  i === activeIdx
                    ? "ring-2 ring-biosensor ring-offset-2 ring-offset-background scale-105"
                    : "opacity-70 hover:opacity-100",
                )}
              >
                <div className="absolute inset-0 grid-pattern opacity-20" />
                <div className="relative h-full flex flex-col items-center justify-center gap-1 p-2 text-center">
                  <Ico className="h-5 w-5" />
                  <p className="text-[9px] font-semibold leading-tight line-clamp-2">
                    {tpl.headline.split(" ").slice(0, 4).join(" ")}…
                  </p>
                  {(shareCounts[tpl.id] ?? 0) > 0 && (
                    <span className="absolute top-1 right-1 text-[8px] bg-black/30 rounded-full px-1">
                      {shareCounts[tpl.id]}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(false)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors flex items-center gap-1 text-sm z-10"
            >
              <X className="h-4 w-4" /> Cerrar
            </button>
            <button
              onClick={() => setActiveIdx((i) => (i - 1 + TEMPLATES.length) % TEMPLATES.length)}
              className="absolute left-2 sm:-left-12 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 sm:bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setActiveIdx((i) => (i + 1) % TEMPLATES.length)}
              className="absolute right-2 sm:-right-12 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 sm:bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div
              className={cn(
                "w-full aspect-square rounded-2xl overflow-hidden max-h-[85vh]",
                activeStyles.bg,
                activeStyles.text,
                activeStyles.glow,
              )}
            >
              <CardContent tpl={active} styles={activeStyles} bgImage={activeBg} large />
            </div>
            <div className="mt-3 flex gap-2 justify-center flex-wrap">
              {NETWORKS.slice(0, 4).map(({ id, label, color, Icon }) => (
                <button
                  key={id}
                  onClick={() => void handleShare(active, id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors",
                    color,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardContent({
  tpl,
  styles,
  bgImage,
  large = false,
}: {
  tpl: PromoTemplate;
  styles: (typeof VARIANT_STYLES)[keyof typeof VARIANT_STYLES];
  bgImage?: string;
  large?: boolean;
}) {
  const Icon = tpl.icon;
  return (
    <div className={cn("relative h-full flex flex-col justify-between", large ? "p-8" : "p-5")}>
      {bgImage && (
        <>
          <img
            src={bgImage}
            alt=""
            crossOrigin="anonymous"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/30" />
        </>
      )}
      <div className="absolute inset-0 grid-pattern opacity-20" />
      {/* Top row */}
      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border",
            large ? "h-12 w-12" : "h-9 w-9",
            styles.chip,
          )}
        >
          <Icon className={large ? "h-6 w-6" : "h-4 w-4"} />
        </div>
        <div className={cn("font-mono px-2 py-1 rounded-full border text-[10px]", styles.chip)}>
          humanix.lat
        </div>
      </div>
      {/* Content */}
      <div className="relative space-y-2">
        <p className={cn("font-display font-bold leading-tight", large ? "text-2xl" : "text-lg")}>
          {tpl.headline}
        </p>
        <p className={cn("opacity-85 leading-relaxed line-clamp-3", large ? "text-sm" : "text-xs")}>
          {tpl.subline}
        </p>
        <div
          className={cn(
            "font-mono px-2 py-1 rounded border inline-block",
            large ? "text-[11px]" : "text-[9px]",
            styles.chip,
          )}
        >
          {tpl.hashtags.split(" ").slice(0, 2).join(" ")}
        </div>
      </div>
    </div>
  );
}
