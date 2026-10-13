import { useHasSession } from "@/hooks/use-has-session";
import { useLiveCounts } from "@/hooks/use-live-map";
import { EMPTY_COUNTS, type LiveCounts } from "@/lib/liveMap";

type UserRole = "professional" | "family" | "institution";

/**
 * Contadores reales de la plataforma (registrados, disponibles, ocupados y en vivo por rol), siempre al día: la base avisa cuando algo
 * cambia y se vuelve a pedir por una función segura (ver `use-live-map.ts`). Cualquiera puede verlos: son totales, sin datos personales.
 *
 * Significado de «disponible»: profesionales → marcados disponibles y sin servicio ahora; familias e instituciones → con ofertas u
 * horas abiertas. `familiesVisible` e `institutionsVisible` se conservan con su nombre antiguo y valen eso mismo.
 */
export function useActiveUsersCount(_role?: UserRole) {
  const authed = useHasSession();
  const query = useLiveCounts({ authed });
  const live: LiveCounts = query.data ?? EMPTY_COUNTS;
  const { professionals: pro, families: fam, institutions: inst } = live;

  const counts = {
    professionals: pro.total,
    professionalsAvailable: pro.available,
    professionalsBusy: pro.busy,
    professionalsRethus: live.professionalsRethus,
    professionalsOnline: pro.live,
    families: fam.total,
    familiesVisible: fam.available,
    familiesBusy: fam.busy,
    familiesOnline: fam.live,
    institutions: inst.total,
    institutionsVisible: inst.available,
    institutionsBusy: inst.busy,
    institutionsOnline: inst.live,
    completedServices: live.completedServices,
  };

  const getCount = (roleFilter?: UserRole) => {
    if (!roleFilter) return counts.professionals + counts.families + counts.institutions;
    switch (roleFilter) {
      case "professional":
        return counts.professionals;
      case "family":
        return counts.families;
      case "institution":
        return counts.institutions;
      default:
        return 0;
    }
  };

  const getAvailableCount = (roleFilter?: UserRole) => {
    if (!roleFilter)
      return counts.professionalsAvailable + counts.familiesVisible + counts.institutionsVisible;
    switch (roleFilter) {
      case "professional":
        return counts.professionalsAvailable;
      case "family":
        return counts.familiesVisible;
      case "institution":
        return counts.institutionsVisible;
      default:
        return 0;
    }
  };

  return {
    /** Lo nuevo: por rol, con registrados, disponibles, ocupados y en vivo. */
    live,
    counts,
    loading: query.isLoading,
    getCount,
    getAvailableCount,
    // Totales registrados
    professionals: counts.professionals,
    professionalsRethus: counts.professionalsRethus,
    families: counts.families,
    institutions: counts.institutions,
    total: counts.professionals + counts.families + counts.institutions,
    completedServices: counts.completedServices,
    // Disponibles ahora mismo
    professionalsAvailable: counts.professionalsAvailable,
    familiesVisible: counts.familiesVisible,
    institutionsVisible: counts.institutionsVisible,
    totalAvailable:
      counts.professionalsAvailable + counts.familiesVisible + counts.institutionsVisible,
    // Ocupados ahora mismo
    professionalsBusy: counts.professionalsBusy,
    // Con la aplicación abierta ahora mismo
    professionalsOnline: counts.professionalsOnline,
    familiesOnline: counts.familiesOnline,
    institutionsOnline: counts.institutionsOnline,
    totalOnline: counts.professionalsOnline + counts.familiesOnline + counts.institutionsOnline,
  };
}
