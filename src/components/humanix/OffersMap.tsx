// SSR-safe wrapper. Leaflet touches `window` at import time, so we lazy-load
// the real map only on the client. We re-declare the public types here to
// avoid importing anything from the .client module in server code (the
// TanStack import-protection plugin blocks those imports during SSR build).
import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  status?: "available" | "reserved";
  href?: string;
};

export type OffersMapProps = {
  points: MapPoint[];
  height?: number;
  center?: { lat: number; lng: number };
  zoom?: number;
};

const LazyMap = lazy(() => import("./OffersMap.client").then((m) => ({ default: m.OffersMap })));

export function OffersMap(props: OffersMapProps) {
  const height = props.height ?? 120;
  const placeholder = (
    <div
      style={{ height }}
      className="w-full rounded-2xl bg-muted/30 animate-pulse"
      aria-label="Cargando mapa"
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
