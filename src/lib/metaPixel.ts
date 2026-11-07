/**
 * Píxel de Meta (Facebook) — carga única, PageView por cada cambio de ruta y eventos de conversión.
 *
 * Variable de entorno opcional (Vite):
 *   VITE_META_PIXEL_IDS  IDs separados por coma. Sin ella se usan los IDs de abajo.
 *
 * Reglas (Humanix maneja datos de salud):
 *  - Nunca en la app nativa (Capacitor: Apple exige permiso de rastreo) ni si el navegador pide no rastrear
 *    (Global Privacy Control) o la persona lo desactivó (localStorage `hx-no-tracking` = "1").
 *  - Nunca en paneles internos (superadmin, admin, equipo).
 *  - En rutas con datos del servicio o de pacientes no se manda PageView; solo eventos de conversión explícitos.
 *  - `autoConfig` apagado: el píxel no lee botones, formularios ni metadatos de la página por su cuenta.
 *  - `disablePushState`: el píxel no cuenta solo los cambios de ruta; los contamos aquí con el filtro de rutas.
 *  - Los parámetros pasan por una lista blanca: nunca nombres, correos, teléfonos, direcciones ni notas clínicas.
 */

const DEFAULT_PIXEL_IDS = ["1005277195957747", "2544561375984277"];

function parseIds(raw: string | undefined): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{10,20}$/.test(s));
  return ids.length ? Array.from(new Set(ids)) : DEFAULT_PIXEL_IDS;
}

export const META_PIXEL_IDS: string[] = parseIds(import.meta.env?.VITE_META_PIXEL_IDS);

/** Sin píxel en absoluto. */
export const PIXEL_BLOCKED_PREFIXES = [
  "/superadmin",
  "/admin",
  "/acceso-equipo",
  "/lovable",
  "/.lovable",
];

/** Píxel cargado (para conversiones), pero sin PageView: aquí hay datos del servicio o de pacientes. */
export const PIXEL_NO_PAGEVIEW_PREFIXES = [
  "/dashboard",
  "/servicio",
  "/mensajes",
  "/pair",
  "/institution",
  "/reset-password",
];

const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";
const OPT_OUT_KEY = "hx-no-tracking";

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

export function pixelAllowedOnPath(pathname: string): boolean {
  return !matches(pathname, PIXEL_BLOCKED_PREFIXES);
}

export function pageViewAllowedOnPath(pathname: string): boolean {
  return pixelAllowedOnPath(pathname) && !matches(pathname, PIXEL_NO_PAGEVIEW_PREFIXES);
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  disablePushState?: boolean;
  loaded?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    __hxPixel?: boolean;
  }
}

function trackingRefused(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) return true;
  } catch {
    /* sin Capacitor */
  }
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl)
    return true;
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === "1") return true;
  } catch {
    /* almacenamiento bloqueado */
  }
  return false;
}

/** Instala el píxel una sola vez (si el head no lo hizo ya). Devuelve si quedó activo. */
export function ensureMetaPixel(): boolean {
  if (typeof window === "undefined" || !META_PIXEL_IDS.length) return false;
  if (window.__hxPixel && window.fbq) return true;
  if (trackingRefused() || !pixelAllowedOnPath(window.location.pathname)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = window as any;
  if (!f.fbq) {
    const n: Fbq = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue!.push(args);
    } as Fbq;
    f.fbq = n;
    if (!f._fbq) f._fbq = n;
    (n as unknown as { push: Fbq }).push = n;
    n.loaded = true;
    (n as unknown as { version: string }).version = "2.0";
    n.queue = [];
  }
  const fbq = window.fbq!;
  fbq.disablePushState = true;
  for (const id of META_PIXEL_IDS) {
    fbq("set", "autoConfig", false, id);
    fbq("init", id);
  }
  window.__hxPixel = true;
  if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    const s = document.createElement("script");
    s.async = true;
    s.src = SCRIPT_SRC;
    document.head.appendChild(s);
  }
  return true;
}

/**
 * Script inline para <head>: crea la cola de `fbq` ya (los eventos tempranos no se pierden), registra el PageView
 * de la primera página y baja fbevents.js cuando el navegador está libre.
 */
export function metaPixelHeadLoader(): string {
  if (!META_PIXEL_IDS.length) return "";
  return `(function(){var I=${JSON.stringify(META_PIXEL_IDS)},B=${JSON.stringify(
    PIXEL_BLOCKED_PREFIXES,
  )},N=${JSON.stringify(PIXEL_NO_PAGEVIEW_PREFIXES)},p=location.pathname;function m(L){for(var i=0;i<L.length;i++){if(p===L[i]||p.indexOf(L[i]+'/')===0||p.indexOf(L[i]+'.')===0)return true}return false}try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())return;if(navigator.globalPrivacyControl)return;if(localStorage.getItem('${OPT_OUT_KEY}')==='1')return;}catch(e){}if(m(B))return;!function(f,b,e,v,n){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window,document);fbq.disablePushState=true;for(var j=0;j<I.length;j++){fbq('set','autoConfig',false,I[j]);fbq('init',I[j]);}window.__hxPixel=true;if(!m(N))fbq('track','PageView');function load(){if(document.querySelector('script[src="${SCRIPT_SRC}"]'))return;var t=document.createElement('script');t.async=true;t.src='${SCRIPT_SRC}';document.head.appendChild(t);}if('requestIdleCallback' in window){requestIdleCallback(load,{timeout:3500})}else{setTimeout(load,2500)}})();`;
}

