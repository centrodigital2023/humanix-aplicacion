// Insignia del Trust Score: el número, el nivel y, al tocarla, de dónde sale. Nunca inventa nada: si la base no trae puntaje
// dice «Sin validar»; si la cuenta es nueva dice «Nuevo».
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  trustBadgeText,
  trustTone,
  type TrustKind,
  type TrustSummary,
  type TrustTone,
} from "@/lib/trustScore";

const TONE_CLASS: Record<TrustTone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  trust: "border-trust/40 bg-trust/10 text-trust",
  warn: "border-warn/40 bg-warn/10 text-warn",
  muted: "border-border bg-muted text-muted-foreground",
};

const EXPLAIN: Record<TrustKind, string> = {
  professional:
    "El Trust Score del profesional (0–100) sube con las calificaciones de familias e instituciones, los servicios completados, su cédula, su RETHUS verificado, su perfil validado y la antigüedad. «Nuevo» significa que aún tiene pocas calificaciones o servicios: no es una mala señal por sí sola.",
  family:
    "El Trust Score de la familia (0–100) sube con las calificaciones de profesionales, los servicios completados, la identidad entregada y la antigüedad. «Nuevo» significa que aún tiene pocas calificaciones o servicios.",
  institution:
    "El Trust Score de la institución (0–100) sube con su verificación (NIT y cámara de comercio), las calificaciones de profesionales, los servicios completados y la antigüedad. «Nuevo» significa que aún tiene pocos servicios.",
};

export function TrustBadge({
  summary,
  kind,
  className,
}: {
  summary: TrustSummary;
  kind: TrustKind;
  className?: string;
}) {
  const level = summary.score == null ? "unrated" : summary.level;
  const tone = summary.score != null && !summary.enough ? "muted" : trustTone(level);
  const Icon = summary.score == null ? ShieldQuestion : ShieldCheck;
  const text = trustBadgeText(summary);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Trust Score: ${text}. Toca para ver qué significa.`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            TONE_CLASS[tone],
            className,
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span>{text}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs leading-relaxed" align="start">
        <p className="mb-1 font-semibold">Trust Score: {text}</p>
        <p className="text-muted-foreground">{EXPLAIN[kind]}</p>
      </PopoverContent>
    </Popover>
  );
}
