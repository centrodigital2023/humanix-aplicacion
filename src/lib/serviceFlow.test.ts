import { describe, expect, it } from "vitest";
import {
  flowSentence,
  isContactUnlocked,
  isRecent,
  liveAlertFromBooking,
  liveAlertFromNotification,
  nextProfessionalAction,
  pushAlert,
  type NotificationRow,
} from "./serviceFlow";

const BOOKING = "b4fc3e8c-f0ca-42b3-b395-db28a82b8c35";

const notif = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "n1",
  type: "booking_requested",
  title: "Nueva solicitud de servicio",
  body: "Una familia te pide un turno de 24 h por $240.000 (pago directo al terminar).",
  link: `/servicio/${BOOKING}`,
  meta: { booking_id: BOOKING, origin: "family" },
  created_at: "2026-10-24T15:58:08Z",
  ...over,
});

describe("isContactUnlocked", () => {
  it("abre chat y llamada solo desde que el profesional acepta", () => {
    expect(isContactUnlocked("pending")).toBe(false);
    expect(isContactUnlocked("cancelled")).toBe(false);
    for (const s of ["confirmed", "in_route", "in_progress", "completed"]) {
      expect(isContactUnlocked(s)).toBe(true);
    }
  });
});

describe("nextProfessionalAction", () => {
  it("recorre Pedido → Aceptado → En camino → Cuidando → Terminado", () => {
    expect(nextProfessionalAction("pending")?.next).toBe("confirmed");
    expect(nextProfessionalAction("confirmed")).toMatchObject({
      next: "in_route",
      stamp: "started_at",
    });
    expect(nextProfessionalAction("in_route")).toMatchObject({
      next: "in_progress",
      stamp: "arrived_at",
    });
    expect(nextProfessionalAction("in_progress")).toMatchObject({
      next: "completed",
      needsDialog: true,
    });
    expect(nextProfessionalAction("completed")).toBeNull();
    expect(nextProfessionalAction("cancelled")).toBeNull();
  });
});

describe("flowSentence", () => {
  it("le habla a la familia como siempre", () => {
    expect(flowSentence("pending", "client", "Nixon Paz")).toBe("Esperando que Nixon acepte");
    expect(flowSentence("confirmed", "viewer", "Nixon Paz")).toBe("Nixon aceptó tu pedido");
  });
  it("le habla al profesional en su papel y nombra a la EPS/IPS", () => {
    expect(flowSentence("pending", "professional", "Ana", "institution")).toBe(
      "La EPS/IPS te pidió este servicio. ¿Lo aceptas?",
    );
    expect(flowSentence("pending", "professional", "Ana", "family")).toMatch(/^La familia/);
    expect(flowSentence("pending", "professional", "Ana")).toBe(
      "Te pidieron este servicio. ¿Lo aceptas?",
    );
    expect(flowSentence("in_progress", "professional", "Ana")).toMatch(/parte del turno/);
  });
});

describe("liveAlertFromNotification", () => {
  it("convierte la solicitud en alerta fija con botón de aceptar", () => {
    const a = liveAlertFromNotification(notif());
    expect(a).toMatchObject({
      key: `request:${BOOKING}`,
      tone: "request",
      sticky: true,
      bookingId: BOOKING,
    });
  });
  it("saca la reserva del enlace si el aviso viejo no trae meta", () => {
    expect(liveAlertFromNotification(notif({ meta: null }))?.bookingId).toBe(BOOKING);
  });
  it("avisa a la familia o EPS/IPS cuando aceptan, sin botón de aceptar", () => {
    const a = liveAlertFromNotification(notif({ type: "booking_accepted", id: "n2" }));
    expect(a).toMatchObject({ key: "n:n2", tone: "good", sticky: true });
    expect(a?.bookingId).toBeUndefined();
  });
  it("las alertas del parte son de tono alerta", () => {
    expect(liveAlertFromNotification(notif({ type: "care_alert" }))?.tone).toBe("alert");
  });
  it("ignora avisos que no deben interrumpir", () => {
    expect(liveAlertFromNotification(notif({ type: "kudos_received" }))).toBeNull();
    expect(liveAlertFromNotification(notif({ type: "payment_rejected" }))).toBeNull();
  });
});

describe("liveAlertFromBooking", () => {
  it("comparte clave con el aviso para no mostrarse dos veces", () => {
    const fromBooking = liveAlertFromBooking({
      id: BOOKING,
      duration_hours: 24,
      total_amount: 240000,
      payment_mode: "direct_to_professional",
      created_at: "2026-10-24T15:58:08Z",
    });
    expect(fromBooking.key).toBe(liveAlertFromNotification(notif())?.key);
    expect(fromBooking.body).toContain("24 h");
    expect(fromBooking.body).toMatch(/240\.000/);
    expect(fromBooking.body).toContain("pago directo al terminar");
  });
});

describe("pushAlert", () => {
  const a = liveAlertFromNotification(notif())!;
  const b = { ...a, key: "n:2" };
  const c = { ...a, key: "n:3" };
  const d = { ...a, key: "n:4" };
  it("no duplica ni revive descartadas", () => {
    expect(pushAlert([a], a, new Set())).toHaveLength(1);
    expect(pushAlert([], a, new Set([a.key]))).toHaveLength(0);
  });
  it("pone la más nueva arriba y respeta el máximo", () => {
    const stack = [b, c, d].reduce((s, x) => pushAlert(s, x, new Set()), [a]);
    expect(stack.map((x) => x.key)).toEqual(["n:4", "n:3", "n:2"]);
  });
});

describe("isRecent", () => {
  const now = Date.parse("2026-10-24T16:00:00Z");
  it("recupera lo de los últimos 15 minutos al reconectar", () => {
    expect(isRecent("2026-10-24T15:50:00Z", now)).toBe(true);
    expect(isRecent("2026-10-24T15:30:00Z", now)).toBe(false);
    expect(isRecent("no-es-fecha", now)).toBe(false);
  });
});
