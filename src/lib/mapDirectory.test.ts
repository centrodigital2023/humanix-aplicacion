import { describe, expect, it } from "vitest";
import type { MapProfessional } from "./liveMap";
import {
  directoryIdsKey,
  currentMapSelection,
  lastSeenText,
  presenceLine,
  proSubtitle,
  validatedMapProfessionals,
  type DirectoryRow,
} from "./mapDirectory";

const NOW = Date.parse("2026-10-19T22:00:00Z");

describe("currentMapSelection — cambios en tiempo real", () => {
  it("usa la nueva ubicación y disponibilidad del profesional seleccionado", () => {
    const old = { id: "p1", lat: 4.61, status: "available" };
    const moved = { id: "p1", lat: 4.62, status: "busy" };
    expect(currentMapSelection([old], "p1")).toBe(old);
    expect(currentMapSelection([moved], "p1")).toEqual({ id: "p1", lat: 4.62, status: "busy" });
  });
  it("retira la selección cuando el perfil deja de ser visible", () => {
    expect(currentMapSelection([{ id: "p2" }], "p1")).toBeNull();
  });
});

const pin = (over: Partial<MapProfessional> = {}): MapProfessional => ({
  id: "p1",
  name: "Laura P.",
  avatarUrl: null,
  specialty: "Enfermería",
  subSpecialties: [],
  gender: null,
  yearsExperience: 5,
  hourlyRate: 25000,
  rating: 4.8,
  trust: { score: null, level: null, enough: false } as unknown as MapProfessional["trust"],
  rethus: true,
  verified: true,
  city: null,
  lat: 1.2,
  lng: -77.3,
  status: "available",
  live: false,
  lastSeen: null,
  ...over,
});
const dir = (over: Partial<DirectoryRow> = {}): DirectoryRow => ({
  user_id: "p1",
  full_name: "Laura Pérez",
  home_city: "Pasto",
  service_cities: [],
  total_jobs: 12,
  ...over,
});

describe("validatedMapProfessionals — el mapa usa los datos validados del buscador", () => {
  it("toma el nombre y la ciudad autorizados del directorio", () => {
    const [p] = validatedMapProfessionals([pin()], [dir()]);
    expect(p).toMatchObject({ id: "p1", name: "Laura Pérez", city: "Pasto", turns: 12 });
    expect(p.status).toBe("available");
  });

  it("oculta a quien no tiene fila en el directorio o la tiene incompleta", () => {
    const map = [pin({ id: "a" }), pin({ id: "b" }), pin({ id: "c" }), pin({ id: "d" }), pin({ id: "e" })];
    const out = validatedMapProfessionals(map, [
      dir({ user_id: "b", full_name: "Profesional Humanix" }),
      dir({ user_id: "c", home_city: null, service_cities: [] }),
      dir({ user_id: "d", total_jobs: null }),
      dir({ user_id: "e", home_city: " ", service_cities: ["Cali"] }),
    ]);
    expect(out.map((p) => [p.id, p.city])).toEqual([["e", "Cali"]]);
  });

  it("respeta el orden del mapa (en vivo y disponibles primero)", () => {
    const out = validatedMapProfessionals(
      [pin({ id: "x" }), pin({ id: "y" })],
      [dir({ user_id: "y" }), dir({ user_id: "x" })],
    );
    expect(out.map((p) => p.id)).toEqual(["x", "y"]);
  });
});

describe("directoryIdsKey", () => {
  it("es la misma para los mismos ids en otro orden o repetidos", () => {
    expect(directoryIdsKey([{ id: "b" }, { id: "a" }, { id: "b" }])).toBe("a,b");
    expect(directoryIdsKey([])).toBe("");
  });
});

describe("proSubtitle", () => {
  it("especialidad, ciudad y turnos", () => {
    expect(proSubtitle({ specialty: "Enfermería", city: "Pasto", turns: 12 })).toBe(
      "Enfermería · Pasto · 12 turnos",
    );
    expect(proSubtitle({ specialty: null, city: "Cali", turns: 1 })).toBe(
      "Cuidado en casa · Cali · 1 turno",
    );
    expect(proSubtitle({ specialty: " ", city: "Cali", turns: 0 })).toBe(
      "Cuidado en casa · Cali · Nuevo en Humanix",
    );
  });
});

describe("lastSeenText", () => {
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  it("redacta en minutos, horas, días o meses", () => {
    expect(lastSeenText(ago(5 * 60_000), NOW)).toBe("hace unos minutos");
    expect(lastSeenText(ago(60 * 60_000), NOW)).toBe("hace 1 hora");
    expect(lastSeenText(ago(5 * 3_600_000), NOW)).toBe("hace 5 horas");
    expect(lastSeenText(ago(24 * 3_600_000), NOW)).toBe("hace 1 día");
    expect(lastSeenText(ago(3 * 86_400_000), NOW)).toBe("hace 3 días");
    expect(lastSeenText(ago(40 * 86_400_000), NOW)).toBe("hace más de un mes");
  });
  it("sin dato, fecha inválida o en el futuro", () => {
    expect(lastSeenText(null, NOW)).toBeNull();
    expect(lastSeenText("no-fecha", NOW)).toBeNull();
    expect(lastSeenText(new Date(NOW + 60_000).toISOString(), NOW)).toBe("hace unos minutos");
  });
});

describe("presenceLine — disponible aunque el aparato esté apagado", () => {
  it("en vivo con la aplicación abierta", () => {
    expect(presenceLine({ status: "available", live: true, lastSeen: null }, NOW)).toBe(
      "En vivo ahora",
    );
  });
  it("disponible sin la aplicación abierta sigue recibiendo solicitudes", () => {
    const lastSeen = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(presenceLine({ status: "available", live: false, lastSeen }, NOW)).toBe(
      "Disponible · se conectó hace 3 horas",
    );
    expect(presenceLine({ status: "available", live: false, lastSeen: null }, NOW)).toBe(
      "Disponible · recibe tu solicitud en la app",
    );
  });
  it("ocupado o no disponible: el estado ya lo dice", () => {
    expect(presenceLine({ status: "busy", live: true, lastSeen: null }, NOW)).toBeNull();
    expect(presenceLine({ status: "unavailable", live: false, lastSeen: null }, NOW)).toBeNull();
  });
});
