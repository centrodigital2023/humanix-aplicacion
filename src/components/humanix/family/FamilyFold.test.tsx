import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FamilyFold } from "./FamilyFold";
import { scrollToId } from "@/components/humanix/premium/scroll";

it("monta el contenido solo al abrir la fila y lo conserva al cerrarla", () => {
  render(
    <FamilyFold id="fold-x" emoji="📅" title="Mi agenda" hint="Marca horas">
      <p>contenido</p>
    </FamilyFold>,
  );
  expect(screen.queryByText("contenido")).toBeNull();
  const details = document.getElementById("fold-x") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByText("contenido")).toBeTruthy();
  details.open = false;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByText("contenido")).toBeTruthy();
});

it("scrollToId abre la fila que anuncia la sección y baja a ella", async () => {
  vi.useFakeTimers();
  const scroll = vi.fn();
  window.scrollTo = scroll as unknown as typeof window.scrollTo;
  render(
    <FamilyFold id="fold-datos" emoji="👤" title="Mis datos" hint="Datos" anchors={["mis-datos"]}>
      <div id="mis-datos">formulario</div>
    </FamilyFold>,
  );
  const details = document.getElementById("fold-datos") as HTMLDetailsElement;
  // jsdom no dispara «toggle» al cambiar `open`: lo simulamos como el navegador.
  const origOpen = Object.getOwnPropertyDescriptor(HTMLDetailsElement.prototype, "open")!;
  Object.defineProperty(details, "open", {
    get: () => origOpen.get!.call(details),
    set: (v: boolean) => {
      origOpen.set!.call(details, v);
      details.dispatchEvent(new Event("toggle"));
    },
  });

  scrollToId("mis-datos");
  expect(details.open).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByText("formulario")).toBeTruthy();
  expect(scroll).toHaveBeenCalled();
  vi.useRealTimers();
});
