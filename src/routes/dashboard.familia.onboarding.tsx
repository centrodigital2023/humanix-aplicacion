// Onboarding inteligente para familias con asistente IA, autocompletado
// por texto/voz, sugerencias dinámicas y conexión hiper-inteligente con
// /buscar (especialidad pre-seleccionada) y /quick-care.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  Camera,
  IdCard,
  MapPin,
  Phone,
  ShieldCheck,
  CheckCircle2,
  HeartHandshake,
  Sparkles,
  Mic,
  MicOff,
  Wand2,
  Lightbulb,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Logo } from "@/components/humanix/Logo";
import { LocationPicker } from "@/components/humanix/LocationPicker";
import { FamilyDocumentsManager } from "@/components/humanix/FamilyDocumentsManager";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/dashboard/familia/onboarding")({
  head: () => ({
    meta: [{ title: "Completa tu perfil familiar · Humanix" }],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    step: typeof s.step === "string" ? s.step : undefined,
  }),
  component: FamilyOnboarding,
});

const schema = z.object({
  fullName: z.string().trim().min(3, "Nombre obligatorio").max(120),
  idNumber: z.string().trim().min(5, "Cédula obligatoria").max(20),
  phone: z.string().trim().min(7, "Teléfono obligatorio").max(20),
  city: z.string().trim().min(2, "Ciudad obligatoria").max(80),
  defaultAddress: z.string().trim().min(5, "Dirección obligatoria").max(200),
  emergencyName: z.string().trim().min(3, "Contacto de emergencia obligatorio").max(120),
  emergencyPhone: z.string().trim().min(7, "Teléfono de emergencia obligatorio").max(20),
  patientName: z.string().trim().max(120).optional(),
  patientRelation: z.string().trim().max(60).optional(),
  patientAge: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined,
    ),
});

const STEPS = [
  { key: "identity", label: "Identidad", icon: IdCard },
  { key: "address", label: "Dirección", icon: MapPin },
  { key: "emergency", label: "Emergencia", icon: Phone },
  { key: "consent", label: "Consentimiento", icon: ShieldCheck },
] as const;

type AIResult = {
  fullName?: string;
  idNumber?: string;
  phone?: string;
  city?: string;
  defaultAddress?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  patientName?: string;
  patientRelation?: string;
  patientAge?: number;
  patientSummary?: string;
  careHints?: string[];
  suggestedSpecialty?: string;
  suggestedHourlyRateCop?: number;
  nextStepHint?: string;
};

