// Iconos de los hitos (lucide) y el texto para compartir uno. Aparte de los componentes para que el refresco en caliente funcione.
import type { ComponentType } from "react";
import {
  Activity,
  CheckCircle2,
  Flame,
  FolderOpen,
  Heart,
  Star,
  Trophy,
  UserPlus,
  Users,
  Watch,
} from "lucide-react";
import type { Milestone, MilestoneIcon } from "@/lib/instCelebrate";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export const MILESTONE_ICON: Record<MilestoneIcon, Icon> = {
  "user-plus": UserPlus,
  users: Users,
  folder: FolderOpen,
  activity: Activity,
  watch: Watch,
  check: CheckCircle2,
  star: Star,
  heart: Heart,
  flame: Flame,
  trophy: Trophy,
};

/** Texto para compartir un hito: sin datos de pacientes, solo el logro y la institución. */
export function milestoneShareText(m: Milestone, institution?: string | null): string {
  const who = institution?.trim() ? `en ${institution.trim()}` : "en nuestro equipo";
  return `Nuevo hito ${who}: ${m.title}. Cuidado coordinado con Humanix · https://humanix.lat`;
}
