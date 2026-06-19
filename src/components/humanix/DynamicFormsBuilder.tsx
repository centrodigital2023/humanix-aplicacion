// @ts-nocheck
/**
 * DYNAMIC FORMS BUILDER - PROFESIONALES / OFERTAS
 * 
 * Features:
 * - Constructor de formularios dinámicos
 * - Campos personalizables por oferta
 * - Validación inteligente
 * - Preguntas condicionales
 * - Almacenamiento de respuestas
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Edit,
  Save,
  Eye,
  X,
  Copy,
  Settings,
  AlertCircle,
  CheckCircle2,
  Type,
  FileText,
  Radio,
  ListChecks,
  Calendar,
  MapPin,
} from "lucide-react";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type FormField = {
  id: string;
  field_type: "text" | "email" | "textarea" | "select" | "radio" | "checkbox" | "date" | "file";
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
  options?: Array<{ value: string; label: string }>;
  conditional?: {
    field_id: string;
    value: string;
  };
  ai_validation?: string; // ej: "validar como número de teléfono"
};

type DynamicForm = {
  id: string;
  name: string;
  description: string | null;
  target_type: "job_offer" | "professional_application" | "institution";
  target_id: string;
  fields: FormField[];
  responses_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type FormResponse = {
  id: string;
  form_id: string;
  respondent_id: string;
  respondent_name: string | null;
  response_data: Record<string, any>;
  submitted_at: string;
  ai_score: number | null;
  ai_notes: string | null;
};

export function DynamicFormsBuilder({ offerId, userId }: { offerId: string; userId: string }) {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<DynamicForm[]>([]);
  const [selectedForm, setSelectedForm] = useState<DynamicForm | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);

  // Form creation state
  const [newFormName, setNewFormName] = useState("");
  const [newFormDesc, setNewFormDesc] = useState("");
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [editingField, setEditingField] = useState<FormField | null>(null);

  // Cargar formularios
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("dynamic_forms")
          .select("*")
          .eq("target_id", offerId)
          .order("created_at", { ascending: false });

        if (active) {
          setForms(
            data?.map((f: any) => ({
              ...f,
              fields: f.fields || [],
            })) ?? []
          );
        }
      } catch (e) {
        console.error("[forms] load failed", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [offerId]);

  // Cargar respuestas de formulario seleccionado
  useEffect(() => {
    if (!selectedForm) return;

    let active = true;
    (async () => {
      setLoadingResponses(true);
      try {
        const { data } = await (supabase as any)
          .from("form_responses")
          .select("*")
          .eq("form_id", selectedForm.id)
          .order("submitted_at", { ascending: false });

        if (active) {
          setResponses((data ?? []) as FormResponse[]);
        }
      } catch (e) {
        console.error("[form responses] load failed", e);
      } finally {
        if (active) setLoadingResponses(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedForm]);

  const createForm = async () => {
    if (!newFormName) {
      toast.error("Nombre del formulario requerido");
      return;
    }

    try {
      const { data, error } = await (supabase as any)
        .from("dynamic_forms")
        .insert([
          {
            name: newFormName,
            description: newFormDesc,
            target_type: "job_offer",
            target_id: offerId,
            fields: formFields,
            is_active: true,
          },
        ])
        .select();

      if (error) throw error;

      if (data) {
        setForms((prev) => [...prev, ...data]);
        setShowCreateForm(false);
        setNewFormName("");
        setNewFormDesc("");
        setFormFields([]);
        toast.success("Formulario creado");
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Error creando formulario");
    }
  };

  const addField = () => {
    const newField: FormField = {
      id: crypto.randomUUID(),
      field_type: "text",
      label: "Nuevo campo",
      placeholder: "",
      required: false,
      order: formFields.length,
    };
    setFormFields((prev) => [...prev, newField]);
    setEditingField(newField);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFormFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const removeField = (id: string) => {
    setFormFields((prev) => prev.filter((f) => f.id !== id));
  };

  const deleteForm = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from("dynamic_forms")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setForms((prev) => prev.filter((f) => f.id !== id));
      setSelectedForm(null);
      toast.success("Formulario eliminado");
    } catch (e: any) {
      console.error(e);
      toast.error("Error eliminando formulario");
    }
  };

  const templates = [
    {
      name: "Verificación de antecedentes",
      fields: [
        {
          label: "¿Tiene antecedentes penales?",
          type: "radio",
          options: ["Sí", "No", "Prefiero no responder"],
        },
        {
          label: "Certificado de antecedentes",
          type: "file",
          required: true,
        },
        {
          label: "Fecha del certificado",
          type: "date",
          required: true,
        },
      ],
    },
    {
      name: "Validación de referencias",
      fields: [
        {
          label: "Referencia 1: Nombre",
          type: "text",
          required: true,
        },
        {
          label: "Referencia 1: Teléfono",
          type: "text",
          required: true,
        },
        {
          label: "Referencia 1: Relación laboral",
          type: "select",
          options: ["Jefe directo", "Compañero", "Subordinado", "Cliente"],
        },
      ],
    },
    {
      name: "Información de disponibilidad",
      fields: [
        {
          label: "Ciudades donde puede trabajar",
          type: "checkbox",
          options: [
            "Bogotá",
            "Medellín",
            "Cali",
            "Barranquilla",
            "Cartagena",
          ],
        },
        {
          label: "Horarios disponibles",
          type: "radio",
          options: ["Mañana", "Tarde", "Noche", "Flexible"],
        },
      ],
    },
  ];

  const FIELD_TYPES = [
    { value: "text", label: "Texto", icon: Type },
    { value: "email", label: "Email", icon: Type },
    { value: "textarea", label: "Párrafo", icon: FileText },
    { value: "select", label: "Selección", icon: Type },
    { value: "radio", label: "Opción única", icon: Radio },
    { value: "checkbox", label: "Múltiples", icon: ListChecks },
    { value: "date", label: "Fecha", icon: Calendar },
    { value: "file", label: "Archivo", icon: Type },
  ];

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
              <Settings className="h-5 w-5 text-fuchsia-neural" />
              Constructor de formularios dinámicos
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Crea formularios personalizados con validación IA para aplicantes.
            </p>
          </div>
        </div>

        {/* Lista de formularios o creación */}
        {forms.length === 0 ? (
          <div className="text-center py-6">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-semibold text-sm">No hay formularios aún</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crea uno personalizado o usa una plantilla
            </p>
            <div className="flex gap-2 justify-center mt-3">
              <Button size="sm" onClick={() => setShowCreateForm(true)} variant="hero">
                <Plus className="h-3.5 w-3.5 mr-1" /> Crear formulario
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {forms.map((form) => (
              <button
                key={form.id}
                onClick={() => setSelectedForm(form)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedForm?.id === form.id
                    ? "border-fuchsia-neural bg-fuchsia-neural/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{form.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {form.fields.length} campos · {form.responses_count} respuestas
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowEditForm(true);
                        setSelectedForm(form);
                      }}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteForm(form.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </button>
            ))}
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setShowCreateForm(true)}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Agregar formulario
            </Button>
          </div>
        )}

        {/* Respuestas del formulario seleccionado */}
        {selectedForm && (
          <div className="mt-6 pt-4 border-t space-y-3">
            <h4 className="font-semibold text-sm">
              Respuestas ({responses.length})
            </h4>
            {loadingResponses ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              </div>
            ) : responses.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin respuestas aún</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {responses.map((resp) => (
                  <div
                    key={resp.id}
                    className="p-2 rounded-lg border border-border text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{resp.respondent_name}</p>
                      {resp.ai_score && (
                        <Badge variant="outline" className="text-xs">
                          Puntuación IA: {(resp.ai_score * 100).toFixed(0)}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(resp.submitted_at).toLocaleString("es-CO")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Dialog crear formulario */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[600px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear formulario dinámico</DialogTitle>
            <DialogDescription>
              Construye un formulario personalizado o elige una plantilla
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Nombre */}
            <div>
              <label className="text-sm font-medium">Nombre del formulario</label>
              <Input
                placeholder="ej: Validación de antecedentes"
                value={newFormName}
                onChange={(e) => setNewFormName(e.target.value)}
              />
            </div>

            {/* Plantillas */}
            <div>
              <label className="text-sm font-medium">Plantillas rápidas</label>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {templates.map((template) => (
                  <button
                    key={template.name}
                    onClick={() => {
                      setNewFormName(template.name);
                      setFormFields(
                        template.fields.map((f, i) => ({
                          id: crypto.randomUUID(),
                          field_type: f.type as FormField["field_type"],
                          label: f.label,
                          placeholder: "",
                          required: (f as any).required || false,
                          order: i,
                          options: f.options?.map((opt) => ({
                            value: opt,
                            label: opt,
                          })),
                        }))
                      );
                    }}
                    className="text-left p-3 rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    <p className="font-medium text-sm">{template.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {template.fields.length} campos
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Campos */}
            {formFields.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Campos ({formFields.length})</label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addField}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Agregar
                  </Button>
                </div>

                <div className="space-y-2 max-h-[250px] overflow-y-auto">
                  {formFields.map((field) => (
                    <div
                      key={field.id}
                      className="p-2 rounded-lg border border-border flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{field.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {field.field_type}
                          {field.required && " (requerido)"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeField(field.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-1">
              <Button variant="outline" onClick={addField} className="flex-1">
                <Plus className="h-4 w-4 mr-1.5" /> Agregar campo
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>
              Cancelar
            </Button>
            <Button onClick={createForm} variant="hero">
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}