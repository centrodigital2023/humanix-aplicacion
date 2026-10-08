import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { DIMENSION_LABELS } from "@/lib/ratingDimensions";

const sb = supabase as unknown as SupabaseClient;

type Row = { dimension: string; average: number; ratings: number };

export function DimensionAverages({ professionalId }: { professionalId: string }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    sb.rpc("professional_dimension_averages", { p_user: professionalId }).then(({ data }) => {
      if (active) setRows((data ?? []) as Row[]);
    });
    return () => {
      active = false;
    };
  }, [professionalId]);

  if (!rows.length) return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">Calificaciones verificadas por dimensión</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.dimension} className="text-sm">
            <div className="flex justify-between">
              <span>{DIMENSION_LABELS[r.dimension] ?? r.dimension}</span>
              <span className="font-semibold">{Number(r.average).toFixed(1)} / 5</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-biosensor"
                style={{ width: `${(Number(r.average) / 5) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Basado en servicios completados. Se muestran solo con 3 o más calificaciones.
      </p>
    </section>
  );
}
