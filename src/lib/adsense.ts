/**
 * Google AdSense — configuración y carga única del script.
 *
 * Variables de entorno (Vite):
 *   VITE_ADSENSE_PUBLISHER_ID  ID de editor, p. ej. "ca-pub-1234567890123456"
 *   VITE_ADSENSE_SLOT          ID del bloque de anuncios por defecto (data-ad-slot)
 *
 * Sin ID de editor no se carga nada. Sin ID de bloque no se pinta ningún anuncio.
 * Nunca se muestran anuncios en la app nativa (Capacitor: AdSense no permite apps)
 * ni en rutas privadas, de pago o con datos de pacientes.
 */

const RAW_PUBLISHER = (import.meta.env.VITE_ADSENSE_PUBLISHER_ID ?? "").trim();
export const ADSENSE_PUBLISHER_ID = /^ca-pub-\d{10,20}$/.test(RAW_PUBLISHER) ? RAW_PUBLISHER : "";
export const ADSENSE_DEFAULT_SLOT = (import.meta.env.VITE_ADSENSE_SLOT ?? "").trim();

/** Prefijos de ruta donde nunca hay publicidad. Mantener en sync con __root.tsx. */
export const ADSENSE_BLOCKED_PREFIXES = [
  "/dashboard",
  "/superadmin",
  "/admin",
  "/acceso-equipo",
  "/auth",
  "/reset-password",
  "/servicio",
  "/pago",
  "/mensajes",
  "/oferta",
  "/pair",
  "/institution",
  "/lovable",
  "/.lovable",
];

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function adsAllowedOnPath(pathname: string): boolean {
  return !ADSENSE_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

export function adsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Boolean(ADSENSE_PUBLISHER_ID) && !isNativeApp() && adsAllowedOnPath(window.location.pathname)
  );
}

const SCRIPT_SRC = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

/** Inserta el script de AdSense una sola vez (si __root aún no lo hizo). */
export function ensureAdsenseScript(): void {
  if (typeof document === "undefined" || !ADSENSE_PUBLISHER_ID) return;
  if (document.querySelector(`script[src^="${SCRIPT_SRC}"]`)) return;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `${SCRIPT_SRC}?client=${ADSENSE_PUBLISHER_ID}`;
  document.head.appendChild(s);
}

/** Script inline para <head>: carga diferida, solo en web y rutas públicas. */
export function adsenseHeadLoader(): string {
  if (!ADSENSE_PUBLISHER_ID) return "";
  return `(function(){var P=${JSON.stringify(ADSENSE_PUBLISHER_ID)},B=${JSON.stringify(
    ADSENSE_BLOCKED_PREFIXES,
  )},p=location.pathname;try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())return;}catch(e){}for(var i=0;i<B.length;i++){if(p===B[i]||p.indexOf(B[i]+'/')===0||p.indexOf(B[i]+'.')===0)return;}function load(){if(document.querySelector('script[src^="${SCRIPT_SRC}"]'))return;var s=document.createElement('script');s.async=true;s.crossOrigin='anonymous';s.src='${SCRIPT_SRC}?client='+P;document.head.appendChild(s);}if('requestIdleCallback' in window){requestIdleCallback(load,{timeout:4000})}else{setTimeout(load,3000)}})();`;
}
