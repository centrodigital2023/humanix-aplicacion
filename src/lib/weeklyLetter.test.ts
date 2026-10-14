import { describe, expect, it } from "vitest";
import {
  LETTER_SHARE_NOTICE,
  LETTER_SIGNATURE,
  buildWeeklyLetter,
  type LetterBooking,
  type LetterLog,
} from "./weeklyLetter";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

let seq = 0;
const svc = (daysAgo: number, hours = 6, over: Partial<LetterBooking> = {}): LetterBooking => ({
  id: `b${++seq}`,
  status: "completed",
  scheduled_at: iso(-daysAgo * DAY),
  duration_hours: hours,
  ...over,
});
const lg = (daysAgo: number, over: Partial<LetterLog> = {}): LetterLog => ({
  booking_id: "b1",
  event_type: "note",
  is_alert: false,
  created_at: iso(-daysAgo * DAY),
  ...over,
});
const letter = (
  bookings: LetterBooking[],
  logs: LetterLog[],
  extra: Partial<Parameters<typeof buildWeeklyLetter>[0]> = {},
) => buildWeeklyLetter({ route: "elder", bookings, logs, now: NOW, ...extra });

describe("carta de la semana: cuándo hay algo que contar", () => {
  it("sin servicios ni partes en la semana no hay carta (nada de relleno)", () => {
    const l = letter([], []);
    expect(l.empty).toBe(true);
    expect(l.text).toBe("");
    expect(l.lines).toEqual([]);
  });

  it("lo de hace más de una semana no entra", () => {
    const l = letter([svc(8)], [lg(8, { event_type: "meal" })]);
    expect(l.empty).toBe(true);
  });

  it("solo cuentan servicios terminados o en curso", () => {
    const l = letter(
      [
        svc(1, 6, { status: "cancelled" }),
        svc(1, 6, { status: "confirmed" }),
        svc(1, 4, { status: "in_progress" }),
      ],
      [],
    );
    expect(l.facts.services).toBe(1);
    expect(l.facts.hours).toBe(4);
  });

  it("los registros del sistema no cuentan como parte", () => {
    const l = letter([], [lg(1, { event_type: "arrival", system_generated: true })]);
    expect(l.empty).toBe(true);
  });
});

describe("carta de la semana: lo que cuenta", () => {
  it("servicios y horas", () => {
    const l = letter([svc(1, 6), svc(3, 4)], []);
    expect(l.facts).toMatchObject({ services: 2, hours: 10 });
    expect(l.lines).toContain("Hubo 2 servicios de cuidado (10 horas en total).");
  });

  it("singular de servicio y de hora", () => {
    expect(letter([svc(1, 1)], []).lines).toContain(
      "Hubo 1 servicio de cuidado (1 hora en total).",
    );
  });

  it("horas con coma decimal, como en Colombia", () => {
    expect(letter([svc(1, 1.5)], []).lines).toContain(
      "Hubo 1 servicio de cuidado (1,5 horas en total).",
    );
  });

  it("comidas, medicamentos y actividades anotados", () => {
    const l = letter(
      [svc(1)],
      [
        lg(1, { event_type: "meal" }),
        lg(1, { event_type: "meal" }),
        lg(2, { event_type: "medication" }),
        lg(2, { event_type: "activity" }),
        lg(2, { event_type: "activity" }),
        lg(2, { event_type: "activity" }),
      ],
    );
    expect(l.facts).toMatchObject({ meals: 2, medications: 1, activities: 3 });
    expect(l.lines).toContain(
      "Quedaron anotadas: 2 comidas registradas, 1 toma de medicamento registrada, 3 momentos de actividad.",
    );
  });

  it("no menciona lo que no hubo", () => {
    const l = letter([svc(1)], [lg(1, { event_type: "meal" })]);
    expect(l.text).not.toMatch(/medicamento|actividad|aviso/);
  });
});

