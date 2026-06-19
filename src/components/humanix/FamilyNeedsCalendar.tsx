import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Eraser, Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Untyped client for tables not in generated types (migration pendiente de regenerar)
const sb = supabase as unknown as SupabaseClient;

type Need = {
  id: string;
  family_user_id: string;
  starts_at: string;
  ends_at: string;
  hourly_rate: number;
  status: "open" | "matched" | "cancelled" | "expired";
  service_address: string | null;
  notes: string | null;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0:00 a 23:00
const DAY_LABEL = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function FamilyNeedsCalendar({
  userId,
  serviceAddress,
}: {
  userId: string;
  serviceAddress?: string | null;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [needs, setNeeds] = useState<Need[]>([]);
  const [loading, setLoading] = useState(true);
  const [hourlyRate, setHourlyRate] = useState<number>(20000);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await sb
        .from("family_needs")
        .select("id, family_user_id, starts_at, ends_at, hourly_rate, status, service_address, notes")
        .eq("family_user_id", userId)
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .order("starts_at");
      if (!active) return;
      if (error) {
        console.warn("[needs]", error.message);
        setNeeds([]);
      } else {
        setNeeds((data ?? []) as Need[]);
      }
      setLoading(false);
    })();

    const channel = sb
      .channel(`family_needs_${userId}_${weekStart.toISOString()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "family_needs", filter: `family_user_id=eq.${userId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Need | undefined;
          if (!row) return;
          const ts = new Date(row.starts_at);
          if (ts < weekStart || ts >= weekEnd) return;
          if (payload.eventType === "DELETE") {
            setNeeds((prev) => prev.filter((n) => n.id !== row.id));
          } else if (payload.eventType === "INSERT") {
            setNeeds((prev) => (prev.some((n) => n.id === row.id) ? prev : [...prev, row as Need]));
          } else {
            setNeeds((prev) => prev.map((n) => (n.id === row.id ? (row as Need) : n)));
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, [userId, weekStart, weekEnd]);

  const needAt = (day: Date, hour: number): Need | undefined =>
    needs.find((n) => {
      const s = new Date(n.starts_at);
      return s.getDate() === day.getDate() && s.getMonth() === day.getMonth() && s.getHours() === hour;
    });

  async function toggleNeed(day: Date, hour: number) {
    const existing = needAt(day, hour);
    if (existing) {
      if (existing.status === "matched") {
        toast.info("Esta hora ya tiene profesional asignado");
        return;
      }
      const { error } = await sb.from("family_needs").delete().eq("id", existing.id);
      if (error) toast.error(error.message);
      else setNeeds((n) => n.filter((x) => x.id !== existing.id));
      return;
    }
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1);
    const payload = {
      family_user_id: userId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      hourly_rate: hourlyRate,
      status: "open",
      service_address: serviceAddress ?? null,
    };
    const { data, error } = await sb.from("family_needs").insert(payload).select().single();
    if (error) toast.error(error.message);
    else if (data) setNeeds((n) => [...n, data as Need]);
  }

  const today = new Date();
  const openCount = needs.filter((n) => n.status === "open").length;
  const matchedCount = needs.filter((n) => n.status === "matched").length;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <Heart className="h-4 w-4 text-blue-500" />
            Tu agenda de necesidades
          </p>
          <p className="text-[11px] text-muted-foreground">
            {openCount} h abiertas · {matchedCount} h cubiertas · marca en azul cuándo necesitas ayuda
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Tarifa/h</span>
            <Input
              type="number"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Math.max(0, Number(e.target.value) || 0))}
              className="h-7 w-24 text-xs"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Hoy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className="p-2 w-12 text-left font-medium text-muted-foreground"></th>
                {days.map((d) => {
                  const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
                  return (
                    <th
                      key={d.toISOString()}
                      className={`p-2 text-center font-medium ${isToday ? "text-biosensor" : "text-muted-foreground"}`}
                    >
                      <div>{DAY_LABEL[(d.getDay() + 6) % 7]}</div>
                      <div className={`text-[10px] ${isToday ? "font-bold" : ""}`}>{d.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => (
                <tr key={h} className="border-b border-border/50">
                  <td className="p-2 text-muted-foreground text-[10px] font-medium">
                    {h.toString().padStart(2, "0")}:00
                  </td>
                  {days.map((d) => {
                    const need = needAt(d, h);
                    const cls = need
                      ? need.status === "matched"
                        ? "bg-green-600/70 border-green-600/80 cursor-not-allowed"
                        : "bg-blue-500/70 hover:bg-blue-500 border-blue-500/80"
                      : "hover:bg-blue-500/10 border-transparent";
                    return (
                      <td key={d.toISOString() + h} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => toggleNeed(d, h)}
                          className={`w-full h-8 rounded-md border ${cls} transition-colors`}
                          title={
                            need
                              ? need.status === "matched"
                                ? "Cubierto por un profesional"
                                : "Abierto — toca para eliminar"
                              : "Vacío — toca para pedir ayuda"
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-3 border-t border-border flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        <Legend color="bg-blue-500 border-blue-600" label="Abierto (necesito)" />
        <Legend color="bg-green-600 border-green-700" label="Cubierto (acuerdo cerrado)" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded border ${color}`} />
      {label}
    </span>
  );
}
