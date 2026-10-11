// Onboarding wizard para EPS / IPS — flujo completo en 5 pasos
// Premium, intuitivo, textos cortos, sin saturar.
import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck,
  Loader2,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Logo } from "@/components/humanix/Logo";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/institucion/onboarding")({
  head: () => ({ meta: [{ title: "Configura tu institución · Humanix" }] }),
  component: InstitutionOnboarding,
});

// ─── tipos ───────────────────────────────────────────────────────────────────

type InstitutionType = "ips" | "eps" | "clinica" | "fundacion" | "otro";

const INSTITUTION_TYPES: { key: InstitutionType; label: string; emoji: string; desc: string }[] = [
  { key: "ips", label: "IPS", emoji: "🏥", desc: "Institución Prestadora de Servicios de Salud" },
  { key: "eps", label: "EPS", emoji: "🛡️", desc: "Entidad Promotora de Salud" },
  { key: "clinica", label: "Clínica", emoji: "🩺", desc: "Clínica privada o especializada" },
  { key: "fundacion", label: "Fundación", emoji: "❤️", desc: "Fundación u ONG de salud" },
  { key: "otro", label: "Otro", emoji: "🏢", desc: "Centro médico u otra entidad" },
];

const TOTAL_STEPS = 5;

// ─── componente principal ─────────────────────────────────────────────────────

