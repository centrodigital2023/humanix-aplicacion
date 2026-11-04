// «Nuestro acuerdo de cuidado»: el contrato de prestación de servicios entre quien contrata (familia, EPS o IPS) y el
// profesional, para las reservas que NO nacen de una postulación a una institución (esas usan el contrato inteligente,
// `contractTemplate.ts`).
//
// Por qué existe: la tarjeta anterior leía la tabla `service_contracts`, que nunca se creó en producción. La consulta fallaba,
// el error se ignoraba y la tarjeta desaparecía sin decir nada. Ahora el TEXTO del contrato se genera aquí, de forma
// determinista, a partir de la reserva y de la versión de plantilla; el servidor solo guarda la ACEPTACIÓN de cada parte
// (`service_contract_acceptances`, migración 20261104200000): quién, cuándo, versión, huella SHA-256 del texto, IP, dispositivo
// y una copia de las condiciones clave de la reserva en ese momento.
//
// Si cambias el texto, crea una versión nueva (`SERVICE_CONTRACT_V2`) y deja la anterior intacta: lo ya aceptado debe seguir
// produciendo el mismo texto y la misma huella.
//
// Marco: Código Civil (arts. 1495, 1602, 2063 y 2144), Código de Comercio (art. 864), Ley 1480 de 2011 (consumidor),
// Ley 1581 de 2012 y Decreto 1074 de 2015 (datos personales), Ley 527 de 1999 y Decreto 2364 de 2012 (aceptación y firma
// electrónica), Código Sustantivo del Trabajo (art. 23) y Ley 1164 de 2007 (talento humano en salud).
//
// AVISO INTERNO: es una plantilla redactada con cuidado, pero NO reemplaza la revisión de un abogado colombiano antes de
// usarse a gran escala, sobre todo la cláusula de independencia (riesgo de «contrato realidad») y la de datos de salud.

import { ESCROW_WINDOW_HOURS } from "./escrow";
import { MIN_BOOKING_COP, PRO_TIERS } from "./commissionMatrix";

export const SERVICE_CONTRACT_V1 = "hx-cuidado-v1" as const;
export const SERVICE_CONTRACT_VERSION = SERVICE_CONTRACT_V1;

export type ContractSide = "client" | "professional";

export interface ServiceContractBooking {
  id: string;
  scheduled_at: string;
  duration_hours: number;
  hourly_rate?: number | null;
  total_amount: number;
  payment_method?: string | null;
  platform_fee_pct?: number | null;
  service_address?: string | null;
}

/** Lo que el servidor copia de la reserva al aceptar. Si algo de esto cambia, hay que volver a aceptar. */
export interface ContractKeyTerms {
  scheduled_at: string;
  duration_hours: number;
  total_amount: number;
  payment_method: "DIGITAL_BREB" | "CASH";
}

export interface ContractAcceptance {
  party: ContractSide;
  user_id: string;
  terms_version: string;
  text_sha256: string;
  accepted_at: string;
  key_terms: Partial<ContractKeyTerms> | null;
}

export interface ContractClause {
  id: string;
  number: number;
  title: string;
  /** Una frase «en palabras simples» que se ve sin abrir la cláusula. No cambia lo que dice el texto completo. */
  simple: string;
  paragraphs: string[];
}

export interface RenderedServiceContract {
  version: string;
  title: string;
  /** Lo esencial en pocas líneas, para leer en 30 segundos. */
  essentials: { id: string; text: string }[];
  preamble: string;
  clauses: ContractClause[];
  closing: string;
  /** Texto plano canónico (saltos de línea LF): es lo que se hashea. */
  text: string;
}

// ─── Formatos deterministas (no dependen del navegador ni de su zona horaria) ────────────────

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000; // Colombia no tiene horario de verano.

export function pesos(n: number): string {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}$${s}`;
}

/** «4 de noviembre de 2026, 2:30 p. m.» en hora de Colombia. */
export function bogotaDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "fecha por confirmar";
  const d = new Date(t + BOGOTA_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${h12}:${min} ${
    h24 < 12 ? "a. m." : "p. m."
  }`;
}

function hoursLabel(h: number): string {
  const v = Math.round((Number(h) || 0) * 100) / 100;
  const txt = String(v).replace(".", ",");
  return `${txt} ${v === 1 ? "hora" : "horas"}`;
}

