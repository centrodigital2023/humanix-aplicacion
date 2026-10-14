// Exportación de la historia de un paciente en HL7 FHIR R4 (paquete «collection») — lógica pura (plan IPS Mejorado).
//
// Para que la historia viaje a otro sistema (EPS, IPS, hospital): Patient, Condition, AllergyIntolerance, EpisodeOfCare (los casos),
// Observation (signos vitales con LOINC y unidades UCUM, como pide el perfil de signos vitales de FHIR) y ClinicalImpression (las notas,
// con su número, su tipo y su firma encadenada para poder comprobar que no se alteraron).
//
// Códigos: solo se usan los de LOINC publicados en la especificación de signos vitales de HL7 (8867-4 pulso, 9279-1 respiración,
// 8310-5 temperatura, 2708-6 y 59408-5 saturación, 85354-9 presión con 8480-6 y 8462-4) y 72514-3 para el dolor de 0 a 10.
// Lo que no tiene un código estándar seguro (conciencia AVPU, oxígeno suplementario, caída, puntaje NEWS2) lleva un sistema de códigos
// propio de Humanix: no se inventan códigos de LOINC. No se declara `meta.profile`: no se afirma conformidad con un perfil que no se
// validó con el validador oficial de HL7.
//
// Exportar es un acto auditado: antes de generar el archivo la pantalla llama a `inst_export_log` (el servidor deja constancia).

import { bogotaDateTime } from "./careExport";
import { CARE_TYPE_META, normalizeText, nowMs, type Clock } from "./instCare";
import type { InstCase, InstNote, InstObs, InstPatient } from "./instCareTypes";
import { BAND_INFO } from "./news2";

export const FHIR_BASE = "https://humanix.lat/fhir";
export const FHIR_MIME = "application/fhir+json";
const UCUM = "http://unitsofmeasure.org";
const LOINC_SYSTEM = "http://loinc.org";
const CAT_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const CODE_SYSTEM_OBS = `${FHIR_BASE}/CodeSystem/clinical-observation`;
const CODE_SYSTEM_AVPU = `${FHIR_BASE}/CodeSystem/avpu`;

export const LOINC = {
  heartRate: { code: "8867-4", display: "Heart rate" },
  respiratoryRate: { code: "9279-1", display: "Respiratory rate" },
  bodyTemperature: { code: "8310-5", display: "Body temperature" },
  oxygenSaturation: { code: "2708-6", display: "Oxygen saturation in Arterial blood" },
  oxygenSaturationPulseOx: {
    code: "59408-5",
    display: "Oxygen saturation in Arterial blood by Pulse oximetry",
  },
  bloodPressurePanel: {
    code: "85354-9",
    display: "Blood pressure panel with all children optional",
  },
  systolic: { code: "8480-6", display: "Systolic blood pressure" },
  diastolic: { code: "8462-4", display: "Diastolic blood pressure" },
  pain: {
    code: "72514-3",
    display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported",
  },
} as const;

const AVPU_DISPLAY: Record<string, string> = {
  A: "Alerta",
  C: "Confusión nueva",
  V: "Responde a la voz",
  P: "Responde al dolor",
  U: "No responde",
};

/** Cómo se llama en español cada valor que el NEWS2 puede arrastrar de un control anterior. */
const CARRIED_LABEL: Record<string, string> = {
  rr: "frecuencia respiratoria",
  spo2: "saturación",
  on_o2: "oxígeno suplementario",
  sbp: "presión sistólica",
  hr: "pulso",
  avpu: "conciencia",
  temp_c: "temperatura",
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json | undefined };
export interface FhirResource {
  resourceType: string;
  id: string;
  [k: string]: Json | undefined;
}
export interface FhirEntry {
  fullUrl: string;
  resource: FhirResource;
}
export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  identifier: { system: string; value: string };
  meta: { lastUpdated: string; tag?: Array<{ system: string; code: string; display?: string }> };
  entry: FhirEntry[];
}

/** Referencia literal relativa («Patient/abc»): se resuelve contra el `fullUrl` de la entrada, que sigue el mismo patrón. */
const ref = (type: string, id: string) => ({ reference: `${type}/${id}` });
const fullUrl = (type: string, id: string) => `${FHIR_BASE}/${type}/${id}`;
const entry = (resource: FhirResource): FhirEntry => ({
  fullUrl: fullUrl(resource.resourceType, resource.id),
  resource,
});

const quantity = (value: number, unit: string, code: string) => ({
  value,
  unit,
  system: UCUM,
  code,
});

