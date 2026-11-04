// Reprogramar un turno: una parte propone otra fecha y hora, la otra la acepta o la rechaza.
// Las reglas (quién, cuándo, choque de horario) las impone la base: hx_request_reschedule / hx_answer_reschedule.
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "@/lib/opportunities";

export type RescheduleRequest = {
  id: string;
  booking_id: string;
  requested_by: string;
  previous_at: string;
  proposed_at: string;
  note: string | null;
  status: string;
  created_at: string;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { dateStyle: "full", timeStyle: "short" });

/** Valor para <input type="datetime-local"> en hora local. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Propuesta abierta del turno, en vivo. */
export function useOpenReschedule(bookingId: string, enabled: boolean) {
  const [request, setRequest] = useState<RescheduleRequest | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("booking_reschedule_requests" as never)
      .select("*")
      .eq("booking_id", bookingId)
      .eq("status", "pending")
      .maybeSingle();
    setRequest((data as RescheduleRequest | null) ?? null);
  }, [bookingId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const ch = supabase
      .channel(`reschedule-${bookingId}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "booking_reschedule_requests",
          filter: `booking_id=eq.${bookingId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [bookingId, enabled, load]);

  return { request, reload: load };
}

export function RescheduleDialog({
  open,
  onOpenChange,
  bookingId,
  currentAt,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  currentAt: string;
  onSent?: () => void;
}) {
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const min = toLocalInput(new Date(Date.now() + 60 * 60 * 1000));

  useEffect(() => {
    if (open) {
      setWhen(toLocalInput(new Date(currentAt)));
      setNote("");
      setError(null);
    }
  }, [open, currentAt]);

  const submit = async () => {
    const date = new Date(when);
    if (!when || Number.isNaN(date.getTime())) return setError("Elige la nueva fecha y hora.");
    if (date.getTime() < Date.now() + 60 * 60 * 1000)
      return setError("Elige una hora con al menos una hora de anticipación.");
    if (date.getTime() === new Date(currentAt).getTime())
      return setError("Esa ya es la hora del turno.");
    const trimmed = note.trim();
    if (trimmed) {
      const check = checkOutgoingMessage(trimmed, { maxChars: 300 });
      if (!check.ok) return setError(MESSAGE_ERROR_COPY[check.reason]);
    }
    setBusy(true);
    const { error: err } = await supabase.rpc(
      "hx_request_reschedule" as never,
      { p_booking: bookingId, p_new_at: date.toISOString(), p_note: trimmed || null } as never,
    );
    setBusy(false);
    if (err) return setError(friendlyError(err));
    toast.success("Enviamos tu propuesta. Te avisamos cuando respondan.");
    onOpenChange(false);
    onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reprogramar el turno</DialogTitle>
          <DialogDescription>
            Hoy está para el {fmt(currentAt)}. La otra parte debe aceptar la nueva hora; mientras
            tanto el turno sigue igual. El valor y el pago no cambian.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-at">Nueva fecha y hora</Label>
            <Input
              id="reschedule-at"
              type="datetime-local"
              min={min}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-note">Nota (opcional)</Label>
            <Textarea
              id="reschedule-note"
              rows={2}
              maxLength={300}
              placeholder="Por ejemplo: la cita médica se movió a la tarde."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Proponer nueva hora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aviso de propuesta abierta: quien la recibe acepta o rechaza; quien la envió puede retirarla. */
export function ReschedulePrompt({
  request,
  userId,
  peerFirstName,
  onAnswered,
}: {
  request: RescheduleRequest;
  userId: string;
  peerFirstName: string;
  onAnswered?: (result: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const mine = request.requested_by === userId;

  const answer = async (action: "accept" | "decline" | "withdraw") => {
    setBusy(action);
    const { data, error } = await supabase.rpc(
      "hx_answer_reschedule" as never,
      { p_request: request.id, p_action: action } as never,
    );
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    const result = String(data ?? action);
    if (result === "accepted")
      toast.success(`Listo: el turno quedó para el ${fmt(request.proposed_at)}.`);
    else if (result === "expired")
      toast.error("La propuesta ya no se puede aceptar. Pide otra hora.");
    else if (result === "declined") toast("Rechazaste la nueva hora. El turno sigue igual.");
    else toast("Retiraste tu propuesta.");
    onAnswered?.(result);
  };

  return (
    <div className="mt-4 rounded-2xl border border-copper/30 bg-copper/5 p-4 text-sm" role="status">
      <p className="font-semibold inline-flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-copper" aria-hidden="true" />
        {mine
          ? `Propusiste otra hora. Esperando a ${peerFirstName}.`
          : `${peerFirstName} propone otra hora para el turno.`}
      </p>
      <p className="mt-1 text-muted-foreground">
        De {fmt(request.previous_at)} a{" "}
        <strong className="text-foreground">{fmt(request.proposed_at)}</strong>.
      </p>
      {request.note && <p className="mt-1 italic text-muted-foreground">«{request.note}»</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {mine ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => void answer("withdraw")}
          >
            {busy === "withdraw" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Retirar propuesta
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={!!busy} onClick={() => void answer("accept")}>
              {busy === "accept" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Aceptar nueva hora
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void answer("decline")}
            >
              {busy === "decline" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Rechazar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
