export const MODALITY_LABEL: Record<string, string> = {
  hour: "por hora",
  shift: "por turno",
  month: "por mes",
  package: "paquete",
};

export const SAFETY_LABEL: Record<string, string> = {
  self_harm: "Riesgo personal",
  medical_emergency: "Emergencia médica",
  physical_harm: "Daño físico",
  harassment: "Acoso o abuso",
  theft: "Hurto",
  fraud: "Posible fraude",
  off_platform_payment: "Pago fuera de la plataforma",
};

export const TOPIC_LABEL: Record<string, string> = {
  facturacion: "Facturación",
  pagos: "Pagos",
  servicio: "Servicio",
  conducta_profesional: "Conducta profesional",
  seguridad: "Seguridad",
  fraude: "Fraude",
  soporte_tecnico: "Soporte técnico",
  cuenta: "Cuenta",
  datos_personales: "Datos personales",
  otro: "Otro",
};

export const TYPE_LABEL: Record<string, string> = {
  peticion: "Petición",
  consulta: "Consulta",
  queja: "Queja",
  reclamo: "Reclamo",
  sugerencia: "Sugerencia",
  denuncia: "Denuncia",
};

export const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
};
export const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Positivo",
  neutral: "Neutral",
  negative: "Negativo",
  very_negative: "Muy negativo",
};
export const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  in_progress: "En trámite",
  resolved: "Resuelto",
  closed: "Cerrado",
};

export const formatCOP = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const text =
    m < 1
      ? "un momento"
      : m < 60
        ? `${m} min`
        : m < 60 * 24
          ? `${Math.round(m / 60)} h`
          : `${Math.round(m / 1440)} d`;
  return diff >= 0 ? `hace ${text}` : `en ${text}`;
}

export function formatHours(h: number | null): string {
  if (h === null) return "Datos insuficientes";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1).replace(".", ",")} h`;
  return `${(h / 24).toFixed(1).replace(".", ",")} d`;
}

export const formatPct = (r: number | null) =>
  r === null ? "Datos insuficientes" : `${Math.round(r * 100)}%`;

export const shortDate = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "short",
        timeZone: "America/Bogota",
      })
    : "—";

export const initials = (name: string | null | undefined) =>
  (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
