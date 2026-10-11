import { useState } from "react";
import { Sparkles, Zap, ShieldCheck, Loader2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAiCredits, type AiCreditPack } from "@/hooks/use-ai-credits";
import { COP } from "@/lib/plans";

const PACK_ICONS: Record<string, string> = {
  pack_100: "⚡",
  pack_300: "🔥",
  pack_600: "🚀",
  pack_1500: "🏥",
};

const PACK_COLORS: Record<string, string> = {
  pack_100: "from-biosensor/20 to-biosensor/5 border-biosensor/30",
  pack_300: "from-fuchsia-500/20 to-fuchsia-500/5 border-fuchsia-500/30",
  pack_600: "from-violet-500/20 to-violet-500/5 border-violet-500/30",
  pack_1500: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
};

function PackCard({
  pack,
  onBuy,
  buying,
}: {
  pack: AiCreditPack;
  onBuy: (packId: string) => void;
  buying: string | null;
}) {
  const totalCredits = Math.round(pack.credits * (1 + (pack.bonus_pct ?? 0) / 100));
  const isBuying = buying === pack.id;
  const gradient = PACK_COLORS[pack.id] ?? "from-muted/20 to-muted/5 border-border";
  const icon = PACK_ICONS[pack.id] ?? "💡";

  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${gradient} border p-5 flex flex-col gap-3 relative`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-2xl">{icon}</span>
          <h3 className="font-semibold text-base mt-1">{pack.name}</h3>
          {pack.description && <p className="text-xs text-muted-foreground">{pack.description}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold">{COP(pack.price_cop)}</p>
          <p className="text-xs text-muted-foreground">pago único</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-full bg-background/60">
          <Sparkles className="h-3.5 w-3.5 text-biosensor" />
          {totalCredits.toLocaleString("es-CO")} créditos
        </span>
        {pack.bonus_pct > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium">
            +{pack.bonus_pct}% bono
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Vigencia {pack.validity_days} días
        </span>
      </div>

      <div className="text-xs text-muted-foreground">
        ≈ {COP(Math.round(pack.price_cop / totalCredits))} por crédito
      </div>

      <Button
        className="w-full mt-1"
        variant={pack.id === "pack_600" ? "hero" : "glass"}
        disabled={!!buying}
        onClick={() => onBuy(pack.id)}
      >
        {isBuying ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Procesando…
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 mr-1.5" /> Comprar
          </>
        )}
      </Button>
    </div>
  );
}

export function TokenPackages({ userId, userEmail }: { userId: string; userEmail?: string }) {
  const { balance, packs, loading, refresh } = useAiCredits(userId);
  const [buying, setBuying] = useState<string | null>(null);

  const handleBuy = async (packId: string) => {
    setBuying(packId);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) {
        toast.error("Inicia sesión para comprar");
        return;
      }

      const { data, error } = await supabase.functions.invoke("mp-create-credits-checkout", {
        body: { pack_id: packId, email: userEmail ?? "" },
      });
      if (error) throw error;

      const url = data?.init_point ?? data?.sandbox_init_point;
      if (!url) throw new Error("No se recibió URL de pago");

      window.open(url, "_blank", "noopener,noreferrer");
      toast.success(
        "Abriendo Mercado Pago… completa el pago y los créditos se acreditarán automáticamente.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al iniciar el pago");
    } finally {
      setBuying(null);
      setTimeout(refresh, 3000);
    }
  };

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

      {/* Paquetes disponibles */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-biosensor" />
          <h3 className="font-semibold">Paquetes de créditos extra</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Compra créditos extra cuando necesites más. Se suman a tu cupo mensual y se usan
          automáticamente.
        </p>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {packs.map((pack) => (
              <PackCard key={pack.id} pack={pack} onBuy={handleBuy} buying={buying} />
            ))}
          </div>
        )}
      </div>

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
          <p className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Pago 100 % seguro vía Mercado Pago · se acreditan
            automáticamente tras el pago.
          </p>
        </div>
      </div>
    </div>
  );
}
