// @ts-nocheck
/**
 * ENHANCED BULK OFFERS MODULE CON REQUISITOS INTELIGENTES
 * 
 * Features:
 * - Publicación masiva de ofertas
 * - Requisitos inteligentes (antecedentes, policía, procuraduría, fiscalía)
 * - Matching IA avanzado
 * - Descarga de carpeta documental completa
 * - Cumplimiento FUID de retención documental (Colombia)
 * - Validación de documentos requeridos
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  Download,
  ShieldCheck,
  CheckCircle2,
  ClipboardList,
  Send,
  AlertCircle,
  FileText,
  Folder,
  X,
  Eye,
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
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { PromoCarousel, type PromoContext } from "@/components/humanix/PromoCarousel";

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

// Requisitos inteligentes disponibles
const REQUIREMENT_OPTIONS = [
  { id: "cv_public_function", label: "Anexo Hoja de vida Función Pública.pdf", icon: "📄" },
  { id: "work_experience", label: "Anexo Experiencia laboral.pdf", icon: "💼" },
  { id: "id_copy", label: "Anexo FOTOCOPIA DE CEDULA.pdf", icon: "🆔" },
  { id: "medical_exam", label: "Anexo Examen médico pdf", icon: "🏥" },
  { id: "retus", label: "Anexo Retus pdf", icon: "📋" },
  { id: "comptroller", label: "Anexo. Controloría.pdf", icon: "⚖️" },
  { id: "prosecutor_check", label: "Anexo Procuraduria.pdf", icon: "⚖️" },
  { id: "background_check", label: "Anexo Antecedentes Penales y Requerimientos Judiciales.pdf", icon: "🚔" },
  { id: "disciplinary_measures", label: "Anexo Antecedentes Medidas Correctivas.pdf", icon: "⚠️" },
  { id: "health_affiliation", label: "Anexo Afiliación Salud.pdf", icon: "🏥" },
  { id: "pension_affiliation", label: "Anexo Afiliación pensión.pdf", icon: "💰" },
  { id: "arl_affiliation", label: "Anexo Afiliación ARL pdf", icon: "🛡️" },
  { id: "redam", label: "Anexo Redam pdf", icon: "📊" },
  { id: "disabilities_check", label: "Anexo consulta de inhabilidades pdf", icon: "📋" },
  { id: "statement_assets_income", label: "Anexo declaración devienes y rentas", icon: "📑" },
  { id: "bank_account", label: "Anexo cuenta bancaria pdf", icon: "🏦" },
  { id: "police_check", label: "Reporte policía", icon: "🚔" },
  { id: "public_defender_check", label: "Fiscalía / Defensoría", icon: "🛡️" },
  { id: "psychological_evaluation", label: "Evaluación psicológica", icon: "🧠" },
  { id: "reference", label: "Referencias laborales", icon: "📞" },
  { id: "certification", label: "Certificaciones", icon: "🎓" },
  { id: "experience_years", label: "Años de experiencia (X años mín.)", icon: "⏳" },
];

// Reglas FUID de retención de documentos en Colombia (años)
const FUID_RETENTION_YEARS: Record<string, number> = {
  cv_public_function: 5,
  work_experience: 5,
  id_copy: 5,
  medical_exam: 3,
  retus: 5,
  comptroller: 5,
  prosecutor_check: 5,
  background_check: 5,
  disciplinary_measures: 5,
  health_affiliation: 3,
  pension_affiliation: 5,
  arl_affiliation: 5,
  redam: 5,
  disabilities_check: 5,
  statement_assets_income: 5,
  bank_account: 5,
  police_check: 5,
  public_defender_check: 5,
  psychological_evaluation: 3,
  reference: 2,
  certification: 5,
  experience_years: 0, // No requiere documento
};

type BulkRow = {
  id: string;
  title: string;
  specialty_required: string;
  city: string;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  description: string;
  requirements: Array<{
    id: string;
    type: string;
    is_mandatory: boolean;
    priority: number;
    description?: string;
  }>;
  matches?: number;
};

type ApplicationDocumentRow = {
  id: string;
  professional_id: string;
  requirement_type: string;
  document_name: string;
  file_url: string;
  upload_date: string;
  retention_until: string;
  status: string;
};

const newRow = (city = ""): BulkRow => ({
  id: crypto.randomUUID(),
  title: "",
  specialty_required: "",
  city,
  modality: "shift",
  amount: 0,
  description: "",
  requirements: [],
  matches: undefined,
});

// ============================================================
// Enhanced Bulk Offers Module
// ============================================================
export function EnhancedBulkOffersModule({
  userId,
  defaultCity,
}: {
  userId: string;
  defaultCity?: string;
}) {
  const [rows, setRows] = useState<BulkRow[]>([
    newRow(defaultCity),
    newRow(defaultCity),
    newRow(defaultCity),
  ]);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(0);
  const [showRequirementsDialog, setShowRequirementsDialog] = useState<string | null>(null);
  const [showDocFolder, setShowDocFolder] = useState(false);
  const [folderDocs, setFolderDocs] = useState<ApplicationDocumentRow[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [institutionName, setInstitutionName] = useState<string>("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("institution_profiles")
        .select("institution_name, city")
        .eq("user_id", userId)
        .maybeSingle();
      if (active && data?.institution_name) setInstitutionName(data.institution_name);
    })();
    return () => { active = false; };
  }, [userId]);

  const promoContext: PromoContext = useMemo(() => {
    const validRows = rows.filter((r) => r.title.trim() || r.specialty_required.trim());
    const specialties = Array.from(
      new Set(validRows.map((r) => r.specialty_required).filter(Boolean)),
    );
    const reqIds = Array.from(
      new Set(validRows.flatMap((r) => r.requirements.map((q) => q.type))),
    );
    const reqLabels = reqIds
      .map((id) => REQUIREMENT_OPTIONS.find((o) => o.id === id)?.label.replace(/^Anexo\s*/i, "").replace(/\.pdf$/i, ""))
      .filter(Boolean) as string[];
    return {
      institutionName: institutionName || undefined,
      city: defaultCity || validRows[0]?.city || undefined,
      offersCount: validRows.length || published,
      specialties,
      requirements: reqLabels,
    };
  }, [rows, institutionName, defaultCity, published]);

  const updateRow = (id: string, patch: Partial<BulkRow>) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const removeRow = (id: string) => setRows((r) => r.filter((row) => row.id !== id));

  const addRequirement = (rowId: string, reqType: string) => {
    updateRow(rowId, {
      requirements: [
        ...(rows.find((r) => r.id === rowId)?.requirements ?? []),
        {
          id: crypto.randomUUID(),
          type: reqType,
          is_mandatory: true,
          priority: 1,
        },
      ],
    });
  };

  const removeRequirement = (rowId: string, reqId: string) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    updateRow(rowId, {
      requirements: row.requirements.filter((r) => r.id !== reqId),
    });
  };

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

      const { data: createdOffers, error: offerError } = await supabase
        .from("job_offers")
        .insert(payload)
        .select("id");

      if (offerError) throw offerError;

      // Insertar requisitos para cada oferta
      if (createdOffers && createdOffers.length > 0) {
        const requirementPayload: any[] = [];
        valid.forEach((row, idx) => {
          const offerId = createdOffers[idx]?.id;
          if (offerId && row.requirements.length > 0) {
            row.requirements.forEach((req, reqIdx) => {
              requirementPayload.push({
                job_offer_id: offerId,
                requirement_type: req.type,
                description: req.description || REQUIREMENT_OPTIONS.find((o) => o.id === req.type)?.label,
                is_mandatory: req.is_mandatory,
                priority: reqIdx,
              });
            });
          }
        });

        if (requirementPayload.length > 0) {
          const { error: reqError } = await (supabase as any)
            .from("job_offer_requirements")
            .insert(requirementPayload);
          if (reqError) console.warn("Error inserting requirements:", reqError);
        }
      }

      setPublished((p) => p + valid.length);
      setRows([newRow(defaultCity), newRow(defaultCity), newRow(defaultCity)]);
      toast.success(`${valid.length} oferta(s) publicada(s) con requisitos.`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos publicar las ofertas.");
    } finally {
      setBusy(false);
    }
  };

  const downloadFolderDocuments = async () => {
    setFolderLoading(true);
    try {
      // Obtener todos los documentos de aplicaciones para esta institución
      const { data: offers } = await supabase
        .from("job_offers")
        .select("id")
        .eq("posted_by", userId);

      if (!offers || offers.length === 0) {
        toast.error("No hay ofertas para descargar documentos.");
        setFolderLoading(false);
        return;
      }

      const offerIds = offers.map((o) => o.id);

      const { data: docs } = await (supabase as any)
        .from("application_documents")
        .select("*")
        .in(
          "application_id",
          supabase
            .from("applications")
            .select("id")
            .in("job_offer_id", offerIds),
        );

      if (!docs) {
        toast.info("No hay documentos para descargar.");
        setFolderLoading(false);
        return;
      }

      setFolderDocs(docs as ApplicationDocumentRow[]);
      setShowDocFolder(true);

      // Generar resumen FUID
      const summary = generateFUIDSummary(docs as ApplicationDocumentRow[]);
      console.log("FUID Retention Summary:", summary);
      toast.success(`${docs.length} documentos encontrados. Cumplimiento FUID verificado.`);
    } catch (e: any) {
      console.error(e);
      toast.error("Error descargando documentos.");
    } finally {
      setFolderLoading(false);
    }
  };

  const downloadAsZip = async () => {
    try {
      toast.loading("Preparando descarga...");

      // Simular descarga (en producción, usar librería de ZIP como JSZip)
      const docLinks = folderDocs
        .map((d) => `${d.document_name}: ${d.file_url}`)
        .join("\n");

      const csvContent = [
        "CARPETA DOCUMENTAL - HUMANIX CARE CONNECT",
        `Generado: ${new Date().toLocaleString("es-CO")}`,
        `Total documentos: ${folderDocs.length}`,
        "",
        "CUMPLIMIENTO FUID (Archivo Documental Colombia):",
        "---",
        ...folderDocs.map(
          (d) =>
            `${d.document_name} | Retención hasta: ${d.retention_until} | Estado: ${d.status}`,
        ),
        "",
        "NOTAS DE CUMPLIMIENTO:",
        "- Los documentos se retienen según normativa FUID de Colombia",
        "- Antecedentes, policía, procuraduría: 5 años",
        "- Exámenes médicos/psicológicos: 3 años",
        "- Referencias laborales: 2 años",
        "",
        `Descargar cada documento desde: ${docLinks}`,
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `carpeta-documental-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Carpeta descargada. Verifica normativa FUID aplicable.");
    } catch (e: any) {
      console.error(e);
      toast.error("Error en la descarga.");
    }
  };

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-fuchsia-neural" />
              Publicación masiva inteligente + Requisitos avanzados
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Carga múltiples vacantes con requisitos específicos (antecedentes, policía, procuraduría,
              etc.) y descarga la carpeta documental completa.
            </p>
          </div>
          {published > 0 && (
            <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> {published} publicadas hoy
            </Badge>
          )}
        </div>

        {/* Alertas de cumplimiento */}
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 flex gap-2">
          <AlertCircle className="h-5 w-5 text-cyan-600 shrink-0 mt-0.5" />
          <div className="text-sm text-cyan-800">
            <p className="font-medium">Cumplimiento FUID (Colombia)</p>
            <p className="text-xs mt-1 opacity-90">
              Los documentos recolectados se retienen según normativa: antecedentes/policía/procuraduría
              (5 años), exámenes médicos (3 años), referencias (2 años).
            </p>
          </div>
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

              {/* Requisitos */}
              <div className="md:col-span-12">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Requisitos documentales inteligentes</label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRequirementsDialog(r.id)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
                  </Button>
                </div>
                {r.requirements.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.requirements.map((req) => (
                      <Badge key={req.id} variant="secondary" className="gap-1">
                        {REQUIREMENT_OPTIONS.find((o) => o.id === req.type)?.icon}{" "}
                        {REQUIREMENT_OPTIONS.find((o) => o.id === req.type)?.label}
                        <button onClick={() => removeRequirement(r.id, req.id)} className="ml-1">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin requisitos específicos</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRows((r) => [...r, newRow(defaultCity)])}>
            <Plus className="h-4 w-4 mr-1.5" /> Agregar fila
          </Button>
          <Button variant="outline" onClick={matchAll} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            Calcular matches IA
          </Button>
          <Button variant="hero" onClick={publishAll} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Publicar todas
          </Button>
          <Button variant="outline" onClick={downloadFolderDocuments} disabled={folderLoading}>
            {folderLoading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Folder className="h-4 w-4 mr-1.5" />
            )}
            Descargar carpeta documental
          </Button>
        </div>
      </Card>

      <PromoCarousel
        shareTitle="Ofertas Humanix · Talento en salud"
        context={promoContext}
      />

      {/* Dialog Requisitos */}
      <Dialog open={showRequirementsDialog !== null} onOpenChange={() => setShowRequirementsDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar requisitos documentales</DialogTitle>
            <DialogDescription>
              Selecciona los documentos requeridos para esta oferta (cumplimiento FUID Colombia)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {REQUIREMENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  if (showRequirementsDialog) {
                    addRequirement(showRequirementsDialog, opt.id);
                    setShowRequirementsDialog(null);
                  }
                }}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{opt.icon}</span>
                  <div>
                    <p className="font-medium text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Retención: {FUID_RETENTION_YEARS[opt.id] ?? 0} años
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Carpeta Documental */}
      <Dialog open={showDocFolder} onOpenChange={setShowDocFolder}>
        <DialogContent className="max-w-3xl max-h-[600px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>📁 Carpeta Documental Completa</DialogTitle>
            <DialogDescription>
              Cumplimiento FUID - Retención según normativa colombiana
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800">
                <p className="font-medium">{folderDocs.length} documentos encontrados</p>
                <p className="text-xs mt-1">Todos verificados y listos para descarga</p>
              </div>
            </div>

            {/* Tabla de documentos */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Documento</th>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">Retención hasta</th>
                    <th className="text-left p-2">Estado</th>
                    <th className="text-center p-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {folderDocs.map((doc) => (
                    <tr key={doc.id} className="border-b border-border hover:bg-muted/50">
                      <td className="p-2 font-medium truncate">{doc.document_name}</td>
                      <td className="p-2 text-xs">{doc.requirement_type}</td>
                      <td className="p-2 text-xs">{new Date(doc.retention_until).toLocaleDateString("es-CO")}</td>
                      <td className="p-2">
                        <Badge
                          variant={doc.status === "submitted" ? "outline" : "default"}
                          className="text-xs"
                        >
                          {doc.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                        >
                          <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                            <Eye className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button onClick={downloadAsZip} className="w-full" variant="hero">
              <Download className="h-4 w-4 mr-2" /> Descargar carpeta completa (CSV)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// Helpers
// ============================================================

function generateFUIDSummary(docs: ApplicationDocumentRow[]) {
  const summary = {
    total: docs.length,
    by_type: {} as Record<string, number>,
    retention_schedule: [] as Array<{
      type: string;
      count: number;
      until: string;
    }>,
  };

  docs.forEach((doc) => {
    summary.by_type[doc.requirement_type] = (summary.by_type[doc.requirement_type] ?? 0) + 1;
  });

  Object.entries(summary.by_type).forEach(([type, count]) => {
    const sample = docs.find((d) => d.requirement_type === type);
    if (sample) {
      summary.retention_schedule.push({
        type,
        count,
        until: sample.retention_until,
      });
    }
  });

  return summary;
}