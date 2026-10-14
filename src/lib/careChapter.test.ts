import { describe, expect, it } from "vitest";
import { CARE_ROUTES } from "./careJourney";
import {
  CHAPTER_SIGNATURE,
  CLOSABLE_ROUTES,
  WELCOME_LINES,
  buildChapterNote,
  chapterState,
  chapterSummary,
} from "./careChapter";
import { DAY, NOW, iso } from "./intel.fixture";

const done = (daysAgo: number, over: object = {}) => ({
  status: "completed",
  scheduled_at: iso(-daysAgo * DAY),
  duration_hours: 6,
  ...over,
});
const upcoming = (daysAhead: number, status = "confirmed") => ({
  status,
  scheduled_at: iso(daysAhead * DAY),
});
const run = (route: Parameters<typeof chapterState>[0]["route"], b: object[]) =>
  chapterState({ route, bookings: b as never, now: NOW });

describe("inicio y cierre: en qué punto va la familia", () => {
  it("sin servicios ni citas: nada que mostrar", () => {
    expect(run("postop", []).phase).toBe("none");
  });

  it("con un servicio próximo y ninguno hecho: bienvenida antes del primer día", () => {
    expect(run("postop", [upcoming(2)]).phase).toBe("start");
    expect(run("postop", [upcoming(2, "cancelled")]).phase).toBe("none");
  });

  it("los primeros 3 días del episodio: bienvenida; después, en marcha", () => {
    expect(run("postop", [done(0)]).phase).toBe("start");
    expect(run("postop", [done(2)]).phase).toBe("start"); // día 3
    expect(run("postop", [done(3)]).phase).toBe("ongoing"); // día 4
  });

  it("un episodio largo y activo está en marcha", () => {
    expect(run("child", [done(0), done(5), done(12), done(20)]).phase).toBe("ongoing");
  });

  it("el hueco de 14 días todavía no cierra el episodio", () => {
    const b = [done(14), done(20), done(25)];
    expect(run("postop", b).phase).toBe("ongoing");
    expect(run("postop", b).daysSince).toBe(14);
  });
});

describe("inicio y cierre: cuándo se ofrece el cierre", () => {
  const ended = [done(16), done(18), done(21), done(24)];

  it("15 días después del último servicio, en una ruta que lo admite", () => {
    expect(run("postop", [done(15), done(17), done(20)]).phase).toBe("closing");
    expect(run("child", ended).phase).toBe("closing");
  });

  it("jamás en adulto mayor, enfermedad ni crónicos (un hueco puede significar cualquier cosa)", () => {
    for (const r of ["elder", "illness", "chronic"] as const) {
      expect(run(r, ended).phase).toBe("none");
    }
    expect([...CLOSABLE_ROUTES].sort()).toEqual(["child", "postop"]);
  });

  it("sin ruta elegida tampoco hay cierre", () => {
    expect(run(null, ended).phase).toBe("none");
  });

  it("un episodio de menos de 3 días con cuidado no merece cierre", () => {
    expect(run("postop", [done(20), done(21)]).phase).toBe("none");
    expect(run("postop", [done(20), done(21), done(22)]).phase).toBe("closing");
  });

  it("si hay un servicio próximo, no se cierra", () => {
    expect(run("postop", [...ended, upcoming(3)]).phase).toBe("none");
  });

  it("el cierre solo se ofrece durante 30 días después del hueco", () => {
    const old = (n: number) => [done(n), done(n + 1), done(n + 2)];
    expect(run("postop", old(44)).phase).toBe("closing"); // 14 + 30
    expect(run("postop", old(45)).phase).toBe("none");
  });

  it("un hueco de 14 días une los servicios en un episodio; de 15, los separa", () => {
    expect(run("postop", [done(20), done(34)]).careDays).toBe(2);
    expect(run("postop", [done(20), done(35)]).careDays).toBe(1);
  });

  it("un servicio nuevo después del hueco abre otro episodio", () => {
    expect(run("postop", [...ended, done(0)]).phase).toBe("start");
  });

  it("cancelados, futuros y pendientes no cuentan como cuidado", () => {
    const b = [
      done(16, { status: "cancelled" }),
      done(17, { status: "pending" }),
      done(18, { status: "completed" }),
    ];
    expect(run("postop", b).careDays).toBe(1);
  });
});

