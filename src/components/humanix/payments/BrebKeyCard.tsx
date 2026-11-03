// «¿Dónde te enviamos tu plata?» — el profesional guarda su llave Bre-B en un solo campo: escribe su celular, cédula,
// correo o @código y la tarjeta adivina el tipo, lo limpia (+57, puntos, espacios) y lo valida antes de guardar.
// Las reglas viven en `src/lib/breb.ts` (probadas) y la base repite el mismo formato (`professional_payout_keys`).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  CheckCircle2,
  IdCard,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Send,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  BREB_KEY_ERROR,
  BREB_KEY_TYPES,
  guessBrebKeyType,
  maskBrebKey,
  validateBrebKey,
  type BrebKeyType,
} from "@/lib/breb";
import { COP } from "@/lib/commissionMatrix";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

const ICON: Record<BrebKeyType, typeof Phone> = {
  phone: Phone,
  document: IdCard,
  email: Mail,
  alias: AtSign,
};

export const payoutKeyQuery = (userId: string) => ["payout-key", userId] as const;

export function useBrebKey(userId: string) {
  return useQuery({
    queryKey: payoutKeyQuery(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const [key, payouts] = await Promise.all([
        supabase
          .from("professional_payout_keys")
          .select("key_type, key_value")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("payouts")
          .select("amount_cop, status")
          .eq("professional_id", userId)
          .in("status", ["needs_key", "queued", "sent"]),
      ]);
      if (key.error) throw key.error;
      const waiting = (payouts.data ?? []).reduce((s, p) => s + Number(p.amount_cop), 0);
      return {
        key: key.data
          ? { type: key.data.key_type as BrebKeyType, value: key.data.key_value }
          : null,
        waitingCOP: waiting,
      };
    },
  });
}

export function BrebKeyCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const q = useBrebKey(userId);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const [picked, setPicked] = useState<BrebKeyType | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const saved = q.data?.key ?? null;
  const open = editing || (!q.isLoading && !saved);

  useEffect(() => {
    if (!open) {
      setRaw("");
      setPicked(null);
      setTouched(false);
    }
  }, [open]);

  const type: BrebKeyType = picked ?? guessBrebKeyType(raw) ?? "phone";
  const result = useMemo(() => validateBrebKey(type, raw), [type, raw]);
  const meta = BREB_KEY_TYPES.find((t) => t.type === type)!;
  const showError = touched && raw.trim().length > 0 && !result.ok;

  const save = async () => {
    setTouched(true);
    if (!result.ok) return;
    setSaving(true);
    const { error } = await supabase.from("professional_payout_keys").upsert({
      user_id: userId,
      key_type: result.type,
      key_value: result.value,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error(friendlyError(error, "No pudimos guardar tu llave. Inténtalo de nuevo."));
      return;
    }
    toast.success("¡Llave guardada! Aquí te llegará tu plata 💸");
    setEditing(false);
    void qc.invalidateQueries({ queryKey: payoutKeyQuery(userId) });
  };

  if (q.isLoading) {
    return <div className="h-32 animate-pulse rounded-3xl bg-muted/60" aria-hidden="true" />;
  }

  if (!open && saved) {
    const Icon = ICON[saved.type];
    return (
      <section
        aria-label="Tu llave Bre-B"
        className="rounded-3xl border border-biosensor/30 bg-biosensor/5 p-5"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-biosensor text-biosensor-foreground">
            <Zap className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">Tu llave Bre-B</p>
            <p className="flex items-center gap-2 font-display text-xl font-bold">
              <Icon className="h-4 w-4 text-biosensor" aria-hidden="true" />
              <span className="truncate">{maskBrebKey(saved.type, saved.value)}</span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label="Cambiar mi llave Bre-B"
          >
            <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Cambiar
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-biosensor" aria-hidden="true" />
          {q.data!.waitingCOP > 0
            ? `${COP(q.data!.waitingCOP)} en camino a tu llave.`
            : "Cuando una familia pague por Bre-B, te enviamos tu parte aquí al terminar el turno."}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Agrega tu llave Bre-B"
      className="rounded-3xl border-2 border-dashed border-biosensor/40 bg-card p-5"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-3xl">
          💸
        </span>
        <div>
          <h3 className="font-display text-xl font-bold">¿Dónde te enviamos tu plata?</h3>
          <p className="text-sm text-muted-foreground">
            Escribe tu llave Bre-B: la misma que usas para recibir en tu banco, Nequi o Daviplata.
          </p>
        </div>
      </div>

      {q.data && q.data.waitingCOP > 0 && !saved && (
        <p className="mt-3 rounded-2xl bg-copper/10 px-4 py-2 text-sm font-semibold text-copper">
          Tienes {COP(q.data.waitingCOP)} esperando. Agrega tu llave y te los enviamos.
        </p>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div role="radiogroup" aria-label="Tipo de llave" className="flex flex-wrap gap-2">
          {BREB_KEY_TYPES.map((t) => {
            const Icon = ICON[t.type];
            const on = t.type === type;
            return (
              <button
                key={t.type}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(t.type)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
                  on
                    ? "border-biosensor bg-biosensor text-biosensor-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {t.label}
              </button>
            );
          })}
        </div>

        <div>
          <label htmlFor="breb-key" className="sr-only">
            Tu llave Bre-B
          </label>
          <Input
            id="breb-key"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={meta.example}
            inputMode={
              type === "phone" || type === "document"
                ? "numeric"
                : type === "email"
                  ? "email"
                  : "text"
            }
            autoComplete={type === "phone" ? "tel-national" : type === "email" ? "email" : "off"}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={showError}
            aria-describedby="breb-key-help"
            className="h-14 rounded-2xl text-lg"
          />
          <p
            id="breb-key-help"
            className={cn(
              "mt-1.5 text-sm",
              showError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {showError
              ? BREB_KEY_ERROR[(result as { error: keyof typeof BREB_KEY_ERROR }).error]
              : meta.hint}
            {result.ok && (
              <span className="ml-1 inline-flex items-center gap-1 font-medium text-biosensor">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Se ve bien
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          {saved && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="rounded-2xl"
              onClick={() => setEditing(false)}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            size="lg"
            className="h-14 flex-1 rounded-2xl text-base font-bold"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="mr-2 h-5 w-5" aria-hidden="true" />
            )}
            Guardar mi llave
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          🔒 Solo tú y el equipo de pagos de Humanix ven tu llave completa. A las familias nunca se
          les muestra.
        </p>
      </form>
    </section>
  );
}