export interface FhirExportInput {
  institutionName: string;
  patient: InstPatient;
  cases: InstCase[];
  notes: InstNote[];
  obs: InstObs[];
  now: Clock;
  /** Tope de controles incluidos (los más recientes). */
  maxObs?: number;
}

export const DEFAULT_MAX_OBS = 500;

const GENDER: Record<string, string> = { F: "female", M: "male", O: "other" };
const EPISODE_STATUS: Record<InstCase["status"], string> = {
  pending: "planned",
  active: "active",
  completed: "finished",
  cancelled: "cancelled",
};

type Category = "vital-signs" | "survey" | "exam";
const CATEGORY_DISPLAY: Record<Category, string> = {
  "vital-signs": "Vital Signs",
  survey: "Survey",
  exam: "Exam",
};

function observation(
  patient: InstPatient,
  o: InstObs,
  suffix: string,
  category: Category,
  fields: Record<string, Json | undefined>,
): FhirEntry {
  const performer: Record<string, Json | undefined> =
    o.source === "device"
      ? { device: { display: o.recorded_by_name ?? "Dispositivo" } }
      : o.recorded_by_name
        ? { performer: [{ display: o.recorded_by_name }] }
        : {};
  return entry({
    resourceType: "Observation",
    id: `${o.id}-${suffix}`,
    status: "final",
    category: [
      {
        coding: [{ system: CAT_SYSTEM, code: category, display: CATEGORY_DISPLAY[category] }],
      },
    ],
    subject: ref("Patient", patient.id),
    effectiveDateTime: o.recorded_at,
    ...performer,
    ...fields,
  });
}

const loincCode = (c: { code: string; display: string }) => ({
  coding: [{ system: LOINC_SYSTEM, code: c.code, display: c.display }],
});

const localCode = (code: string, display: string) => ({
  coding: [{ system: CODE_SYSTEM_OBS, code, display }],
});

function carriedLabels(o: InstObs): string[] {
  const raw = o.news2_input?.carried;
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string").map((k) => CARRIED_LABEL[k] ?? k);
}

/** Los signos de un control, uno por Observation (la presión, en su panel con sus dos componentes). */
export function observationsOf(patient: InstPatient, o: InstObs): FhirEntry[] {
  const out: FhirEntry[] = [];
  if (o.hr !== null)
    out.push(
      observation(patient, o, "hr", "vital-signs", {
        code: loincCode(LOINC.heartRate),
        valueQuantity: quantity(o.hr, "beats/minute", "/min"),
      }),
    );
  if (o.rr !== null)
    out.push(
      observation(patient, o, "rr", "vital-signs", {
        code: loincCode(LOINC.respiratoryRate),
        valueQuantity: quantity(o.rr, "breaths/minute", "/min"),
      }),
    );
  if (o.spo2 !== null)
    out.push(
      observation(patient, o, "spo2", "vital-signs", {
        code: {
          coding: [
            { system: LOINC_SYSTEM, ...LOINC.oxygenSaturation },
            { system: LOINC_SYSTEM, ...LOINC.oxygenSaturationPulseOx },
          ],
        },
        valueQuantity: quantity(Number(o.spo2), "%", "%"),
      }),
    );
  if (o.temp_c !== null)
    out.push(
      observation(patient, o, "temp", "vital-signs", {
        code: loincCode(LOINC.bodyTemperature),
        valueQuantity: quantity(Number(o.temp_c), "°C", "Cel"),
      }),
    );
  if (o.sbp !== null || o.dbp !== null) {
    const absent = {
      dataAbsentReason: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/data-absent-reason",
            code: "not-performed",
            display: "Not Performed",
          },
        ],
      },
    };
    out.push(
      observation(patient, o, "bp", "vital-signs", {
        code: loincCode(LOINC.bloodPressurePanel),
        component: [
          {
            code: loincCode(LOINC.systolic),
            ...(o.sbp !== null ? { valueQuantity: quantity(o.sbp, "mmHg", "mm[Hg]") } : absent),
          },
          {
            code: loincCode(LOINC.diastolic),
            ...(o.dbp !== null ? { valueQuantity: quantity(o.dbp, "mmHg", "mm[Hg]") } : absent),
          },
        ],
      }),
    );
  }
  if (o.pain !== null)
    out.push(
      observation(patient, o, "pain", "survey", {
        code: loincCode(LOINC.pain),
        valueQuantity: quantity(o.pain, "{score}", "{score}"),
      }),
    );
  if (o.avpu !== null)
    out.push(
      observation(patient, o, "avpu", "exam", {
        code: localCode("avpu", "Nivel de conciencia (AVPU)"),
        valueCodeableConcept: {
          coding: [
            { system: CODE_SYSTEM_AVPU, code: o.avpu, display: AVPU_DISPLAY[o.avpu] ?? o.avpu },
          ],
        },
      }),
    );
  if (o.on_o2 !== null)
    out.push(
      observation(patient, o, "o2", "exam", {
        code: localCode("supplemental-oxygen", "Oxígeno suplementario"),
        valueBoolean: o.on_o2,
      }),
    );
  if (o.fall)
    out.push(
      observation(patient, o, "fall", "exam", {
        code: localCode("fall-detected", "Caída reportada"),
        valueBoolean: true,
      }),
    );
  if (o.news2 !== null && o.applicable) {
    const parts =
      o.news2_measured !== null && o.news2_measured < 7
        ? ` (${o.news2_measured} de 7 parámetros)`
        : "";
    const carried = carriedLabels(o);
    out.push(
      observation(patient, o, "news2", "survey", {
        code: localCode("news2-total", "NEWS2 (National Early Warning Score 2)"),
        valueInteger: o.news2,
        ...(o.band ? { interpretation: [{ text: BAND_INFO[o.band].label }] } : {}),
        note: [
          {
            text:
              `NEWS2 (Royal College of Physicians, 2017) calculado por Humanix con los valores del control${parts}.` +
              (carried.length
                ? ` Valores tomados de controles de las 12 h anteriores: ${carried.join(", ")}.`
                : "") +
              " Apoyo a la decisión clínica; no es un diagnóstico.",
          },
        ],
      }),
    );
  }
  return out;
}

