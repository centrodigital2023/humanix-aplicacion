// Conciliación y dispersión (solo staff, en /superadmin/pagos). Muestra el libro de partida doble por cuenta, el saldo
// de cada profesional (retenido, por dispersar, en camino, recibido), las diferencias encontradas y el botón
// «Dispersar ahora». Todo pasa por el servidor (`reconciliation.functions.ts`), que verifica que quien mira sea staff.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, Scale, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { COP } from "@/lib/commissionMatrix";
import {
  ACCOUNT_LABEL,
  expectedWompiBalance,
  ISSUE_LABEL,
  ledgerBalanced,
  type LedgerAccount,
} from "@/lib/reconciliation";
import {
  dispatchPayoutsNow,
  exportPaymentsLedger,
  getPaymentsReconciliation,
} from "@/lib/reconciliation.functions";

const QUERY_KEY = ["superadmin", "reconciliation"] as const;
const SHOWN: LedgerAccount[] = ["escrow", "professional", "in_transit", "platform", "wallet"];

export function ReconciliationPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => getPaymentsReconciliation() });
  const [busy, setBusy] = useState<"dispatch" | "csv" | null>(null);

  const dispatch = async () => {
    setBusy("dispatch");
    const r = await dispatchPayoutsNow().catch(() => null);
    setBusy(null);
    if (!r?.ok) return toast.error(r?.message ?? "No pudimos dispersar.");
    const s = r.summary;
    if (s.claimed === 0) toast.info("No hay pagos listos para dispersar.");
    else
      toast.success(
        `Enviamos ${s.sent + s.paid} de ${s.claimed} pagos (${COP(s.totalCop)}).` +
          (s.retry ? ` ${s.retry} se reintentan solos.` : "") +
          (s.failed ? ` ${s.failed} fallaron.` : ""),
      );
    void qc.invalidateQueries({ queryKey: QUERY_KEY });
    void qc.invalidateQueries({ queryKey: ["superadmin", "payouts"] });
  };

  const downloadCsv = async () => {
    setBusy("csv");
    const r = await exportPaymentsLedger({ data: { days: 31 } }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return toast.error(r?.message ?? "No pudimos descargar el libro.");
    const blob = new Blob([`\uFEFF${r.csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `humanix-libro-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const res = q.data;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <h2 className="font-display text-lg font-bold">Conciliación</h2>
        {res?.ok && (
          <Badge variant={res.dispersionEnabled ? "default" : "outline"}>
            Dispersión automática {res.dispersionEnabled ? "encendida" : "apagada"}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={busy !== null}>
            {busy === "csv" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Libro CSV (31 días)
          </Button>
          <Button
            size="sm"
            onClick={dispatch}
            disabled={busy !== null || !res?.ok || !res.dispersionEnabled}
          >
            {busy === "dispatch" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            Dispersar ahora
          </Button>
        </div>
      </div>

      {q.isLoading && (
        <div className="flex items-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}
      {res && !res.ok && <Card className="p-4 text-sm">{res.message}</Card>}

      {res?.ok && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Recaudado de familias (30 días)</p>
              <p className="font-display text-xl font-bold">{COP(res.data.collected_30d)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Comisión Humanix (30 días)</p>
              <p className="font-display text-xl font-bold">{COP(res.data.platform_fees_30d)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Debe haber en la cuenta Wompi</p>
              <p className="font-display text-xl font-bold">
                {COP(expectedWompiBalance(res.data.accounts))}
              </p>
              <p className="text-xs text-muted-foreground">Compáralo con el saldo en Wompi</p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Scale className="h-4 w-4" /> Libro por cuenta
              <Badge variant={ledgerBalanced(res.data.accounts) ? "secondary" : "destructive"}>
                {ledgerBalanced(res.data.accounts) ? "Cuadra" : "No cuadra"}
              </Badge>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-5">
              {SHOWN.map((a) => (
                <div key={a}>
                  <dt className="text-xs text-muted-foreground">{ACCOUNT_LABEL[a]}</dt>
                  <dd className="font-semibold">{COP(res.data.accounts[a])}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {res.data.issues.length > 0 && (
            <Card className="space-y-2 border-destructive/40 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" /> {res.data.issues.length} diferencias por
                revisar
              </p>
              <ul className="space-y-1 text-sm">
                {res.data.issues.slice(0, 50).map((i) => (
                  <li key={`${i.code}:${i.ref}`} className="flex flex-wrap gap-2">
                    <span>{ISSUE_LABEL[i.code] ?? i.code}</span>
                    <code className="rounded bg-muted px-1 text-xs">{i.ref.slice(0, 8)}</code>
                    <span className="ml-auto font-semibold">{COP(i.amount_cop)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Profesional</th>
                  <th className="px-3 py-2 text-right">Retenido</th>
                  <th className="px-3 py-2 text-right">Por dispersar</th>
                  <th className="px-3 py-2 text-right">En camino</th>
                  <th className="px-3 py-2 text-right">Recibido</th>
                  <th className="px-3 py-2 text-right">Billetera</th>
                </tr>
              </thead>
              <tbody>
                {res.data.professionals.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      Aún no hay movimientos.
                    </td>
                  </tr>
                )}
                {res.data.professionals.map((p) => (
                  <tr key={p.professional_id} className="border-t">
                    <td className="px-3 py-2">{p.name ?? "Profesional"}</td>
                    <td className="px-3 py-2 text-right">{COP(p.held)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{COP(p.available)}</td>
                    <td className="px-3 py-2 text-right">{COP(p.in_transit)}</td>
                    <td className="px-3 py-2 text-right">{COP(p.paid)}</td>
                    <td className="px-3 py-2 text-right">{COP(p.wallet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
}
