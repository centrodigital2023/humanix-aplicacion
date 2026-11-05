// Efectivo tipo InDrive: la solicitud ofrece «Recargar y aceptar» cuando la billetera no alcanza, y la billetera muestra lo
// apartado, lo libre y el aviso de saldo bajo. La base decide (migración 20261104170000); aquí se prueba la pantalla.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const wallet = {
  balance_cop: 0,
  credit_limit_cop: -30_000,
  available_cop: 30_000,
  blocked: false,
  completed_30d: 3,
  commission_pct: 15,
  reserved_cop: 30_000,
  free_cop: 0,
  health: "low",
};
const pending = [
  {
    id: "b-cash",
    scheduled_at: "2026-11-05T14:00:00Z",
    duration_hours: 4,
    total_amount: 100_000,
    payment_method: "CASH",
    platform_fee_amount: 15_000,
    created_at: "2026-11-04T16:00:00Z",
  },
  {
    id: "b-breb",
    scheduled_at: "2026-11-05T14:00:00Z",
    duration_hours: 4,
    total_amount: 100_000,
    payment_method: "DIGITAL_BREB",
    platform_fee_amount: 15_000,
    created_at: "2026-11-04T16:00:00Z",
  },
];

function chain(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r);
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: [wallet], error: null })),
    from: vi.fn(() => chain([])),
  },
}));
vi.mock("@/hooks/use-realtime-refresh", () => ({ useRealtimeRefresh: () => undefined }));
vi.mock("@/hooks/use-pending-bookings", () => ({
  usePendingBookings: () => ({ isLoading: false, error: null, data: pending, refetch: vi.fn() }),
  acceptPendingBooking: vi.fn(async () => true),
}));
vi.mock("@/lib/payments.functions", () => ({ topupWallet: vi.fn() }));
vi.mock("./PaySheet", () => ({
  PaySheet: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/humanix/payments/PaySheet", () => ({
  PaySheet: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}));

import { PendingBookingRequests } from "@/components/humanix/pro/PendingBookingRequests";
import { WalletCard } from "./WalletCard";

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

beforeEach(() => {
  Object.assign(wallet, {
    balance_cop: 0,
    reserved_cop: 30_000,
    free_cop: 0,
    health: "low",
    blocked: false,
  });
});

it("si la billetera no alcanza para el efectivo, ofrece recargar y aceptar; el turno por Bre-B se acepta normal", async () => {
  wrap(<PendingBookingRequests userId="pro-1" />);
  const topup = await screen.findByRole("button", { name: /Recargar \$\s?15\.000 y aceptar/ });
  expect(screen.getByText(/Te faltan \$\s?15\.000 en tu billetera/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Aceptar" })).toHaveLength(1);
  fireEvent.click(topup);
  expect(screen.getByRole("dialog").textContent).toBe("Recargar y aceptar");
});

it("con cupo libre, los dos se aceptan con un toque", async () => {
  Object.assign(wallet, { reserved_cop: 0, free_cop: 30_000, health: "ok" });
  wrap(<PendingBookingRequests userId="pro-1" />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Aceptar" })).toHaveLength(2));
});

it("la billetera muestra lo apartado, el aviso de saldo bajo y la recarga para quedar al día", async () => {
  wrap(<WalletCard userId="pro-1" />);
  expect(await screen.findByText("Apartado")).toBeTruthy();
  expect(screen.getByText(/Te queda poco para aceptar turnos en efectivo/)).toBeTruthy();
  // Libre $0 de un cupo de $30.000 → sugiere $30.000.
  expect(
    screen.getByRole("button", { name: /Recargar \$\s?30\.000 y quedar al día/ }),
  ).toBeTruthy();
});

it("bloqueada: pide desbloquear con lo que falta", async () => {
  Object.assign(wallet, {
    balance_cop: -42_500,
    reserved_cop: 0,
    free_cop: 0,
    health: "blocked",
    blocked: true,
  });
  wrap(<WalletCard userId="pro-1" />);
  expect(
    await screen.findByRole("button", { name: /Recargar \$\s?13\.000 y desbloquear/ }),
  ).toBeTruthy();
  expect(screen.getByText(/Pasaste el cupo/)).toBeTruthy();
});
