// Tonos de color → clases de Tailwind. Las clases van completas y escritas aquí (Tailwind solo genera las que ve en el código), con los
// tokens semánticos del tema (nada de colores sueltos): así el tema claro y el oscuro siguen funcionando.
import type { Tone } from "@/lib/instCareTypes";

export interface ToneClasses {
  /** Texto del color. */
  text: string;
  /** Fondo sólido. */
  solid: string;
  /** Fondo suave (10 %). */
  soft: string;
  /** Borde suave. */
  border: string;
  /** Anillo (ring) suave. */
  ring: string;
  /** Trazo de un SVG. */
  stroke: string;
  /** Relleno de un SVG. */
  fill: string;
  /** Degradado suave de fondo para una tarjeta. */
  wash: string;
  /** Etiqueta (chip): fondo suave, texto y borde. */
  chip: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  ok: {
    text: "text-ok",
    solid: "bg-ok",
    soft: "bg-ok/10",
    border: "border-ok/30",
    ring: "ring-ok/30",
    stroke: "stroke-ok",
    fill: "fill-ok",
    wash: "from-ok/10 via-card to-card",
    chip: "bg-ok/10 text-ok border-ok/30",
  },
  trust: {
    text: "text-trust",
    solid: "bg-trust",
    soft: "bg-trust/10",
    border: "border-trust/30",
    ring: "ring-trust/30",
    stroke: "stroke-trust",
    fill: "fill-trust",
    wash: "from-trust/10 via-card to-card",
    chip: "bg-trust/10 text-trust border-trust/30",
  },
  warn: {
    text: "text-warn",
    solid: "bg-warn",
    soft: "bg-warn/10",
    border: "border-warn/30",
    ring: "ring-warn/30",
    stroke: "stroke-warn",
    fill: "fill-warn",
    wash: "from-warn/10 via-card to-card",
    chip: "bg-warn/10 text-warn border-warn/30",
  },
  sos: {
    text: "text-sos",
    solid: "bg-sos",
    soft: "bg-sos/10",
    border: "border-sos/30",
    ring: "ring-sos/40",
    stroke: "stroke-sos",
    fill: "fill-sos",
    wash: "from-sos/10 via-card to-card",
    chip: "bg-sos/10 text-sos border-sos/30",
  },
  copper: {
    text: "text-copper",
    solid: "bg-copper",
    soft: "bg-copper/10",
    border: "border-copper/30",
    ring: "ring-copper/30",
    stroke: "stroke-copper",
    fill: "fill-copper",
    wash: "from-copper/10 via-card to-card",
    chip: "bg-copper/10 text-copper border-copper/30",
  },
  biosensor: {
    text: "text-biosensor",
    solid: "bg-biosensor",
    soft: "bg-biosensor/10",
    border: "border-biosensor/30",
    ring: "ring-biosensor/30",
    stroke: "stroke-biosensor",
    fill: "fill-biosensor",
    wash: "from-biosensor/10 via-card to-card",
    chip: "bg-biosensor/10 text-biosensor border-biosensor/30",
  },
  fuchsia: {
    text: "text-fuchsia-neural",
    solid: "bg-fuchsia-neural",
    soft: "bg-fuchsia-neural/10",
    border: "border-fuchsia-neural/30",
    ring: "ring-fuchsia-neural/30",
    stroke: "stroke-fuchsia-neural",
    fill: "fill-fuchsia-neural",
    wash: "from-fuchsia-neural/10 via-card to-card",
    chip: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/30",
  },
  muted: {
    text: "text-muted-foreground",
    solid: "bg-muted-foreground",
    soft: "bg-muted",
    border: "border-border",
    ring: "ring-border",
    stroke: "stroke-muted-foreground",
    fill: "fill-muted-foreground",
    wash: "from-muted/60 via-card to-card",
    chip: "bg-muted text-muted-foreground border-border",
  },
};
