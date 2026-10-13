import { describe, expect, it } from "vitest";
import { describeMemberAction } from "./institutionMembers";
import {
  defaultStaffTab,
  isRecentlyActive,
  lastSeenLabel,
  parseStaffContext,
  resolveStaffTab,
  staffGate,
  summarizeStaffOffers,
  toActivityItem,
  toTeamMember,
  type StaffContext,
  type StaffContextRow,
} from "./staffPanel";

const row: StaffContextRow = {
  member_id: "m-1",
  institution_id: "i-1",
  institution_name: "Clínica Norte",
  institution_city: "Bogotá",
  username: "marta.coord",
  display_name: "Marta Coordinadora",
  job_title: "Coordinadora de turnos",
  modules: ["talento", "ofertas"],
  status: "active",
  plan_active: true,
};

const ctx = (over: Partial<StaffContext> = {}): StaffContext => ({
  ...(parseStaffContext(row) as StaffContext),
  ...over,
});

describe("parseStaffContext", () => {
  it("traduce la fila del RPC y ordena los módulos como el catálogo", () => {
    expect(parseStaffContext(row)).toEqual({
      memberId: "m-1",
      institutionId: "i-1",
      institutionName: "Clínica Norte",
      institutionCity: "Bogotá",
      username: "marta.coord",
      displayName: "Marta Coordinadora",
      jobTitle: "Coordinadora de turnos",
      modules: ["ofertas", "talento"],
      status: "active",
      planActive: true,
    });
  });

  it("acepta una lista de filas y devuelve la primera", () => {
    expect(parseStaffContext([row, { ...row, member_id: "m-2" }])?.memberId).toBe("m-1");
  });

  it("devuelve null si no es del equipo o la respuesta no es válida", () => {
    expect(parseStaffContext([])).toBeNull();
    expect(parseStaffContext(null)).toBeNull();
    expect(parseStaffContext(undefined)).toBeNull();
    expect(parseStaffContext("x")).toBeNull();
    expect(parseStaffContext({ ...row, member_id: undefined })).toBeNull();
    expect(parseStaffContext({ ...row, status: 3 })).toBeNull();
  });

  it("rellena lo que falta con textos neutros y nunca da por vigente un plan dudoso", () => {
    const c = parseStaffContext({
      ...row,
      institution_name: "  ",
      institution_city: null,
      job_title: "  ",
      modules: null,
      plan_active: null,
    });
    expect(c).toMatchObject({
      institutionName: "Tu institución",
      institutionCity: null,
      jobTitle: null,
      modules: [],
      planActive: false,
    });
  });

  it("descarta módulos desconocidos y estados raros se tratan como activos solo si dicen «active»", () => {
    expect(parseStaffContext({ ...row, modules: ["pagos", "ofertas"] })?.modules).toEqual([
      "ofertas",
    ]);
    expect(parseStaffContext({ ...row, status: "suspended" })?.status).toBe("suspended");
    expect(parseStaffContext({ ...row, status: "active" })?.status).toBe("active");
  });
});

describe("staffGate", () => {
  it("lista los módulos cuando todo está en orden", () => {
    expect(staffGate(ctx())).toEqual({ state: "ready", tabs: ["ofertas", "talento"] });
    expect(staffGate(ctx({ modules: ["talento"] }))).toEqual({ state: "ready", tabs: ["talento"] });
  });

  it("suspendida: lo dice con el nombre de la institución", () => {
    const g = staffGate(ctx({ status: "suspended" }));
    expect(g.state).toBe("suspended");
    if (g.state !== "ready") expect(g.message).toMatch(/suspendido.*Clínica Norte/);
  });

  it("plan en pausa: explica que es de la institución", () => {
    const g = staffGate(ctx({ planActive: false }));
    expect(g.state).toBe("paused");
    if (g.state !== "ready") expect(g.message).toMatch(/IPS Mejorado/);
  });

  it("sin módulos: pide acceso a quien administra", () => {
    const g = staffGate(ctx({ modules: [] }));
    expect(g.state).toBe("empty");
  });

  it("la suspensión gana sobre el plan y los módulos", () => {
    expect(staffGate(ctx({ status: "suspended", planActive: false, modules: [] })).state).toBe(
      "suspended",
    );
    expect(staffGate(ctx({ planActive: false, modules: [] })).state).toBe("paused");
  });

  it("sin contexto (ya no es del equipo)", () => {
    expect(staffGate(null).state).toBe("suspended");
  });
});

