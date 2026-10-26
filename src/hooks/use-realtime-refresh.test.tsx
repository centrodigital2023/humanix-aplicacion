import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  status: undefined as ((status: string) => void) | undefined,
  event: undefined as (() => void) | undefined,
  remove: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (_kind: string, _filter: unknown, callback: () => void) => {
          mock.event = callback;
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          mock.status = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: mock.remove,
  },
}));
import { useRealtimeRefresh } from "./use-realtime-refresh";
it("refreshes after subscribing, live changes and reconnecting, then removes the channel", () => {
  const refresh = vi.fn();
  const hook = renderHook(() =>
    useRealtimeRefresh("requests", [{ table: "service_bookings" }], refresh),
  );
  act(() => mock.status?.("SUBSCRIBED"));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => mock.event?.());
  expect(refresh).toHaveBeenCalledTimes(2);
  act(() => mock.status?.("SUBSCRIBED"));
  expect(refresh).toHaveBeenCalledTimes(3);
  hook.unmount();
  expect(mock.remove).toHaveBeenCalledTimes(1);
});