function InstitutionOnboarding() {
  const { user, loading } = useAppUser({ allow: ["institution", "superadmin"] });
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docUrl, setDocUrl] = useState<string | null>(null);

  const [form, setForm] = useState({
    institution_type: "" as InstitutionType | "",
    institution_name: "",
    nit: "",
    chamber_of_commerce_number: "",
    legal_representative_name: "",
    legal_representative_email: "",
    legal_representative_phone: "",
    city: "",
    address: "",
    habeas_data: false,
  });

  // Redirect if onboarding already completed
  useEffect(() => {
    if (!user) return;
    supabase
      .from("institution_profiles" as never)
      .select("onboarding_complete")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (data?.onboarding_complete) {
          navigate({ to: "/dashboard/institucion", replace: true });
        }
      });
  }, [user, navigate]);

  // Prefill si ya tiene perfil parcial
  useEffect(() => {
    if (!user) return;
    supabase
      .from("institution_profiles" as never)
      .select(
        "institution_type,institution_name,nit,chamber_of_commerce_number,legal_representative_name,legal_representative_email,legal_representative_phone,city,address,habeas_data_accepted",
      )
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (!data) return;
        setForm((p) => ({
          ...p,
          institution_type: (data.institution_type as InstitutionType) || "",
          institution_name: (data.institution_name as string) || "",
          nit: (data.nit as string) || "",
          chamber_of_commerce_number: (data.chamber_of_commerce_number as string) || "",
          legal_representative_name: (data.legal_representative_name as string) || "",
          legal_representative_email: (data.legal_representative_email as string) || "",
          legal_representative_phone: (data.legal_representative_phone as string) || "",
          city: (data.city as string) || "",
          address: (data.address as string) || "",
          habeas_data: (data.habeas_data_accepted as boolean) || false,
        }));
      });
  }, [user]);

  const set = (k: keyof typeof form, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  // ── subir cámara de comercio ─────────────────────────────────────────────

  const uploadDoc = async (file: File) => {
    if (!user) return;
    if (file.size > 15 * 1024 * 1024) return toast.error("Máximo 15 MB");
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/camara-${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from("institution-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      setDocUrl(path);
      toast.success("Documento adjuntado ✓");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  };

  // ── guardar paso a paso en Supabase ──────────────────────────────────────

  const savePartial = async () => {
    if (!user) return;
    await supabase.from("institution_profiles" as never).upsert(
      {
        user_id: user.id,
        institution_type: form.institution_type || null,
        institution_name: form.institution_name || null,
        nit: form.nit || null,
        chamber_of_commerce_number: form.chamber_of_commerce_number || null,
        legal_representative_name: form.legal_representative_name || null,
        legal_representative_email: form.legal_representative_email || null,
        legal_representative_phone: form.legal_representative_phone || null,
        city: form.city || null,
        address: form.address || null,
        chamber_of_commerce_doc_url: docUrl,
        habeas_data_accepted: form.habeas_data,
        onboarding_complete: false,
      } as never,
      { onConflict: "user_id" },
    );
  };

  const finish = async () => {
    if (!user) return;
    if (!form.habeas_data) return toast.error("Acepta el tratamiento de datos para continuar");
    setSaving(true);
    try {
      const { error } = await supabase.from("institution_profiles" as never).upsert(
        {
          user_id: user.id,
          institution_type: form.institution_type || null,
          institution_name: form.institution_name,
          nit: form.nit || null,
          chamber_of_commerce_number: form.chamber_of_commerce_number || null,
          legal_representative_name: form.legal_representative_name || null,
          legal_representative_email: form.legal_representative_email || null,
          legal_representative_phone: form.legal_representative_phone || null,
          city: form.city || null,
          address: form.address || null,
          chamber_of_commerce_doc_url: docUrl,
          habeas_data_accepted: true,
          onboarding_complete: true,
        } as never,
        { onConflict: "user_id" },
      );
      if (error) throw error;
      setStep(TOTAL_STEPS + 1); // pantalla de éxito
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    void savePartial();
    setStep((s) => s + 1);
  };
  const back = () => setStep((s) => Math.max(1, s - 1));

  // ── validaciones por paso ────────────────────────────────────────────────

  const canNext: Record<number, boolean> = {
    1: !!form.institution_type,
    2: form.institution_name.trim().length > 2,
    3: form.legal_representative_name.trim().length > 2,
    4: form.city.trim().length > 1,
    5: form.habeas_data,
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── pantalla de éxito ────────────────────────────────────────────────────

  if (step > TOTAL_STEPS) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-6">
        <div className="h-20 w-20 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">¡Listo, {form.institution_name}!</h1>
          <p className="text-muted-foreground mt-2">
            Tu perfil está configurado. Humanix lo revisará en 24 h.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="hero" onClick={() => navigate({ to: "/dashboard/institucion" })}>
            Ir a mi panel <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/buscar" })}>
            Buscar profesionales
          </Button>
        </div>
      </div>
    );
  }

  const progress = Math.round(((step - 1) / TOTAL_STEPS) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <Logo />
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard/institucion" })}
          className="text-sm text-muted-foreground hover:text-foreground transition"
        >
          Omitir por ahora
        </button>
      </header>

      {/* Progress */}
      <div className="px-5 pt-5">
        <div className="max-w-xl mx-auto space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Paso {step} de {TOTAL_STEPS}
            </span>
            <span>{progress}% completado</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      </div>

      {/* Step content */}
      <main className="flex-1 flex items-start justify-center px-5 py-10">
        <div className="w-full max-w-xl space-y-8">
          {/* ── PASO 1: Tipo de institución ── */}
          {step === 1 && (
            <StepShell
              icon={<Building2 className="h-6 w-6" />}
              title="¿Qué tipo de institución eres?"
              desc="Elige el que mejor describe tu organización"
            >
              <div className="grid gap-3">
                {INSTITUTION_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => set("institution_type", t.key)}
                    className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                      form.institution_type === t.key
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border hover:border-foreground/30 hover:bg-muted/40"
                    }`}
                  >
                    <span className="text-3xl">{t.emoji}</span>
                    <div>
                      <p className="font-semibold">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.desc}</p>
                    </div>
                    {form.institution_type === t.key && (
                      <CheckCircle2 className="h-5 w-5 text-primary ml-auto shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </StepShell>
          )}

          {/* ── PASO 2: Datos legales ── */}
          {step === 2 && (
            <StepShell
              icon={<FileCheck className="h-6 w-6" />}
              title="Datos de la institución"
              desc="Nombre, NIT y cámara de comercio"
            >
              <div className="space-y-4">
                <Field label="Nombre de la institución" required>
                  <Input
                    value={form.institution_name}
                    onChange={(e) => set("institution_name", e.target.value)}
                    placeholder="Ej. Clínica San Rafael S.A.S."
                    autoFocus
                  />
                </Field>
                <Field label="NIT">
                  <Input
                    value={form.nit}
                    onChange={(e) => set("nit", e.target.value.replace(/[^\d-]/g, ""))}
                    placeholder="900.000.000-1"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Número de cámara de comercio">
                  <Input
                    value={form.chamber_of_commerce_number}
                    onChange={(e) => set("chamber_of_commerce_number", e.target.value)}
                    placeholder="Ej. 1234567"
                  />
                </Field>

                {/* Subir cámara de comercio */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">
                      Cámara de comercio{" "}
                      <span className="text-[11px] text-muted-foreground font-normal ml-1">
                        PDF o foto · máx. 15 MB
                      </span>
                    </p>
                    {docUrl && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />}
                  </div>
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {docUrl ? "Cambiar archivo" : "Subir archivo"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadDoc(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </StepShell>
          )}

          {/* ── PASO 3: Representante legal ── */}
          {step === 3 && (
            <StepShell
              icon={<User className="h-6 w-6" />}
              title="Representante legal"
              desc="Persona responsable ante Humanix"
            >
              <div className="space-y-4">
                <Field label="Nombre completo" required>
                  <Input
                    value={form.legal_representative_name}
                    onChange={(e) => set("legal_representative_name", e.target.value)}
                    placeholder="Ej. Carlos Rodríguez Gómez"
                    autoFocus
                  />
                </Field>
                <Field label="Correo electrónico">
                  <Input
                    type="email"
                    value={form.legal_representative_email}
                    onChange={(e) => set("legal_representative_email", e.target.value)}
                    placeholder="correo@institucion.com"
                  />
                </Field>
                <Field label="Teléfono / WhatsApp">
                  <div className="relative">
                    <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      inputMode="tel"
                      value={form.legal_representative_phone}
                      onChange={(e) => set("legal_representative_phone", e.target.value)}
                      placeholder="+57 310 000 0000"
                    />
                  </div>
                </Field>
              </div>
            </StepShell>
          )}

          {/* ── PASO 4: Ubicación ── */}
          {step === 4 && (
            <StepShell
              icon={<MapPin className="h-6 w-6" />}
              title="¿Dónde estás ubicado?"
              desc="Ciudad y dirección principal"
            >
              <div className="space-y-4">
                <Field label="Ciudad" required>
                  <Input
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Ej. Bogotá, Medellín, Cali…"
                    autoFocus
                  />
                </Field>
                <Field label="Dirección">
                  <div className="relative">
                    <MapPin className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={form.address}
                      onChange={(e) => set("address", e.target.value)}
                      placeholder="Calle 123 #45-67, Barrio"
                    />
                  </div>
                </Field>
              </div>
            </StepShell>
          )}

          {/* ── PASO 5: Confirmación y habeas data ── */}
          {step === 5 && (
            <StepShell
              icon={<ShieldCheck className="h-6 w-6" />}
              title="Casi listo"
              desc="Revisa y confirma para activar tu cuenta"
            >
              {/* Resumen */}
              <div className="rounded-2xl border border-border bg-muted/30 p-5 space-y-2 text-sm">
                <SummaryRow
                  label="Tipo"
                  value={
                    INSTITUTION_TYPES.find((t) => t.key === form.institution_type)?.label ?? "—"
                  }
                />
                <SummaryRow label="Nombre" value={form.institution_name || "—"} />
                <SummaryRow label="NIT" value={form.nit || "—"} />
                <SummaryRow label="Representante" value={form.legal_representative_name || "—"} />
                <SummaryRow label="Ciudad" value={form.city || "—"} />
              </div>

              {/* Habeas data */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.habeas_data}
                  onChange={(e) => set("habeas_data", e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-primary"
                />
                <span className="text-sm text-muted-foreground leading-relaxed">
                  Autorizo el tratamiento de datos personales e institucionales conforme a la{" "}
                  <a
                    href="/politica-privacidad"
                    target="_blank"
                    className="underline text-foreground"
                  >
                    Política de Privacidad
                  </a>{" "}
                  de Humanix (Ley 1581/2012).
                </span>
              </label>

              <div className="flex items-center gap-2 rounded-xl bg-biosensor/5 border border-biosensor/20 px-4 py-3 text-xs text-biosensor">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                Humanix verificará tu institución en menos de 24 h. Recibirás una notificación.
              </div>
            </StepShell>
          )}

          {/* ── Navegación ── */}
          <div className="flex justify-between gap-3 pt-2">
            {step > 1 ? (
              <Button variant="ghost" onClick={back} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
            ) : (
              <span />
            )}
            {step < TOTAL_STEPS ? (
              <Button
                variant="hero"
                disabled={!canNext[step]}
                onClick={next}
                className="gap-1.5 min-w-[140px]"
              >
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="hero"
                disabled={!canNext[step] || saving}
                onClick={finish}
                className="gap-1.5 min-w-[160px]"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Activar cuenta
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── sub-componentes ──────────────────────────────────────────────────────────

function StepShell({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
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
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}
