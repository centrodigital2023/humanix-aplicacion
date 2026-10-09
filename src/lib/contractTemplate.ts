// Contrato inteligente de turnos: términos estructurados → texto legible → huella verificable.
//
// Los TÉRMINOS (JSON) los congela el servidor al aceptar la postulación (`create_contract_for_application`)
// y llevan su hash SHA-256. El TEXTO se genera aquí de forma determinista a partir de los términos y de la
// versión de plantilla (`terms.template`); su hash (`bodyHash`) queda en cada firma, de modo que se puede
// probar exactamente qué texto vio y aceptó cada parte. Si cambias el texto de una plantilla publicada,
// crea una versión nueva (`humanix-shift-v2`) y deja la anterior intacta: los contratos ya firmados deben
// seguir produciendo el mismo texto y la misma huella.
//
// Marco: Ley 527 de 1999 y Decreto 2364 de 2012 (firma electrónica), Ley 1581 de 2012 (datos personales),
// Resolución 3100 de 2019 (habilitación). PLANTILLA INFORMATIVA: debe revisarla un abogado antes de usarse
// con instituciones reales, sobre todo la cláusula de naturaleza independiente (riesgo de contrato realidad).

import { formatCOP } from "./pricing";
import { formatShiftRange } from "./opportunities";
import { MODALITY_LABEL, isOfferModality, type OfferModality } from "./institutionNegotiation";

export const TEMPLATE_V1 = "humanix-shift-v1" as const;
export const SUPPORTED_TEMPLATES: readonly string[] = [TEMPLATE_V1];

export type ContractParty = "institution" | "professional";

export interface ContractShift {
  no: number;
  starts_at: string;
  ends_at: string;
  hours: number;
  amount: number;
}

export interface ContractConditions {
  cancellation_notice_hours: number;
  institution_late_cancel_pct: number;
  tolerance_minutes: number;
  checkin_required: boolean;
  biosafety_provided: boolean;
  confidentiality: boolean;
  replacement_duty: boolean;
  extra: string | null;
}

export interface ContractTerms {
  template: string;
  version: number;
  contract_no: string;
  parties: {
    institution: {
      user_id: string;
      name: string;
      type: string | null;
      nit: string | null;
      legal_representative: string | null;
      city: string | null;
      verified: boolean;
    };
    professional: {
      user_id: string;
      name: string;
      specialty: string | null;
      rethus_number: string | null;
      rethus_verified: boolean;
    };
  };
  object: {
    title: string;
    description: string | null;
    specialty: string | null;
    service_area: string | null;
    city: string | null;
    address: string | null;
    modality: OfferModality;
    requirements: string[];
  };
  shifts: ContractShift[];
  economics: {
    agreed_amount: number;
    posted_amount: number;
    modality: OfferModality;
    currency: "COP";
    total_amount: number;
    commission_pct: number;
    professional_net: number;
    payment_channel: "platform_web_only";
  };
  conditions: ContractConditions;
  legal: {
    signature_deadline: string;
    governing_law: string;
    esign_agreement: boolean;
    data_protection: string;
    dispute: string;
  };
  required_clauses: string[];
  generated_at: string;
}

export const DEFAULT_CONDITIONS: ContractConditions = {
  cancellation_notice_hours: 12,
  institution_late_cancel_pct: 50,
  tolerance_minutes: 15,
  checkin_required: true,
  biosafety_provided: true,
  confidentiality: true,
  replacement_duty: true,
  extra: null,
};

/** Valores que la institución puede elegir mientras nadie haya firmado (igual que `update_contract_conditions`). */
export const CANCELLATION_NOTICE_OPTIONS = [0, 2, 6, 12, 24, 48] as const;
export const MAX_EXTRA_CONDITIONS = 600;