/** URL del píxel para <noscript> (solo el primero). */
export function metaPixelNoscriptSrc(): string {
  const id = META_PIXEL_IDS[0];
  return id ? `https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1` : "";
}

export type PixelEvent =
  | "PageView"
  | "CompleteRegistration"
  | "Lead"
  | "Schedule"
  | "InitiateCheckout"
  | "Purchase"
  | "Subscribe"
  | "Contact";

/** Únicos parámetros que salen hacia Meta. Todo lo demás se descarta. */
type PixelParams = {
  value?: number;
  currency?: "COP";
  content_name?: string;
  content_category?: string;
  content_type?: string;
  num_items?: number;
  status?: string;
};

const ALLOWED_KEYS = new Set([
  "value",
  "currency",
  "content_name",
  "content_category",
  "content_type",
  "num_items",
  "status",
]);

export function sanitizePixelParams(params: Record<string, unknown> = {}): PixelParams {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(k) || v === undefined || v === null) continue;
    if (k === "value" || k === "num_items") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = Math.round(n);
    } else if (typeof v === "string") {
      // Etiquetas cortas y sin datos de contacto.
      const s = v.slice(0, 60);
      if (!/@|\d{7,}/.test(s)) out[k] = s;
    }
  }
  if (out.value !== undefined && !out.currency) out.currency = "COP";
  return out as PixelParams;
}

/** Registra un evento estándar. Silencioso si el píxel no aplica (nativo, opt-out, panel interno, SSR). */
export function trackPixel(
  event: PixelEvent,
  params?: Record<string, unknown>,
  opts?: { eventID?: string },
): void {
  try {
    if (typeof window === "undefined") return;
    if (!pixelAllowedOnPath(window.location.pathname)) return;
    if (!ensureMetaPixel() || !window.fbq) return;
    const clean = sanitizePixelParams(params);
    if (opts?.eventID) window.fbq("track", event, clean, { eventID: opts.eventID });
    else window.fbq("track", event, clean);
  } catch {
    /* la analítica nunca rompe la app */
  }
}

/** Como trackPixel, pero una sola vez por clave en este navegador (p. ej. un Purchase por cobro). */
export function trackPixelOnce(
  key: string,
  event: PixelEvent,
  params?: Record<string, unknown>,
): void {
  const storeKey = `hx-px:${event}:${key}`;
  try {
    if (localStorage.getItem(storeKey)) return;
    localStorage.setItem(storeKey, String(Date.now()));
  } catch {
    /* sin almacenamiento: igual Meta deduplica por eventID */
  }
  trackPixel(event, params, { eventID: `${event}-${key}` });
}

/** PageView para navegación dentro de la SPA (la primera página la registra el head). */
export function trackPixelPageView(pathname: string): void {
  if (!pageViewAllowedOnPath(pathname)) return;
  trackPixel("PageView");
}

// ── Cobros: InitiateCheckout al abrir el checkout, Purchase cuando Wompi confirma ─────────────────────────

export type PixelChargeKind = "booking" | "topup" | "plan";

const CHARGE_LABEL: Record<PixelChargeKind, string> = {
  booking: "Turno de cuidado",
  topup: "Recarga de billetera",
  plan: "Plan institucional",
};

const PENDING_KEY = "hx-px:pending-charge";

export function trackCheckoutStarted(kind: PixelChargeKind, chargeId: string, amountCop: number) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ kind, chargeId, amountCop, at: Date.now() }),
    );
  } catch {
    /* ok */
  }
  trackPixelOnce(chargeId, "InitiateCheckout", {
    value: amountCop,
    content_name: CHARGE_LABEL[kind],
    content_category: kind,
    num_items: 1,
  });
}

export function trackChargePaid(kind: PixelChargeKind, chargeId: string, amountCop: number) {
  const params = {
    value: amountCop,
    content_name: CHARGE_LABEL[kind],
    content_category: kind,
    num_items: 1,
  };
  trackPixelOnce(chargeId, "Purchase", params);
  if (kind === "plan") trackPixelOnce(chargeId, "Subscribe", params);
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw && (JSON.parse(raw) as { chargeId?: string }).chargeId === chargeId)
      localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ok */
  }
}

/** En /pago/exito: si el pago quedó aprobado, registra el Purchase del último checkout abierto (máx. 2 h). */
export function trackPendingChargePaid(kind: PixelChargeKind | null): void {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as {
      kind: PixelChargeKind;
      chargeId: string;
      amountCop: number;
      at: number;
    };
    if (!p.chargeId || Date.now() - p.at > 2 * 3600_000) return;
    if (kind && kind !== p.kind) return;
    trackChargePaid(p.kind, p.chargeId, p.amountCop);
  } catch {
    /* ok */
  }
}
