/** Fecha larga en hora de Colombia, p. ej. «martes, 27 de octubre de 2026». */
export const formatLongDate = (iso: string | null | undefined): string | null =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Bogota",
      })
    : null;
