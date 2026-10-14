// Qué hacer cuando una lectura esencial falla. En una pantalla clínica, mostrar «0 alertas» porque las alertas no cargaron sería engañar:
// si falta un dato esencial y no hay nada que mostrar, se dice (con «Reintentar»); si solo falló una actualización y hay datos viejos a la
// vista, se avisa sin esconderlos.
interface QueryLike {
  isError: boolean;
  data: unknown;
  error: unknown;
}

/** La primera lectura que falló sin tener nada que mostrar, o null. */
export function blockingProblem(...queries: QueryLike[]): QueryLike | null {
  return queries.find((q) => q.isError && q.data === undefined) ?? null;
}

/** ¿Alguna lectura falló al actualizarse mientras se ven datos anteriores? */
export function hasStaleData(...queries: QueryLike[]): boolean {
  return queries.some((q) => q.isError && q.data !== undefined);
}
