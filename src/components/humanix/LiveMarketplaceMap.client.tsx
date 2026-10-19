// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Power,
  PowerOff,
  Loader2,
  Users,
  Building2,
  HeartPulse,
  MapPin,
  Crosshair,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { geocodeCity, getBrowserLocation, distanceKm, formatKm } from "@/lib/geo";
import { Star, User as UserIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clusterMarkers, isCluster } from "@/lib/marker-clustering";
import { useThrottle } from "@/hooks/use-throttle";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { usePresence } from "@/hooks/use-presence";
import {
  liveMapKeys,
  useLiveCounts,
  useMapDemand,
  useMapInstitutions,
  useValidatedMapProfessionals,
} from "@/hooks/use-live-map";
import { counterItems, demandHeadline, EMPTY_COUNTS, withPosition } from "@/lib/liveMap";
import { toCell } from "@/lib/presence";
import { trustBadgeText } from "@/lib/trustScore";

type Role = "professional" | "family" | "institution" | "guest";

type Point = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  kind: "professional" | "family" | "institution";
  userId?: string;
  avatarUrl?: string | null;
  fullName?: string | null;
  rating?: number | null;
  hourlyRate?: number | null;
  city?: string | null;
  meta?: string | null;
  specialty?: string | null;
  gender?: string | null;
  yearsExperience?: number | null;
  subSpecialties?: string[] | null;
  availabilityStatus?: "available" | "busy" | "away" | null;
  /** Con la aplicación abierta ahora mismo. */
  isLive?: boolean;
  /** «82 · Alto»: el Trust Score ya redactado. */
  trust?: string | null;
  /** Familias con oferta abierta: la oferta que se abre. */
  offerId?: string | null;
  /** Lo que hay abierto («2 ofertas · hasta $24.000/h»). */
  headline?: string | null;
};

const COLORS = {
  professional: "#2563eb", // blue
  family: "#f2b705", // premium yellow
  institution: "#d4145a", // fuchsia
};

function makeMarkerIcon(
  kind: "professional" | "family" | "institution",
  status: "available" | "busy" | "away" | null = "available",
  selected = false,
  hasExactLocation = true,
  isLive = false,
) {
  const shape = kind === "institution" ? "6px" : "9999px";
  const baseColor = COLORS[kind];
  const color = status === "busy" ? "#f59e0b" : status === "away" ? "#9ca3af" : baseColor;
  // GPS en vivo → pulso rápido; disponible normal → pulso normal; ocupado → pulso lento
  const dur = isLive ? 0.9 : kind === "professional" ? 2 : kind === "family" ? 2.4 : 2.8;
  const pulse = isLive
    ? `animation:livePulse ${dur}s infinite`
    : status === "available" && hasExactLocation
      ? `animation:livePulse ${dur}s infinite`
      : status === "busy"
        ? "animation:livePulseSlow 3.5s infinite"
        : "";
  const base = kind === "institution" ? 24 : 22;
  const size = base + (selected ? 6 : 0) + (isLive ? 2 : 0);
  // Anillo extra para usuarios con GPS en vivo activo
  const liveRing = isLive ? `,0 0 0 8px ${color}28,0 0 0 15px ${color}12` : "";
  const ring = selected
    ? `0 0 0 5px ${color}55,0 0 0 12px ${color}22,0 6px 20px rgba(0,0,0,.45)${liveRing}`
    : `0 0 0 4px ${color}44,0 4px 14px rgba(0,0,0,.35)${liveRing}`;
  // Ubicación aproximada: borde punteado + opacidad reducida
  const approxStyle = hasExactLocation
    ? `border:3px solid white`
    : `border:2.5px dashed white;opacity:0.72`;
  // Indicador verde "en vivo" sobre el marcador
  const liveIndicator = isLive
    ? `<span style="position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:9999px;background:#22c55e;border:2px solid white;box-shadow:0 0 5px #22c55e80"></span>`
    : "";
  return L.divIcon({
    className: "live-marker",
    html: `<div style="position:relative;display:inline-block">${liveIndicator}<div style="width:${size}px;height:${size}px;border-radius:${shape};background:${color};${approxStyle};box-shadow:${ring};${pulse};transition:all .15s ease"></div></div>`,
    iconSize: [size + 4, size + 4],
    iconAnchor: [(size + 4) / 2, (size + 4) / 2],
  });
}

/** Colores y texto del estado en la ventana del pin (disponible / ocupado / no disponible). */
function statusStyle(status: "available" | "busy" | "away" | null | undefined) {
  if (status === "busy")
    return { soft: "#f59e0b22", text: "#d97706", dot: "#f59e0b", label: "Ocupado" };
  if (status === "away")
    return { soft: "#9ca3af22", text: "#6b7280", dot: "#9ca3af", label: "No disponible" };
  return { soft: "#22c55e22", text: "#16a34a", dot: "#22c55e", label: "Disponible ahora" };
}

