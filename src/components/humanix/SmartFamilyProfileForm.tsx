// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Save,
  UploadCloud,
  CheckCircle2,
  IdCard,
  User,
  Phone,
  MapPin,
  MessageCircle,
  FileText,
  Camera,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

type FormState = {
  full_name: string;
  id_number: string;
  phone: string;
  whatsapp: string;
  default_address: string;
  id_doc_url: string | null;
};

const EMPTY: FormState = {
  full_name: "",
  id_number: "",
  phone: "",
  whatsapp: "",
  default_address: "",
  id_doc_url: null,
};

export function SmartFamilyProfileForm({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ data: prof }, { data: fam }] = await Promise.all([
          supabase.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle(),
          supabase
            .from("family_profiles")
            .select("id_number, whatsapp, default_address, id_doc_url")
            .eq("user_id", userId)
            .maybeSingle(),
        ]);
        if (!active) return;
        setForm({
          full_name: prof?.full_name ?? "",
          phone: prof?.phone ?? "",
          id_number: fam?.id_number ?? "",
          whatsapp: fam?.whatsapp ?? "",
          default_address: fam?.default_address ?? "",
          id_doc_url: fam?.id_doc_url ?? null,
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const upload = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Máximo 15MB");
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/id-${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from("family-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      setForm((p) => ({ ...p, id_doc_url: path }));
      toast.success("Cédula adjuntada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  };

  const viewDoc = async () => {
    if (!form.id_doc_url) return;
    const { data } = await supabase.storage
      .from("family-docs")
      .createSignedUrl(form.id_doc_url, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const save = async () => {
    if (!form.full_name.trim()) return toast.error("Nombre completo requerido");
    if (!/^\d{6,15}$/.test(form.id_number.trim()))
      return toast.error("Número de cédula inválido");
    if (!/^\+?\d{7,15}$/.test(form.phone.trim())) return toast.error("Celular inválido");
    setSaving(true);
    try {
      const { error: e1 } = await supabase
        .from("profiles")
        .update({ full_name: form.full_name.trim(), phone: form.phone.trim() })
        .eq("user_id", userId);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("family_profiles").upsert(
        {
          user_id: userId,
          id_number: form.id_number.trim(),
          whatsapp: form.whatsapp.trim() || form.phone.trim(),
          default_address: form.default_address.trim() || null,
          id_doc_url: form.id_doc_url,
        },
        { onConflict: "user_id" },
      );
      if (e2) throw e2;
      toast.success("✅ Perfil guardado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando perfil…
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-fuchsia-neural" /> Mis datos de contacto
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Necesarios para que los profesionales puedan coordinar el servicio.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" icon={User} required>
          <Input
            value={form.full_name}
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Ej. María Pérez Rodríguez"
          />
        </Field>
        <Field label="Número de cédula" icon={IdCard} required>
          <Input
            inputMode="numeric"
            value={form.id_number}
            onChange={(e) =>
              setForm((p) => ({ ...p, id_number: e.target.value.replace(/\D/g, "") }))
            }
            placeholder="1010101010"
          />
        </Field>
        <Field label="Celular" icon={Phone} required>
          <Input
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            placeholder="+57 300 000 0000"
          />
        </Field>
        <Field label="WhatsApp" icon={MessageCircle}>
          <Input
            inputMode="tel"
            value={form.whatsapp}
            onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))}
            placeholder="Igual al celular si lo dejas vacío"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Dirección" icon={MapPin}>
            <Input
              value={form.default_address}
              onChange={(e) => setForm((p) => ({ ...p, default_address: e.target.value }))}
              placeholder="Calle 123 #45-67, Barrio, Ciudad"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <IdCard className="h-4 w-4 mt-0.5 text-fuchsia-neural" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Fotocopia de cédula</p>
            <p className="text-[11px] text-muted-foreground">
              Adjunta PDF o foto (frente y reverso). Máx. 15MB.
            </p>
          </div>
          {form.id_doc_url && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Adjuntada
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="glass"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 text-xs">Subir archivo (PDF/Foto)</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="glass"
            disabled={uploading}
            onClick={() => camRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" />
            <span className="ml-1.5 text-xs">Tomar foto</span>
          </Button>
          {form.id_doc_url && (
            <Button type="button" size="sm" variant="ghost" onClick={viewDoc}>
              <FileText className="h-3.5 w-3.5" />
              <span className="ml-1.5 text-xs">Ver</span>
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span className="ml-1.5">Guardar datos</span>
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  icon: Icon,
  required,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
    </div>
  );
}