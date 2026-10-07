import { describe, it, expect } from "vitest";
import { calculateOpenRate, formatRate } from "./campaignMetrics";

describe("calculateOpenRate", () => {
  it("computes opened/delivered", () => {
    expect(calculateOpenRate(200, 50)).toBe(25);
    expect(calculateOpenRate(3, 1)).toBe(33.3);
  });
  it("returns null without reliable data", () => {
    expect(calculateOpenRate(0, 0)).toBeNull();
    expect(calculateOpenRate(10, 11)).toBeNull();
    expect(calculateOpenRate(10, -1)).toBeNull();
    expect(calculateOpenRate(NaN, 1)).toBeNull();
  });
  it("formats missing data explicitly", () => {
    expect(formatRate(null)).toBe("Datos insuficientes");
    expect(formatRate(12.34)).toBe("12.3%");
  });
});
