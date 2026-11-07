import { describe, expect, it } from "vitest";
import {
  META_PIXEL_IDS,
  metaPixelHeadLoader,
  pageViewAllowedOnPath,
  pixelAllowedOnPath,
  sanitizePixelParams,
} from "@/lib/metaPixel";

describe("metaPixel", () => {
  it("incluye el píxel nuevo de Humanix", () => {
    expect(META_PIXEL_IDS).toContain("1005277195957747");
  });

  it("no carga el píxel en paneles internos", () => {
    for (const p of ["/superadmin", "/superadmin/pagos", "/admin", "/acceso-equipo"]) {
      expect(pixelAllowedOnPath(p)).toBe(false);
      expect(pageViewAllowedOnPath(p)).toBe(false);
    }
  });

  it("cuenta PageView en páginas públicas pero no en rutas con datos del servicio", () => {
    for (const p of ["/", "/planes", "/recursos/cuidar-adulto-mayor", "/auth", "/pago/exito"]) {
      expect(pageViewAllowedOnPath(p)).toBe(true);
    }
    for (const p of ["/dashboard", "/dashboard/familia", "/servicio/abc", "/mensajes"]) {
      expect(pixelAllowedOnPath(p)).toBe(true);
      expect(pageViewAllowedOnPath(p)).toBe(false);
    }
  });

  it("solo deja salir parámetros de la lista blanca y sin datos de contacto", () => {
    const out = sanitizePixelParams({
      value: 45000.4,
      content_name: "Turno de cuidado",
      email: "a@b.co",
      phone: "3001234567",
      notes: "diabetes",
      status: "ana@correo.com",
      content_category: "3001234567",
    });
    expect(out).toEqual({ value: 45000, currency: "COP", content_name: "Turno de cuidado" });
  });

  it("el cargador del head apaga autoConfig y el conteo automático de rutas", () => {
    const js = metaPixelHeadLoader();
    expect(js).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(js).toContain("'autoConfig',false");
    expect(js).toContain("disablePushState=true");
    expect(() => new Function(js)).not.toThrow();
  });
});
