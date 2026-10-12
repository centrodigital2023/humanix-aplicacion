import { describe, expect, it } from "vitest";
import {
  NO_CLOSE_EXTRA_HOURS,
  NO_START_HOURS,
  cancelledBy,
  contractedHours,
  dueInPeriod,
  isCompleted,
  isUnclosed,
  isUnstarted,
  lastCompletedByPro,
  lateMinutes,
  proNames,
  workedHours,
} from "./instData";
import { ahead, cancelled, dayAt, ib, late } from "./instIntel.fixture";
import { DAY, HOUR, NOW } from "./intel.fixture";
import { resolvePeriod } from "./intelShared";
import { CANCEL_REASONS } from "./serviceCancel";

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("servicios que ya debieron empezar dentro del periodo", () => {
  const period = resolvePeriod("30d", NOW);

  it("incluye los del periodo anteriores a ahora y deja fuera lo futuro, lo viejo y las solicitudes sin confirmar", () => {
    const inside = ib(5);
    const old = ib(40);
    const future = ahead(2);
    const pending = ib(3, { status: "pending" });
    const out = dueInPeriod([inside, old, future, pending], period, NOW);
    expect(out.map((b) => b.id)).toEqual([inside.id]);
  });

  it("el inicio del periodo cuenta, el final no, y «ahora» mismo todavía no ha empezado", () => {
    const atFrom = ib(0, { scheduled_at: iso(period.from) });
    const justBefore = ib(0, { scheduled_at: iso(period.from - 1) });
    const atNow = ib(0, { scheduled_at: iso(NOW) });
    const justPast = ib(0, { scheduled_at: iso(NOW - 1) });
    const out = dueInPeriod([atFrom, justBefore, atNow, justPast], period, NOW);
    expect(out.map((b) => b.id)).toEqual([atFrom.id, justPast.id]);
  });

  it("con el mes pasado, el último día entra y el primero del mes en curso no", () => {
    const lastMonth = resolvePeriod("last_month", NOW);
    const lastDay = ib(0, { scheduled_at: iso(lastMonth.to - 1) });
    const firstOfThis = ib(0, { scheduled_at: iso(lastMonth.to) });
    expect(dueInPeriod([lastDay, firstOfThis], lastMonth, NOW).map((b) => b.id)).toEqual([
      lastDay.id,
    ]);
  });

  it("una fecha dañada nunca cuenta", () => {
    expect(dueInPeriod([ib(1, { scheduled_at: "no es fecha" })], period, NOW)).toEqual([]);
  });

  it("aunque el periodo se extienda hacia el futuro, solo cuenta lo que ya debió empezar", () => {
    const wide = { ...period, to: NOW + 10 * DAY };
    const atNow = ib(0, { scheduled_at: iso(NOW) });
    const justPast = ib(0, { scheduled_at: iso(NOW - 1) });
    const future = ahead(2);
    expect(dueInPeriod([atNow, justPast, future], wide, NOW).map((b) => b.id)).toEqual([
      justPast.id,
    ]);
  });
});

describe("horas contratadas", () => {
  it("acepta texto numérico y nunca devuelve negativos ni NaN", () => {
    expect(contractedHours(ib(1, { duration_hours: "6.5" }))).toBe(6.5);
    expect(contractedHours(ib(1, { duration_hours: -3 }))).toBe(0);
    expect(contractedHours(ib(1, { duration_hours: null }))).toBe(0);
    expect(contractedHours(ib(1, { duration_hours: "abc" }))).toBe(0);
  });
  it("completed es el único estado que cuenta como prestado", () => {
    expect(isCompleted(ib(1))).toBe(true);
    for (const status of ["confirmed", "in_route", "in_progress", "cancelled", "pending"]) {
      expect(isCompleted(ib(1, { status }))).toBe(false);
    }
  });
});

