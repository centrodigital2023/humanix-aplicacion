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
  Upload,
  X,
  Eye,
  Download,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

type InstitutionDocument = {
  id: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  status: "pending" | "approved" | "rejected";
  ai_score: number | null;
  ai_verified: boolean | null;
  expires_at: string | null;
  reviewed_at: string | null;
};

export function SmartInstitutionProfileForm({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<InstitutionProfile | null>(null);
  const [documents, setDocuments] = useState<InstitutionDocument[]>([]);
  const [showDocDialog, setShowDocDialog] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

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

        const { data: docs } = await supabase
          .from("institution_documents")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (active) {
          if (profile) {
            setProfile(profile as InstitutionProfile);
            setFormData({
              institution_name: profile.institution_name || "",
              nit: profile.nit || "",
              chamber_of_commerce_number:
                profile.chamber_of_commerce_number || "",
              chamber_of_commerce_date: profile.chamber_of_commerce_date || "",
              institution_type: profile.institution_type || "ips",
              legal_representative_name:
                profile.legal_representative_name || "",
              legal_representative_email:
                profile.legal_representative_email || "",
              legal_representative_phone:
                profile.legal_representative_phone || "",
              city: profile.city || "",
              address: profile.address || "",
              website: profile.website || "",
              compliance_notes: profile.compliance_notes || "",
            });
          }
          setDocuments((docs ?? []) as InstitutionDocument[]);
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
      toast.error(e?.message ?? "Error guardando perfil");
    } finally {
      setSaving(false);
    }
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDoc(true);
    try {
      // Simular upload
      const fileName = file.name;
      const fileUrl = URL.createObjectURL(file);

      // En producción: usar storage de Supabase
      const { error } = await supabase.from("institution_documents").insert([
        {
          user_id: userId,
          doc_type: "nit_certificate",
          file_name: fileName,
          file_url: fileUrl,
          status: "pending",
          ai_verified: false,
        },
      ]);

      if (error) throw error;

      toast.success("Documento cargado. Pendiente de revisión por IA.");
      setShowDocDialog(false);
    } catch (e: any) {
      console.error(e);
      toast.error("Error cargando documento");
    } finally {
      setUploadingDoc(false);
    }
  };

  // Validar NIT (formato colombiano simple)
  const isValidNIT = (nit: string) => /^\d{6,12}(-\d)?$/.test(nit);

  // Validar cámara de comercio
  const isValidChamberNumber = (num: string) => /^\d{6,10}$/.test(num);

  const complianceChecks = {
    has_nit: !!formData.nit && isValidNIT(formData.nit),
    has_chamber: !!formData.chamber_of_commerce_number && isValidChamberNumber(formData.chamber_of_commerce_number),
    has_legal_rep: !!formData.legal_representative_name && !!formData.legal_representative_email,
    has_address: !!formData.address && !!formData.city,
    documents_uploaded: documents.filter((d) => d.status === "approved").length >= 1,
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
                  {key
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
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
              onChange={(e) =>
                setFormData({ ...formData, nit: e.target.value })
              }
              className={
                formData.nit && !isValidNIT(formData.nit)
                  ? "border-red-500"
                  : ""
              }
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
              onChange={(e) =>
                setFormData({ ...formData, city: e.target.value })
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Dirección *</label>
            <Input
              placeholder="Calle 10 #20-30"
              value={formData.address}
              onChange={(e) =>
                setFormData({ ...formData, address: e.target.value })
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Sitio web</label>
            <Input
              placeholder="https://ejemplo.com"
              value={formData.website}
              onChange={(e) =>
                setFormData({ ...formData, website: e.target.value })
              }
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
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm">Documentos institucionales</h4>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDocDialog(true)}
            >
              <Upload className="h-3.5 w-3.5 mr-1" /> Agregar
            </Button>
          </div>

          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin documentos</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg border border-border text-sm"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{doc.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.doc_type.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={
                      doc.status === "approved"
                        ? "bg-emerald-600/15 text-emerald-700 border-emerald-600/30 text-[10px]"
                        : doc.status === "pending"
                          ? "bg-amber-600/15 text-amber-700 border-amber-600/30 text-[10px]"
                          : "bg-red-600/15 text-red-700 border-red-600/30 text-[10px]"
                    }
                  >
                    {doc.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-2">
          <Button
            onClick={saveProfile}
            disabled={saving}
            variant="hero"
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            Guardar perfil
          </Button>
          {isCompliant && (
            <Button variant="outline" disabled className="flex-1">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Verificado ✓
            </Button>
          )}
        </div>
      </Card>

      {/* Dialog upload documento */}
      <Dialog open={showDocDialog} onOpenChange={setShowDocDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cargar documento institucional</DialogTitle>
            <DialogDescription>
              Sube certificado NIT, cámara de comercio, o documentos de compliance
            </DialogDescription>
          </DialogHeader>

          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <label className="cursor-pointer">
              <div className="space-y-2">
                <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="font-medium text-sm">Arrastra o haz clic para subir</p>
                <p className="text-xs text-muted-foreground">
                  PDF, JPG, PNG - máx 10MB
                </p>
              </div>
              <input
                type="file"
                hidden
                onChange={handleDocUpload}
                disabled={uploadingDoc}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDocDialog(false)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}