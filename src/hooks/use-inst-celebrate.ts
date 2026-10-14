// Hitos del equipo — qué se celebra y qué ya se celebró (se recuerda en el navegador de cada persona; nada de esto toca la base de datos).
//
// La primera vez que alguien abre el módulo en un navegador, lo que la institución ya tenía se marca como visto SIN fiesta; después, cada
// hito nuevo se celebra una sola vez. Si el navegador no deja guardar (modo privado, datos bloqueados), la pantalla funciona igual: solo
// puede repetir una celebración.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CareOverview } from "@/lib/instCare";
import {
  celebrationPlan,
  milestoneStates,
  newlyUnlocked,
  nextGoal,
  parseSeen,
  seenStorageKey,
  serializeSeen,
  type CelebrationPlan,
  type MilestoneContext,
} from "@/lib/instCelebrate";

function readSeen(userId: string): Set<string> | null {
  try {
    return parseSeen(window.localStorage.getItem(seenStorageKey(userId)));
  } catch {
    return null;
  }
}

function writeSeen(userId: string, keys: string[]): void {
  try {
    window.localStorage.setItem(seenStorageKey(userId), serializeSeen(keys));
  } catch {
    /* sin almacenamiento: la pantalla sigue funcionando */
  }
}

export function useMilestones(
  userId: string | null | undefined,
  overview: CareOverview | undefined,
  flags: { hasControl?: boolean; hasDevice?: boolean } = {},
) {
  const [seen, setSeen] = useState<Set<string> | null | undefined>(undefined);
  const [plan, setPlan] = useState<CelebrationPlan | null>(null);
  const { hasControl, hasDevice } = flags;

  const ctx = useMemo<MilestoneContext | null>(
    () => (overview ? { overview, hasControl, hasDevice } : null),
    [overview, hasControl, hasDevice],
  );

  useEffect(() => {
    if (!userId || !ctx) return;
    // `undefined` aún no se ha leído; `null` es «primera visita a este navegador».
    const current = seen === undefined ? readSeen(userId) : seen;
    const result = newlyUnlocked(ctx, current);
    writeSeen(userId, result.seen);
    setSeen(new Set(result.seen));
    if (result.fresh.length > 0) setPlan(celebrationPlan(result.fresh));
    // `seen` se actualiza aquí mismo: solo importa cuando cambian los datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ctx]);

  const dismiss = useCallback(() => setPlan(null), []);
  const states = useMemo(() => (ctx ? milestoneStates(ctx, seen ?? null) : []), [ctx, seen]);
  const goal = useMemo(() => (ctx ? nextGoal(ctx, seen ?? null) : null), [ctx, seen]);

  return { plan, dismiss, states, goal };
}