// ─── Validación defensiva de lo que llega del servidor ───────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Convierte el JSON del servidor en términos tipados; devuelve null si falta lo esencial. */
export function parseContractTerms(value: unknown): ContractTerms | null {
  if (!isObj(value)) return null;
  const template = str(value.template);
  const parties = isObj(value.parties) ? value.parties : null;
  const inst = parties && isObj(parties.institution) ? parties.institution : null;
  const pro = parties && isObj(parties.professional) ? parties.professional : null;
  const obj = isObj(value.object) ? value.object : null;
  const eco = isObj(value.economics) ? value.economics : null;
  if (!template || !inst || !pro || !obj || !eco || !Array.isArray(value.shifts)) return null;
  const modality = isOfferModality(eco.modality) ? eco.modality : null;
  if (!modality) return null;

  const cond = isObj(value.conditions) ? value.conditions : {};
  const legal = isObj(value.legal) ? value.legal : {};
  const shifts: ContractShift[] = [];
  for (const raw of value.shifts) {
    if (!isObj(raw)) return null;
    const starts = str(raw.starts_at);
    const ends = str(raw.ends_at);
    if (!starts || !ends) return null;
    shifts.push({
      no: num(raw.no, shifts.length + 1),
      starts_at: starts,
      ends_at: ends,
      hours: num(raw.hours),
      amount: num(raw.amount),
    });
  }

  return {
    template,
    version: num(value.version, 1),
    contract_no: str(value.contract_no) ?? "—",
    parties: {
      institution: {
        user_id: str(inst.user_id) ?? "",
        name: str(inst.name) ?? "Institución",
        type: str(inst.type),
        nit: str(inst.nit),
        legal_representative: str(inst.legal_representative),
        city: str(inst.city),
        verified: inst.verified === true,
      },
      professional: {
        user_id: str(pro.user_id) ?? "",
        name: str(pro.name) ?? "Profesional",
        specialty: str(pro.specialty),
        rethus_number: str(pro.rethus_number),
        rethus_verified: pro.rethus_verified === true,
      },
    },
    object: {
      title: str(obj.title) ?? "Turnos de salud",
      description: str(obj.description),
      specialty: str(obj.specialty),
      service_area: str(obj.service_area),
      city: str(obj.city),
      address: str(obj.address),
      modality,
      requirements: Array.isArray(obj.requirements)
        ? obj.requirements.filter((r): r is string => typeof r === "string" && r.trim() !== "")
        : [],
    },
    shifts,
    economics: {
      agreed_amount: num(eco.agreed_amount),
      posted_amount: num(eco.posted_amount),
      modality,
      currency: "COP",
      total_amount: num(eco.total_amount),
      commission_pct: num(eco.commission_pct),
      professional_net: num(eco.professional_net),
      payment_channel: "platform_web_only",
    },
    conditions: {
      cancellation_notice_hours: num(
        cond.cancellation_notice_hours,
        DEFAULT_CONDITIONS.cancellation_notice_hours,
      ),
      institution_late_cancel_pct: num(
        cond.institution_late_cancel_pct,
        DEFAULT_CONDITIONS.institution_late_cancel_pct,
      ),
      tolerance_minutes: num(cond.tolerance_minutes, DEFAULT_CONDITIONS.tolerance_minutes),
      checkin_required: cond.checkin_required !== false,
      biosafety_provided: cond.biosafety_provided !== false,
      confidentiality: cond.confidentiality !== false,
      replacement_duty: cond.replacement_duty !== false,
      extra: str(cond.extra),
    },
    legal: {
      signature_deadline: str(legal.signature_deadline) ?? "",
      governing_law: str(legal.governing_law) ?? "CO",
      esign_agreement: legal.esign_agreement !== false,
      data_protection: str(legal.data_protection) ?? "ley_1581_2012",
      dispute: str(legal.dispute) ?? "conciliacion_pqrs",
    },
    required_clauses: Array.isArray(value.required_clauses)
      ? value.required_clauses.filter((c): c is string => typeof c === "string")
      : [],
    generated_at: str(value.generated_at) ?? "",
  };
}

// ─── Declaraciones que cada parte acepta de forma explícita ──────────────────

export interface Acceptance {
  id: string;
  label: string;
}

export function acceptanceItems(party: ContractParty): Acceptance[] {
  return [
    {
      id: "contract",
      label:
        "He leído el contrato completo: objeto, turnos, valor y condiciones, y estoy de acuerdo con ellos.",
    },
    {
      id: "credentials",
      label:
        party === "professional"
          ? "Declaro que mi título y mi inscripción en el RETHUS son verídicos y están vigentes."
          : "Declaro que el NIT, la representación legal y la habilitación de la institución son verídicos y están vigentes.",
    },
    {
      id: "confidentiality",
      label:
        "Me obligo a la confidencialidad de la información de pacientes y al tratamiento de datos personales conforme a la Ley 1581 de 2012.",
    },
    {
      id: "esign",
      label:
        "Acepto firmar de forma electrónica: mi cuenta verificada y el código enviado a mi correo constituyen mi firma (Ley 527 de 1999 y Decreto 2364 de 2012).",
    },
  ];
}

