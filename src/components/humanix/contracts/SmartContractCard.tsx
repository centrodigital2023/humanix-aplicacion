import { useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileSignature, PenLine, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMySmartContracts } from "@/hooks/use-institution-hub";
import { contractStatusLabel, isSignableStatus } from "@/lib/contractTemplate";
import { SmartContractDialog } from "./SmartContractDialog";

const sb = supabase as unknown as SupabaseClient;

/**
 * Contrato inteligente de una reserva (la página del servicio). Si la reserva no nació de una postulación
 * a una institución no hay contrato inteligente y se muestra `fallback`.
 */
export function SmartContractCard({
  bookingId,
  userId,
  fallback = null,
}: {
  bookingId: string;
  userId: string;
  /** Qué mostrar cuando la reserva no tiene contrato inteligente (por ejemplo, reservas de familias). */
  fallback?: ReactNode;
}) {
  const [contractId, setContractId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = useMySmartContracts(userId);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await sb
        .from("smart_contract_shifts")
        .select("contract_id")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (!active) return;
      setContractId((data as { contract_id: string } | null)?.contract_id ?? null);
      setResolved(true);
    })();
    return () => {
      active = false;
    };
  }, [bookingId]);

  if (!resolved) return null;
  if (!contractId) return <>{fallback}</>;
  const row = mine.data?.find((c) => c.contract_id === contractId);
  const needsMe = row ? isSignableStatus(row.status) && !row.i_signed : false;

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-biosensor" aria-hidden />
        <h3 className="text-sm font-semibold">Contrato inteligente</h3>
        {row && (
          <span className="text-xs text-muted-foreground">· {contractStatusLabel(row.status)}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {row?.status === "active" || row?.status === "completed" ? (
          <span className="inline-flex items-center gap-1.5 text-ok">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Firmado por ambas partes con
            identidad validada.
          </span>
        ) : needsMe ? (
          "Revisa los turnos, el valor y las condiciones, y fírmalo con tu código de verificación."
        ) : (
          "Acuerdos, turnos, tiempo, valor y condiciones de esta reserva."
        )}
      </p>
      <Button
        size="sm"
        variant={needsMe ? "hero" : "outline"}
        className="w-full"
        onClick={() => setOpen(true)}
      >
        {needsMe ? (
          <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
        ) : (
          <FileSignature className="mr-1.5 h-4 w-4" aria-hidden />
        )}
        {needsMe ? "Revisar y firmar" : "Ver contrato"}
      </Button>
      {open && (
        <SmartContractDialog contractId={contractId} userId={userId} open onOpenChange={setOpen} />
      )}
    </Card>
  );
}
