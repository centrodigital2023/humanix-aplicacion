import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const realtime = vi.hoisted(() => ({
  channels: [] as Array<{ topic: string; private: boolean; handlers: Record<string, () => void>; status?: (status: string) => void }>,
  remove: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (topic: string, options: { config: { private: boolean } }) => {
      const record = { topic, private: options.config.private, handlers: {} as Record<string, () => void>, status: undefined as ((status: string) => void) | undefined };
      realtime.channels.push(record);
      const channel = {
        on: (_type: string, filter: { event: string }, handler: () => void) => {
          record.handlers[filter.event] = handler;
          return channel;
        },
        subscribe: (status: (status: string) => void) => {
          record.status = status;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: realtime.remove,
  },
}));

import { useLiveMapRefresh } from "./use-live-map";

afterEach(() => {
  realtime.channels.length = 0;
  realtime.remove.mockClear();
});

describe("map realtime subscriptions", () => {
  it("shares one public signal channel and refreshes anonymous viewers on movement and reconnect", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const first = renderHook(() => useLiveMapRefresh(false), { wrapper });
    const second = renderHook(() => useLiveMapRefresh(false), { wrapper });
    expect(realtime.channels).toHaveLength(1);
    const channel = realtime.channels[0];
    expect(channel).toMatchObject({ topic: "live_map_public_ping", private: false });
    act(() => { channel?.handlers.map_changed?.(); channel?.handlers.map_changed?.(); });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["live-map"] });
    act(() => channel?.status?.("SUBSCRIBED"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2), { timeout: 1500 });
    first.unmount();
    expect(realtime.remove).not.toHaveBeenCalled();
    second.unmount();
    expect(realtime.remove).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("retains the private channel for signed-in viewers and does not subscribe when disabled", () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const disabled = renderHook(() => useLiveMapRefresh(false, false), { wrapper });
    expect(realtime.channels).toHaveLength(0);
    const authed = renderHook(() => useLiveMapRefresh(true), { wrapper });
    expect(realtime.channels[0]).toMatchObject({ topic: "live_map_ping", private: true });
    authed.unmount();
    disabled.unmount();
    client.clear();
  });
});