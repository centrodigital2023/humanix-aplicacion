import { Sparkles, Loader2, Info } from "lucide-react";
import { useAiCredits } from "@/hooks/use-ai-credits";

export function TokenPackages({ userId, userEmail }: { userId: string; userEmail?: string }) {
  const { balance, loading } = useAiCredits(userId);

  return (
    <div className="space-y-6">
      {/* Saldo actual */}
      {balance && (
        <div className="rounded-2xl bg-gradient-to-br from-biosensor/10 to-fuchsia-neural/5 border border-biosensor/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-biosensor" />
            <h2 className="font-semibold">Tu saldo de créditos IA</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="text-center rounded-xl bg-background/60 p-3">
              <p className="text-2xl font-bold text-biosensor">
                {balance.grand_total.toLocaleString("es-CO")}
              </p>
              <p className="text-xs text-muted-foreground">disponibles</p>
            </div>
            <div className="text-center rounded-xl bg-background/60 p-3">
              <p className="text-2xl font-bold">
                {balance.monthly_remaining.toLocaleString("es-CO")}
              </p>
              <p className="text-xs text-muted-foreground">del plan</p>
            </div>
            <div className="text-center rounded-xl bg-background/60 p-3">
              <p className="text-2xl font-bold text-emerald-500">
                {balance.extra_remaining.toLocaleString("es-CO")}
              </p>
              <p className="text-xs text-muted-foreground">comprados</p>
            </div>
            <div className="text-center rounded-xl bg-background/60 p-3">
              <p className="text-2xl font-bold text-muted-foreground">
                {(balance.monthly_used + balance.extra_used).toLocaleString("es-CO")}
              </p>
              <p className="text-xs text-muted-foreground">usados</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-biosensor to-fuchsia-500 transition-all"
              style={{
                width: `${Math.min(100, ((balance.monthly_used + balance.extra_used) / Math.max(1, balance.monthly_allowance + balance.extra_total)) * 100)}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Período del plan: {new Date(balance.period_start).toLocaleDateString("es-CO")} –{" "}
            {new Date(balance.period_end).toLocaleDateString("es-CO")}
          </p>
        </div>
      )}

      {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}

      {/* Info */}
      <div className="rounded-xl bg-muted/30 border border-border p-4 flex gap-3">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>1 crédito = 1 invocación de IA</strong>: análisis de documentos, sugerencias de
            mensajes, validación de perfil, SOAP de enfermería, scoring de candidatos, etc.
          </p>
          <p>
            Los créditos del plan mensual se renuevan cada mes. Los créditos comprados tienen
            vigencia según el paquete y <strong>no expiran en ciclos mensuales</strong>.
          </p>
          <p>La compra de créditos no está disponible.</p>
        </div>
      </div>
    </div>
  );
}
