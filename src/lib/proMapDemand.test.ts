import { describe, expect, it } from "vitest";
import type { MapDemand, MapInstitution } from "./liveMap";
import { displayCity, idleInstitutions, unplacedDemand } from "./proMapDemand";
import { familyMapStatus } from "./familyMapStatus";

const inst = (over: Partial<MapInstitution> = {}): MapInstitution => ({
  id: "i1",
  name: "Hogar Belén",
  type: null,
  city: "Buesaco",
  lat: 1.39,
  lng: -77.15,
  verified: false,
  status: "idle",
  live: false,
  openOffers: 0,
  ...over,
});
const dem = (over: Partial<MapDemand> = {}): MapDemand => ({
  id: "f1",
  kind: "family",
  name: "María P.",
  city: null,
  lat: null,
  lng: null,
  openOffers: 1,
  openHours: 0,
  topHourly: null,
  urgent: false,
  offerId: "o1",
  trust: {} as MapDemand["trust"],
  distanceBand: null,
  ...over,
});

describe("idleInstitutions — instituciones en el mapa del profesional aunque no tengan turnos", () => {
  it("muestra las que tienen ubicación y no salen ya como solicitud", () => {
    const out = idleInstitutions(
      [inst({ id: "a" }), inst({ id: "b" }), inst({ id: "c", lat: null }), inst({ id: "d", lng: NaN })],
      [dem({ id: "b", kind: "institution" }), dem({ id: "a", kind: "family" })],
    );
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("unplacedDemand — solicitudes sin ubicación no se pierden", () => {
  it("solo las que no tienen punto, urgentes y mejor pagadas primero", () => {
    const out = unplacedDemand([
      dem({ id: "x", lat: 1, lng: 2 }),
      dem({ id: "y", topHourly: 20000 }),
      dem({ id: "z", urgent: true, topHourly: 10000 }),
      dem({ id: "w", topHourly: 30000 }),
    ]);
    expect(out.map((d) => d.id)).toEqual(["z", "w", "y"]);
  });
});

describe("displayCity", () => {
  it("descarta los textos de relleno", () => {
    expect(displayCity("Buesaco")).toBe("Buesaco");
    expect(displayCity("No especificada (a convenir con el candidato)")).toBeNull();
    expect(displayCity(" a convenir ")).toBeNull();
    expect(displayCity("Colombia")).toBeNull();
    expect(displayCity(null)).toBeNull();
  });
});

describe("familyMapStatus — la familia sabe si de verdad la ven", () => {
  const base = { visible: true, openOffers: 1, openHours: 0, hasLocation: true };
  it("visible con solicitud y ubicación", () => {
    expect(familyMapStatus(base)).toMatchObject({ state: "visible", askLocation: false });
    expect(familyMapStatus(base).detail).toMatch(/1 oferta\b/);
  });
  it("con solicitud pero sin ubicación: no dice que la ven y pide la zona", () => {
    const s = familyMapStatus({ ...base, hasLocation: false, openHours: 3 });
    expect(s.state).toBe("no_location");
    expect(s.askLocation).toBe(true);
    expect(s.headline).toMatch(/aún no te ven/);
    expect(s.detail).toMatch(/1 oferta y 3 horas abiertas/);
  });
  it("sin solicitud abierta: espera, y pide la zona solo si falta", () => {
    expect(familyMapStatus({ ...base, openOffers: 0 })).toMatchObject({ state: "waiting", askLocation: false });
    expect(familyMapStatus({ ...base, openOffers: 0, hasLocation: false })).toMatchObject({
      state: "waiting",
      askLocation: true,
    });
  });
  it("oculta: no pide nada", () => {
    expect(familyMapStatus({ ...base, visible: false, hasLocation: false })).toMatchObject({
      state: "hidden",
      askLocation: false,
    });
  });
});
