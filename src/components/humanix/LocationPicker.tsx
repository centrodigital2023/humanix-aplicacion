import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

export type LocationPickerProps = {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number, address?: string) => void;
  height?: number;
  defaultCity?: string;
};

const LazyPicker = lazy(() =>
  import("./LocationPicker.client").then((m) => ({ default: m.LocationPicker })),
);

export function LocationPicker(props: LocationPickerProps) {
  const height = props.height ?? 120;
  const placeholder = (
    <div
      className="rounded-xl border border-border bg-muted/30 animate-pulse"
      style={{ height }}
    />
  );
  return (
    <ClientOnly fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <LazyPicker {...props} />
      </Suspense>
    </ClientOnly>
  );
}
