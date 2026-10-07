import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContractSignature } from "@/components/humanix/ContractSignature";
import { toast } from "sonner";

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

export function ServiceContractCard({ bookingId, party }: Props) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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

  const generate = async () => {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke("generate-contract", {
        body: { booking_id: bookingId },
      });
      if (error) throw error;
      toast.success("Contrato generado. Revisa tu WhatsApp para firmar.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar el contrato");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return null;

  if (!contract) {
    return (
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-copper" />
          <h3 className="font-semibold text-sm">Contrato de servicio</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Genera el contrato de prestación de servicios. Cada parte lo firma con un código OTP.
        </p>
        <Button size="sm" onClick={generate} disabled={generating} className="w-full">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generar contrato"}
        </Button>
      </Card>
    );
  }

  const mySignedAt = party === "family" ? contract.family_signed_at : contract.professional_signed_at;
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
            <a href={contract.pdf_url} target="_blank" rel="noopener noreferrer" className="text-biosensor hover:underline">
              Ver contrato
            </a>
          )}
        </div>
      </Card>
    );
  }

  return (
    <ContractSignature
      contractId={contract.id}
      party={party}
      pdfUrl={contract.pdf_url}
      onFullySigned={() => void load()}
    />
  );
}
