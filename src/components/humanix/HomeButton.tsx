// Botón "🏠 Inicio" único y visible en todas las pantallas: imagen + palabra,
// grande y en el mismo lugar, para que nadie se pierda (incluso sin leer).
import { Link } from "@tanstack/react-router";

export function HomeButton({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Volver al inicio"
      className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-card px-4 text-base font-bold text-foreground shadow-sm ring-1 ring-border transition hover:shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 ${className}`}
    >
      <span aria-hidden="true" className="text-xl leading-none">
        🏠
      </span>
      Inicio
    </Link>
  );
}
