// «Tus pagos»: el saldo individual del profesional según el libro (migración 20261105100000, `get_my_earnings`).
//   Retenido   → la familia ya pagó; Humanix lo guarda hasta que confirme que terminaste (máx. 24 h).
//   Por llegar → liberado y saliendo hacia tu llave Bre-B (en segundos con la dispersión automática).
//   Recibido   → ya está en tu cuenta.
// Se actualiza solo (Realtime sobre `payouts`). Si la migración aún no está, la tarjeta no se muestra.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowDownToLine, Lock, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { COP } from "@/lib/commissionMatrix";

const sb = supabase as unknown as SupabaseClient;

export interface Earnings {
  held: number;
  available: number;
  inTransit: number;
  paid30d: number;
  paidTotal: number;
  fees30d: number;
  needsKey: boolean;
}

export function parseEarnings(row: Record<string, unknown> | null | undefined): Earnings {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    held: n(row?.held_cop),
    available: n(row?.available_cop),
    inTransit: n(row?.in_transit_cop),
    paid30d: n(row?.paid_30d_cop),
    paidTotal: n(row?.paid_total_cop),
    fees30d: n(row?.fees_30d_cop),
    needsKey: Boolean(row?.needs_key),
  };
}

export function EarningsCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const key = ["earnings", userId] as const;
  const q = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("get_my_earnings");
      if (error) return null; // migración pendiente: no se muestra
      return parseEarnings((data as Record<string, unknown>[] | null)?.[0]);
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`earnings:${userId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payouts", filter: `professional_id=eq.${userId}` },
        () => void qc.invalidateQueries({ queryKey: ["earnings", userId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const e = q.data;
  if (!e) return null;
  const onTheWay = e.available + e.inTransit;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-display text-lg font-bold">Tus pagos</h3>
        <p className="text-sm text-muted-foreground">
          Lo que pagan las familias por tus turnos, ya sin la comisión de Humanix.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-muted/50 p-3">
          <Lock className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <p className="mt-1 text-xs text-muted-foreground">Retenido</p>
          <p className="font-display text-base font-bold">{COP(e.held)}</p>
        </div>
        <div className="rounded-2xl bg-biosensor/10 p-3">
          <Send className="mx-auto h-4 w-4 text-biosensor" aria-hidden="true" />
          <p className="mt-1 text-xs text-muted-foreground">Por llegar</p>
          <p className="font-display text-base font-bold">{COP(onTheWay)}</p>
        </div>
        <div className="rounded-2xl bg-muted/50 p-3">
          <ArrowDownToLine className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <p className="mt-1 text-xs text-muted-foreground">Recibido (30 días)</p>
          <p className="font-display text-base font-bold">{COP(e.paid30d)}</p>
        </div>
      </div>
      {e.needsKey ? (
        <p className="rounded-2xl bg-amber-500/10 px-3 py-2 text-sm">
          Tienes pagos esperando: agrega tu llave Bre-B y te los enviamos.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Retenido: la familia ya pagó y lo liberamos cuando confirme que terminaste (máximo 24 h).
          Comisión de Humanix en los últimos 30 días: {COP(e.fees30d)}. Recibido en total:{" "}
          {COP(e.paidTotal)}.
        </p>
      )}
    </Card>
  );
}
