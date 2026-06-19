import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "professional"
  | "family"
  | "institution"
  | "superadmin"
  | "hr_staff"
  | "evaluator";

export type AppUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  roles: AppRole[];
  primaryRole: AppRole;
};

const PRIORITY: AppRole[] = [
  "superadmin",
  "hr_staff",
  "evaluator",
  "institution",
  "family",
  "professional",
];

function pickPrimary(roles: AppRole[]): AppRole {
  for (const r of PRIORITY) if (roles.includes(r)) return r;
  return "family";
}

export function pathForRole(role: AppRole): string {
  switch (role) {
    case "superadmin":
      return "/superadmin";
    case "hr_staff":
      return "/talento-humano";
    case "evaluator":
      return "/evaluador";
    case "institution":
      return "/dashboard/institucion";
    case "family":
      return "/dashboard/familia";
    case "professional":
    default:
      return "/dashboard/profesional";
  }
}

export function useAppUser(options: { requireAuth?: boolean; allow?: AppRole[] } = {}) {
  const { requireAuth = true, allow } = options;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AppUser | null>(null);
  const redirectedRef = useRef(false);
  const loadedForUidRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const safeRedirect = (to: string) => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      navigate({ to, replace: true }).catch(() => {
        if (typeof window !== "undefined") window.location.replace(to);
      });
    };

    const loadUser = async (uid: string, email: string) => {
      // Avoid re-loading the same user multiple times (prevents flicker / loops).
      if (loadedForUidRef.current === uid) return;
      loadedForUidRef.current = uid;

      try {
        const [rolesRes, profileRes] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase
            .from("profiles")
            .select("full_name, avatar_url")
            .eq("user_id", uid)
            .maybeSingle(),
        ]);

        if (!active) return;

        if (rolesRes.error) {
          console.warn("[useAppUser] user_roles error:", rolesRes.error.message);
        }
        if (profileRes.error) {
          console.warn("[useAppUser] profiles error:", profileRes.error.message);
        }

        const list = (rolesRes.data?.map((r) => r.role) ?? []) as AppRole[];
        const finalRoles = list.length ? list : (["family"] as AppRole[]);
        const primary = pickPrimary(finalRoles);

        // Route restriction → redirect to the user's own panel (do NOT setUser).
        if (allow && !finalRoles.some((r) => allow.includes(r))) {
          safeRedirect(pathForRole(primary));
          setLoading(false);
          return;
        }

        setUser({
          id: uid,
          email,
          fullName: profileRes.data?.full_name ?? email,
          avatarUrl: profileRes.data?.avatar_url ?? null,
          roles: finalRoles,
          primaryRole: primary,
        });
      } catch (err) {
        console.error("[useAppUser] loadUser failed:", err);
        // Fail closed: never assume a default role on error. If the route is
        // restricted, send the user to /auth so admin pages can't be reached
        // by satisfying the catch path.
        if (active) {
          setUser(null);
          if (allow || requireAuth) safeRedirect("/auth");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    // 1) Subscribe FIRST so we react to login/logout.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!active) return;
      if (!session) {
        loadedForUidRef.current = null;
        setUser(null);
        setLoading(false);
        if (requireAuth) safeRedirect("/auth");
        return;
      }
      // Defer to avoid running supabase calls inside the callback synchronously.
      setTimeout(() => {
        if (!active) return;
        loadUser(session.user.id, session.user.email ?? "");
      }, 0);
    });

    // 2) Then check existing session.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (!data.session) {
          setLoading(false);
          if (requireAuth) safeRedirect("/auth");
          return;
        }
        loadUser(data.session.user.id, data.session.user.email ?? "");
      })
      .catch((err) => {
        console.error("[useAppUser] getSession failed:", err);
        if (active) setLoading(false);
      });

    // Hard safety net: never stay in loading forever.
    const safety = setTimeout(() => {
      if (active) setLoading(false);
    }, 5000);

    return () => {
      active = false;
      clearTimeout(safety);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    loadedForUidRef.current = null;
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return { user, loading, logout };
}
