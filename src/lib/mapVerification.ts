// Pines del mapa según el estado documental (`verification_status`) de cada cuenta: profesional, familia o EPS/IPS.
// Lógica pura y probada (`mapVerification.test.ts`); la base decide quién está validado (migración 20261024120000_map_verification.sql).
//
//  - Verificado: pin activo (verde si está disponible, gris si está ocupado o no disponible), con foto y estado.
//  - Documentos pendientes: pin ámbar con ⚠. Al tocarlo se abre un aviso; un profesional pendiente no se puede pedir ni asignar.
//    Una familia o institución pendiente sí deja ver su oferta (verla no es una asignación), con el aviso delante.
import type { VerificationStatus } from "./liveMap";

export type PinTone = "pending" | "available" | "busy";
export type PinKind = "pro" | "family" | "institution";

/** Color del pin: lo documental manda sobre la disponibilidad. */
export function pinTone(p: { verification?: VerificationStatus; dim?: boolean }): PinTone {
  if (p.verification === "pending") return "pending";
  return p.dim ? "busy" : "available";
}

/** Variables de tema (styles.css) para el HTML del marcador de Leaflet, que no admite clases de Tailwind. */
export const PIN_TONE_COLOR: Record<PinTone, string> = {
  pending: "var(--warn)",
  available: "var(--ok)",
  busy: "var(--muted-foreground)",
};

/** ¿Se puede pedir o asignar directamente desde el mapa? */
export function canActFromMap(p: {
  kind: PinKind;
  verification?: VerificationStatus;
  dim?: boolean;
}): boolean {
  if (p.kind === "pro") return p.verification !== "pending" && !p.dim;
  return true;
}

export const HABEAS_DATA_NOTE = "Habeas Data, Ley 1581 de 2012";

export interface PendingDocsCopy {
  title: string;
  body: string;
  /** Acción principal: subir documentos (si es la propia cuenta) o nada. */
  cta: { label: string; to: string } | null;
}

/** Textos del aviso «Documentos pendientes». */
export function pendingDocsCopy(kind: PinKind, isSelf: boolean): PendingDocsCopy {
  if (isSelf) {
    return {
      title: "Tu perfil está en revisión",
      body: `Tu perfil está en revisión de documentos (${HABEAS_DATA_NOTE} / soportes legales). Sube tus documentos faltantes para activar servicios inmediatos.`,
      cta: {
        label: "Subir mis documentos",
        to:
          kind === "pro"
            ? "/dashboard/profesional"
            : kind === "institution"
              ? "/dashboard/institucion"
              : "/dashboard/familia",
      },
    };
  }
  if (kind === "pro") {
    return {
      title: "Documentos en revisión",
      body: `Este perfil está en revisión de documentos (${HABEAS_DATA_NOTE} / soportes legales). Todavía no se puede pedir ni asignar: cuando sus soportes queden validados aparecerá en verde y podrás pedirlo al instante.`,
      cta: null,
    };
  }
  return {
    title: kind === "institution" ? "Institución sin validar" : "Familia sin validar",
    body: `${kind === "institution" ? "Esta institución" : "Esta familia"} aún no completa sus documentos (${HABEAS_DATA_NOTE} / soportes legales). Puedes ver la oferta, pero confirma los datos antes de aceptar el servicio.`,
    cta: null,
  };
}
