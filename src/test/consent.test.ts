import { describe, expect, it } from "vitest";
import {
  bannerAllowedOnPath,
  consentHeadScript,
  googleConsentState,
  parseStoredConsent,
} from "@/lib/consent";
import { metaPixelHeadLoader } from "@/lib/metaPixel";

type Call = unknown[];

/** Ejecuta los scripts del head en una ventana falsa y devuelve lo que llegó a dataLayer y a fbq. */
function runHead(stored: string | null, opts: { gpc?: boolean } = {}) {
  const store: Record<string, string> = {};
  if (stored) store["hx-consent"] = stored;
  const win: Record<string, unknown> = {};
  const fbqCalls: Call[] = [];
  const doc = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild: () => undefined },
  };
  const ls = { getItem: (k: string) => store[k] ?? null };
  const nav = { globalPrivacyControl: Boolean(opts.gpc) };
  const run = (code: string) =>
    new Function(
      "window",
      "localStorage",
      "navigator",
      "document",
      "location",
      "dataLayer",
      "fbq",
      `with(window){${code}}`,
    )(win, ls, nav, doc, { pathname: "/" }, undefined, undefined);
  // dataLayer y gtag se resuelven contra `window` vía with().
  run(consentHeadScript());
  run(metaPixelHeadLoader());
  const fbq = win.fbq as { queue?: Call[] } | undefined;
  if (fbq?.queue) for (const a of fbq.queue) fbqCalls.push(Array.from(a as ArrayLike<unknown>));
  const dl = ((win.dataLayer as ArrayLike<unknown>[]) ?? []).map((a) => Array.from(a));
  return { win, dl, fbqCalls };
}

const granted = JSON.stringify({ v: 1, choice: "granted", at: "x" });
const denied = JSON.stringify({ v: 1, choice: "denied", at: "x" });

describe("consentimiento", () => {
  it("lee solo elecciones válidas de la versión actual", () => {
    expect(parseStoredConsent(granted)).toBe("granted");
    expect(parseStoredConsent(denied)).toBe("denied");
    expect(parseStoredConsent(JSON.stringify({ v: 0, choice: "granted" }))).toBeNull();
    expect(parseStoredConsent("basura")).toBeNull();
    expect(parseStoredConsent(null)).toBeNull();
  });

  it("no muestra el aviso en paneles internos", () => {
    expect(bannerAllowedOnPath("/")).toBe(true);
    expect(bannerAllowedOnPath("/recursos/x")).toBe(true);
    expect(bannerAllowedOnPath("/superadmin/pagos")).toBe(false);
    expect(bannerAllowedOnPath("/admin")).toBe(false);
  });

  it("mapea a las cuatro señales de Consent Mode v2", () => {
    expect(googleConsentState("granted")).toEqual({
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
    });
    expect(Object.values(googleConsentState(null))).toEqual(Array(4).fill("denied"));
  });

  it("sin elección: Google por defecto denegado y el píxel en espera (revoke) antes de init", () => {
    const { dl, fbqCalls, win } = runHead(null);
    expect(dl[0][0]).toBe("consent");
    expect(dl[0][1]).toBe("default");
    expect(dl[0][2]).toMatchObject({ ad_storage: "denied", ad_user_data: "denied" });
    expect(dl.some((c) => c[1] === "update")).toBe(false);
    expect(fbqCalls[0]).toEqual(["consent", "revoke"]);
    expect(fbqCalls.findIndex((c) => c[0] === "init")).toBeGreaterThan(0);
    // La visita no se registra hasta que la persona acepte (el aviso la cuenta al aceptar).
    expect(fbqCalls.some((c) => c[0] === "track")).toBe(false);
    expect(
      (win.adsbygoogle as { requestNonPersonalizedAds?: number }).requestNonPersonalizedAds,
    ).toBe(1);
  });

  it("con «Aceptar» guardado: actualiza a granted y el píxel no queda revocado", () => {
    const { dl, fbqCalls, win } = runHead(granted);
    expect(dl.find((c) => c[1] === "update")?.[2]).toMatchObject({ ad_personalization: "granted" });
    expect(fbqCalls.some((c) => c[0] === "consent")).toBe(false);
    expect(fbqCalls.some((c) => c[0] === "track" && c[1] === "PageView")).toBe(true);
    expect(
      (win.adsbygoogle as { requestNonPersonalizedAds?: number }).requestNonPersonalizedAds,
    ).toBe(0);
  });

  it("con «Solo necesarias» o Global Privacy Control: no se instala el píxel", () => {
    expect(runHead(denied).win.fbq).toBeUndefined();
    const gpc = runHead(granted, { gpc: true });
    expect(gpc.win.fbq).toBeUndefined();
    expect(gpc.dl.some((c) => c[1] === "update")).toBe(false);
  });
});
