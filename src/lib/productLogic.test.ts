import { describe, it, expect } from "vitest";
import { buildPriceBreakdown } from "./pricing";
import { coverageLevel } from "./coverage";
import { isCompleteScores } from "./ratingDimensions";

describe("buildPriceBreakdown", () => {
  it("splits total between professional and Humanix", () => {
    const b = buildPriceBreakdown(15000, 8, 12);
    expect(b.total).toBe(120000);
    expect(b.commission).toBe(14400);
    expect(b.professionalNet).toBe(105600);
  });
  it("has no commission on paid plans", () => {
    const b = buildPriceBreakdown(20000, 4, 0);
    expect(b.commission).toBe(0);
    expect(b.professionalNet).toBe(80000);
  });
  it("clamps invalid input", () => {
    const b = buildPriceBreakdown(-5, -1, 500);
    expect(b.total).toBe(0);
    expect(b.commissionPct).toBe(100);
  });
});

describe("coverageLevel", () => {
  const now = new Date("2026-01-10T12:00:00Z").getTime();
  const base = { status: "open" as const, shiftsCount: 1, startDate: "2026-01-20T08:00:00Z", acceptedCount: 0, pendingCount: 0 };
  it("is covered when accepted >= shifts or filled", () => {
    expect(coverageLevel({ ...base, acceptedCount: 1 }, now)).toBe("covered");
    expect(coverageLevel({ ...base, status: "filled" }, now)).toBe("covered");
    expect(coverageLevel({ ...base, shiftsCount: 3, acceptedCount: 2 }, now)).toBe("uncovered");
  });
  it("is yellow with pending applicants", () => {
    expect(coverageLevel({ ...base, pendingCount: 2 }, now)).toBe("pending_approval");
  });
  it("is urgent when no candidates and it starts within 48h", () => {
    expect(coverageLevel({ ...base, startDate: "2026-01-11T08:00:00Z" }, now)).toBe("urgent");
    expect(coverageLevel(base, now)).toBe("uncovered");
  });
  it("respects closed offers", () => {
    expect(coverageLevel({ ...base, status: "closed" }, now)).toBe("closed");
  });
});

describe("isCompleteScores", () => {
  it("requires every dimension as integer 1-5", () => {
    expect(isCompleteScores("family", { punctuality: 5, treatment: 4, compliance: 5, communication: 3 })).toBe(true);
    expect(isCompleteScores("family", { punctuality: 5, treatment: 4, compliance: 5 })).toBe(false);
    expect(isCompleteScores("family", { punctuality: 6, treatment: 4, compliance: 5, communication: 3 })).toBe(false);
  });
});
