import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { pathForRole, type AppRole } from "@/hooks/use-app-user";

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
];

function hardRedirect(to: string) {
  if (typeof window === "undefined") return;
  window.location.replace(to);
}

function DashboardRouter() {
  const [msg, setMsg] = useState("Verificando sesión...");

  useEffect(() => {
    let done = false;

    const go = (to: string) => {
      if (done) return;
      done = true;
      hardRedirect(to);
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
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      {msg}
    </div>
  );
}