export function buildFhirBundle(input: FhirExportInput): FhirBundle {
  const { patient, institutionName } = input;
  const stamp = new Date(nowMs(input.now)).toISOString();
  const entries: FhirEntry[] = [];

  // Paciente
  const p: FhirResource = {
    resourceType: "Patient",
    id: patient.id,
    active: patient.status !== "discharged",
    name: [{ text: patient.full_name }],
    gender: patient.sex ? (GENDER[patient.sex] ?? "unknown") : "unknown",
    managingOrganization: { display: institutionName },
    extension: [
      { url: `${FHIR_BASE}/StructureDefinition/patient-modality`, valueCode: patient.modality },
      { url: `${FHIR_BASE}/StructureDefinition/spo2-scale`, valueInteger: patient.spo2_scale },
      {
        url: `${FHIR_BASE}/StructureDefinition/consent-confirmed-at`,
        valueDateTime: patient.consent_confirmed_at,
      },
    ],
  };
  if (patient.document_number)
    p.identifier = [
      {
        system: `${FHIR_BASE}/id/document/${patient.document_type ?? "OTRO"}`,
        value: patient.document_number,
      },
    ];
  if (patient.birth_date) p.birthDate = patient.birth_date.slice(0, 10);
  if (patient.address || patient.city)
    p.address = [
      {
        ...(patient.address ? { text: patient.address } : {}),
        ...(patient.city ? { city: patient.city } : {}),
      },
    ];
  if (patient.emergency_name || patient.emergency_phone)
    p.contact = [
      {
        relationship: [{ text: "Contacto de emergencia" }],
        ...(patient.emergency_name ? { name: { text: patient.emergency_name } } : {}),
        ...(patient.emergency_phone
          ? { telecom: [{ system: "phone", value: patient.emergency_phone }] }
          : {}),
      },
    ];
  entries.push(entry(p));

  // Condiciones y alergias (texto libre: la institución no las codifica)
  patient.conditions.forEach((text, i) => {
    entries.push(
      entry({
        resourceType: "Condition",
        id: `${patient.id}-c${i}`,
        clinicalStatus: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
          ],
        },
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-category",
                code: "problem-list-item",
              },
            ],
          },
        ],
        code: { text },
        subject: ref("Patient", patient.id),
      }),
    );
  });
  patient.allergies.forEach((text, i) => {
    entries.push(
      entry({
        resourceType: "AllergyIntolerance",
        id: `${patient.id}-a${i}`,
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
            },
          ],
        },
        code: { text },
        patient: ref("Patient", patient.id),
      }),
    );
  });

  // Casos (FHIR JSON no admite arreglos vacíos: la extensión solo va si hay algo que decir)
  for (const c of input.cases) {
    const extension: Json[] = [];
    if (c.outcome)
      extension.push({
        url: `${FHIR_BASE}/StructureDefinition/case-outcome`,
        valueCode: c.outcome,
      });
    if (c.satisfaction !== null)
      extension.push({
        url: `${FHIR_BASE}/StructureDefinition/case-satisfaction`,
        valueInteger: c.satisfaction,
      });
    entries.push(
      entry({
        resourceType: "EpisodeOfCare",
        id: c.id,
        status: EPISODE_STATUS[c.status],
        type: [{ text: `${CARE_TYPE_META[c.care_type].label} · ${c.title}` }],
        patient: ref("Patient", patient.id),
        managingOrganization: { display: institutionName },
        period: { start: c.opened_at, ...(c.closed_at ? { end: c.closed_at } : {}) },
        ...(extension.length ? { extension } : {}),
      }),
    );
  }

  // Signos vitales: los más recientes (el paquete no crece sin límite), en orden cronológico
  const maxObs = input.maxObs ?? DEFAULT_MAX_OBS;
  const sorted = [...input.obs].sort(
    (a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at),
  );
  for (const o of sorted.slice(0, maxObs).reverse()) entries.push(...observationsOf(patient, o));

  // Notas: en orden, con su firma
  const notes = [...input.notes].sort((a, b) => a.seq - b.seq);
  for (const n of notes) {
    entries.push(
      entry({
        resourceType: "ClinicalImpression",
        id: n.id,
        status: "completed",
        subject: ref("Patient", patient.id),
        date: n.created_at,
        assessor: { display: n.author_name },
        summary: n.body,
        extension: [
          { url: `${FHIR_BASE}/StructureDefinition/note-seq`, valueInteger: n.seq },
          { url: `${FHIR_BASE}/StructureDefinition/note-kind`, valueCode: n.kind },
          { url: `${FHIR_BASE}/StructureDefinition/note-hash`, valueString: n.hash },
          { url: `${FHIR_BASE}/StructureDefinition/note-prev-hash`, valueString: n.prev_hash },
          ...(n.corrects_note_id
            ? [
                {
                  url: `${FHIR_BASE}/StructureDefinition/note-corrects`,
                  valueReference: ref("ClinicalImpression", n.corrects_note_id),
                },
              ]
            : []),
        ],
      }),
    );
  }

  const tags: NonNullable<FhirBundle["meta"]["tag"]> = [];
  const tip = notes[notes.length - 1];
  if (tip)
    tags.push({
      system: `${FHIR_BASE}/chain-tip`,
      code: tip.hash,
      display: `Firma de la nota n.º ${tip.seq}: permite comprobar que la cadena de notas no se alteró`,
    });
  if (sorted.length > maxObs)
    tags.push({
      system: `${FHIR_BASE}/truncated`,
      code: "observations",
      display: `Se incluyen los ${maxObs} controles más recientes de ${sorted.length}`,
    });

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: stamp,
    identifier: { system: `${FHIR_BASE}/export`, value: `${patient.id}:${stamp}` },
    meta: { lastUpdated: stamp, ...(tags.length ? { tag: tags } : {}) },
    entry: entries,
  };
}

