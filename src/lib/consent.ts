/**
 * Consentimiento de cookies y publicidad (Ley 1581 de 2012 + Google Consent Mode v2 + consentimiento del píxel de Meta).
 *
 * Mientras la persona no elija, todo lo publicitario y de analítica arranca en «denegado»:
 *  - Google (GA4 y AdSense): `gtag('consent','default', … denied)` antes de que cargue cualquier etiqueta.
 *    AdSense muestra solo anuncios no personalizados y sin cookies publicitarias.
 *  - Meta: `fbq('consent','revoke')` antes de `init`; el píxel no envía nada hasta que haya «grant».
 * Con «Aceptar» se actualiza todo a «granted». Con «Solo necesarias» queda denegado y el píxel ni se carga.
 *
 * La elección vive en localStorage `hx-consent` = { v, choice: "granted" | "denied", at }.
 * Global Privacy Control o `hx-no-tracking` = "1" cuentan como «denegado» y no se muestra el aviso.
 */

export const CONSENT_KEY = "hx-consent";
export const CONSENT_VERSION = 1;
export const CONSENT_EVENT = "hx-consent-change";
export const CONSENT_OPEN_EVENT = "hx-consent-open";

export type ConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __hxConsent?: ConsentChoice | null;
  }
}

/** Rutas donde no se muestra el aviso (paneles internos; ahí no hay anuncios ni píxel). */
export const CONSENT_BANNER_HIDDEN_PREFIXES = [
  "/superadmin",
  "/admin",
  "/acceso-equipo",
  "/lovable",
  "/.lovable",
];

export function bannerAllowedOnPath(pathname: string): boolean {
  return !CONSENT_BANNER_HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

export function parseStoredConsent(raw: string | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: number; choice?: string };
    if (v?.v !== CONSENT_VERSION) return null;
    return v.choice === "granted" || v.choice === "denied" ? v.choice : null;
  } catch {
    return null;
  }
}

function privacySignal(): boolean {
  if (typeof window === "undefined") return true;
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl)
    return true;
  try {
    if (localStorage.getItem("hx-no-tracking") === "1") return true;
  } catch {
    /* almacenamiento bloqueado */
  }
  return false;
}

function isNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Elección vigente: null si aún no eligió. GPC / opt-out / app nativa ⇒ «denied». */
export function getConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  if (privacySignal() || isNative()) return "denied";
  try {
    return parseStoredConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return window.__hxConsent ?? null;
  }
}

export function hasAdConsent(): boolean {
  return getConsent() === "granted";
}

/** ¿Hay que preguntar? Solo en web, sin señal de privacidad y sin elección guardada. */
export function needsConsentPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (privacySignal() || isNative()) return false;
  return getConsent() === null;
}

export function googleConsentState(choice: ConsentChoice | null) {
  const v = choice === "granted" ? "granted" : "denied";
  return {
    ad_storage: v,
    ad_user_data: v,
    ad_personalization: v,
    analytics_storage: v,
  } as const;
}

function gtagShim(..._args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  // gtag exige el objeto `arguments`, no un array.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

/** Guarda la elección y la aplica en caliente a Google y Meta. */
export function setConsent(choice: ConsentChoice): void {
  if (typeof window === "undefined") return;
  window.__hxConsent = choice;
  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ v: CONSENT_VERSION, choice, at: new Date().toISOString() }),
    );
  } catch {
    /* sin almacenamiento: vale solo para esta visita */
  }
  try {
    const gtag = window.gtag ?? gtagShim;
    gtag("consent", "update", googleConsentState(choice));
  } catch {
    /* ok */
  }
  try {
    const w = window as Window & {
      adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: number };
    };
    const q = (w.adsbygoogle = w.adsbygoogle || []);
    q.requestNonPersonalizedAds = choice === "granted" ? 0 : 1;
  } catch {
    /* ok */
  }
  try {
    if (window.fbq) window.fbq("consent", choice === "granted" ? "grant" : "revoke");
  } catch {
    /* ok */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
  } catch {
    /* ok */
  }
}

/** Abre de nuevo el aviso (enlace «Preferencias de cookies» del pie de página). */
export function openConsentPreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

/**
 * Script inline: debe ir PRIMERO en <head>, antes de GA4, AdSense y el píxel.
 * Define dataLayer/gtag, fija el consentimiento por defecto (denegado, o el guardado) y expone window.__hxConsent.
 */
export function consentHeadScript(): string {
  return `(function(){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments)};var c=null;try{var n=navigator.globalPrivacyControl||localStorage.getItem('hx-no-tracking')==='1'||(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());if(n){c='denied'}else{var r=JSON.parse(localStorage.getItem('${CONSENT_KEY}')||'null');if(r&&r.v===${CONSENT_VERSION}&&(r.choice==='granted'||r.choice==='denied'))c=r.choice;}}catch(e){}window.__hxConsent=c;var d='denied';gtag('consent','default',{ad_storage:d,ad_user_data:d,ad_personalization:d,analytics_storage:d,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',false);if(c==='granted'){var g='granted';gtag('consent','update',{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g});}var a=window.adsbygoogle=window.adsbygoogle||[];a.requestNonPersonalizedAds=c==='granted'?0:1;})();`;
}
