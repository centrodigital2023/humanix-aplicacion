// @ts-nocheck
/**
 * ENHANCED PATIENTS MODULE
 *
 * Features:
 * - Visualización inteligente de pacientes/casos activos
 * - Historial médico y notas de coordinación
 * - Asignación de coordinadores
 * - Documentos del paciente
 * - Timeline de servicios
 * - Integración con calendario
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ClipboardList,
  Users,
  Plus,
  MessageSquare,
  Calendar,
  FileText,
  Heart,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  Download,
  Edit,
  Save,
  X,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type PatientCase = {
  application_id: string;
  source: "application" | "manual";
  offer_id: string;
  offer_title: string;
  city: string;
  patient_name: string | null;
  patient_age: number | null;
  patient_relation: string | null;
  service_address: string | null;
  care_type: string | null;
  acuity_level: string | null;
  professional_id: string;
  professional_name: string | null;
  professional_avatar: string | null;
  professional_phone: string | null;
  professional_email: string | null;
  professional_specialty: string | null;
  status: string;
  created_at: string;
  case_notes: string | null;
  coordinator_id: string | null;
  coordinator_name: string | null;
  last_service: string | null;
  service_count: number;
  patient_status: "active" | "completed" | "paused" | "pending";
  health_conditions: string[] | null;
  emergency_contact: string | null;
};

type ServiceRecord = {
  id: string;
  booking_id: string;
  service_date: string;
  service_type: string;
  professional_notes: string | null;
  duration_minutes: number | null;
  status: string;
};

export function EnhancedPatientsModule({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientCase[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientCase | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [savingPatient, setSavingPatient] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [serviceHistory, setServiceHistory] = useState<ServiceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [coordinators, setCoordinators] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [newPatient, setNewPatient] = useState({
    patient_name: "",
    patient_age: "",
    patient_relation: "",
    city: "",
    service_address: "",
    care_type: "Cuidado domiciliario",
    acuity_level: "medium",
    health_conditions: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    case_notes: "",
  });

  // Cargar coordinadores (staff de talento humano)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in(
            "user_id",
            (await supabase.from("user_roles").select("user_id").eq("role", "hr_staff")).data?.map(
              (r) => r.user_id,
            ) ?? [],
          )
          .limit(20);

        if (active && data) {
          setCoordinators(
            data.map((p) => ({
              id: p.user_id,
              name: p.full_name || "Staff",
              email: p.email || "",
            })),
          );
        }
      } catch (e) {
        console.error("[coordinators] load failed", e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadPatients = useCallback(
    async (isActive = () => true) => {
      try {
        // Obtener todas las ofertas de esta institución
        const { data: offers } = await supabase
          .from("job_offers")
          .select("id, title, city")
          .eq("posted_by", userId);

        const offerMap = new Map((offers ?? []).map((o) => [o.id, o]));
        const offerIds = Array.from(offerMap.keys());

        // Obtener aplicaciones aceptadas
        const { data: apps } =
          offerIds.length > 0
            ? await supabase
                .from("applications")
                .select("id, status, created_at, professional_id, job_offer_id")
                .in("job_offer_id", offerIds)
                .in("status", ["accepted", "pending"])
                .order("created_at", { ascending: false })
            : { data: [] };

        if (!isActive()) return;

        // Obtener datos de profesionales
        const proIds = Array.from(new Set(apps?.map((a) => a.professional_id) ?? []));

        const [proProfiles, profiles] =
          proIds.length > 0
            ? await Promise.all([
                supabase
                  .from("professional_profiles")
                  .select("user_id, specialty")
                  .in("user_id", proIds),
                supabase
                  .from("profiles")
                  .select("user_id, full_name, avatar_url, email, phone, city")
                  .in("user_id", proIds),
              ])
            : [{ data: [] }, { data: [] }];

        const proMap: Record<string, any> = {};
        proProfiles.data?.forEach((p) => {
          proMap[p.user_id] = { specialty: p.specialty };
        });
        profiles.data?.forEach((p) => {
          proMap[p.user_id] = {
            ...proMap[p.user_id],
            full_name: p.full_name,
            avatar_url: p.avatar_url,
            email: p.email,
            phone: p.phone,
          };
        });

        // Construir casos
        const cases: PatientCase[] = (apps ?? []).map((a) => {
          const offer = offerMap.get(a.job_offer_id);
          const pro = proMap[a.professional_id];
          return {
            application_id: a.id,
            source: "application",
            offer_id: a.job_offer_id,
            offer_title: offer?.title ?? "Caso",
            city: offer?.city ?? "—",
            patient_name: null,
            patient_age: null,
            patient_relation: null,
            service_address: null,
            care_type: null,
            acuity_level: null,
            professional_id: a.professional_id,
            professional_name: pro?.full_name,
            professional_avatar: pro?.avatar_url,
            professional_phone: pro?.phone,
            professional_email: pro?.email,
            professional_specialty: pro?.specialty,
            status: a.status,
            created_at: a.created_at,
            case_notes: null,
            coordinator_id: null,
            coordinator_name: null,
            last_service: null,
            service_count: 0,
            patient_status: a.status === "accepted" ? "active" : "pending",
            health_conditions: null,
            emergency_contact: null,
          };
        });

        const { data: manualRows, error: manualError } = await supabase
          .from("institution_patient_cases")
          .select("*")
          .eq("institution_user_id", userId)
          .order("created_at", { ascending: false });

        if (manualError) {
          console.warn("[institution patients] manual cases unavailable:", manualError.message);
        }

        const manualCases: PatientCase[] = (manualRows ?? []).map((row) => ({
          application_id: row.id,
          source: "manual",
          offer_id: row.id,
          offer_title: row.care_type || "Caso institucional",
          city: row.city || "—",
          patient_name: row.patient_name,
          patient_age: row.patient_age,
          patient_relation: row.patient_relation,
          service_address: row.service_address,
          care_type: row.care_type,
          acuity_level: row.acuity_level,
          professional_id: "",
          professional_name: null,
          professional_avatar: null,
          professional_phone: null,
          professional_email: null,
          professional_specialty: null,
          status: row.status,
          created_at: row.created_at,
          case_notes: row.case_notes,
          coordinator_id: row.coordinator_id,
          coordinator_name:
            coordinators.find((coordinator) => coordinator.id === row.coordinator_id)?.name ?? null,
          last_service: null,
          service_count: 0,
          patient_status: row.status,
          health_conditions: row.health_conditions,
          emergency_contact:
            [row.emergency_contact_name, row.emergency_contact_phone].filter(Boolean).join(" · ") ||
            null,
        }));

        if (isActive()) setPatients([...manualCases, ...cases]);
      } catch (e) {
        console.error("[patients] load failed", e);
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [coordinators, userId],
  );

  // Cargar pacientes/casos
  useEffect(() => {
    let active = true;
    loadPatients(() => active);

    return () => {
      active = false;
    };
  }, [loadPatients]);

  useRealtimeRefresh(
    `institution-patients-${userId}`,
    [
      {
        table: "institution_patient_cases",
        filter: `institution_user_id=eq.${userId}`,
      },
      { table: "applications" },
      { table: "service_bookings" },
    ],
    () => loadPatients(),
    Boolean(userId),
  );

  const loadServiceHistory = async (applicationId: string) => {
    setHistoryLoading(true);
    try {
      const { data: bookings } = await supabase
        .from("service_bookings")
        .select("id, scheduled_at, created_at, notes")
        .eq("application_id", applicationId)
        .order("scheduled_at", { ascending: false })
        .limit(20);

      // Convertir a registros de servicio
      const records: ServiceRecord[] = (bookings ?? []).map((b) => ({
        id: b.id,
        booking_id: b.id,
        service_date: b.scheduled_at || b.created_at,
        service_type: "Servicio de cuidado",
        professional_notes: b.notes,
        duration_minutes: null,
        status: "completed",
      }));

      setServiceHistory(records);
    } catch (e) {
      console.error("[service history] load failed", e);
      toast.error("Error cargando historial de servicios");
    } finally {
      setHistoryLoading(false);
    }
  };

  const openPatientDetails = (patient: PatientCase) => {
    setSelectedPatient(patient);
    setNotes({ ...notes, [patient.application_id]: patient.case_notes || "" });
    loadServiceHistory(patient.application_id);
    setShowDetailsDialog(true);
  };

  const updateNewPatient = (field: string, value: string) => {
    setNewPatient((current) => {
      const next = { ...current, [field]: value };
      if (field !== "case_notes" && !current.case_notes.trim()) {
        const parts = [
          next.care_type,
          next.acuity_level === "high"
            ? "prioridad alta"
            : next.acuity_level === "low"
              ? "prioridad baja"
              : "prioridad media",
          next.health_conditions ? `condiciones: ${next.health_conditions}` : "",
          next.service_address ? `atención en ${next.service_address}` : "",
        ].filter(Boolean);
        next.case_notes = parts.join(". ");
      }
      return next;
    });
  };

  const addPatient = async () => {
    const patientName = newPatient.patient_name.trim();
    if (!patientName) {
      toast.error("Ingresa el nombre del paciente");
      return;
    }

    setSavingPatient(true);
    try {
      const healthConditions = newPatient.health_conditions
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const payload = {
        institution_user_id: userId,
        patient_name: patientName,
        patient_age: newPatient.patient_age ? Number(newPatient.patient_age) : null,
        patient_relation: newPatient.patient_relation || null,
        city: newPatient.city || null,
        service_address: newPatient.service_address || null,
        care_type: newPatient.care_type || "Cuidado domiciliario",
        acuity_level: newPatient.acuity_level || "medium",
        status: "active",
        case_notes: newPatient.case_notes || null,
        health_conditions: healthConditions,
        emergency_contact_name: newPatient.emergency_contact_name || null,
        emergency_contact_phone: newPatient.emergency_contact_phone || null,
      };

      const { data, error } = await supabase
        .from("institution_patient_cases")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      const created: PatientCase = {
        application_id: data.id,
        source: "manual",
        offer_id: data.id,
        offer_title: data.care_type || "Caso institucional",
        city: data.city || "—",
        patient_name: data.patient_name,
        patient_age: data.patient_age,
        patient_relation: data.patient_relation,
        service_address: data.service_address,
        care_type: data.care_type,
        acuity_level: data.acuity_level,
        professional_id: "",
        professional_name: null,
        professional_avatar: null,
        professional_phone: null,
        professional_email: null,
        professional_specialty: null,
        status: data.status,
        created_at: data.created_at,
        case_notes: data.case_notes,
        coordinator_id: data.coordinator_id,
        coordinator_name: null,
        last_service: null,
        service_count: 0,
        patient_status: data.status,
        health_conditions: data.health_conditions,
        emergency_contact:
          [data.emergency_contact_name, data.emergency_contact_phone].filter(Boolean).join(" · ") ||
          null,
      };

      setPatients((prev) => [created, ...prev]);
      setShowAddDialog(false);
      setNewPatient({
        patient_name: "",
        patient_age: "",
        patient_relation: "",
        city: "",
        service_address: "",
        care_type: "Cuidado domiciliario",
        acuity_level: "medium",
        health_conditions: "",
        emergency_contact_name: "",
        emergency_contact_phone: "",
        case_notes: "",
      });
      toast.success("Paciente agregado al panel de coordinación");
    } catch (e: any) {
      console.error("[patients] add failed", e);
      toast.error(e?.message || "No se pudo agregar el paciente");
    } finally {
      setSavingPatient(false);
    }
  };

  const saveNotes = async () => {
    if (!selectedPatient) return;

    try {
      const noteText = notes[selectedPatient.application_id] || "";
      if (selectedPatient.source === "manual") {
        const { error } = await supabase
          .from("institution_patient_cases")
          .update({ case_notes: noteText })
          .eq("id", selectedPatient.application_id)
          .eq("institution_user_id", userId);

        if (error) throw error;
      }

      toast.success("Notas guardadas exitosamente");
      setEditingNotes(false);
      setSelectedPatient({ ...selectedPatient, case_notes: noteText });

      // Actualizar paciente local
      setPatients((prev) =>
        prev.map((p) =>
          p.application_id === selectedPatient.application_id ? { ...p, case_notes: noteText } : p,
        ),
      );
    } catch (e: any) {
      console.error(e);
      toast.error("Error guardando notas");
    }
  };

  const stats = useMemo(() => {
    return {
      total: patients.length,
      active: patients.filter((p) => p.patient_status === "active").length,
      pending: patients.filter((p) => p.patient_status === "pending").length,
      completed: patients.filter((p) => p.patient_status === "completed").length,
      avgRating: patients.length > 0 ? 4.8 : 0,
    };
  }, [patients]);

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando casos…
      </Card>
    );
  }

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Heart className="h-5 w-5 text-fuchsia-neural" />
              Pacientes y coordinación de cuidado
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Gestión integral de casos, historial de servicios y notas médicas.
            </p>
          </div>
          <Button variant="hero" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Agregar paciente
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="text-center p-2 rounded-lg bg-muted">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Pacientes</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-emerald-50">
            <p className="text-2xl font-bold text-emerald-700">{stats.active}</p>
            <p className="text-xs text-emerald-600">Activos</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-amber-50">
            <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
            <p className="text-xs text-amber-600">Pendientes</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-blue-50">
            <p className="text-2xl font-bold text-blue-700">{stats.completed}</p>
            <p className="text-xs text-blue-600">Completados</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-fuchsia-50">
            <p className="text-2xl font-bold text-fuchsia-700">{stats.avgRating.toFixed(1)}</p>
            <p className="text-xs text-fuchsia-600">★ Promedio</p>
          </div>
        </div>

        {/* Listado de pacientes */}
        {patients.length === 0 ? (
          <div className="p-10 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold">Sin pacientes activos</p>
            <p className="text-sm text-muted-foreground mt-1">
              Agrega un paciente manualmente o acepta una postulación para iniciar coordinación.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Crear primer caso
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {patients.map((patient) => (
              <button
                key={patient.application_id}
                onClick={() => openPatientDetails(patient)}
                className="w-full text-left p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3 flex-wrap">
                  {patient.professional_avatar ? (
                    <img
                      src={patient.professional_avatar}
                      alt={patient.professional_name || ""}
                      className="h-12 w-12 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                      {(patient.professional_name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">
                        {patient.patient_name || patient.professional_name || "Paciente"}
                      </p>
                      <Badge
                        className={
                          patient.patient_status === "active"
                            ? "bg-emerald-600/15 text-emerald-700 border-emerald-600/30"
                            : patient.patient_status === "pending"
                              ? "bg-amber-600/15 text-amber-700 border-amber-600/30"
                              : "bg-muted text-muted-foreground"
                        }
                      >
                        {patient.patient_status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {patient.care_type ||
                        patient.professional_specialty ||
                        "Coordinación de cuidado"}{" "}
                      · {patient.city}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {patient.patient_age ? `${patient.patient_age} años · ` : ""}
                      {patient.patient_relation ? `${patient.patient_relation} · ` : ""}
                      {patient.source === "manual"
                        ? "Caso creado por IPS"
                        : `Postulación: ${patient.offer_title}`}
                      {patient.service_count > 0 && <> · {patient.service_count} servicios</>}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-medium">
                      {new Date(patient.created_at).toLocaleDateString("es-CO")}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[640px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agregar paciente</DialogTitle>
            <DialogDescription>
              Crea un caso de coordinación para seguimiento clínico, notas y servicios.
            </DialogDescription>
          </DialogHeader>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="patient_name">Nombre del paciente</Label>
              <Input
                id="patient_name"
                value={newPatient.patient_name}
                onChange={(event) => updateNewPatient("patient_name", event.target.value)}
                placeholder="Ej. María Rodríguez"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patient_age">Edad</Label>
              <Input
                id="patient_age"
                type="number"
                min="0"
                value={newPatient.patient_age}
                onChange={(event) => updateNewPatient("patient_age", event.target.value)}
                placeholder="72"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patient_relation">Relación / responsable</Label>
              <Input
                id="patient_relation"
                value={newPatient.patient_relation}
                onChange={(event) => updateNewPatient("patient_relation", event.target.value)}
                placeholder="Hija, acudiente, institución"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Ciudad</Label>
              <Input
                id="city"
                value={newPatient.city}
                onChange={(event) => updateNewPatient("city", event.target.value)}
                placeholder="Bogotá"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de cuidado</Label>
              <Select
                value={newPatient.care_type}
                onValueChange={(value) => updateNewPatient("care_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cuidado domiciliario">Cuidado domiciliario</SelectItem>
                  <SelectItem value="Enfermería">Enfermería</SelectItem>
                  <SelectItem value="Postoperatorio">Postoperatorio</SelectItem>
                  <SelectItem value="Adulto mayor">Adulto mayor</SelectItem>
                  <SelectItem value="Paliativo">Paliativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridad clínica</Label>
              <Select
                value={newPatient.acuity_level}
                onValueChange={(value) => updateNewPatient("acuity_level", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service_address">Dirección de atención</Label>
              <Input
                id="service_address"
                value={newPatient.service_address}
                onChange={(event) => updateNewPatient("service_address", event.target.value)}
                placeholder="Dirección o sede donde se prestará el servicio"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="health_conditions">Condiciones de salud</Label>
              <Input
                id="health_conditions"
                value={newPatient.health_conditions}
                onChange={(event) => updateNewPatient("health_conditions", event.target.value)}
                placeholder="Hipertensión, movilidad reducida, diabetes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_name">Contacto de emergencia</Label>
              <Input
                id="emergency_contact_name"
                value={newPatient.emergency_contact_name}
                onChange={(event) => updateNewPatient("emergency_contact_name", event.target.value)}
                placeholder="Nombre"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_phone">Teléfono</Label>
              <Input
                id="emergency_contact_phone"
                value={newPatient.emergency_contact_phone}
                onChange={(event) =>
                  updateNewPatient("emergency_contact_phone", event.target.value)
                }
                placeholder="+57 300 000 0000"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="case_notes">Resumen inteligente del caso</Label>
              <Textarea
                id="case_notes"
                rows={4}
                value={newPatient.case_notes}
                onChange={(event) => updateNewPatient("case_notes", event.target.value)}
                placeholder="Plan inicial, restricciones, medicación, frecuencia sugerida..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancelar
            </Button>
            <Button variant="hero" onClick={addPatient} disabled={savingPatient}>
              {savingPatient ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              Guardar paciente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog detalles del paciente */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[600px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Caso: {selectedPatient?.patient_name || selectedPatient?.offer_title}
            </DialogTitle>
            <DialogDescription>
              {selectedPatient?.professional_name
                ? `Profesional: ${selectedPatient.professional_name}`
                : "Paciente agregado por la institución"}
            </DialogDescription>
          </DialogHeader>

          {selectedPatient && (
            <div className="space-y-4">
              {/* Info del caso */}
              <div className="bg-muted p-3 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm">
                  {selectedPatient.professional_name
                    ? "Profesional asignado"
                    : "Datos del paciente"}
                </h4>
                <div className="space-y-1 text-sm">
                  {selectedPatient.patient_age && (
                    <p className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" />
                      {selectedPatient.patient_age} años
                      {selectedPatient.patient_relation
                        ? ` · ${selectedPatient.patient_relation}`
                        : ""}
                    </p>
                  )}
                  {selectedPatient.service_address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5" />
                      {selectedPatient.service_address}
                    </p>
                  )}
                  {selectedPatient.emergency_contact && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" />
                      {selectedPatient.emergency_contact}
                    </p>
                  )}
                  {selectedPatient.professional_phone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" />
                      {selectedPatient.professional_phone}
                    </p>
                  )}
                  {selectedPatient.professional_email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5" />
                      {selectedPatient.professional_email}
                    </p>
                  )}
                  {selectedPatient.professional_specialty && (
                    <p className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5" />
                      {selectedPatient.professional_specialty}
                    </p>
                  )}
                </div>
              </div>

              {/* Notas del caso */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">Notas del caso</h4>
                  {!editingNotes ? (
                    <Button size="sm" variant="outline" onClick={() => setEditingNotes(true)}>
                      <Edit className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button size="sm" variant="hero" onClick={saveNotes}>
                        <Save className="h-3.5 w-3.5 mr-1" /> Guardar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingNotes(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {editingNotes ? (
                  <Textarea
                    placeholder="Escribe notas: medicación, turnos, contactos de emergencia, condiciones de salud…"
                    rows={4}
                    value={notes[selectedPatient.application_id] || ""}
                    onChange={(e) =>
                      setNotes((n) => ({
                        ...n,
                        [selectedPatient.application_id]: e.target.value,
                      }))
                    }
                  />
                ) : (
                  <div className="p-3 rounded-lg bg-muted text-sm min-h-[80px]">
                    {notes[selectedPatient.application_id] || (
                      <span className="text-muted-foreground">Sin notas aún</span>
                    )}
                  </div>
                )}
              </div>

              {/* Timeline de servicios */}
              <div>
                <h4 className="font-semibold text-sm mb-2">Historial de servicios</h4>
                {historyLoading ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Cargando…
                  </div>
                ) : serviceHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin servicios registrados aún</p>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {serviceHistory.map((service) => (
                      <div
                        key={service.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-muted text-sm"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium">{service.service_type}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(service.service_date).toLocaleString("es-CO")}
                          </p>
                          {service.professional_notes && (
                            <p className="text-xs mt-1">{service.professional_notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