export function missingAcceptances(required: string[], accepted: string[]): string[] {
  const ok = new Set(accepted);
  return required.filter((id) => !ok.has(id));
}

// ─── Texto del contrato ──────────────────────────────────────────────────────

export interface RenderedClause {
  id: string;
  number: number;
  title: string;
  paragraphs: string[];
}

export interface RenderedContract {
  templateVersion: string;
  title: string;
  contractNo: string;
  preamble: string;
  clauses: RenderedClause[];
  footer: string;
  /** Texto plano canónico (saltos de línea LF): es lo que se hashea y se firma. */
  text: string;
}

const TITLE = "CONTRATO DE PRESTACIÓN DE SERVICIOS DE SALUD POR TURNOS";
const FOOTER =
  "Plantilla informativa de Humanix. Las partes pueden consultar a su asesor jurídico antes de firmar.";

function shiftLine(s: ContractShift): string {
  return `Turno ${s.no}: ${formatShiftRange(s.starts_at, s.ends_at)} — ${formatCOP(s.amount)}`;
}

function paymentSentence(t: ContractTerms): string {
  const e = t.economics;
  const unit = MODALITY_LABEL[e.modality];
  return `El valor acordado es ${formatCOP(e.agreed_amount)} ${unit}${
    e.agreed_amount !== e.posted_amount
      ? ` (la oferta publicada era de ${formatCOP(e.posted_amount)})`
      : ""
  }.`;
}

function cancellationText(c: ContractConditions): string[] {
  if (c.cancellation_notice_hours === 0) {
    return ["No se pacta aviso mínimo para cancelar un turno."];
  }
  const out = [
    `Cancelar un turno con menos de ${c.cancellation_notice_hours} horas de anticipación se considera cancelación tardía.`,
  ];
  out.push(
    c.institution_late_cancel_pct > 0
      ? `Si la cancelación tardía es de LA INSTITUCIÓN, esta reconoce a EL PROFESIONAL el ${c.institution_late_cancel_pct} % del valor del turno cancelado.`
      : "Si la cancelación tardía es de LA INSTITUCIÓN, no hay compensación económica.",
  );
  out.push(
    c.replacement_duty
      ? "Si la cancelación tardía es de EL PROFESIONAL, este colaborará de buena fe para conseguir un reemplazo, y la cancelación quedará registrada en su reputación dentro de Humanix."
      : "Si la cancelación tardía es de EL PROFESIONAL, esta quedará registrada en su reputación dentro de Humanix.",
  );
  return out;
}