describe("inicio y cierre: bienvenida", () => {
  it.each(CARE_ROUTES)("la ruta %s tiene su bienvenida, sin consejo clínico ni dinero", (r) => {
    const t = WELCOME_LINES[r];
    expect(t.length).toBeGreaterThan(20);
    expect(t).not.toMatch(/\b(mg|ml|dosis|tome|dale|administra)\b/i);
    expect(t).not.toMatch(/\$|\bCOP\b|pago|precio|whatsapp|@/i);
  });
});

describe("inicio y cierre: resumen y nota", () => {
  const bookings = [
    done(16, { professional_name: "Ana María Ruiz" }),
    done(17, { professional_name: "Ana María Ruiz", duration_hours: "4" }),
    done(20, { professional_name: "Luis Prado" }),
    done(21, { professional_name: "Marta Soto" }),
    done(22, { professional_name: "Pedro Gil" }),
    done(60), // episodio anterior, no entra
  ];
  const s = chapterSummary({ bookings: bookings as never, now: NOW })!;

  it("resume solo el último episodio: días, servicios, horas y fechas", () => {
    expect(s.careDays).toBe(5);
    expect(s.services).toBe(5);
    expect(s.hours).toBe(6 + 4 + 6 + 6 + 6);
    expect(s.from).toBe("22 sep 2026");
    expect(s.to).toBe("28 sep 2026");
  });

  it("el equipo son nombres de pila, sin repetir, hasta tres", () => {
    expect(s.team).toEqual(["Ana", "Luis", "Marta"]);
  });

  it("sin servicios no hay resumen", () => {
    expect(chapterSummary({ bookings: [], now: NOW })).toBeNull();
  });

  it("una duración rara o absurda no infla las horas", () => {
    const x = chapterSummary({
      bookings: [done(16, { duration_hours: 9999 }), done(17, { duration_hours: -3 })] as never,
      now: NOW,
    })!;
    expect(x.hours).toBe(0);
  });

  it("la nota es condicional, de solo hechos, y la firma se puede quitar", () => {
    const note = buildChapterNote(s);
    expect(note.startsWith("Si este capítulo ya terminó")).toBe(true);
    expect(note).toContain("5 días con cuidado: 5 servicios (28 horas en total).");
    expect(note.endsWith(CHAPTER_SIGNATURE)).toBe(true);
    expect(buildChapterNote(s, { signature: false })).not.toContain("humanix.lat");
  });

  it("el equipo solo aparece si se pide", () => {
    expect(buildChapterNote(s)).not.toMatch(/Ana|Luis/);
    expect(buildChapterNote(s, { includeTeam: true })).toContain("Los acompañó Ana, Luis y Marta.");
    expect(buildChapterNote(s, { includeTeam: true })).not.toMatch(/Ruiz|Prado|Soto|Pedro/);
  });

  it("nunca afirma recuperación, mejoría ni bienestar; sin dinero, contacto ni reseñas", () => {
    const note = buildChapterNote(s, { includeTeam: true });
    expect(note).not.toMatch(
      /recuper|mejor[ií]a|curad|sanó|alta m[eé]dica|todo (sali[oó] )?bien|termin[oó] bien|feliz fin/i,
    );
    expect(note).not.toMatch(
      /\$|\bCOP\b|pago|pagar|precio|whatsapp|@|rese[nñ]a|califica|estrellas/i,
    );
    expect(note.match(/https?:\/\/\S+/g)).toEqual(["https://humanix.lat"]);
  });

  it("singular: un día y un servicio, una hora", () => {
    const one = chapterSummary({ bookings: [done(20, { duration_hours: 1 })] as never, now: NOW })!;
    expect(buildChapterNote(one)).toContain("1 día con cuidado: 1 servicio (1 hora en total).");
  });
});