function FamilyOnboarding() {
  const { user, loading } = useAppUser({ allow: ["family", "superadmin"] });
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [habeasOk, setHabeasOk] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // IA
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [aiHints, setAiHints] = useState<string[]>([]);
  const [aiSpecialty, setAiSpecialty] = useState<string>("");
  const [aiRate, setAiRate] = useState<number | null>(null);
  const [aiNext, setAiNext] = useState<string>("");
  const [listening, setListening] = useState(false);
  const recogRef = useRef<unknown>(null);

  // Deep-link: ?step=avatar|id|address|emergency|docs
  useEffect(() => {
    const s = searchParams?.step;
    if (!s) return;
    const map: Record<string, number> = {
      avatar: 0,
      id: 0,
      identity: 0,
      address: 1,
      docs: 1,
      patient: 1,
      emergency: 2,
      consent: 3,
    };
    if (map[s] != null) setStep(map[s]);
  }, [searchParams]);

  const [form, setForm] = useState({
    fullName: "",
    idNumber: "",
    phone: "",
    city: "",
    defaultAddress: "",
    emergencyName: "",
    emergencyPhone: "",
    patientName: "",
    patientRelation: "",
    patientAge: "",
    patientSummary: "",
  });
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });

  // Pre-cargar datos existentes
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const [{ data: prof }, { data: fam }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, phone, city, avatar_url")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("family_profiles")
          .select(
            "id_number, default_address, default_lat, default_lng, emergency_contact_name, emergency_contact_phone, patient_name, patient_relation, patient_age, patient_summary, habeas_data_accepted",
          )
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (!active) return;
      setAvatarUrl(prof?.avatar_url ?? null);
      setHabeasOk(!!fam?.habeas_data_accepted);
      setCoords({
        lat: fam?.default_lat ?? null,
        lng: fam?.default_lng ?? null,
      });
      setForm((f) => ({
        ...f,
        fullName: prof?.full_name ?? user.fullName ?? "",
        phone: prof?.phone ?? "",
        city: prof?.city ?? "",
        idNumber: fam?.id_number ?? "",
        defaultAddress: fam?.default_address ?? "",
        emergencyName: fam?.emergency_contact_name ?? "",
        emergencyPhone: fam?.emergency_contact_phone ?? "",
        patientName: fam?.patient_name ?? "",
        patientRelation: fam?.patient_relation ?? "",
        patientAge: fam?.patient_age != null ? String(fam.patient_age) : "",
        patientSummary: (fam as { patient_summary?: string | null } | null)?.patient_summary ?? "",
      }));
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Progreso global (0-100)
  const progress = useMemo(() => {
    const fields = [
      form.fullName,
      form.idNumber,
      form.phone,
      form.city,
      form.defaultAddress,
      form.emergencyName,
      form.emergencyPhone,
    ];
    const filled = fields.filter((v) => v.trim().length >= 3).length;
    const base = Math.round((filled / fields.length) * 90);
    return Math.min(100, base + (habeasOk ? 10 : 0));
  }, [form, habeasOk]);

  // Voz: dictado nativo del navegador (Web Speech API)
  const toggleListen = () => {
    type SpeechCtor = new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    const w = window as unknown as {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      toast.error("Tu navegador no soporta dictado por voz. Usa Chrome o escribe.");
      return;
    }
    if (listening) {
      (recogRef.current as { stop: () => void } | null)?.stop?.();
      setListening(false);
      return;
    }
    const r = new SR();
    r.lang = "es-CO";
    r.interimResults = true;
    r.continuous = true;
    const finalText = aiText;
    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        // si es resultado parcial vs final, solo lo añadimos como interim al render
        interim += chunk;
      }
      setAiText((finalText + " " + interim).trim());
    };
    r.onend = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  };

  const runAI = async () => {
    if (!aiText.trim() && Object.values(form).every((v) => !v.trim())) {
      toast.error("Escribe o dicta algo para que la IA pueda ayudarte.");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("family-onboarding-ai", {
        body: {
          freeText: aiText.trim(),
          partial: form,
        },
      });
      if (error) throw error;
      const r: AIResult = data?.data ?? {};
      setForm((f) => ({
        ...f,
        fullName: r.fullName?.trim() || f.fullName,
        idNumber: r.idNumber?.trim() || f.idNumber,
        phone: r.phone?.trim() || f.phone,
        city: r.city?.trim() || f.city,
        defaultAddress: r.defaultAddress?.trim() || f.defaultAddress,
        emergencyName: r.emergencyName?.trim() || f.emergencyName,
        emergencyPhone: r.emergencyPhone?.trim() || f.emergencyPhone,
        patientName: r.patientName?.trim() || f.patientName,
        patientRelation: r.patientRelation?.trim() || f.patientRelation,
        patientAge:
          r.patientAge != null && Number.isFinite(r.patientAge)
            ? String(r.patientAge)
            : f.patientAge,
        patientSummary: r.patientSummary?.trim() || f.patientSummary,
      }));
      setAiHints(Array.isArray(r.careHints) ? r.careHints.slice(0, 5) : []);
      setAiSpecialty(r.suggestedSpecialty?.trim() || "");
      setAiRate(typeof r.suggestedHourlyRateCop === "number" ? r.suggestedHourlyRateCop : null);
      setAiNext(r.nextStepHint?.trim() || "");
      toast.success("✨ IA completó lo que pudo. Revisa y ajusta.");
      // Avanza automáticamente al paso de identidad
      setStep(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no pudo procesar tu solicitud");
    } finally {
      setAiLoading(false);
    }
  };

  async function regeneratePatientSummary() {
    if (!form.patientName.trim() && !aiText.trim()) {
      toast.error("Agrega al menos el nombre del paciente o describe su situación.");
      return;
    }
    setSummaryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("family-onboarding-ai", {
        body: { freeText: aiText.trim(), partial: form },
      });
      if (error) throw error;
      const r: AIResult = data?.data ?? {};
      if (r.patientSummary?.trim()) {
        setForm((f) => ({ ...f, patientSummary: r.patientSummary!.trim() }));
        toast.success("Resumen generado por IA");
      } else {
        toast.error("La IA no pudo generar un resumen con la info actual.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error generando resumen");
    } finally {
      setSummaryLoading(false);
    }
  }
  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen debe pesar menos de 5MB");
      return;
    }
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(pub.publicUrl);
      await supabase.from("profiles").update({ avatar_url: pub.publicUrl }).eq("user_id", user.id);
      toast.success("Foto actualizada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setAvatarUploading(false);
    }
  };

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (form.fullName.trim().length < 3) return "Ingresa tu nombre completo";
      if (form.idNumber.trim().length < 5) return "Ingresa tu número de cédula";
      if (form.phone.trim().length < 7) return "Ingresa un teléfono válido";
    }
    if (s === 1) {
      if (form.city.trim().length < 2) return "Ingresa tu ciudad";
      if (form.defaultAddress.trim().length < 5) return "Ingresa tu dirección";
    }
    if (s === 2) {
      if (form.emergencyName.trim().length < 3) return "Nombre de contacto de emergencia";
      if (form.emergencyPhone.trim().length < 7) return "Teléfono de emergencia";
    }
    return null;
  };

  const next = () => {
    const err = validateStep(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    if (!user) return;
    if (!habeasOk) {
      toast.error("Debes aceptar el tratamiento de datos personales (Ley 1581).");
      return;
    }
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revisa los campos");
      return;
    }
    setSaving(true);
    try {
      const v = parsed.data;
      await supabase
        .from("profiles")
        .update({ full_name: v.fullName, phone: v.phone, city: v.city })
        .eq("user_id", user.id);
      const { error: famErr } = await supabase.from("family_profiles").upsert(
        {
          user_id: user.id,
          id_number: v.idNumber,
          default_address: v.defaultAddress,
          default_lat: coords.lat,
          default_lng: coords.lng,
          emergency_contact_name: v.emergencyName,
          emergency_contact_phone: v.emergencyPhone,
          patient_name: v.patientName || null,
          patient_relation: v.patientRelation || null,
          patient_age: v.patientAge ?? null,
          patient_summary: form.patientSummary?.trim() || null,
          habeas_data_accepted: true,
          habeas_data_accepted_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (famErr) throw famErr;
      await supabase.from("user_consents").insert({
        user_id: user.id,
        consent_type: "habeas_data_ley_1581",
        granted: true,
        user_agent: navigator.userAgent,
      });
      toast.success("¡Perfil completo! Buscando profesionales para ti…");
      // Conexión inteligente con /buscar usando especialidad sugerida si existe
      navigate({
        to: "/buscar",
        search: {
          tab: "profesionales",
          ...(aiSpecialty ? { q: aiSpecialty } : {}),
          ...(form.city ? { city: form.city } : {}),
        } as never,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-aurora">
      <header className="mx-auto max-w-3xl px-4 sm:px-6 py-6 flex items-center justify-between">
        <Logo />
        <Link
          to="/dashboard/familia"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Saltar por ahora
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 pb-16">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-copper/30 bg-copper/10 px-3 py-1 text-[11px] font-semibold text-copper uppercase tracking-wider">
            <HeartHandshake className="h-3 w-3" /> Bienvenida a Humanix
          </span>
          <h1 className="mt-4 font-display text-3xl sm:text-4xl font-bold leading-tight">
            Completa tu perfil familiar
          </h1>
          <p className="mt-2 text-muted-foreground max-w-lg mx-auto text-sm sm:text-base">
            Cuéntale a la IA tu situación en una frase: ella llena tus datos y arma un resumen
            breve del paciente (nombre · diagnóstico · necesidad · recomendación). Menos de 2
            minutos.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
            <span className="font-semibold">Progreso del perfil</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Stepper */}
        <ol className="mt-5 grid grid-cols-4 gap-1.5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={s.key}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] font-medium transition cursor-pointer ${
                  active
                    ? "border-biosensor bg-biosensor/10 text-biosensor"
                    : done
                      ? "border-biosensor/40 bg-biosensor/5 text-biosensor"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40"
                }`}
                onClick={() => setStep(i)}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span className="hidden sm:inline">{s.label}</span>
              </li>
            );
          })}
        </ol>

        <Card className="mt-6 p-6 sm:p-8">
          {/* Foto + identidad rápida */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-6 mb-6 border-b border-border">
            <div className="relative shrink-0 mx-auto sm:mx-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Tu foto"
                  className="h-20 w-20 rounded-2xl object-cover border border-border"
                />
              ) : (
                <div className="h-20 w-20 rounded-2xl bg-biosensor/10 text-biosensor flex items-center justify-center font-display text-2xl font-bold">
                  {form.fullName ? form.fullName.charAt(0).toUpperCase() : "F"}
                </div>
              )}
              {avatarUploading && (
                <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <p className="font-semibold truncate">{form.fullName || "Tu nombre"}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Foto de perfil — genera confianza con el cuidador.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center sm:justify-start">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="h-8 text-xs"
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" /> Tomar foto
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="h-8 text-xs"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {avatarUrl ? "Cambiar foto" : "Adjuntar foto"}
                </Button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAvatar(f);
                  e.target.value = "";
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAvatar(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Step 0: Identidad */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">Sobre ti</h2>
              </div>
              <Field label="Nombre completo" required>
                <Input
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="María García López"
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Cédula de ciudadanía" required>
                  <Input
                    inputMode="numeric"
                    value={form.idNumber}
                    onChange={(e) => set("idNumber", e.target.value.replace(/\D/g, ""))}
                    placeholder="00000000"
                  />
                </Field>
                <Field label="Teléfono / WhatsApp" required>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))}
                    placeholder="0000000000"
                  />
                </Field>
              </div>
              {form.phone.trim().length >= 7 && (
                <p className="text-[11px] text-muted-foreground">
                  Contacto WhatsApp:{" "}
                  <a
                    href={`https://wa.me/57${form.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-biosensor underline"
                  >
                    https://wa.me/57{form.phone.replace(/\D/g, "")}
                  </a>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Tus datos viajan cifrados y nunca se comparten con el cuidador hasta que aceptes una
                contratación.
              </p>
            </div>
          )}

          {/* Step 1: Dirección y paciente */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-semibold">¿Dónde será el servicio?</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Ciudad" required>
                  <Input
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Bogotá"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Dirección habitual" required>
                    <Input
                      value={form.defaultAddress}
                      onChange={(e) => set("defaultAddress", e.target.value)}
                      placeholder="Cra 11 No 11-32"
                    />
                  </Field>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-biosensor" /> Marca tu ubicación en el
                      mapa
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Para que veas profesionales cercanos y midamos la distancia exacta. Toca el
                      mapa o usa GPS.
                    </p>
                  </div>
                </div>
                <LocationPicker
                  lat={coords.lat}
                  lng={coords.lng}
                  defaultCity={form.city || "Bogotá"}
                  height={280}
                  onChange={(lat, lng, address) => {
                    setCoords({ lat, lng });
                    if (address && !form.defaultAddress) set("defaultAddress", address);
                  }}
                />
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4 mt-4">
                <p className="text-sm font-semibold">
                  ¿Para quién es el cuidado?{" "}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </p>
                <div className="mt-3 grid sm:grid-cols-3 gap-3">
                  <Field label="Nombre del paciente">
                    <Input
                      value={form.patientName}
                      onChange={(e) => set("patientName", e.target.value)}
                      placeholder="Pedro García"
                    />
                  </Field>
                  <Field label="Parentesco">
                    <Input
                      value={form.patientRelation}
                      onChange={(e) => set("patientRelation", e.target.value)}
                      placeholder="Padre"
                    />
                  </Field>
                  <Field label="Edad">
                    <Input
                      inputMode="numeric"
                      value={form.patientAge}
                      onChange={(e) => set("patientAge", e.target.value.replace(/\D/g, ""))}
                      placeholder="78"
                    />
                  </Field>
                </div>

                <div className="mt-4 rounded-xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-fuchsia-neural" />
                        Resumen del paciente
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Pocas palabras: nombre, diagnóstico, necesidad y recomendación. La IA lo
                        redacta en menos de 200 caracteres.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={regeneratePatientSummary}
                      disabled={summaryLoading}
                      className="shrink-0 h-8 text-xs"
                    >
                      {summaryLoading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      {form.patientSummary ? "Regenerar" : "Generar con IA"}
                    </Button>
                  </div>
                  <Textarea
                    value={form.patientSummary}
                    onChange={(e) => set("patientSummary", e.target.value.slice(0, 200))}
                    rows={3}
                    maxLength={200}
                    placeholder="Ej: Pedro, 78 · Alzheimer leve. Necesita auxiliar 4h/día en las mañanas. Recomendado: experiencia adulto mayor."
                    className="resize-none text-sm bg-background"
                  />
                  <div className="flex items-center justify-end mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {form.patientSummary.length}/200
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-biosensor" /> Documentos de la
                      familia
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sube tu cédula, recibo de servicios y documentos del paciente. La IA verifica
                      al instante.
                    </p>
                  </div>
                  <Badge variant="outline" className="text-fuchsia-neural">
                    <Sparkles className="h-3 w-3 mr-1" /> IA
                  </Badge>
                </div>
                <FamilyDocumentsManager userId={user.id} />
              </div>
            </div>
          )}

          {/* Step 2: Emergencia */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-semibold">Contacto de emergencia</h2>
              <p className="text-sm text-muted-foreground">
                Persona a quien notificaremos si activas el botón de pánico durante un servicio.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Nombre completo" required>
                  <Input
                    value={form.emergencyName}
                    onChange={(e) => set("emergencyName", e.target.value)}
                    placeholder="Juan García"
                  />
                </Field>
                <Field label="Teléfono" required>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={form.emergencyPhone}
                    onChange={(e) => set("emergencyPhone", e.target.value.replace(/\D/g, ""))}
                    placeholder="0000000000"
                  />
                </Field>
              </div>
              {form.emergencyPhone.trim().length >= 7 && (
                <p className="text-[11px] text-muted-foreground">
                  Contacto WhatsApp emergencia:{" "}
                  <a
                    href={`https://wa.me/57${form.emergencyPhone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-biosensor underline"
                  >
                    https://wa.me/57{form.emergencyPhone.replace(/\D/g, "")}
                  </a>
                </p>
              )}
              <div className="rounded-xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-3.5 text-xs text-muted-foreground leading-relaxed">
                <strong className="text-fuchsia-neural">Botón de pánico 24/7:</strong> en caso de
                emergencia, Humanix notifica al contacto, comparte la ubicación en vivo y conecta
                con la línea 123.
              </div>
            </div>
          )}

          {/* Step 3: Consentimiento */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-semibold">Consentimiento y privacidad</h2>
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground leading-relaxed max-h-56 overflow-auto">
                <p className="font-semibold text-foreground mb-2">
                  Tratamiento de datos personales — Ley 1581 de 2012
                </p>
                <p>
                  En cumplimiento de la Ley Estatutaria 1581 de 2012 y el Decreto 1377 de 2013,
                  Humanix S.A.S. te informa que recolectará y tratará tus datos personales (incluida
                  la información del paciente, dirección y contactos) con la finalidad exclusiva de:
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Conectar tu solicitud con cuidadores verificados con RETHUS.</li>
                  <li>Procesar pagos y emitir facturación electrónica.</li>
                  <li>Garantizar tu seguridad mediante geolocalización durante el servicio.</li>
                  <li>Atender emergencias y notificar a tu contacto designado.</li>
                </ul>
                <p className="mt-2">
                  Puedes ejercer tus derechos de conocer, actualizar, rectificar y suprimir tus
                  datos en cualquier momento escribiendo a <strong>privacidad@humanix.lat</strong>.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-biosensor/30 bg-biosensor/5 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={habeasOk}
                  onChange={(e) => setHabeasOk(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-input accent-biosensor"
                />
                <span className="text-sm">
                  Acepto el tratamiento de mis datos personales conforme a la Ley 1581 de 2012 y la
                  Política de Privacidad de Humanix.
                </span>
              </label>

              <div className="rounded-xl border border-copper/30 bg-copper/5 p-3.5 text-xs leading-relaxed">
                <strong className="text-copper">Modelo Humanix:</strong> el profesional cobra
                directamente al finalizar el servicio (efectivo o transferencia). Humanix solo cobra
                una suscripción mensual de <strong>$9.000 COP</strong> que incluye verificación de
                identidad, soporte 24/7 y la línea de emergencia.
              </div>

              {aiSpecialty && (
                <div className="rounded-xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-4">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-fuchsia-neural" />
                    Listos para conectarte
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Al finalizar te llevaremos directo a buscar profesionales en{" "}
                    <strong>{form.city || "tu ciudad"}</strong> filtrados por{" "}
                    <strong>{aiSpecialty}</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={prev}
              disabled={step === 0 || saving}
              className="min-w-24"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Atrás
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="hero" onClick={next} className="min-w-32">
                Siguiente <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="hero"
                onClick={submit}
                disabled={saving}
                className="min-w-44"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Finalizar y buscar
              </Button>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label} {required && <span className="text-fuchsia-neural">*</span>}
      </Label>
      {children}
    </div>
  );
}
