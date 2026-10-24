// Seguimiento en vivo del cuidador: mapa con ruta + ETA + emergencia.
// La ubicación se comparte SOLO con el servicio «En camino» o «Cuidando» (`lib/serviceTracking.ts`; la base lo impone igual):
//  - Profesional: al pasar a esos estados empieza a enviar su posición sola (máx. una cada 15 s); puede pausarla. Al terminar, se detiene.
//  - Familia, cuenta EPS/IPS que pidió el servicio y su círculo de cuidado: ven la posición en vivo por Realtime (tracking_pings).
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, Loader2, Radio, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OffersMap, type MapPoint } from "./OffersMap";
import { EmergencyButton } from "./EmergencyButton";
import { distanceKm, formatKm, type LatLng } from "@/lib/geo";
import {
  isTrackedStatus,
  shouldSendPing,
  trackingWaitText,
  type SentPing,
} from "@/lib/serviceTracking";

type Booking = {
  id: string;
  client_id: string;
  professional_id: string;
  status: string;
  service_lat: number | null;
  service_lng: number | null;
  service_address: string | null;
  scheduled_at: string;
};

type Ping = {
  lat: number;
  lng: number;
  created_at: string;
  speed_mps: number | null;
};

const AVG_KMH_BOGOTA = 22; // velocidad promedio realista en ciudad
const etaMinutes = (km: number, speedKmh = AVG_KMH_BOGOTA) =>
  Math.max(1, Math.round((km / speedKmh) * 60));

export function LiveTracking({
  booking,
  isProfessional,
  readOnly = false,
}: {
  booking: Booking;
  isProfessional: boolean;
  /** Círculo de cuidado: ve la ruta, sin botón de emergencia. */
  readOnly?: boolean;
}) {
  const tracked = isTrackedStatus(booking.status);
  const [lastPing, setLastPing] = useState<Ping | null>(null);
  const [paused, setPaused] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const sentRef = useRef<SentPing | null>(null);
  const sharing = isProfessional && tracked && !paused;

  // 1) Último ping al iniciar o al entrar en camino. Fuera de esos estados la ruta no se muestra.
  useEffect(() => {
    if (!tracked) {
      setLastPing(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tracking_pings")
        .select("lat, lng, created_at, speed_mps")
        .eq("booking_id", booking.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data?.[0]) setLastPing(data[0] as Ping);
    })();
    return () => {
      cancelled = true;
    };
  }, [booking.id, tracked]);

  // 2) Suscripción Realtime (solo mientras se rastrea).
  useEffect(() => {
    if (!tracked) return;
    const ch = supabase
      .channel(`tracking:${booking.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tracking_pings",
          filter: `booking_id=eq.${booking.id}`,
        },
        (payload) => setLastPing(payload.new as Ping),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [booking.id, tracked]);

  // 3) Profesional en camino o cuidando: publica su ubicación (con freno para no enviar lecturas repetidas).
  useEffect(() => {
    if (!sharing) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Este dispositivo no permite compartir la ubicación.");
      return;
    }
    setGpsError(null);
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        if (!shouldSendPing(sentRef.current, next, now)) return;
        sentRef.current = { ...next, at: now };
        const { error } = await supabase.from("tracking_pings").insert({
          booking_id: booking.id,
          professional_id: booking.professional_id,
          lat: next.lat,
          lng: next.lng,
          accuracy_m: pos.coords.accuracy,
          speed_mps: pos.coords.speed,
          heading: pos.coords.heading,
        });
        // Si la base lo rechaza (estado cambió), se reintenta en la próxima lectura.
        if (error) sentRef.current = null;
      },
      () => setGpsError("Activa el permiso de ubicación para que la familia te vea llegar."),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [sharing, booking.id, booking.professional_id]);

  const points = useMemo<MapPoint[]>(() => {
    const arr: MapPoint[] = [];
    if (booking.service_lat != null && booking.service_lng != null) {
      arr.push({
        id: "destination",
        lat: booking.service_lat,
        lng: booking.service_lng,
        title: "Destino del servicio",
        subtitle: booking.service_address ?? undefined,
        status: "available",
      });
    }
    if (lastPing && tracked) {
      arr.push({
        id: "professional",
        lat: lastPing.lat,
        lng: lastPing.lng,
        title: booking.status === "in_progress" ? "Profesional cuidando" : "Profesional en camino",
        subtitle: lastPing.speed_mps
          ? `${(lastPing.speed_mps * 3.6).toFixed(0)} km/h`
          : "Última posición",
        status: "reserved",
      });
    }
    return arr;
  }, [booking, lastPing, tracked]);

  const dest: LatLng | null =
    booking.service_lat != null && booking.service_lng != null
      ? { lat: booking.service_lat, lng: booking.service_lng }
      : null;
  const km =
    dest && lastPing && tracked ? distanceKm(dest, { lat: lastPing.lat, lng: lastPing.lng }) : null;
  const eta = km != null && booking.status === "in_route" ? etaMinutes(km) : null;

  const center =
    (tracked ? lastPing : null) ??
    (dest ? { lat: dest.lat, lng: dest.lng } : { lat: 4.711, lng: -74.072 });

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="text-xs text-muted-foreground">Seguimiento en vivo</p>
          <p className="font-semibold text-sm">
            {eta != null ? (
              <>
                Llega en <span className="text-biosensor">{eta} min</span>
                {km != null && <span className="text-muted-foreground"> · {formatKm(km)}</span>}
              </>
            ) : isProfessional && paused && tracked ? (
              "Ubicación en pausa"
            ) : (
              trackingWaitText(booking.status, isProfessional)
            )}
          </p>
        </div>
        {!readOnly && <EmergencyButton bookingId={booking.id} />}
      </header>

      <OffersMap
        points={points}
        height={360}
        center={{ lat: center.lat, lng: center.lng }}
        zoom={13}
      />

      <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
        {isProfessional && tracked ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={!paused}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
              sharing
                ? "bg-biosensor text-biosensor-foreground"
                : "bg-foreground text-background hover:opacity-90"
            }`}
          >
            {sharing ? (
              <>
                <Radio className="h-4 w-4 animate-pulse" /> Compartiendo · tocar para pausar
              </>
            ) : (
              <>
                <Navigation className="h-4 w-4" /> Reanudar ubicación
              </>
            )}
          </button>
        ) : isProfessional ? (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Pause className="h-3 w-3" /> Tu ubicación no se comparte en este estado
          </p>
        ) : (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            {lastPing && tracked ? (
              <>
                <Radio className="h-3 w-3 text-biosensor animate-pulse" />
                Última actualización {new Date(lastPing.created_at).toLocaleTimeString("es-CO")}
              </>
            ) : tracked ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground text-right">
          Solo en camino y durante el cuidado · Habeas Data · Ley 1581/2012
        </p>
      </div>
      {gpsError && sharing && (
        <p role="alert" className="px-4 pb-3 text-xs font-medium text-warn">
          {gpsError}
        </p>
      )}
    </div>
  );
}
