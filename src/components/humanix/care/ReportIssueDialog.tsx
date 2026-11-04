// «Reportar un problema» durante el turno (o hasta 72 h después): abre un radicado PQRS ligado al turno y avisa al
// equipo (hx_report_service_issue). El pago retenido no se toca aquí: sigue retenido hasta que termine el turno y, si
// hace falta, el equipo decide liberarlo o devolverlo. Para una emergencia de salud está el botón de emergencia.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import {
  ISSUE_KINDS,
  ISSUE_RESULT_MESSAGE,
  validateIssue,
  type IssueKind,
  type IssueResult,
} from "@/lib/serviceActions";

export function ReportIssueDialog({
  open,
  onOpenChange,
  bookingId,
  side,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  side: "client" | "professional";
}) {
  const [kind, setKind] = useState<IssueKind | "">("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setKind("");
      setDetail("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const check = validateIssue(kind, detail);
    if (!check.ok) return setError(check.message);
    setBusy(true);
    const { data, error: err } = await supabase.rpc(
      "hx_report_service_issue" as never,
      { p_booking: bookingId, p_kind: check.kind, p_detail: check.detail } as never,
    );
    setBusy(false);
    if (err) return setError(friendlyError(err));
    const res = (data ?? {}) as { result?: IssueResult; radicado?: string | null };
    const result: IssueResult = res.result ?? "reported";
    if (result === "reported" || result === "already_reported") {
      toast.success(
        `${ISSUE_RESULT_MESSAGE[result]}${res.radicado ? ` Radicado ${res.radicado}.` : ""}`,
      );
      onOpenChange(false);
      return;
    }
    setError(ISSUE_RESULT_MESSAGE[result] ?? ISSUE_RESULT_MESSAGE.forbidden);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar un problema</DialogTitle>
          <DialogDescription>
            Le llega al equipo de Humanix con los datos del turno. Si hay una emergencia de salud,
            usa el botón de emergencia o llama al 123.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">¿Qué pasó?</legend>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as IssueKind)} className="gap-2">
            {ISSUE_KINDS[side].map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
              >
                <RadioGroupItem value={k.id} id={`issue-${k.id}`} />
                <Label
                  htmlFor={`issue-${k.id}`}
                  className="flex-1 cursor-pointer text-sm font-normal"
                >
                  {k.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="issue-detail" className="text-sm font-medium">
            Cuéntanos en pocas palabras
          </Label>
          <Textarea
            id="issue-detail"
            rows={3}
            maxLength={500}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Por ejemplo: son las 9:40 y aún no llega; no contesta el chat."
          />
          <p className="text-right text-xs text-muted-foreground">{detail.length}/500</p>
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Enviar reporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
