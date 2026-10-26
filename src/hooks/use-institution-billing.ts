import { useState, useMemo } from "react";
import {
  calculateInstitutionBilling,
  INSTITUTION_BILLING,
  COP,
  type BillingCycle,
  type InstitutionBillingBreakdown,
} from "@/lib/plans";

export type { BillingCycle, InstitutionBillingBreakdown };

export function useInstitutionBilling(initialBranches = 1, initialCycle: BillingCycle = "monthly") {
  const [branches, setBranches] = useState(initialBranches);
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  const breakdown = useMemo(
    () => calculateInstitutionBilling({ branches, cycle }),
    [branches, cycle],
  );

  const trialDays = INSTITUTION_BILLING.trialDays;
  const graceDays = INSTITUTION_BILLING.graceDays;

  return {
    branches,
    setBranches,
    cycle,
    setCycle,
    breakdown,
    totalFormatted: COP(breakdown.totalCOP),
    monthlyEquivalentFormatted: COP(Math.round(breakdown.totalCOP / breakdown.months)),
    trialDays,
    graceDays,
    isSaving: cycle === "annual",
    savingPercent: Math.round(INSTITUTION_BILLING.annualDiscount * 100),
  };
}
