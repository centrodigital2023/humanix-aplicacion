// La historia de lo que le ha pasado a un paciente, de lo más reciente a lo más antiguo: notas, controles, alertas, tareas, casos y bitácora.
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  HeartPulse,
  ListChecks,
  Repeat,
  User,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { dayClockLabel, type Clock, type TimelineIcon, type TimelineItem } from "@/lib/instCare";
import { cn } from "@/lib/utils";
import { TONE } from "@/components/humanix/instcare/tones";

const ICON: Record<TimelineIcon, LucideIcon> = {
  note: FileText,
  alert: AlertTriangle,
  task: ListChecks,
  case: FolderOpen,
  obs: HeartPulse,
  monitor: Activity,
  device: Watch,
  patient: User,
  export: Download,
  handoff: Repeat,
  check: CheckCircle2,
};

export function ActivityPanel({ items, now }: { items: TimelineItem[]; now: Clock }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Aún no hay actividad. Todo lo que pase con esta persona aparecerá aquí.
      </p>
    );
  }
  return (
    <ol
      className="relative space-y-4 border-l border-border pl-5"
      aria-label="Actividad del paciente"
      data-testid="activity-panel"
    >
      {items.map((it) => {
        const Icon = ICON[it.icon];
        const t = TONE[it.tone];
        return (
          <li key={it.id} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute -left-[1.85rem] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background",
                t.soft,
                t.text,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <p className="text-sm font-medium leading-snug">{it.title}</p>
            {it.detail && (
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                {it.detail}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {dayClockLabel(it.at, now)}
              {it.actor ? ` · ${it.actor}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
