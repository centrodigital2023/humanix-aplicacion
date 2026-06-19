import { useEffect, useMemo, useState } from "react";
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
  Sparkles,
  Copy,
  Check,
  Share2,
  Hash,
  Link as LinkIcon,
  Star,
  MapPin,
  BadgeCheck,
  DollarSign,
  Stethoscope,
  Building2,
  HeartHandshake,
  Rocket,
  Shield,
  Zap,
  Gift,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { useAppUser } from "@/hooks/use-app-user";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/superadmin/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing · Redes sociales · Superadmin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MarketingPage,
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

// ---------------------------------------------------------------------------
// Tipos + utilidades compartidas
// ---------------------------------------------------------------------------

type Channel = "facebook" | "whatsapp" | "linkedin" | "x";

type ProCard = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  city: string | null;
  hourly_rate: number | null;
  avg_rating: number | null;
  verified: boolean;
};

type OfferCard = {
  id: string;
  title: string;
  city: string;
  amount: number | null;
  modality: string | null;
  specialty_required: string | null;
  created_at: string;
};

const COP = (n: number) => `$${n.toLocaleString("es-CO")}`;

function utm(path: string, source: Channel, campaign: string) {
  const base = path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: "social",
    utm_campaign: campaign,
  });
  return `${base}${base.includes("?") ? "&" : "?"}${params.toString()}`;
}

function shareHref(channel: Channel, url: string, text: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  switch (channel) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "x":
      return `https://x.com/intent/tweet?text=${t}&url=${u}`;
  }
}

const CHANNEL_META: Record<
  Channel,
  { label: string; color: string; icon: typeof Share2 }
> = {
  facebook: { label: "Facebook", color: "#1877F2", icon: Share2 },
  whatsapp: { label: "WhatsApp", color: "#25D366", icon: MessageSquare },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: Share2 },
  x: { label: "X", color: "#000000", icon: Share2 },
};

// ---------------------------------------------------------------------------
// 8 plantillas de copy + hashtags + ruta destino
// ---------------------------------------------------------------------------

type Template = {
  id: string;
  name: string;
  icon: typeof Rocket;
  tone: string;
  path: string; // ruta destino de la campaña (se concatena con UTM)
  campaign: string;
  hashtags: string[];
  // copy por canal (WA/FB/LinkedIn largos · X corto 280 char)
  copy: Record<Channel, string>;
};

