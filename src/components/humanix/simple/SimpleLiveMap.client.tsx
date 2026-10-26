// Mapa en vivo, versión simple: pines grandes con emoji y datos reales por las funciones seguras de la base (`map_professionals` y
// `map_open_demand`, ver `hooks/use-live-map.ts`): nunca teléfono ni dirección, posiciones en cuadrícula de ~1 km y, si alguien no
// tiene ubicación, simplemente no es un pin (no se inventa un sitio). Se actualiza solo cuando la base avisa que algo cambió.
// Al tocar un pin aparece una tarjeta grande abajo con 1-2 botones. Quien tiene documentos pendientes sale en ámbar con ⚠ y, al tocarlo,
// se abre el aviso de documentos (Habeas Data) en lugar de poder pedirlo (`lib/mapVerification.ts`).
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Link } from "@tanstack/react-router";
import { Loader2, LocateFixed, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-has-session";
import {
  useMapDemand,
  useMapInstitutions,
  useValidatedMapProfessionals,
} from "@/hooks/use-live-map";
import { BOGOTA, distanceKm, formatKm, getBrowserLocation, type LatLng } from "@/lib/geo";
import { demandHeadline, STATUS_LABEL, withPosition, type MapDemand } from "@/lib/liveMap";
import { trustBadgeText } from "@/lib/trustScore";
import { currentMapSelection, presenceLine, proSubtitle } from "@/lib/mapDirectory";
import { displayCity, idleInstitutions } from "@/lib/proMapDemand";
import { PIN_TONE_COLOR, canActFromMap, pendingDocsCopy, pinTone } from "@/lib/mapVerification";
import { useVoice } from "./voice";
import type { MapPin, SimpleLiveMapProps } from "./SimpleLiveMap";

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const escapeAttr = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function pinIcon(pin: MapPin, selected: boolean) {
  const tone = pinTone(pin);
  const ring = PIN_TONE_COLOR[tone];
  const size = selected ? 58 : 46;
  const pulse = pin.live
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:3px solid ${ring};opacity:.55;animation:hxPulse 1.4s infinite"></span>`
    : "";
  const label = tone === "pending" ? "⚠ Docs" : pin.badge;
  const badge = label
    ? `<span style="position:absolute;left:50%;top:100%;transform:translate(-50%,4px);white-space:nowrap;background:${ring};color:#fff;font:700 12px/1 system-ui;padding:4px 7px;border-radius:9999px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${label}</span>`
    : "";
  // Verificado con foto: la foto es el pin. Pendiente: siempre el emoji (sin foto) con el aviso.
  const face =
    tone !== "pending" && pin.avatarUrl
      ? `<img src="${escapeAttr(pin.avatarUrl)}" alt="" style="width:100%;height:100%;border-radius:9999px;object-fit:cover" />`
      : pin.emoji;
  const warn =
    tone === "pending"
      ? `<span style="position:absolute;right:-4px;top:-4px;width:20px;height:20px;border-radius:9999px;background:${ring};color:#fff;font:700 13px/20px system-ui;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3)">!</span>`
      : "";
  return L.divIcon({
    className: "hx-simple-pin",
    html: `<div style="position:relative;width:${size}px;height:${size}px">${pulse}<div style="width:100%;height:100%;border-radius:9999px;background:#fff;border:4px solid ${ring};display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:${selected ? 30 : 24}px;box-shadow:0 6px 16px rgba(15,76,129,.30);opacity:${pin.dim && tone !== "pending" ? 0.75 : 1}">${face}</div>${warn}${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const ME_ICON = () =>
  L.divIcon({
    className: "hx-simple-me",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:#0f4c81;border:4px solid #fff;box-shadow:0 0 0 8px rgba(15,76,129,.25),0 4px 12px rgba(0,0,0,.35)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 13, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function FitPins({ pins, enabled }: { pins: MapPin[]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || pins.length === 0) return;
    const b = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(b, { padding: [50, 50], maxZoom: 13 });
    // Solo la primera vez que llegan pines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pins.length > 0]);
  return null;
}

function ClickAway({ onClick }: { onClick: () => void }) {
  useMapEvents({ click: onClick });
  return null;
}

/** Familias e instituciones con solicitud abierta y ubicación (las demás van a la lista «sin ubicación»). */
function demandPins(list: MapDemand[]): MapPin[] {
  return withPosition(list).map(
    (d) =>
      ({
        // Con oferta, el pin abre esa oferta; con horas sueltas, abre las oportunidades.
        id: d.offerId ?? d.id,
        lat: d.lat,
        lng: d.lng,
        emoji: d.kind === "institution" ? "🏥" : "🏠",
        title: d.kind === "institution" ? d.name : `Familia ${d.name}`,
        subtitle: demandHeadline(d),
        price: d.topHourly ? `Hasta ${COP(d.topHourly)} / hora` : null,
        badge: d.topHourly ? `${Math.round(d.topHourly / 1000)}k` : undefined,
        trust: d.trust.score != null ? trustBadgeText(d.trust) : null,
        kind: d.kind,
        verification: d.verification,
        raw: d,
      }) satisfies MapPin,
  );
}

export function SimpleLiveMap({
  mode,
  height = 420,
  onPrimary,
  primaryLabel,
  secondary,
  center,
}: SimpleLiveMapProps) {
  const { say } = useVoice();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);
  /** Pin con documentos pendientes cuyo aviso está abierto. */
  const [docsPin, setDocsPin] = useState<MapPin | null>(null);
  /** Mapa de ofertas: filtro rápido por tipo de quien publica. */
  const [kindFilter, setKindFilter] = useState<"all" | "family" | "institution">("all");
  const session = useSession();

  // Profesionales (familias e instituciones) u oferta abierta (profesionales). Solo se pide lo que ese mapa necesita.
  // Los profesionales llegan con los datos validados del buscador: sin nombre, ciudad o turnos no hay pin.
  const prosQ = useValidatedMapProfessionals({
    authed: session.has,
    enabled: mode === "pros",
    limit: 500,
  });
  const demandQ = useMapDemand({ authed: session.has, enabled: mode === "offers" && session.has });
  // Instituciones visibles sin turnos abiertos: también salen en el mapa del profesional (atenuadas). Las familias, solo con solicitud.
  const instQ = useMapInstitutions({
    authed: session.has,
    enabled: mode === "offers" && session.has,
  });

  const pins = useMemo<MapPin[] | null>(() => {
    if (mode === "pros") {
      if (!prosQ.data) return null;
      const now = Date.now();
      const verified = withPosition(prosQ.data).map(
        (p) =>
          ({
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            emoji: "👩‍⚕️",
            title: p.name,
            subtitle: proSubtitle(p),
            avatarUrl: p.avatarUrl,
            price: p.hourlyRate ? `${COP(p.hourlyRate)} / hora` : null,
            rating: p.rating,
            verified: p.verified || p.rethus,
            dim: p.status !== "available",
            live: p.live,
            trust: p.trust.score != null ? trustBadgeText(p.trust) : null,
            statusLabel: STATUS_LABEL[p.status],
            presence: presenceLine(p, now),
            kind: "pro",
            verification: "verified",
            raw: p,
          }) satisfies MapPin,
      );
      const pending = withPosition(prosQ.pending).map(
        (p) =>
          ({
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            emoji: "👩‍⚕️",
            title: p.name,
            subtitle: [p.specialty?.trim() || "Cuidado en casa", displayCity(p.city)]
              .filter(Boolean)
              .join(" · "),
            statusLabel: "⚠ Documentos pendientes",
            live: p.live,
            kind: "pro",
            verification: "pending",
            raw: p,
          }) satisfies MapPin,
      );
      return [...verified, ...pending];
    }
    if (!session.has) return session.ready ? [] : null;
    if (!demandQ.data) return null;
    const idle = idleInstitutions(instQ.data ?? [], demandQ.data).map(
      (i) =>
        ({
          id: `inst-${i.id}`,
          lat: i.lat as number,
          lng: i.lng as number,
          emoji: "🏥",
          title: i.name,
          subtitle: [displayCity(i.city), "Sin turnos abiertos ahora"].filter(Boolean).join(" · "),
          dim: true,
          live: i.live,
          verified: i.verified,
          kind: "institution",
          verification: i.verification,
          raw: { offerId: null, kind: "institution", id: i.id },
        }) satisfies MapPin,
    );
    return [...demandPins(demandQ.data), ...idle];
  }, [mode, prosQ.data, prosQ.pending, demandQ.data, instQ.data, session.has, session.ready]);

  const merged = useMemo(
    () =>
      (pins ?? []).filter(
        (p) => mode !== "offers" || kindFilter === "all" || p.kind === kindFilter,
      ),
    [pins, mode, kindFilter],
  );
  const selected = currentMapSelection(merged, selectedId);
  const failed = mode === "pros" ? prosQ.isError : demandQ.isError || instQ.isError;

  const ordered = useMemo(() => {
    if (!me) return merged;
    return [...merged].sort((a, b) => distanceKm(me, a) - distanceKm(me, b));
  }, [merged, me]);

  const activeCount = merged.filter((p) => pinTone(p) === "available").length;
  const busyCount = merged.filter((p) => pinTone(p) === "busy").length;
  const pendingCount = merged.filter((p) => pinTone(p) === "pending").length;
  const liveCount = merged.filter((p) => p.live).length;

  const locate = async () => {
    setLocating(true);
    const pos = await getBrowserLocation();
    setLocating(false);
    if (!pos) {
      say("No vimos tu ubicación.");
      return;
    }
    setMe(pos);
    setFlyTarget(pos);
    const near = merged.filter((p) => pinTone(p) === "available" && distanceKm(pos, p) <= 5).length;
    say(
      mode === "pros"
        ? `Hay ${near} profesionales a menos de 5 kilómetros.`
        : `Hay ${near} ofertas a menos de 5 kilómetros.`,
    );
  };

  const select = (pin: MapPin) => {
    if (pin.verification === "pending") {
      // Documentos pendientes: el aviso va primero (sin contratación ni asignación directa).
      setSelectedId(null);
      setDocsPin(pin);
      say(`${pin.title}. Documentos pendientes.`);
      return;
    }
    setSelectedId(pin.id);
    say(`${pin.title}. ${pin.price ?? ""}`);
  };
  const docsCopy = docsPin
    ? pendingDocsCopy(docsPin.kind ?? "pro", !!session.userId && session.userId === docsPin.id)
    : null;

  const initialCenter = center ?? BOGOTA;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-border shadow-xl shadow-trust/10">
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: `clamp(320px, 62vh, ${height}px)`, width: "100%" }}
        attributionControl
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitPins pins={merged} enabled={!me} />
        <FlyTo target={flyTarget} />
        <ClickAway onClick={() => setSelectedId(null)} />
        {me && <Marker position={[me.lat, me.lng]} icon={ME_ICON()} />}
        {ordered.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinIcon(p, selected?.id === p.id)}
            eventHandlers={{ click: () => select(p) }}
            keyboard
            title={p.title}
            alt={p.title}
          />
        ))}
      </MapContainer>

      {/* Contador en vivo (dato real) */}
      <div
        className="pointer-events-none absolute left-3 right-20 top-3 z-[500] flex flex-wrap gap-2"
        aria-live="polite"
      >
        {mode === "pros" && pins !== null && (
          <span className="rounded-full bg-card px-3.5 py-2 text-sm font-bold text-card-foreground shadow-md">
            {merged.length} en el mapa
          </span>
        )}
        <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-sm font-bold text-trust-deep shadow-md">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          {pins === null
            ? "Cargando…"
            : mode === "pros"
              ? `${activeCount} disponibles`
              : `${activeCount} ${activeCount === 1 ? "solicitud" : "solicitudes"}`}
        </span>
        {liveCount > 0 && (
          <span className="rounded-full bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white shadow-md">
            📡 {liveCount} en vivo
          </span>
        )}
        {mode === "pros" && busyCount > 0 && (
          <span className="rounded-full bg-white/95 px-3.5 py-2 text-sm font-bold text-gray-600 shadow-md">
            ⚪ {busyCount} ocupados
          </span>
        )}
        {pendingCount > 0 && (
          <span className="rounded-full bg-warn px-3.5 py-2 text-sm font-bold text-warn-foreground shadow-md">
            ⚠ {pendingCount} en revisión
          </span>
        )}
      </div>

      <Button
        type="button"
        onClick={locate}
        disabled={locating}
        className="absolute right-3 top-3 z-[500] inline-flex min-h-12 items-center gap-2 rounded-full bg-trust-deep px-4 text-base font-bold text-white shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
      >
        {locating ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
        )}
        Yo
      </Button>

      {/* Leyenda (perfiles) o filtros rápidos por tipo (ofertas) */}
      {!selected && (
        <div className="absolute bottom-3 left-3 right-3 z-[500] flex flex-wrap gap-2 text-sm font-bold">
          {mode === "pros" ? (
            <>
              <span className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-trust-deep shadow">
                🔵 Yo
              </span>
              <span className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-ok shadow">
                🟢 Disponible
              </span>
              <span className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-gray-600 shadow">
                ⚪ Ocupado
              </span>
              <span className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-warn shadow">
                ⚠ Documentos pendientes
              </span>
            </>
          ) : (
            <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "Todos"],
                  ["family", "🏠 Familia"],
                  ["institution", "🏥 EPS · IPS · Clínica"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={kindFilter === key}
                  onClick={() => {
                    setKindFilter(key);
                    setSelectedId(null);
                  }}
                  className={`min-h-10 rounded-full px-3.5 py-1.5 shadow transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40 ${
                    kindFilter === key ? "bg-trust-deep text-white" : "bg-white/95 text-trust-deep"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-warn shadow">
                ⚠ Sin validar
              </span>
            </div>
          )}
        </div>
      )}

      {(failed || (pins !== null && pins.length === 0)) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[500] mx-auto w-fit max-w-[90%] rounded-full bg-white/95 px-4 py-2 text-center text-base font-bold text-trust-deep shadow-md">
          {failed
            ? "No pudimos cargar el mapa. Intenta de nuevo."
            : mode === "pros"
              ? "Aún no hay perfiles publicados con ubicación"
              : session.has
                ? "Pronto habrá solicitudes aquí"
                : "Entra como profesional para ver solicitudes cerca de ti"}
        </div>
      )}

      {/* Tarjeta grande del pin elegido */}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[600] rounded-3xl bg-white p-4 text-ink shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
          <Button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-label="Cerrar"
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 active:scale-90"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          <div className="flex items-center gap-4 pr-10">
            {selected.avatarUrl ? (
              <img
                src={selected.avatarUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-emerald-500/30"
              />
            ) : (
              <span
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sky-100 text-3xl"
                aria-hidden="true"
              >
                {selected.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{selected.title}</p>
              <p className="truncate text-sm text-gray-600">{selected.subtitle}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm font-bold">
                {selected.statusLabel && <span>{selected.statusLabel}</span>}
                {selected.verified && <span className="text-emerald-700">✅ Verificado</span>}
                {selected.trust && <span>🛡️ {selected.trust}</span>}
                {(selected.rating ?? 0) > 0 && <span>⭐ {selected.rating?.toFixed(1)}</span>}
                {me && <span>📍 {formatKm(distanceKm(me, selected))}</span>}
                {selected.live && <span className="text-emerald-700">📡 En vivo</span>}
              </p>
              {selected.presence && !selected.live && (
                <p className="mt-1 text-sm text-gray-600">{selected.presence}</p>
              )}
            </div>
          </div>
          {selected.price && <p className="mt-3 text-2xl font-bold">{selected.price}</p>}
          <div className={`mt-3 grid gap-2 ${secondary ? "grid-cols-[1fr_auto]" : ""}`}>
            <Button
              type="button"
              onClick={() => onPrimary(selected)}
              disabled={
                !canActFromMap({
                  ...selected,
                  kind: selected.kind ?? (mode === "pros" ? "pro" : "family"),
                })
              }
              className="min-h-14 rounded-2xl bg-trust-deep px-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50"
            >
              {mode === "pros" && !canActFromMap({ ...selected, kind: "pro" })
                ? (selected.raw as { status?: string } | undefined)?.status === "busy"
                  ? "Ocupado ahora"
                  : "No disponible ahora"
                : typeof primaryLabel === "function"
                  ? primaryLabel(selected)
                  : primaryLabel}
            </Button>
            {secondary && (
              <a
                href={secondary.href(selected)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={secondary.label}
                className="flex min-h-14 w-14 items-center justify-center rounded-2xl border-2 border-gray-200 text-2xl active:scale-95"
              >
                {secondary.emoji}
              </a>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!docsPin} onOpenChange={(open) => !open && setDocsPin(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warn" aria-hidden="true" />
              {docsCopy?.title}
            </DialogTitle>
            <DialogDescription className="text-base text-foreground">
              {docsCopy?.body}
            </DialogDescription>
          </DialogHeader>
          {docsPin && (
            <p className="text-sm text-muted-foreground">
              {docsPin.title}
              {docsPin.subtitle ? ` · ${docsPin.subtitle}` : ""}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {docsCopy?.cta && (
              <Button asChild className="min-h-12 rounded-2xl text-base font-bold">
                <Link to={docsCopy.cta.to}>{docsCopy.cta.label}</Link>
              </Button>
            )}
            {docsPin && docsPin.kind !== "pro" && (
              <Button
                type="button"
                className="min-h-12 rounded-2xl text-base font-bold"
                onClick={() => {
                  const pin = docsPin;
                  setDocsPin(null);
                  onPrimary(pin);
                }}
              >
                {typeof primaryLabel === "function" ? primaryLabel(docsPin) : primaryLabel}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-12 rounded-2xl text-base font-bold"
              onClick={() => setDocsPin(null)}
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
