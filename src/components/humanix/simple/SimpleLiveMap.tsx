// SSR-safe: Leaflet toca `window` al importarse, así que el mapa real se carga
// solo en el navegador. Los tipos públicos viven aquí (no en el .client).
import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import type { LatLng } from "@/lib/geo";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  emoji: string;
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  price?: string | null;
  rating?: number | null;
  verified?: boolean;
  /** Ocupado / no disponible: se ve atenuado. */
  dim?: boolean;
  /** Con la aplicación abierta ahora mismo. */
  live?: boolean;
  badge?: string;
  /** «82 · Alto»: el Trust Score ya redactado (nulo si aún no hay). */
  trust?: string | null;
  /** «Disponible», «Ocupado»…: el estado ya redactado. */
  statusLabel?: string;
  /** «Disponible · se conectó hace 3 horas»: disponible sigue encendido aunque el profesional no tenga Humanix abierto. */
  presence?: string | null;
  raw?: unknown;
};

export type SimpleLiveMapProps = {
  /** "pros" = profesionales (familias, IPS). "offers" = quien tiene ofertas u horas abiertas (profesionales). */
  mode: "pros" | "offers";
  height?: number;
  center?: LatLng;
  /** Texto del botón principal; puede cambiar según el pin («Ver oferta» o «Ver oportunidades»). */
  primaryLabel: string | ((pin: MapPin) => string);
  onPrimary: (pin: MapPin) => void;
  secondary?: { emoji: string; label: string; href: (pin: MapPin) => string };
};

const LazyMap = lazy(() =>
  import("./SimpleLiveMap.client").then((m) => ({ default: m.SimpleLiveMap })),
);

export function SimpleLiveMap(props: SimpleLiveMapProps) {
  const placeholder = (
    <div
      style={{ height: `clamp(320px, 62vh, ${props.height ?? 420}px)` }}
      className="w-full animate-pulse rounded-[2rem] bg-muted"
      aria-label="Cargando mapa en vivo"
    />
  );
  return (
    <ClientOnly fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <LazyMap {...props} />
      </Suspense>
    </ClientOnly>
  );
}
