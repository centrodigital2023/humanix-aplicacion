import { describe, it, expect } from "vitest";
import {
  EMERGENCY_NUMBER,
  EMERGENCY_TEL,
  SOS_ACTION_STATUS,
  activeSosCount,
  classifySosError,
  isCoord,
  isSosOpen,
  mapsLink,
  normalizeCoPhone,
  plural,
  sosActionsFor,
  sosAgeLabel,
  sosHandledLine,
  sosOutcome,
  sosWhatsappText,
  sortSosAlerts,
  whatsappLink,
  type SosAlertRow,
} from "./sos";

describe("clasificación del error del SOS (espejo de la guarda de la base)", () => {
  it("usa la pista que pone la base", () => {
    expect(classifySosError({ code: "23514", hint: "sos_recent", message: "x" })).toBe("recent");
    expect(classifySosError({ code: "23514", hint: "sos_limit", message: "x" })).toBe("limit");
  });
  it("y, si la pista no llega, reconoce el texto", () => {
    expect(classifySosError({ message: "Ya se envió un SOS hace un momento. Si sigues…" })).toBe(
      "recent",
    );
    expect(classifySosError({ message: "Demasiados SOS en la última hora. Llama al 123" })).toBe(
      "limit",
    );
  });
  it("base sin migrar: columnas o tablas desconocidas", () => {
    expect(
      classifySosError({
        code: "42703",
        message: 'column "lat" of relation "clinical_alerts" does not exist',
      }),
    ).toBe("unavailable");
    expect(
      classifySosError({
        code: "PGRST204",
        message: "Could not find the 'lat' column of 'clinical_alerts' in the schema cache",
      }),
    ).toBe("unavailable");
    expect(classifySosError({ code: "PGRST205", message: "x" })).toBe("unavailable");
  });
  it("permisos", () => {
    expect(
      classifySosError({
        code: "42501",
        message: 'new row violates row-level security policy for table "clinical_alerts"',
      }),
    ).toBe("denied");
    expect(classifySosError({ message: "permission denied for table clinical_alerts" })).toBe(
      "denied",
    );
  });
  it("lo demás es desconocido; nada de crashear con null", () => {
    expect(classifySosError({ code: "XX000", message: "boom" })).toBe("unknown");
    expect(classifySosError(null)).toBe("unknown");
    expect(classifySosError(undefined)).toBe("unknown");
    expect(classifySosError({})).toBe("unknown");
  });
  it("el límite por hora se parece al de la base", () => {
    expect(EMERGENCY_NUMBER).toBe("123");
    expect(EMERGENCY_TEL).toBe("tel:123");
  });
});

describe("celulares colombianos para WhatsApp", () => {
  it.each([
    ["3001234567", "573001234567"],
    ["300 123 4567", "573001234567"],
    ["+57 300 123 4567", "573001234567"],
    ["(57) 3001234567", "573001234567"],
    ["0057 300 123 4567", "573001234567"],
    ["57-300-123-4567", "573001234567"],
    ["313.555.1212", "573135551212"],
  ])("%s → %s", (raw: string, want: string) => expect(normalizeCoPhone(raw)).toBe(want));
  it.each([
    ["6015551234"], // fijo de Bogotá
    ["2001234567"], // no empieza por 3
    ["30012345"], // corto
    ["30012345678"], // largo
    ["+1 305 555 0100"], // de otro país
    [""],
    ["abc"],
  ])("%s no es un celular colombiano", (raw: string) => expect(normalizeCoPhone(raw)).toBeNull());
  it("null y undefined", () => {
    expect(normalizeCoPhone(null)).toBeNull();
    expect(normalizeCoPhone(undefined)).toBeNull();
  });
});

