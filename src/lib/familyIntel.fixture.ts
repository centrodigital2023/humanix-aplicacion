// Datos de prueba compartidos por las pruebas de las funciones inteligentes del panel de familia
// (no es una prueba: no se carga en la app).
import type { Applicant } from "./applicantRanking";
import type { BudgetBooking } from "./careBudget";
import type { TrustedMember } from "./careLoop";
import type { CareMood } from "./careLog";
import type { BriefApplication, BriefProposal, BriefService, FamilySnapshot } from "./familyBrief";
import type { RadarNeed, RadarProposal } from "./coverageRadar";
import type { WellbeingBooking, WellbeingLog } from "./wellbeing";

export { NOW, HOUR, DAY, iso, mulberry32 } from "./intel.fixture";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

/** Una reserva terminada hace `daysAgo` días (por defecto 6 h a $25.000/h = $150.000). */
export const booking = (over: Partial<BudgetBooking> = {}): BudgetBooking => ({
  id: nextId("b"),
  status: "completed",
  scheduled_at: iso(-3 * DAY),
  completed_at: iso(-3 * DAY + 6 * HOUR),
  duration_hours: 6,
  hourly_rate: 25_000,
  total_amount: 150_000,
  ...over,
});

/** Reserva terminada hace `daysAgo` días. */
export const doneAgo = (daysAgo: number, over: Partial<BudgetBooking> = {}): BudgetBooking =>
  booking({
    scheduled_at: iso(-daysAgo * DAY),
    completed_at: iso(-daysAgo * DAY + 6 * HOUR),
    ...over,
  });

/** Reserva programada dentro de `daysAhead` días. */
export const aheadIn = (daysAhead: number, over: Partial<BudgetBooking> = {}): BudgetBooking =>
  booking({
    status: "confirmed",
    scheduled_at: iso(daysAhead * DAY),
    completed_at: null,
    ...over,
  });

/** Una hora de necesidad en la agenda de la familia (por defecto mañana a esta hora, abierta). */
export const need = (over: Partial<RadarNeed> = {}): RadarNeed => ({
  id: nextId("n"),
  starts_at: iso(DAY),
  ends_at: iso(DAY + HOUR),
  hourly_rate: 20_000,
  status: "open",
  care_type: null,
  notes: null,
  created_at: iso(-2 * HOUR),
  ...over,
});

/** `hours` horas seguidas desde `startOffsetMs` (ms desde ahora): una necesidad por hora, como la agenda real. */
export const needBlock = (
  startOffsetMs: number,
  hours: number,
  over: Partial<RadarNeed> = {},
): RadarNeed[] =>
  Array.from({ length: hours }, (_, i) =>
    need({
      starts_at: iso(startOffsetMs + i * HOUR),
      ends_at: iso(startOffsetMs + (i + 1) * HOUR),
      ...over,
    }),
  );

export const proposal = (over: Partial<RadarProposal> = {}): RadarProposal => ({
  id: nextId("pr"),
  family_need_id: null,
  status: "pending",
  proposed_by: "professional",
  expires_at: iso(12 * HOUR),
  ...over,
});

export const member = (over: Partial<TrustedMember> = {}): TrustedMember => ({
  professional_id: nextId("p"),
  display_name: "Laura Pérez",
  specialty: "Enfermería",
  avatar_url: null,
  avg_rating: 4.8,
  services_together: 3,
  last_service_at: iso(-10 * DAY),
  favorite_since: iso(-60 * DAY),
  available: true,
  ...over,
});

/** Un candidato sólido (verificado, bien calificado, cerca, disponible, tarifa dentro del rango de la ciudad). */
export const applicant = (over: Partial<Applicant> = {}): Applicant => ({
  id: nextId("a"),
  source: "proposal",
  professionalId: nextId("pro"),
  name: "Laura Pérez",
  offeredRate: 24_000,
  postedRate: 24_000,
  hourly: true,
  createdAt: iso(-3 * HOUR),
  avgRating: 4.8,
  totalJobs: 20,
  trustScore: 90,
  rethusVerified: true,
  verified: true,
  yearsExperience: 8,
  available: true,
  km: 3,
  inTeam: false,
  servicesTogether: 0,
  ...over,
});

/** Un candidato sin ningún dato del perfil (solo lo que pide). */
export const bareApplicant = (over: Partial<Applicant> = {}): Applicant =>
  applicant({
    avgRating: null,
    totalJobs: null,
    trustScore: null,
    rethusVerified: null,
    verified: null,
    yearsExperience: null,
    available: null,
    km: null,
    ...over,
  });

export const wBooking = (over: Partial<WellbeingBooking> = {}): WellbeingBooking => ({
  id: nextId("wb"),
  status: "completed",
  scheduled_at: iso(-3 * DAY),
  duration_hours: 6,
  professional_id: "pro-1",
  professional_name: "Laura Pérez",
  ...over,
});

