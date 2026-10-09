import { describe, it, expect } from "vitest";
import { FEATURE_MIN_PLAN, PLAN_CATALOG, canUseFeature } from "./plans";
import {
  circleInviteText,
  freeTeamNotice,
  inviteText,
  memberLine,
  needsAttention,
  nextStepLabel,
  notificationTone,
  parseActiveServices,
  parseTeam,
  planBPromise,
  relativeDaysEs,
  sortActive,
  sortTeam,
  teamHeadline,
  type ActiveService,
  type TrustedMember,
} from "./careLoop";

const NOW = new Date("2026-10-09T15:00:00Z");
const m = (o: Partial<TrustedMember> = {}): TrustedMember => ({
  professional_id: "p1",
  display_name: "Laura P.",
  specialty: "Auxiliar de enfermería",
  avatar_url: null,
  avg_rating: 4.8,
  services_together: 3,
  last_service_at: "2026-09-25T15:00:00Z",
  favorite_since: "2026-06-01T00:00:00Z",
  available: true,
  ...o,
});

describe("normalización del equipo", () => {
  it("convierte las filas del servidor y descarta las inválidas", () => {
    const rows = parseTeam([
      {
        professional_id: "p1",
        display_name: "Laura P.",
        specialty: "Enfermería",
        avatar_url: null,
        avg_rating: "4.80",
        services_together: "3",
        last_service_at: null,
        favorite_since: "2026-06-01T00:00:00Z",
        available: true,
      },
      { professional_id: null },
      null,
      {
        professional_id: "p2",
        display_name: "",
        specialty: "",
        avg_rating: null,
        services_together: null,
        available: "yes",
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ avg_rating: 4.8, services_together: 3, available: true });
    expect(rows[1]).toMatchObject({
      display_name: "Profesional",
      specialty: null,
      avg_rating: null,
      services_together: 0,
      available: false,
    });
    expect(parseTeam(undefined)).toEqual([]);
  });
});

describe("orden del equipo", () => {
  it("más servicios juntos, luego disponible, luego más reciente", () => {
    const sorted = sortTeam([
      m({ professional_id: "a", services_together: 1, available: false }),
      m({ professional_id: "b", services_together: 5 }),
      m({ professional_id: "c", services_together: 1, available: true }),
      m({
        professional_id: "d",
        services_together: 1,
        available: true,
        favorite_since: "2026-09-01T00:00:00Z",
      }),
    ]);
    expect(sorted.map((x) => x.professional_id)).toEqual(["b", "d", "c", "a"]);
  });
  it("no modifica el arreglo original", () => {
    const original = [
      m({ professional_id: "a", services_together: 1 }),
      m({ professional_id: "b", services_together: 2 }),
    ];
    sortTeam(original);
    expect(original.map((x) => x.professional_id)).toEqual(["a", "b"]);
  });
});

describe("tiempo relativo", () => {
  it("escalas", () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    expect(relativeDaysEs(at(0), NOW)).toBe("hoy");
    expect(relativeDaysEs(at(1), NOW)).toBe("ayer");
    expect(relativeDaysEs(at(5), NOW)).toBe("hace 5 días");
    expect(relativeDaysEs(at(14), NOW)).toBe("hace 2 semanas");
    expect(relativeDaysEs(at(45), NOW)).toBe("hace 6 semanas");
    expect(relativeDaysEs(at(90), NOW)).toBe("hace 3 meses");
    expect(relativeDaysEs(at(400), NOW)).toBe("hace más de un año");
    expect(relativeDaysEs(at(-2), NOW)).toBe("próximamente");
  });
  it("entradas inválidas", () => {
    expect(relativeDaysEs(null, NOW)).toBeNull();
    expect(relativeDaysEs("no-fecha", NOW)).toBeNull();
  });
});

