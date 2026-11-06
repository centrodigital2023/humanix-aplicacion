import { describe, expect, it } from "vitest";
import { adsAllowedOnPath, adsenseHeadLoader } from "@/lib/adsense";

describe("adsense", () => {
  it("permite anuncios en páginas públicas", () => {
    for (const p of ["/", "/recursos", "/recursos/cuidar-adulto-mayor", "/enfermeria-bogota"]) {
      expect(adsAllowedOnPath(p)).toBe(true);
    }
  });

  it("bloquea paneles, pagos, servicios y datos de pacientes", () => {
    for (const p of [
      "/dashboard",
      "/dashboard/familia",
      "/dashboard.familia",
      "/superadmin/pagos",
      "/pago/exito",
      "/servicio/abc",
      "/mensajes",
      "/auth",
      "/oferta/1",
    ]) {
      expect(adsAllowedOnPath(p)).toBe(false);
    }
  });

  it("el cargador del head usa la URL oficial de AdSense", () => {
    const js = adsenseHeadLoader();
    if (js) expect(js).toContain("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js");
  });
});
