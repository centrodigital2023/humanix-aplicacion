import { useState } from "react";
import { FileText, ShieldCheck, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type Props = {
  contractId: string;
  party: "family" | "professional";
  pdfUrl?: string | null;
  /** Callback when both parties have signed */
  onFullySigned?: () => void;
};

export function ContractSignature({ contractId, party, pdfUrl, onFullySigned }: Props) {
  const [otp, setOtp] = useState("");
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);

  const partyLabel = party === "family" ? "contratante" : "contratista";

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      toast.error("El código debe ser de 6 dígitos numéricos");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("sign_contract", {
        p_contract_id: contractId,
        p_otp: otp,
        p_party: party,
      });
      if (error) throw error;
      if (!data) {
        toast.error("Código incorrecto o contrato ya firmado. Revisa tu WhatsApp.");
        return;
      }
      setSigned(true);
      toast.success(`¡Contrato firmado como ${partyLabel}! El servicio puede comenzar.`);
      onFullySigned?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al firmar";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (signed) {
    return (
      <Card className="p-5 flex items-center gap-3 border-biosensor/30 bg-biosensor/5">
        <ShieldCheck className="h-6 w-6 text-biosensor shrink-0" />
        <div>
          <p className="font-semibold text-sm text-biosensor">Contrato firmado digitalmente</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tu firma queda registrada con fecha, hora e IP. Valor legal en Colombia (Ley 527/1999).
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6 border-border">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-copper/10">
          <FileText className="h-5 w-5 text-copper" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Firma tu contrato</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ingresa el código de 6 dígitos que recibiste por WhatsApp para firmar como{" "}
            <strong>{partyLabel}</strong>.
          </p>
        </div>
      </div>

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-biosensor hover:underline mb-4"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ver contrato completo (PDF)
        </a>
      )}

      <form onSubmit={handleSign} className="space-y-3">
        <div>
          <Input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="text-center text-2xl tracking-[0.5em] font-mono"
            autoComplete="one-time-code"
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy || otp.length < 6}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          Firmar contrato
        </Button>
      </form>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Código válido por 10 minutos. La firma digital tiene validez legal en Colombia
          (Ley 527/1999 — Comercio Electrónico).
        </p>
      </div>
    </Card>
  );
}
