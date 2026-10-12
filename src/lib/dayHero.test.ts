import { describe, expect, it } from "vitest";
import {
  CALM_FLOOR,
  CALM_WEIGHT,
  TONE_LABEL,
  bogotaDayNumber,
  bogotaHour,
  calmAriaLabel,
  calmScore,
  cleanStats,
  dayPart,
  heroTone,
  splitVisible,
  warmGreeting,
  warmLine,
  type HeroPriority,
  type HeroRole,
  type HeroTone,
} from "./dayHero";

const LEVELS: HeroPriority[] = ["critical", "high", "medium", "low"];
const ROLES: HeroRole[] = ["family", "professional", "institution"];
const TONES: HeroTone[] = ["calm", "attention", "urgent"];

/** Generador determinista para las pruebas de propiedades. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const times = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);
/** Instante a partir de la hora de Bogotá (UTC−5). */
const bog = (iso: string) => new Date(`${iso}-05:00`).getTime();

describe("calmScore", () => {
  it("sin pendientes la calma es total", () => {
    expect(calmScore([])).toBe(100);
  });

  it("cada nivel resta lo suyo", () => {
    expect(calmScore(["critical"])).toBe(65);
    expect(calmScore(["high"])).toBe(86);
    expect(calmScore(["medium"])).toBe(95);
    expect(calmScore(["low"])).toBe(99);
  });

  it("se suman los pendientes de distinto nivel", () => {
    expect(calmScore(["critical", "high", "medium", "low"])).toBe(100 - 35 - 14 - 5 - 1);
  });

  it("pasado el tope de cada nivel, otro pendiente igual no cambia la calma", () => {
    for (const level of LEVELS) {
      const { max } = CALM_WEIGHT[level];
      expect(calmScore(times(max + 1, level))).toBe(calmScore(times(max, level)));
      expect(calmScore(times(max + 7, level))).toBe(calmScore(times(max, level)));
    }
  });

  it("dos urgencias bajan la calma a 30; la tercera ya no la mueve", () => {
    expect(calmScore(times(2, "critical"))).toBe(30);
    expect(calmScore(times(3, "critical"))).toBe(30);
  });

  it("nunca baja del piso ni pasa de 100, aunque todo se acumule: un «0» asusta sin informar", () => {
    const all: HeroPriority[] = LEVELS.flatMap((l) => times(20, l));
    expect(calmScore(all)).toBe(CALM_FLOOR);
    expect(CALM_FLOOR).toBeGreaterThan(0);
    expect(calmScore([])).toBeLessThanOrEqual(100);
  });

  it("el piso solo se alcanza con varias urgencias a la vez, no con una lista larga de tareas suaves", () => {
    expect(calmScore(times(50, "low"))).toBeGreaterThan(CALM_FLOOR);
    expect(calmScore(times(50, "medium"))).toBeGreaterThan(CALM_FLOOR);
    expect(calmScore([...times(2, "critical"), ...times(3, "high")])).toBe(CALM_FLOOR);
  });

  it("es un entero", () => {
    expect(Number.isInteger(calmScore(["high", "medium", "low"]))).toBe(true);
  });

  it("ignora niveles desconocidos en lugar de contarlos", () => {
    expect(calmScore(["urgente" as unknown as HeroPriority])).toBe(100);
    expect(calmScore(["critical", "x" as unknown as HeroPriority])).toBe(65);
  });

  it("propiedad: agregar un pendiente nunca sube la calma y el orden de la lista no importa", () => {
    const rnd = mulberry32(20261012);
    for (let i = 0; i < 400; i++) {
      const list: HeroPriority[] = Array.from(
        { length: Math.floor(rnd() * 14) },
        () => LEVELS[Math.floor(rnd() * LEVELS.length)],
      );
      const extra = LEVELS[Math.floor(rnd() * LEVELS.length)];
      const base = calmScore(list);
      expect(calmScore([...list, extra])).toBeLessThanOrEqual(base);
      expect(base).toBeGreaterThanOrEqual(CALM_FLOOR);
      expect(base).toBeLessThanOrEqual(100);
      const shuffled = [...list].sort(() => rnd() - 0.5);
      expect(calmScore(shuffled)).toBe(base);
    }
  });

  it("propiedad: un pendiente más grave resta al menos lo que uno menos grave", () => {
    for (let k = 0; k < LEVELS.length - 1; k++) {
      expect(CALM_WEIGHT[LEVELS[k]].penalty).toBeGreaterThan(CALM_WEIGHT[LEVELS[k + 1]].penalty);
    }
  });
});