describe("textos", () => {
  it("línea del miembro", () => {
    expect(memberLine(m(), NOW)).toBe(
      "Auxiliar de enfermería · 3 servicios juntos · el último hace 2 semanas",
    );
    expect(
      memberLine(m({ services_together: 1, last_service_at: "2026-10-09T10:00:00Z" }), NOW),
    ).toBe("Auxiliar de enfermería · 1 servicio juntos · el último hoy");
    expect(memberLine(m({ services_together: 0, specialty: null }), NOW)).toBe(
      "aún no han trabajado juntos",
    );
  });
  it("titular del equipo", () => {
    expect(teamHeadline([])).toBe("Aún no tienes equipo de confianza");
    expect(teamHeadline([m()])).toBe("1 profesional de confianza · 1 disponible ahora");
    expect(teamHeadline([m(), m({ available: false })])).toBe(
      "2 profesionales de confianza · 1 disponible ahora",
    );
    expect(teamHeadline([m({ available: false })])).toBe(
      "1 profesional de confianza · 0 disponibles ahora",
    );
  });
  it("promesa del plan B por rol", () => {
    expect(planBPromise("family", 0)).toContain("Guarda como favoritos");
    expect(planBPromise("institution", 0)).toContain("los avisamos primero");
    expect(planBPromise("family", 3)).toContain("(3)");
    expect(planBPromise("institution", 4)).toContain("avisamos de inmediato a tu equipo (4)");
  });
  it("aviso de cancelación: misma frase que el servidor", () => {
    expect(freeTeamNotice(1)).toBe(
      "1 profesional de tu equipo de confianza está libre en ese horario. Pídeles que te cubran desde el detalle del servicio.",
    );
    expect(freeTeamNotice(3)).toBe(
      "3 profesionales de tu equipo de confianza están libres en ese horario. Pídeles que te cubran desde el detalle del servicio.",
    );
    expect(freeTeamNotice(0)).toBe(
      "Puedes buscar un reemplazo disponible para el mismo horario desde el detalle del servicio.",
    );
  });
});

describe("invitación para compartir", () => {
  it("lleva el enlace y no habla de pagos", () => {
    for (const role of ["family", "professional"] as const) {
      const t = inviteText(role, "https://humanix.lat/auth?ref=ABC123");
      expect(t).toContain("https://humanix.lat/auth?ref=ABC123");
      expect(t).not.toMatch(/pag[ao]|transfer|nequi|whatsapp business/i);
    }
    expect(inviteText("family", "x")).toContain("parte del turno en vivo");
    expect(inviteText("professional", "x")).toContain("turnos de salud");
  });
});

describe("invitación al círculo de cuidado", () => {
  it("indica el correo con el que debe entrar y no habla de pagos", () => {
    const t = circleInviteText("hermano@correo.com");
    expect(t).toContain("hermano@correo.com");
    expect(t).toContain("https://humanix.lat/auth");
    expect(t).not.toMatch(/pag[ao]|transfer|nequi/i);
  });
});

describe("funciones premium del lazo de cuidado", () => {
  it("historia exportable: desde el plan Esencial (también IPS), no en Free", () => {
    expect(FEATURE_MIN_PLAN.care_history_export).toBe("essential_monthly");
    expect(canUseFeature("free", "care_history_export")).toBe(false);
    expect(canUseFeature(null, "care_history_export")).toBe(false);
    expect(canUseFeature("essential_monthly", "care_history_export")).toBe(true);
    expect(canUseFeature("pro_monthly", "care_history_export")).toBe(true);
    expect(canUseFeature("institution_monthly", "care_history_export")).toBe(true);
  });
  it("pasaporte profesional: desde Pro", () => {
    expect(FEATURE_MIN_PLAN.career_passport).toBe("pro_monthly");
    expect(canUseFeature("essential_monthly", "career_passport")).toBe(false);
    expect(canUseFeature("pro_monthly", "career_passport")).toBe(true);
    expect(canUseFeature("institution_monthly", "career_passport")).toBe(true);
  });
  it("el catálogo lista cada función en el plan que la desbloquea, con su texto", () => {
    expect(PLAN_CATALOG.essential_monthly.features).toContain("care_history_export");
    expect(PLAN_CATALOG.pro_monthly.features).toContain("career_passport");
    expect(PLAN_CATALOG.essential_monthly.featuresLabel.join(" ")).toMatch(/Historia de cuidado/);
    expect(PLAN_CATALOG.pro_monthly.featuresLabel.join(" ")).toMatch(/Pasaporte profesional/);
  });
  it("el precio no cambió (la fuente de verdad es el servidor de pagos)", () => {
    expect(PLAN_CATALOG.essential_monthly.amountCOP).toBe(9000);
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(29000);
    expect(PLAN_CATALOG.institution_monthly.amountCOP).toBe(299_000);
  });
});

