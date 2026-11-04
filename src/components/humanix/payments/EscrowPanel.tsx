// Pago retenido tipo InDrive, del lado de la familia: confirmar que el turno terminó («liberar pago»), reportar un
// problema dentro de las 24 h y, si hay devolución, decir a qué llave Bre-B la enviamos. Las reglas viven en
// `src/lib/escrow.ts` (probadas) y la base las impone (migración 20261104180000).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  BREB_KEY_ERROR,
  guessBrebKeyType,
  maskBrebKey,
  validateBrebKey,
  type BrebKeyType,
} from "@/lib/breb";
import { COP } from "@/lib/commissionMatrix";
import {
  CONFIRM_MESSAGE,
  DISPUTE_REASON_MAX,
  isConfirmResult,
  isReportResult,
  releaseInWords,
  REPORT_MESSAGE,
  validateDisputeReason,
} from "@/lib/escrow";
import { friendlyError } from "@/lib/friendlyError";

// Funciones y tablas de 20261104180000, más nuevas que los tipos generados: cliente sin tipar (misma sesión).
const db = supabase as unknown as SupabaseClient;
const rpc = (fn: string, args: Record<string, unknown>) => db.rpc(fn, args);

/** «¿Todo bien con el turno?»: liberar o reportar. También sirve para retirar un reclamo («Ya se resolvió»). */
export function EscrowDecision({
  bookingId,
  peerFirstName,
  amountCOP,
  hoursLeft,
  disputed,
  onChanged,
}: {
  bookingId: string;
  peerFirstName: string;
  amountCOP: number;
  hoursLeft: number;
  disputed?: boolean;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<"confirm" | "report" | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const check = validateDisputeReason(reason);

  const confirm = async () => {
    setBusy("confirm");
    const { data, error } = await rpc("hx_confirm_booking_done", { p_booking: bookingId });
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    if (isConfirmResult(data)) {
      (data === "released" || data === "already_released" || data === "confirmed"
        ? toast.success
        : toast.error)(CONFIRM_MESSAGE[data]);
    }
    onChanged?.();
  };

  const report = async () => {
    setTouched(true);
    if (!check.ok) return;
    setBusy("report");
    const { data, error } = await rpc("hx_report_booking_problem", {
      p_booking: bookingId,
      p_reason: check.value,
    });
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    if (isReportResult(data)) {
      (data === "disputed" || data === "already_disputed" ? toast.success : toast.error)(
        REPORT_MESSAGE[data],
      );
      if (data === "disputed") setReporting(false);
    }
    onChanged?.();
  };

  if (disputed) {
    return (
      <div className="rounded-3xl border border-copper/30 bg-copper/10 p-4">
        <p className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5 text-copper" aria-hidden="true" /> Estamos revisando tu
          reporte
        </p>
        <p className="text-sm text-muted-foreground">
          Tu pago de {COP(amountCOP)} sigue guardado por Humanix. Te escribimos en menos de un día
          hábil.
        </p>
        <Button
          variant="outline"
          className="mt-3 w-full rounded-2xl"
          disabled={busy !== null}
          onClick={confirm}
        >
          {busy === "confirm" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Ya se resolvió: liberar el pago a {peerFirstName}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-trust/30 bg-trust/5 p-4">
      <p className="text-base font-semibold">¿Todo bien con el turno de {peerFirstName}?</p>
      <p className="text-sm text-muted-foreground">
        Humanix guarda tus {COP(amountCOP)}. Si no nos dices nada, se lo liberamos{" "}
        {releaseInWords(hoursLeft)}.
      </p>
      <Button
        size="lg"
        className="mt-3 h-14 w-full rounded-2xl text-base font-bold"
        disabled={busy !== null}
        onClick={confirm}
      >
        {busy === "confirm" ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-2 h-5 w-5" aria-hidden="true" />
        )}
        Sí, liberar el pago a {peerFirstName}
      </Button>
      {!reporting ? (
        <Button
          variant="ghost"
          className="mt-1 w-full text-muted-foreground"
          disabled={busy !== null}
          onClick={() => setReporting(true)}
        >
          Hubo un problema
        </Button>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void report();
          }}
        >
          <label htmlFor={`dispute-${bookingId}`} className="text-sm font-medium">
            ¿Qué pasó? El pago queda retenido mientras lo revisamos.
          </label>
          <Textarea
            id={`dispute-${bookingId}`}
            value={reason}
            maxLength={DISPUTE_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Ej.: llegó dos horas tarde y se fue antes de terminar."
            aria-invalid={touched && !check.ok}
          />
          {touched && !check.ok && <p className="text-sm text-destructive">{check.message}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setReporting(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" className="flex-1" disabled={busy !== null}>
              {busy === "report" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar reporte
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

type RefundRow = {
  id: string;
  amount_cop: number;
  status: "needs_key" | "queued" | "paid" | "failed";
  key_type: BrebKeyType | null;
  key_value: string | null;
  reason: string;
};

/** Devolución a la familia: estado y, si falta, su llave Bre-B. */
export function RefundPanel({ bookingId, userId }: { bookingId: string; userId: string }) {
  const qc = useQueryClient();
  const key = ["booking-refunds", bookingId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db
        .from("booking_refunds")
        .select("id, amount_cop, status, key_type, key_value, reason")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RefundRow[];
    },
  });
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const type: BrebKeyType = guessBrebKeyType(raw) ?? "phone";
  const result = useMemo(() => validateBrebKey(type, raw), [type, raw]);

  const rows = q.data ?? [];
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-3xl bg-muted/60" />;
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-border bg-muted/40 p-4">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Undo2 className="h-5 w-5" aria-hidden="true" /> Te devolvemos tu pago completo
        </p>
        <p className="text-sm text-muted-foreground">
          Estamos preparando la devolución. Te avisamos apenas salga.
        </p>
      </div>
    );
  }
  const total = rows.reduce((s, r) => s + Number(r.amount_cop), 0);
  const needsKey = rows.some((r) => r.status === "needs_key" || r.status === "failed");
  const allPaid = rows.every((r) => r.status === "paid");
  const sent = rows.find((r) => r.key_value && r.key_type);

  const save = async () => {
    setTouched(true);
    if (!result.ok) return;
    setSaving(true);
    const { error } = await db.from("client_refund_keys").upsert({
      user_id: userId,
      key_type: result.type,
      key_value: result.value,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) return toast.error(friendlyError(error, "No pudimos guardar tu llave."));
    toast.success("Listo. Te enviamos la devolución a esa llave.");
    setRaw("");
    void qc.invalidateQueries({ queryKey: key });
  };

  return (
    <div className="rounded-3xl border border-biosensor/30 bg-biosensor/5 p-4">
      <p className="flex items-center gap-2 text-base font-semibold">
        {allPaid ? (
          <CheckCircle2 className="h-5 w-5 text-biosensor" aria-hidden="true" />
        ) : (
          <Undo2 className="h-5 w-5 text-biosensor" aria-hidden="true" />
        )}
        {allPaid ? `Te devolvimos ${COP(total)}` : `Te devolvemos ${COP(total)} completo`}
      </p>
      {!needsKey && !allPaid && sent?.key_type && sent.key_value && (
        <p className="text-sm text-muted-foreground">
          A tu llave Bre-B {maskBrebKey(sent.key_type, sent.key_value)}. Suele tardar menos de un
          día hábil.
        </p>
      )}
      {needsKey && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`refund-key-${bookingId}`} className="text-sm font-medium">
            ¿A qué llave Bre-B te lo devolvemos? (celular, cédula, correo o @llave)
          </label>
          <Input
            id={`refund-key-${bookingId}`}
            value={raw}
            inputMode={type === "phone" || type === "document" ? "numeric" : "text"}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="300 123 4567"
            aria-invalid={touched && !result.ok}
          />
          {touched && raw.trim() && !result.ok && (
            <p className="text-sm text-destructive">{BREB_KEY_ERROR[result.error]}</p>
          )}
          <Button type="submit" className="w-full rounded-2xl" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Guardar y recibir mi devolución
          </Button>
        </form>
      )}
    </div>
  );
}