const TEMPLATES: Template[] = [
  {
    id: "t1-familia",
    name: "Familias · Cuidado en casa",
    icon: HeartHandshake,
    tone: "Empático",
    path: "/familias",
    campaign: "familia-cuidado-casa",
    hashtags: [
      "#CuidadoEnCasa",
      "#SaludColombia",
      "#AdultoMayor",
      "#Humanix",
      "#EnfermeríaADomicilio",
    ],
    copy: {
      facebook:
        "¿Buscas un profesional de salud para cuidar a tu familiar en casa? 🏠💙\n\nEn Humanix encuentras auxiliares de enfermería, terapeutas y médicos VERIFICADOS con RETHUS y antecedentes al día. Reserva en minutos y paga seguro.\n\n✅ Perfil verificado por IA\n✅ Ubicación en tiempo real\n✅ Precio transparente\n✅ Soporte 24/7 en WhatsApp\n\nCuidar a quien amas ahora es simple.",
      whatsapp:
        "Hola 👋 Te comparto Humanix, la plataforma para contratar profesionales de salud verificados en Colombia. Ideal si necesitas cuidado en casa para un familiar. Todos los perfiles están verificados con RETHUS y tienen calificación en tiempo real. 💙",
      linkedin:
        "Humanix transforma el cuidado en casa en Colombia: conectamos a familias con auxiliares de enfermería, terapeutas y médicos verificados con RETHUS y antecedentes al día. IA que sugiere el mejor match, pagos inmediatos y trazabilidad total. La atención en casa merece estándares clínicos.",
      x: "Cuidar a tu familiar en casa ya es simple 💙\n\nProfesionales verificados con RETHUS, IA que encuentra el match ideal y pagos seguros.",
    },
  },
  {
    id: "t2-profesional",
    name: "Profesionales · Gana más",
    icon: Stethoscope,
    tone: "Motivacional",
    path: "/profesionales",
    campaign: "profesional-gana-mas",
    hashtags: [
      "#Enfermería",
      "#TrabajoSalud",
      "#EmpleoColombia",
      "#Humanix",
      "#AuxiliarEnfermería",
    ],
    copy: {
      facebook:
        "Eres auxiliar de enfermería, terapeuta o médico? 🩺\n\nEn Humanix decides cuándo, dónde y cuánto cobras. Te conectamos con familias y clínicas cerca de ti, con pagos inmediatos y agenda flexible.\n\n🚀 Sin comisiones ocultas\n📍 Ofertas cerca de tu barrio\n💵 Cobras al terminar el servicio\n🛡️ Soporte y seguro incluido\n\nPostúlate gratis hoy.",
      whatsapp:
        "🩺 ¿Eres profesional de salud? En Humanix te conectamos con familias y clínicas cerca de ti, decides tu agenda y cobras inmediato. Regístrate gratis:",
      linkedin:
        "Humanix redefine el empleo en salud para Colombia: flexibilidad, pagos inmediatos, ofertas georreferenciadas e IA que te recomienda los servicios mejor pagados según tu perfil. Si eres auxiliar de enfermería, terapeuta o profesional clínico, aquí decides cuándo trabajas y cuánto ganas.",
      x: "Profesional de salud 🩺\nDecide cuándo trabajas, cuánto cobras y dónde. Humanix te conecta con las mejores ofertas cerca de ti.",
    },
  },
  {
    id: "t3-instituciones",
    name: "Clínicas · Cubre turnos",
    icon: Building2,
    tone: "B2B",
    path: "/talento-humano",
    campaign: "institucion-turnos",
    hashtags: [
      "#TalentoHumanoEnSalud",
      "#GestiónClínica",
      "#Humanix",
      "#TurnosMédicos",
    ],
    copy: {
      facebook:
        "Clínicas, IPS y centros médicos 🏥\n\n¿Problemas para cubrir turnos o encontrar talento verificado? Humanix te da acceso a miles de profesionales con RETHUS al día, scoring por IA y cobertura en minutos.",
      whatsapp:
        "🏥 Humanix ayuda a clínicas e IPS a cubrir turnos con profesionales verificados en minutos. Panel B2B, scoring por IA y facturación electrónica.",
      linkedin:
        "Para directores médicos y jefes de talento humano: Humanix resuelve la cobertura de turnos con un marketplace verificado (RETHUS, antecedentes, vacunación) y matchmaking por IA. Integración con HIS, facturación electrónica DIAN y reportes en tiempo real. Escala tu operación sin sacrificar calidad.",
      x: "Cubrir un turno clínico ya no toma 3 días 🏥\nHumanix: talento verificado + IA para instituciones de salud.",
    },
  },
  {
    id: "t4-ia",
    name: "Tecnología · IA + verificación",
    icon: Sparkles,
    tone: "Producto",
    path: "/tecnologia",
    campaign: "tecnologia-ia",
    hashtags: ["#IA", "#HealthTech", "#SaludDigital", "#Humanix", "#AI"],
    copy: {
      facebook:
        "Humanix no es solo un directorio. Es IA en tiempo real: verifica documentos, detecta fraude, sugiere el match perfecto entre profesional y paciente, y clasifica PQRS automáticamente. Tecnología colombiana al servicio de la salud. ⚡",
      whatsapp:
        "⚡ Humanix combina IA + RETHUS + embeddings semánticos para verificar, matchear y proteger a familias, profesionales y clínicas en Colombia.",
      linkedin:
        "Cómo usamos IA en Humanix:\n— Verificación automática de cédulas, tarjetas profesionales y RETHUS\n— Embeddings semánticos para match profesional↔oferta\n— Detección de fraude en reseñas y perfiles\n— Clasificación automática de PQRS\n\nLa salud colombiana merece infraestructura de primer mundo.",
      x: "Humanix = IA + salud ⚡\nVerificación automática, matchmaking semántico y antifraude en tiempo real.",
    },
  },
  {
    id: "t5-seguridad",
    name: "Confianza · Habeas Data",
    icon: Shield,
    tone: "Institucional",
    path: "/cumplimiento",
    campaign: "confianza-habeasdata",
    hashtags: [
      "#HabeasData",
      "#Cumplimiento",
      "#SaludSegura",
      "#Humanix",
      "#PrivacidadEnSalud",
    ],
    copy: {
      facebook:
        "Tu salud y tus datos están protegidos 🛡️\n\nHumanix cumple con la Ley 1581 de Habeas Data, la Resolución 3100 del MinSalud y estándares internacionales de ciberseguridad. Tu familia y tu información clínica, seguras.",
      whatsapp:
        "🛡️ En Humanix tus datos están protegidos: Ley 1581 Habeas Data, Resolución 3100 MinSalud y cifrado end-to-end.",
      linkedin:
        "Cumplimiento regulatorio en Humanix: Habeas Data (Ley 1581), Resolución 3100 MinSalud, RETHUS verificado, cifrado en reposo y en tránsito, auditoría inmutable de eventos clínicos. Porque la confianza empieza por la infraestructura.",
      x: "Tus datos de salud, seguros 🛡️\nHumanix: Habeas Data + RETHUS + auditoría inmutable.",
    },
  },
  {
    id: "t6-rapidez",
    name: "Reserva en minutos",
    icon: Zap,
    tone: "Urgencia",
    path: "/buscar",
    campaign: "reserva-rapida",
    hashtags: [
      "#CuidadoUrgente",
      "#SaludADomicilio",
      "#Humanix",
      "#ReservaYa",
    ],
    copy: {
      facebook:
        "¿Una emergencia? ⚡\nEn menos de 15 minutos tienes un profesional de salud verificado camino a tu casa. Humanix: la forma más rápida y segura de conseguir cuidado en Colombia.",
      whatsapp:
        "⚡ ¿Necesitas atención en casa YA? Humanix te envía un profesional verificado en minutos. Busca y reserva aquí:",
      linkedin:
        "Cuando el tiempo importa, Humanix entrega un profesional de salud verificado en menos de 15 minutos. Porque la atención en casa debe ser tan ágil como las urgencias hospitalarias.",
      x: "⚡ Cuidado en casa en menos de 15 min. Profesionales verificados, cerca de ti, con Humanix.",
    },
  },
  {
    id: "t7-familia-refer",
    name: "Referidos · Plan familiar",
    icon: Gift,
    tone: "Promocional",
    path: "/planes",
    campaign: "referidos-familia",
    hashtags: [
      "#PlanFamiliar",
      "#Referidos",
      "#Humanix",
      "#SaludColombia",
    ],
    copy: {
      facebook:
        "Invita a tu familia y gana 🎁\n\nCon el Plan Familiar de Humanix tu primer mes es GRATIS y ganas créditos por cada amigo que se registre. Cuidado de calidad para toda la familia, sin complicaciones.",
      whatsapp:
        "🎁 Plan Familiar Humanix: primer mes GRATIS + créditos por cada amigo que invites. Cuidado premium para toda tu familia:",
      linkedin:
        "Humanix lanza el Plan Familiar: un solo pago mensual cubre a todos los adultos mayores de tu hogar con cuidado preventivo, visitas programadas y respuesta ante emergencias. Primer mes gratis para familias que invitan a otras familias.",
      x: "🎁 Plan Familiar Humanix: 1er mes gratis + créditos por referidos. Cuida a toda tu familia con un solo clic.",
    },
  },
  {
    id: "t8-rocket",
    name: "Humanix · Lanzamiento",
    icon: Rocket,
    tone: "Branding",
    path: "/",
    campaign: "lanzamiento",
    hashtags: [
      "#Humanix",
      "#SaludColombia",
      "#HealthTechCO",
      "#TalentoHumanoEnSalud",
    ],
    copy: {
      facebook:
        "🚀 Bienvenidos a Humanix — la plataforma que está cambiando el talento humano en salud de Colombia.\n\nProfesionales verificados · IA en tiempo real · Pagos inmediatos · Cuidado con corazón.\n\nÚnete a la revolución.",
      whatsapp:
        "🚀 Humanix ya está aquí. Talento humano en salud verificado con IA, para familias, profesionales y clínicas en Colombia. Descúbrelo:",
      linkedin:
        "Humanix se lanza oficialmente en Colombia: un marketplace de talento humano en salud que combina verificación RETHUS, IA para match y antifraude, pagos inmediatos y auditoría clínica. Cuidar ya no tiene que ser complicado.",
      x: "🚀 Humanix ya está aquí. Talento en salud verificado + IA en tiempo real. Colombia merece esto. #Humanix",
    },
  },
];

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

