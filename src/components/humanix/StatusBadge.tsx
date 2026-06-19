import { Circle } from "lucide-react";

type Status = "available" | "reserved" | "busy" | "open" | "filled" | "closed";

const MAP: Record<Status, { label: string; cls: string; dot: string }> = {
  available: {
    label: "Disponible",
    cls: "bg-biosensor/10 text-biosensor border-biosensor/30",
    dot: "bg-biosensor",
  },
  open: {
    label: "Disponible",
    cls: "bg-biosensor/10 text-biosensor border-biosensor/30",
    dot: "bg-biosensor",
  },
  reserved: {
    label: "Tomado",
    cls: "bg-cyber/15 text-cyber border-cyber/40 dark:text-cyber-foreground",
    dot: "bg-cyber",
  },
  filled: {
    label: "Tomado",
    cls: "bg-cyber/15 text-cyber border-cyber/40 dark:text-cyber-foreground",
    dot: "bg-cyber",
  },
  busy: {
    label: "Ocupado",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  closed: {
    label: "Cerrada",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export function StatusBadge({
  status,
  reservedUntil,
  size = "sm",
}: {
  status: Status;
  reservedUntil?: string | null;
  size?: "sm" | "md";
}) {
  const cfg = MAP[status];
  const days =
    reservedUntil && (status === "reserved" || status === "filled")
      ? Math.max(0, Math.ceil((new Date(reservedUntil).getTime() - Date.now()) / 86_400_000))
      : null;

  const padding = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wider ${cfg.cls} ${padding}`}
    >
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${cfg.dot}`}>
        {(status === "available" || status === "open") && (
          <span className={`absolute inset-0 rounded-full ${cfg.dot} animate-ping opacity-60`} />
        )}
      </span>
      {cfg.label}
      {days !== null && <span className="font-normal opacity-80">· {days}d</span>}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function deriveProStatus(p: {
  available?: boolean | null;
  reserved_until?: string | null;
  active?: boolean | null;
}): Status {
  if (p.reserved_until && new Date(p.reserved_until) > new Date()) return "reserved";
  if (p.active === false || p.available === false) return "busy";
  return "available";
}

// eslint-disable-next-line react-refresh/only-export-components
export function deriveOfferStatus(o: { status: string; reserved_until?: string | null }): Status {
  if (o.status === "filled") return "filled";
  if (o.status === "closed") return "closed";
  return "open";
}