describe("heroTone", () => {
  it("sin pendientes o solo tareas suaves está en calma", () => {
    expect(heroTone([])).toBe("calm");
    expect(heroTone(["low", "medium", "medium"])).toBe("calm");
  });

  it("lo importante pide atención", () => {
    expect(heroTone(["high"])).toBe("attention");
    expect(heroTone(["low", "high", "medium"])).toBe("attention");
  });

  it("lo crítico manda sobre todo lo demás", () => {
    expect(heroTone(["critical"])).toBe("urgent");
    expect(heroTone(["low", "high", "critical"])).toBe("urgent");
  });

  it("todos los tonos tienen etiqueta en español", () => {
    for (const tone of TONES) expect(TONE_LABEL[tone].length).toBeGreaterThan(3);
  });
});

describe("hora y momento del día (Colombia)", () => {
  it("convierte a la hora de Bogotá, también cuando cruza la medianoche en UTC", () => {
    expect(bogotaHour(new Date("2026-10-10T14:00:00Z"))).toBe(9);
    expect(bogotaHour(new Date("2026-10-11T01:00:00Z"))).toBe(20);
    expect(bogotaHour(new Date("2026-10-10T05:00:00Z"))).toBe(0);
    expect(bogotaHour(new Date("2026-10-10T04:59:59Z"))).toBe(23);
  });

  it("acepta milisegundos y fechas por igual", () => {
    const d = new Date("2026-10-10T14:00:00Z");
    expect(bogotaHour(d.getTime())).toBe(bogotaHour(d));
    expect(dayPart(d.getTime())).toBe(dayPart(d));
  });

  it("mañana hasta las 11:59, tarde hasta las 18:59 y noche desde las 19:00", () => {
    expect(dayPart(bog("2026-10-10T06:00:00"))).toBe("morning");
    expect(dayPart(bog("2026-10-10T11:59:59"))).toBe("morning");
    expect(dayPart(bog("2026-10-10T12:00:00"))).toBe("afternoon");
    expect(dayPart(bog("2026-10-10T18:59:59"))).toBe("afternoon");
    expect(dayPart(bog("2026-10-10T19:00:00"))).toBe("evening");
    expect(dayPart(bog("2026-10-10T23:59:59"))).toBe("evening");
  });

  it("de madrugada (antes de las 6) sigue siendo de noche, no «buenos días»", () => {
    expect(dayPart(bog("2026-10-10T00:00:00"))).toBe("evening");
    expect(dayPart(bog("2026-10-10T03:30:00"))).toBe("evening");
    expect(dayPart(bog("2026-10-10T05:59:59"))).toBe("evening");
  });

  it("no depende del huso del equipo: mismo instante, mismo resultado", () => {
    const instant = Date.UTC(2026, 9, 10, 17, 30);
    expect(dayPart(instant)).toBe("afternoon");
    expect(bogotaHour(instant)).toBe(12);
  });
});

describe("warmGreeting", () => {
  const morning = bog("2026-10-10T09:00:00");

  it("saluda por el primer nombre", () => {
    expect(warmGreeting(morning, "María José")).toBe("Buenos días, María");
    expect(warmGreeting(morning, "  Luis   Fernando Gómez ")).toBe("Buenos días, Luis");
  });

  it("sin nombre queda el saludo solo", () => {
    expect(warmGreeting(morning)).toBe("Buenos días");
    expect(warmGreeting(morning, null)).toBe("Buenos días");
    expect(warmGreeting(morning, "")).toBe("Buenos días");
    expect(warmGreeting(morning, "   ")).toBe("Buenos días");
  });

  it("un correo no es un nombre: nunca se le dice «Hola ana@correo.com»", () => {
    expect(warmGreeting(morning, "ana.perez@correo.com")).toBe("Buenos días");
  });

  it("cambia con la hora", () => {
    expect(warmGreeting(bog("2026-10-10T15:00:00"), "Ana")).toBe("Buenas tardes, Ana");
    expect(warmGreeting(bog("2026-10-10T21:00:00"), "Ana")).toBe("Buenas noches, Ana");
  });
});

