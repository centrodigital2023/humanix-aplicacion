import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ProWelcome } from "./ProWelcome";

const base = {
  userId: "u1",
  name: "Ana María Pérez",
  avatarUrl: null,
  specialty: "",
  cities: "",
  hourlyRate: "" as const,
  docs: {},
  available: false,
  togglingAvailable: false,
  onAvatar: vi.fn(),
  onToggleAvailable: vi.fn(),
  onGoDocs: vi.fn(),
  onGoOffers: vi.fn(),
  onClose: vi.fn(),
  onLogout: vi.fn(),
};

it("saluda por el nombre, muestra el avance y abre el primer paso pendiente", () => {
  render(<ProWelcome {...base} onSaveWork={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "¡Hola, Ana!" })).toBeTruthy();
  expect(screen.getByText("0 de 4 listos")).toBeTruthy();
  expect((document.getElementById("bienvenida-foto") as HTMLDetailsElement).open).toBe(true);
  expect((document.getElementById("bienvenida-trabajo") as HTMLDetailsElement).open).toBe(false);
});

it("guarda especialidad, ciudad y tarifa desde el paso 2", async () => {
  const onSaveWork = vi.fn().mockResolvedValue(true);
  render(<ProWelcome {...base} avatarUrl="https://x/foto.jpg" onSaveWork={onSaveWork} />);
  expect((document.getElementById("bienvenida-trabajo") as HTMLDetailsElement).open).toBe(true);
  const save = screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Fisioterapia" }));
  fireEvent.change(screen.getByLabelText("Ciudad"), { target: { value: "Pasto" } });
  fireEvent.change(screen.getByLabelText("Tarifa por hora"), { target: { value: "30000" } });
  fireEvent.click(save);
  expect(onSaveWork).toHaveBeenCalledWith({
    specialty: "Fisioterapia",
    city: "Pasto",
    hourly: 30000,
  });
});

it("celebra al completar los cuatro pasos y los botones llevan al panel", () => {
  const onGoOffers = vi.fn();
  const onClose = vi.fn();
  render(
    <ProWelcome
      {...base}
      avatarUrl="https://x/foto.jpg"
      specialty="Enfermería"
      cities="Cali"
      hourlyRate={25000}
      docs={{ id_document: true, rethus: true, cv: true }}
      available
      onSaveWork={vi.fn()}
      onGoOffers={onGoOffers}
      onClose={onClose}
    />,
  );
  expect(screen.getByText("4 de 4 listos")).toBeTruthy();
  expect(screen.getByText(/¡Listo! Ya puedes recibir trabajo/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ver trabajos para mí" }));
  fireEvent.click(screen.getByRole("button", { name: "Ir a mi panel" }));
  expect(onGoOffers).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});