function renderV1(t: ContractTerms): RenderedContract {
  const { institution: inst, professional: pro } = t.parties;
  const preamble = [
    `Entre ${inst.name}${inst.nit ? `, identificada con NIT ${inst.nit}` : ""}${
      inst.legal_representative ? `, representada por ${inst.legal_representative}` : ""
    }, en adelante LA INSTITUCIÓN, y ${pro.name}${pro.specialty ? `, ${pro.specialty}` : ""}${
      pro.rethus_number ? `, con registro RETHUS ${pro.rethus_number}` : ""
    }, en adelante EL PROFESIONAL, ambos identificados y verificados en la plataforma Humanix, se celebra el presente contrato (${t.contract_no}, versión ${t.version}), que se rige por las siguientes cláusulas.`,
  ].join(" ");

  const place = [t.object.service_area, t.object.address, t.object.city].filter(Boolean).join(", ");
  const object: string[] = [
    `EL PROFESIONAL prestará de forma independiente servicios de ${t.object.specialty ?? "salud"} en ${
      t.object.service_area ?? "los servicios de LA INSTITUCIÓN"
    }${t.object.city ? ` (${t.object.city})` : ""}, en los turnos de la cláusula 2, conforme a la oferta «${t.object.title}» publicada y aceptada en Humanix.`,
  ];
  if (t.object.description) object.push(`Descripción de la oferta: ${t.object.description}`);
  if (t.object.requirements.length) {
    object.push(`Requisitos acordados: ${t.object.requirements.join("; ")}.`);
  }

  const shifts: string[] = [
    ...t.shifts.map(shiftLine),
    `Lugar de ejecución: ${place || "el indicado por LA INSTITUCIÓN"}.`,
    "Los horarios están expresados en hora de Colombia.",
  ];

  const e = t.economics;
  const economics: string[] = [
    paymentSentence(t),
    `Valor total del contrato: ${formatCOP(e.total_amount)} (${e.currency}) por ${t.shifts.length} ${
      t.shifts.length === 1 ? "turno" : "turnos"
    }.`,
    e.commission_pct > 0
      ? `Sobre este servicio Humanix aplica una comisión del ${e.commission_pct} % por el plan vigente de EL PROFESIONAL; su valor neto estimado es ${formatCOP(e.professional_net)}.`
      : `Humanix no aplica comisión sobre este servicio por el plan vigente de EL PROFESIONAL; su valor neto estimado es ${formatCOP(e.professional_net)}.`,
    "Los pagos asociados a este servicio se gestionan únicamente desde la página web de Humanix. Ninguna de las partes solicitará ni realizará pagos por WhatsApp, mensajes o enlaces externos.",
  ];

  const c = t.conditions;
  const conditions: string[] = [
    `Puntualidad: EL PROFESIONAL llega a la hora de inicio de cada turno; se tolera un retraso de hasta ${c.tolerance_minutes} minutos, pasados los cuales LA INSTITUCIÓN puede reasignar el turno.`,
    c.checkin_required
      ? "EL PROFESIONAL registrará su llegada y su salida de cada turno en Humanix."
      : "No se exige registro de llegada y salida en Humanix.",
    ...cancellationText(c),
    c.biosafety_provided
      ? "LA INSTITUCIÓN suministrará los elementos de protección personal y de bioseguridad que exija el servicio."
      : "EL PROFESIONAL aportará sus propios elementos de protección personal y de bioseguridad.",
  ];
  if (c.extra) conditions.push(`Condiciones adicionales acordadas: ${c.extra}`);

  const clauses: RenderedClause[] = [
    { id: "object", number: 1, title: "Objeto", paragraphs: object },
    { id: "shifts", number: 2, title: "Turnos, horario y lugar", paragraphs: shifts },
    { id: "economics", number: 3, title: "Valor y forma de pago", paragraphs: economics },
    { id: "conditions", number: 4, title: "Condiciones del servicio", paragraphs: conditions },
    {
      id: "nature",
      number: 5,
      title: "Naturaleza independiente y seguridad social",
      paragraphs: [
        "El presente es un contrato de prestación de servicios independientes. EL PROFESIONAL actúa con autonomía técnica y administrativa, aporta sus propios medios y declara estar afiliado y al día en el Sistema de Seguridad Social Integral como trabajador independiente, conforme a la normativa vigente.",
        "Este contrato no genera relación laboral entre las partes. Las partes se comprometen a ejecutarlo de forma coherente con su naturaleza independiente.",
      ],
    },
    {
      id: "credentials",
      number: 6,
      title: "Habilitación y credenciales",
      paragraphs: [
        "EL PROFESIONAL declara que su título y su inscripción en el Registro Único Nacional del Talento Humano en Salud (RETHUS) están vigentes y que no tiene sanciones que le impidan ejercer.",
        "LA INSTITUCIÓN declara contar con la habilitación de los servicios donde se prestará el turno, de acuerdo con la Resolución 3100 de 2019 o la norma que la sustituya, y que su NIT y su representante legal son los indicados en este contrato.",
        "Cada parte autoriza a Humanix a conservar la evidencia de su verificación de identidad.",
      ],
    },
    {
      id: "confidentiality",
      number: 7,
      title: "Confidencialidad y datos personales",
      paragraphs: [
        "Las partes guardarán reserva sobre la información de los pacientes y su historia clínica, y tratarán los datos personales conforme a la Ley 1581 de 2012, usándolos únicamente para ejecutar el servicio.",
        "EL PROFESIONAL no compartirá información de pacientes por canales no autorizados por LA INSTITUCIÓN. Esta obligación subsiste después de terminado el contrato.",
      ],
    },
    {
      id: "esign",
      number: 8,
      title: "Firma electrónica y evidencia",
      paragraphs: [
        "Las partes acuerdan firmar este contrato por medios electrónicos, conforme a la Ley 527 de 1999 y al Decreto 2364 de 2012, y reconocen que la firma consiste en: (i) autenticarse con su cuenta de Humanix; (ii) validar su identidad con la verificación RETHUS o con el NIT y la representación legal registrados; (iii) confirmar un código de un solo uso enviado a su correo; y (iv) aceptar de forma expresa las declaraciones del contrato.",
        "Humanix conserva la huella (hash SHA-256) del contrato, la fecha y hora de cada firma y una cadena de eventos encadenados que permite detectar cualquier alteración posterior. Cualquier cambio a los términos genera una nueva versión que debe firmarse de nuevo.",
      ],
    },
    {
      id: "disputes",
      number: 9,
      title: "Controversias y ley aplicable",
      paragraphs: [
        "Este contrato se rige por la ley colombiana. Las diferencias se buscarán resolver primero por comunicación directa y por el canal de PQRS de Humanix; si no hay acuerdo, por conciliación y, en su defecto, ante la justicia ordinaria de Colombia.",
      ],
    },
    {
      id: "term",
      number: 10,
      title: "Vigencia y modificaciones",
      paragraphs: [
        "El contrato rige desde la firma de ambas partes hasta la ejecución del último turno. Cualquier modificación se hará por escrito en una nueva versión firmada por ambas partes.",
      ],
    },
  ];

  const lines: string[] = [TITLE, `N.° ${t.contract_no} · versión ${t.version}`, "", preamble, ""];
  for (const cl of clauses) {
    lines.push(`${cl.number}. ${cl.title.toUpperCase()}`);
    for (const p of cl.paragraphs) lines.push(p);
    lines.push("");
  }
  lines.push(FOOTER);

  return {
    templateVersion: TEMPLATE_V1,
    title: TITLE,
    contractNo: t.contract_no,
    preamble,
    clauses,
    footer: FOOTER,
    text: lines.join("\n"),
  };
}

