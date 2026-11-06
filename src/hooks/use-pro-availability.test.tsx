import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: { available: false } as { available: boolean } | null,
  updateFails: false,
  pings: [] as Array<() => void>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const ch = {
        on: (_k: string, _o: unknown, cb: () => void) => {
          state.pings.push(cb);
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: async () => undefined,
    from: () => {
      let patch: { available: boolean } | null = null;
      const builder = {
        select: () => builder,
        update: (v: { available: boolean }) => {
          patch = v;
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => {
          if (patch) {
            if (state.updateFails) return { data: null, error: { message: "boom" } };
            if (!state.row) return { data: null, error: null };
            state.row = { ...state.row, ...patch };
          }
          return { data: state.row, error: null };
        },
      };
      return builder;
    },
  },
}));

import { useProAvailability } from "./use-pro-availability";

const PRO = "33333333-3333-3333-3333-333333333333";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProAvailability(PRO), { wrapper });
}

describe("useProAvailability", () => {
  it("guarda el cambio y lo confirma con la fila devuelta", async () => {
    state.row = { available: false };
    state.updateFails = false;
    const hook = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.available).toBe(false);
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.setAvailable(true);
    });
    expect(res).toEqual({ ok: true, available: true });
    expect(hook.result.current.available).toBe(true);
    hook.unmount();
  });

  it("si la base no guarda (error o sin perfil) vuelve al valor anterior", async () => {
    state.row = { available: false };
    state.updateFails = true;
    const hook = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await hook.result.current.setAvailable(true);
    });
    expect(res?.ok).toBe(false);
    expect(hook.result.current.available).toBe(false);

    state.row = null;
    state.updateFails = false;
    const noProfile = setup();
    await waitFor(() => expect(noProfile.result.current.loading).toBe(false));
    expect(noProfile.result.current.hasProfile).toBe(false);
    await act(async () => {
      res = await noProfile.result.current.setAvailable(true);
    });
    expect(res).toEqual({ ok: false, reason: "no_profile" });
    hook.unmount();
    noProfile.unmount();
  });

  it("se actualiza en vivo cuando cambia en otro dispositivo (aviso del mapa)", async () => {
    state.row = { available: false };
    state.updateFails = false;
    state.pings = [];
    const hook = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    state.row = { available: true }; // otro dispositivo lo encendió
    act(() => state.pings.forEach((cb) => cb()));
    await waitFor(() => expect(hook.result.current.available).toBe(true), { timeout: 3000 });
  });
});
