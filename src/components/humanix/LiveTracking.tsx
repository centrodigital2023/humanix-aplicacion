// Seguimiento en vivo del cuidador: mapa con ruta + ETA + emergencia.
// Cliente: se suscribe a tracking_pings. Profesional: emite ubicación cada 15s.
import { useEffect, useMemo, useState } from "react";
import { Navigation, Loader2, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OffersMap, type MapPoint } from "./OffersMap";
import { EmergencyButton } from "./EmergencyButton";
import { distanceKm, formatKm, type LatLng } from "@/lib/geo";

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
}: {
  booking: Booking;
  isProfessional: boolean;
}) {
  const [lastPing, setLastPing] = useState<Ping | null>(null);
  const [shareEnabled, setShareEnabled] = useState(false);

  // 1) Cargar último ping al iniciar
  useEffect(() => {
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
  }, [booking.id]);

  // 2) Suscripción Realtime
  useEffect(() => {
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
  }, [booking.id]);

  // 3) Si soy el profesional y activé compartir, publicar ubicación cada 15s
  useEffect(() => {
    if (!isProfessional || !shareEnabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        try {
          await supabase.from("tracking_pings").insert({
            booking_id: booking.id,
            professional_id: booking.professional_id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            speed_mps: pos.coords.speed,
            heading: pos.coords.heading,
          });
        } catch {
          // ignore
        }
      },
      () => {
        // permiso denegado o error
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isProfessional, shareEnabled, booking.id, booking.professional_id]);

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
    if (lastPing) {
      arr.push({
        id: "professional",
        lat: lastPing.lat,
        lng: lastPing.lng,
        title: "Profesional en ruta",
        subtitle: lastPing.speed_mps
          ? `${(lastPing.speed_mps * 3.6).toFixed(0)} km/h`
          : "Última posición",
        status: "reserved",
      });
    }
    return arr;
  }, [booking, lastPing]);

  const dest: LatLng | null =
    booking.service_lat != null && booking.service_lng != null
      ? { lat: booking.service_lat, lng: booking.service_lng }
      : null;
  const km = dest && lastPing ? distanceKm(dest, { lat: lastPing.lat, lng: lastPing.lng }) : null;
  const eta = km != null ? etaMinutes(km) : null;

  const center =
    lastPing ?? (dest ? { lat: dest.lat, lng: dest.lng } : { lat: 4.711, lng: -74.072 });

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
            ) : isProfessional ? (
              "Activa el compartir ubicación para iniciar la ruta"
            ) : (
              "Esperando primera ubicación del profesional…"
            )}
          </p>
        </div>
        <EmergencyButton bookingId={booking.id} />
      </header>

      <OffersMap
        points={points}
        height={360}
        center={{ lat: center.lat, lng: center.lng }}
        zoom={13}
      />

      <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
        {isProfessional ? (
          <button
            onClick={() => setShareEnabled((s) => !s)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
              shareEnabled
                ? "bg-biosensor text-biosensor-foreground"
                : "bg-foreground text-background hover:opacity-90"
            }`}
          >
            {shareEnabled ? (
              <>
                <Radio className="h-4 w-4 animate-pulse" /> Compartiendo ubicación
              </>
            ) : (
              <>
                <Navigation className="h-4 w-4" /> Iniciar ruta y compartir ubicación
              </>
            )}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            {lastPing ? (
              <>
                <Radio className="h-3 w-3 text-biosensor animate-pulse" />
                Última actualización {new Date(lastPing.created_at).toLocaleTimeString("es-CO")}
              </>
            ) : (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Habeas Data · Ley 1581/2012</p>
      </div>
    </div>
  );
}