const ME_ICON = () =>
  L.divIcon({
    className: "live-marker-me",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:oklch(0.78 0.18 165);border:4px solid white;box-shadow:0 0 0 5px oklch(0.78 0.18 165 / .35), 0 6px 18px rgba(0,0,0,.4)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [points, map]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: any) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  const throttled = useThrottle((z: number) => onZoom(z), 250);
  useEffect(() => {
    onZoom(map.getZoom());
  }, []);
  useMapEvents({
    zoomend() {
      throttled(map.getZoom());
    },
  });
  return null;
}

function makeClusterIcon(counts: { professional: number; family: number; institution: number }) {
  const total = counts.professional + counts.family + counts.institution;
  const size = total > 100 ? 56 : total > 25 ? 48 : total > 8 ? 42 : 36;
  const seg = (color: string, n: number) =>
    n > 0
      ? `<span style="display:inline-flex;align-items:center;gap:2px;color:${color};font-weight:700">●${n}</span>`
      : "";
  return L.divIcon({
    className: "live-cluster",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:linear-gradient(135deg,#1f2937,#0f172a);border:3px solid white;box-shadow:0 0 0 4px rgba(59,130,246,.25),0 6px 18px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-weight:800;font-size:${size > 44 ? 15 : 13}px;line-height:1">${total}<span style="font-size:8px;font-weight:600;opacity:.75;margin-top:1px">en zona</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function RecenterOn({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 13));
    }
  }, [lat, lng]);
  return null;
}

