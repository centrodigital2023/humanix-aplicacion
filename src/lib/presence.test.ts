import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CELL_DEGREES,
  COLOMBIA_BOUNDS,
  HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  cellOf,
  isLive,
  nextLiveExpiry,
  shouldSendPosition,
  toCell,
  validPosition,
} from "./presence";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20261012210000_live_map.sql", import.meta.url),
  "utf8",
);

describe("paridad con la migración", () => {
  it("la cuadrícula por defecto es la misma (0,01°)", () => {
    expect(MIGRATION).toMatch(/hx_cell\(p double precision, p_size numeric DEFAULT 0\.01\)/);
    expect(CELL_DEGREES).toBe(0.01);
  });
  it("un latido vale 3 minutos", () => {
    expect(MIGRATION).toMatch(/SELECT interval '3 minutes'/);
    expect(PRESENCE_TTL_MS).toBe(3 * 60_000);
  });
  it("los límites de Colombia son los de touch_presence", () => {
    expect(MIGRATION).toContain("p_lat BETWEEN -5 AND 14 AND p_lng BETWEEN -82 AND -66");
    expect(COLOMBIA_BOUNDS).toEqual({ latMin: -5, latMax: 14, lngMin: -82, lngMax: -66 });
  });
  it("el servidor frena los latidos repetidos antes de que pase un latido del cliente", () => {
    expect(MIGRATION).toContain("interval '20 seconds'");
    expect(HEARTBEAT_MS).toBeGreaterThan(20_000);
    expect(HEARTBEAT_MS).toBeLessThan(PRESENCE_TTL_MS);
  });
});

describe("toCell / cellOf (espejo de hx_cell)", () => {
  // Los mismos valores que comprueba el escenario SQL de la réplica.
  it.each([
    [4.60971, 4.61],
    [-74.08175, -74.08],
    [4.5, 4.5],
    [-74.2, -74.2],
    [6.2442, 6.24],
    [-75.5812, -75.58],
    [4.7001, 4.7],
    [-74.0301, -74.03],
  ])("%s → %s", (input, want) => {
    expect(toCell(input)).toBe(want);
  });
  it("con 0,005 (instituciones) usa tres decimales", () => {
    expect(toCell(4.6486, 0.005)).toBe(4.65);
    expect(toCell(-74.0628, 0.005)).toBe(-74.065);
  });
  it("nunca devuelve un punto más fino que la cuadrícula", () => {
    for (const v of [4.123456, -74.987654, 10.000001, 0.004999, -0.005001]) {
      const c = toCell(v);
      expect(Math.abs(c * 100 - Math.round(c * 100))).toBeLessThan(1e-9);
    }
  });
  it("es idempotente", () => {
    expect(toCell(toCell(4.60971))).toBe(4.61);
  });
  it("cellOf aproxima las dos coordenadas", () => {
    expect(cellOf({ lat: 4.60971, lng: -74.08175 })).toEqual({ lat: 4.61, lng: -74.08 });
  });
});

describe("validPosition", () => {
  it("acepta Colombia y alrededores", () => {
    expect(validPosition(4.61, -74.08)).toBe(true);
    expect(validPosition(-4.99, -81.9)).toBe(true);
    expect(validPosition(13.9, -66.1)).toBe(true);
  });
  it("rechaza lo de fuera y lo que no es número", () => {
    expect(validPosition(40.7, -74.0)).toBe(false);
    expect(validPosition(4.6, -90)).toBe(false);
    expect(validPosition(null, -74)).toBe(false);
    expect(validPosition(4.6, undefined)).toBe(false);
    expect(validPosition(Number.NaN, -74)).toBe(false);
    expect(validPosition(Infinity, -74)).toBe(false);
  });
  it("los límites están incluidos", () => {
    expect(validPosition(-5, -82)).toBe(true);
    expect(validPosition(14, -66)).toBe(true);
    expect(validPosition(14.0001, -66)).toBe(false);
  });
});

describe("shouldSendPosition", () => {
  const sent = { lat: 4.61, lng: -74.08, at: 1_000_000 };
  it("la primera posición siempre se envía", () => {
    expect(shouldSendPosition(null, { lat: 4.6, lng: -74 }, 0)).toBe(true);
  });
  it("moverse dentro de la misma cuadrícula no cambia nada", () => {
    expect(shouldSendPosition(sent, { lat: 4.6149, lng: -74.0751 }, sent.at + 5_000)).toBe(false);
  });
  it("cambiar de cuadrícula sí se envía, aunque acabe de enviarse", () => {
    expect(shouldSendPosition(sent, { lat: 4.63, lng: -74.08 }, sent.at + 1_000)).toBe(true);
    expect(shouldSendPosition(sent, { lat: 4.61, lng: -74.1 }, sent.at + 1_000)).toBe(true);
  });
  it("pasado el intervalo de latido se renueva aunque no se haya movido", () => {
    expect(shouldSendPosition(sent, { lat: 4.61, lng: -74.08 }, sent.at + HEARTBEAT_MS - 1)).toBe(
      false,
    );
    expect(shouldSendPosition(sent, { lat: 4.61, lng: -74.08 }, sent.at + HEARTBEAT_MS)).toBe(true);
  });
});

describe("isLive", () => {
  const now = Date.parse("2026-10-14T15:00:00Z");
  it("vigente dentro de los 3 minutos", () => {
    expect(isLive("2026-10-14T14:58:00Z", now)).toBe(true);
    expect(isLive(new Date(now - 179_000), now)).toBe(true);
    expect(isLive(now - 1_000, now)).toBe(true);
  });
  it("vencida a los 3 minutos", () => {
    expect(isLive("2026-10-14T14:57:00Z", now)).toBe(false);
    expect(isLive(now - PRESENCE_TTL_MS, now)).toBe(false);
  });
  it("sin dato o con dato roto no está en vivo", () => {
    expect(isLive(null, now)).toBe(false);
    expect(isLive(undefined, now)).toBe(false);
    expect(isLive("no es fecha", now)).toBe(false);
  });
});

describe("nextLiveExpiry", () => {
  const now = Date.parse("2026-10-14T15:00:00Z");
  it("nadie en vivo: no hay nada que esperar", () => {
    expect(nextLiveExpiry([], now)).toBeNull();
    expect(nextLiveExpiry([{ live: false, lastSeen: "2026-10-14T14:59:00Z" }], now)).toBeNull();
    expect(nextLiveExpiry([{ live: false, lastSeen: null }], now)).toBeNull();
  });
  it("es lo que falta para que venza el latido más viejo que sigue vigente", () => {
    const rows = [
      { live: true, lastSeen: "2026-10-14T14:59:30Z" },
      { live: true, lastSeen: "2026-10-14T14:58:00Z" },
      { live: false, lastSeen: "2026-10-14T14:57:00Z" },
    ];
    expect(nextLiveExpiry(rows, now)).toBe(60_000);
  });
  it("en vivo sin hora de latido (instituciones): se vuelve a mirar dentro de un plazo completo", () => {
    expect(nextLiveExpiry([{ live: true, lastSeen: null }], now)).toBe(PRESENCE_TTL_MS);
    expect(nextLiveExpiry([{ live: true }], now)).toBe(PRESENCE_TTL_MS);
  });
  it("nunca menos de un segundo (evita ciclos de recarga)", () => {
    expect(nextLiveExpiry([{ live: true, lastSeen: "2026-10-14T14:57:00Z" }], now)).toBe(1_000);
  });
});