describe("carta de la semana: ánimo", () => {
  const moods = (...m: Array<[number, string]>) => m.map(([d, mood]) => lg(d, { mood }));

  it("sobre todo tranquilo o contento", () => {
    const l = letter([svc(1)], moods([1, "calm"], [2, "happy"], [3, "calm"]));
    expect(l.facts).toMatchObject({ calmDays: 3, hardDays: 0 });
    expect(l.lines).toContain("El ánimo anotado fue, sobre todo, tranquilo o contento.");
  });

  it("varios días más difíciles", () => {
    const l = letter([svc(1)], moods([1, "sad"], [2, "pain"], [3, "tired"]));
    expect(l.lines.join(" ")).toContain("varios días más difíciles");
  });

  it("variado", () => {
    const l = letter([svc(1)], moods([1, "calm"], [2, "calm"], [3, "sad"], [4, "tired"]));
    expect(l.lines).toContain(
      "El ánimo anotado fue variado, con días mejores y otros más difíciles.",
    );
  });

  it("con un solo día de ánimo no se saca conclusión", () => {
    const l = letter([svc(1)], moods([1, "sad"]));
    expect(l.text).not.toMatch(/ánimo/);
  });

  it("de cada día cuenta el último ánimo", () => {
    const early = lg(1, { mood: "calm", created_at: iso(-1 * DAY - 3 * HOUR) });
    const late = lg(1, { mood: "tired", created_at: iso(-1 * DAY) });
    const other = lg(2, { mood: "tired" });
    const l = letter([svc(1)], [early, late, other]);
    expect(l.facts).toMatchObject({ calmDays: 0, hardDays: 2 });
  });

  it("un ánimo desconocido se ignora", () => {
    const l = letter([svc(1)], [lg(1, { mood: "eufórico" }), lg(2, { mood: "calm" })]);
    expect(l.facts.calmDays + l.facts.hardDays).toBe(1);
  });
});

describe("carta de la semana: avisos y honestidad", () => {
  it("cuenta los avisos y pide comentarlos con el médico, sin interpretar", () => {
    const one = letter([svc(1)], [lg(1, { is_alert: true })]);
    expect(one.lines).toContain("Hubo 1 aviso en los partes. Conviene comentarlo con el médico.");
    const two = letter([svc(1)], [lg(1, { is_alert: true }), lg(2, { is_alert: true })]);
    expect(two.lines).toContain("Hubo 2 avisos en los partes. Conviene comentarlos con el médico.");
  });

  it("nunca afirma que todo está bien (la ausencia de registros no lo prueba)", () => {
    const l = letter(
      [svc(1)],
      [lg(1, { event_type: "meal" }), lg(2, { mood: "calm" }), lg(3, { mood: "happy" })],
    );
    expect(l.text).not.toMatch(
      /todo (est[aá] )?bien|sin novedad|sin problemas|normal|estable|mejor/i,
    );
  });

  it("no incluye valores de signos vitales aunque el parte los tenga", () => {
    const l = letter(
      [svc(1)],
      [
        lg(1, {
          event_type: "vital_signs",
          is_alert: true,
          description: "PA 150/95",
        } as Partial<LetterLog>),
      ],
    );
    expect(l.text).not.toMatch(/mmhg|presi[oó]n|°|\d+\/\d+|latidos|ox[ií]geno|temperatura/i);
  });
});