export const fhirJson = (bundle: FhirBundle): string => JSON.stringify(bundle, null, 2);

/** Cuántos recursos de cada tipo lleva el paquete. */
export function bundleCounts(bundle: FhirBundle): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of bundle.entry)
    out[e.resource.resourceType] = (out[e.resource.resourceType] ?? 0) + 1;
  return out;
}

const COUNT_LABEL: Array<[string, string, string]> = [
  ["Condition", "condición", "condiciones"],
  ["AllergyIntolerance", "alergia", "alergias"],
  ["EpisodeOfCare", "caso", "casos"],
  ["Observation", "observación clínica", "observaciones clínicas"],
  ["ClinicalImpression", "nota", "notas"],
];

/** «2 condiciones · 1 alergia · 41 observaciones clínicas · 12 notas» (lo que verá quien recibe el archivo). */
export function bundleSummary(bundle: FhirBundle): string {
  const counts = bundleCounts(bundle);
  return COUNT_LABEL.filter(([type]) => (counts[type] ?? 0) > 0)
    .map(([type, one, many]) => `${counts[type]} ${counts[type] === 1 ? one : many}`)
    .join(" · ");
}

/** «humanix-historia-ana-lucia-perez-20261014.json» (fecha de Colombia). */
export function fhirFileName(patient: Pick<InstPatient, "full_name">, now: Clock): string {
  const slug =
    normalizeText(patient.full_name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "paciente";
  const day = bogotaDateTime(new Date(nowMs(now)).toISOString())
    .slice(0, 10)
    .replace(/-/g, "");
  return `humanix-historia-${slug}-${day}.json`;
}
