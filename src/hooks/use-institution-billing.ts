import { useState, useMemo } from "react";
import {
  calculateInstitutionBilling,
  INSTITUTION_BILLING,
  COP,
  type BillingCycle,
  type InstitutionBillingBreakdown,
} from "@/lib/plans";

export type { BillingCycle, InstitutionBillingBreakdown };

export function useInstitutionBilling(
  initialBranches = 1,
  initialProfessionals = 10,
  initialCycle: BillingCycle = "monthly",
) {
  const [branches, setBranches] = useState(initialBranches);
  const [professionals, setProfessionals] = useState(initialProfessionals);
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  const breakdown = useMemo(
    () => calculateInstitutionBilling({ branches, professionals, cycle }),
    [branches, professionals, cycle],
  );

  const trialDays = INSTITUTION_BILLING.trialDays;
  const graceDays = INSTITUTION_BILLING.graceDays;

  return {
    branches,
    setBranches,
    professionals,
    setProfessionals,
    cycle,
    setCycle,
    breakdown,
    totalFormatted: COP(breakdown.totalCOP),
    monthlyEquivalentFormatted: COP(
      cycle === "annual"
        ? Math.round(breakdown.totalCOP / 12)
        : breakdown.totalCOP,
    ),
    trialDays,
    graceDays,
    isSaving: cycle === "annual",
    savingPercent: INSTITUTION_BILLING.annualDiscount * 100,
  };
}
