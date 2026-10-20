import { describe, it, expect } from "vitest";
import { computeRisk, levelForScore, toVitalReadings, trendForScores } from "./patientRisk";

const at = (type: string, value: number, recorded_at = "2026-01-01T10:00:00Z") => ({
  type,
  value,
  recorded_at,
});

describe("computeRisk", () => {
  it("returns null without readings", () => {
    expect(computeRisk([])).toBeNull();
  });

  it("scores normal vitals as low risk", () => {
    const r = computeRisk([at("heart_rate", 72), at("spo2", 98), at("temperature", 36.6)]);
    expect(r?.score).toBe(0);
    expect(r?.level).toBe("low");
    expect(r?.recommendations).toHaveLength(0);
  });

  it("uses the latest reading per type", () => {
    const r = computeRisk([
      at("spo2", 85, "2026-01-01T08:00:00Z"),
      at("spo2", 98, "2026-01-01T12:00:00Z"),
    ]);
    expect(r?.score).toBe(0);
  });

  it("raises risk for abnormal vitals and fall events", () => {
    const r = computeRisk([at("heart_rate", 140), at("spo2", 88), at("fall_detected", 1)]);
    expect(r?.score).toBe(80);
    expect(r?.level).toBe("critical");
    expect(r?.recommendations[0].priority).toBe("high");
  });
});

describe("levels and trend", () => {
  it("maps score to level", () => {
    expect(levelForScore(10)).toBe("low");
    expect(levelForScore(30)).toBe("medium");
    expect(levelForScore(55)).toBe("high");
    expect(levelForScore(90)).toBe("critical");
  });

  it("derives trend from previous score", () => {
    expect(trendForScores(50, null)).toBe("stable");
    expect(trendForScores(50, 40)).toBe("worsening");
    expect(trendForScores(30, 40)).toBe("improving");
    expect(trendForScores(42, 40)).toBe("stable");
  });
});

describe("toVitalReadings", () => {
  const t = "2026-01-01T10:00:00Z";

  it("splits blood pressure into systolic and diastolic", () => {
    expect(
      toVitalReadings([
        { reading_type: "blood_pressure_sys", value: 150, value_secondary: 95, recorded_at: t },
      ]),
    ).toEqual([
      { type: "blood_pressure_sys", value: 150, recorded_at: t },
      { type: "blood_pressure_dia", value: 95, recorded_at: t },
    ]);
  });

  it("renames respiratory_rate and skips invalid values", () => {
    expect(
      toVitalReadings([
        { reading_type: "respiratory_rate", value: 28, recorded_at: t },
        { reading_type: "spo2", value: Number.NaN, recorded_at: t },
      ]),
    ).toEqual([{ type: "respiration_rate", value: 28, recorded_at: t }]);
  });

  it("feeds computeRisk so stored high blood pressure counts", () => {
    const r = computeRisk(
      toVitalReadings([
        { reading_type: "blood_pressure_sys", value: 185, value_secondary: 125, recorded_at: t },
      ]),
    );
    expect(r?.score).toBeGreaterThan(0);
  });
});
