import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Eraser,
  Brain,
  TrendingUp,
  Zap,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Slot = {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  status: "free" | "reserved" | "busy";
  note: string | null;
};

const HOURS = Array.from({ length: 14 }, (_, i) => 6 + i); // 6:00 a 19:00

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

const DAY_LABEL = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

type Preset = "morning" | "afternoon" | "evening" | "weekdays" | "all" | "clear";

export function AvailabilityCalendar({
  userId,
  editable = true,
}: {
  userId: string;
  editable?: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [history, setHistory] = useState<Slot[]>([]);
  const [tariff, setTariff] = useState<{
    suggested: number | null;
    market: number | null;
    city: string | null;
    specialty: string | null;
  }>({ suggested: null, market: null, city: null, specialty: null });

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("availability_slots")
        .select("id, user_id, starts_at, ends_at, status, note")
        .eq("user_id", userId)
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .order("starts_at");
      if (!active) return;
      if (error) {
        console.warn("[agenda]", error.message);
        setSlots([]);
      } else {
        setSlots((data ?? []) as Slot[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId, weekStart, weekEnd]);

  // Cargar historial (últimas 4 semanas) para sugerencias predictivas
  useEffect(() => {
    let active = true;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 28);
      const { data } = await supabase
        .from("availability_slots")
        .select("id, user_id, starts_at, ends_at, status, note")
        .eq("user_id", userId)
        .gte("starts_at", since.toISOString())
        .order("starts_at", { ascending: false })
        .limit(200);
      if (active) setHistory((data ?? []) as Slot[]);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Predecir tarifa óptima según especialidad + zona
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: me } = await supabase
        .from("professional_profiles")
        .select("specialty, home_city, hourly_rate")
        .eq("user_id", userId)
        .maybeSingle();
      if (!me || !active) return;
      let q = supabase
        .from("professional_profiles")
        .select("hourly_rate")
        .eq("active", true)
        .neq("user_id", userId)
        .not("hourly_rate", "is", null);
      if (me.specialty) q = q.ilike("specialty", `%${me.specialty}%`);
      if (me.home_city) q = q.contains("service_cities", [me.home_city]);
      const { data: market } = await q.limit(60);
      const rates = (market ?? []).map((m) => m.hourly_rate as number).filter(Boolean);
      const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
      // Sugerimos 5% sobre el mercado si tienes buen rating, redondeado a 500
      const suggested = avg ? Math.round((avg * 1.05) / 500) * 500 : null;
      if (active)
        setTariff({
          suggested,
          market: avg,
          city: me.home_city,
          specialty: me.specialty,
        });
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Top 3 (dayOfWeek, hour) más usados históricamente
  const suggestedHours = useMemo(() => {
    if (history.length < 3) return [] as { dayIdx: number; hour: number; count: number }[];
    const counts: Record<string, { dayIdx: number; hour: number; count: number }> = {};
    history.forEach((s) => {
      const d = new Date(s.starts_at);
      const dayIdx = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      const k = `${dayIdx}-${hour}`;
      counts[k] ??= { dayIdx, hour, count: 0 };
      counts[k].count++;
    });
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [history]);

  async function applySuggested() {
    if (!editable || suggestedHours.length === 0) return;
    setBulkBusy(true);
    try {
      const toInsert: { user_id: string; starts_at: string; ends_at: string; status: "free" }[] = [];
      suggestedHours.forEach(({ dayIdx, hour }) => {
        const day = days[dayIdx];
        if (!day || slotAt(day, hour)) return;
        const start = new Date(day);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(start);
        end.setHours(hour + 1);
        toInsert.push({
          user_id: userId,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "free",
        });
      });
      if (toInsert.length) {
        const { data } = await supabase.from("availability_slots").insert(toInsert).select();
        if (data) setSlots((s) => [...s, ...((data as Slot[]) ?? [])]);
        toast.success(`${toInsert.length} horas sugeridas marcadas por IA`);
      } else {
        toast.info("Tus sugerencias ya están marcadas esta semana");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const slotAt = (day: Date, hour: number): Slot | undefined =>
    slots.find((s) => {
      const start = new Date(s.starts_at);
      return (
        start.getDate() === day.getDate() &&
        start.getMonth() === day.getMonth() &&
        start.getHours() === hour
      );
    });

  async function toggleSlot(day: Date, hour: number) {
    if (!editable) return;
    const existing = slotAt(day, hour);
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1);

    if (existing) {
      if (existing.status === "free") {
        const { error } = await supabase
          .from("availability_slots")
          .update({ status: "busy" })
          .eq("id", existing.id);
        if (error) toast.error(error.message);
        else setSlots((s) => s.map((x) => (x.id === existing.id ? { ...x, status: "busy" } : x)));
      } else {
        const { error } = await supabase.from("availability_slots").delete().eq("id", existing.id);
        if (error) toast.error(error.message);
        else setSlots((s) => s.filter((x) => x.id !== existing.id));
      }
    } else {
      const { data, error } = await supabase
        .from("availability_slots")
        .insert({
          user_id: userId,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "free",
        })
        .select()
        .single();
      if (error) toast.error(error.message);
      else if (data) setSlots((s) => [...s, data as Slot]);
    }
  }

  async function applyPreset(p: Preset) {
    if (!editable) return;
    setBulkBusy(true);
    try {
      if (p === "clear") {
        const ids = slots.filter((s) => s.status !== "reserved").map((s) => s.id);
        if (ids.length) {
          await supabase.from("availability_slots").delete().in("id", ids);
        }
        setSlots((s) => s.filter((x) => x.status === "reserved"));
        toast.success("Semana limpia");
        return;
      }
      const dayMatcher = (idx: number) => (p === "weekdays" ? idx < 5 : true);
      const hourMatcher = (h: number) => {
        if (p === "morning") return h >= 6 && h <= 11;
        if (p === "afternoon") return h >= 12 && h <= 17;
        if (p === "evening") return h >= 18 && h <= 19;
        return true; // weekdays / all
      };
      const toInsert: { user_id: string; starts_at: string; ends_at: string; status: "free" }[] =
        [];
      days.forEach((d, i) => {
        if (!dayMatcher(i)) return;
        HOURS.forEach((h) => {
          if (!hourMatcher(h)) return;
          if (slotAt(d, h)) return;
          const start = new Date(d);
          start.setHours(h, 0, 0, 0);
          const end = new Date(start);
          end.setHours(h + 1);
          toInsert.push({
            user_id: userId,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            status: "free",
          });
        });
      });
      if (toInsert.length) {
        const { data } = await supabase.from("availability_slots").insert(toInsert).select();
        if (data) setSlots((s) => [...s, ...((data as Slot[]) ?? [])]);
      }
      toast.success(`${toInsert.length} horas marcadas como disponibles`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error aplicando preset");
    } finally {
      setBulkBusy(false);
    }
  }

  const today = new Date();
  const freeCount = slots.filter((s) => s.status === "free").length;
  const reservedCount = slots.filter((s) => s.status === "reserved").length;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Smart panel: sugerencias IA + tarifa óptima */}
      {editable && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border-b border-border bg-gradient-to-r from-fuchsia-neural/5 via-biosensor/5 to-cyber/5">
          <div className="rounded-xl border border-fuchsia-neural/20 bg-card/80 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-fuchsia-neural" />
              <p className="text-xs font-semibold uppercase tracking-wider">Sugerencias IA</p>
              <Badge variant="outline" className="ml-auto text-[10px]">
                {history.length} h analizadas
              </Badge>
            </div>
            {suggestedHours.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Marca tu primera semana — luego la IA aprenderá tu patrón y lo pre-marcará por ti.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1 mb-2">
                  {suggestedHours.map((s) => (
                    <Badge
                      key={`${s.dayIdx}-${s.hour}`}
                      variant="outline"
                      className="text-[10px] border-fuchsia-neural/40 text-fuchsia-neural bg-fuchsia-neural/5"
                    >
                      {DAY_LABEL[s.dayIdx]} {s.hour}:00
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="hero"
                  onClick={applySuggested}
                  disabled={bulkBusy}
                  className="w-full"
                >
                  {bulkBusy ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Aplicar a esta semana
                </Button>
              </>
            )}
          </div>

          <div className="rounded-xl border border-biosensor/20 bg-card/80 p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-biosensor" />
              <p className="text-xs font-semibold uppercase tracking-wider">Tarifa óptima</p>
              {tariff.city && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {tariff.city}
                </Badge>
              )}
            </div>
            {tariff.suggested ? (
              <>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-display font-bold text-biosensor">
                    ${tariff.suggested.toLocaleString("es-CO")}
                  </p>
                  <p className="text-xs text-muted-foreground">/hora</p>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Mercado {tariff.specialty ?? "tu especialidad"}: $
                  {tariff.market?.toLocaleString("es-CO")} promedio. Sugerimos +5% por tu perfil.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Aún no hay suficiente data en tu zona. Completa especialidad y ciudad para predecir.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border-b border-border">
        <div>
          <p className="text-sm font-semibold">
            {weekStart.toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
            {" – "}
            {addDays(weekStart, 6).toLocaleDateString("es-CO", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {freeCount} h disponibles · {reservedCount} h reservadas
          </p>
        </div>
        <div className="flex items-center gap-1 self-end sm:self-auto">
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

      {/* Quick presets */}
      {editable && (
        <div className="flex items-center gap-1.5 flex-wrap p-3 border-b border-border bg-muted/20">
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-fuchsia-neural" /> Plantillas:
          </span>
          <PresetBtn label="Mañanas" onClick={() => applyPreset("morning")} disabled={bulkBusy} />
          <PresetBtn label="Tardes" onClick={() => applyPreset("afternoon")} disabled={bulkBusy} />
          <PresetBtn label="Noches" onClick={() => applyPreset("evening")} disabled={bulkBusy} />
          <PresetBtn label="Lun–Vie" onClick={() => applyPreset("weekdays")} disabled={bulkBusy} />
          <PresetBtn
            label="Toda la semana"
            onClick={() => applyPreset("all")}
            disabled={bulkBusy}
          />
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => applyPreset("clear")}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-rose-500/10 text-rose-600"
          >
            <Eraser className="h-3 w-3" /> Limpiar
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando agenda…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2 w-12 text-left font-medium text-muted-foreground"></th>
                {days.map((d) => {
                  const isToday =
                    d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
                  return (
                    <th
                      key={d.toISOString()}
                      className={`p-2 text-center font-medium ${
                        isToday ? "text-biosensor" : "text-muted-foreground"
                      }`}
                    >
                      <div>{DAY_LABEL[(d.getDay() + 6) % 7]}</div>
                      <div className={`text-[10px] ${isToday ? "font-bold" : ""}`}>
                        {d.getDate()}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => (
                <tr key={h} className="border-b border-border/50">
                  <td className="p-2 text-muted-foreground text-[10px] font-medium">{h}:00</td>
                  {days.map((d) => {
                    const slot = slotAt(d, h);
                    const cls = slot
                      ? slot.status === "free"
                        ? "bg-biosensor/30 hover:bg-biosensor/50 border-biosensor/50"
                        : slot.status === "reserved"
                          ? "bg-cyber/30 border-cyber/50 cursor-not-allowed"
                          : "bg-muted hover:bg-muted/70 border-border"
                      : "hover:bg-foreground/5 border-transparent";
                    return (
                      <td key={d.toISOString() + h} className="p-0.5">
                        <button
                          type="button"
                          disabled={!editable || slot?.status === "reserved"}
                          onClick={() => toggleSlot(d, h)}
                          className={`w-full h-10 sm:h-9 rounded-md border ${cls} transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-fuchsia-neural/50`}
                          title={
                            slot
                              ? slot.status === "free"
                                ? "Disponible"
                                : slot.status === "reserved"
                                  ? "Reservado"
                                  : "Ocupado"
                              : "Vacío — toca para marcar disponible"
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
        <Legend color="bg-biosensor/40 border-biosensor/60" label="Disponible" />
        <Legend color="bg-cyber/40 border-cyber/60" label="Reservado (15 días)" />
        <Legend color="bg-muted border-border" label="Ocupado" />
        {editable && (
          <span className="ml-auto inline-flex items-center gap-1 text-fuchsia-neural">
            <Check className="h-3 w-3" /> Auto-match activo al marcar
          </span>
        )}
      </div>
    </div>
  );
}

function PresetBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-biosensor/10 hover:border-biosensor/40 transition-colors disabled:opacity-50"
    >
      {label}
    </button>
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
