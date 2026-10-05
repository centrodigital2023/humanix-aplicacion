// Perfil activo en todo el sitio (Familias / IPS-EPS / Profesional).
//  - Con cuenta: lo define el rol (no se puede cambiar).
//  - Sin cuenta: lo que eligió en la home (se puede cambiar desde la home).
import { useCallback, useEffect, useState } from "react";
import { useAppUser } from "@/hooks/use-app-user";
import {
  audienceFromRoles,
  onAudienceChange,
  readStoredAudience,
  storeAudience,
  type Audience,
} from "@/lib/audience";

export function useAudience() {
  const { user, loading } = useAppUser({ requireAuth: false });
  const [stored, setStored] = useState<Audience | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setStored(readStoredAudience());
    setMounted(true);
    return onAudienceChange(() => setStored(readStoredAudience()));
  }, []);

  const fromRole = user ? audienceFromRoles(user.roles) : null;
  const audience: Audience | undefined = fromRole ?? stored;

  const choose = useCallback((a: Audience) => storeAudience(a), []);
  const clear = useCallback(() => storeAudience(null), []);

  return {
    audience,
    /** true si el perfil viene de la cuenta (no se ofrece cambiarlo). */
    locked: Boolean(fromRole),
    ready: mounted && !loading,
    user,
    choose,
    clear,
  };
}