describe("carta de la semana: nombre y equipo", () => {
  it("por defecto no lleva el nombre", () => {
    const l = letter([svc(1)], [], { options: { personName: "Rosa Elena Gómez" } });
    expect(l.usedName).toBe(false);
    expect(l.title).toBe("Carta de la semana");
    expect(l.text).not.toContain("Rosa");
  });

  it("con permiso, usa solo el nombre de pila", () => {
    const l = letter([svc(1)], [], {
      options: { personName: "Rosa Elena Gómez", includeName: true },
    });
    expect(l.usedName).toBe(true);
    expect(l.title).toBe("Carta de la semana de Rosa");
    expect(l.text).not.toContain("Gómez");
  });

  it("en la ruta de niño o niña, jamás lleva el nombre, ni siquiera si se pide", () => {
    const l = letter([svc(1)], [], {
      route: "child",
      options: { personName: "Sofía Pérez", includeName: true, includeTeam: false },
    });
    expect(l.usedName).toBe(false);
    expect(l.text).not.toContain("Sofía");
  });

  it("un nombre vacío no se usa", () => {
    expect(
      letter([svc(1)], [], { options: { personName: "   ", includeName: true } }).usedName,
    ).toBe(false);
    expect(
      letter([svc(1)], [], { options: { personName: null, includeName: true } }).usedName,
    ).toBe(false);
  });

  it("el equipo solo aparece si se pide: nombres de pila, sin repetir, hasta tres", () => {
    const bookings = [
      svc(1, 6, { professional_name: "Ana María Ruiz" }),
      svc(2, 6, { professional_name: "Ana María Ruiz" }),
      svc(3, 6, { professional_name: "Luis Prado" }),
      svc(4, 6, { professional_name: "Marta Soto" }),
      svc(5, 6, { professional_name: "Pedro Gil" }),
      svc(5, 6, { professional_name: null }),
    ];
    expect(letter(bookings, []).text).not.toMatch(/acompañ.*(Ana|Luis)/);
    const l = letter(bookings, [], { options: { includeTeam: true } });
    expect(l.lines).toContain("Los acompañó Ana, Luis y Marta.");
    expect(l.text).not.toMatch(/Ruiz|Prado|Soto|Pedro/);
  });
});

describe("carta de la semana: tono y firma", () => {
  it("tono cálido por defecto, con su cierre", () => {
    const l = letter([svc(1)], []);
    expect(l.lines[0]).toBe("Les cuento cómo estuvo la semana.");
    expect(l.lines).toContain("Gracias por cuidar juntos. 💛");
  });

  it("en la ruta de enfermedad el tono es sobrio y sin emoji", () => {
    const l = letter([svc(1)], [], { route: "illness" });
    expect(l.lines[0]).toBe("Les cuento cómo fue esta semana.");
    expect(l.lines).toContain("Gracias por estar pendientes.");
    expect(l.text).not.toMatch(/💛|¡/u);
  });

  it("lleva firma discreta, y se puede quitar", () => {
    expect(letter([svc(1)], []).text.endsWith(LETTER_SIGNATURE)).toBe(true);
    expect(letter([svc(1)], [], { options: { signature: false } }).text).not.toContain(
      "humanix.lat",
    );
  });

  it("el aviso previo a compartir menciona que son datos de salud", () => {
    expect(LETTER_SHARE_NOTICE).toMatch(/salud/);
    expect(LETTER_SHARE_NOTICE).toMatch(/Ley 1581/);
  });
});

describe("carta de la semana: privacidad (con todas las opciones encendidas)", () => {
  const full = () =>
    letter(
      [
        svc(1, 6, { professional_name: "Ana Ruiz" }),
        svc(2, 4, { professional_name: "Luis Prado" }),
      ],
      [
        lg(1, { event_type: "meal", mood: "calm" }),
        lg(1, { event_type: "medication" }),
        lg(2, { event_type: "activity", mood: "happy" }),
        lg(2, { is_alert: true, mood: "pain" }),
      ],
      {
        options: {
          personName: "Rosa Gómez",
          includeName: true,
          includeTeam: true,
          signature: true,
        },
      },
    );

  it("sin dinero, pagos, teléfonos, correos ni direcciones", () => {
    const { text } = full();
    expect(text).not.toMatch(/\$|\bCOP\b|pago|pagar|tarifa|precio|cobr|factura/i);
    expect(text).not.toMatch(/\d{7,}/);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/whatsapp|calle|carrera|cra\.|barrio|direcci[oó]n/i);
  });

  it("el único enlace es el de la firma", () => {
    const links = full().text.match(/https?:\/\/\S+/g) ?? [];
    expect(links).toEqual(["https://humanix.lat"]);
  });

  it("el texto es estable: mismos datos, misma carta", () => {
    expect(full().text).toBe(full().text);
  });
});
