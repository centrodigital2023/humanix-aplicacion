import { useEffect, useState, useCallback, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  Megaphone,
  LayoutDashboard,
  ShieldAlert,
  ScrollText,
  MessageSquare,
  Users,
  FileCheck,
  Briefcase,
  Plus,
  Sparkles,
  Eye,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  BarChart2,
  ExternalLink,
  CheckCircle2,
  CircleDot,
  Upload,
  ImageIcon,
  Wand2,
  X,
  Telescope,
  Monitor,
  Smartphone,
  Copy,
  Power,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { ShareButtons } from "@/components/humanix/ShareButtons";
import { PromoCards } from "@/components/humanix/PromoCards";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchNasaImageWithFallback } from "@/lib/nasa";

export const Route = createFileRoute("/superadmin/publicidad")({
  head: () => ({ meta: [{ title: "Publicidad · Superadmin" }] }),
  component: PublicidadPage,
});

const NAV: NavItem[] = [
  { label: "Overview", to: "/superadmin", icon: LayoutDashboard },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Marketplace", to: "/superadmin/marketplace", icon: Briefcase },
  { label: "Publicidad", to: "/superadmin/publicidad", icon: Megaphone },
  { label: "Marketing", to: "/superadmin/marketing", icon: Sparkles },
  { label: "CRM", to: "/superadmin/crm", icon: MessageSquare },
  { label: "Talento Humano", to: "/talento-humano", icon: Users },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
];

