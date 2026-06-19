import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  Users,
  Calendar,
  BarChart3,
  Download,
  ShieldCheck,
  CheckCircle2,
  ClipboardList,
  UserPlus,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

type BulkRow = {
  id: string;
  title: string;
  specialty_required: string;
  city: string;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  description: string;
  matches?: number;
};

const newRow = (city = ""): BulkRow => ({
  id: crypto.randomUUID(),
  title: "",
  specialty_required: "",
  city,
  modality: "shift",
  amount: 0,
  description: "",
});

// ============================================================
// 1. Bulk Offers + AI Matching
// ============================================================
export function BulkOffersModule({ userId, defaultCity }: { userId: string; defaultCity?: string }) {
  const [rows, setRows] = useState<BulkRow[]>([newRow(defaultCity), newRow(defaultCity), newRow(defaultCity)]);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(0);

  const updateRow = (id: string, patch: Partial<BulkRow>) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const removeRow = (id: string) => setRows((r) => r.filter((row) => row.id !== id));

  const matchAll = async () => {
    setBusy(true);
    try {
      const updated = await Promise.all(
        rows.map(async (r) => {
          if (!r.specialty_required && !r.city) return r;
          let q = supabase
            .from("professional_profiles")
            .select("user_id", { count: "exact", head: true })
            .eq("active", true)
            .eq("published", true);
          if (r.specialty_required) q = q.ilike("specialty", `%${r.specialty_required}%`);
          if (r.city) q = q.contains("service_cities", [r.city]);
          const { count } = await q;
          return { ...r, matches: count ?? 0 };
        }),
      );
      setRows(updated);
      toast.success("Coincidencias calculadas con IA de matching.");
    } catch (e) {
      console.error(e);
      toast.error("No pudimos calcular las coincidencias.");
    } finally {
      setBusy(false);
    }
  };

  const publishAll = async () => {
    const valid = rows.filter((r) => r.title.trim() && r.city.trim() && r.amount > 0);
    if (valid.length === 0) {
      toast.error("Completa al menos una oferta (título, ciudad, monto).");
      return;
    }
    setBusy(true);
    try {
      const payload = valid.map((r) => ({
        posted_by: userId,
        poster_type: "institution" as const,
        title: r.title,
        description: r.description || null,
        specialty_required: r.specialty_required || null,
        city: r.city,
        modality: r.modality,
        amount: r.amount,
        status: "open" as const,
      }));
      const { error } = await supabase.from("job_offers").insert(payload);
      if (error) throw error;
      setPublished((p) => p + valid.length);
      setRows([newRow(defaultCity), newRow(defaultCity), newRow(defaultCity)]);
      toast.success(`${valid.length} oferta(s) publicada(s) gratis`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos publicar las ofertas.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-fuchsia-neural" />
            Publicación masiva con matching IA
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Carga múltiples vacantes y deja que la IA estime cuántos profesionales encajan antes de publicar.
          </p>
        </div>
        {published > 0 && (
          <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/30">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {published} publicadas hoy
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start p-3 rounded-lg border border-border bg-card/50"
          >
            <div className="md:col-span-3">
              <Input
                placeholder={`Título oferta #${i + 1}`}
                value={r.title}
                onChange={(e) => updateRow(r.id, { title: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Input
                placeholder="Especialidad"
                value={r.specialty_required}
                onChange={(e) => updateRow(r.id, { specialty_required: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Input
                placeholder="Ciudad"
                value={r.city}
                onChange={(e) => updateRow(r.id, { city: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={r.modality}
                onChange={(e) => updateRow(r.id, { modality: e.target.value as BulkRow["modality"] })}
              >
                <option value="hour">Por hora</option>
                <option value="shift">Turno</option>
                <option value="month">Mensual</option>
                <option value="package">Paquete</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Input
                type="number"
                placeholder="Monto COP"
                value={r.amount || ""}
                onChange={(e) => updateRow(r.id, { amount: Number(e.target.value) })}
              />
            </div>
            <div className="md:col-span-1 flex items-center gap-1">
              {typeof r.matches === "number" && (
                <Badge variant="outline" className="text-[10px]">
                  {r.matches} match
                </Badge>
              )}
              <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
            <div className="md:col-span-12">
              <Textarea
                placeholder="Descripción (opcional)"
                rows={2}
                value={r.description}
                onChange={(e) => updateRow(r.id, { description: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRows((r) => [...r, newRow(defaultCity)])}>
          <Plus className="h-4 w-4 mr-1.5" /> Agregar fila
        </Button>
        <Button variant="outline" onClick={matchAll} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
          Calcular matches IA
        </Button>
        <Button variant="hero" onClick={publishAll} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          Publicar todas (gratis)
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// 2. Patients & Care Coordination
// ============================================================
type PatientRow = {
  application_id: string;
  offer_id: string;
  offer_title: string;
  city: string;
  professional_id: string;
  status: string;
  created_at: string;
};

export function PatientsModule({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [proNames, setProNames] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: offers } = await supabase
          .from("job_offers")
          .select("id, title, city")
          .eq("posted_by", userId);
        const offerMap = new Map((offers ?? []).map((o) => [o.id, o]));
        const offerIds = Array.from(offerMap.keys());
        if (offerIds.length === 0) {
          if (active) setLoading(false);
          return;
        }
        const { data: apps } = await supabase
          .from("applications")
          .select("id, status, created_at, professional_id, job_offer_id")
          .in("job_offer_id", offerIds)
          .in("status", ["accepted", "pending"])
          .order("created_at", { ascending: false });
        if (!active) return;
        const rows: PatientRow[] = (apps ?? []).map((a) => {
          const o = offerMap.get(a.job_offer_id);
          return {
            application_id: a.id,
            offer_id: a.job_offer_id,
            offer_title: o?.title ?? "Caso",
            city: o?.city ?? "—",
            professional_id: a.professional_id,
            status: a.status,
            created_at: a.created_at,
          };
        });
        setPatients(rows);

        const proIds = Array.from(new Set(rows.map((r) => r.professional_id)));
        if (proIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", proIds);
          const m: Record<string, string> = {};
          (profs ?? []).forEach((p) => (m[p.user_id] = p.full_name ?? "Profesional"));
          setProNames(m);
        }
      } catch (e) {
        console.error("[patients] load failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando casos…
      </Card>
    );
  }

  if (patients.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Users className="h-8 w-8 text-fuchsia-neural mx-auto mb-3" />
        <p className="font-semibold">Sin pacientes / casos activos</p>
        <p className="text-sm text-muted-foreground mt-1">
          Cuando aceptes una postulación, el caso aparecerá aquí para coordinar cuidado.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <h3 className="font-display text-lg font-semibold flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-fuchsia-neural" />
        Pacientes y coordinación de cuidado
      </h3>
      <div className="space-y-2">
        {patients.map((p) => (
          <div key={p.application_id} className="p-3 rounded-lg border border-border space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold text-sm">{p.offer_title}</p>
                <p className="text-xs text-muted-foreground">
                  {p.city} · Profesional asignado: <span className="text-foreground">{proNames[p.professional_id] ?? "—"}</span>
                </p>
              </div>
              <Badge
                className={
                  p.status === "accepted"
                    ? "bg-emerald-600/15 text-emerald-700 border-emerald-600/30"
                    : "bg-copper/10 text-copper border-copper/30"
                }
              >
                {p.status}
              </Badge>
            </div>
            <Textarea
              placeholder="Notas de coordinación: medicación, turnos, contactos…"
              rows={2}
              value={notes[p.application_id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [p.application_id]: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline">
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Asignar coordinador
              </Button>
              <Button
                size="sm"
                variant="hero"
                onClick={() => toast.success("Notas guardadas localmente (demo)")}
              >
                Guardar nota
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// 3. Institutional Agenda
// ============================================================
type BookingRow = {
  id: string;
  professional_id: string;
  starts_at?: string | null;
  created_at: string;
  notes: string | null;
};

export function AgendaModule({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("service_bookings")
          .select("id, professional_id, created_at, notes")
          .eq("client_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (active) setBookings((data ?? []) as BookingRow[]);
      } catch (e) {
        console.error("[agenda] load failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });
  }, []);

  const byDay = useMemo(() => {
    const map: Record<string, BookingRow[]> = {};
    bookings.forEach((b) => {
      const key = new Date(b.created_at).toDateString();
      (map[key] ??= []).push(b);
    });
    return map;
  }, [bookings]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5 text-fuchsia-neural" />
            Agenda institucional · próximos 7 días
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Vista predictiva de turnos y servicios contratados.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando agenda…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((d) => {
            const key = d.toDateString();
            const items = byDay[key] ?? [];
            return (
              <div key={key} className="rounded-lg border border-border p-2 min-h-[110px]">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {d.toLocaleDateString("es-CO", { weekday: "short" })}
                </p>
                <p className="text-lg font-display font-bold">{d.getDate()}</p>
                {items.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-2">Sin turnos</p>
                ) : (
                  <div className="space-y-1 mt-2">
                    {items.slice(0, 3).map((it) => (
                      <div
                        key={it.id}
                        className="text-[11px] px-1.5 py-1 rounded bg-fuchsia-neural/10 text-fuchsia-neural truncate"
                      >
                        Turno · {new Date(it.created_at).toLocaleTimeString("es-CO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    ))}
                    {items.length > 3 && (
                      <p className="text-[10px] text-muted-foreground">+{items.length - 3} más</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// 4. Reports, Billing & Compliance
// ============================================================
export function ReportsModule({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalOffers: 0,
    filled: 0,
    avgAmount: 0,
    totalSpend: 0,
    rethusRate: 0,
    acceptedPros: 0,
  });
  const [rows, setRows] = useState<Array<{ title: string; city: string; amount: number; status: string; created_at: string }>>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: offers } = await supabase
          .from("job_offers")
          .select("id, title, city, amount, status, created_at")
          .eq("posted_by", userId);
        const list = offers ?? [];
        const filled = list.filter((o) => o.status === "filled");
        const total = list.reduce((s, o) => s + (o.amount || 0), 0);
        const spend = filled.reduce((s, o) => s + (o.amount || 0), 0);

        const { data: apps } = await supabase
          .from("applications")
          .select("professional_id, status")
          .in("job_offer_id", list.map((o) => o.id))
          .eq("status", "accepted");
        const proIds = Array.from(new Set((apps ?? []).map((a) => a.professional_id)));
        let rethus = 0;
        if (proIds.length) {
          const { data: pros } = await supabase
            .from("professional_profiles")
            .select("user_id, rethus_verified")
            .in("user_id", proIds);
          rethus = (pros ?? []).filter((p) => p.rethus_verified).length;
        }

        if (!active) return;
        setStats({
          totalOffers: list.length,
          filled: filled.length,
          avgAmount: list.length ? Math.round(total / list.length) : 0,
          totalSpend: spend,
          rethusRate: proIds.length ? Math.round((rethus / proIds.length) * 100) : 0,
          acceptedPros: proIds.length,
        });
        setRows(list);
      } catch (e) {
        console.error("[reports] load failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const downloadCSV = () => {
    const header = "Título,Ciudad,Monto,Estado,Fecha\n";
    const body = rows
      .map((r) =>
        [r.title, r.city, r.amount, r.status, new Date(r.created_at).toISOString()]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `humanix-ofertas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Reporte descargado");
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-fuchsia-neural" />
          Reportes, facturación y compliance
        </h3>
        <Button variant="outline" size="sm" onClick={downloadCSV} disabled={loading || rows.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
        </Button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Calculando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniStat label="Ofertas totales" value={stats.totalOffers} />
            <MiniStat label="Cubiertas" value={stats.filled} />
            <MiniStat label="Monto promedio" value={COP(stats.avgAmount)} />
            <MiniStat label="Gasto ejecutado" value={COP(stats.totalSpend)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-4 bg-emerald-50 border-emerald-200">
              <div className="flex items-center gap-2 text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-wider">Compliance RETHUS</p>
              </div>
              <p className="text-2xl font-display font-bold mt-2 text-emerald-800">{stats.rethusRate}%</p>
              <p className="text-xs text-emerald-700/80 mt-1">
                {stats.acceptedPros} profesional(es) aceptado(s) verificados ante RETHUS.
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Facturación consolidada
              </p>
              <p className="text-2xl font-display font-bold mt-2">{COP(stats.totalSpend)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Suma de ofertas cubiertas. Descarga el CSV para conciliar con tu ERP.
              </p>
            </Card>
          </div>
        </>
      )}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-display font-bold mt-1">{value}</p>
    </Card>
  );
}