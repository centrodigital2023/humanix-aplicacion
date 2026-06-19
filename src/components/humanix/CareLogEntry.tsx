// Panel del profesional: registrar eventos de cuidado durante el turno.
import { useState } from "react";
import {
  Home, Pill, Activity, Utensils, PersonStanding,
  FileText, AlertTriangle, LogOut, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type EventType =
  | "arrival" | "medication" | "vital_signs" | "meal"
  | "activity" | "note" | "incident" | "departure";

const EVENT_TYPES: { value: EventType; label: string; icon: React.ElementType; color: string }[] = [
  { value: "arrival",     label: "Llegué",          icon: Home,          color: "text-biosensor border-biosensor/40 bg-biosensor/10" },
  { value: "medication",  label: "Medicamento",     icon: Pill,          color: "text-copper border-copper/40 bg-copper/10" },
  { value: "vital_signs", label: "Signos vitales",  icon: Activity,      color: "text-fuchsia-neural border-fuchsia-neural/40 bg-fuchsia-neural/10" },
  { value: "meal",        label: "Alimentación",    icon: Utensils,      color: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" },
  { value: "activity",    label: "Actividad",       icon: PersonStanding, color: "text-blue-400 border-blue-400/40 bg-blue-400/10" },
  { value: "note",        label: "Nota",            icon: FileText,      color: "text-slate-400 border-slate-400/40 bg-slate-400/10" },
  { value: "incident",    label: "Incidente",       icon: AlertTriangle, color: "text-destructive border-destructive/40 bg-destructive/10" },
  { value: "departure",   label: "Terminé turno",   icon: LogOut,        color: "text-muted-foreground border-border bg-muted/20" },
];

type Vitals = {
  systolic: string;
  diastolic: string;
  heart_rate: string;
  temperature: string;
  oxygen: string;
};

const EMPTY_VITALS: Vitals = { systolic: "", diastolic: "", heart_rate: "", temperature: "", oxygen: "" };

type Props = {
  bookingId: string;
  professionalId: string;
  patientName?: string;
};

export function CareLogEntry({ bookingId, professionalId, patientName }: Props) {
  const [selectedType, setSelectedType] = useState<EventType | null>(null);
  const [description, setDescription] = useState("");
  const [vitals, setVitals] = useState<Vitals>(EMPTY_VITALS);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!selectedType || !description.trim()) {
      toast.error("Selecciona un tipo de evento y escribe una descripción");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        booking_id: bookingId,
        professional_id: professionalId,
        patient_name: patientName ?? null,
        event_type: selectedType,
        description: description.trim(),
        is_alert: selectedType === "incident",
      };

      if (selectedType === "vital_signs") {
        if (vitals.systolic)    payload.vital_systolic    = parseInt(vitals.systolic);
        if (vitals.diastolic)   payload.vital_diastolic   = parseInt(vitals.diastolic);
        if (vitals.heart_rate)  payload.vital_heart_rate  = parseInt(vitals.heart_rate);
        if (vitals.temperature) payload.vital_temperature = parseFloat(vitals.temperature);
        if (vitals.oxygen)      payload.vital_oxygen      = parseInt(vitals.oxygen);
      }

      const { error } = await sb.from("care_logs").insert(payload);
      if (error) throw error;

      toast.success("Registrado. La familia fue notificada en tiempo real.");
      setDescription("");
      setSelectedType(null);
      setVitals(EMPTY_VITALS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al registrar";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Registrar evento del turno</h3>
        {patientName && (
          <p className="text-xs text-muted-foreground mt-0.5">Paciente: <strong>{patientName}</strong></p>
        )}
      </div>

      {/* Event type grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {EVENT_TYPES.map(({ value, label, icon: Icon, color }) => (
          <button
            key={value}
            onClick={() => setSelectedType(value === selectedType ? null : value)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-all ${
              selectedType === value
                ? color + " scale-[1.03] shadow-sm"
                : "border-border bg-card text-muted-foreground hover:bg-muted/30"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Vitals inputs */}
      {selectedType === "vital_signs" && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { key: "systolic",    placeholder: "Sistólica", unit: "mmHg" },
            { key: "diastolic",   placeholder: "Diastólica", unit: "mmHg" },
            { key: "heart_rate",  placeholder: "F. cardíaca", unit: "bpm" },
            { key: "temperature", placeholder: "Temperatura", unit: "°C" },
            { key: "oxygen",      placeholder: "SpO₂", unit: "%" },
          ].map(({ key, placeholder, unit }) => (
            <div key={key} className="relative">
              <Input
                type="number"
                placeholder={placeholder}
                value={vitals[key as keyof Vitals]}
                onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))}
                className="pr-9 text-sm"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                {unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      <Textarea
        placeholder={
          selectedType === "incident"
            ? "Describe el incidente con detalle. La familia recibirá alerta inmediata."
            : "Describe el evento..."
        }
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={800}
        className={selectedType === "incident" ? "border-destructive/50 bg-destructive/5" : ""}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{description.length}/800</span>
        <Button
          onClick={handleSubmit}
          disabled={busy || !selectedType || !description.trim()}
          className={selectedType === "incident" ? "bg-destructive hover:bg-destructive/90" : ""}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Activity className="h-4 w-4 mr-2" />
          )}
          Registrar y notificar familia
        </Button>
      </div>
    </Card>
  );
}
