import { useState } from "react";
import { CalendarClock, ChevronRight, FileSignature, PenLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMySmartContracts } from "@/hooks/use-institution-hub";
import { contractStatusLabel, isSignableStatus, signatureCountdown } from "@/lib/contractTemplate";
import { formatShiftRange } from "@/lib/opportunities";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { SmartContractDialog } from "./SmartContractDialog";

const STATUS_STYLE: Record<string, string> = {
  pending_signature: "bg-warn/15 text-warn",
  partially_signed: "bg-warn/15 text-warn",
  active: "bg-ok/15 text-ok",
  completed: "bg-ok/15 text-ok",
  declined: "bg-sos/15 text-sos",
};

/** Contratos inteligentes de la persona (institución o profesional): estado, plazo y acceso a firmar. */
export function ContractsPanel({
  userId,
  title = "Contratos",
}: {
  userId: string;
  title?: string;
}) {
  const contracts = useMySmartContracts(userId);
  const [openId, setOpenId] = useState<string | null>(null);

  if (contracts.isLoading) return <Skeleton className="h-24 w-full" />;
  const rows = contracts.data ?? [];
  if (contracts.error) {
    // Antes de aplicar la migración la función no existe: no se muestra un error al usuario.
    return null;
  }

  return (
    <Card className="space-y-3 p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <FileSignature className="h-4 w-4 shrink-0 text-biosensor" aria-hidden /> {title}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length} en total</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Cuando una postulación sea aceptada se genera el contrato inteligente: turnos, valor y
          condiciones, firmado por ambas partes con identidad validada.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((c) => {
            const needsMe = isSignableStatus(c.status) && !c.i_signed;
            const countdown = isSignableStatus(c.status)
              ? signatureCountdown(c.signature_deadline)
              : null;
            return (
              <li key={c.contract_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-accent/40"
                  onClick={() => setOpenId(c.contract_id)}
                >
                  <span className="block min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{c.offer_title ?? "Contrato de turnos"}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2.5 py-0.5 text-[10px] font-semibold",
                          STATUS_STYLE[c.status] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {contractStatusLabel(c.status)}
                      </span>
                      {needsMe && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warn">
                          <PenLine className="h-3 w-3" aria-hidden /> Te toca firmar
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {c.counterpart_name} · {c.shifts} {c.shifts === 1 ? "turno" : "turnos"} ·{" "}
                      {formatCOP(c.total_amount)}
                      {c.first_shift
                        ? ` · inicia ${formatShiftRange(c.first_shift, c.first_shift).split(" · ")[0]}`
                        : ""}
                    </span>
                    {countdown && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-warn">
                        <CalendarClock className="h-3 w-3" aria-hidden /> {countdown}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {openId && (
        <SmartContractDialog
          contractId={openId}
          userId={userId}
          open
          onOpenChange={(o) => !o && setOpenId(null)}
        />
      )}
    </Card>
  );
}