describe("ubicación y mensaje de WhatsApp", () => {
  it("coordenadas válidas", () => {
    expect(isCoord(4.6097, -74.0817)).toBe(true);
    expect(isCoord(91, 0)).toBe(false);
    expect(isCoord(0, 181)).toBe(false);
    expect(isCoord(NaN, 0)).toBe(false);
    expect(isCoord(null, null)).toBe(false);
    expect(isCoord("4", "5")).toBe(false);
  });
  it("enlace de Google Maps con seis decimales", () => {
    expect(mapsLink(4.6097, -74.0817)).toBe("https://www.google.com/maps?q=4.609700,-74.081700");
    expect(mapsLink(null, -74)).toBeNull();
    expect(mapsLink(4.6, undefined)).toBeNull();
    expect(mapsLink(100, 0)).toBeNull();
  });
  it("texto con ubicación", () => {
    const t = sosWhatsappText({ name: " Ana R. ", lat: 4.6097, lng: -74.0817 });
    expect(t).toContain("Ana R. necesita ayuda urgente");
    expect(t).toContain("https://www.google.com/maps?q=4.609700,-74.081700");
    expect(t).toContain("llama al 123");
  });
  it("texto sin ubicación ni nombre", () => {
    const t = sosWhatsappText({});
    expect(t).toContain("Una persona de Humanix necesita ayuda urgente");
    expect(t).toContain("llámame ya");
    expect(t).not.toContain("maps");
  });
  it("enlace de WhatsApp: con teléfono abre el chat; sin él, el selector de contactos", () => {
    const text = "Ayuda & rápido";
    expect(whatsappLink("300 123 4567", text)).toBe(
      `https://wa.me/573001234567?text=${encodeURIComponent(text)}`,
    );
    expect(whatsappLink(null, text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(whatsappLink("6015551234", text)).toBe(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
    );
  });
});

describe("lo que se le dice a la persona", () => {
  it("enviado a 2 personas, con ubicación y contacto de emergencia", () => {
    const o = sosOutcome({
      status: "sent",
      inappNotified: 2,
      hasLocation: true,
      hasEmergencyContact: true,
    });
    expect(o.tone).toBe("ok");
    expect(o.headline).toBe("SOS enviado");
    expect(o.lines[0]).toBe(
      "Avisamos dentro de Humanix a 2 personas de tu círculo y tu equipo de cuidado.",
    );
    expect(o.lines[1]).toContain("contacto de emergencia");
    expect(o.lines[2]).toContain("ubicación quedó registrada");
    expect(o.callFirst).toBe(false);
  });
  it("singular", () => {
    expect(sosOutcome({ status: "sent", inappNotified: 1 }).lines[0]).toContain(
      "a 1 persona de tu círculo",
    );
    expect(plural(1, "persona", "personas")).toBe("1 persona");
    expect(plural(0, "persona", "personas")).toBe("0 personas");
  });
  it("sin nadie a quien avisar en la app: lo dice y manda a llamar", () => {
    const o = sosOutcome({ status: "sent", inappNotified: 0, hasLocation: false });
    expect(o.tone).toBe("warn");
    expect(o.callFirst).toBe(true);
    expect(o.lines[0]).toContain("Aún no tienes círculo de cuidado");
    expect(o.lines[2]).toContain("No pudimos obtener tu ubicación");
  });
  it("no promete WhatsApp automático si no se confirmó", () => {
    const sin = sosOutcome({ status: "sent", inappNotified: 1 }).lines.join(" ");
    expect(sin).not.toContain("WhatsApp automático");
    const con = sosOutcome({ status: "sent", inappNotified: 1, whatsappAuto: true }).lines.join(
      " ",
    );
    expect(con).toContain("WhatsApp automático");
  });
  it.each(["recent", "limit", "denied", "unavailable", "unknown"] as const)(
    "error %s: aviso y llamar al 123",
    (status: "recent" | "limit" | "denied" | "unavailable" | "unknown") => {
      const o = sosOutcome({ status });
      expect(o.tone).toBe("warn");
      expect(o.callFirst).toBe(true);
      expect(o.lines.join(" ")).toMatch(/123/);
    },
  );
});

const row = (over: Partial<SosAlertRow> = {}): SosAlertRow => ({
  id: "a",
  patient_id: "p",
  patient_name: "Ana R.",
  triggered_by_name: null,
  status: "active",
  lat: 4.6,
  lng: -74.08,
  created_at: "2026-10-12T10:00:00Z",
  acknowledged_by_name: null,
  acknowledged_at: null,
  resolved_at: null,
  notified_whatsapp: false,
  inapp_notified: 2,
  mine: false,
  ...over,
});

describe("lista de alertas SOS", () => {
  it("acciones según el estado (la base impide reabrir)", () => {
    expect(sosActionsFor("active")).toEqual(["acknowledge", "resolve", "false_positive"]);
    expect(sosActionsFor("acknowledged")).toEqual(["resolve", "false_positive"]);
    expect(sosActionsFor("resolved")).toEqual([]);
    expect(sosActionsFor("false_positive")).toEqual([]);
    expect(SOS_ACTION_STATUS).toEqual({
      acknowledge: "acknowledged",
      resolve: "resolved",
      false_positive: "false_positive",
    });
  });
  it("abiertas y activas", () => {
    expect(isSosOpen("active")).toBe(true);
    expect(isSosOpen("acknowledged")).toBe(true);
    expect(isSosOpen("resolved")).toBe(false);
    expect(
      activeSosCount([row(), row({ status: "acknowledged" }), row({ status: "active" })]),
    ).toBe(2);
  });
  it("orden: activas, atendidas, cerradas; y la más reciente primero en cada grupo", () => {
    const rows = [
      row({ id: "1", status: "resolved", created_at: "2026-10-12T12:00:00Z" }),
      row({ id: "2", status: "active", created_at: "2026-10-12T08:00:00Z" }),
      row({ id: "3", status: "acknowledged", created_at: "2026-10-12T09:00:00Z" }),
      row({ id: "4", status: "active", created_at: "2026-10-12T11:00:00Z" }),
    ];
    expect(sortSosAlerts(rows).map((r) => r.id)).toEqual(["4", "2", "3", "1"]);
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3", "4"]); // no muta
  });
  it("hace cuánto", () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    expect(sosAgeLabel("2026-10-12T09:59:40Z", now)).toBe("hace un momento");
    expect(sosAgeLabel("2026-10-12T09:57:00Z", now)).toBe("hace 3 min");
    expect(sosAgeLabel("2026-10-12T07:00:00Z", now)).toBe("hace 3 h");
    expect(sosAgeLabel("2026-10-09T10:00:00Z", now)).toBe("hace 3 d");
    expect(sosAgeLabel("2026-10-12T10:05:00Z", now)).toBe("hace un momento"); // reloj adelantado
    expect(sosAgeLabel("nope", now)).toBe("");
  });
  it("quién la atendió", () => {
    const now = Date.parse("2026-10-12T10:10:00Z");
    expect(sosHandledLine(row(), now)).toBeNull();
    expect(
      sosHandledLine(
        row({
          status: "acknowledged",
          acknowledged_by_name: "Luis G.",
          acknowledged_at: "2026-10-12T10:07:00Z",
        }),
        now,
      ),
    ).toBe("Atendida por Luis G. hace 3 min");
    expect(
      sosHandledLine(
        row({
          status: "false_positive",
          acknowledged_by_name: "Ana R.",
          acknowledged_at: "2026-10-12T10:00:00Z",
          resolved_at: "2026-10-12T10:08:00Z",
        }),
        now,
      ),
    ).toBe("Marcada como falsa alarma por Ana R. hace 2 min");
    expect(
      sosHandledLine(row({ status: "resolved", resolved_at: "2026-10-12T10:09:30Z" }), now),
    ).toBe("Resuelta hace un momento");
  });
});