describe("pestañas", () => {
  it("la inicial es la primera del catálogo que tiene", () => {
    expect(defaultStaffTab(["talento", "ofertas"])).toBe("ofertas");
    expect(defaultStaffTab(["talento"])).toBe("talento");
    expect(defaultStaffTab([])).toBeNull();
  });

  it("respeta la pedida solo si la tiene", () => {
    expect(resolveStaffTab("talento", ["ofertas", "talento"])).toBe("talento");
    expect(resolveStaffTab("talento", ["ofertas"])).toBe("ofertas");
    expect(resolveStaffTab("pagos", ["ofertas"])).toBe("ofertas");
    expect(resolveStaffTab(null, ["talento"])).toBe("talento");
    expect(resolveStaffTab("ofertas", [])).toBeNull();
  });
});

describe("lista de personal", () => {
  const NOW = Date.parse("2026-10-13T15:00:00Z");

  it("traduce la fila y ordena los módulos", () => {
    const m = toTeamMember({
      id: "r1",
      member_user_id: "u1",
      username: "jorge",
      display_name: "Jorge Talento",
      job_title: " ",
      modules: ["talento", "ofertas", "x"],
      status: "suspended",
      last_seen_at: null,
      created_at: "2026-10-10T10:00:00Z",
    });
    expect(m).toEqual({
      id: "r1",
      username: "jorge",
      displayName: "Jorge Talento",
      jobTitle: null,
      modules: ["ofertas", "talento"],
      status: "suspended",
      lastSeenAt: null,
      createdAt: "2026-10-10T10:00:00Z",
    });
  });

  it("último acceso en palabras", () => {
    expect(lastSeenLabel(null, NOW)).toBe("Aún no ha entrado");
    expect(lastSeenLabel("basura", NOW)).toBe("Aún no ha entrado");
    expect(lastSeenLabel("2026-10-13T14:59:40Z", NOW)).toBe("Hace un momento");
    expect(lastSeenLabel("2026-10-13T14:55:00Z", NOW)).toBe("Hace 5 min");
    expect(lastSeenLabel("2026-10-13T12:00:00Z", NOW)).toBe("Hace 3 h");
    expect(lastSeenLabel("2026-10-11T15:00:00Z", NOW)).toBe("Hace 2 d");
    expect(lastSeenLabel("2026-09-01T15:00:00Z", NOW)).toMatch(/2026/);
  });

  it("activa ahora = entró hace ≤ 15 min", () => {
    expect(isRecentlyActive("2026-10-13T14:50:00Z", NOW)).toBe(true);
    expect(isRecentlyActive("2026-10-13T14:44:00Z", NOW)).toBe(false);
    expect(isRecentlyActive(null, NOW)).toBe(false);
    expect(isRecentlyActive("2026-10-13T16:30:00Z", NOW)).toBe(false); // del futuro: no se cree
  });

  it("actividad: quién y qué", () => {
    expect(
      toActivityItem(
        {
          id: 7,
          member_user_id: "u1",
          member_name: "Marta Coordinadora",
          action: "application_accepted",
          target_table: "applications",
          created_at: "2026-10-13T14:00:00Z",
        },
        describeMemberAction,
      ),
    ).toEqual({
      id: 7,
      who: "Marta Coordinadora",
      action: "Aceptó una postulación",
      at: "2026-10-13T14:00:00Z",
    });
    expect(
      toActivityItem(
        {
          id: 8,
          member_user_id: "u1",
          member_name: null,
          action: "otra",
          target_table: "x",
          created_at: "2026-10-13T14:00:00Z",
        },
        describeMemberAction,
      ),
    ).toMatchObject({ who: "Alguien del equipo", action: "Realizó una acción" });
  });
});

