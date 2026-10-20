import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseStaffContext, type StaffContext } from "@/lib/staffPanel";
import { applyStoredReferralCode, type ApplyReferralRpc } from "@/lib/referralCode";

/** `apply_referral_code` siempre registra a auth.uid(): el navegador solo manda el código. */
export const applyReferralRpc: ApplyReferralRpc = async (code) =>
  (supabase as unknown as SupabaseClient).rpc("apply_referral_code", { p_code: code });

/** Código de referido guardado al llegar con `?ref=`: se aplica apenas hay sesión (también tras confirmar el correo). */
function applyPendingReferral() {
  try {
    void applyStoredReferralCode(localStorage, applyReferralRpc);
  } catch {
    /* sin almacenamiento no hay código pendiente */
  }
}

/**
 * `institution_staff` no es un rol de `user_roles` (el personal nunca tiene uno): es la etiqueta de pantalla de quien entra con el
 * usuario y la contraseña que le dio su institución. Se reconoce por su pertenencia (`my_staff_context()`), no por metadatos.
 */
export type AppRole =
  | "professional"
  | "family"
  | "institution"
  | "superadmin"
  | "hr_staff"
  | "evaluator"
  | "institution_staff";

export type AppUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  roles: AppRole[];
  primaryRole: AppRole;
  /** Solo para el personal de una institución: su institución, módulos y estado. */
  staff?: StaffContext;
};

const PRIORITY: AppRole[] = [
  "superadmin",
  "hr_staff",
  "evaluator",
  "institution",
  "family",
  "professional",
  "institution_staff",
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
    case "institution_staff":
      return "/dashboard/equipo";
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
      // When bouncing to /auth, preserve the current path so the user lands
      // back here after a successful login (e.g. /superadmin → /auth?redirect=/superadmin).
      const destination =
        to === "/auth" && typeof window !== "undefined" && window.location.pathname !== "/"
          ? `/auth?redirect=${encodeURIComponent(window.location.pathname)}`
          : to;
      navigate({ to: destination as any, replace: true }).catch(() => {
        if (typeof window !== "undefined") window.location.replace(destination);
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

        // El personal de una institución no tiene roles: su pertenencia sale de `my_staff_context()` (solo se pregunta si no hay roles).
        let staff: StaffContext | null = null;
        if (!list.length) {
          try {
            const ctxRes = await (supabase as unknown as SupabaseClient).rpc("my_staff_context");
            if (!ctxRes.error) staff = parseStaffContext(ctxRes.data);
          } catch {
            staff = null; // sin la función (aún no publicada) o sin red: sigue el camino de siempre
          }
          if (!active) return;
        }

        if (staff && staff.status === "suspended") {
          // Suspendida: se cierra la sesión y se le explica (la base de datos ya le cortó el acceso a los datos).
          await supabase.auth.signOut();
          loadedForUidRef.current = null;
          setUser(null);
          setLoading(false);
          safeRedirect("/acceso-equipo?motivo=suspendido");
          return;
        }

        // If user_roles is empty (trigger race or new user), fall back to
        // the role stored in auth user metadata before defaulting to "family".
        let finalRoles: AppRole[];
        if (staff) {
          finalRoles = ["institution_staff"];
        } else if (list.length) {
          finalRoles = list;
        } else {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user?.user_metadata?.signup_kind === "institution_staff") {
            // Era del equipo de una institución y ya no lo es (la quitaron): no se le trata como una familia, se le explica.
            await supabase.auth.signOut();
            loadedForUidRef.current = null;
            setUser(null);
            setLoading(false);
            safeRedirect("/acceso-equipo?motivo=retirado");
            return;
          }
          const metaRole = authData?.user?.user_metadata?.role as AppRole | undefined;
          // `institution_staff` no está aquí a propósito: ese rol no se puede declarar en los metadatos de la cuenta.
          const ALL_ROLES: AppRole[] = [
            "professional",
            "family",
            "institution",
            "superadmin",
            "hr_staff",
            "evaluator",
          ];
          if (metaRole && ALL_ROLES.includes(metaRole)) {
            finalRoles = [metaRole];
          } else {
            finalRoles = ["family"];
          }
        }
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
          fullName: staff?.displayName ?? profileRes.data?.full_name ?? email,
          avatarUrl: profileRes.data?.avatar_url ?? null,
          roles: finalRoles,
          primaryRole: primary,
          ...(staff ? { staff } : {}),
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
        applyPendingReferral();
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
        applyPendingReferral();
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
    const wasStaff = user?.primaryRole === "institution_staff";
    loadedForUidRef.current = null;
    await supabase.auth.signOut();
    navigate({ to: wasStaff ? "/acceso-equipo" : "/", replace: true });
  };

  return { user, loading, logout };
}