const RENDERERS: Record<string, (t: ContractTerms) => RenderedContract> = {
  [TEMPLATE_V1]: renderV1,
};

export function isSupportedTemplate(template: string): boolean {
  return template in RENDERERS;
}

/** Texto del contrato para una plantilla publicada. Lanza si la plantilla no se conoce. */
export function renderContract(terms: ContractTerms): RenderedContract {
  const render = RENDERERS[terms.template];
  if (!render) throw new Error(`Plantilla de contrato desconocida: ${terms.template}`);
  return render(terms);
}

// ─── Huellas ─────────────────────────────────────────────────────────────────

/** SHA-256 en hexadecimal (Web Crypto: navegador, Node y Bun). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Huella del texto que verá y firmará la persona. */
export async function contractBodyHash(terms: ContractTerms): Promise<string> {
  return sha256Hex(renderContract(terms).text);
}

// ─── Estados ─────────────────────────────────────────────────────────────────

export type ContractStatus =
  | "pending_signature"
  | "partially_signed"
  | "active"
  | "completed"
  | "declined"
  | "cancelled"
  | "expired";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  pending_signature: "Pendiente de firmas",
  partially_signed: "Falta una firma",
  active: "Vigente",
  completed: "Cumplido",
  declined: "Rechazado",
  cancelled: "Cancelado",
  expired: "Venció sin firmarse",
};

export function isSignableStatus(status: string): boolean {
  return status === "pending_signature" || status === "partially_signed";
}

export function contractStatusLabel(status: string): string {
  return CONTRACT_STATUS_LABEL[status as ContractStatus] ?? status;
}

/** ¿Puede esta parte firmar ahora? (estado, plazo y que no haya firmado ya). */
export function canSignNow(args: {
  status: string;
  deadline: string | null;
  iSigned: boolean;
  now?: number;
}): { ok: boolean; reason: string | null } {
  if (args.iSigned) return { ok: false, reason: "Ya firmaste este contrato." };
  if (!isSignableStatus(args.status)) {
    return {
      ok: false,
      reason: `El contrato está en estado «${contractStatusLabel(args.status)}».`,
    };
  }
  const deadline = args.deadline ? new Date(args.deadline).getTime() : Number.NaN;
  if (Number.isFinite(deadline) && deadline <= (args.now ?? Date.now())) {
    return { ok: false, reason: "El plazo para firmar venció." };
  }
  return { ok: true, reason: null };
}

/** «Firma antes de mañana 18:00» / «Quedan 5 h para firmar». */
export function signatureCountdown(deadline: string | null, now = Date.now()): string | null {
  if (!deadline) return null;
  const left = new Date(deadline).getTime() - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "El plazo para firmar venció";
  const hours = Math.floor(left / 3_600_000);
  if (hours >= 48) return `Quedan ${Math.floor(hours / 24)} días para firmar`;
  if (hours >= 1) return `Quedan ${hours} h para firmar`;
  return `Quedan ${Math.max(1, Math.floor(left / 60_000))} min para firmar`;
}