export const careLog = (over: Partial<WellbeingLog> = {}): WellbeingLog => ({
  id: nextId("l"),
  booking_id: "b1",
  event_type: "note",
  description: "Nota del turno",
  mood: null,
  vital_systolic: null,
  vital_diastolic: null,
  vital_heart_rate: null,
  vital_temperature: null,
  vital_oxygen: null,
  is_alert: false,
  alert_reason: null,
  system_generated: false,
  created_at: iso(-3 * DAY + HOUR),
  ...over,
});

export interface ServiceOpts {
  id?: string;
  pro?: string;
  proName?: string | null;
  hours?: number;
  status?: string;
  mood?: CareMood | null;
  meds?: number;
  sys?: number | null;
  dia?: number | null;
  hr?: number | null;
  temp?: number | null;
  spo2?: number | null;
  alert?: string | null;
  incident?: string | null;
  /** Sin ningún registro del profesional (solo llegada y salida automáticas). */
  noReport?: boolean;
}

/** Un servicio de hace `daysAgo` días con su parte (llegada y salida automáticas incluidas). */
export function service(
  daysAgo: number,
  o: ServiceOpts = {},
): { booking: WellbeingBooking; logs: WellbeingLog[] } {
  const id = o.id ?? nextId("svc");
  const start = -daysAgo * DAY;
  const booking = wBooking({
    id,
    status: o.status ?? "completed",
    scheduled_at: iso(start),
    duration_hours: o.hours ?? 6,
    professional_id: o.pro ?? "pro-1",
    professional_name: o.proName === undefined ? "Laura Pérez" : o.proName,
  });
  const at = (h: number) => iso(start + h * HOUR);
  const logs: WellbeingLog[] = [
    careLog({ booking_id: id, event_type: "arrival", system_generated: true, created_at: at(0) }),
  ];
  if (!o.noReport) {
    for (let i = 0; i < (o.meds ?? 0); i++)
      logs.push(
        careLog({
          booking_id: id,
          event_type: "medication",
          description: "Tomó su medicamento",
          created_at: at(1 + i * 0.1),
        }),
      );
    const hasVitals = [o.sys, o.dia, o.hr, o.temp, o.spo2].some(
      (v) => v !== undefined && v !== null,
    );
    if (hasVitals)
      logs.push(
        careLog({
          booking_id: id,
          event_type: "vital_signs",
          description: "Signos vitales",
          vital_systolic: o.sys ?? null,
          vital_diastolic: o.dia ?? null,
          vital_heart_rate: o.hr ?? null,
          vital_temperature: o.temp ?? null,
          vital_oxygen: o.spo2 ?? null,
          created_at: at(2),
        }),
      );
    if (o.alert)
      logs.push(
        careLog({
          booking_id: id,
          event_type: "note",
          is_alert: true,
          alert_reason: o.alert,
          description: "Alerta",
          created_at: at(3),
        }),
      );
    if (o.incident)
      logs.push(
        careLog({
          booking_id: id,
          event_type: "incident",
          description: o.incident,
          created_at: at(3.5),
        }),
      );
    if (o.mood)
      logs.push(
        careLog({
          booking_id: id,
          event_type: "note",
          mood: o.mood,
          description: "Cierre del turno",
          created_at: at(5),
        }),
      );
    if (!o.meds && !hasVitals && !o.alert && !o.incident && !o.mood)
      logs.push(
        careLog({ booking_id: id, event_type: "meal", description: "Almorzó", created_at: at(4) }),
      );
  }
  logs.push(
    careLog({ booking_id: id, event_type: "departure", system_generated: true, created_at: at(6) }),
  );
  return { booking, logs };
}

/** Junta varios servicios en las dos listas que recibe el informe. */
export function bundle(...svcs: ReturnType<typeof service>[]) {
  return { bookings: svcs.map((x) => x.booking), logs: svcs.flatMap((x) => x.logs) };
}

/** Una familia con actividad, perfil completo, equipo y círculo: sin nada pendiente. */
export const snapshot = (over: Partial<FamilySnapshot> = {}): FamilySnapshot => ({
  now: NOW,
  services: [],
  proposals: [],
  applications: [],
  gaps: [],
  unrated: [],
  profile: { complete: true, hasEmergencyContact: true },
  completedServices: 3,
  teamSize: 2,
  circleMembers: 1,
  premium: false,
  ...over,
});

export const briefService = (over: Partial<BriefService> = {}): BriefService => ({
  bookingId: nextId("svc"),
  side: "client",
  status: "in_progress",
  scheduledAt: iso(-2 * HOUR),
  counterpartName: "Laura",
  ownerName: null,
  alerts: 0,
  ...over,
});

export const briefProposal = (over: Partial<BriefProposal> = {}): BriefProposal => ({
  id: nextId("bp"),
  status: "pending",
  proposedBy: "professional",
  expiresAt: iso(20 * HOUR),
  peerName: "Marta",
  ...over,
});

export const briefApplication = (over: Partial<BriefApplication> = {}): BriefApplication => ({
  id: nextId("ba"),
  status: "pending",
  createdAt: iso(-2 * HOUR),
  ...over,
});
