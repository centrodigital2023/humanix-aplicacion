import { describe, expect, it } from "vitest";
import {
  FHIR_BASE,
  LOINC,
  buildFhirBundle,
  bundleCounts,
  bundleSummary,
  fhirFileName,
  fhirJson,
  observationsOf,
  type FhirBundle,
  type FhirEntry,
} from "./instFhir";
import { NOW, mkCase, mkNote, mkObs, mkPatient } from "./instCare.fixtures";

const patient = mkPatient({ id: "11111111-1111-4111-8111-111111111111" });
const base = { institutionName: "Clínica Norte", now: NOW };

const find = (b: FhirBundle, type: string) =>
  b.entry.filter((e) => e.resource.resourceType === type);
const byId = (entries: FhirEntry[], suffix: string) =>
  entries.find((e) => e.resource.id.endsWith(`-${suffix}`));

/** Recorre el JSON y avisa de lo que FHIR no admite: nulos, vacíos, undefined, números no finitos. */
function problems(value: unknown, path = "$"): string[] {
  if (value === undefined) return [`${path}: undefined`];
  if (value === null) return [`${path}: null`];
  if (typeof value === "number") return Number.isFinite(value) ? [] : [`${path}: no finito`];
  if (typeof value === "string") return value === "" ? [`${path}: cadena vacía`] : [];
  if (typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${path}: arreglo vacío`];
    return value.flatMap((v, i) => problems(v, `${path}[${i}]`));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [`${path}: objeto vacío`];
  return entries.flatMap(([k, v]) => problems(v, `${path}.${k}`));
}

function references(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => references(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "reference" && typeof v === "string") out.push(v);
      else references(v, out);
    }
  }
  return out;
}

describe("paquete", () => {
  const b = buildFhirBundle({ ...base, patient, cases: [], notes: [], obs: [] });

  it("es una colección con fecha, identificador y sin etiquetas si no hay nada que etiquetar", () => {
    expect(b.resourceType).toBe("Bundle");
    expect(b.type).toBe("collection");
    expect(b.timestamp).toBe("2026-10-14T16:00:00.000Z");
    expect(b.meta).toEqual({ lastUpdated: "2026-10-14T16:00:00.000Z" });
    expect(b.identifier).toEqual({
      system: `${FHIR_BASE}/export`,
      value: `${patient.id}:2026-10-14T16:00:00.000Z`,
    });
  });

  it("sin controles, notas ni casos: el paciente, sus 2 condiciones y su alergia", () => {
    expect(bundleCounts(b)).toEqual({ Patient: 1, Condition: 2, AllergyIntolerance: 1 });
  });

  it("no afirma conformidad con ningún perfil", () => {
    const full = buildFhirBundle({
      ...base,
      patient,
      cases: [mkCase({ patient_id: patient.id })],
      notes: [mkNote({ patient_id: patient.id })],
      obs: [mkObs({ patient_id: patient.id })],
    });
    expect(fhirJson(full)).not.toContain('"profile"');
  });

  it("acepta la hora como fecha o como número", () => {
    const a = buildFhirBundle({
      ...base,
      now: new Date(NOW),
      patient,
      cases: [],
      notes: [],
      obs: [],
    });
    expect(a.timestamp).toBe(b.timestamp);
  });
});

describe("paciente", () => {
  const get = (o = {}) =>
    find(
      buildFhirBundle({
        ...base,
        patient: mkPatient({ id: "p1", ...o }),
        cases: [],
        notes: [],
        obs: [],
      }),
      "Patient",
    )[0]!.resource;

  it("datos básicos, documento y organización", () => {
    const r = get();
    expect(r.id).toBe("p1");
    expect(r.name).toEqual([{ text: "Ana Lucía Pérez" }]);
    expect(r.gender).toBe("female");
    expect(r.birthDate).toBe("1948-03-01");
    expect(r.active).toBe(true);
    expect(r.identifier).toEqual([{ system: `${FHIR_BASE}/id/document/CC`, value: "1020304050" }]);
    expect(r.managingOrganization).toEqual({ display: "Clínica Norte" });
    expect(r.address).toEqual([{ text: "Cra 7 # 45-10", city: "Bogotá" }]);
    expect(r.contact).toEqual([
      {
        relationship: [{ text: "Contacto de emergencia" }],
        name: { text: "Luis Pérez" },
        telecom: [{ system: "phone", value: "300 123 4567" }],
      },
    ]);
  });

  it("sexo: F, M, O y desconocido", () => {
    expect(get({ sex: "F" }).gender).toBe("female");
    expect(get({ sex: "M" }).gender).toBe("male");
    expect(get({ sex: "O" }).gender).toBe("other");
    expect(get({ sex: null }).gender).toBe("unknown");
  });

  it("lo que no se sabe no se inventa: sin documento, fecha, dirección ni contacto no hay esos campos", () => {
    const r = get({
      document_number: null,
      birth_date: null,
      address: null,
      city: null,
      emergency_name: null,
      emergency_phone: null,
    });
    for (const k of ["identifier", "birthDate", "address", "contact"])
      expect(r).not.toHaveProperty(k);
  });

  it("tipo de documento ausente: queda «OTRO»; solo el teléfono o solo el nombre bastan para el contacto", () => {
    expect((get({ document_type: null }).identifier as { system: string }[])[0]!.system).toBe(
      `${FHIR_BASE}/id/document/OTRO`,
    );
    expect(get({ emergency_name: null }).contact).toEqual([
      {
        relationship: [{ text: "Contacto de emergencia" }],
        telecom: [{ system: "phone", value: "300 123 4567" }],
      },
    ]);
    expect(get({ emergency_phone: null }).contact).toEqual([
      { relationship: [{ text: "Contacto de emergencia" }], name: { text: "Luis Pérez" } },
    ]);
  });

  it("un paciente dado de alta queda inactivo; la modalidad, la escala y el consentimiento viajan como extensiones", () => {
    expect(get({ status: "discharged" }).active).toBe(false);
    expect(get({ status: "paused" }).active).toBe(true);
    const ext = get({ modality: "hospital", spo2_scale: 2 }).extension as Array<
      Record<string, unknown>
    >;
    expect(ext.find((e) => String(e.url).endsWith("patient-modality"))?.valueCode).toBe("hospital");
    expect(ext.find((e) => String(e.url).endsWith("spo2-scale"))?.valueInteger).toBe(2);
    expect(ext.find((e) => String(e.url).endsWith("consent-confirmed-at"))?.valueDateTime).toBe(
      patient.consent_confirmed_at,
    );
  });
});

describe("condiciones y alergias", () => {
  const b = buildFhirBundle({
    ...base,
    patient: mkPatient({
      id: "p1",
      conditions: ["EPOC", "Asma"],
      allergies: ["Penicilina", "Látex"],
    }),
    cases: [],
    notes: [],
    obs: [],
  });

  it("una entrada por texto, activas y ligadas al paciente", () => {
    const conditions = find(b, "Condition").map((e) => e.resource);
    expect(conditions.map((c) => (c.code as { text: string }).text)).toEqual(["EPOC", "Asma"]);
    expect(
      conditions.every((c) => (c.subject as { reference: string }).reference === "Patient/p1"),
    ).toBe(true);
    expect(JSON.stringify(conditions[0]!.clinicalStatus)).toContain('"active"');
    expect(JSON.stringify(conditions[0]!.category)).toContain("problem-list-item");
    const allergies = find(b, "AllergyIntolerance").map((e) => e.resource);
    expect(allergies.map((c) => (c.code as { text: string }).text)).toEqual([
      "Penicilina",
      "Látex",
    ]);
    expect(
      allergies.every((c) => (c.patient as { reference: string }).reference === "Patient/p1"),
    ).toBe(true);
  });

  it("sin condiciones ni alergias no hay recursos de esos tipos", () => {
    const empty = buildFhirBundle({
      ...base,
      patient: mkPatient({ conditions: [], allergies: [] }),
      cases: [],
      notes: [],
      obs: [],
    });
    expect(bundleCounts(empty)).toEqual({ Patient: 1 });
  });
});

describe("casos", () => {
  const cases = [
    mkCase({
      id: "c1",
      patient_id: "p1",
      status: "pending",
      care_type: "nursing",
      title: "Curaciones",
    }),
    mkCase({ id: "c2", patient_id: "p1", status: "active" }),
    mkCase({
      id: "c3",
      patient_id: "p1",
      status: "completed",
      closed_at: "2026-10-10T15:00:00.000Z",
      outcome: "recovered",
      satisfaction: 5,
    }),
    mkCase({ id: "c4", patient_id: "p1", status: "cancelled" }),
  ];
  const b = buildFhirBundle({
    ...base,
    patient: mkPatient({ id: "p1" }),
    cases,
    notes: [],
    obs: [],
  });
  const ep = (id: string) => find(b, "EpisodeOfCare").find((e) => e.resource.id === id)!.resource;

  it("el estado del caso pasa al del episodio de cuidado", () => {
    expect(ep("c1").status).toBe("planned");
    expect(ep("c2").status).toBe("active");
    expect(ep("c3").status).toBe("finished");
    expect(ep("c4").status).toBe("cancelled");
  });

  it("tipo con su título, periodo y paciente", () => {
    expect(ep("c1").type).toEqual([{ text: "Enfermería · Curaciones" }]);
    expect(ep("c1").patient).toEqual({ reference: "Patient/p1" });
    expect(ep("c1").period).toEqual({ start: "2026-10-04T15:00:00.000Z" });
    expect(ep("c3").period).toEqual({
      start: "2026-10-04T15:00:00.000Z",
      end: "2026-10-10T15:00:00.000Z",
    });
  });

  it("resultado y satisfacción solo cuando existen (nunca un arreglo vacío)", () => {
    expect(ep("c1")).not.toHaveProperty("extension");
    const ext = ep("c3").extension as Array<Record<string, unknown>>;
    expect(ext.map((e) => String(e.url).split("/").pop())).toEqual([
      "case-outcome",
      "case-satisfaction",
    ]);
    expect(ext[0]!.valueCode).toBe("recovered");
    expect(ext[1]!.valueInteger).toBe(5);
  });
});

describe("signos vitales", () => {
  const p = mkPatient({ id: "p1" });
  const full = mkObs({
    id: "o1",
    patient_id: "p1",
    hr: 88,
    rr: 18,
    spo2: 96.5,
    temp_c: 37.2,
    sbp: 130,
    dbp: 85,
    pain: 4,
    avpu: "A",
    on_o2: false,
    fall: true,
    news2: 2,
    band: "low",
    news2_measured: 7,
  });
  const entries = observationsOf(p, full);
  const get = (s: string) => byId(entries, s)!.resource;

  it("cada signo con su código LOINC y su unidad UCUM", () => {
    expect(get("hr").code).toEqual({
      coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }],
    });
    expect(get("hr").valueQuantity).toEqual({
      value: 88,
      unit: "beats/minute",
      system: "http://unitsofmeasure.org",
      code: "/min",
    });
    expect(JSON.stringify(get("rr").code)).toContain("9279-1");
    expect((get("rr").valueQuantity as { code: string }).code).toBe("/min");
    expect(JSON.stringify(get("temp").code)).toContain("8310-5");
    expect(get("temp").valueQuantity).toMatchObject({ value: 37.2, unit: "°C", code: "Cel" });
    expect(JSON.stringify(get("pain").code)).toContain("72514-3");
    expect(get("pain").valueQuantity).toMatchObject({ value: 4, code: "{score}" });
  });

  it("la saturación lleva los dos códigos de LOINC y el porcentaje", () => {
    const coding = (get("spo2").code as { coding: Array<{ code: string }> }).coding;
    expect(coding.map((c) => c.code)).toEqual([
      LOINC.oxygenSaturation.code,
      LOINC.oxygenSaturationPulseOx.code,
    ]);
    expect(get("spo2").valueQuantity).toMatchObject({ value: 96.5, unit: "%", code: "%" });
  });

  it("la presión es un panel con sistólica y diastólica en mm[Hg] y sin valor propio", () => {
    const bp = get("bp");
    expect(JSON.stringify(bp.code)).toContain("85354-9");
    expect(bp).not.toHaveProperty("valueQuantity");
    const comps = bp.component as Array<{
      code: { coding: Array<{ code: string }> };
      valueQuantity: unknown;
    }>;
    expect(comps.map((c) => c.code.coding[0]!.code)).toEqual(["8480-6", "8462-4"]);
    expect(comps[0]!.valueQuantity).toMatchObject({ value: 130, code: "mm[Hg]", unit: "mmHg" });
    expect(comps[1]!.valueQuantity).toMatchObject({ value: 85, code: "mm[Hg]" });
  });

  it("solo la sistólica: la diastólica queda como «no realizada», sin inventar un valor", () => {
    const e = observationsOf(
      p,
      mkObs({
        id: "o2",
        hr: null,
        rr: null,
        spo2: null,
        temp_c: null,
        avpu: null,
        on_o2: null,
        sbp: 140,
        dbp: null,
        news2: null,
        band: null,
      }),
    );
    const comps = e.find((x) => x.resource.id.endsWith("-bp"))!.resource.component as Array<
      Record<string, unknown>
    >;
    expect(comps[0]).toHaveProperty("valueQuantity");
    expect(comps[1]).not.toHaveProperty("valueQuantity");
    expect(JSON.stringify(comps[1])).toContain("not-performed");
  });

  it("los signos con código estándar van como «vital-signs»; el dolor y el puntaje como «survey»; lo local, «exam»", () => {
    const cat = (s: string) => JSON.stringify(get(s).category);
    for (const s of ["hr", "rr", "spo2", "temp", "bp"]) expect(cat(s)).toContain('"vital-signs"');
    for (const s of ["pain", "news2"]) expect(cat(s)).toContain('"survey"');
    for (const s of ["avpu", "o2", "fall"]) expect(cat(s)).toContain('"exam"');
  });

  it("lo que no tiene código de LOINC va con el sistema propio de Humanix, declarado como tal", () => {
    expect(get("avpu").code).toEqual({
      coding: [
        {
          system: `${FHIR_BASE}/CodeSystem/clinical-observation`,
          code: "avpu",
          display: "Nivel de conciencia (AVPU)",
        },
      ],
    });
    expect(get("avpu").valueCodeableConcept).toEqual({
      coding: [{ system: `${FHIR_BASE}/CodeSystem/avpu`, code: "A", display: "Alerta" }],
    });
    expect(get("o2").valueBoolean).toBe(false);
    expect(get("fall").valueBoolean).toBe(true);
    const local = [get("avpu"), get("o2"), get("fall"), get("news2")];
    for (const r of local) expect(JSON.stringify(r.code)).not.toContain("loinc");
  });

  it("el NEWS2 lleva su valor, su banda y la aclaración de que apoya la decisión, no diagnostica", () => {
    const n = get("news2");
    expect(n.valueInteger).toBe(2);
    expect(n.interpretation).toEqual([{ text: "Estable" }]);
    const text = (n.note as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Royal College of Physicians, 2017");
    expect(text).toContain("no es un diagnóstico");
    expect(text).not.toContain("parámetros");
  });

  it("si faltaron parámetros lo dice, y nombra los que se arrastraron de controles anteriores", () => {
    const o = mkObs({
      id: "o3",
      news2: 3,
      band: "low",
      news2_measured: 5,
      news2_input: { carried: ["rr", "on_o2", "temp_c"] },
    });
    const text = (
      observationsOf(p, o).find((e) => e.resource.id.endsWith("-news2"))!.resource.note as Array<{
        text: string;
      }>
    )[0]!.text;
    expect(text).toContain("(5 de 7 parámetros)");
    expect(text).toContain("frecuencia respiratoria, oxígeno suplementario, temperatura");
  });

  it("una clave arrastrada desconocida se muestra tal cual, y un dato mal formado se ignora", () => {
    const row = (carried: unknown) =>
      (
        observationsOf(
          p,
          mkObs({ id: "o4", news2: 1, band: "low", news2_input: { carried } }),
        ).find((e) => e.resource.id.endsWith("-news2"))!.resource.note as Array<{ text: string }>
      )[0]!.text;
    expect(row(["xyz"])).toContain("xyz");
    expect(row("rr")).not.toContain("12 h anteriores");
    expect(row([1, null])).not.toContain("12 h anteriores");
  });

  it("sin puntaje, o si no aplica (menor de 16 años), no hay observación de NEWS2", () => {
    expect(byId(observationsOf(p, mkObs({ news2: null, band: null })), "news2")).toBeUndefined();
    expect(byId(observationsOf(p, mkObs({ applicable: false })), "news2")).toBeUndefined();
  });

  it("un control con un solo signo da una sola observación (más el NEWS2 si lo hay); la caída solo si ocurrió", () => {
    const only = mkObs({
      hr: 70,
      rr: null,
      spo2: null,
      temp_c: null,
      sbp: null,
      dbp: null,
      avpu: null,
      on_o2: null,
      fall: false,
      news2: null,
      band: null,
    });
    expect(observationsOf(p, only).map((e) => e.resource.id.split("-").pop())).toEqual(["hr"]);
    const noFall = observationsOf(p, mkObs({ fall: false }));
    expect(byId(noFall, "fall")).toBeUndefined();
  });

  it("los decimales que llegan como texto (numeric) se vuelven números", () => {
    const o = mkObs({ spo2: "97.0" as unknown as number, temp_c: "36.5" as unknown as number });
    const e = observationsOf(p, o);
    expect(byId(e, "spo2")!.resource.valueQuantity).toMatchObject({ value: 97 });
    expect(byId(e, "temp")!.resource.valueQuantity).toMatchObject({ value: 36.5 });
  });

  it("quién tomó el control: la persona, o el dispositivo", () => {
    const manual = observationsOf(
      p,
      mkObs({ recorded_by_name: "Jorge Monitoreo", source: "manual" }),
    )[0]!.resource;
    expect(manual.performer).toEqual([{ display: "Jorge Monitoreo" }]);
    expect(manual).not.toHaveProperty("device");
    const dev = observationsOf(p, mkObs({ recorded_by_name: null, source: "device" }))[0]!.resource;
    expect(dev.device).toEqual({ display: "Dispositivo" });
    expect(dev).not.toHaveProperty("performer");
    const anon = observationsOf(p, mkObs({ recorded_by_name: null, source: "app" }))[0]!.resource;
    expect(anon).not.toHaveProperty("performer");
    expect(anon).not.toHaveProperty("device");
  });

  it("cada observación: final, del paciente y con la hora del control", () => {
    for (const e of entries) {
      expect(e.resource.status).toBe("final");
      expect(e.resource.subject).toEqual({ reference: "Patient/p1" });
      expect(e.resource.effectiveDateTime).toBe(full.recorded_at);
    }
  });
});

describe("notas", () => {
  const n1 = mkNote({
    id: "n1",
    seq: 1,
    hash: "a".repeat(64),
    prev_hash: "0".repeat(64),
    body: "Ingreso.",
  });
  const n2 = mkNote({
    id: "n2",
    seq: 2,
    hash: "b".repeat(64),
    prev_hash: "a".repeat(64),
    body: "Mejora.",
  });
  const n3 = mkNote({
    id: "n3",
    seq: 3,
    hash: "c".repeat(64),
    prev_hash: "b".repeat(64),
    kind: "correction",
    corrects_note_id: "n2",
    body: "Corrección: era sábado.",
  });
  const b = buildFhirBundle({ ...base, patient, cases: [], notes: [n3, n1, n2], obs: [] });
  const notes = find(b, "ClinicalImpression").map((e) => e.resource);

  it("van en orden de número, con su texto, su autor y su fecha", () => {
    expect(notes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(notes[0]).toMatchObject({
      status: "completed",
      summary: "Ingreso.",
      assessor: { display: "Marta Pacientes" },
      date: n1.created_at,
    });
  });

  it("llevan su número, su tipo y las dos firmas de la cadena", () => {
    const ext = (i: number) => notes[i]!.extension as Array<Record<string, unknown>>;
    const v = (i: number, name: string) => ext(i).find((e) => String(e.url).endsWith(name));
    expect(v(1, "note-seq")?.valueInteger).toBe(2);
    expect(v(1, "note-kind")?.valueCode).toBe("evolution");
    expect(v(1, "note-hash")?.valueString).toBe("b".repeat(64));
    expect(v(1, "note-prev-hash")?.valueString).toBe("a".repeat(64));
    expect(v(1, "note-corrects")).toBeUndefined();
  });

  it("una corrección señala la nota que corrige", () => {
    const corrects = (notes[2]!.extension as Array<Record<string, unknown>>).find((e) =>
      String(e.url).endsWith("note-corrects"),
    );
    expect(corrects?.valueReference).toEqual({ reference: "ClinicalImpression/n2" });
  });

  it("la etiqueta del paquete lleva la firma de la última nota", () => {
    expect(b.meta.tag).toEqual([
      {
        system: `${FHIR_BASE}/chain-tip`,
        code: "c".repeat(64),
        display: "Firma de la nota n.º 3: permite comprobar que la cadena de notas no se alteró",
      },
    ]);
  });
});

describe("límite de controles", () => {
  const obs = Array.from({ length: 5 }, (_, i) =>
    mkObs({
      id: `o${i}`,
      patient_id: patient.id,
      recorded_at: new Date(NOW - (5 - i) * 3_600_000).toISOString(),
      hr: 60 + i,
      rr: null,
      spo2: null,
      temp_c: null,
      sbp: null,
      dbp: null,
      avpu: null,
      on_o2: null,
      news2: null,
      band: null,
    }),
  );

  it("se quedan los más recientes, en orden cronológico, y el paquete avisa que recortó", () => {
    const b = buildFhirBundle({
      ...base,
      patient,
      cases: [],
      notes: [],
      obs: [...obs].reverse(),
      maxObs: 3,
    });
    const kept = find(b, "Observation").map((e) => e.resource.id);
    expect(kept).toEqual(["o2-hr", "o3-hr", "o4-hr"]);
    expect(b.meta.tag).toEqual([
      {
        system: `${FHIR_BASE}/truncated`,
        code: "observations",
        display: "Se incluyen los 3 controles más recientes de 5",
      },
    ]);
  });

  it("si cabe todo, no hay aviso de recorte", () => {
    const b = buildFhirBundle({ ...base, patient, cases: [], notes: [], obs, maxObs: 5 });
    expect(find(b, "Observation")).toHaveLength(5);
    expect(b.meta.tag).toBeUndefined();
  });
});

describe("paquete completo", () => {
  const p = mkPatient({ id: "p1" });
  const b = buildFhirBundle({
    ...base,
    patient: p,
    cases: [
      mkCase({ id: "c1", patient_id: "p1" }),
      mkCase({
        id: "c2",
        patient_id: "p1",
        status: "completed",
        closed_at: "2026-10-10T15:00:00.000Z",
        outcome: "stable",
        satisfaction: 4,
      }),
    ],
    notes: [
      mkNote({ id: "n1", patient_id: "p1", seq: 1 }),
      mkNote({ id: "n2", patient_id: "p1", seq: 2, corrects_note_id: "n1", kind: "correction" }),
    ],
    obs: [
      mkObs({ id: "o1", patient_id: "p1", pain: 3, fall: true, news2_input: { carried: ["rr"] } }),
      mkObs({ id: "o2", patient_id: "p1", source: "device", recorded_by_name: null, dbp: null }),
      mkObs({ id: "o3", patient_id: "p1", applicable: false, news2: null, band: null }),
    ],
  });

  it("toda referencia apunta a una entrada del mismo paquete", () => {
    const urls = new Set(b.entry.map((e) => e.fullUrl));
    const refs = references(b);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(urls.has(`${FHIR_BASE}/${r}`), r).toBe(true);
  });

  it("cada entrada: dirección única, igual a base/tipo/id, y un id válido de FHIR", () => {
    const urls = b.entry.map((e) => e.fullUrl);
    expect(new Set(urls).size).toBe(urls.length);
    for (const e of b.entry) {
      expect(e.fullUrl).toBe(`${FHIR_BASE}/${e.resource.resourceType}/${e.resource.id}`);
      expect(e.resource.id).toMatch(/^[A-Za-z0-9\-.]{1,64}$/);
    }
  });

  it("es JSON de FHIR válido: sin nulos, vacíos ni valores indefinidos, y sobrevive a ida y vuelta", () => {
    expect(problems(b)).toEqual([]);
    expect(JSON.parse(fhirJson(b))).toEqual(b);
  });

  it("es determinista: la misma entrada da el mismo paquete", () => {
    const again = buildFhirBundle({
      ...base,
      patient: p,
      cases: [mkCase({ id: "c1", patient_id: "p1" })],
      notes: [],
      obs: [],
    });
    const twice = buildFhirBundle({
      ...base,
      patient: p,
      cases: [mkCase({ id: "c1", patient_id: "p1" })],
      notes: [],
      obs: [],
    });
    expect(fhirJson(again)).toBe(fhirJson(twice));
  });

  it("resumen: cuenta cada tipo, con singular y plural", () => {
    expect(bundleCounts(b).Patient).toBe(1);
    expect(bundleCounts(b).EpisodeOfCare).toBe(2);
    expect(bundleSummary(b)).toMatch(
      /^2 condiciones · 1 alergia · 2 casos · \d+ observaciones clínicas · 2 notas$/,
    );
    const one = buildFhirBundle({
      ...base,
      patient: mkPatient({ conditions: ["EPOC"], allergies: [] }),
      cases: [mkCase()],
      notes: [mkNote()],
      obs: [
        mkObs({
          hr: 70,
          rr: null,
          spo2: null,
          temp_c: null,
          sbp: null,
          dbp: null,
          avpu: null,
          on_o2: null,
          news2: null,
          band: null,
        }),
      ],
    });
    expect(bundleSummary(one)).toBe("1 condición · 1 caso · 1 observación clínica · 1 nota");
    expect(
      bundleSummary(
        buildFhirBundle({
          ...base,
          patient: mkPatient({ conditions: [], allergies: [] }),
          cases: [],
          notes: [],
          obs: [],
        }),
      ),
    ).toBe("");
  });
});

describe("nombre del archivo", () => {
  it("sin tildes ni ñ, en minúsculas y con la fecha de Colombia", () => {
    expect(fhirFileName({ full_name: "Ana Lucía Pérez Ñandú" }, NOW)).toBe(
      "humanix-historia-ana-lucia-perez-nandu-20261014.json",
    );
  });

  it("a las 9 p. m. en Colombia ya es el día siguiente en UTC: el archivo lleva la fecha de Colombia", () => {
    expect(fhirFileName({ full_name: "Ana" }, Date.parse("2026-10-15T02:00:00Z"))).toBe(
      "humanix-historia-ana-20261014.json",
    );
  });

  it("nombres raros o larguísimos no dejan guiones sueltos ni rutas", () => {
    expect(fhirFileName({ full_name: "../../etc/passwd" }, NOW)).toBe(
      "humanix-historia-etc-passwd-20261014.json",
    );
    expect(fhirFileName({ full_name: "—— ··" }, NOW)).toBe(
      "humanix-historia-paciente-20261014.json",
    );
    const long = fhirFileName({ full_name: `${"a".repeat(39)} bbbbbbbbbb` }, NOW);
    expect(long).toBe(`humanix-historia-${"a".repeat(39)}-20261014.json`);
  });
});
