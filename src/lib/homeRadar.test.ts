import { describe, expect, it } from "vitest";
import type { PublicProfessional } from "./publicProfessionals";
import { dashboardPathForRoles, pickRadarPro, radarPrice, shortProName } from "./homeRadar";

const row = (patch: Partial<PublicProfessional>): PublicProfessional =>
  ({
    user_id: "u1",
    full_name: "Nixon Estiven Paz Jojoa",
    avatar_url: null,
    specialty: "Auxiliar de enfermería",
    home_city: "Buesaco",
    service_cities: null,
    hourly_rate: 10000,
    shift_rate: null,
    avg_rating: 4.8,
    total_jobs: 3,
    verified: true,
    rethus_verified: true,
    available: true,
    availability_status: "available",
    live: false,
    ...patch,
  }) as PublicProfessional;

describe("nombre corto de la tarjeta en vivo", () => {
  it("nombre e inicial del último apellido", () => {
    expect(shortProName("Nixon Estiven Paz Jojoa")).toBe("Nixon J.");
    expect(shortProName("Laura P.")).toBe("Laura P.");
    expect(shortProName("  Ana  ")).toBe("Ana");
    expect(shortProName("")).toBe("");
  });
});

describe("profesional de la tarjeta en vivo", () => {
  it("arma la tarjeta con los datos del directorio", () => {
    expect(pickRadarPro([row({})])).toEqual({
      id: "u1",
      name: "Nixon J.",
      specialty: "Auxiliar de enfermería",
      city: "Buesaco",
      available: true,
      live: false,
      hourlyRate: 10000,
      shiftRate: null,
      avatarUrl: null,
    });
  });

  it("solo verificados, y primero los disponibles", () => {
    const pick = pickRadarPro([
      row({ user_id: "a", verified: false, rethus_verified: false, avg_rating: 5 }),
      row({ user_id: "b", availability_status: "busy" }),
      row({ user_id: "c" }),
    ]);
    expect(pick?.id).toBe("c");
  });

  it("descarta filas sin nombre, ciudad o turnos válidos", () => {
    expect(pickRadarPro([row({ full_name: "Profesional" })])).toBeNull();
    expect(pickRadarPro([row({ verified: false, rethus_verified: false })])).toBeNull();
    expect(pickRadarPro([row({ home_city: null })])).toBeNull();
    expect(pickRadarPro([row({ total_jobs: null })])).toBeNull();
    expect(pickRadarPro([])).toBeNull();
  });
});

describe("precio de la tarjeta", () => {
  it("hora, turno o nada", () => {
    expect(radarPrice({ hourlyRate: 10000, shiftRate: null })).toMatch(/10\.000 \/ hora$/);
    expect(radarPrice({ hourlyRate: null, shiftRate: 140000 })).toMatch(/140\.000 \/ turno$/);
    expect(radarPrice({ hourlyRate: null, shiftRate: null })).toBeNull();
  });
});

describe("panel tras iniciar sesión o registrarse", () => {
  it("los roles de la base mandan", () => {
    expect(dashboardPathForRoles(["superadmin", "family"])).toBe("/superadmin");
    expect(dashboardPathForRoles(["institution"], "family")).toBe("/dashboard/institucion");
    expect(dashboardPathForRoles(["family"], "professional")).toBe("/dashboard/familia");
    expect(dashboardPathForRoles(["professional"])).toBe("/dashboard/profesional");
  });

  it("registro recién hecho, sin roles todavía: vale el rol elegido", () => {
    expect(dashboardPathForRoles([], "family")).toBe("/dashboard/familia");
    expect(dashboardPathForRoles([], "institution")).toBe("/dashboard/institucion");
    expect(dashboardPathForRoles([], "professional")).toBe("/dashboard/profesional");
  });

  it("sin rol conocido decide /dashboard", () => {
    expect(dashboardPathForRoles([])).toBe("/dashboard");
    expect(dashboardPathForRoles(["institution_staff"], "family")).toBe("/dashboard");
  });
});