type Banner = {
  id: string;
  title: string;
  description: string | null;
  cta_label: string | null;
  link_url: string | null;
  image_url: string | null;
  audience: string;
  position: string;
  active: boolean;
  ai_recommendation: string | null;
  ai_score: number | null;
  impressions: number;
  clicks: number;
  shares_count: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

const EMPTY: Partial<Banner> = {
  title: "",
  description: "",
  cta_label: "Ver más",
  link_url: "",
  image_url: "",
  audience: "all",
  position: "home_hero",
  active: true,
};

// Normaliza una URL para uso en href / share. Acepta:
//   • absolutas (http/https) → tal cual
//   • relativas ("/familias?x=1") → absolutas usando origin
//   • vacías / null / "#" → null (no se debe renderizar como href)
function normalizeUrl(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "#") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${origin}${trimmed}`;
  // mailto:, tel:, etc.
  if (/^[a-z]+:/i.test(trimmed)) return trimmed;
  return `${origin}/${trimmed}`;
}

// -----------------------------------------------------------------------------
// 5 banners inteligentes — borradores listos (active:false) para revisión.
// Copy alineado con las audiencias y landings reales de Humanix.
// -----------------------------------------------------------------------------
const SMART_BANNERS: Array<
  Omit<
    Banner,
    "id" | "created_at" | "impressions" | "clicks" | "shares_count" | "starts_at" | "ends_at"
  >
> = [
  {
    title: "Cuidado en casa con profesionales verificados",
    description:
      "Auxiliares de enfermería, terapeutas y médicos verificados con RETHUS. Reserva en minutos, paga seguro.",
    cta_label: "Buscar profesional",
    link_url: "/familias?utm_source=banner&utm_medium=web&utm_campaign=familia-cuidado-casa",
    image_url: null,
    audience: "family",
    position: "home_hero",
    active: false,
    ai_recommendation:
      "Mensaje orientado a familias con audiencia amplia. Prioriza verificación RETHUS y rapidez.",
    ai_score: 0.82,
  },
  {
    title: "¿Eres profesional de salud? Gana más en tu ciudad",
    description:
      "Decide cuándo, dónde y cuánto cobras. Pagos inmediatos, ofertas cerca de ti y agenda flexible.",
    cta_label: "Postularme gratis",
    link_url: "/profesionales?utm_source=banner&utm_medium=web&utm_campaign=profesional-gana-mas",
    image_url: null,
    audience: "professional",
    position: "profesionales_top",
    active: false,
    ai_recommendation: "Tono motivacional con beneficios concretos (pago, flexibilidad, cercanía).",
    ai_score: 0.85,
  },
  {
    title: "Clínicas e IPS: cubre turnos en minutos",
    description:
      "Talento humano verificado, scoring por IA, facturación DIAN. Panel B2B para directores y jefes de talento.",
    cta_label: "Hablar con ventas",
    link_url: "/talento-humano?utm_source=banner&utm_medium=web&utm_campaign=institucion-turnos",
    image_url: null,
    audience: "institution",
    position: "institucion_hero",
    active: false,
    ai_recommendation:
      "Mensaje B2B con foco en velocidad de cobertura y cumplimiento regulatorio.",
    ai_score: 0.78,
  },
  {
    title: "IA en tiempo real para salud en Colombia",
    description:
      "Verificación automática de documentos, matchmaking semántico y antifraude. Todo bajo la Ley 1581.",
    cta_label: "Ver cómo funciona",
    link_url: "/tecnologia?utm_source=banner&utm_medium=web&utm_campaign=tecnologia-ia",
    image_url: null,
    audience: "all",
    position: "tecnologia_hero",
    active: false,
    ai_recommendation: "Banner de producto para usuarios curiosos por la tecnología. Cross-audience.",
    ai_score: 0.74,
  },
  {
    title: "Plan Familiar · Primer mes gratis",
    description:
      "Cuidado preventivo para toda tu familia: visitas programadas, respuesta ante emergencias, créditos por referidos.",
    cta_label: "Probar gratis",
    link_url: "/planes?utm_source=banner&utm_medium=web&utm_campaign=referidos-familia",
    image_url: null,
    audience: "family",
    position: "planes_hero",
    active: false,
    ai_recommendation: "Promoción con incentivo económico + referidos virales.",
    ai_score: 0.88,
  },
];

function PublicidadPage() {
  const { user, loading, logout } = useAppUser({ allow: ["superadmin"] });
  const [banners, setBanners] = useState<Banner[]>([]);
  const [editing, setEditing] = useState<Partial<Banner> | null>(null);
  const [open, setOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [carouselPlaying, setCarouselPlaying] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [genImgLoading, setGenImgLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const carouselTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://humanix.lat";
  // Canonical public origin used for SHARE URLs (Facebook, LinkedIn, X…).
  // Las redes sociales (especialmente Facebook) requieren URLs públicamente
  // accesibles para hacer crawling de las OG tags. Usar `window.location.origin`
  // rompe el share en preview/localhost (lovable.app de preview o id-preview…).
  const PUBLIC_ORIGIN = "https://humanix.lat";
  const shareOrigin = /^https?:\/\/(localhost|.*lovable\.app)/i.test(origin)
    ? PUBLIC_ORIGIN
    : origin;

  useEffect(() => {
    if (!user) return;
    void load();
    const ch = supabase
      .channel("ads-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ad_banners" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user]);

  const load = async () => {
    const { data } = await supabase
      .from("ad_banners")
      .select("*")
      .order("created_at", { ascending: false });
    setBanners((data ?? []) as Banner[]);
  };

  const save = async () => {
    if (!editing?.title) {
      toast.error("Título requerido");
      return;
    }
    const payload = {
      title: editing.title!,
      description: editing.description ?? null,
      cta_label: editing.cta_label ?? null,
      link_url: editing.link_url ?? null,
      image_url: editing.image_url ?? null,
      audience: editing.audience ?? "all",
      position: editing.position ?? "home_hero",
      active: editing.active ?? true,
      ai_recommendation: editing.ai_recommendation ?? null,
      ai_score: editing.ai_score ?? null,
      starts_at: editing.starts_at ?? null,
      ends_at: editing.ends_at ?? null,
    };
    const { error } = editing.id
      ? await supabase.from("ad_banners").update(payload).eq("id", editing.id)
      : await supabase.from("ad_banners").insert({ ...payload, created_by: user?.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing.id ? "Banner actualizado" : "Banner creado");
    await supabase.rpc("log_audit", {
      _action: editing.id ? "ad.update" : "ad.create",
      _resource_type: "ad_banners",
      _resource_id: editing.id ?? undefined,
      _severity: "info",
      _meta: { title: editing.title } as never,
    });
    setOpen(false);
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar banner?")) return;
    await supabase.from("ad_banners").delete().eq("id", id);
    await supabase.rpc("log_audit", {
      _action: "ad.delete",
      _resource_type: "ad_banners",
      _resource_id: id,
      _severity: "warn",
    });
    toast.success("Eliminado");
    await load();
  };

  const recommend = async () => {
    if (!editing) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ad-recommender", {
        body: {
          title: editing.title,
          description: editing.description,
          cta_label: editing.cta_label,
          target_intent: editing.audience,
        },
      });
      if (error) throw error;
      const rec = data as {
        title_suggestion: string;
        description_suggestion: string;
        cta_suggestion: string;
        audience: string;
        ai_score: number;
        recommendation: string;
      };
      setEditing({
        ...editing,
        title: rec.title_suggestion,
        description: rec.description_suggestion,
        cta_label: rec.cta_suggestion,
        audience: rec.audience,
        ai_score: rec.ai_score,
        ai_recommendation: rec.recommendation,
      });
      toast.success("IA aplicada al banner");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error IA");
    } finally {
      setAiLoading(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!user || !editing) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen no puede superar 5 MB");
      return;
    }
    setUploadingImg(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("ad-banners")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ad-banners").getPublicUrl(path);
      setEditing({ ...editing, image_url: pub.publicUrl });
      toast.success("Imagen subida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la imagen");
    } finally {
      setUploadingImg(false);
    }
  };

  const generateImage = async () => {
    if (!editing || !user) return;
    const prompt =
      [editing.title, editing.description].filter(Boolean).join(". ") ||
      "Banner publicitario para Humanix, plataforma colombiana de cuidadores de salud a domicilio";
    setGenImgLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("promo-image-gen", {
        body: { prompt, aspect: "16:9" },
      });
      if (error) throw error;
      const dataUrl = (data as { image?: string })?.image;
      if (!dataUrl) throw new Error("Sin imagen generada");
      // Convertir data URL a blob y subir al bucket para tener URL pública estable
      const blob = await (await fetch(dataUrl)).blob();
      const path = `${user.id}/ai-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from("ad-banners")
        .upload(path, blob, { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ad-banners").getPublicUrl(path);
      setEditing({ ...editing, image_url: pub.publicUrl });
      toast.success("Imagen generada con IA");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar la imagen");
    } finally {
      setGenImgLoading(false);
    }
  };

  const useNasaImage = async () => {
    if (!editing || !user) return;
    setGenImgLoading(true);
    try {
      const r = await fetchNasaImageWithFallback("apod", "16:9");
      if (!r) throw new Error("No se pudo obtener imagen NASA ni generar con IA");
      // Si es URL remota la descargamos; si es data: URL la convertimos directo
      const blob = await (await fetch(r.url)).blob();
      const ext = r.source === "ai" ? "png" : "jpg";
      const prefix = r.source === "ai" ? "cosmic-ai" : "nasa";
      const path = `${user.id}/${prefix}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("ad-banners")
        .upload(path, blob, {
          contentType: blob.type || (r.source === "ai" ? "image/png" : "image/jpeg"),
          upsert: false,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ad-banners").getPublicUrl(path);
      setEditing({ ...editing, image_url: pub.publicUrl });
      toast.success(
        r.source === "nasa"
          ? `Fondo NASA aplicado · ${r.credit}`
          : `NASA no disponible · usando imagen IA cósmica`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar NASA");
    } finally {
      setGenImgLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleActive = async (b: Banner) => {
    const { error } = await supabase
      .from("ad_banners")
      .update({ active: !b.active })
      .eq("id", b.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(!b.active ? "Banner activado" : "Banner pausado");
    await load();
  };

  const duplicateBanner = async (b: Banner) => {
    if (!user) return;
    const { error } = await supabase.from("ad_banners").insert({
      title: `${b.title} (copia)`,
      description: b.description,
      cta_label: b.cta_label,
      link_url: b.link_url,
      image_url: b.image_url,
      audience: b.audience,
      position: b.position,
      active: false,
      ai_recommendation: b.ai_recommendation,
      ai_score: b.ai_score,
      created_by: user.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Banner duplicado como borrador");
    await load();
  };

  const copyPreviewLink = async (b: Banner) => {
    const url = normalizeUrl(b.link_url, origin) ?? `${origin}/?banner=${b.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const seedSmart = async () => {
    if (!user) return;
    setSeeding(true);
    try {
      const payload = SMART_BANNERS.map((b) => ({
        ...b,
        created_by: user.id,
      }));
      const { error } = await supabase.from("ad_banners").insert(payload);
      if (error) throw error;
      await supabase.rpc("log_audit", {
        _action: "ad.seed",
        _resource_type: "ad_banners",
        _severity: "info",
        _meta: { count: payload.length } as never,
      });
      toast.success(`${payload.length} banners creados como borradores`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear los banners");
    } finally {
      setSeeding(false);
    }
  };

  const activeBanners = banners.filter((b) => b.active);
  const carouselItems =
    selectedIds.size > 0 ? banners.filter((b) => selectedIds.has(b.id)) : activeBanners;

  // Autoplay
  const startTimer = useCallback(() => {
    if (carouselTimer.current) clearInterval(carouselTimer.current);
    carouselTimer.current = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % Math.max(1, carouselItems.length));
    }, 4000);
  }, [carouselItems.length]);

  useEffect(() => {
    if (carouselPlaying && carouselItems.length > 1) {
      startTimer();
    } else if (carouselTimer.current) {
      clearInterval(carouselTimer.current);
    }
    return () => {
      if (carouselTimer.current) clearInterval(carouselTimer.current);
    };
  }, [carouselPlaying, carouselItems.length, startTimer]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold">Necesitas iniciar sesión</h1>
          <p className="text-sm text-muted-foreground">
            Este módulo requiere permisos de superadmin.
          </p>
          <div className="pt-2">
            <Link to="/auth" className="inline-flex">
              <Button variant="hero">Ir a iniciar sesión</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const current = carouselItems[carouselIdx % Math.max(1, carouselItems.length)];
  void current; // consumed inline inside JSX

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Publicidad"
      subtitle="CRUD de banners con IA de copy, carrusel y publicación a redes."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Publicidad" }]}
      badge={{ label: "Publicidad", tone: "copper" }}
    >
      <div className="space-y-6">
        {/* ── KPI tiles ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Banners",
              value: banners.length,
              sub: `${activeBanners.length} activos`,
              color: "text-biosensor",
            },
            {
              label: "Impresiones",
              value: banners.reduce((s, b) => s + b.impressions, 0).toLocaleString("es-CO"),
              sub: "total acumulado",
              color: "text-copper",
            },
            {
              label: "Clicks",
              value: banners.reduce((s, b) => s + b.clicks, 0).toLocaleString("es-CO"),
              sub: `CTR ${banners.reduce((s, b) => s + b.impressions, 0) > 0 ? ((banners.reduce((s, b) => s + b.clicks, 0) / banners.reduce((s, b) => s + b.impressions, 0)) * 100).toFixed(1) : "0"}%`,
              color: "text-fuchsia-neural",
            },
            {
              label: "Compartidos",
              value: banners.reduce((s, b) => s + b.shares_count, 0).toLocaleString("es-CO"),
              sub: "viral total",
              color: "text-biosensor",
            },
          ].map(({ label, value, sub, color }) => (
            <Card key={label} className="p-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs font-semibold mt-0.5">{label}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
            </Card>
          ))}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-muted-foreground">
            {banners.length} banner{banners.length === 1 ? "" : "s"} · {activeBanners.length} activo
            {activeBanners.length === 1 ? "" : "s"}
            {selectedIds.size > 0 && ` · ${selectedIds.size} seleccionado(s)`}
          </div>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="hero" onClick={() => setEditing(EMPTY)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Nuevo banner
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Editar banner" : "Nuevo banner"}</DialogTitle>
                <DialogDescription>Diseña el copy y deja que la IA lo optimice.</DialogDescription>
              </DialogHeader>
              {editing && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Audiencia</Label>
                      <Select
                        value={editing.audience ?? "all"}
                        onValueChange={(v) => setEditing({ ...editing, audience: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="family">Familias</SelectItem>
                          <SelectItem value="professional">Profesionales</SelectItem>
                          <SelectItem value="institution">Instituciones</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Posición</Label>
                      <Select
                        value={editing.position ?? "home_hero"}
                        onValueChange={(v) => setEditing({ ...editing, position: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home_hero">Home · Hero</SelectItem>
                          <SelectItem value="home_carousel">Home · Carrusel</SelectItem>
                          <SelectItem value="dashboard">Dashboard</SelectItem>
                          <SelectItem value="search">Búsqueda</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Título</Label>
                    <Input
                      value={editing.title ?? ""}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Descripción</Label>
                    <Textarea
                      rows={3}
                      value={editing.description ?? ""}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>CTA</Label>
                      <Input
                        value={editing.cta_label ?? ""}
                        onChange={(e) => setEditing({ ...editing, cta_label: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>URL destino</Label>
                      <Input
                        value={editing.link_url ?? ""}
                        onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                        placeholder="https://…"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5" /> Imagen del banner
                    </Label>
                    <Input
                      value={editing.image_url ?? ""}
                      onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                      placeholder="Pega una URL, sube una imagen o genera con IA"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadImage(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImg || genImgLoading}
                        className="gap-1.5"
                      >
                        {uploadingImg ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        Subir imagen
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={generateImage}
                        disabled={genImgLoading || uploadingImg}
                        className="gap-1.5"
                      >
                        {genImgLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5 text-fuchsia-neural" />
                        )}
                        Generar con IA
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={useNasaImage}
                        disabled={genImgLoading || uploadingImg}
                        className="gap-1.5"
                        title="Imagen astronómica del día (NASA APOD)"
                      >
                        <Telescope className="h-3.5 w-3.5 text-biosensor" />
                        Fondo NASA
                      </Button>
                      {editing.image_url && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing({ ...editing, image_url: "" })}
                          className="gap-1.5 text-muted-foreground"
                        >
                          <X className="h-3.5 w-3.5" /> Quitar
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Subida ≤5 MB · La IA usa el título y la descripción como prompt.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editing.active ?? true}
                        onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                      />
                      <Label>Activo</Label>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={recommend}
                      disabled={aiLoading}
                      className="gap-1.5"
                    >
                      {aiLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-biosensor" />
                      )}
                      Optimizar con IA
                    </Button>
                  </div>
                  {editing.ai_recommendation && (
                    <div className="rounded-lg border border-biosensor/30 bg-biosensor/5 p-3 text-xs">
                      <div className="flex items-center gap-2 font-semibold mb-1">
                        <Sparkles className="h-3 w-3 text-biosensor" />
                        IA Score: {editing.ai_score ?? "—"}/100
                      </div>
                      <p className="text-foreground/80">{editing.ai_recommendation}</p>
                    </div>
                  )}
                  {editing.image_url && (
                    <div className="rounded-lg overflow-hidden border border-border">
                      <img
                        src={editing.image_url}
                        alt="Preview"
                        className="w-full h-32 object-cover"
                      />
                    </div>
                  )}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="hero" onClick={save}>
                  Guardar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-6 border-fuchsia-neural/30 bg-gradient-to-br from-fuchsia-neural/5 via-background to-biosensor/5 shadow-[var(--shadow-glow-fuchsia)]">
          <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-fuchsia-neural/15 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-fuchsia-neural" />
              </div>
              <div>
                <h2 className="font-display font-bold text-base">Marketing en redes sociales</h2>
                <p className="text-xs text-muted-foreground">
                  8 plantillas listas para promocionar Humanix en Facebook, WhatsApp, LinkedIn y X.
                </p>
              </div>
            </div>
            <Badge className="bg-fuchsia-neural text-fuchsia-neural-foreground text-[10px]">
              NUEVO
            </Badge>
          </div>
          <PromoCards origin={origin} />
        </Card>

        {carouselItems.length > 0 && (
          <Card className="overflow-hidden border-border">
            {/* Progress bars */}
            <div className="flex gap-0.5 p-2 pb-0">
              {carouselItems.map((_, i) => (
                <div key={i} className="h-0.5 flex-1 rounded-full overflow-hidden bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${i < carouselIdx % carouselItems.length ? "bg-biosensor w-full" : i === carouselIdx % carouselItems.length ? "bg-biosensor" : "w-0"}`}
                    style={
                      i === carouselIdx % carouselItems.length && carouselPlaying
                        ? { width: "100%", transition: "width 4s linear" }
                        : {}
                    }
                  />
                </div>
              ))}
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <h2 className="font-display font-semibold flex items-center gap-2 text-sm">
                <Eye className="h-4 w-4 text-copper" /> Vista previa carrusel
                {selectedIds.size > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {selectedIds.size} seleccionados
                  </Badge>
                )}
              </h2>
              <div className="flex items-center gap-1">
                <div className="hidden sm:flex items-center rounded-md border border-border mr-2 p-0.5">
                  <Button
                    size="sm"
                    variant={previewDevice === "desktop" ? "secondary" : "ghost"}
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => setPreviewDevice("desktop")}
                    title="Vista escritorio"
                  >
                    <Monitor className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant={previewDevice === "mobile" ? "secondary" : "ghost"}
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => setPreviewDevice("mobile")}
                    title="Vista móvil"
                  >
                    <Smartphone className="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setCarouselIdx((i) => (i - 1 + carouselItems.length) % carouselItems.length);
                    setCarouselPlaying(false);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setCarouselPlaying((p) => !p)}
                >
                  {carouselPlaying ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setCarouselIdx((i) => (i + 1) % carouselItems.length);
                    setCarouselPlaying(false);
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground ml-1 tabular-nums">
                  {(carouselIdx % carouselItems.length) + 1}/{carouselItems.length}
                </span>
              </div>
            </div>

            {(() => {
              const current = carouselItems[carouselIdx % carouselItems.length];
              if (!current) return null;
              const ctr =
                current.impressions > 0
                  ? ((current.clicks / current.impressions) * 100).toFixed(1)
                  : "0.0";
              const ctaHref = normalizeUrl(current.link_url, origin);
              // URL pública canónica del banner: una página puente
              // `/b/{id}` que emite OG tags dinámicas (título, descripción
              // e imagen del banner) y redirige al CTA real. Así Facebook,
              // LinkedIn y X muestran un preview específico de cada banner.
              const shareUrl = `${shareOrigin}/b/${current.id}`;
              const isMobile = previewDevice === "mobile";
              return (
                <div className="grid lg:grid-cols-[1fr_300px] min-h-[220px]">
                  {/* Banner visual */}
                  <div
                    className={
                      isMobile
                        ? "relative overflow-hidden bg-muted/30 min-h-[200px] flex items-center justify-center p-4"
                        : "relative overflow-hidden bg-gradient-to-br from-copper/20 via-background to-biosensor/20 min-h-[200px] flex flex-col"
                    }
                  >
                  {isMobile ? (
                    <div className="relative w-[260px] h-[440px] rounded-[2rem] border-[8px] border-foreground/80 bg-background shadow-xl overflow-hidden flex flex-col">
                      {current.image_url && (
                        <img
                          src={current.image_url}
                          alt={current.title}
                          className="absolute inset-0 w-full h-full object-cover opacity-50"
                        />
                      )}
                      <div className="relative flex-1 flex flex-col justify-end p-4">
                        <div className="flex items-center gap-1 mb-2 flex-wrap">
                          <Badge variant={current.active ? "default" : "secondary"} className="text-[9px]">
                            {current.active ? "Activo" : "Inactivo"}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] capitalize bg-background/70">
                            {current.audience}
                          </Badge>
                        </div>
                        <h3 className="font-display text-lg font-bold leading-tight drop-shadow-sm">
                          {current.title}
                        </h3>
                        {current.description && (
                          <p className="mt-1 text-xs text-foreground/80 line-clamp-3 leading-relaxed">
                            {current.description}
                          </p>
                        )}
                        {current.cta_label && (
                          <div className="mt-2">
                            {ctaHref ? (
                              <a
                                href={ctaHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-biosensor text-biosensor-foreground px-3 py-1.5 text-xs font-semibold hover:bg-biosensor/90 transition-colors"
                              >
                                {current.cta_label} <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-lg bg-muted text-muted-foreground px-3 py-1.5 text-xs font-semibold cursor-not-allowed"
                                title="Sin URL destino"
                              >
                                {current.cta_label}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                  <>
                    {current.image_url && (
                      <img
                        src={current.image_url}
                        alt={current.title}
                        className="absolute inset-0 w-full h-full object-cover opacity-40"
                      />
                    )}
                    <div className="relative flex-1 flex flex-col justify-end p-6">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge
                          variant={current.active ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {current.active ? (
                            <>
                              <CircleDot className="h-2.5 w-2.5 mr-1 animate-pulse" />
                              Activo
                            </>
                          ) : (
                            "Inactivo"
                          )}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize bg-background/70"
                        >
                          {current.audience}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] bg-background/70">
                          {current.position.replace("_", " ")}
                        </Badge>
                        {current.ai_score !== null && (
                          <Badge className="bg-biosensor text-biosensor-foreground text-[10px] gap-1">
                            <Sparkles className="h-2.5 w-2.5" />
                            {current.ai_score}/100 IA
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-display text-2xl font-bold leading-tight drop-shadow-sm">
                        {current.title}
                      </h3>
                      {current.description && (
                        <p className="mt-1.5 text-sm text-foreground/80 line-clamp-2 leading-relaxed">
                          {current.description}
                        </p>
                      )}
                      {current.ai_recommendation && (
                        <p className="mt-2 text-xs text-biosensor/90 italic border-l-2 border-biosensor/40 pl-2 line-clamp-2">
                          <Sparkles className="h-2.5 w-2.5 inline mr-1" />
                          {current.ai_recommendation}
                        </p>
                      )}
                      {current.cta_label && (
                        <div className="mt-3">
                          {ctaHref ? (
                            <a
                              href={ctaHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-biosensor text-biosensor-foreground px-4 py-2 text-sm font-semibold hover:bg-biosensor/90 transition-colors"
                            >
                              {current.cta_label} <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-lg bg-muted text-muted-foreground px-4 py-2 text-sm font-semibold cursor-not-allowed"
                              title="Sin URL destino — agrégala para habilitar el CTA"
                            >
                              {current.cta_label}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                  )}
                  </div>

                  {/* Right panel: stats + share */}
                  <div className="border-t lg:border-t-0 lg:border-l border-border p-4 space-y-4 bg-muted/20">
                    {/* KPI mini */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                        <BarChart2 className="h-3 w-3" /> Rendimiento
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          {
                            label: "Impresiones",
                            value: current.impressions.toLocaleString("es-CO"),
                            color: "text-biosensor",
                          },
                          {
                            label: "Clicks",
                            value: current.clicks.toLocaleString("es-CO"),
                            color: "text-copper",
                          },
                          {
                            label: "Shares",
                            value: current.shares_count.toLocaleString("es-CO"),
                            color: "text-fuchsia-neural",
                          },
                          {
                            label: "CTR",
                            value: `${ctr}%`,
                            color: ctr > "2" ? "text-biosensor" : "text-muted-foreground",
                          },
                        ].map(({ label, value, color }) => (
                          <div
                            key={label}
                            className="rounded-lg bg-background/80 border border-border/50 px-2 py-2 text-center"
                          >
                            <p className={`text-sm font-bold ${color}`}>{value}</p>
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                              {label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Share */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                        Compartir
                      </p>
                      <ShareButtons
                        url={shareUrl}
                        title={current.title}
                        description={current.description ?? ""}
                        onShare={async () => {
                          await supabase
                            .from("ad_banners")
                            .update({ shares_count: current.shares_count + 1 })
                            .eq("id", current.id);
                          await load();
                        }}
                      />
                      {!ctaHref && (
                        <p className="mt-1.5 text-[10px] text-muted-foreground italic">
                          Sin URL destino · se compartirá un enlace de seguimiento
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-1.5 pt-3 border-t border-border">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditing(current);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3 mr-1" /> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => void toggleActive(current)}
                        title={current.active ? "Pausar" : "Activar"}
                      >
                        <Power className="h-3 w-3 mr-1" />
                        {current.active ? "Pausar" : "Activar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => void duplicateBanner(current)}
                      >
                        <Copy className="h-3 w-3 mr-1" /> Duplicar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => void copyPreviewLink(current)}
                        title="Copiar URL del banner"
                      >
                        <Copy className="h-3 w-3 mr-1" /> Copiar URL
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs col-span-2"
                        onClick={() => remove(current.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1 text-destructive" /> Eliminar
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Dots */}
            {carouselItems.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 py-3 border-t border-border">
                {carouselItems.map((b, i) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setCarouselIdx(i);
                      setCarouselPlaying(false);
                    }}
                    className={`rounded-full transition-all ${i === carouselIdx % carouselItems.length ? "w-4 h-2 bg-biosensor" : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                  />
                ))}
              </div>
            )}
          </Card>
        )}

        <div>
          {banners.length === 0 ? (
            <Card className="p-10 text-center">
              <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-foreground">Sin banners todavía</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Crea el primero con{" "}
                <span className="font-medium text-foreground">"Nuevo banner"</span> o deja que la
                IA prepare 5 propuestas listas para lanzar.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="hero"
                  onClick={() => {
                    setEditing(EMPTY);
                    setOpen(true);
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Nuevo banner
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void seedSmart()}
                  disabled={seeding}
                  className="gap-1.5"
                >
                  {seeding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-biosensor" />
                  )}
                  {seeding ? "Creando…" : "Completar con IA · 5 banners"}
                </Button>
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">
                Los banners IA se crean como <span className="font-medium">borradores</span>{" "}
                (inactivos). Revísalos y actívalos cuando estés listo.
              </p>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {banners.map((b) => (
                <div
                  key={b.id}
                  className={`rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md ${!b.active ? "opacity-60" : ""} ${selectedIds.has(b.id) ? "ring-2 ring-biosensor" : ""}`}
                >
                  {/* Image / color header */}
                  <div className="relative h-28 bg-gradient-to-br from-copper/20 to-biosensor/20 overflow-hidden">
                    {b.image_url ? (
                      <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center opacity-30">
                        <Megaphone className="h-10 w-10" />
                      </div>
                    )}
                    {/* Overlay badges */}
                    <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
                      <Badge variant={b.active ? "default" : "secondary"} className="text-[10px]">
                        {b.active ? "Activo" : "Inactivo"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] bg-background/80 capitalize">
                        {b.audience}
                      </Badge>
                    </div>
                    {b.ai_score !== null && (
                      <div className="absolute top-2 right-2">
                        <Badge className="bg-biosensor text-biosensor-foreground text-[10px] gap-1">
                          <Sparkles className="h-2.5 w-2.5" />
                          {b.ai_score}/100
                        </Badge>
                      </div>
                    )}
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(b.id)}
                      onChange={() => toggleSelect(b.id)}
                      className="absolute bottom-2 right-2 h-4 w-4 cursor-pointer"
                    />
                  </div>

                  {/* Body */}
                  <div className="p-3 flex-1 space-y-1">
                    <p className="font-semibold text-sm truncate">{b.title}</p>
                    {b.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{b.description}</p>
                    )}
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {b.position.replace("_", " ")}
                      </Badge>
                      {b.cta_label && (
                        <Badge variant="secondary" className="text-[10px]">
                          {b.cta_label}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 border-t text-center divide-x">
                    {[
                      { label: "Imp.", value: b.impressions },
                      { label: "Clk.", value: b.clicks },
                      { label: "Shares", value: b.shares_count },
                    ].map(({ label, value }) => (
                      <div key={label} className="py-1.5">
                        <p className="text-xs font-bold">{value}</p>
                        <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-1.5 p-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setEditing(b);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => remove(b.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1 text-destructive" /> Eliminar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
