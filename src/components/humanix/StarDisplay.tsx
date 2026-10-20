// Estrellas de solo lectura (0 a 5) para mostrar una calificación.
import { Star } from "lucide-react";

export function StarDisplay({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const sz = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <div className="flex gap-0.5" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${sz} ${
            n <= value ? "fill-copper text-copper" : "fill-transparent text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}
