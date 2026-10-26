import logoImage from "@/assets/logo-humanix.webp";

export function Logo({
  className = "",
  wordmarkClassName = "",
}: {
  className?: string;
  /** Clases para el texto "Humanix" (p. ej. ocultarlo en móvil). */
  wordmarkClassName?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img
        src={logoImage}
        alt=""
        aria-hidden="true"
        width={40}
        height={38}
        className="h-10 w-auto shrink-0 select-none drop-shadow-sm"
        draggable={false}
      />
      <span className={`font-display text-xl font-bold tracking-tight ${wordmarkClassName}`}>
        Human<span className="text-biosensor">i</span>x
      </span>
    </div>
  );
}
