import { describe, it, expect } from "vitest";
import {
  addBusinessDays,
  businessDaysBetween,
  categoryTrends,
  colombianHolidays,
  csvCell,
  detectSafetySignals,
  easterSunday,
  evaluateSla,
  findRelatedTickets,
  isValidRadicado,
  legalDueAt,
  toCsv,
  validateIntake,
  ymdKey,
} from "./pqrsRules";

describe("calendario de Colombia", () => {
  it("calcula la Pascua", () => {
    expect(ymdKey(easterSunday(2024))).toBe("2024-03-31");
    expect(ymdKey(easterSunday(2025))).toBe("2025-04-20");
    expect(ymdKey(easterSunday(2026))).toBe("2026-04-05");
    expect(ymdKey(easterSunday(2027))).toBe("2027-03-28");
  });

  it("genera los festivos de 2026", () => {
    const expected = [
      "2026-01-01",
      "2026-01-12",
      "2026-03-23",
      "2026-04-02",
      "2026-04-03",
      "2026-05-01",
      "2026-05-18",
      "2026-06-08",
      "2026-06-15",
      "2026-06-29",
      "2026-07-20",
      "2026-08-07",
      "2026-08-17",
      "2026-10-12",
      "2026-11-02",
      "2026-11-16",
      "2026-12-08",
      "2026-12-25",
    ];
    expect([...colombianHolidays(2026)].sort()).toEqual(expected);
  });

  it("salta festivos y fines de semana al sumar días hábiles", () => {
    // Viernes 20-mar-2026 12:00 Bogotá; el lunes 23 es festivo (San José) => 1 día hábil = martes 24.
    const fri = Date.UTC(2026, 2, 20, 17, 0, 0);
    expect(addBusinessDays(fri, 1).toISOString().slice(0, 10)).toBe("2026-03-25"); // 23:59 Bogotá = 04:59Z del día siguiente
    // Miércoles 1-abr-2026: jueves y viernes santos => 1 día hábil = lunes 6-abr.
    const wed = Date.UTC(2026, 3, 1, 17, 0, 0);
    expect(addBusinessDays(wed, 1).toISOString().slice(0, 10)).toBe("2026-04-07");
  });

  it("plazo de 15 días hábiles desde el lunes 5-oct-2026 vence el 27-oct", () => {
    const mon = Date.UTC(2026, 9, 5, 17, 0, 0);
    const due = legalDueAt(mon, "peticion");
    // 23:59:59 hora de Colombia del 27-oct = 04:59:59Z del 28-oct
    expect(due.toISOString()).toBe("2026-10-28T04:59:59.999Z");
    expect(businessDaysBetween(mon, due)).toBe(15);
  });

  it("las consultas tienen 30 días hábiles", () => {
    const mon = Date.UTC(2026, 9, 5, 17, 0, 0);
    expect(businessDaysBetween(mon, legalDueAt(mon, "consulta"))).toBe(30);
  });

  it("devuelve negativo si el plazo ya pasó", () => {
    const a = Date.UTC(2026, 9, 5, 17, 0, 0);
    const b = Date.UTC(2026, 9, 7, 17, 0, 0);
    expect(businessDaysBetween(b, a)).toBe(-2);
  });
});

describe("seguridad", () => {
  it("detecta emergencias y daño físico como críticos", () => {
    const s = detectSafetySignals("La paciente se desmayó y no respira bien, hubo una caída");
    expect(s.level).toBe("critical");
    expect(s.categories).toContain("medical_emergency");
  });
  it("detecta pago fuera de la plataforma como revisión", () => {
    const s = detectSafetySignals("Me pidió que le transfiera por fuera para evitar la comisión");
    expect(s.level).toBe("review");
    expect(s.categories).toContain("off_platform_payment");
  });
  it("ignora acentos y mayúsculas", () => {
    expect(detectSafetySignals("ACOSO en el domicilio").level).toBe("critical");
  });
  it("no marca textos neutros", () => {
    expect(detectSafetySignals("Quiero saber cómo actualizar mi tarifa").level).toBe("none");
  });
});

describe("evaluateSla", () => {
  const created = "2026-10-05T17:00:00Z"; // lunes
  const base = {
    type: "peticion",
    status: "open",
    created_at: created,
    ai_priority: "normal",
    assigned_to: null,
  };

  it("cerrado no tiene riesgo", () => {
    const r = evaluateSla({ ...base, status: "resolved" }, Date.UTC(2026, 9, 8));
    expect(r.legalState).toBe("closed");
    expect(r.riskScore).toBe(0);
  });
  it("vencido sube el riesgo y lo explica", () => {
    const r = evaluateSla({ ...base, ai_priority: "urgent" }, Date.UTC(2026, 10, 10));
    expect(r.legalState).toBe("breached");
    expect(r.riskScore).toBeGreaterThanOrEqual(70);
    expect(r.reasons[0]).toMatch(/vencido/i);
  });
  it("un ticket nuevo tiene riesgo bajo", () => {
    const r = evaluateSla(base, Date.UTC(2026, 9, 5, 18, 0, 0));
    expect(r.legalState).toBe("ok");
    expect(r.riskScore).toBeLessThan(15);
  });
  it("marca en riesgo cuando faltan 3 días hábiles o menos", () => {
    const r = evaluateSla(base, Date.UTC(2026, 9, 23, 17, 0, 0)); // faltan 2 hábiles
    expect(r.legalState).toBe("at_risk");
  });
  it("la seguridad crítica suma al riesgo", () => {
    const a = evaluateSla(base, Date.UTC(2026, 9, 6));
    const b = evaluateSla({ ...base, safety_level: "critical" }, Date.UTC(2026, 9, 6));
    expect(b.riskScore).toBeGreaterThan(a.riskScore);
  });
});

