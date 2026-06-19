import L from 'leaflet';

/**
 * Simple clustering logic for Leaflet markers
 * Groups nearby markers (within clusterRadius) into clusters
 */
export interface ClusterData {
  id: string;
  lat: number;
  lng: number;
  count: number;
  items: Array<{ id: string; lat: number; lng: number; [key: string]: any }>;
}

/**
 * Calculate distance between two lat/lng points in km
 */
export function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Group markers into clusters based on proximity
 * Returns original markers if they're far apart, or clusters if they're close
 */
export function clusterMarkers<T extends { id: string; lat: number; lng: number }>(
  items: T[],
  clusterRadiusKm: number = 1 // 1 km default
): (T | ClusterData)[] {
  const clustered: (T | ClusterData)[] = [];
  const processed = new Set<string>();

  for (const item of items) {
    if (processed.has(item.id)) continue;

    // Find all items within clusterRadius of this item
    const cluster: typeof items = [item];
    processed.add(item.id);

    for (const other of items) {
      if (processed.has(other.id)) continue;
      const dist = getDistance(item.lat, item.lng, other.lat, other.lng);
      if (dist <= clusterRadiusKm) {
        cluster.push(other);
        processed.add(other.id);
      }
    }

    // If only one item, add it directly; otherwise add cluster
    if (cluster.length === 1) {
      clustered.push(item);
    } else {
      const avgLat = cluster.reduce((sum, c) => sum + c.lat, 0) / cluster.length;
      const avgLng = cluster.reduce((sum, c) => sum + c.lng, 0) / cluster.length;
      clustered.push({
        id: `cluster-${cluster.map((c) => c.id).join(',')}`,
        lat: avgLat,
        lng: avgLng,
        count: cluster.length,
        items: cluster,
      });
    }
  }

  return clustered;
}

/**
 * Create a cluster icon that adapts based on cluster size
 */
export function createClusterIcon(count: number): L.DivIcon {
  let size = 40;
  let fontSize = 14;

  if (count > 100) {
    size = 55;
    fontSize = 18;
  } else if (count > 20) {
    size = 48;
    fontSize = 16;
  } else if (count > 8) {
    size = 44;
    fontSize = 15;
  }

  return L.divIcon({
    className: 'leaflet-marker-cluster',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: linear-gradient(135deg, oklch(0.65 0.2 280) 0%, oklch(0.6 0.22 270) 100%);
        border: 3px solid white;
        box-shadow: 0 0 0 3px oklch(0.65 0.2 280 / 0.3), 0 4px 12px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: ${fontSize}px;
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      ">${count}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Check if a point is a cluster
 */
export function isCluster(item: any): item is ClusterData {
  return 'count' in item && 'items' in item && item.count > 1;
}
