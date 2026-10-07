// Hook exclusivo para el área superadmin.
// A diferencia de useAppUser, este hook NUNCA redirige a dashboards de otros roles.
// Si el usuario no es superadmin o no tiene sesión → /admin (no /auth, no /dashboard).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/hooks/use-app-user";

export type SuperadminUser = AppUser;

export function useSuperadmin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SuperadminUser | null>(null);
  const redirectedRef = useRef(false);

  const toAdmin = () => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    navigate({ to: "/admin", replace: true }).catch(() => {
      if (typeof window !== "undefined") window.location.replace("/admin");
    });
  };

  useEffect(() => {
    let active = true;

    const verify = async (uid: string, email: string) => {
      try {
        // Verificar rol superadmin — la única comprobación que importa aquí.
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "superadmin")
          .maybeSingle();

        if (!active) return;

        if (!roleRow) {
          // Sesión activa pero SIN rol superadmin → volver al login de admin.
          await supabase.auth.signOut();
          toAdmin();
          setLoading(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("user_id", uid)
          .maybeSingle();

        if (!active) return;

        setUser({
          id: uid,
          email,
          fullName: profile?.full_name ?? email,
          avatarUrl: profile?.avatar_url ?? null,
          roles: ["superadmin"],
          primaryRole: "superadmin",
        });
      } catch {
        if (active) toAdmin();
      } finally {
        if (active) setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        toAdmin();
        setLoading(false);
        return;
      }
      verify(data.session.user.id, data.session.user.email ?? "");
    });

    // Safety net: nunca quedarse en loading para siempre.
    const safety = setTimeout(() => {
      if (active) setLoading(false);
    }, 5000);

    return () => {
      active = false;
      clearTimeout(safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/admin", replace: true });
  };

  return { user, loading, logout };
}
