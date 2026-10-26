import { describe, expect, it } from "vitest";
import { isTrackedStatus, shouldSendPing, trackingWaitText } from "./serviceTracking";

describe("isTrackedStatus", () => {
  it("solo En camino y Cuidando comparten ubicación", () => {
    expect(isTrackedStatus("in_route")).toBe(true);
    expect(isTrackedStatus("in_progress")).toBe(true);
    for (const s of ["pending", "confirmed", "completed", "cancelled", null]) {
      expect(isTrackedStatus(s)).toBe(false);
    }
  });
});

describe("shouldSendPing", () => {
  const at = 1_000_000;
  const prev = { lat: 1.38, lng: -77.15, at };
  it("la primera lectura siempre se envía", () => {
    expect(shouldSendPing(null, prev, at)).toBe(true);
  });
  it("no envía antes de 15 s", () => {
    expect(shouldSendPing(prev, { lat: 1.39, lng: -77.15 }, at + 5_000)).toBe(false);
  });
  it("entre 15 s y 1 min solo si se movió 25 m o más", () => {
    expect(shouldSendPing(prev, { lat: 1.38001, lng: -77.15 }, at + 20_000)).toBe(false);
    expect(shouldSendPing(prev, { lat: 1.3805, lng: -77.15 }, at + 20_000)).toBe(true);
  });
  it("después de 1 min envía aunque no se haya movido", () => {
    expect(shouldSendPing(prev, prev, at + 61_000)).toBe(true);
  });
});

describe("trackingWaitText", () => {
  it("le explica a la familia cuándo verá al profesional", () => {
    expect(trackingWaitText("confirmed", false)).toMatch(/cuando salga/);
    expect(trackingWaitText("in_route", false)).toMatch(/Esperando/);
  });
  it("al profesional le dice que solo se comparte en camino", () => {
    expect(trackingWaitText("confirmed", true)).toMatch(/En camino/);
  });
});