describe("tickets relacionados", () => {
  const t = (
    id: string,
    subject: string,
    description: string,
    email: string | null,
    created = "2026-10-05T10:00:00Z",
  ) => ({
    id,
    subject,
    description,
    contact_email: email,
    created_at: created,
  });
  it("une mismo contacto con texto parecido", () => {
    const target = t(
      "a",
      "Cobro duplicado en mi plan",
      "Me cobraron dos veces la suscripción mensual del plan",
      "x@correo.com",
    );
    const other = t(
      "b",
      "Cobro doble del plan",
      "Me cobraron dos veces la suscripción mensual",
      "X@correo.com",
    );
    const r = findRelatedTickets(target, [other]);
    expect(r[0].id).toBe("b");
    expect(r[0].reason).toBe("same_contact_similar_text");
  });
  it("ignora tickets fuera de la ventana", () => {
    const target = t(
      "a",
      "Cobro duplicado",
      "Me cobraron dos veces el plan mensual",
      "x@correo.com",
    );
    const old = t(
      "b",
      "Cobro duplicado",
      "Me cobraron dos veces el plan mensual",
      "x@correo.com",
      "2026-08-01T10:00:00Z",
    );
    expect(findRelatedTickets(target, [old])).toHaveLength(0);
  });
  it("no relaciona temas distintos de personas distintas", () => {
    const target = t(
      "a",
      "Cobro duplicado",
      "Me cobraron dos veces el plan mensual",
      "x@correo.com",
    );
    const other = t(
      "b",
      "Perfil sin publicar",
      "Mi perfil profesional no aparece en el mapa",
      "y@correo.com",
    );
    expect(findRelatedTickets(target, [other])).toHaveLength(0);
  });
});

describe("tendencias", () => {
  it("detecta picos de una categoría", () => {
    const now = Date.UTC(2026, 9, 14);
    const day = 86_400_000;
    const mk = (daysAgo: number, cat: string) => ({
      ai_category: cat,
      type: "queja",
      created_at: new Date(now - daysAgo * day).toISOString(),
    });
    const rows = categoryTrends(
      [
        mk(1, "facturacion"),
        mk(2, "facturacion"),
        mk(3, "facturacion"),
        mk(10, "facturacion"),
        mk(2, "soporte"),
      ],
      now,
    );
    expect(rows[0]).toMatchObject({ key: "facturacion", current: 3, previous: 1, spike: true });
    expect(rows.find((r) => r.key === "soporte")?.spike).toBe(false);
  });
});

describe("csv y radicado", () => {
  it("neutraliza fórmulas y escapa comillas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
  });
  it("arma un CSV con encabezados", () => {
    expect(
      toCsv(
        [{ a: 1, b: "x" }],
        [
          { key: "a", header: "A" },
          { key: "b", header: "B" },
        ],
      ),
    ).toBe("A,B\n1,x");
  });
  it("valida el formato de radicado", () => {
    expect(isValidRadicado("pqrs-2026-000123")).toBe(true);
    expect(isValidRadicado("PQRS-26-1")).toBe(false);
  });
});

describe("validateIntake", () => {
  const ok = {
    name: "Ana Pérez",
    email: "Ana@Correo.com",
    phone: "300 123 4567",
    type: "queja",
    subject: "Cobro",
    description: "Me cobraron dos veces",
    consent: true,
  };
  it("normaliza y acepta una solicitud válida", () => {
    const r = validateIntake(ok);
    expect(r).toMatchObject({ ok: true, honeypot: false });
    if (r.ok && !r.honeypot) {
      expect(r.value.email).toBe("ana@correo.com");
      expect(r.value.phone).toBe("3001234567");
    }
  });
  it("exige consentimiento y campos mínimos", () => {
    const r = validateIntake({ ...ok, consent: false, description: "corto" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(["consent", "description"]));
  });
  it("detecta la trampa para bots", () => {
    expect(validateIntake({ ...ok, website: "http://spam" })).toMatchObject({
      ok: true,
      honeypot: true,
    });
  });
  it("rechaza tipos desconocidos y correos inválidos", () => {
    const r = validateIntake({ ...ok, type: "otro", email: "no-es-correo" });
    expect(r.ok).toBe(false);
  });
});