export function LiveMarketplaceMap({
  role,
  userId,
  height = 360,
  pickLocation,
  preview = false,
}: {
  role?: Role;
  userId?: string;
  height?: number;
  preview?: boolean;
  pickLocation?: {
    lat: number | null;
    lng: number | null;
    onChange: (lat: number, lng: number, address?: string) => void;
    defaultCity?: string;
  };
}) {
  const effectiveRole: Role = role ?? "guest";
  const isGuest = preview || effectiveRole === "guest" || !userId;
  const navigate = useNavigate();

  // ── Presencia: «en vivo» mientras se usa la aplicación; el profesional puede, además, compartir su zona aproximada (~1 km) ──
  const {
    isSharing: isTracking,
    startSharing,
    stopSharing,
    error: presenceError,
  } = usePresence({
    userId: !isGuest ? userId : undefined,
    enabled: !isGuest && effectiveRole !== "guest",
  });
  // Antes esto abría un modal de pantalla completa que tapaba el mapa por
  // completo ("el mapa queda detrás del registro"). En Uber/InDrive puedes
  // explorar el mapa libremente sin cuenta — el registro es una invitación
  // suave, no una pared. Por eso usamos un toast con acción: el mapa nunca
  // deja de verse ni de poder explorarse.
  const requireAuth = (): boolean => {
    if (isGuest) {
      toast("Crea tu cuenta gratis para continuar", {
        description:
          "Marca tu ubicación, activa tu visibilidad y usa los filtros inteligentes — gratis, en 1 minuto.",
        action: {
          label: "Registrarme",
          onClick: () => navigate({ to: "/auth" }),
        },
      });
      return true;
    }
    return false;
  };
  const [toggling, setToggling] = useState(false);
  const [available, setAvailable] = useState(true);
  const [picking, setPicking] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterAvailability, setFilterAvailability] = useState<"all" | "available" | "busy">("all");
  const [meCoords, setMeCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: pickLocation?.lat ?? null,
    lng: pickLocation?.lng ?? null,
  });
  // Self location persistence for family/institution roles (no external pickLocation prop)
  const selfPersist =
    !pickLocation && !isGuest && (effectiveRole === "family" || effectiveRole === "institution");
  // Filters visible to all authenticated roles
  const showFilters = !isGuest;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterSpecialty, setFilterSpecialty] = useState("");
  const [filterGender, setFilterGender] = useState<string>("any");
  const [filterMinYears, setFilterMinYears] = useState<string>("");
  const [filterMinRating, setFilterMinRating] = useState<string>("any");
  const [filterMaxKm, setFilterMaxKm] = useState<string>("");
  const [filterRequirement, setFilterRequirement] = useState("");
  const [filterSortBy, setFilterSortBy] = useState<"distance" | "rating" | "experience">(
    "distance",
  );

  useEffect(() => {
    setMeCoords({ lat: pickLocation?.lat ?? null, lng: pickLocation?.lng ?? null });
  }, [pickLocation?.lat, pickLocation?.lng]);

  // Auto-presencia estilo Uber/InDrive: si el usuario no tiene ubicación
  // guardada, la capturamos sola (GPS del navegador y, si no hay permiso,
  // geocodificando su ciudad) y la persistimos — así aparece "en línea" en
  // el mapa desde el primer momento, sin pasos manuales. Solo desaparece si
  // se apaga con el botón "Apagar".
  useEffect(() => {
    if (!userId || isGuest || effectiveRole === "guest" || pickLocation) return;
    let cancelled = false;
    const resolveLoc = async (city: string | null) => {
      const gps = await getBrowserLocation();
      if (gps) return gps;
      return city ? await geocodeCity(city) : null;
    };
    (async () => {
      try {
        if (effectiveRole === "institution") {
          const { data } = await supabase
            .from("institution_profiles")
            .select("lat, lng, city")
            .eq("user_id", userId)
            .maybeSingle();
          if (data?.lat != null && data?.lng != null) {
            if (!cancelled) setMeCoords({ lat: Number(data.lat), lng: Number(data.lng) });
            return;
          }
          const loc = await resolveLoc(data?.city ?? null);
          if (!loc || cancelled) return;
          await supabase
            .from("institution_profiles")
            .update({ lat: loc.lat, lng: loc.lng })
            .eq("user_id", userId);
          if (!cancelled) setMeCoords(loc);
        } else if (effectiveRole === "family") {
          const { data } = await supabase
            .from("family_profiles")
            .select("default_lat, default_lng, default_address")
            .eq("user_id", userId)
            .maybeSingle();
          if (data?.default_lat != null && data?.default_lng != null) {
            if (!cancelled)
              setMeCoords({ lat: Number(data.default_lat), lng: Number(data.default_lng) });
            return;
          }
          const loc = await resolveLoc(data?.default_address ?? null);
          if (!loc || cancelled) return;
          await supabase
            .from("family_profiles")
            .update({ default_lat: loc.lat, default_lng: loc.lng })
            .eq("user_id", userId);
          if (!cancelled) setMeCoords(loc);
        } else if (effectiveRole === "professional") {
          const { data } = await supabase
            .from("professional_profiles")
            .select("lat, lng, home_city")
            .eq("user_id", userId)
            .maybeSingle();
          if (data?.lat != null && data?.lng != null) {
            if (!cancelled) setMeCoords({ lat: Number(data.lat), lng: Number(data.lng) });
            return;
          }
          const loc = await resolveLoc(data?.home_city ?? null);
          if (!loc || cancelled) return;
          // Lo del profesional es legible por cualquier cuenta: se guarda en la cuadrícula de ~1 km, no el punto exacto.
          await supabase
            .from("professional_profiles")
            .update({ lat: toCell(loc.lat), lng: toCell(loc.lng) })
            .eq("user_id", userId);
          if (!cancelled) setMeCoords(loc);
        }
      } catch (e) {
        console.warn("[LiveMap] auto-presence failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, effectiveRole, isGuest, pickLocation]);

  // Load own availability
  useEffect(() => {
    if (isGuest) return;
    (async () => {
      try {
        if (effectiveRole === "professional") {
          const { data } = await supabase
            .from("professional_profiles")
            .select("available")
            .eq("user_id", userId)
            .maybeSingle();
          setAvailable(data?.available === true);
        } else if (effectiveRole === "family") {
          const { data } = await supabase
            .from("family_profiles")
            .select("visible_on_map")
            .eq("user_id", userId)
            .maybeSingle();
          setAvailable(data?.visible_on_map ?? true);
        } else {
          const { data } = await supabase
            .from("institution_profiles")
            .select("visible_on_map")
            .eq("user_id", userId)
            .maybeSingle();
          setAvailable(data?.visible_on_map ?? true);
        }
      } catch (e) {
        console.warn("[LiveMap] could not load availability", e);
      }
    })();
  }, [effectiveRole, userId, isGuest]);

  // Datos: funciones seguras de la base (sin teléfono ni dirección, posiciones en cuadrícula de ~1 km). Se actualizan solas cuando la
  // base avisa que algo cambió. Cada quien ve lo que le sirve: los profesionales, a quien los necesita; los demás, a los profesionales.
  const qc = useQueryClient();
  const authed = !isGuest;
  const showPros = effectiveRole !== "professional";
  const showFamilies = authed && effectiveRole === "professional";
  // Solo profesionales con los datos validados del buscador (nombre autorizado, ciudad y turnos): ver `lib/mapDirectory.ts`.
  const prosQ = useValidatedMapProfessionals({ authed, enabled: showPros });
  const demandQ = useMapDemand({ authed, enabled: showFamilies });
  const instQ = useMapInstitutions({ authed });
  const countsQ = useLiveCounts({ authed });
  const loading =
    (showPros && prosQ.isLoading) || (showFamilies && demandQ.isLoading) || instQ.isLoading;

  const pros = useMemo<Point[]>(
    () =>
      withPosition(prosQ.data ?? []).map((p) => ({
        id: `pro-${p.id}`,
        lat: p.lat,
        lng: p.lng,
        kind: "professional" as const,
        title: p.specialty || "Profesional",
        subtitle: `${p.city ?? ""}${p.hourlyRate ? ` · $${Number(p.hourlyRate).toLocaleString("es-CO")}/h` : ""}`,
        userId: p.id,
        avatarUrl: p.avatarUrl,
        fullName: p.name,
        rating: p.rating,
        hourlyRate: p.hourlyRate,
        city: p.city,
        meta: p.specialty,
        specialty: p.specialty,
        gender: p.gender,
        yearsExperience: p.yearsExperience,
        subSpecialties: p.subSpecialties,
        trust: p.trust.score != null ? trustBadgeText(p.trust) : null,
        isLive: p.live,
        availabilityStatus:
          p.status === "busy"
            ? ("busy" as const)
            : p.status === "available"
              ? ("available" as const)
              : ("away" as const),
      })),
    [prosQ.data],
  );
  const families = useMemo<Point[]>(
    () =>
      withPosition((demandQ.data ?? []).filter((d) => d.kind === "family")).map((d) => ({
        id: `fam-${d.id}`,
        lat: d.lat,
        lng: d.lng,
        kind: "family" as const,
        title: `Familia · ${d.name}`,
        subtitle: demandHeadline(d),
        userId: d.id,
        city: d.city,
        meta: d.city,
        headline: demandHeadline(d),
        offerId: d.offerId,
        trust: d.trust.score != null ? trustBadgeText(d.trust) : null,
        availabilityStatus: "available" as const,
      })),
    [demandQ.data],
  );
  const institutions = useMemo<Point[]>(
    () =>
      withPosition(instQ.data ?? []).map((i) => ({
        id: `inst-${i.id}`,
        lat: i.lat,
        lng: i.lng,
        kind: "institution" as const,
        title: i.name,
        subtitle: `${i.type ?? ""}${i.city ? ` · ${i.city}` : ""}`,
        userId: i.id,
        fullName: i.name,
        city: i.city,
        meta: i.type,
        headline:
          i.openOffers > 0
            ? `${i.openOffers} ${i.openOffers === 1 ? "oferta abierta" : "ofertas abiertas"}`
            : null,
        isLive: i.live,
        availabilityStatus:
          i.status === "available"
            ? ("available" as const)
            : i.status === "busy"
              ? ("busy" as const)
              : ("away" as const),
      })),
    [instQ.data],
  );

  const toggleAvailability = async () => {
    if (isGuest || !userId) return;
    setToggling(true);
    try {
      const next = !available;
      let error: any = null;
      if (effectiveRole === "professional") {
        ({ error } = await supabase
          .from("professional_profiles")
          .update({ available: next })
          .eq("user_id", userId));
      } else if (effectiveRole === "family") {
        ({ error } = await supabase
          .from("family_profiles")
          .update({ visible_on_map: next })
          .eq("user_id", userId));
      } else {
        ({ error } = await supabase
          .from("institution_profiles")
          .update({ visible_on_map: next })
          .eq("user_id", userId));
      }
      if (error) throw error;
      setAvailable(next);
      toast.success(
        effectiveRole === "professional"
          ? next
            ? "Estás disponible. Sigue así aunque cierres Humanix o apagues el celular."
            : "Quedaste como no disponible: sigues en el mapa, marcado así."
          : next
            ? "Estás visible en el mapa"
            : "Te ocultaste del mapa",
      );
      void qc.invalidateQueries({ queryKey: liveMapKeys.all });
    } catch (e: any) {
      toast.error("No se pudo actualizar disponibilidad");
      console.error(e);
    } finally {
      setToggling(false);
    }
  };

  // Apply filters to professionals
  const filteredPros = useMemo<Point[]>(() => {
    let list = pros.slice();
    if (filterAvailability !== "all") {
      list = list.filter((p) => p.availabilityStatus === filterAvailability);
    }
    const q = filterSpecialty.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const hay = `${p.specialty ?? ""} ${(p.subSpecialties ?? []).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (filterGender !== "any") {
      list = list.filter((p) => (p.gender ?? "").toLowerCase() === filterGender);
    }
    const minY = parseInt(filterMinYears, 10);
    if (!Number.isNaN(minY) && minY > 0) {
      list = list.filter((p) => Number(p.yearsExperience ?? 0) >= minY);
    }
    if (filterMinRating !== "any") {
      const r = parseFloat(filterMinRating);
      list = list.filter((p) => Number(p.rating ?? 0) >= r);
    }
    const req = filterRequirement.trim().toLowerCase();
    if (req) {
      list = list.filter((p) => {
        const hay =
          `${p.specialty ?? ""} ${(p.subSpecialties ?? []).join(" ")} ${p.city ?? ""}`.toLowerCase();
        return hay.includes(req);
      });
    }
    const maxKm = parseFloat(filterMaxKm);
    if (!Number.isNaN(maxKm) && maxKm > 0 && meCoords.lat != null && meCoords.lng != null) {
      list = list.filter((p) => {
        const d = distanceKm(
          { lat: meCoords.lat!, lng: meCoords.lng! },
          { lat: p.lat, lng: p.lng },
        );
        return d <= maxKm;
      });
    }
    // Sort
    if (filterSortBy === "rating") {
      list.sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0));
    } else if (filterSortBy === "experience") {
      list.sort((a, b) => Number(b.yearsExperience ?? 0) - Number(a.yearsExperience ?? 0));
    } else if (meCoords.lat != null && meCoords.lng != null) {
      list.sort((a, b) => {
        const da = distanceKm(
          { lat: meCoords.lat!, lng: meCoords.lng! },
          { lat: a.lat, lng: a.lng },
        );
        const db = distanceKm(
          { lat: meCoords.lat!, lng: meCoords.lng! },
          { lat: b.lat, lng: b.lng },
        );
        return da - db;
      });
    }
    return list;
  }, [
    pros,
    filterAvailability,
    filterSpecialty,
    filterGender,
    filterMinYears,
    filterMinRating,
    filterRequirement,
    filterMaxKm,
    filterSortBy,
    meCoords.lat,
    meCoords.lng,
  ]);

  // Cada quien ve lo que le sirve: profesionales (azul), familias con ofertas abiertas (amarillo) e instituciones (fucsia).
  const visiblePoints = useMemo<Point[]>(
    () => [...filteredPros, ...families, ...institutions],
    [filteredPros, families, institutions],
  );

  // Cluster by proximity when zoomed out; radius shrinks as user zooms in.
  const clusterRadiusKm = zoomLevel >= 14 ? 0 : zoomLevel >= 12 ? 0.4 : zoomLevel >= 10 ? 1.2 : 3.5;
  const clusteredVisible = useMemo(() => {
    if (clusterRadiusKm <= 0) return visiblePoints;
    return clusterMarkers(visiblePoints, clusterRadiusKm);
  }, [visiblePoints, clusterRadiusKm]);

  // Zone summary: top 4 clusters by count (only when there's something to summarize).
  const zoneSummary = useMemo(() => {
    const clusters = clusteredVisible.filter((c: any) => isCluster(c)) as any[];
    return clusters
      .map((c) => {
        const counts = { professional: 0, family: 0, institution: 0 };
        for (const it of c.items) counts[(it as Point).kind]++;
        return { id: c.id, lat: c.lat, lng: c.lng, total: c.count, counts };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 4);
  }, [clusteredVisible]);

  const center =
    meCoords.lat != null && meCoords.lng != null
      ? { lat: meCoords.lat, lng: meCoords.lng }
      : { lat: 4.6097, lng: -74.0817 }; // Bogotá fallback

  const handlePick = (lat: number, lng: number) => {
    setMeCoords({ lat, lng });
    pickLocation?.onChange(lat, lng);
    if (selfPersist && userId) {
      (async () => {
        try {
          if (effectiveRole === "institution") {
            await supabase.from("institution_profiles").update({ lat, lng }).eq("user_id", userId);
          } else if (effectiveRole === "family") {
            await supabase
              .from("family_profiles")
              .update({ default_lat: lat, default_lng: lng })
              .eq("user_id", userId);
          }
          toast.success("📍 Ubicación guardada");
        } catch (e) {
          console.error("[LiveMap] could not persist location", e);
          toast.error("No se pudo guardar la ubicación");
        }
      })();
    }
    setPicking(false);
  };

  const handleGps = async () => {
    setPicking(true);
    const loc = await getBrowserLocation();
    if (loc) {
      handlePick(loc.lat, loc.lng);
      toast.success("📍 Ubicación detectada");
    } else {
      const fb = await geocodeCity(pickLocation?.defaultCity || "Bogotá");
      if (fb) handlePick(fb.lat, fb.lng);
      else toast.error("No se pudo obtener tu ubicación");
    }
    setPicking(false);
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 border-foreground/10 bg-card/95 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`h-3 w-3 shrink-0 rounded-full ${available ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {available ? "Visible en el mapa" : "Oculto del mapa"}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {isGuest
                ? "Regístrate para aparecer y contactar talento en tiempo real"
                : effectiveRole === "professional"
                  ? "Familias e instituciones ven tu zona aproximada (~1 km) y si estás disponible u ocupado"
                  : effectiveRole === "family"
                    ? "Los profesionales cercanos ven tu zona aproximada mientras tengas ofertas abiertas, nunca tu dirección"
                    : "Los profesionales ven tu sede en el mapa mientras estés visible"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {(pickLocation || selfPersist || isGuest) && (
            <>
              <Button
                variant={picking ? "hero" : "outline"}
                size="sm"
                className="flex-1 sm:flex-initial"
                onClick={() => {
                  if (requireAuth()) return;
                  setPicking((v) => !v);
                }}
              >
                <MapPin className="h-4 w-4 mr-1" />
                <span className="truncate">{picking ? "Toca el mapa…" : "Marcar"}</span>
              </Button>
              <Button
                variant={isTracking ? "hero" : "outline"}
                size="sm"
                className="flex-1 sm:flex-initial"
                onClick={() => {
                  if (requireAuth()) return;
                  if (effectiveRole !== "professional") {
                    void handleGps();
                    return;
                  }
                  // El profesional puede mostrar su zona aproximada (~1 km) en vivo; nunca su punto exacto.
                  if (isTracking) {
                    stopSharing();
                    toast("Dejaste de compartir tu zona en vivo");
                  } else if (startSharing()) {
                    toast.success("Compartes tu zona aproximada (~1 km) en vivo");
                    void handleGps();
                  } else {
                    toast.error("No pudimos usar tu ubicación");
                  }
                }}
              >
                <Crosshair className="h-4 w-4 mr-1" />
                {effectiveRole !== "professional"
                  ? "GPS"
                  : isTracking
                    ? "Zona en vivo"
                    : "Compartir zona"}
              </Button>
            </>
          )}
          <Button
            variant={available ? "destructive" : "hero"}
            size="sm"
            className="flex-1 sm:flex-initial"
            onClick={() => {
              if (requireAuth()) return;
              toggleAvailability();
            }}
            disabled={toggling}
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : available ? (
              <>
                <PowerOff className="h-4 w-4 mr-1" /> Apagar
              </>
            ) : (
              <>
                <Power className="h-4 w-4 mr-1" /> Encender
              </>
            )}
          </Button>
        </div>
      </Card>

      {presenceError && (
        <p role="alert" className="text-xs font-medium text-warn">
          {presenceError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Contadores reales por grupo (de la base, al día): disponibles, en vivo y ocupados */}
        {counterItems(
          isGuest || effectiveRole === "family" ? "family" : effectiveRole,
          countsQ.data ?? EMPTY_COUNTS,
        ).map((it) => (
          <Badge
            key={it.key}
            variant="outline"
            className="gap-1.5"
            data-testid={`map-count-${it.key}`}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-ok" />
            <span className="font-medium">{it.label}:</span>
            <span className="font-bold text-ok">{it.available}</span>
            <span className="text-muted-foreground">{it.availableLabel}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-bold">{it.live}</span>
            <span className="text-muted-foreground">en vivo</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-bold text-warn">{it.busy}</span>
            <span className="text-muted-foreground">{it.busyLabel}</span>
          </Badge>
        ))}
        {pickLocation && (
          <Badge variant="outline" className="gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-biosensor" />
            Tu ubicación
          </Badge>
        )}
        {showFilters && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => {
              if (requireAuth()) return;
              setFiltersOpen((v) => !v);
            }}
          >
            <SlidersHorizontal className="h-3 w-3 mr-1" />
            {filtersOpen ? "Ocultar filtros" : "Filtros inteligentes"}
          </Button>
        )}
      </div>

      {zoneSummary.length > 0 && (
        <Card className="p-2.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mr-1">
            Zonas con más actividad
          </span>
          {zoneSummary.map((z, i) => (
            <Badge
              key={z.id}
              variant="secondary"
              className="gap-1.5 font-semibold"
              title={`Pro ${z.counts.professional} · Fam ${z.counts.family} · Inst ${z.counts.institution}`}
            >
              #{i + 1} · {z.total}
              {z.counts.professional > 0 && (
                <span style={{ color: COLORS.professional }}>●{z.counts.professional}</span>
              )}
              {z.counts.family > 0 && (
                <span style={{ color: COLORS.family }}>●{z.counts.family}</span>
              )}
              {z.counts.institution > 0 && (
                <span style={{ color: COLORS.institution }}>■{z.counts.institution}</span>
              )}
            </Badge>
          ))}
          <span className="text-[10px] text-muted-foreground ml-auto">
            Acerca el mapa para ver detalles individuales
          </span>
        </Card>
      )}

      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
            Estado:
          </span>
          {(["all", "available", "busy"] as const).map((s) => {
            const label = s === "all" ? "Todos" : s === "available" ? "Disponibles" : "Ocupados";
            const busyCount = pros.filter((p) => p.availabilityStatus === "busy").length;
            const availCount = pros.filter((p) => p.availabilityStatus === "available").length;
            const count = s === "all" ? pros.length : s === "available" ? availCount : busyCount;
            const dotColor = s === "available" ? "#22c55e" : s === "busy" ? "#f59e0b" : "#6b7280";
            const active = filterAvailability === s;
            return (
              <button
                key={s}
                onClick={() => setFilterAvailability(s)}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200"
                style={
                  active
                    ? {
                        background: dotColor,
                        borderColor: "transparent",
                        color: "white",
                        boxShadow: `0 2px 8px ${dotColor}55`,
                      }
                    : {
                        borderColor: "rgba(0,0,0,0.12)",
                        color: "inherit",
                      }
                }
              >
                <span
                  className={s === "available" && !active ? "animate-pulse" : ""}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 9999,
                    display: "inline-block",
                    background: dotColor,
                    opacity: active ? 1 : 0.8,
                  }}
                />
                {label}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "1px 5px",
                    borderRadius: 9999,
                    background: active ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.07)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showFilters && !isGuest && filtersOpen && (
        <Card className="p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Especialidad
              </label>
              <Input
                value={filterSpecialty}
                onChange={(e) => setFilterSpecialty(e.target.value)}
                placeholder="enfermera, terapeuta…"
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Género
              </label>
              <Select value={filterGender} onValueChange={setFilterGender}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Cualquiera</SelectItem>
                  <SelectItem value="femenino">Femenino</SelectItem>
                  <SelectItem value="masculino">Masculino</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Años exp. mín.
              </label>
              <Input
                type="number"
                min={0}
                value={filterMinYears}
                onChange={(e) => setFilterMinYears(e.target.value)}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Estrellas mín.
              </label>
              <Select value={filterMinRating} onValueChange={setFilterMinRating}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Todas</SelectItem>
                  <SelectItem value="3">★ 3+</SelectItem>
                  <SelectItem value="4">★ 4+</SelectItem>
                  <SelectItem value="4.5">★ 4.5+</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Distancia máx. (km)
              </label>
              <Input
                type="number"
                min={0}
                value={filterMaxKm}
                onChange={(e) => setFilterMaxKm(e.target.value)}
                placeholder="sin límite"
                className="h-8 text-xs"
                disabled={meCoords.lat == null}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Requisito / palabra
              </label>
              <Input
                value={filterRequirement}
                onChange={(e) => setFilterRequirement(e.target.value)}
                placeholder="UCI, postop…"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Ordenar por
            </span>
            <Select value={filterSortBy} onValueChange={(v: any) => setFilterSortBy(v)}>
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distance">Distancia</SelectItem>
                <SelectItem value="rating">Mejor calificados</SelectItem>
                <SelectItem value="experience">Más experiencia</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs ml-auto"
              onClick={() => {
                setFilterSpecialty("");
                setFilterGender("any");
                setFilterMinYears("");
                setFilterMinRating("any");
                setFilterMaxKm("");
                setFilterRequirement("");
                setFilterSortBy("distance");
              }}
            >
              <X className="h-3 w-3 mr-1" /> Limpiar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sincronización en vivo de profesionales, familias e instituciones activas.
          </p>
        </Card>
      )}

      <div
        className="rounded-2xl overflow-hidden border border-foreground/10 shadow-[var(--shadow-elegant)]"
        style={{ height: `clamp(220px, 55vh, ${height}px)` }}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center bg-muted/30">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={11}
            scrollWheelZoom
            style={{ height: "100%", width: "100%", cursor: picking ? "crosshair" : undefined }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ZoomTracker onZoom={setZoomLevel} />
            {picking && <ClickToPick onPick={handlePick} />}
            {meCoords.lat != null && meCoords.lng != null && (
              <>
                <Marker
                  position={[meCoords.lat, meCoords.lng]}
                  icon={ME_ICON()}
                  draggable={!!pickLocation}
                  eventHandlers={
                    pickLocation
                      ? {
                          dragend: (e: any) => {
                            const ll = e.target.getLatLng();
                            handlePick(ll.lat, ll.lng);
                          },
                        }
                      : undefined
                  }
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold">Tu ubicación de servicio</p>
                      {pickLocation && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Arrastra el marcador para ajustar
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
                <RecenterOn lat={meCoords.lat} lng={meCoords.lng} />
              </>
            )}
            {clusteredVisible.map((item: any) => {
              if (isCluster(item)) {
                const counts = { professional: 0, family: 0, institution: 0 };
                for (const it of item.items) counts[(it as Point).kind]++;
                return (
                  <Marker
                    key={item.id}
                    position={[item.lat, item.lng]}
                    icon={makeClusterIcon(counts)}
                    eventHandlers={{
                      click: (e: any) => {
                        const map = e.target._map;
                        if (map) map.setView([item.lat, item.lng], Math.min(16, map.getZoom() + 2));
                      },
                    }}
                  >
                    <Popup>
                      <div className="text-sm" style={{ minWidth: 180 }}>
                        <p className="font-semibold" style={{ margin: 0 }}>
                          {item.count} en esta zona
                        </p>
                        <div className="mt-2 space-y-1 text-xs">
                          {counts.professional > 0 && (
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: COLORS.professional }}
                              />
                              {counts.professional} profesional
                              {counts.professional !== 1 ? "es" : ""}
                            </div>
                          )}
                          {counts.family > 0 && (
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: COLORS.family }}
                              />
                              {counts.family} familia{counts.family !== 1 ? "s" : ""}
                            </div>
                          )}
                          {counts.institution > 0 && (
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-sm"
                                style={{ background: COLORS.institution }}
                              />
                              {counts.institution} institución/es
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2">
                          Toca para acercar y ver detalles.
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                );
              }
              const p = item as Point;
              const isSelected = selectedId === p.id;
              const icon = makeMarkerIcon(
                p.kind,
                p.availabilityStatus ?? "available",
                isSelected,
                true,
                p.isLive === true,
              );
              const Icon =
                p.kind === "professional" ? HeartPulse : p.kind === "family" ? Users : Building2;
              const dist =
                meCoords.lat != null && meCoords.lng != null
                  ? distanceKm({ lat: meCoords.lat, lng: meCoords.lng }, { lat: p.lat, lng: p.lng })
                  : null;
              const kindLabel =
                p.kind === "professional"
                  ? "Profesional"
                  : p.kind === "family"
                    ? "Familia"
                    : "Institución";
              const accent = COLORS[p.kind];
              // Sin teléfono ni WhatsApp en el mapa: el contacto va por la plataforma (perfil, oferta, reserva) y según el plan.
              const offerHref =
                p.kind === "family" || (p.kind === "institution" && (p.headline ?? "") !== "")
                  ? p.offerId
                    ? `/oferta/${p.offerId}`
                    : "/dashboard/profesional"
                  : null;
              const offerLabel = p.offerId ? "Ver oferta" : "Ver oportunidades";
              const profileHref =
                p.kind === "professional" && p.userId ? `/profesional/${p.userId}` : null;
              return (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lng]}
                  icon={icon}
                  zIndexOffset={isSelected ? 1000 : 0}
                  eventHandlers={{
                    click: () => setSelectedId(p.id),
                    popupclose: () => setSelectedId(null),
                  }}
                >
                  <Popup minWidth={260} maxWidth={300}>
                    <div className="text-sm" style={{ minWidth: 240 }}>
                      <div className="flex items-center gap-2 mb-2">
                        {p.avatarUrl ? (
                          <img
                            src={p.avatarUrl}
                            alt={p.fullName || p.title}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 9999,
                              objectFit: "cover",
                              border: `2px solid ${accent}`,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 9999,
                              background: `${accent}22`,
                              color: accent,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              border: `2px solid ${accent}`,
                            }}
                          >
                            {(p.fullName || p.title || "?").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p className="font-semibold truncate" style={{ margin: 0 }}>
                            {p.fullName || p.title}
                          </p>
                          <p
                            className="text-xs flex items-center gap-1"
                            style={{ margin: 0, color: accent, fontWeight: 600 }}
                          >
                            <Icon className="h-3 w-3" />
                            {kindLabel}
                          </p>
                          {p.kind === "professional" && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "2px 8px",
                                borderRadius: 9999,
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 2,
                                background: statusStyle(p.availabilityStatus).soft,
                                color: statusStyle(p.availabilityStatus).text,
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 9999,
                                  display: "inline-block",
                                  background: statusStyle(p.availabilityStatus).dot,
                                }}
                              />
                              {statusStyle(p.availabilityStatus).label}
                            </span>
                          )}
                        </div>
                      </div>

                      {p.meta && (
                        <p className="text-xs text-muted-foreground" style={{ margin: "2px 0" }}>
                          {p.meta}
                          {p.city ? ` · ${p.city}` : ""}
                        </p>
                      )}
                      {p.headline && (
                        <p className="text-xs font-medium" style={{ margin: "2px 0" }}>
                          {p.headline}
                        </p>
                      )}
                      {p.trust && (
                        <p className="text-xs" style={{ margin: "2px 0", fontWeight: 600 }}>
                          🛡️ Confianza {p.trust}
                        </p>
                      )}
                      {p.isLive && (
                        <p
                          style={{
                            fontSize: 10,
                            margin: "2px 0",
                            color: "#22c55e",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "#22c55e",
                              display: "inline-block",
                              animation: "livePulse 1s infinite",
                            }}
                          />
                          En vivo ahora · zona aproximada
                        </p>
                      )}
                      {!p.isLive && (
                        <p
                          style={{
                            fontSize: 10,
                            margin: "2px 0",
                            color: "#9ca3af",
                            fontStyle: "italic",
                          }}
                        >
                          📍 Zona aproximada (~1 km)
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {dist != null && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 9999,
                              background: "oklch(0.78 0.18 165 / .15)",
                              color: "oklch(0.45 0.18 165)",
                              fontWeight: 600,
                            }}
                          >
                            📍 {formatKm(dist)}
                          </span>
                        )}
                        {p.rating != null && Number(p.rating) > 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 9999,
                              background: "oklch(0.85 0.15 85 / .2)",
                              color: "oklch(0.5 0.18 75)",
                              fontWeight: 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                          >
                            ★ {Number(p.rating).toFixed(1)}
                          </span>
                        )}
                        {p.hourlyRate != null && Number(p.hourlyRate) > 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 9999,
                              background: "#f3f4f6",
                              color: "#111827",
                              fontWeight: 600,
                            }}
                          >
                            ${Number(p.hourlyRate).toLocaleString("es-CO")}/h
                          </span>
                        )}
                      </div>

                      <div className="flex gap-1.5 mt-3">
                        {isGuest ? (
                          <a
                            href="/auth"
                            style={{
                              flex: 1,
                              textAlign: "center",
                              background: accent,
                              color: "white",
                              padding: "8px 10px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: "none",
                            }}
                          >
                            Regístrate para contactar →
                          </a>
                        ) : (
                          <>
                            {profileHref && (
                              <a
                                href={profileHref}
                                style={{
                                  flex: 1,
                                  textAlign: "center",
                                  background: "white",
                                  border: `1px solid ${accent}`,
                                  color: accent,
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  textDecoration: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 4,
                                }}
                              >
                                <UserIcon className="h-3 w-3" /> Perfil
                              </a>
                            )}
                            {offerHref && (
                              <a
                                href={offerHref}
                                style={{
                                  flex: 1,
                                  textAlign: "center",
                                  background: accent,
                                  color: "white",
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  textDecoration: "none",
                                }}
                              >
                                {offerLabel}
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {visiblePoints.length > 1 && <FitBounds points={visiblePoints} />}
          </MapContainer>
        )}
      </div>

      <style>{`
@keyframes livePulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.15);opacity:.85}}
@keyframes livePulseSlow{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.08);opacity:.9}}
.leaflet-popup-pane{z-index:700!important}
.leaflet-marker-pane .live-marker{transition:filter .15s ease}
`}</style>
    </div>
  );
}