describe("minutos de retraso", () => {
  it("a tiempo o antes de la hora es 0", () => {
    expect(lateMinutes(ib(1))).toBe(0);
    const start = dayAt(1, 8);
    expect(lateMinutes(ib(1, { arrived_at: iso(start - 25 * MIN) }))).toBe(0);
  });

  it("cuenta los minutos redondeados de la llegada que registró", () => {
    expect(lateMinutes(late(ib(1), 25))).toBe(25);
    const start = dayAt(1, 8);
    expect(lateMinutes(ib(1, { arrived_at: iso(start + 12 * MIN + 31_000) }))).toBe(13);
  });

  it("si no marcó llegada, usa el inicio; si la llegada está dañada, también", () => {
    const start = dayAt(1, 8);
    expect(lateMinutes(ib(1, { arrived_at: null, started_at: iso(start + 40 * MIN) }))).toBe(40);
    expect(lateMinutes(ib(1, { arrived_at: "basura", started_at: iso(start + 7 * MIN) }))).toBe(7);
  });

  it("sin llegada ni inicio, o sin hora programada, no hay dato", () => {
    expect(lateMinutes(ib(1, { arrived_at: null, started_at: null }))).toBeNull();
    expect(lateMinutes(ib(1, { scheduled_at: "x" }))).toBeNull();
    expect(lateMinutes(ib(1, { arrived_at: "x", started_at: "y" }))).toBeNull();
  });

  it("una llegada sin sentido (muy anterior al turno o posterior a su fin) se descarta", () => {
    const start = dayAt(1, 8);
    expect(lateMinutes(ib(1, { arrived_at: iso(start - 6 * HOUR) }))).toBe(0);
    expect(lateMinutes(ib(1, { arrived_at: iso(start - 6 * HOUR - 1) }))).toBeNull();
    expect(lateMinutes(ib(1, { arrived_at: iso(start + 6 * HOUR) }))).toBe(360);
    expect(lateMinutes(ib(1, { arrived_at: iso(start + 6 * HOUR + 1) }))).toBeNull();
  });

  it("con horas contratadas dañadas, el tope de llegada es 1 h", () => {
    const start = dayAt(1, 8);
    expect(lateMinutes(ib(1, { duration_hours: 0, arrived_at: iso(start + HOUR) }))).toBe(60);
    expect(lateMinutes(ib(1, { duration_hours: 0, arrived_at: iso(start + HOUR + 1) }))).toBeNull();
  });
});

describe("horas registradas", () => {
  it("es el tiempo entre el inicio y el cierre", () => {
    expect(workedHours(ib(1))).toBe(6);
    const start = dayAt(1, 8);
    expect(workedHours(ib(1, { completed_at: iso(start + 4.5 * HOUR) }))).toBe(4.5);
  });

  it("sin ambas horas, con el cierre antes del inicio o sin horas contratadas, no hay dato", () => {
    const start = dayAt(1, 8);
    expect(workedHours(ib(1, { started_at: null }))).toBeNull();
    expect(workedHours(ib(1, { completed_at: null }))).toBeNull();
    expect(workedHours(ib(1, { completed_at: iso(start) }))).toBeNull();
    expect(workedHours(ib(1, { completed_at: iso(start - HOUR) }))).toBeNull();
    expect(workedHours(ib(1, { duration_hours: 0 }))).toBeNull();
  });

  it("un registro de más de 3 veces lo contratado es un dato dañado", () => {
    const start = dayAt(1, 8);
    expect(workedHours(ib(1, { completed_at: iso(start + 18 * HOUR) }))).toBe(18);
    expect(workedHours(ib(1, { completed_at: iso(start + 18 * HOUR + MIN) }))).toBeNull();
  });
});

describe("quién canceló", () => {
  it("solo aplica a servicios cancelados", () => {
    expect(cancelledBy(ib(1))).toBeNull();
    expect(cancelledBy(ahead(1))).toBeNull();
  });

  it("lee el motivo guiado de cada parte y no adivina el resto", () => {
    expect(cancelledBy(cancelled(2, CANCEL_REASONS.professional[0].label))).toBe("professional");
    expect(cancelledBy(cancelled(2, `${CANCEL_REASONS.client[1].label}: otro turno`))).toBe(
      "client",
    );
    expect(cancelledBy(cancelled(2, "Me salió algo"))).toBe("unknown");
    expect(cancelledBy(cancelled(2, null))).toBe("unknown");
  });
});

