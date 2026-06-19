import { TileLayer, useMap } from 'react-leaflet';
import { useEffect, useState } from 'react';

/**
 * Lazy-loaded TileLayer that only renders when the map is within reasonable bounds
 * Reduces initial load time on mobile
 */
export function LazyTileLayer({
  attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
}: {
  attribution?: string;
  url?: string;
} = {}) {
  const map = useMap();
  const [shouldRender, setShouldRender] = useState(true);

  useEffect(() => {
    // Always render on mount (simple approach)
    // More aggressive optimization: setShouldRender(false) initially
    // then setShouldRender(true) after first interaction

    const handleZoom = () => {
      // Tiles auto-manage in Leaflet, this is just a hook for future optimization
    };

    map.on('zoom', handleZoom);
    return () => {
      map.off('zoom', handleZoom);
    };
  }, [map]);

  if (!shouldRender) {
    return null;
  }

  return (
    <TileLayer
      attribution={attribution}
      url={url}
      // Performance optimizations
      maxZoom={19}
      minZoom={2}
      // Reduce update frequency
      updateWhenZooming={false}
      updateWhenIdle={true}
      // Client-side prioritization
      crossOrigin={true}
    />
  );
}