describe("servicios en curso", () => {
  const svc = (o: Partial<ActiveService> = {}): ActiveService => ({
    booking_id: "b1",
    side: "client",
    status: "in_progress",
    scheduled_at: "2026-10-09T13:00:00Z",
    duration_hours: 4,
    counterpart_id: "p1",
    counterpart_name: "Laura P.",
    owner_name: null,
    started_at: "2026-10-09T13:05:00Z",
    events: 3,
    alerts: 0,
    last_mood: null,
    last_vitals: null,
    ...o,
  });
  it("normaliza las filas del servidor y descarta las inválidas", () => {
    const rows = parseActiveServices([
      {
        booking_id: "b1",
        side: "circle",
        status: "in_progress",
        scheduled_at: "2026-10-09T13:00:00Z",
        duration_hours: "4.00",
        counterpart_id: "p1",
        counterpart_name: "Laura P.",
        owner_name: "Marta D.",
        started_at: null,
        events: "3",
        alerts: 1,
        last_mood: "happy",
        last_vitals: { at: "t", oxygen: 89, heart_rate: null },
      },
      { booking_id: "b2", side: "otro" },
      { side: "client" },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      side: "circle",
      owner_name: "Marta D.",
      events: 3,
      alerts: 1,
      duration_hours: 4,
    });
    expect(rows[0].last_vitals).toMatchObject({ oxygen: 89, heartRate: null });
    expect(parseActiveServices(undefined)).toEqual([]);
  });
  it("nombre por defecto cuando no hay", () => {
    const rows = parseActiveServices([
      { booking_id: "b1", side: "client", status: "confirmed", counterpart_name: "" },
    ]);
    expect(rows[0].counterpart_name).toBe("Alguien de Humanix");
  });
  it("texto del siguiente paso según rol y estado", () => {
    expect(nextStepLabel("professional", "confirmed")).toBe("Abrir y salir en camino");
    expect(nextStepLabel("professional", "in_route")).toBe("Abrir y marcar llegada");
    expect(nextStepLabel("professional", "in_progress")).toBe("Registrar en el parte");
    expect(nextStepLabel("client", "in_progress")).toBe("Ver el parte en vivo");
    expect(nextStepLabel("circle", "in_progress")).toBe("Ver el parte en vivo");
    expect(nextStepLabel("client", "confirmed")).toBe("Ver servicio");
  });
  it("atención: solo turnos en curso con alertas", () => {
    expect(needsAttention(svc({ alerts: 2 }))).toBe(true);
    expect(needsAttention(svc({ alerts: 0 }))).toBe(false);
    expect(needsAttention(svc({ status: "confirmed", alerts: 2 }))).toBe(false);
  });
  it("orden: alertas, en curso, en camino, por hora", () => {
    const sorted = sortActive([
      svc({ booking_id: "c", status: "confirmed", scheduled_at: "2026-10-09T10:00:00Z" }),
      svc({ booking_id: "b", status: "in_route" }),
      svc({ booking_id: "a", status: "in_progress", alerts: 0 }),
      svc({
        booking_id: "z",
        status: "in_progress",
        alerts: 1,
        scheduled_at: "2026-10-09T18:00:00Z",
      }),
    ]);
    expect(sorted.map((x) => x.booking_id)).toEqual(["z", "a", "b", "c"]);
  });
});

describe("tono de los avisos", () => {
  it("las alertas destacan, los gracias son cálidos y lo demás no cambia", () => {
    expect(notificationTone("care_alert")).toBe("alert");
    expect(notificationTone("kudos_received")).toBe("warm");
    expect(notificationTone("career_milestone")).toBe("warm");
    expect(notificationTone("care_finished")).toBe("warm");
    expect(notificationTone("care_started")).toBe("info");
    expect(notificationTone("plan_b_started")).toBe("info");
    expect(notificationTone("team_invite_urgent")).toBe("info");
    expect(notificationTone("booking_cancelled")).toBeNull();
    expect(notificationTone(null)).toBeNull();
  });
});