describe("summarizeStaffOffers", () => {
  const NOW = Date.parse("2026-10-13T15:00:00Z");
  const offer = (over: Record<string, unknown>) => ({
    id: "o",
    title: "Oferta",
    city: "Bogotá",
    modality: "shift",
    amount: 180000,
    status: "open",
    is_urgent: false,
    specialty_required: null,
    service_area: null,
    job_offer_shifts: [],
    ...over,
  });
  const shift = (
    id: string,
    startsAt: string,
    positions: number,
    filled: number,
    status = "open",
  ) => ({
    id,
    starts_at: startsAt,
    ends_at: startsAt,
    positions,
    filled,
    status,
  });

  it("cuenta cupos y cubiertos sin contar turnos cancelados ni pasarse del cupo", () => {
    const [o] = summarizeStaffOffers(
      [
        offer({
          job_offer_shifts: [
            shift("a", "2026-10-14T10:00:00Z", 2, 1),
            shift("b", "2026-10-15T10:00:00Z", 1, 5), // más cubiertos que cupos: se acota
            shift("c", "2026-10-16T10:00:00Z", 3, 0, "cancelled"),
          ],
        }) as never,
      ],
      NOW,
    );
    expect(o).toMatchObject({
      positions: 3,
      filled: 2,
      status: "open",
      nextShiftAt: "2026-10-14T10:00:00.000Z",
    });
  });

  it("el próximo turno ignora los que ya empezaron", () => {
    const [o] = summarizeStaffOffers(
      [
        offer({
          job_offer_shifts: [
            shift("a", "2026-10-13T10:00:00Z", 1, 0),
            shift("b", "2026-10-20T10:00:00Z", 1, 0),
          ],
        }) as never,
      ],
      NOW,
    );
    expect(o.nextShiftAt).toBe("2026-10-20T10:00:00.000Z");
    const [sin] = summarizeStaffOffers(
      [offer({ job_offer_shifts: [shift("a", "2026-10-13T10:00:00Z", 1, 0)] }) as never],
      NOW,
    );
    expect(sin.nextShiftAt).toBeNull();
  });

  it("cubierta cuando la oferta está llena o todos los cupos están ocupados", () => {
    const list = summarizeStaffOffers(
      [
        offer({ id: "lleno", status: "filled" }) as never,
        offer({
          id: "cupos",
          job_offer_shifts: [shift("a", "2026-10-14T10:00:00Z", 2, 2)],
        }) as never,
        offer({
          id: "abierta",
          job_offer_shifts: [shift("a", "2026-10-14T10:00:00Z", 2, 1)],
        }) as never,
      ],
      NOW,
    );
    expect(list.map((o) => [o.id, o.status])).toEqual([
      ["abierta", "open"],
      ["cupos", "filled"],
      ["lleno", "filled"],
    ]);
  });

  it("orden: abiertas primero, urgentes antes, luego la más próxima", () => {
    const list = summarizeStaffOffers(
      [
        offer({
          id: "tarde",
          job_offer_shifts: [shift("a", "2026-10-20T10:00:00Z", 1, 0)],
        }) as never,
        offer({
          id: "pronto",
          job_offer_shifts: [shift("a", "2026-10-14T10:00:00Z", 1, 0)],
        }) as never,
        offer({
          id: "urgente",
          is_urgent: true,
          job_offer_shifts: [shift("a", "2026-10-25T10:00:00Z", 1, 0)],
        }) as never,
      ],
      NOW,
    );
    expect(list.map((o) => o.id)).toEqual(["urgente", "pronto", "tarde"]);
  });

  it("sin turnos no rompe (oferta abierta sin agenda)", () => {
    const [o] = summarizeStaffOffers([offer({ job_offer_shifts: null }) as never], NOW);
    expect(o).toMatchObject({ positions: 0, filled: 0, status: "open", nextShiftAt: null });
  });
});
