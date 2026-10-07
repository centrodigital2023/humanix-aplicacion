import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { buildPriceBreakdown, formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;
const DEFAULT_COMMISSION_PCT = 12;
const pctCache = new Map<string, number>();

interface Props {
  hourlyRate: number;
  hours: number;
  professionalId: string;
  /** Vista del que paga: oculta el neto del profesional. */
  viewer?: "payer" | "professional";
}

export function PriceBreakdownCard({ hourlyRate, hours, professionalId, viewer = "payer" }: Props) {
  const [pct, setPct] = useState<number | null>(pctCache.get(professionalId) ?? null);

  useEffect(() => {
    if (pctCache.has(professionalId)) return;
    let active = true;
    sb.rpc("platform_commission_pct", { p_user_id: professionalId }).then(({ data }) => {
      const value = typeof data === "number" ? data : DEFAULT_COMMISSION_PCT;
      pctCache.set(professionalId, value);
      if (active) setPct(value);
    });
    return () => {
      active = false;
    };
  }, [professionalId]);

  const b = useMemo(() => buildPriceBreakdown(hourlyRate, hours, pct ?? DEFAULT_COMMISSION_PCT), [hourlyRate, hours, pct]);

  return (
    <dl className="rounded-xl border border-border bg-muted/30 p-3 text-xs space-y-1">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Valor por hora</dt>
        <dd>{formatCOP(b.hourlyRate)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Horas</dt>
        <dd>{b.hours}</dd>
      </div>
      <div className="flex justify-between font-semibold border-t border-border pt-1">
        <dt>Total {viewer === "payer" ? "a pagar" : "del servicio"}</dt>
        <dd>{formatCOP(b.total)}</dd>
      </div>
      {viewer === "professional" && (
        <>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Comisión Humanix ({b.commissionPct}%)</dt>
            <dd>−{formatCOP(b.commission)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-biosensor">
            <dt>Recibes</dt>
            <dd>{formatCOP(b.professionalNet)}</dd>
          </div>
        </>
      )}
      {pct === null && <p className="text-[10px] text-muted-foreground">Calculando comisión…</p>}
    </dl>
  );
}
