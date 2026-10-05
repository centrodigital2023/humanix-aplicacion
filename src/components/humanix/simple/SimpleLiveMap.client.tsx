// Mapa en vivo, versión simple: pines grandes con emoji, datos reales de
// Supabase y movimiento en tiempo real (tabla user_locations vía
// useLivePresence + cambios en professional_profiles / job_offers).
// Al tocar un pin aparece una tarjeta grande abajo con 1-2 botones.
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, LocateFixed, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLivePresence } from "@/hooks/use-live-presence";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  BOGOTA,
  cityToLatLng,
  deterministicOffset,
  distanceKm,
  formatKm,
  getBrowserLocation,
  type LatLng,
} from "@/lib/geo";
import { useVoice } from "./voice";
import type { MapPin, SimpleLiveMapProps } from "./SimpleLiveMap";

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

function pinIcon(pin: MapPin, selected: boolean) {
  const ring = pin.live ? "#10b981" : pin.dim ? "#9ca3af" : "#0f4c81";
  const size = selected ? 58 : 46;
  const pulse = pin.live
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:3px solid ${ring};opacity:.55;animation:hxPulse 1.4s infinite"></span>`
    : "";
  const badge = pin.badge
    ? `<span style="position:absolute;left:50%;top:100%;transform:translate(-50%,4px);white-space:nowrap;background:${ring};color:#fff;font:700 12px/1 system-ui;padding:4px 7px;border-radius:9999px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${pin.badge}</span>`
    : "";
  return L.divIcon({
    className: "hx-simple-pin",
    html: `<div style="position:relative;width:${size}px;height:${size}px">${pulse}<div style="width:100%;height:100%;border-radius:9999px;background:#fff;border:4px solid ${ring};display:flex;align-items:center;justify-content:center;font-size:${selected ? 30 : 24}px;box-shadow:0 6px 16px rgba(15,76,129,.30);opacity:${pin.dim ? 0.75 : 1}">${pin.emoji}</div>${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const ME_ICON = () =>
  L.divIcon({
    className: "hx-simple-me",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:#0f4c81;border:4px solid #fff;box-shadow:0 0 0 8px rgba(15,76,129,.25),0 4px 12px rgba(0,0,0,.35)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 13, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function FitPins({ pins, enabled }: { pins: MapPin[]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || pins.length === 0) return;
    const b = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(b, { padding: [50, 50], maxZoom: 13 });
    // Solo la primera vez que llegan pines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pins.length > 0]);
  return null;
}

function ClickAway({ onClick }: { onClick: () => void }) {
  useMapEvents({ click: onClick });
  return null;
}

type ProRow = {
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  hourly_rate: number | null;
  avg_rating: number | null;
  available: boolean | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  lat: number | null;
  lng: number | null;
  home_city: string | null;
  years_experience: number | null;
};

type OfferRow = {
  id: string;
  title: string;
  city: string;
  amount: number;
  modality: "hour" | "shift" | "month" | "package";
  lat: number | null;
  lng: number | null;
  poster_type: "family" | "institution";
};

const MODALITY: Record<OfferRow["modality"], string> = {
  hour: "/h",
  shift: "/turno",
  month: "/mes",
  package: "",
};

export function SimpleLiveMap({
  mode,
  height = 420,
  onPrimary,
  primaryLabel,
  secondary,
  center,
}: SimpleLiveMapProps) {
  const { say } = useVoice();
  const [pins, setPins] = useState<MapPin[] | null>(null);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);
  const { liveLocations } = useLivePresence({ loadAll: true });

  const load = useCallback(async () => {
    if (mode === "pros") {
      const { data } = await supabase
        .from("public_professionals_safe")
        .select(
          "user_id, full_name, avatar_url, specialty, hourly_rate, avg_rating, available, verified, rethus_verified, lat, lng, home_city, years_experience",
        )
        .eq("active", true)
        .limit(200)
        .abortSignal(AbortSignal.timeout(10000));
      const rows = (data ?? []) as ProRow[];
      setPins(
        rows
          .filter((r) => r.user_id)
          .map((r) => {
            const base =
              r.lat != null && r.lng != null
                ? { lat: r.lat, lng: r.lng }
                : (() => {
                    const c = cityToLatLng(r.home_city);
                    const o = deterministicOffset(r.user_id!);
                    return { lat: c.lat + o.lat, lng: c.lng + o.lng };
                  })();
            return {
              id: r.user_id!,
              ...base,
              emoji: "👩‍⚕️",
              title: (r.full_name ?? "Profesional").split(" ").slice(0, 2).join(" "),
              subtitle: r.specialty ?? "Cuidado en casa",
              avatarUrl: r.avatar_url,
              price: r.hourly_rate ? `${COP(r.hourly_rate)} / hora` : null,
              rating: r.avg_rating,
              verified: Boolean(r.verified || r.rethus_verified),
              dim: !r.available,
              live: false,
              raw: r,
            } satisfies MapPin;
          }),
      );
    } else {
      const { data } = await supabase
        .from("job_offers")
        .select("id, title, city, amount, modality, lat, lng, poster_type")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(200)
        .abortSignal(AbortSignal.timeout(10000));
      const rows = (data ?? []) as OfferRow[];
      setPins(
        rows.map((r) => {
          const base =
            r.lat != null && r.lng != null
              ? { lat: r.lat, lng: r.lng }
              : (() => {
                  const c = cityToLatLng(r.city);
                  const o = deterministicOffset(r.id);
                  return { lat: c.lat + o.lat, lng: c.lng + o.lng };
                })();
          return {
            id: r.id,
            ...base,
            emoji: r.poster_type === "institution" ? "🏥" : "🏠",
            title: r.title,
            subtitle: r.city,
            price: `${COP(r.amount)} ${MODALITY[r.modality]}`.trim(),
            badge: `${Math.round(r.amount / 1000)}k`,
            raw: r,
          } satisfies MapPin;
        }),
      );
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  // Cambios en la base de datos → recargar pines al instante.
  useRealtimeRefresh(
    `simple-map-${mode}`,
    mode === "pros" ? [{ table: "professional_profiles" }] : [{ table: "job_offers" }],
    load,
  );

  // GPS en vivo de profesionales conectados (estilo Uber).
  const merged = useMemo(() => {
    if (!pins) return [];
    if (mode !== "pros") return pins;
    return pins.map((p) => {
      const live = liveLocations.get(p.id);
      return live?.isOnline ? { ...p, lat: live.lat, lng: live.lng, live: true, dim: false } : p;
    });
  }, [pins, liveLocations, mode]);

  const ordered = useMemo(() => {
    if (!me) return merged;
    return [...merged].sort((a, b) => distanceKm(me, a) - distanceKm(me, b));
  }, [merged, me]);

  const activeCount = merged.filter((p) => !p.dim).length;
  const liveCount = merged.filter((p) => p.live).length;

  const locate = async () => {
    setLocating(true);
    const pos = await getBrowserLocation();
    setLocating(false);
    if (!pos) {
      say("No vimos tu ubicación.");
      return;
    }
    setMe(pos);
    setFlyTarget(pos);
    const near = merged.filter((p) => !p.dim && distanceKm(pos, p) <= 5).length;
    say(
      mode === "pros"
        ? `Hay ${near} profesionales a menos de 5 kilómetros.`
        : `Hay ${near} ofertas a menos de 5 kilómetros.`,
    );
  };

  const select = (pin: MapPin) => {
    setSelected(pin);
    say(`${pin.title}. ${pin.price ?? ""}`);
  };

  const initialCenter = center ?? BOGOTA;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-border shadow-xl shadow-trust/10">
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: `clamp(320px, 62vh, ${height}px)`, width: "100%" }}
        attributionControl
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO'
        />
        <FitPins pins={merged} enabled={!me} />
        <FlyTo target={flyTarget} />
        <ClickAway onClick={() => setSelected(null)} />
        {me && <Marker position={[me.lat, me.lng]} icon={ME_ICON()} />}
        {ordered.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinIcon(p, selected?.id === p.id)}
            eventHandlers={{ click: () => select(p) }}
            keyboard
            title={p.title}
            alt={p.title}
          />
        ))}
      </MapContainer>

      {/* Contador en vivo (dato real) */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-sm font-bold text-trust-deep shadow-md">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          {pins === null
            ? "Cargando…"
            : mode === "pros"
              ? `${activeCount} disponibles`
              : `${merged.length} ofertas`}
        </span>
        {liveCount > 0 && (
          <span className="rounded-full bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white shadow-md">
            📡 {liveCount} en vivo
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={locate}
        disabled={locating}
        className="absolute right-3 top-3 z-[500] inline-flex min-h-12 items-center gap-2 rounded-full bg-trust-deep px-4 text-base font-bold text-white shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
      >
        {locating ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
        )}
        Yo
      </button>

      {/* Leyenda con imágenes */}
      {!selected && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2 text-sm font-bold">
          {mode === "pros" ? (
            <>
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-trust-deep shadow">
                🔵 Disponible
              </span>
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-emerald-700 shadow">
                🟢 En vivo
              </span>
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-gray-600 shadow">
                ⚪ Ocupado
              </span>
            </>
          ) : (
            <>
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-trust-deep shadow">
                🏠 Familia
              </span>
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-trust-deep shadow">
                🏥 IPS
              </span>
            </>
          )}
        </div>
      )}

      {pins !== null && pins.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[500] mx-auto w-fit rounded-full bg-white/95 px-4 py-2 text-base font-bold text-trust-deep shadow-md">
          {mode === "pros" ? "Pronto habrá profesionales aquí" : "Pronto habrá ofertas aquí"}
        </div>
      )}

      {/* Tarjeta grande del pin elegido */}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[600] rounded-3xl bg-white p-4 text-ink shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Cerrar"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 active:scale-90"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-4 pr-10">
            {selected.avatarUrl ? (
              <img
                src={selected.avatarUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-emerald-500/30"
              />
            ) : (
              <span
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sky-100 text-3xl"
                aria-hidden="true"
              >
                {selected.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{selected.title}</p>
              <p className="truncate text-sm text-gray-600">{selected.subtitle}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm font-bold">
                {selected.verified && <span className="text-emerald-700">✅ Verificado</span>}
                {(selected.rating ?? 0) > 0 && <span>⭐ {selected.rating?.toFixed(1)}</span>}
                {me && <span>📍 {formatKm(distanceKm(me, selected))}</span>}
                {selected.live && <span className="text-emerald-700">📡 En vivo</span>}
              </p>
            </div>
          </div>
          {selected.price && <p className="mt-3 text-2xl font-bold">{selected.price}</p>}
          <div className={`mt-3 grid gap-2 ${secondary ? "grid-cols-[1fr_auto]" : ""}`}>
            <button
              type="button"
              onClick={() => onPrimary(selected)}
              disabled={mode === "pros" && selected.dim}
              className="min-h-14 rounded-2xl bg-trust-deep px-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50"
            >
              {mode === "pros" && selected.dim ? "Ocupado ahora" : primaryLabel}
            </button>
            {secondary && (
              <a
                href={secondary.href(selected)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={secondary.label}
                className="flex min-h-14 w-14 items-center justify-center rounded-2xl border-2 border-gray-200 text-2xl active:scale-95"
              >
                {secondary.emoji}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
