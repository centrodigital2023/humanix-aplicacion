// Helpers de geolocalización (haversine + geocoding gratis con Nominatim).

export type LatLng = { lat: number; lng: number };

export const BOGOTA: LatLng = { lat: 4.6097, lng: -74.0817 };

// Coordenadas de las principales ciudades de Colombia (lookup instantáneo sin API)
export const COLOMBIA_CITIES: Record<string, LatLng> = {
  bogotá: BOGOTA, bogota: BOGOTA,
  medellín: { lat: 6.2442, lng: -75.5812 }, medellin: { lat: 6.2442, lng: -75.5812 },
  cali: { lat: 3.4516, lng: -76.5320 },
  barranquilla: { lat: 10.9639, lng: -74.7964 },
  cartagena: { lat: 10.3910, lng: -75.4794 },
  bucaramanga: { lat: 7.1193, lng: -73.1227 },
  manizales: { lat: 5.0703, lng: -75.5138 },
  pereira: { lat: 4.8133, lng: -75.6961 },
  cúcuta: { lat: 7.8939, lng: -72.5078 }, cucuta: { lat: 7.8939, lng: -72.5078 },
  ibagué: { lat: 4.4389, lng: -75.2322 }, ibague: { lat: 4.4389, lng: -75.2322 },
  villavicencio: { lat: 4.1420, lng: -73.6266 },
  pasto: { lat: 1.2136, lng: -77.2811 },
  armenia: { lat: 4.5389, lng: -75.6728 },
  "santa marta": { lat: 11.2408, lng: -74.1990 },
  neiva: { lat: 2.9273, lng: -75.2819 },
  montería: { lat: 8.7575, lng: -75.8814 }, monteria: { lat: 8.7575, lng: -75.8814 },
  sincelejo: { lat: 9.3047, lng: -75.3978 },
  popayán: { lat: 2.4448, lng: -76.6147 }, popayan: { lat: 2.4448, lng: -76.6147 },
  valledupar: { lat: 10.4779, lng: -73.2513 },
  tunja: { lat: 5.5353, lng: -73.3678 },
  engativá: BOGOTA, engativa: BOGOTA, suba: BOGOTA, usaquén: BOGOTA, chapinero: BOGOTA,
  kennedy: BOGOTA, bosa: BOGOTA, fontibón: BOGOTA, fontibon: BOGOTA,
};

/** Coordenadas para una ciudad colombiana — Bogotá como fallback */
export function cityToLatLng(city: string | null | undefined): LatLng {
  if (!city) return BOGOTA;
  return COLOMBIA_CITIES[city.trim().toLowerCase()] ?? BOGOTA;
}

/** Offset determinístico y estable basado en user_id para no apilar marcadores */
export function deterministicOffset(seed: string, maxDeg = 0.04): LatLng {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = ((h2 << 5) + h2) ^ c;
  }
  return {
    lat: (((h1 >>> 0) % 1000) / 1000 - 0.5) * 2 * maxDeg,
    lng: (((h2 >>> 0) % 1000) / 1000 - 0.5) * 2 * maxDeg,
  };
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Cache simple en memoria para no spamear Nominatim
const geoCache = new Map<string, LatLng | null>();

export async function geocodeCity(query: string): Promise<LatLng | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=co&q=${encodeURIComponent(
      query,
    )}`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "es" },
    });
    if (!res.ok) {
      geoCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) {
      geoCache.set(key, null);
      return null;
    }
    const result = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
    geoCache.set(key, result);
    return result;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

export function getBrowserLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
