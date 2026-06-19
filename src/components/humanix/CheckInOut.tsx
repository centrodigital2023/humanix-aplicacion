/**
 * CheckInOut — Check-in/out geolocalizado del profesional
 * Módulo 3: Portal profesional · Check-in · Evidencias · Firma digital · SOS
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmergencyButton } from "./EmergencyButton";
import {
  MapPin,
  Camera,
  PenLine,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Navigation,
  Upload,
  Trash2,
  FileImage,
  AlertTriangle,
  ClipboardList,
  CalendarCheck,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDistanceToNow, format, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckinRecord {
  id: string;
  booking_id: string;
  professional_id: string;
  patient_id: string | null;
  checkin_at: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkout_at: string | null;
  evidence_urls: string[] | null;
  notes: string | null;
  digital_signature_url: string | null;
  status: "not_started" | "checked_in" | "completed" | "cancelled";
  sos_triggered: boolean;
  duration_minutes: number | null;
}

interface Props {
  bookingId: string;
  patientId?: string;
  scheduledAt?: string;
  serviceAddress?: string;
  professionalId: string;
}

// ─── Signature pad (canvas) ───────────────────────────────────────────────────

function SignaturePad({ onSave }: { onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
    e.preventDefault();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !lastPos.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e40af";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
    e.preventDefault();
  };

  const stopDraw = () => {
    drawing.current = false;
    lastPos.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Firma digital del paciente / responsable</Label>
      <div className="border-2 border-dashed border-border rounded-xl overflow-hidden bg-white dark:bg-slate-950">
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          className="w-full cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={clear} className="flex-1 h-7 text-xs">
          <Trash2 className="h-3 w-3 mr-1" />
          Limpiar
        </Button>
        <Button size="sm" onClick={save} className="flex-1 h-7 text-xs">
          <PenLine className="h-3 w-3 mr-1" />
          Guardar firma
        </Button>
      </div>
    </div>
  );
}

// ─── Geolocation helper ───────────────────────────────────────────────────────

function getGeoPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalización no disponible"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

// ─── Upload evidence to Supabase Storage ─────────────────────────────────────

async function uploadEvidence(
  file: File,
  bookingId: string,
  professionalId: string,
): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `checkins/${bookingId}/${professionalId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("evidence").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = sb.storage.from("evidence").getPublicUrl(path);
  return data.publicUrl;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CheckInOut({
  bookingId,
  patientId,
  scheduledAt,
  serviceAddress,
  professionalId,
}: Props) {
  const [record, setRecord] = useState<CheckinRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [evidencePreviews, setEvidencePreviews] = useState<string[]>([]);
  const [showSignature, setShowSignature] = useState(false);
  const [elapsed, setElapsed] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing checkin record
  useEffect(() => {
    if (!bookingId) return;
    (async () => {
      try {
        const { data } = await sb
          .from("service_checkins")
          .select("*")
          .eq("booking_id", bookingId)
          .eq("professional_id", professionalId)
          .maybeSingle();
        if (data) setRecord(data as CheckinRecord);
      } catch {
        /* no record yet */
      } finally {
        setLoading(false);
      }
    })();
  }, [bookingId, professionalId]);

  // Elapsed timer when checked in
  useEffect(() => {
    if (!record?.checkin_at || record.status !== "checked_in") return;
    const update = () => {
      const mins = differenceInMinutes(new Date(), new Date(record.checkin_at!));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m} min`);
    };
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [record]);

  const handleCheckIn = async () => {
    setBusy(true);
    try {
      const pos = await getGeoPosition();
      const payload = {
        booking_id: bookingId,
        professional_id: professionalId,
        patient_id: patientId ?? null,
        checkin_at: new Date().toISOString(),
        checkin_lat: pos.coords.latitude,
        checkin_lng: pos.coords.longitude,
        checkin_accuracy_m: pos.coords.accuracy,
        status: "checked_in",
      };

      if (record?.id) {
        const { data, error } = await sb
          .from("service_checkins")
          .update(payload)
          .eq("id", record.id)
          .select()
          .single();
        if (error) throw error;
        setRecord(data as CheckinRecord);
      } else {
        const { data, error } = await sb
          .from("service_checkins")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setRecord(data as CheckinRecord);
      }

      toast.success("Check-in registrado", {
        description: `Ubicación: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al registrar check-in");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!record?.id) return;
    setBusy(true);
    try {
      const pos = await getGeoPosition();

      // Upload evidence files
      const uploadedUrls: string[] = [];
      for (const file of evidenceFiles) {
        try {
          const url = await uploadEvidence(file, bookingId, professionalId);
          uploadedUrls.push(url);
        } catch {
          toast.warning(`No se pudo subir ${file.name}`);
        }
      }

      // Upload signature if canvas was used
      let sigUrl: string | null = null;
      if (signatureDataUrl) {
        const blob = await (await fetch(signatureDataUrl)).blob();
        const sigFile = new File([blob], "signature.png", { type: "image/png" });
        try {
          sigUrl = await uploadEvidence(sigFile, bookingId, professionalId);
        } catch {
          toast.warning("No se pudo subir la firma");
        }
      }

      const checkinTime = new Date(record.checkin_at!);
      const durationMins = differenceInMinutes(new Date(), checkinTime);

      const { data, error } = await sb
        .from("service_checkins")
        .update({
          checkout_at: new Date().toISOString(),
          checkout_lat: pos.coords.latitude,
          checkout_lng: pos.coords.longitude,
          checkout_accuracy_m: pos.coords.accuracy,
          evidence_urls: uploadedUrls.length > 0 ? uploadedUrls : null,
          digital_signature_url: sigUrl,
          notes: notes || null,
          status: "completed",
          duration_minutes: durationMins,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id)
        .select()
        .single();

      if (error) throw error;
      setRecord(data as CheckinRecord);
      toast.success("Check-out completado", {
        description: `Duración: ${Math.floor(durationMins / 60)}h ${durationMins % 60}m`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al registrar check-out");
    } finally {
      setBusy(false);
    }
  };

  const addEvidenceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const validFiles = files.filter((f) => f.type.startsWith("image/") && f.size < 10_000_000);
    if (files.length !== validFiles.length) {
      toast.warning("Solo imágenes hasta 10 MB son permitidas");
    }
    setEvidenceFiles((prev) => [...prev, ...validFiles].slice(0, 6));
    const newPreviews = validFiles.map((f) => URL.createObjectURL(f));
    setEvidencePreviews((prev) => [...prev, ...newPreviews].slice(0, 6));
  };

  const removeEvidence = (idx: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));
    setEvidencePreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = record?.status ?? "not_started";
  const isCheckedIn = status === "checked_in";
  const isCompleted = status === "completed";

  return (
    <div className="space-y-4">
      {/* Service info */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarCheck className="h-4 w-4 text-primary" />
          Servicio activo
        </div>
        {scheduledAt && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Programado: {format(new Date(scheduledAt), "d MMM yyyy · HH:mm", { locale: es })}
          </p>
        )}
        {serviceAddress && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {serviceAddress}
          </p>
        )}
      </Card>

      {/* Timeline */}
      <div className="flex items-center gap-2 text-xs">
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center border-2 flex-shrink-0",
          status !== "not_started"
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
            : "border-border text-muted-foreground",
        )}>
          {status !== "not_started" ? <CheckCircle2 className="h-4 w-4" /> : <span>1</span>}
        </div>
        <div className={cn("flex-1 h-0.5", isCheckedIn || isCompleted ? "bg-emerald-500" : "bg-border")} />
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center border-2 flex-shrink-0",
          isCompleted
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
            : isCheckedIn
              ? "border-primary bg-primary/10 text-primary animate-pulse"
              : "border-border text-muted-foreground",
        )}>
          {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <span>2</span>}
        </div>
        <div className={cn("flex-1 h-0.5", isCompleted ? "bg-emerald-500" : "bg-border")} />
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center border-2 flex-shrink-0",
          isCompleted
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
            : "border-border text-muted-foreground",
        )}>
          {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <span>3</span>}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground -mt-1">
        <span>Check-in</span>
        <span>En servicio</span>
        <span>Check-out</span>
      </div>

      {/* Status cards */}
      {record?.checkin_at && (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <Navigation className="h-3.5 w-3.5" />
            Check-in registrado
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {format(new Date(record.checkin_at), "d MMM · HH:mm", { locale: es })}
            {record.checkin_lat && ` · ${record.checkin_lat.toFixed(4)}, ${record.checkin_lng?.toFixed(4)}`}
          </p>
          {isCheckedIn && elapsed && (
            <p className="text-xs font-bold text-primary mt-1 flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              Tiempo en servicio: {elapsed}
            </p>
          )}
        </Card>
      )}

      {isCompleted && (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Servicio completado
          </p>
          {record?.checkout_at && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Check-out: {format(new Date(record.checkout_at), "d MMM · HH:mm", { locale: es })}
            </p>
          )}
          {record?.duration_minutes && (
            <p className="text-[10px] text-muted-foreground">
              Duración: {Math.floor(record.duration_minutes / 60)}h {record.duration_minutes % 60}m
            </p>
          )}
        </Card>
      )}

      {/* Action area */}
      {!isCompleted && (
        <div className="space-y-3">
          {/* Check-in button */}
          {status === "not_started" && (
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleCheckIn}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
              Registrar Check-in
            </Button>
          )}

          {/* Check-out flow */}
          {isCheckedIn && (
            <div className="space-y-3">
              {/* Evidence */}
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5" />
                  Evidencias fotográficas ({evidenceFiles.length}/6)
                </Label>
                {evidencePreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {evidencePreviews.map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border">
                        <img src={url} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeEvidence(i)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <XCircle className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-16 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  Subir foto(s)
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={addEvidenceFile}
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Notas del servicio
                </Label>
                <Textarea
                  placeholder="Observaciones clínicas, incidencias, medicamentos administrados…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-xs resize-none h-20"
                />
              </div>

              {/* Signature */}
              <div>
                <button
                  onClick={() => setShowSignature(!showSignature)}
                  className="text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1"
                >
                  <PenLine className="h-3 w-3" />
                  {showSignature ? "Ocultar firma" : "Agregar firma digital del paciente"}
                </button>
                {showSignature && (
                  <div className="mt-2">
                    <SignaturePad
                      onSave={(dataUrl) => {
                        setSignatureDataUrl(dataUrl);
                        setSignatureSaved(true);
                        toast.success("Firma capturada");
                      }}
                    />
                    {signatureSaved && (
                      <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Firma lista para guardar
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Check-out button */}
              <Button
                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                size="lg"
                onClick={handleCheckOut}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Registrar Check-out
              </Button>
            </div>
          )}
        </div>
      )}

      {/* SOS Button */}
      <div className="pt-1 border-t border-border">
        <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          ¿Hay una emergencia? Activa el botón SOS para alertar al equipo de Humanix.
        </p>
        <EmergencyButton bookingId={bookingId} className="w-full justify-center" />
      </div>
    </div>
  );
}