describe("warmLine", () => {
  it("hay una frase para cada rol y cada tono", () => {
    const now = bog("2026-10-10T10:00:00");
    for (const role of ROLES)
      for (const tone of TONES) {
        const line = warmLine(role, tone, now);
        expect(typeof line).toBe("string");
        expect(line.length).toBeGreaterThan(10);
      }
  });

  it("es la misma durante todo el día de Colombia y puede cambiar al día siguiente", () => {
    const early = bog("2026-10-10T00:01:00");
    const late = bog("2026-10-10T23:59:00");
    for (const role of ROLES)
      for (const tone of TONES) {
        expect(warmLine(role, tone, early)).toBe(warmLine(role, tone, late));
      }
    const seen = new Set<string>();
    for (let d = 0; d < 6; d++)
      seen.add(warmLine("family", "calm", bog("2026-10-10T10:00:00") + d * 86_400_000));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("el número del día cambia a la medianoche de Bogotá, no a la de UTC", () => {
    expect(bogotaDayNumber(new Date("2026-10-10T04:59:59Z"))).toBe(
      bogotaDayNumber(new Date("2026-10-09T12:00:00Z")),
    );
    expect(bogotaDayNumber(new Date("2026-10-10T05:00:00Z"))).toBe(
      bogotaDayNumber(new Date("2026-10-09T12:00:00Z")) + 1,
    );
  });

  it("ninguna frase habla de pagos, de WhatsApp ni promete resultados clínicos", () => {
    const now = bog("2026-10-10T10:00:00");
    for (const role of ROLES)
      for (const tone of TONES)
        for (let d = 0; d < 5; d++) {
          const line = warmLine(role, tone, now + d * 86_400_000).toLowerCase();
          expect(line).not.toMatch(/pago|pagar|cobr|whatsapp|garantiz|curar|diagn/);
        }
  });
});

describe("cleanStats y etiqueta de accesibilidad", () => {
  it("descarta cifras inválidas para no pintar «NaN»", () => {
    expect(
      cleanStats([
        { label: "a", value: 3 },
        { label: "b", value: Number.NaN },
        { label: "c", value: -1 },
        { label: "d", value: Number.POSITIVE_INFINITY },
        { label: "e", value: "" },
        { label: "f", value: "$1,2 M" },
        { label: "g", value: 0 },
      ]),
    ).toEqual([
      { label: "a", value: 3 },
      { label: "f", value: "$1,2 M" },
      { label: "g", value: 0 },
    ]);
  });

  it("dice la calma y el tono con palabras", () => {
    expect(calmAriaLabel(65, "urgent")).toBe("Calma del día: 65 de 100. Urgente.");
    expect(calmAriaLabel(100, "calm")).toBe("Calma del día: 100 de 100. Todo en orden.");
  });
});

describe("splitVisible", () => {
  const item = (id: string, priority: HeroPriority) => ({ id, priority });

  it("muestra hasta el límite y deja el resto detrás de «ver más», en orden", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((id) => item(id, "medium"));
    const { shown, hidden } = splitVisible(items, 4);
    expect(shown.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(hidden.map((i) => i.id)).toEqual(["e", "f"]);
  });

  it("lo crítico entra siempre aunque pase del límite", () => {
    const items = [
      item("c1", "critical"),
      item("c2", "critical"),
      item("c3", "critical"),
      item("h", "high"),
      item("m", "medium"),
    ];
    const { shown, hidden } = splitVisible(items, 2);
    expect(shown.map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
    expect(hidden.map((i) => i.id)).toEqual(["h", "m"]);
  });

  it("con pocos ítems no esconde nada", () => {
    const items = [item("a", "low")];
    expect(splitVisible(items)).toEqual({ shown: items, hidden: [] });
    expect(splitVisible([])).toEqual({ shown: [], hidden: [] });
  });

  it("no altera la lista original", () => {
    const items = [item("a", "medium"), item("b", "medium")];
    const copy = [...items];
    splitVisible(items, 1);
    expect(items).toEqual(copy);
  });

  it("un límite inválido no rompe: negativo o 0 muestra solo lo crítico", () => {
    const items = [item("a", "critical"), item("b", "medium")];
    expect(splitVisible(items, 0).shown.map((i) => i.id)).toEqual(["a"]);
    expect(splitVisible(items, -3).shown.map((i) => i.id)).toEqual(["a"]);
  });

  it("propiedad: nunca esconde lo crítico y no pierde ni repite ninguna acción", () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const list = Array.from({ length: Math.floor(rnd() * 12) }, (_, k) =>
        item(`i${k}`, LEVELS[Math.floor(rnd() * LEVELS.length)]),
      );
      const max = Math.floor(rnd() * 6);
      const { shown, hidden } = splitVisible(list, max);
      expect(hidden.some((h) => h.priority === "critical")).toBe(false);
      expect(shown.length + hidden.length).toBe(list.length);
      expect(new Set([...shown, ...hidden].map((x) => x.id)).size).toBe(list.length);
      expect(shown.length).toBeGreaterThanOrEqual(Math.min(list.length, max));
    }
  });

  it("propiedad: con la lista ya ordenada por prioridad, shown + hidden es la lista original", () => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    const rnd = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const list = Array.from({ length: Math.floor(rnd() * 12) }, (_, k) =>
        item(`i${k}`, LEVELS[Math.floor(rnd() * LEVELS.length)]),
      ).sort((a, b) => rank[a.priority] - rank[b.priority]);
      const { shown, hidden } = splitVisible(list, Math.floor(rnd() * 6));
      expect([...shown, ...hidden]).toEqual(list);
    }
  });

  it("si lo crítico viene al final de una lista desordenada, igual se muestra", () => {
    const items = [item("a", "low"), item("b", "low"), item("c", "low"), item("z", "critical")];
    const { shown, hidden } = splitVisible(items, 2);
    expect(shown.map((i) => i.id)).toEqual(["a", "b", "z"]);
    expect(hidden.map((i) => i.id)).toEqual(["c"]);
  });
});
