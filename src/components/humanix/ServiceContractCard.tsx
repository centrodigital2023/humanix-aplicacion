import { useCallback, useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

const sb = supabase as unknown as SupabaseClient;

type Contract = {
  id: string;
  pdf_url: string | null;
  family_signed_at: string | null;
  professional_signed_at: string | null;
  status: string;
};

interface Props {
  bookingId: string;
  party: "family" | "professional";
}

/**
 * Contratos del flujo anterior (solo consulta). Los servicios con instituciones se formalizan con el
 * contrato inteligente (`SmartContractCard`): identidad validada, código de un solo uso y evidencia verificable.
 * Este flujo ya no genera ni recibe firmas; se conservan los contratos que ya existían.
 */
export function ServiceContractCard({ bookingId, party }: Props) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("service_contracts")
      .select("id, pdf_url, family_signed_at, professional_signed_at, status")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setContract((data as Contract | null) ?? null);
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !contract) return null;

  const mySignedAt =
    party === "family" ? contract.family_signed_at : contract.professional_signed_at;
  const bothSigned = Boolean(contract.family_signed_at && contract.professional_signed_at);

  if (mySignedAt) {
    return (
      <Card className="p-5 flex items-center gap-3 border-biosensor/30 bg-biosensor/5">
        <ShieldCheck className="h-6 w-6 text-biosensor shrink-0" />
        <div className="text-xs">
          <p className="font-semibold text-sm text-biosensor">
            {bothSigned ? "Contrato firmado por ambas partes" : "Tu firma está registrada"}
          </p>
          {!bothSigned && (
            <p className="text-muted-foreground mt-0.5">Falta la firma de la otra parte.</p>
          )}
          {contract.pdf_url && (
            <a
              href={contract.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-biosensor hover:underline"
            >
              Ver contrato
            </a>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-copper" />
        <h3 className="font-semibold text-sm">Contrato de servicio</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Este contrato se creó con el sistema anterior y ya no admite firmas. Los servicios con
        instituciones se formalizan con el contrato inteligente.
      </p>
      {contract.pdf_url && (
        <a
          href={contract.pdf_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-biosensor hover:underline"
        >
          Ver contrato
        </a>
      )}
    </Card>
  );
}
