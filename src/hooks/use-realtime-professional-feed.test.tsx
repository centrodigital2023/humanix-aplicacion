import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type Handler = (payload: { new: Record<string, unknown> }) => void;

const state = vi.hoisted(() => ({
  handlers: [] as Array<{ table: string; event: string; filter: string; cb: Handler }>,
  onStatus: undefined as ((s: string) => void) | undefined,
  tables: {
    notifications: [] as Array<Record<string, unknown>>,
    service_bookings: [] as Array<Record<string, unknown>>,
  },
  sounds: [] as string[],
  removed: 0,
}));

vi.mock("@/lib/alertSound", () => ({
  playAlertSound: (tone: string) => state.sounds.push(tone),
  showSystemNotification: () => {},
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const ch = {
        on: (
          _kind: string,
          opts: { table: string; event: string; filter: string },
          cb: Handler,
        ) => {
          state.handlers.push({ ...opts, cb });
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          state.onStatus = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => {
      state.removed += 1;
    },
    from: (table: "notifications" | "service_bookings") => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return builder;
        },
        is: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: async () => ({
          data: state.tables[table].filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          ),
          error: null,
        }),
      };
      return builder;
    },
  },
}));

import { useRealtimeProfessionalFeed } from "./use-realtime-professional-feed";

const NIXON = "33333333-3333-3333-3333-333333333333";
const BOOKING = "b4fc3e8c-f0ca-42b3-b395-db28a82b8c35";

function fire(table: string, event: string, row: Record<string, unknown>) {
  for (const h of state.handlers.filter((x) => x.table === table && x.event === event)) {
    h.cb({ new: row });
  }
}

function setup(isProfessional = true) {
  state.handlers = [];
  state.sounds = [];
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRealtimeProfessionalFeed(NIXON, isProfessional), { wrapper });
}

describe("useRealtimeProfessionalFeed", () => {
  it("muestra la solicitud al instante, una sola vez, y la quita cuando deja de estar pendiente", () => {
    sessionStorage.clear();
    state.tables.notifications = [];
    state.tables.service_bookings = [];
    const hook = setup();
    expect(state.handlers.map((h) => `${h.table}:${h.event}:${h.filter}`)).toEqual([
      `notifications:INSERT:user_id=eq.${NIXON}`,
      `service_bookings:INSERT:professional_id=eq.${NIXON}`,
      `service_bookings:UPDATE:professional_id=eq.${NIXON}`,
    ]);

    act(() =>
      fire("service_bookings", "INSERT", {
        id: BOOKING,
        status: "pending",
        duration_hours: 24,
        total_amount: 240000,
        payment_mode: "direct_to_professional",
        created_at: new Date().toISOString(),
      }),
    );
    act(() =>
      fire("notifications", "INSERT", {
        id: "n1",
        type: "booking_requested",
        title: "Nueva solicitud de servicio",
        body: "Una familia te pide un turno de 24 h por $240.000 (pago directo al terminar).",
        link: `/servicio/${BOOKING}`,
        meta: { booking_id: BOOKING },
        created_at: new Date().toISOString(),
      }),
    );
    expect(hook.result.current.alerts).toHaveLength(1);
    expect(hook.result.current.alerts[0]).toMatchObject({ bookingId: BOOKING, tone: "request" });
    expect(state.sounds).toEqual(["request"]);

    act(() => fire("service_bookings", "UPDATE", { id: BOOKING, status: "confirmed" }));
    expect(hook.result.current.alerts).toHaveLength(0);
    hook.unmount();
    expect(state.removed).toBeGreaterThan(0);
  });

  it("al conectarse recupera solicitudes pendientes que llegaron antes", async () => {
    sessionStorage.clear();
    state.tables.notifications = [];
    state.tables.service_bookings = [
      {
        id: BOOKING,
        professional_id: NIXON,
        status: "pending",
        duration_hours: 24,
        total_amount: 240000,
        created_at: "2026-10-24T15:58:08Z",
      },
    ];
    const hook = setup();
    act(() => state.onStatus?.("SUBSCRIBED"));
    await waitFor(() => expect(hook.result.current.alerts).toHaveLength(1));
    // Vieja: se muestra pero no suena (ya pasó su momento).
    expect(state.sounds).toEqual([]);

    act(() => hook.result.current.dismiss(`request:${BOOKING}`));
    expect(hook.result.current.alerts).toHaveLength(0);
    act(() => state.onStatus?.("SUBSCRIBED"));
    await new Promise((r) => setTimeout(r, 10));
    expect(hook.result.current.alerts).toHaveLength(0);
    hook.unmount();
  });

  it("la familia o la EPS/IPS solo escucha sus avisos y ve cuando aceptan", () => {
    sessionStorage.clear();
    const hook = setup(false);
    expect(state.handlers.map((h) => h.table)).toEqual(["notifications"]);
    act(() =>
      fire("notifications", "INSERT", {
        id: "n2",
        type: "booking_accepted",
        title: "Nixon P. aceptó el servicio",
        body: "Ya puedes escribirle y llamarle desde la página del servicio.",
        link: `/servicio/${BOOKING}`,
        created_at: new Date().toISOString(),
      }),
    );
    expect(hook.result.current.alerts[0]).toMatchObject({
      tone: "good",
      title: "Nixon P. aceptó el servicio",
    });
    expect(state.sounds).toEqual(["good"]);
    hook.unmount();
  });
});