export function normalizePaymentMethod(m: string | null | undefined): "DIGITAL_BREB" | "CASH" {
  return m === "CASH" ? "CASH" : "DIGITAL_BREB";
}

export function keyTermsOf(b: ServiceContractBooking): ContractKeyTerms {
  return {
    scheduled_at: new Date(Date.parse(b.scheduled_at)).toISOString(),
    duration_hours: Number(b.duration_hours) || 0,
    total_amount: Math.round(Number(b.total_amount) || 0),
    payment_method: normalizePaymentMethod(b.payment_method),
  };
}

// ─── Texto ──────────────────────────────────────────────────────────────────

const TITLE = "Contrato de prestación de servicios de cuidado";

function commissionSentence(pct: number | null | undefined): string {
  const tiers = PRO_TIERS.slice()
    .reverse()
    .map((t) => `${t.pct}\u00a0%`)
    .join(", ");
  const p = Number(pct);
  return Number.isFinite(p) && p > 0
    ? `Por usar la plataforma, el profesional paga a Humanix una comisión del ${String(p).replace(".", ",")}\u00a0% de este servicio.`
    : `Por usar la plataforma, el profesional paga a Humanix una comisión según su volumen de turnos (${tiers}).`;
}

export function renderServiceContract(b: ServiceContractBooking): RenderedServiceContract {
  const k = keyTermsOf(b);
  const when = bogotaDateTime(k.scheduled_at);
  const total = pesos(k.total_amount);
  const cash = k.payment_method === "CASH";
  const w = ESCROW_WINDOW_HOURS;
  const address = (b.service_address ?? "").trim();
  const ref = b.id.slice(0, 8).toUpperCase();

  const essentials = [
    {
      id: "what",
      text: `Un turno de cuidado de ${hoursLabel(k.duration_hours)} el ${when}, por ${total} en total.`,
    },
    {
      id: "pay",
      text: cash
        ? "Quien contrata paga en efectivo, en mano, cuando el turno termina. No paga comisión."
        : `Quien contrata paga con Bre-B y no paga comisión. Humanix guarda el dinero y se lo entrega al profesional cuando quien contrata confirma que todo salió bien (o a las ${w} horas).`,
    },
    {
      id: "cancel",
      text: cash
        ? "Cualquiera de los dos puede cancelar sin costo hasta que el cuidado empiece."
        : "Cualquiera de los dos puede cancelar hasta que el cuidado empiece, y se devuelve el 100\u00a0% de lo pagado.",
    },
    {
      id: "independent",
      text: "El profesional trabaja de forma independiente: esto no es un contrato de trabajo.",
    },
    {
      id: "data",
      text: "Los datos de salud se usan solo para cuidar y se guardan con reserva.",
    },
    {
      id: "help",
      text: "Si algo sale mal, se reporta en la app. En una emergencia, primero se llama al 123.",
    },
  ];

  const preamble =
    `Este contrato lo celebran, por una parte, quien solicita el servicio en Humanix (en adelante, «el contratante»), ` +
    `y por otra, el profesional que lo acepta (en adelante, «el profesional»). Humanix S.A.S., con domicilio en Pasto, ` +
    `Nariño, participa solo como plataforma tecnológica que los pone en contacto, recauda el pago y lo entrega. ` +
    `Reserva ${ref}. Se rige por los artículos 1495, 1602, 2063 y 2144 del Código Civil, el artículo 864 del ` +
    `Código de Comercio y las demás normas colombianas que se citan.`;

  const raw: Omit<ContractClause, "number">[] = [
    {
      id: "object",
      title: "Qué se contrata",
      simple: "Un turno de cuidado en la fecha, hora y lugar de la reserva.",
      paragraphs: [
        `El profesional prestará un servicio de cuidado y acompañamiento el ${when}, durante ${hoursLabel(
          k.duration_hours,
        )}${address ? `, en ${address}` : ", en la dirección registrada en la reserva"}, según las necesidades del paciente descritas en la solicitud.`,
        "El profesional actúa con autonomía técnica y según su formación (Ley 1164 de 2007). Solo realizará actividades para las que esté capacitado y habilitado. Este servicio no reemplaza la atención de urgencias ni la de una IPS habilitada.",
        "En una emergencia médica, cualquiera de las partes debe llamar primero a la línea 123 y luego avisar por la app.",
      ],
    },
    {
      id: "price",
      title: "Valor y forma de pago",
      simple: cash
        ? `${total} en efectivo al terminar. El contratante no paga comisión.`
        : `${total} por Bre-B al pedir el turno. El contratante no paga comisión.`,
      paragraphs: [
        `El valor total del servicio es ${total} (pesos colombianos), que incluye todo lo acordado. El valor mínimo de un turno en Humanix es ${pesos(
          MIN_BOOKING_COP,
        )}.`,
        cash
          ? "Forma de pago: efectivo. El contratante le paga al profesional en mano cuando el turno termina."
          : "Forma de pago: transferencia Bre-B a través de Humanix, al pedir el turno.",
        `El contratante no paga comisión. ${commissionSentence(b.platform_fee_pct)}${
          cash
            ? " En pagos en efectivo, esa comisión se descuenta de la billetera Humanix del profesional al terminar."
            : " Se descuenta antes de entregarle el pago."
        }`,
        "Ninguna de las partes cobrará ni pagará valores adicionales por fuera de la plataforma, salvo que ambas lo acuerden por escrito en el chat del servicio.",
      ],
    },
    {
      id: "escrow",
      title: cash ? "Cómo se cierra el turno" : "Pago protegido y confirmación",
      simple: cash
        ? "Cuando el turno termina, el profesional lo marca y recibe su pago en efectivo."
        : `El dinero queda guardado hasta que confirmas o pasan ${w} horas.`,
      paragraphs: cash
        ? [
            "Cuando el profesional marca el turno como terminado, el contratante le paga el valor total en efectivo.",
            "Si hubo un problema, cualquiera de las partes puede reportarlo en la app mientras el turno está abierto. Humanix revisa lo que cada parte cuente y ayuda a encontrar una solución.",
          ]
        : [
            "Humanix guarda el pago mientras se presta el servicio. No se lo entrega al profesional antes de que el turno termine.",
            `Cuando el profesional marca el turno como terminado, el contratante tiene ${w} horas para confirmar que todo salió bien o para reportar un problema. Si confirma, o si pasan las ${w} horas sin reporte, Humanix entrega el pago al profesional.`,
            "Si el contratante reporta un problema, el pago sigue guardado. Humanix revisa las pruebas de ambas partes y decide si lo entrega al profesional o lo devuelve al contratante, y le explica a cada uno por qué.",
          ],
    },
    {
      id: "cancel",
      title: "Cancelar, reprogramar y retracto",
      simple: "Se puede cancelar sin costo hasta que el cuidado empiece.",
      paragraphs: [
        cash
          ? "Cualquiera de las partes puede cancelar sin costo desde la app hasta antes de que el turno pase a «Cuidando». Nadie paga nada."
          : "Cualquiera de las partes puede cancelar desde la app hasta antes de que el turno pase a «Cuidando». Si el contratante ya pagó, Humanix le devuelve el 100\u00a0% a la misma cuenta, sin penalidad.",
        "Cualquiera de las partes puede proponer otra fecha y hora antes de que el profesional salga hacia el domicilio. El cambio solo vale si la otra parte lo acepta en la app.",
        "Una vez empieza el cuidado ya no se puede cancelar desde la app: si algo no está bien, se reporta y Humanix ayuda.",
        "Derecho de retracto (artículo 47 de la Ley 1480 de 2011): cuando el contratante es consumidor puede retractarse dentro de los 5 días hábiles siguientes a la contratación, salvo que el servicio ya haya empezado con su acuerdo. Humanix devuelve el dinero en un máximo de 30 días calendario. La cancelación sin costo descrita arriba es igual o más favorable y no le quita este derecho.",
        cash
          ? "Las cancelaciones repetidas sin causa pueden llevar a que Humanix limite la cuenta."
          : "Cuando proceda, el contratante también puede pedir la reversión del pago según el artículo 51 de la Ley 1480 de 2011. Las cancelaciones repetidas sin causa pueden llevar a que Humanix limite la cuenta.",
      ],
    },
    {
      id: "independence",
      title: "El profesional trabaja de forma independiente",
      simple: "No hay contrato de trabajo con el contratante ni con Humanix.",
      paragraphs: [
        "Este es un contrato civil de prestación de servicios. No es un contrato de trabajo y no crea relación laboral entre el profesional y el contratante, ni entre el profesional y Humanix, porque no existe subordinación (artículo 23 del Código Sustantivo del Trabajo).",
        "El profesional decide libremente si acepta o rechaza turnos, organiza su trabajo y aplica su propio criterio técnico. El contratante puede dar indicaciones razonables sobre el cuidado y las rutinas del paciente, pero no órdenes de tipo laboral, horarios fijos ni sanciones.",
        "El profesional es responsable de sus aportes a seguridad social como independiente y de sus obligaciones tributarias, según la ley vigente. No hay pago de prestaciones sociales.",
      ],
    },
    {
      id: "duties",
      title: "Lo que cada parte se compromete a hacer",
      simple: "Puntualidad, buen cuidado y trato digno; información veraz y un lugar seguro.",
      paragraphs: [
        "El profesional se compromete a: llegar a tiempo o avisar con anticipación; prestar el servicio con cuidado, idoneidad y bioseguridad; mantener vigentes sus títulos y, si aplica, su inscripción en el ReTHUS; registrar lo importante del turno en la app; tratar al paciente y a su familia con respeto; y no subcontratar el servicio sin autorización.",
        "El contratante se compromete a: dar información veraz y completa sobre el paciente (condiciones, alergias, medicamentos, contacto de emergencia); ofrecer un lugar seguro y digno para trabajar; pagar el valor acordado; y tratar al profesional con respeto.",
        "Humanix se compromete a: mantener la plataforma funcionando, guardar y entregar el pago como se describe aquí, atender los reportes y PQRS, y proteger los datos de ambas partes.",
      ],
    },
    {
      id: "quality",
      title: "Calidad, garantía y responsabilidad",
      simple: "El servicio debe prestarse bien; si no, se puede reclamar.",
      paragraphs: [
        "El servicio debe prestarse con la calidad e idoneidad ofrecidas (artículos 6 y 7 de la Ley 1480 de 2011). Si no fue así, el contratante puede reclamar por la app y pedir, según el caso, que se preste de nuevo o la devolución de lo pagado.",
        "Cada parte responde por sus propios actos. El profesional responde por la forma en que presta el servicio; Humanix responde por la plataforma, por el pago que guarda y por la información que publica.",
      ],
    },
    {
      id: "safety",
      title: "Respeto y seguridad",
      simple: "Cero tolerancia al maltrato, el acoso o la discriminación.",
      paragraphs: [
        "Está prohibido cualquier maltrato, acoso, discriminación o abuso, en especial hacia personas mayores, niños o personas con discapacidad (Ley 1251 de 2008 y Ley 1618 de 2013).",
        "Si alguien se siente en riesgo, puede suspender el servicio, reportarlo de inmediato en la app y acudir a las autoridades. Humanix puede suspender o cerrar cuentas que incumplan esta cláusula.",
      ],
    },
    {
      id: "data",
      title: "Datos personales y de salud",
      simple: "Los datos se usan solo para este cuidado y con autorización.",
      paragraphs: [
        "Los datos personales se tratan según la Ley 1581 de 2012, el Decreto 1074 de 2015 y la Política de Privacidad de Humanix (humanix.lat/privacidad).",
        "La información de salud del paciente es un dato sensible. El contratante autoriza de forma expresa que se comparta con el profesional solo para prestar el cuidado, y declara que es el paciente o que tiene su autorización o su representación. Esta autorización es voluntaria y puede revocarse.",
        "El profesional guarda reserva y secreto profesional sobre todo lo que conozca del paciente (Ley 23 de 1981 y Ley 1164 de 2007) y no lo usa para otro fin. Humanix no lleva historias clínicas.",
        "Las partes pueden conocer, actualizar, rectificar y pedir la supresión de sus datos, o revocar su autorización, escribiendo a soporte@humanix.lat.",
      ],
    },
    {
      id: "esign",
      title: "Aceptación electrónica",
      simple: "Aceptar en la app tiene la misma validez que firmar en papel.",
      paragraphs: [
        "Las partes aceptan este contrato por medios electrónicos, con la misma validez y fuerza obligatoria que un contrato firmado en papel (artículos 5, 7 y 14 de la Ley 527 de 1999 y Decreto 2364 de 2012, compilado en el Decreto 1074 de 2015).",
        "Al aceptar, Humanix registra quién acepta (su cuenta), la fecha y hora, la versión de este texto, su huella digital SHA-256, la dirección IP y el dispositivo. Ese registro sirve como prueba de la aceptación y cualquiera de las partes puede consultarlo en la app.",
        "Si cambian la fecha, la duración, el valor o la forma de pago, la app pedirá aceptar de nuevo.",
      ],
    },
    {
      id: "disputes",
      title: "Quejas y solución de diferencias",
      simple: "Primero hablamos; si no, conciliación o autoridades.",
      paragraphs: [
        "Cualquier queja se puede presentar como PQRS en la app o en soporte@humanix.lat. Humanix responde en un máximo de 15 días hábiles.",
        "Las partes buscarán primero un arreglo directo. Si no lo logran, podrán acudir a la conciliación (Ley 2220 de 2022) o a los jueces de Colombia. Cuando el contratante es consumidor, también puede acudir a la Superintendencia de Industria y Comercio.",
        "Este contrato se rige por las leyes de la República de Colombia.",
      ],
    },
    {
      id: "term",
      title: "Duración",
      simple: "Dura lo que dure este turno; la reserva de datos sigue después.",
      paragraphs: [
        "El contrato rige desde que ambas partes lo aceptan hasta que el turno termina y su pago queda resuelto. Termina antes si el servicio se cancela.",
        "La obligación de reserva sobre los datos del paciente continúa después de terminado el contrato.",
      ],
    },
  ];

  const clauses: ContractClause[] = raw.map((c, i) => ({ ...c, number: i + 1 }));
  const closing =
    "Las partes declaran que leyeron este contrato, que lo entienden y que lo aceptan libremente.";

  const lines: string[] = [
    TITLE.toUpperCase(),
    `Versión ${SERVICE_CONTRACT_V1}`,
    "",
    "LO ESENCIAL",
    ...essentials.map((e) => `- ${e.text}`),
    "",
    preamble,
    "",
  ];
  for (const c of clauses) {
    lines.push(`${c.number}. ${c.title.toUpperCase()}`);
    c.paragraphs.forEach((p) => lines.push(p));
    lines.push("");
  }
  lines.push(closing);

  return {
    version: SERVICE_CONTRACT_V1,
    title: TITLE,
    essentials,
    preamble,
    clauses,
    closing,
    text: lines.join("\n"),
  };
}