function MarketingPage() {
  const { user, loading, logout } = useAppUser();
  const [pros, setPros] = useState<ProCard[]>([]);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setDataLoading(true);
      try {
        const [{ data: prosData }, { data: offersData }] = await Promise.all([
          supabase
            .from("professional_profiles")
            .select(
              "user_id, specialty, hourly_rate, avg_rating, home_city, active, published, verified",
            )
            .eq("active", true)
            .eq("published", true)
            .order("avg_rating", { ascending: false, nullsFirst: false })
            .limit(24),
          supabase
            .from("job_offers")
            .select(
              "id, title, city, amount, modality, specialty_required, created_at, status",
            )
            .eq("status", "open")
            .order("created_at", { ascending: false })
            .limit(24),
        ]);

        const proIds = (prosData ?? []).map((p) => p.user_id);
        const nameMap = new Map<
          string,
          { full_name: string | null; avatar_url: string | null; city: string | null }
        >();
        if (proIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url, city")
            .in("user_id", proIds);
          (profs ?? []).forEach((p) =>
            nameMap.set(p.user_id, {
              full_name: p.full_name,
              avatar_url: p.avatar_url,
              city: p.city,
            }),
          );
        }

        setPros(
          (prosData ?? []).map((p) => {
            const info = nameMap.get(p.user_id);
            return {
              user_id: p.user_id,
              full_name: info?.full_name ?? null,
              avatar_url: info?.avatar_url ?? null,
              specialty: p.specialty ?? null,
              city: p.home_city ?? info?.city ?? null,
              hourly_rate: p.hourly_rate ?? null,
              avg_rating: p.avg_rating ?? null,
              verified: p.verified === true,
            };
          }),
        );

        setOffers(
          (offersData ?? []).map((o) => ({
            id: o.id,
            title: o.title,
            city: o.city ?? "Colombia",
            amount: o.amount ?? null,
            modality: o.modality ?? null,
            specialty_required: o.specialty_required ?? null,
            created_at: o.created_at,
          })),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error cargando datos");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [user]);

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
          <h1 className="text-lg font-semibold">Inicia sesión</h1>
          <p className="text-sm text-muted-foreground">
            El módulo de marketing es solo para superadmin y equipo de growth.
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

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Marketing · Redes sociales"
      subtitle="8 plantillas listas + tarjetas dinámicas de profesionales y ofertas activas. Un clic para compartir con UTM ya inyectadas."
      crumbs={[{ label: "Superadmin", to: "/superadmin" }, { label: "Marketing" }]}
      badge={{ label: "Growth", tone: "bio" }}
    >
      <Tabs defaultValue="templates" className="space-y-6">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="templates" className="gap-2">
            <Sparkles className="h-3.5 w-3.5" /> 8 plantillas
          </TabsTrigger>
          <TabsTrigger value="pros" className="gap-2">
            <Stethoscope className="h-3.5 w-3.5" /> Profesionales activos ({pros.length})
          </TabsTrigger>
          <TabsTrigger value="offers" className="gap-2">
            <Briefcase className="h-3.5 w-3.5" /> Ofertas abiertas ({offers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {TEMPLATES.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pros" className="space-y-4">
          {dataLoading ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Cargando profesionales…
            </Card>
          ) : pros.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Sin profesionales activos y publicados en este momento.
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {pros.map((p) => (
                <ProShareCard key={p.user_id} pro={p} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="offers" className="space-y-4">
          {dataLoading ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Cargando ofertas…
            </Card>
          ) : offers.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Sin ofertas abiertas en este momento.
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {offers.map((o) => (
                <OfferShareCard key={o.id} offer={o} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas de share
// ---------------------------------------------------------------------------

const CHANNELS: Channel[] = ["whatsapp", "facebook", "linkedin", "x"];

function ChannelButtons({
  channels = CHANNELS,
  url,
  text,
  onShare,
}: {
  channels?: Channel[];
  url: string;
  text: string;
  onShare?: (c: Channel) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {channels.map((c) => {
        const meta = CHANNEL_META[c];
        return (
          <a
            key={c}
            href={shareHref(c, url, text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShare?.(c)}
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border bg-card px-3 py-1.5 hover:bg-foreground hover:text-background transition-colors"
            style={{ color: meta.color }}
          >
            <meta.icon className="h-3.5 w-3.5" />
            <span className="text-foreground/80">{meta.label}</span>
          </a>
        );
      })}
    </div>
  );
}

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copiado");
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error("No se pudo copiar");
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copiado" : label}
    </Button>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [copy, setCopy] = useState<string>(template.copy[channel]);

  // Update editable copy when channel changes (keeps manual edits when same channel).
  useEffect(() => {
    setCopy(template.copy[channel]);
  }, [channel, template]);

  const url = useMemo(() => utm(template.path, channel, template.campaign), [template, channel]);
  const hashtagStr = template.hashtags.join(" ");
  const shareText = `${copy}\n\n${hashtagStr}`;
  const Icon = template.icon;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-biosensor/10 text-biosensor flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold font-display leading-tight">{template.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tono · <span className="font-medium text-foreground/80">{template.tone}</span>
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
          {template.campaign}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {(["whatsapp", "facebook", "linkedin", "x"] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`text-[11px] rounded-md px-2.5 py-1 border transition-colors ${
              channel === c
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {CHANNEL_META[c].label}
          </button>
        ))}
      </div>

      <Textarea
        value={copy}
        onChange={(e) => setCopy(e.target.value)}
        rows={channel === "x" ? 3 : 6}
        className="text-sm"
      />

      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Hash className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p className="leading-relaxed break-words">{hashtagStr}</p>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground break-all">
        <LinkIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{url}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChannelButtons url={url} text={shareText} />
        <div className="flex gap-2">
          <CopyButton value={shareText} label="Texto" />
          <CopyButton value={url} label="Link" />
        </div>
      </div>
    </Card>
  );
}

function ProShareCard({ pro }: { pro: ProCard }) {
  const name = pro.full_name || "Profesional Humanix";
  const specialty = pro.specialty || "Profesional de salud";
  const path = `/profesional/${pro.user_id}`;
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const url = utm(path, channel, "pro-destacado");

  const price = pro.hourly_rate ? COP(pro.hourly_rate) + "/h" : "Tarifa flexible";
  const rating = pro.avg_rating != null ? pro.avg_rating.toFixed(1) : null;
  const city = pro.city || "Colombia";

  const copy =
    channel === "x"
      ? `${name} · ${specialty} en ${city} ${rating ? `· ⭐ ${rating}` : ""}\nReserva en Humanix 👇`
      : `👨‍⚕️ ${name}\n${specialty} · ${city}\n${rating ? `⭐ ${rating} de calificación · ` : ""}${price}${pro.verified ? "\n✅ Perfil verificado con RETHUS" : ""}\n\nReserva este profesional verificado en Humanix:`;

  const hashtags = [
    "#Humanix",
    `#${(pro.specialty || "Salud").replace(/\s+/g, "")}`,
    `#${(pro.city || "Colombia").replace(/\s+/g, "")}`,
    "#CuidadoEnCasa",
  ].join(" ");
  const shareText = `${copy}\n\n${hashtags}`;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-3">
        {pro.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pro.avatar_url}
            alt={name}
            className="h-12 w-12 rounded-full object-cover border border-border"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-biosensor/10 text-biosensor flex items-center justify-center font-semibold">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold font-display truncate">{name}</h3>
            {pro.verified && <BadgeCheck className="h-4 w-4 text-biosensor" />}
          </div>
          <p className="text-xs text-muted-foreground truncate">{specialty}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {city}
        </span>
        {rating && (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {rating}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <DollarSign className="h-3.5 w-3.5" /> {price}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {(["whatsapp", "facebook", "linkedin", "x"] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`text-[11px] rounded-md px-2.5 py-1 border transition-colors ${
              channel === c
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {CHANNEL_META[c].label}
          </button>
        ))}
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {shareText}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChannelButtons url={url} text={shareText} />
        <div className="flex gap-2">
          <CopyButton value={shareText} label="Texto" />
          <CopyButton value={url} label="Link" />
        </div>
      </div>
    </Card>
  );
}

function OfferShareCard({ offer }: { offer: OfferCard }) {
  const path = `/oferta/${offer.id}`;
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const url = utm(path, channel, "oferta-activa");

  const amount = offer.amount ? COP(offer.amount) : "A convenir";
  const specialty = offer.specialty_required || "General";

  const copy =
    channel === "x"
      ? `💼 ${offer.title}\n📍 ${offer.city} · ${specialty}\n💵 ${amount}\nPostúlate en Humanix 👇`
      : `💼 Nueva oferta en Humanix\n\n"${offer.title}"\n📍 ${offer.city}\n🩺 ${specialty}\n💵 ${amount}${offer.modality ? `\n🗓️ ${offer.modality}` : ""}\n\nSi eres profesional de salud, postúlate ya:`;

  const hashtags = [
    "#EmpleoSalud",
    `#${(offer.city || "Colombia").replace(/\s+/g, "")}`,
    `#${(offer.specialty_required || "Salud").replace(/\s+/g, "")}`,
    "#Humanix",
  ].join(" ");
  const shareText = `${copy}\n\n${hashtags}`;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold font-display leading-tight">{offer.title}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1.5">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {offer.city}
            </span>
            <span className="inline-flex items-center gap-1">
              <Stethoscope className="h-3.5 w-3.5" /> {specialty}
            </span>
            <span className="inline-flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" /> {amount}
            </span>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          Abierta
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {(["whatsapp", "facebook", "linkedin", "x"] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`text-[11px] rounded-md px-2.5 py-1 border transition-colors ${
              channel === c
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {CHANNEL_META[c].label}
          </button>
        ))}
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {shareText}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChannelButtons url={url} text={shareText} />
        <div className="flex gap-2">
          <CopyButton value={shareText} label="Texto" />
          <CopyButton value={url} label="Link" />
        </div>
      </div>
    </Card>
  );
}

// Also export some helpers used by tests in future.
// (kept internal for now — route file)

// Label import linter happy (unused so far but may be added)
void Label;
void Input;
