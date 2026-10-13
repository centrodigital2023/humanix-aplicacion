// ¿Hay una sesión iniciada? Barato (no carga perfil ni roles): sirve para decidir cómo se escucha un canal en vivo o si se pide
// algo que solo existe con sesión. `ready` distingue «todavía no sé» de «no hay sesión» (para no mostrar un «entra» de más).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSession(): { has: boolean; ready: boolean } {
  const [state, setState] = useState({ has: false, ready: false });
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ has: !!data.session, ready: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ has: !!session, ready: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export function useHasSession(): boolean {
  return useSession().has;
}
