import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { COVERAGE_META, coverageLevel, type CoverageLevel } from "@/lib/coverage";

const sb = supabase as unknown as SupabaseClient;

type Row = {
  id: string;
  title: string;
  city: string;
  start_date: string | null;
  level: CoverageLevel;
  accepted: number;
  pending: number;
  needed: number;
};

export function CoverageSemaphore({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const { data: offers } = await sb
      .from("job_offers")
      .select("id,title,city,status,shifts_count,start_date")
      .eq("posted_by", userId)
      .in("status", ["open", "filled"])
      .order("start_date", { ascending: true, nullsFirst: false })
      .limit(100);
    const list = (offers ?? []) as Array<{
      id: string;
      title: string;
      city: string;
      status: "open" | "closed" | "filled";
      shifts_count: number | null;
      start_date: string | null;
    }>;
    if (!list.length) {
      setRows([]);
      return;
    }
    const { data: apps } = await sb
      .from("applications")
      .select("job_offer_id,status")
      .in(
        "job_offer_id",
        list.map((o) => o.id),
      );
    const counts = new Map<string, { accepted: number; pending: number }>();
    for (const a of (apps ?? []) as Array<{ job_offer_id: string; status: string }>) {
      const c = counts.get(a.job_offer_id) ?? { accepted: 0, pending: 0 };
      if (a.status === "accepted") c.accepted++;
      else if (a.status === "pending") c.pending++;
      counts.set(a.job_offer_id, c);
    }
    setRows(
      list.map((o) => {
        const c = counts.get(o.id) ?? { accepted: 0, pending: 0 };
        return {
          id: o.id,
          title: o.title,
          city: o.city,
          start_date: o.start_date,
          accepted: c.accepted,
          pending: c.pending,
          needed: Math.max(1, o.shifts_count ?? 1),
          level: coverageLevel({
            status: o.status,
            shiftsCount: o.shifts_count,
            startDate: o.start_date,
            acceptedCount: c.accepted,
            pendingCount: c.pending,
          }),
        };
      }),
    );
  }, [userId]);

  useEffect(() => {
    void load();
    const ch = sb
      .channel(`coverage-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_offers" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [userId, load]);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando cobertura…
      </div>
    );
  }

  const totals = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.level === "urgent" ? "uncovered" : r.level;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-border p-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 mr-1" />
          <strong>{totals.covered ?? 0}</strong> cubiertos
        </div>
        <div className="rounded-lg border border-border p-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 mr-1" />
          <strong>{totals.pending_approval ?? 0}</strong> por aprobar
        </div>
        <div className="rounded-lg border border-border p-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 mr-1" />
          <strong>{totals.uncovered ?? 0}</strong> sin candidatos
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tienes ofertas abiertas. Publica turnos para ver la cobertura.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${COVERAGE_META[r.level].dot}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.city}
                  {r.start_date
                    ? ` · ${new Date(r.start_date).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`
                    : ""}
                  {` · ${r.accepted}/${r.needed} turnos aprobados`}
                  {r.pending ? ` · ${r.pending} postulante${r.pending === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {COVERAGE_META[r.level].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
