import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { pathForRole, type AppRole } from "@/hooks/use-app-user";
import { parseStaffContext } from "@/lib/staffPanel";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [{ title: "Mi panel · Humanix" }],
  }),
  component: DashboardRouter,
});

const PRIORITY: AppRole[] = [
  "superadmin",
  "hr_staff",
  "evaluator",
  "institution",
  "family",
  "professional",
  "institution_staff",
];

function DashboardRouter() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Verificando sesión...");

  useEffect(() => {
    let done = false;

    const go = (to: string) => {
      if (done) return;
      done = true;
      // Navegación dentro de la app: sin recargar la página ni pasar por una pantalla en blanco.
      void navigate({ href: to, replace: true });
    };

    const safety = setTimeout(() => {
      if (!done) {
        console.warn("[dashboard] safety timeout fired → /auth");
        go("/auth");
      }
    }, 10000);

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn("[dashboard] getSession error:", error.message);
        }
        if (!data?.session) {
          go("/auth");
          return;
        }
        setMsg("Redirigiendo a tu panel...");
        const uid = data.session.user.id;
        const metaRole = data.session.user.user_metadata?.role as AppRole | undefined;

        const rolesPromise = supabase.from("user_roles").select("role").eq("user_id", uid);
        const dbTimeout = new Promise<{ data: null }>((resolve) =>
          setTimeout(() => resolve({ data: null }), 5000),
        );
        const result = (await Promise.race([rolesPromise, dbTimeout])) as {
          data: { role: AppRole }[] | null;
        };

        let list = (result.data?.map((x) => x.role) ?? []) as AppRole[];

        // El personal de una institución no tiene roles: se reconoce por su pertenencia y va a su panel (o a explicarle por qué no).
        if (result.data && !list.length) {
          try {
            const { data: ctx, error: ctxError } = await (
              supabase as unknown as SupabaseClient
            ).rpc("my_staff_context");
            const staff = ctxError ? null : parseStaffContext(ctx);
            if (staff) {
              go(
                staff.status === "suspended"
                  ? "/acceso-equipo?motivo=suspendido"
                  : pathForRole("institution_staff"),
              );
              return;
            }
          } catch {
            /* sin la función o sin red: sigue el camino de siempre */
          }
        }

        // If DB timed out or user_roles is empty, fall back to signup metadata
        if (!list.length && metaRole) {
          list = [metaRole];
        }

        const primary = PRIORITY.find((p) => list.includes(p)) ?? "family";

        // For institution users: check if they're EPS/IPS type → portal especializado
        if (primary === "institution") {
          try {
            const { data: instData } = await supabase
              .from("institution_profiles")
              .select("institution_type")
              .eq("user_id", uid)
              .maybeSingle();
            if (instData?.institution_type && /eps|ips/i.test(instData.institution_type)) {
              go("/dashboard/eps");
              return;
            }
          } catch {
            /* fall through to default */
          }
        }

        go(pathForRole(primary));
      } catch (err) {
        console.error("[dashboard] router error:", err);
        go("/auth");
      }
    })();

    return () => {
      clearTimeout(safety);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      {msg}
    </div>
  );
}
