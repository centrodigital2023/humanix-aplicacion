import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";

/**
 * Proveedor de TanStack Query para toda la app. `useState` crea el cliente una vez por montaje:
 * en el servidor eso es uno por petición (sin compartir datos entre usuarios) y en el navegador
 * persiste mientras dure la sesión.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
