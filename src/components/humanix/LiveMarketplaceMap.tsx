import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

export type LiveMarketplaceMapProps = {
  role?: "professional" | "family" | "institution" | "guest";
  userId?: string;
  height?: number;
  preview?: boolean;
  pickLocation?: {
    lat: number | null;
    lng: number | null;
    onChange: (lat: number, lng: number, address?: string) => void;
    defaultCity?: string;
  };
};

const LazyMap = lazy(() =>
  import("./LiveMarketplaceMap.client").then((m) => ({ default: m.LiveMarketplaceMap })),
);

export function LiveMarketplaceMap(props: LiveMarketplaceMapProps) {
  const height = props.height ?? 360;
  const placeholder = (
    <div
      style={{ height: `clamp(220px, 55vh, ${height}px)` }}
      className="w-full rounded-2xl bg-muted/30 animate-pulse"
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