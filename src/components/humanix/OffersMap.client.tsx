import { useEffect, useState, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapModal } from "./MapModal";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import { clusterMarkers, createClusterIcon, isCluster } from "@/lib/marker-clustering";
import { useThrottle } from "@/hooks/use-throttle";

// Fix iconos rotos al bundlear
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

const greenIcon = L.divIcon({
  className: "humanix-marker",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:oklch(0.78 0.18 165);border:3px solid white;box-shadow:0 0 0 2px oklch(0.78 0.18 165 / .4),0 4px 12px rgba(0,0,0,.3)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const blueIcon = L.divIcon({
  className: "humanix-marker",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:oklch(0.55 0.22 260);border:3px solid white;box-shadow:0 0 0 2px oklch(0.55 0.22 260 / .4),0 4px 12px rgba(0,0,0,.3)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  status?: "available" | "reserved";
  href?: string;
};

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [points, map]);
  return null;
}

/**
 * Throttled zoom listener to prevent excessive re-renders
 */
function ThrottledZoomListener({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  const throttledZoom = useThrottle((zoom: number) => onZoomChange(zoom), 300);

  useMapEvents({
    zoom() {
      throttledZoom(map.getZoom());
    },
  });

  return null;
}

export function OffersMap({
  points,
  height = 120,
  center = { lat: 4.6097, lng: -74.0817 }, // Bogotá
  zoom = 11,
  clusterRadiusKm = 0.8, // Cluster markers within 800m
}: {
  points: MapPoint[];
  height?: number;
  center?: { lat: number; lng: number };
  zoom?: number;
  clusterRadiusKm?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(zoom);

  useEffect(() => setMounted(true), []);

  // Memoize clustered markers - recalculate only when points or zoom changes
  const clusteredPoints = useMemo(() => {
    const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    // Only cluster on small zoom levels (zoomed out)
    if (currentZoom >= 12) {
      return valid;
    }
    return clusterMarkers(valid, clusterRadiusKm);
  }, [points, currentZoom, clusterRadiusKm]);

  if (!mounted) {
    return (
      <div
        className="rounded-2xl border border-border bg-muted/30 animate-pulse"
        style={{ height }}
      />
    );
  }

  const mapContent = (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      scrollWheelZoom
      zoomControl={expanded}
      style={{ height: "100%", width: "100%" }}
      // Performance optimizations
      zoomAnimation={expanded} // Disable animation on small screens to save CPU
      markerZoomAnimation={expanded}
      preferCanvas={true} // Use canvas for better mobile performance
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        // Performance tuning
        maxZoom={19}
        minZoom={2}
        updateWhenZooming={false}
        updateWhenIdle={true}
      />

      {/* Track zoom changes with throttling */}
      <ThrottledZoomListener onZoomChange={setCurrentZoom} />

      {/* Render markers or clusters */}
      {clusteredPoints.map((item) => {
        if (isCluster(item)) {
          // Render cluster
          return (
            <Marker
              key={item.id}
              position={[item.lat, item.lng]}
              icon={createClusterIcon(item.count)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{item.count} ofertas cercanas</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Amplía el mapa para ver detalles individuales
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        } else {
          // Render individual marker
          const p = item as MapPoint;
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={p.status === "reserved" ? blueIcon : greenIcon}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{p.title}</p>
                  {p.subtitle && (
                    <p className="text-muted-foreground text-xs mt-0.5">{p.subtitle}</p>
                  )}
                  {p.href && (
                    <a
                      href={p.href}
                      className="text-biosensor text-xs font-medium mt-2 inline-block"
                    >
                      Ver detalles →
                    </a>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        }
      })}

      {clusteredPoints.length > 1 && (
        <FitBounds points={points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))} />
      )}
    </MapContainer>
  );

  return (
    <>
      <div
        className="rounded-2xl overflow-hidden border border-border shadow-[var(--shadow-card)] relative group cursor-pointer"
        style={{ height }}
        onClick={() => setExpanded(true)}
      >
        {mapContent}
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          <Maximize2 className="h-4 w-4 mr-1" />
          Expandir
        </Button>
      </div>

      <MapModal open={expanded} onOpenChange={setExpanded} title="Mapa de ofertas">
        {mapContent}
      </MapModal>
    </>
  );
}
