// @ts-nocheck
/**
 * SMART INSTITUTION PROFILE FORM
 *
 * Features:
 * - Formulario inteligente con validación FUID
 * - NIT y cámara de comercio
 * - Documentos de compliance
 * - Verificación de datos
 * - Integración con AI
 */

import { useEffect, useState } from "react";
import {
  Loader2,
  Building2,
  FileCheck,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Save,
} from "lucide-react";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendlyError";
import { InstitutionDocumentsManager } from "@/components/humanix/InstitutionDocumentsManager";
import { missingApprovedDocs, type InstitutionDocument } from "@/lib/institutionDocuments";

type InstitutionProfile = {
  user_id: string;
  institution_name: string;
  nit: string | null;
  chamber_of_commerce_number: string | null;
  chamber_of_commerce_date: string | null;
  institution_type: string | null;
  legal_representative_name: string | null;
  legal_representative_email: string | null;
  legal_representative_phone: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  compliance_fuid: boolean;
  compliance_notes: string | null;
  verified: boolean;
  created_at: string;
};

export function SmartInstitutionProfileForm({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<InstitutionProfile | null>(null);
  const [documents, setDocuments] = useState<InstitutionDocument[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    institution_name: "",
    nit: "",
    chamber_of_commerce_number: "",
    chamber_of_commerce_date: "",
    institution_type: "ips", // ips, clinica, foundation, etc
    legal_representative_name: "",
    legal_representative_email: "",
    legal_representative_phone: "",
    city: "",
    address: "",
    website: "",
    compliance_notes: "",
  });

  // Cargar perfil
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: profile } = await supabase
          .from("institution_profiles")
          .select("*")
          .eq("user_id", userId)
          .single();

        if (active) {
          if (profile) {
            setProfile(profile as InstitutionProfile);
            setFormData({
              institution_name: profile.institution_name || "",
              nit: profile.nit || "",
              chamber_of_commerce_number: profile.chamber_of_commerce_number || "",
              chamber_of_commerce_date: profile.chamber_of_commerce_date || "",
              institution_type: profile.institution_type || "ips",
              legal_representative_name: profile.legal_representative_name || "",
              legal_representative_email: profile.legal_representative_email || "",
              legal_representative_phone: profile.legal_representative_phone || "",
              city: profile.city || "",
              address: profile.address || "",
              website: profile.website || "",
              compliance_notes: profile.compliance_notes || "",
            });
          }
        }
      } catch (e) {
        console.error("[institution profile] load failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      if (!profile) {
        // Crear nuevo perfil
        const { error } = await supabase.from("institution_profiles").insert([
          {
            user_id: userId,
            institution_name: formData.institution_name,
            nit: formData.nit || null,
            chamber_of_commerce_number: formData.chamber_of_commerce_number || null,
            chamber_of_commerce_date: formData.chamber_of_commerce_date || null,
            institution_type: formData.institution_type,
            legal_representative_name: formData.legal_representative_name || null,
            legal_representative_email: formData.legal_representative_email || null,
            legal_representative_phone: formData.legal_representative_phone || null,
            city: formData.city || null,
            address: formData.address || null,
            website: formData.website || null,
            compliance_notes: formData.compliance_notes || null,
            compliance_fuid: true,
          },
        ]);
        if (error) throw error;
      } else {
        // Actualizar perfil
        const { error } = await supabase
          .from("institution_profiles")
          .update({
            institution_name: formData.institution_name,
            nit: formData.nit || null,
            chamber_of_commerce_number: formData.chamber_of_commerce_number || null,
            chamber_of_commerce_date: formData.chamber_of_commerce_date || null,
            institution_type: formData.institution_type,
            legal_representative_name: formData.legal_representative_name || null,
            legal_representative_email: formData.legal_representative_email || null,
            legal_representative_phone: formData.legal_representative_phone || null,
            city: formData.city || null,
            address: formData.address || null,
            website: formData.website || null,
            compliance_notes: formData.compliance_notes || null,
            compliance_fuid: true,
          })
          .eq("user_id", userId);

        if (error) throw error;
      }

      toast.success("Perfil guardado exitosamente");
    } catch (e: any) {
      console.error(e);
      toast.error(friendlyError(e, "Error guardando perfil"));
    } finally {
      setSaving(false);
    }
  };

  // Validar NIT (formato colombiano simple)
  const isValidNIT = (nit: string) => /^\d{6,12}(-\d)?$/.test(nit);

  // Validar cámara de comercio
  const isValidChamberNumber = (num: string) => /^\d{6,10}$/.test(num);

  const complianceChecks = {
    has_nit: !!formData.nit && isValidNIT(formData.nit),
    has_chamber:
      !!formData.chamber_of_commerce_number &&
      isValidChamberNumber(formData.chamber_of_commerce_number),
    has_legal_rep: !!formData.legal_representative_name && !!formData.legal_representative_email,
    has_address: !!formData.address && !!formData.city,
    documents_approved: missingApprovedDocs(documents).length === 0,
  };

  const complianceScore = Object.values(complianceChecks).filter(Boolean).length;
  const isCompliant = complianceScore === 5;

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
      </Card>
    );
  }

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-fuchsia-neural" />
              Perfil de institución
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Información oficial, compliance y documentación.
            </p>
          </div>
        </div>

        {/* Estado de cumplimiento */}
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm text-cyan-900">
              Cumplimiento FUID: {complianceScore}/5
            </p>
            <Badge
              className={
                isCompliant
                  ? "bg-emerald-600/15 text-emerald-700 border-emerald-600/30"
                  : "bg-amber-600/15 text-amber-700 border-amber-600/30"
              }
            >
              {isCompliant ? "✓ Compliant" : "Incompleto"}
            </Badge>
          </div>
          <div className="space-y-1 text-sm">
            {Object.entries(complianceChecks).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                {val ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                )}
                <span className={val ? "text-emerald-700" : "text-amber-700"}>
                  {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Formulario */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Nombre institución *</label>
            <Input
              placeholder="IPS / Clínica"
              value={formData.institution_name}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  institution_name: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">NIT *</label>
            <Input
              placeholder="ej: 830001234-5"
              value={formData.nit}
              onChange={(e) => setFormData({ ...formData, nit: e.target.value })}
              className={formData.nit && !isValidNIT(formData.nit) ? "border-red-500" : ""}
            />
            {formData.nit && !isValidNIT(formData.nit) && (
              <p className="text-xs text-red-600 mt-1">Formato NIT inválido</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">Cámara de comercio *</label>
            <Input
              placeholder="Número de registro"
              value={formData.chamber_of_commerce_number}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  chamber_of_commerce_number: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">Fecha cámara comercio</label>
            <Input
              type="date"
              value={formData.chamber_of_commerce_date}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  chamber_of_commerce_date: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">Representante legal *</label>
            <Input
              placeholder="Nombre completo"
              value={formData.legal_representative_name}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  legal_representative_name: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">Email representante *</label>
            <Input
              type="email"
              placeholder="email@example.com"
              value={formData.legal_representative_email}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  legal_representative_email: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">Teléfono representante</label>
            <Input
              placeholder="+57 300 000 0000"
              value={formData.legal_representative_phone}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  legal_representative_phone: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">Ciudad *</label>
            <Input
              placeholder="Bogotá"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Dirección *</label>
            <Input
              placeholder="Calle 10 #20-30"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Sitio web</label>
            <Input
              placeholder="https://ejemplo.com"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Notas de cumplimiento</label>
            <Textarea
              placeholder="Información adicional sobre compliance, certificaciones, etc."
              rows={3}
              value={formData.compliance_notes}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  compliance_notes: e.target.value,
                })
              }
            />
          </div>
        </div>

        {/* Documentos */}
        <div>
          <h4 className="font-semibold text-sm mb-2">Documentos institucionales</h4>
          <InstitutionDocumentsManager
            userId={userId}
            verified={!!profile?.verified}
            onDocsChange={setDocuments}
          />
        </div>

        {/* Botones */}
        <div className="flex gap-2">
          <Button onClick={saveProfile} disabled={saving} variant="hero" className="flex-1">
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            Guardar perfil
          </Button>
          {profile?.verified && (
            <Button variant="outline" disabled className="flex-1">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Verificado ✓
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}
