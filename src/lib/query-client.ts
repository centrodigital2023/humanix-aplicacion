import { QueryClient } from "@tanstack/react-query";

/** Un cliente por sesión del navegador (y uno por petición en el servidor, ver AppQueryProvider). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}
