import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2, Crosshair, Navigation, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapModal } from "./MapModal";
import { toast } from "sonner";
import { useThrottle } from "@/hooks/use-throttle";

const pinIcon = L.divIcon({
  className: "humanix-pin",
  html: `<div style="width:22px;height:22px;border-radius:9999px;background:oklch(0.78 0.18 165);border:3px solid white;box-shadow:0 0 0 3px oklch(0.78 0.18 165 / .35),0 6px 14px rgba(0,0,0,.3)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: true });
  }, [lat, lng, map]);
  return null;
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  // Throttle click events to prevent rapid consecutive picks
  const throttledPick = useThrottle(onPick, 300);

  useMapEvents({
    click(e) {
      throttledPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function LocationPicker({
  lat,
  lng,
  onChange,
  height = 120,
  defaultCity = "Bogotá",
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number, address?: string) => void;
  height?: number;
  defaultCity?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  // Throttle onChange to prevent excessive updates (especially during watch)
  const throttledOnChange = useThrottle(onChange, 1000); // Update max once per second during watch

  useEffect(() => {
    setMounted(true);
    // Auto-detect GPS on mount silently
    if (navigator.geolocation && lat == null && lng == null) {
      navigator.geolocation.getCurrentPosition(
        (pos) => onChange(pos.coords.latitude, pos.coords.longitude),
        () => {
          /* silent fail */
        },
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const useGps = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange(pos.coords.latitude, pos.coords.longitude);
        toast.success("Ubicación GPS aplicada");
        setBusy(false);
      },
      () => {
        toast.error("No pudimos obtener tu ubicación");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [onChange]);

  const toggleWatch = useCallback(() => {
    if (watching) {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setWatching(false);
      toast.info("Seguimiento en tiempo real desactivado");
    } else {
      if (!navigator.geolocation) {
        toast.error("Sin soporte de geolocalización");
        return;
      }
      setWatching(true);
      toast.success("Rastreando tu ubicación en tiempo real");
      // Use throttled onChange during watch to reduce CPU usage
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => throttledOnChange(pos.coords.latitude, pos.coords.longitude),
        () => {
          setWatching(false);
        },
        { enableHighAccuracy: true, maximumAge: 5_000 },
      );
    }
  }, [watching, throttledOnChange]);

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const center = { lat: lat ?? 4.6097, lng: lng ?? -74.0817 };

  if (!mounted) {
    return (
      <div
        className="rounded-xl border border-border bg-muted/30 animate-pulse"
        style={{ height }}
      />
    );
  }

  const mapContent = (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={lat && lng ? 14 : 11}
      scrollWheelZoom={expanded}
      zoomControl={expanded}
      style={{ height: "100%", width: "100%" }}
      // Performance optimizations
      markerZoomAnimation={expanded}
      preferCanvas={true}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        // Performance tuning for mobile
        maxZoom={19}
        minZoom={2}
        updateWhenZooming={false}
        updateWhenIdle={true}
      />
      {lat != null && lng != null && (
        <>
          <Marker position={[lat, lng]} icon={pinIcon} />
          {!expanded && <Recenter lat={lat} lng={lng} />}
        </>
      )}
      <ClickToSet onPick={(la, ln) => onChange(la, ln)} />
    </MapContainer>
  );

  return (
    <>
      <div className="space-y-1.5">
        {/* Controles compactos */}
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={useGps}
            variant="glass"
            size="sm"
            disabled={busy || watching}
            className="text-xs h-8"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Crosshair className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">Mi ubicación</span>
          </Button>
          <Button
            type="button"
            onClick={toggleWatch}
            variant={watching ? "hero" : "glass"}
            size="sm"
            className="text-xs h-8"
            title="Seguimiento en tiempo real"
          >
            <Navigation className={`h-3.5 w-3.5 ${watching ? "animate-pulse" : ""}`} />
            <span className="ml-1">{watching ? "En vivo ●" : "Tiempo real"}</span>
          </Button>
          <Button
            type="button"
            onClick={() => setExpanded(true)}
            variant="glass"
            size="sm"
            className="text-xs h-8"
            title="Expandir mapa"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Mapa pequeño */}
        <div
          className="rounded-xl overflow-hidden border border-border shadow-sm relative group cursor-pointer"
          style={{ height }}
          onClick={() => setExpanded(true)}
        >
          {mapContent}
          {!lat && !lng && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detectando ubicación…
              </span>
            </div>
          )}
        </div>

        {lat != null && lng != null && (
          <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <MapPin className="h-3 w-3 text-biosensor" />
            {lat.toFixed(5)}, {lng.toFixed(5)}
            {watching && <span className="ml-1 text-biosensor font-medium">● en vivo</span>}
          </p>
        )}
      </div>

      <MapModal
        open={expanded}
        onOpenChange={setExpanded}
        title="Selector de ubicación"
      >
        {mapContent}
      </MapModal>
    </>
  );
}
