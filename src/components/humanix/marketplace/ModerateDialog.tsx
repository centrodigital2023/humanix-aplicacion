import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OfferRow } from "@/lib/marketplaceInsights";

const sb = supabase as unknown as SupabaseClient;

const PRESETS = [
  "Contiene datos de contacto directo en el texto",
  "Solicita dinero por adelantado",
  "Valor engañoso frente al mercado",
  "Información incompleta o confusa",
  "Publicación duplicada",
];

interface Props {
  offer: OfferRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function ModerateDialog({ offer, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (open: boolean) => {
    if (!open) setReason("");
    onOpenChange(open);
  };

  const submit = async () => {
    if (!offer) return;
    setBusy(true);
    const { error } = await sb.rpc("moderate_offer", {
      p_offer_id: offer.id,
      p_action: "block",
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Oferta bloqueada. Se avisó al autor y quedó registrada en auditoría.");
    setReason("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={!!offer} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear oferta</DialogTitle>
          <DialogDescription>
            «{offer?.title}» dejará de mostrarse en el marketplace. El autor recibirá el motivo y la
            acción queda en la auditoría.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReason(p)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-muted"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="moderate-reason">Motivo (visible para el autor)</Label>
            <Textarea
              id="moderate-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || reason.trim().length < 5} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Bloquear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