describe("servicios sin iniciar y sin cerrar", () => {
  const start = dayAt(0, 8); // hoy 08:00; ahora son las 10:00

  it("los plazos son 2 h para iniciar y 12 h después del fin para cerrar", () => {
    expect(NO_START_HOURS).toBe(2);
    expect(NO_CLOSE_EXTRA_HOURS).toBe(12);
    const base = ahead(0, { scheduled_at: iso(NOW - 2 * HOUR) });
    expect(isUnstarted(base, NOW)).toBe(false); // justo 2 h
    expect(isUnstarted(base, NOW + 1)).toBe(true);
    const live = ib(1, { status: "in_progress", completed_at: null, duration_hours: 6 });
    const end = new Date(live.scheduled_at).getTime() + 6 * HOUR;
    expect(isUnclosed(live, end + 12 * HOUR)).toBe(false); // justo 12 h después del fin
    expect(isUnclosed(live, end + 12 * HOUR + 1)).toBe(true);
  });

  it("confirmado y a más de 2 h de la hora programada sin que nadie iniciara: sin iniciar", () => {
    const b = ahead(0, { scheduled_at: iso(NOW - NO_START_HOURS * HOUR - 1) });
    expect(isUnstarted(b, NOW)).toBe(true);
    expect(isUnstarted({ ...b, status: "in_route" }, NOW)).toBe(true);
  });

  it("justo a las 2 h todavía no, y tampoco si ya hay llegada o inicio", () => {
    const edge = ahead(0, { scheduled_at: iso(NOW - NO_START_HOURS * HOUR) });
    expect(isUnstarted(edge, NOW)).toBe(false);
    const old = ahead(0, { scheduled_at: iso(start - DAY) });
    expect(isUnstarted(old, NOW)).toBe(true);
    expect(isUnstarted({ ...old, arrived_at: iso(start - DAY) }, NOW)).toBe(false);
    expect(isUnstarted({ ...old, started_at: iso(start - DAY) }, NOW)).toBe(false);
  });

  it("otros estados y fechas dañadas no son «sin iniciar»", () => {
    for (const status of ["completed", "cancelled", "in_progress", "pending"]) {
      expect(isUnstarted({ ...ahead(0, { scheduled_at: iso(start - DAY) }), status }, NOW)).toBe(
        false,
      );
    }
    expect(isUnstarted(ahead(0, { scheduled_at: "x" }), NOW)).toBe(false);
  });

  it("en curso 12 h después del fin previsto: sin cerrar; antes, no", () => {
    const base = ib(1, { status: "in_progress", completed_at: null });
    const end = new Date(base.scheduled_at).getTime() + 6 * HOUR;
    expect(isUnclosed(base, end + NO_CLOSE_EXTRA_HOURS * HOUR + 1)).toBe(true);
    expect(isUnclosed(base, end + NO_CLOSE_EXTRA_HOURS * HOUR)).toBe(false);
    expect(isUnclosed(base, end)).toBe(false);
  });

  it("solo los servicios en curso pueden quedar sin cerrar", () => {
    for (const status of ["completed", "cancelled", "confirmed", "in_route"]) {
      expect(isUnclosed(ib(3, { status, completed_at: null }), NOW)).toBe(false);
    }
    expect(isUnclosed(ib(3, { status: "in_progress", scheduled_at: "x" }), NOW)).toBe(false);
  });
});

describe("nombres de los profesionales", () => {
  it("devuelve el nombre de quienes lo tienen, sin espacios sobrantes", () => {
    expect(
      proNames({
        p1: { name: "Marta Ruiz" },
        p2: { name: "  Luis Soto  ", rethusVerified: true },
      }),
    ).toEqual({ p1: "Marta Ruiz", p2: "Luis Soto" });
  });

  it("omite a quien no tiene nombre (nulo, ausente o en blanco)", () => {
    expect(
      proNames({ p1: { name: null }, p2: {}, p3: { name: "   " }, p4: { name: "Ana" } }),
    ).toEqual({ p4: "Ana" });
  });

  it("sin datos del perfil público no hay nombres", () => {
    expect(proNames(null)).toEqual({});
    expect(proNames({})).toEqual({});
  });
});

describe("último servicio terminado de cada profesional", () => {
  it("elige el más reciente de cada profesional", () => {
    const old = ib(20);
    const recent = ib(2);
    const other = ib(9, { professional_id: "p2" });
    expect(lastCompletedByPro([old, recent, other])).toEqual({ p1: recent.id, p2: other.id });
  });

  it("no cuenta lo cancelado, lo pendiente ni lo que aún no se hace", () => {
    const done = ib(8);
    const rows = [done, cancelled(1, null), ahead(1), ib(2, { status: "in_progress" })];
    expect(lastCompletedByPro(rows)).toEqual({ p1: done.id });
  });

  it("a igual fecha gana el id menor, sin importar el orden de la lista", () => {
    const a = ib(3, { id: "b-2" });
    const b = ib(3, { id: "a-1" });
    expect(lastCompletedByPro([a, b])).toEqual({ p1: "a-1" });
    expect(lastCompletedByPro([b, a])).toEqual({ p1: "a-1" });
  });

  it("una fecha dañada no desplaza a un servicio válido", () => {
    const good = ib(5);
    const broken = ib(1, { scheduled_at: "no es fecha" });
    expect(lastCompletedByPro([broken, good])).toEqual({ p1: good.id });
    expect(lastCompletedByPro([broken])).toEqual({});
  });

  it("sin servicios, el resultado queda vacío", () => {
    expect(lastCompletedByPro([])).toEqual({});
  });
});
