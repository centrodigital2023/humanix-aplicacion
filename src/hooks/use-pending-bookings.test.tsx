import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; status: string; professional_id: string }>,
  refresh: undefined as (() => void) | undefined,
}));
vi.mock("@/hooks/use-realtime-refresh", () => ({
  useRealtimeRefresh: (_name: string, _tables: unknown, refresh: () => void) => { state.refresh = refresh; },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => {
    const filters: Record<string, string> = {};
    const builder = {
      select: () => builder,
      eq: (key: string, value: string) => { filters[key] = value; return builder; },
      order: async () => ({ data: state.rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k as keyof typeof row] === v)), error: null }),
    };
    return builder;
  } },
}));
import { usePendingBookings } from "./use-pending-bookings";

describe("direct service requests", () => {
  it("shows only pending requests for the recipient and reads new requests after a live change", async () => {
    state.rows = [
      { id: "request-1", status: "pending", professional_id: "pro-1" },
      { id: "other-recipient", status: "pending", professional_id: "pro-2" },
      { id: "confirmed", status: "confirmed", professional_id: "pro-1" },
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => usePendingBookings("pro-1"), { wrapper });
    await waitFor(() => expect(hook.result.current.data?.map((r) => r.id)).toEqual(["request-1"]));
    state.rows.push({ id: "request-2", status: "pending", professional_id: "pro-1" });
    act(() => state.refresh?.());
    await waitFor(() => expect(hook.result.current.data?.map((r) => r.id)).toEqual(["request-1", "request-2"]));
    state.rows[0] = { id: "request-1", status: "cancelled", professional_id: "pro-1" };
    act(() => state.refresh?.());
    await waitFor(() => expect(hook.result.current.data?.map((r) => r.id)).toEqual(["request-2"]));
    hook.unmount();
    client.clear();
  });
});