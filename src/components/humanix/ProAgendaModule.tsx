// @ts-nocheck
/**
 * ProAgendaModule — Agenda premium para profesional de salud
 *
 * - Acordeón inteligente agrupado por día (Hoy / Mañana / Esta semana / Próximas)
 * - Registro de signos vitales por turno (FC, SpO2, PA, Temp, FR, Glucosa, Peso)
 * - Notas de enfermería asistidas por IA (formato SOAP)
 * - Compartir resumen con familia o EPS/IPS vía notificación + enlace
 * - Acciones de estado: Llegar, Iniciar, Completar, Reportar no-show
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Heart,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Share2,
  Sparkles,
  Thermometer,
  User,
  Wind,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { humanixAi } from "@/lib/humanixAi";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type BookingStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "no_show"
  | "cancelled";

type FullBooking = {
  id: string;
  scheduled_at: string;
  status: BookingStatus;
  notes: string | null;
  duration_hours: number;
  hourly_rate: number;
  total_amount: number;
  service_address: string | null;
  emergency_phone: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  client_id: string;
  job_offer_id: string | null;
  // enriched
  client_name: string | null;
  client_avatar: string | null;
  client_phone: string | null;
  client_email: string | null;
  offer_title: string | null;
  city: string | null;
};

type VitalEntry = {
  fc: string;
  spo2: string;
  pas: string;
  pad: string;
  temp: string;
  fr: string;
  glucosa: string;
  peso: string;
  obs: string;
};

const EMPTY_VITALS: VitalEntry = {
  fc: "",
  spo2: "",
  pas: "",
  pad: "",
  temp: "",
  fr: "",
  glucosa: "",
  peso: "",
  obs: "",
};

type VitalReading = {
  id: string;
  reading_type: string;
  value: number;
  value_secondary: number | null;
  unit: string | null;
  severity: string;
  notes: string | null;
  recorded_at: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (iso: string, opts?: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString(
    "es-CO",
    opts ?? { weekday: "long", day: "numeric", month: "long" },
  );

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

function startOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(iso: string) {
  return startOf(new Date(iso)).toISOString().slice(0, 10);
}

function groupLabel(key: string): string {
  const today = startOf(new Date()).toISOString().slice(0, 10);
  const tomorrow = startOf(new Date(Date.now() + 86400000))
    .toISOString()
    .slice(0, 10);
  if (key === today) return "🟢 Hoy";
  if (key === tomorrow) return "📅 Mañana";
  const d = new Date(key + "T12:00:00");
  const thisWeekEnd = new Date(Date.now() + 6 * 86400000);
  if (d <= thisWeekEnd) return "📆 Esta semana";
  return `📌 ${fmtDate(key + "T12:00:00", { day: "numeric", month: "long" })}`;
}

function statusMeta(s: BookingStatus) {
  return (
    (
      {
        scheduled: {
          label: "Programado",
          cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
        },
        confirmed: {
          label: "Confirmado",
          cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        },
        in_progress: {
          label: "En curso",
          cls: "bg-biosensor/10 text-biosensor border-biosensor/20",
        },
        completed: {
          label: "Completado",
          cls: "bg-slate-500/10 text-slate-500 border-slate-500/20",
        },
        no_show: { label: "No presentó", cls: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
        cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground border-border" },
      } as Record<BookingStatus, { label: string; cls: string }>
    )[s] ?? { label: s, cls: "bg-muted text-muted-foreground border-border" }
  );
}

function vitalSeverity(type: string, val: number): "normal" | "warning" | "critical" {
  if (type === "heart_rate") {
    if (val < 50 || val > 120) return "critical";
    if (val < 60 || val > 100) return "warning";
  }
  if (type === "spo2") {
    if (val < 90) return "critical";
    if (val < 94) return "warning";
  }
  if (type === "temperature") {
    if (val < 35 || val > 39.5) return "critical";
    if (val < 36 || val > 38) return "warning";
  }
  if (type === "blood_pressure_systolic") {
    if (val < 80 || val > 180) return "critical";
    if (val < 90 || val > 140) return "warning";
  }
  return "normal";
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProAgendaModule({ userId }: { userId: string }) {
  const [bookings, setBookings] = useState<FullBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"upcoming" | "today" | "past">("upcoming");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [savingVitals, setSavingVitals] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  // Per-booking transient state
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [vitals, setVitals] = useState<Record<string, VitalEntry>>({});
  const [vitalHistory, setVitalHistory] = useState<Record<string, VitalReading[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<Record<string, boolean>>({});

  // ── Load bookings ──────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const past = filter === "past";
      const today = filter === "today";

      let query = (supabase as any)
        .from("service_bookings")
        .select(
          "id,scheduled_at,status,notes,duration_hours,hourly_rate,total_amount,service_address,emergency_phone,arrived_at,started_at,completed_at,client_id,job_offer_id",
        )
        .eq("professional_id", userId)
        .order("scheduled_at", { ascending: !past });

      if (past) {
        query = query
          .lt("scheduled_at", now.toISOString())
          .in("status", ["completed", "no_show", "cancelled"]);
      } else if (today) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        query = query
          .gte("scheduled_at", todayStart.toISOString())
          .lte("scheduled_at", todayEnd.toISOString());
      } else {
        query = query
          .gte("scheduled_at", now.toISOString())
          .in("status", ["scheduled", "confirmed", "in_progress"])
          .limit(30);
      }

      const { data: raw, error } = await query;
      if (error) throw error;
      if (!raw?.length) {
        setBookings([]);
        return;
      }

      const clientIds = [...new Set(raw.map((b: any) => b.client_id))];
      const offerIds = [...new Set(raw.map((b: any) => b.job_offer_id).filter(Boolean))];

      const [clients, offersRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id,full_name,avatar_url,phone,email")
          .in("user_id", clientIds),
        offerIds.length
          ? supabase
              .from("job_offers")
              .select("id,title,city")
              .in("id", offerIds as string[])
          : Promise.resolve({ data: [] }),
      ]);

      const cMap = new Map((clients.data ?? []).map((c: any) => [c.user_id, c]));
      const oMap = new Map((offersRes.data ?? []).map((o: any) => [o.id, o]));

      const enriched: FullBooking[] = raw.map((b: any) => {
        const c = cMap.get(b.client_id) as any;
        const o = b.job_offer_id ? (oMap.get(b.job_offer_id) as any) : undefined;
        return {
          ...b,
          client_name: c?.full_name ?? null,
          client_avatar: c?.avatar_url ?? null,
          client_phone: c?.phone ?? null,
          client_email: c?.email ?? null,
          offer_title: o?.title ?? null,
          city: o?.city ?? null,
        };
      });

      setBookings(enriched);
      // Pre-fill notes state
      const notesInit: Record<string, string> = {};
      enriched.forEach((b) => {
        notesInit[b.id] = b.notes ?? "";
      });
      setNotes((prev) => ({ ...notesInit, ...prev }));
    } catch (err: any) {
      toast.error("Error cargando agenda: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [userId, filter]);

  // ── Vital history per booking ──────────────────────────────────────────────
  const loadVitalHistory = async (bookingId: string, clientId: string) => {
    if (vitalHistory[bookingId] !== undefined) return;
    setLoadingHistory((p) => ({ ...p, [bookingId]: true }));
    try {
      const { data } = await (supabase as any)
        .from("vital_signs_readings")
        .select("id,reading_type,value,value_secondary,unit,severity,notes,recorded_at")
        .eq("family_user_id", clientId)
        .order("recorded_at", { ascending: false })
        .limit(20);
      setVitalHistory((p) => ({ ...p, [bookingId]: data ?? [] }));
    } finally {
      setLoadingHistory((p) => ({ ...p, [bookingId]: false }));
    }
  };

  // ── Toggle accordion ───────────────────────────────────────────────────────
  const toggle = (id: string, clientId: string) => {
    const next = new Set(openIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      loadVitalHistory(id, clientId);
    }
    setOpenIds(next);
  };

  // ── Save nursing note ──────────────────────────────────────────────────────
  const saveNote = async (bookingId: string) => {
    setSavingNote(bookingId);
    try {
      const { error } = await (supabase as any)
        .from("service_bookings")
        .update({ notes: notes[bookingId] ?? "" })
        .eq("id", bookingId);
      if (error) throw error;
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, notes: notes[bookingId] ?? "" } : b)),
      );
      toast.success("Nota guardada");
    } catch (err: any) {
      toast.error("Error guardando nota: " + err.message);
    } finally {
      setSavingNote(null);
    }
  };

  // ── AI-assisted nursing note ───────────────────────────────────────────────
  const aiAssistNote = async (bookingId: string, booking: FullBooking) => {
    const raw = (notes[bookingId] ?? "").trim();
    if (!raw) {
      toast.error("Escribe primero algunos apuntes para que la IA los estructure.");
      return;
    }
    setAiLoadingId(bookingId);
    try {
      const history = (vitalHistory[bookingId] ?? []).slice(0, 5);
      const vitalsSummary = history
        .map((v) => `${v.reading_type}: ${v.value}${v.unit ?? ""}`)
        .join(", ");
      const prompt = `Eres un asistente clínico. Convierte estas notas en formato SOAP (Subjetivo, Objetivo, Análisis, Plan) en español claro y conciso. Paciente: ${booking.client_name ?? "sin nombre"}. Servicio: ${booking.offer_title ?? "visita domiciliaria"}. Signos vitales recientes: ${vitalsSummary || "sin registro"}. Notas del profesional: "${raw}"`;
      const structured = (
        await humanixAi.assistant({
          messages: [{ role: "user", content: prompt }],
          persona: "professional",
        })
      ).trim();
      if (structured) {
        setNotes((p) => ({ ...p, [bookingId]: structured }));
        toast.success("✨ Nota estructurada en formato SOAP");
      }
    } catch (err: any) {
      toast.error("Error con IA: " + err.message);
    } finally {
      setAiLoadingId(null);
    }
  };

  // ── Save vital signs ───────────────────────────────────────────────────────
  const saveVitals = async (bookingId: string, booking: FullBooking) => {
    const v = vitals[bookingId] ?? EMPTY_VITALS;
    const entries: {
      reading_type: string;
      value: number;
      value_secondary?: number;
      unit: string;
      severity: string;
      notes?: string;
    }[] = [];

    if (v.fc)
      entries.push({
        reading_type: "heart_rate",
        value: +v.fc,
        unit: "bpm",
        severity: vitalSeverity("heart_rate", +v.fc),
        notes: v.obs || undefined,
      });
    if (v.spo2)
      entries.push({
        reading_type: "spo2",
        value: +v.spo2,
        unit: "%",
        severity: vitalSeverity("spo2", +v.spo2),
      });
    if (v.pas && v.pad)
      entries.push({
        reading_type: "blood_pressure_systolic",
        value: +v.pas,
        value_secondary: +v.pad,
        unit: "mmHg",
        severity: vitalSeverity("blood_pressure_systolic", +v.pas),
      });
    if (v.temp)
      entries.push({
        reading_type: "temperature",
        value: +v.temp,
        unit: "°C",
        severity: vitalSeverity("temperature", +v.temp),
      });
    if (v.fr)
      entries.push({
        reading_type: "respiratory_rate",
        value: +v.fr,
        unit: "rpm",
        severity: "normal",
      });
    if (v.glucosa)
      entries.push({
        reading_type: "blood_glucose",
        value: +v.glucosa,
        unit: "mg/dL",
        severity: +v.glucosa > 180 || +v.glucosa < 70 ? "warning" : "normal",
      });
    if (v.peso)
      entries.push({ reading_type: "weight", value: +v.peso, unit: "kg", severity: "normal" });

    if (!entries.length) {
      toast.error("Ingresa al menos un signo vital.");
      return;
    }

    setSavingVitals(bookingId);
    try {
      const rows = entries.map((e) => ({
        ...e,
        family_user_id: booking.client_id,
        recorded_by: userId,
        source: "professional_visit",
        recorded_at: new Date().toISOString(),
        patient_label: booking.client_name ?? null,
      }));
      const { error } = await (supabase as any).from("vital_signs_readings").insert(rows);
      if (error) throw error;
      // Append to local history
      const newHistory: VitalReading[] = rows.map((r, i) => ({
        id: `tmp-${i}-${Date.now()}`,
        reading_type: r.reading_type,
        value: r.value,
        value_secondary: r.value_secondary ?? null,
        unit: r.unit,
        severity: r.severity,
        notes: r.notes ?? null,
        recorded_at: r.recorded_at,
      }));
      setVitalHistory((p) => ({ ...p, [bookingId]: [...newHistory, ...(p[bookingId] ?? [])] }));
      setVitals((p) => ({ ...p, [bookingId]: EMPTY_VITALS }));
      // Check critical
      const critical = entries.filter((e) => e.severity === "critical");
      if (critical.length) {
        toast.error(
          `⚠️ Valor crítico detectado: ${critical.map((e) => e.reading_type).join(", ")}. Considera escalar a EPS/IPS.`,
          { duration: 6000 },
        );
      } else {
        toast.success("Signos vitales registrados");
      }
    } catch (err: any) {
      toast.error("Error guardando signos vitales: " + err.message);
    } finally {
      setSavingVitals(null);
    }
  };

  // ── Status actions ─────────────────────────────────────────────────────────
  const updateStatus = async (bookingId: string, newStatus: BookingStatus) => {
    setStatusLoading(bookingId + newStatus);
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "in_progress") updates.started_at = new Date().toISOString();
    if (newStatus === "completed") updates.completed_at = new Date().toISOString();
    if (newStatus === "confirmed") updates.arrived_at = new Date().toISOString();
    try {
      const { error } = await (supabase as any)
        .from("service_bookings")
        .update(updates)
        .eq("id", bookingId);
      if (error) throw error;
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, ...updates, status: newStatus } : b)),
      );
      const labels: Record<BookingStatus, string> = {
        confirmed: "Llegada registrada ✓",
        in_progress: "Turno iniciado ✓",
        completed: "Turno completado ✓",
        no_show: "No-show reportado",
        scheduled: "",
        cancelled: "",
      };
      toast.success(labels[newStatus] ?? "Estado actualizado");
    } catch (err: any) {
      toast.error("Error actualizando estado: " + err.message);
    } finally {
      setStatusLoading(null);
    }
  };

  // ── Share summary ──────────────────────────────────────────────────────────
  const shareSummary = async (booking: FullBooking) => {
    setSharingId(booking.id);
    const history = vitalHistory[booking.id] ?? [];
    const vitalLines = history
      .slice(0, 6)
      .map(
        (v) =>
          `• ${v.reading_type.replace(/_/g, " ")}: ${v.value}${v.unit ?? ""}${v.value_secondary ? `/${v.value_secondary}` : ""}`,
      )
      .join("\n");
    const text = `📋 *Resumen de visita — Humanix*\n👤 Paciente: ${booking.client_name ?? "—"}\n📍 ${booking.city ?? booking.service_address ?? "—"}\n🕐 ${fmtDate(booking.scheduled_at)} ${fmtTime(booking.scheduled_at)}\n\n🩺 *Signos vitales:*\n${vitalLines || "Sin registro aún"}\n\n📝 *Notas:*\n${notes[booking.id] || booking.notes || "Sin notas"}\n\n✅ Estado: ${statusMeta(booking.status).label}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Resumen de visita · Humanix", text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("Resumen copiado al portapapeles");
      }
      // Also trigger in-app notification to client
      await (supabase as any)
        .from("notifications")
        .insert({
          user_id: booking.client_id,
          type: "visit_summary",
          title: "Resumen de visita disponible",
          body: `${booking.offer_title ?? "Tu profesional"} ha compartido el resumen de la visita del ${fmtDate(booking.scheduled_at)}.`,
          data: { booking_id: booking.id },
        })
        .then(() => {})
        .catch(() => {});
    } catch {
      /* share cancelled */
    }
    setSharingId(null);
  };

  // ── Grouping ───────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, FullBooking[]>();
    bookings.forEach((b) => {
      const k = dayKey(b.scheduled_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    });
    return Array.from(map.entries()).sort(([a], [b]) =>
      filter === "past" ? b.localeCompare(a) : a.localeCompare(b),
    );
  }, [bookings, filter]);

  // ─────────────────────────────────────────────────────────────────────────
  const todayCount = bookings.filter(
    (b) => dayKey(b.scheduled_at) === startOf(new Date()).toISOString().slice(0, 10),
  ).length;
  const inProgressCount = bookings.filter((b) => b.status === "in_progress").length;

  return (
    <div className="space-y-4">
      {/* ── Header stats ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border bg-card/95 p-3 text-center">
          <p className="text-xl font-bold text-biosensor">{todayCount}</p>
          <p className="text-[10px] text-muted-foreground">Hoy</p>
        </div>
        <div className="rounded-2xl border border-border bg-card/95 p-3 text-center">
          <p className="text-xl font-bold">{bookings.length}</p>
          <p className="text-[10px] text-muted-foreground">
            {filter === "past" ? "Historial" : "Próximos"}
          </p>
        </div>
        <div
          className={cn(
            "rounded-2xl border p-3 text-center",
            inProgressCount > 0 ? "border-biosensor/30 bg-biosensor/5" : "border-border bg-card/95",
          )}
        >
          <p className={cn("text-xl font-bold", inProgressCount > 0 ? "text-biosensor" : "")}>
            {inProgressCount}
          </p>
          <p className="text-[10px] text-muted-foreground">En curso</p>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-xl">
        {(["today", "upcoming", "past"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all",
              filter === f
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "today" ? "Hoy" : f === "upcoming" ? "Próximas" : "Historial"}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/95 p-8 text-center space-y-3">
          <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold">
            Sin turnos{" "}
            {filter === "today" ? "hoy" : filter === "past" ? "en historial" : "próximos"}
          </p>
          <p className="text-xs text-muted-foreground">
            {filter === "upcoming"
              ? "Aplica a ofertas o espera que te contraten."
              : "Los turnos completados aparecerán aquí."}
          </p>
        </div>
      ) : (
        grouped.map(([dateKey, dayBookings]) => (
          <div key={dateKey} className="space-y-2">
            {/* Day header */}
            <div className="flex items-center gap-2 px-1">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                {groupLabel(dateKey)}
              </p>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground">
                {dayBookings.length} turno{dayBookings.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Booking cards */}
            {dayBookings.map((booking) => {
              const isOpen = openIds.has(booking.id);
              const sm = statusMeta(booking.status);
              const bVitals = vitals[booking.id] ?? EMPTY_VITALS;
              const bNotes = notes[booking.id] ?? "";
              const bHistory = vitalHistory[booking.id] ?? [];

              return (
                <Collapsible
                  key={booking.id}
                  open={isOpen}
                  onOpenChange={() => toggle(booking.id, booking.client_id)}
                >
                  {/* Accordion header */}
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "w-full rounded-2xl border bg-card/95 p-4 text-left transition-all hover:border-biosensor/30 active:scale-[0.99]",
                        isOpen ? "border-biosensor/30 rounded-b-none" : "border-border",
                        booking.status === "in_progress" && "border-biosensor/40 bg-biosensor/5",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        {booking.client_avatar ? (
                          <img
                            src={booking.client_avatar}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover shrink-0 border-2 border-border"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-biosensor/10 border-2 border-biosensor/20 flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-biosensor" />
                          </div>
                        )}

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold truncate">
                              {booking.offer_title ?? "Visita domiciliaria"}
                            </p>
                            <span
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0",
                                sm.cls,
                              )}
                            >
                              {sm.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {booking.client_name ?? "Paciente"}
                            {booking.city ? ` · ${booking.city}` : ""}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {fmtTime(booking.scheduled_at)}
                            </span>
                            <span className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {booking.duration_hours}h
                            </span>
                            <span className="font-semibold text-emerald-600">
                              {COP(booking.total_amount)}
                            </span>
                          </div>
                        </div>

                        {/* Chevron */}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  {/* Accordion body */}
                  <CollapsibleContent>
                    <div className="border border-t-0 border-biosensor/20 rounded-b-2xl bg-card/95 divide-y divide-border">
                      {/* ── Client contact ── */}
                      <div className="p-4 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Contacto
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {booking.client_phone && (
                            <a
                              href={`tel:${booking.client_phone}`}
                              className="flex items-center gap-1.5 text-xs font-medium text-biosensor border border-biosensor/30 rounded-lg px-3 py-1.5 hover:bg-biosensor/5 transition-colors"
                            >
                              <Phone className="h-3.5 w-3.5" /> {booking.client_phone}
                            </a>
                          )}
                          {booking.emergency_phone && (
                            <a
                              href={`tel:${booking.emergency_phone}`}
                              className="flex items-center gap-1.5 text-xs font-medium text-rose-600 border border-rose-500/30 rounded-lg px-3 py-1.5 hover:bg-rose-500/5 transition-colors"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" /> Emergencia
                            </a>
                          )}
                          {booking.service_address && (
                            <a
                              href={`https://maps.google.com?q=${encodeURIComponent(booking.service_address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/30 transition-colors"
                            >
                              <MapPin className="h-3.5 w-3.5" /> {booking.service_address}
                            </a>
                          )}
                        </div>
                      </div>

                      {/* ── Status actions ── */}
                      {["scheduled", "confirmed", "in_progress"].includes(booking.status) && (
                        <div className="p-4 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Gestión del turno
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {booking.status === "scheduled" && (
                              <Button
                                size="sm"
                                variant="glass"
                                disabled={statusLoading === booking.id + "confirmed"}
                                onClick={() => updateStatus(booking.id, "confirmed")}
                              >
                                {statusLoading === booking.id + "confirmed" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                )}
                                Llegué
                              </Button>
                            )}
                            {booking.status === "confirmed" && (
                              <Button
                                size="sm"
                                variant="hero"
                                disabled={statusLoading === booking.id + "in_progress"}
                                onClick={() => updateStatus(booking.id, "in_progress")}
                              >
                                {statusLoading === booking.id + "in_progress" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <Zap className="h-3.5 w-3.5 mr-1" />
                                )}
                                Iniciar turno
                              </Button>
                            )}
                            {booking.status === "in_progress" && (
                              <Button
                                size="sm"
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                disabled={statusLoading === booking.id + "completed"}
                                onClick={() => updateStatus(booking.id, "completed")}
                              >
                                {statusLoading === booking.id + "completed" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                )}
                                Completar turno
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-500 hover:bg-rose-500/10"
                              disabled={statusLoading === booking.id + "no_show"}
                              onClick={() => updateStatus(booking.id, "no_show")}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" /> No-show
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* ── Vital signs ── */}
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <Heart className="h-3.5 w-3.5 text-rose-500" /> Signos vitales
                          </p>
                          {bHistory.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {bHistory.length} registro{bHistory.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Input grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            {
                              key: "fc",
                              label: "FC",
                              unit: "bpm",
                              icon: <Heart className="h-3 w-3 text-rose-500" />,
                              placeholder: "72",
                            },
                            {
                              key: "spo2",
                              label: "SpO₂",
                              unit: "%",
                              icon: <Activity className="h-3 w-3 text-biosensor" />,
                              placeholder: "98",
                            },
                            {
                              key: "pas",
                              label: "PA Sistólica",
                              unit: "mmHg",
                              icon: <Zap className="h-3 w-3 text-amber-500" />,
                              placeholder: "120",
                            },
                            {
                              key: "pad",
                              label: "PA Diastólica",
                              unit: "mmHg",
                              icon: <Zap className="h-3 w-3 text-amber-400" />,
                              placeholder: "80",
                            },
                            {
                              key: "temp",
                              label: "Temperatura",
                              unit: "°C",
                              icon: <Thermometer className="h-3 w-3 text-orange-500" />,
                              placeholder: "36.5",
                            },
                            {
                              key: "fr",
                              label: "Frec. Resp.",
                              unit: "rpm",
                              icon: <Wind className="h-3 w-3 text-teal-500" />,
                              placeholder: "16",
                            },
                            {
                              key: "glucosa",
                              label: "Glucosa",
                              unit: "mg/dL",
                              icon: <Zap className="h-3 w-3 text-fuchsia-neural" />,
                              placeholder: "100",
                            },
                            {
                              key: "peso",
                              label: "Peso",
                              unit: "kg",
                              icon: <User className="h-3 w-3 text-slate-400" />,
                              placeholder: "70",
                            },
                          ].map(({ key, label, unit, icon, placeholder }) => (
                            <div key={key} className="relative">
                              <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                                {icon}
                                {label}
                              </label>
                              <div className="relative">
                                <Input
                                  type="number"
                                  step="any"
                                  placeholder={placeholder}
                                  value={bVitals[key as keyof VitalEntry]}
                                  onChange={(e) =>
                                    setVitals((p) => ({
                                      ...p,
                                      [booking.id]: {
                                        ...(p[booking.id] ?? EMPTY_VITALS),
                                        [key]: e.target.value,
                                      },
                                    }))
                                  }
                                  className="text-sm pr-8 h-8"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground pointer-events-none">
                                  {unit}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Observation */}
                        <Input
                          placeholder="Observación (ej: paciente refiere dolor 5/10)"
                          value={bVitals.obs}
                          onChange={(e) =>
                            setVitals((p) => ({
                              ...p,
                              [booking.id]: {
                                ...(p[booking.id] ?? EMPTY_VITALS),
                                obs: e.target.value,
                              },
                            }))
                          }
                          className="text-sm"
                        />

                        <Button
                          size="sm"
                          variant="glass"
                          className="w-full"
                          disabled={savingVitals === booking.id}
                          onClick={() => saveVitals(booking.id, booking)}
                        >
                          {savingVitals === booking.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Registrar signos vitales
                        </Button>

                        {/* History */}
                        {loadingHistory[booking.id] ? (
                          <div className="flex justify-center py-2">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : bHistory.length > 0 ? (
                          <ScrollArea className="h-32 rounded-xl border border-border bg-muted/20">
                            <div className="p-2 space-y-1">
                              {bHistory.map((r) => (
                                <div
                                  key={r.id}
                                  className="flex items-center justify-between text-xs px-2 py-1 rounded-lg hover:bg-muted/30"
                                >
                                  <span className="text-muted-foreground">
                                    {r.reading_type.replace(/_/g, " ")}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "font-bold",
                                        r.severity === "critical"
                                          ? "text-rose-500"
                                          : r.severity === "warning"
                                            ? "text-amber-500"
                                            : "text-foreground",
                                      )}
                                    >
                                      {r.value}
                                      {r.unit ?? ""}
                                      {r.value_secondary ? `/${r.value_secondary}` : ""}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground">
                                      {fmtTime(r.recorded_at)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        ) : null}
                      </div>

                      {/* ── Nursing notes ── */}
                      <div className="p-4 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-fuchsia-neural" /> Notas de
                          enfermería
                        </p>
                        <Textarea
                          rows={4}
                          placeholder="Escribe tus apuntes de la visita… La IA los estructurará en formato SOAP (Subjetivo · Objetivo · Análisis · Plan)"
                          value={bNotes}
                          onChange={(e) =>
                            setNotes((p) => ({ ...p, [booking.id]: e.target.value }))
                          }
                          className="text-sm resize-none"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="glass"
                            className="flex-1"
                            disabled={aiLoadingId === booking.id}
                            onClick={() => aiAssistNote(booking.id, booking)}
                          >
                            {aiLoadingId === booking.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 mr-1.5 text-fuchsia-neural" />
                            )}
                            Estructurar con IA (SOAP)
                          </Button>
                          <Button
                            size="sm"
                            variant="glass"
                            disabled={savingNote === booking.id}
                            onClick={() => saveNote(booking.id)}
                          >
                            {savingNote === booking.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* ── Share ── */}
                      <div className="p-4">
                        <Button
                          size="sm"
                          variant="glass"
                          className="w-full"
                          disabled={sharingId === booking.id}
                          onClick={() => shareSummary(booking)}
                        >
                          {sharingId === booking.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          ) : (
                            <Share2 className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Compartir resumen con familia / EPS·IPS
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