// ─── Aceptaciones ───────────────────────────────────────────────────────────

/** ¿Una aceptación sigue valiendo para la reserva tal como está ahora? */
export function acceptanceStillValid(a: ContractAcceptance, b: ServiceContractBooking): boolean {
  if (a.terms_version !== SERVICE_CONTRACT_VERSION) return false;
  const kt = a.key_terms;
  if (!kt) return false;
  const now = keyTermsOf(b);
  return (
    Date.parse(String(kt.scheduled_at)) === Date.parse(now.scheduled_at) &&
    Number(kt.duration_hours) === now.duration_hours &&
    Math.round(Number(kt.total_amount)) === now.total_amount &&
    normalizePaymentMethod(kt.payment_method) === now.payment_method
  );
}

export type PartyState = "accepted" | "outdated" | "pending";

/** El estado de cada parte: aceptó esta versión, aceptó una versión anterior (debe volver a aceptar) o falta. */
export function partyState(
  acceptances: ContractAcceptance[],
  party: ContractSide,
  b: ServiceContractBooking,
): { state: PartyState; acceptance: ContractAcceptance | null } {
  const mine = acceptances
    .filter((a) => a.party === party)
    .sort((x, y) => Date.parse(y.accepted_at) - Date.parse(x.accepted_at));
  if (mine.length === 0) return { state: "pending", acceptance: null };
  const valid = mine.find((a) => acceptanceStillValid(a, b));
  if (valid) return { state: "accepted", acceptance: valid };
  return { state: "outdated", acceptance: mine[0] };
}

export const ACCEPT_RESULT_MESSAGE: Record<string, string> = {
  accepted: "¡Listo! Tu aceptación quedó registrada.",
  already_accepted: "Ya habías aceptado esta versión del contrato.",
  forbidden: "Solo las partes del servicio pueden aceptar este contrato.",
  not_found: "No encontramos este servicio. Recarga la página.",
  cancelled: "Este servicio se canceló, así que ya no se puede aceptar el contrato.",
  invalid_version: "El contrato se actualizó. Recarga la página para ver la versión nueva.",
  invalid_hash:
    "No pudimos verificar el texto del contrato. Recarga la página e inténtalo de nuevo.",
  consent_required: "Para continuar, marca las dos casillas.",
};
