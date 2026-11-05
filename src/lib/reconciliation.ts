// Conciliación de pagos (pura, probada en `reconciliation.test.ts`). Los números salen de `hx_reconciliation`
// (migración 20261105100000): libro de partida doble `ledger_entries`, reparto por turno `payment_splits` y la cola
// `payouts`.

export type LedgerAccount =
  "external" | "escrow" | "professional" | "in_transit" | "platform" | "wallet";

export interface ProfessionalBalance {
  professional_id: string;
  name: string | null;
  /** Pagado por la familia, aún retenido (turno sin terminar o sin confirmar). */
  held: number;
  /** Liberado, por dispersar. */
  available: number;
  /** Enviado a Wompi, esperando confirmación. */
  in_transit: number;
  /** Ya llegó a su llave Bre-B (total). */
  paid: number;
  /** Billetera para turnos en efectivo. */
  wallet: number;
}

export type IssueCode =
  | "charge_not_in_ledger"
  | "amount_mismatch"
  | "escrow_leftover"
  | "payout_queue_mismatch"
  | "in_transit_mismatch"
  | "wallet_mismatch"
  | "payout_stuck";

export interface ReconciliationIssue {
  code: IssueCode;
  ref: string;
  amount_cop: number;
  professional_id: string | null;
}

export interface Reconciliation {
  generated_at: string;
  accounts: Record<LedgerAccount, number>;
  collected_30d: number;
  platform_fees_30d: number;
  professionals: ProfessionalBalance[];
  issues: ReconciliationIssue[];
}

export const ISSUE_LABEL: Record<IssueCode, string> = {
  charge_not_in_ledger: "Cobro pagado que no está en el libro",
  amount_mismatch: "Wompi cobró un monto distinto al pedido",
  escrow_leftover: "Turno cerrado con dinero aún retenido",
  payout_queue_mismatch: "Saldo por dispersar distinto a la cola de pagos",
  in_transit_mismatch: "Dinero en camino distinto a los pagos enviados",
  wallet_mismatch: "Billetera del libro distinta a la billetera guardada",
  payout_stuck: "Dispersión sin confirmar de Wompi hace más de 1 hora",
};

export const ACCOUNT_LABEL: Record<LedgerAccount, string> = {
  external: "Entró menos salió (bancos)",
  escrow: "Retenido de familias",
  professional: "Por dispersar a profesionales",
  in_transit: "En camino por Bre-B",
  platform: "Comisión Humanix",
  wallet: "Billeteras de profesionales",
};

/** Lo que Humanix debería tener hoy en su cuenta Wompi según el libro: lo retenido + lo que debe a profesionales
 * (por dispersar y en camino) + su comisión + las billeteras. Es el número que se compara con el saldo de Wompi. */
export function expectedWompiBalance(a: Partial<Record<LedgerAccount, number>>): number {
  return (
    (a.escrow ?? 0) +
    (a.professional ?? 0) +
    (a.in_transit ?? 0) +
    (a.platform ?? 0) +
    (a.wallet ?? 0)
  );
}

/** Un libro de partida doble siempre suma cero: si no, algo se anotó mal. */
export function ledgerBalanced(a: Partial<Record<LedgerAccount, number>>): boolean {
  return expectedWompiBalance(a) + (a.external ?? 0) === 0;
}

/** Normaliza lo que devuelve la base (números que llegan como texto, listas vacías). */
export function normalizeReconciliation(raw: unknown): Reconciliation {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const acc = (o.accounts ?? {}) as Record<string, unknown>;
  const accounts = Object.fromEntries(
    (["external", "escrow", "professional", "in_transit", "platform", "wallet"] as const).map(
      (k) => [k, n(acc[k])],
    ),
  ) as Record<LedgerAccount, number>;
  const pros = Array.isArray(o.professionals) ? (o.professionals as Record<string, unknown>[]) : [];
  const issues = Array.isArray(o.issues) ? (o.issues as Record<string, unknown>[]) : [];
  return {
    generated_at: String(o.generated_at ?? ""),
    accounts,
    collected_30d: n(o.collected_30d),
    platform_fees_30d: n(o.platform_fees_30d),
    professionals: pros.map((p) => ({
      professional_id: String(p.professional_id ?? ""),
      name: typeof p.name === "string" ? p.name : null,
      held: n(p.held),
      available: n(p.available),
      in_transit: n(p.in_transit),
      paid: n(p.paid),
      wallet: n(p.wallet),
    })),
    issues: issues.map((i) => ({
      code: String(i.code) as IssueCode,
      ref: String(i.ref ?? ""),
      amount_cop: n(i.amount_cop),
      professional_id: typeof i.professional_id === "string" ? i.professional_id : null,
    })),
  };
}

export interface LedgerRow {
  created_at: string;
  ref: string;
  from_account: string;
  from_pro: string | null;
  to_account: string;
  to_pro: string | null;
  amount_cop: number;
  booking_id: string | null;
  memo: string | null;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Evita que Excel ejecute fórmulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Libro en CSV para cruzar con el extracto de Wompi. */
export function ledgerToCsv(rows: LedgerRow[]): string {
  const head = [
    "fecha",
    "ref",
    "desde",
    "profesional_desde",
    "hacia",
    "profesional_hacia",
    "monto_cop",
    "turno",
    "detalle",
  ];
  const lines = rows.map((r) =>
    [
      r.created_at,
      r.ref,
      r.from_account,
      r.from_pro,
      r.to_account,
      r.to_pro,
      r.amount_cop,
      r.booking_id,
      r.memo,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
