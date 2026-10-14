// Iniciales con un color estable por persona (sale del identificador, no revela nada).
import { avatarTone, initials } from "@/lib/instCare";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

const SIZE = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

export function PersonAvatar({
  name,
  id,
  size = "md",
  className,
}: {
  name: string;
  id: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const t = TONE[avatarTone(id)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-2xl font-display font-bold",
        SIZE[size],
        t.soft,
        t.text,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
